import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RmqContext } from '@nestjs/microservices';
import { LegacyMockModule } from './legacy-mock.module';
import { LegacyMockController } from './legacy-mock.controller';
import { WmsTcpAdapter } from './adapters/wms-tcp.adapter';
import { startCmsServer } from './systems/cms-soap.server';
import { startWmsServer } from './systems/wms-tcp.server';
import { startRosServer } from './systems/ros-rest.server';
import { RunningServer } from './systems/running-server';

/**
 * Wires the real module (env-configured adapters) against the three
 * simulators and drives the controller the way RabbitMQ would, checking the
 * replies the saga reads and that every message is acked.
 */
describe('LegacyMockController (module wiring, end to end without RabbitMQ)', () => {
  let servers: RunningServer[];
  let controller: LegacyMockController;
  let wms: WmsTcpAdapter;
  const ack = jest.fn();

  const context = () => {
    const message = { id: Symbol('msg') };
    return {
      getChannelRef: () => ({ ack }),
      getMessage: () => message,
    } as unknown as RmqContext;
  };

  const ORDER = {
    orderId: 'ORD-E2E-1',
    customerId: 'CUST-001',
    customerName: 'Jane Perera',
    customerEmail: 'jane@example.com',
    items: [
      {
        productId: 'PROD-001',
        productName: 'Box',
        quantity: 2,
        unitPrice: 1500,
      },
    ],
    totalPrice: 3000,
    deliveryAddress: { street: '12 Galle Road', city: 'Colombo' },
  };

  beforeAll(async () => {
    Logger.overrideLogger(false);
    const [cms, wmsServer, ros] = await Promise.all([
      startCmsServer({ port: 0 }),
      startWmsServer({ port: 0, oosRate: 0 }),
      startRosServer({ port: 0, apiKey: 'wiring-key' }),
    ]);
    servers = [cms, wmsServer, ros];

    process.env.CMS_SOAP_URL = `http://127.0.0.1:${cms.port}/cms/soap`;
    process.env.WMS_TCP_HOST = '127.0.0.1';
    process.env.WMS_TCP_PORT = String(wmsServer.port);
    process.env.ROS_BASE_URL = `http://127.0.0.1:${ros.port}`;
    process.env.ROS_API_KEY = 'wiring-key';

    const moduleRef = await Test.createTestingModule({
      imports: [LegacyMockModule],
    }).compile();
    controller = moduleRef.get(LegacyMockController);
    wms = moduleRef.get(WmsTcpAdapter);
  });

  afterAll(async () => {
    wms.close();
    await Promise.all(servers.map((s) => s.close()));
  });

  beforeEach(() => ack.mockClear());

  it('runs the happy-path saga steps through all three protocols', async () => {
    const cms = await controller.handleCmsCreateOrder(ORDER, context());
    expect(cms).toMatchObject({
      success: true,
      cmsOrderId: expect.any(String) as string,
    });

    const wmsReply = await controller.handleWmsCheckStock(
      { orderId: ORDER.orderId, items: ORDER.items },
      context(),
    );
    expect(wmsReply).toMatchObject({ success: true, inStock: true });

    const ros = await controller.handleRosOptimizeRoute(ORDER, context());
    expect(ros).toMatchObject({
      success: true,
      rosRouteId: expect.stringMatching(/^ROUTE-/) as string,
      estimatedDeliveryTime: expect.any(String) as string,
    });

    expect(ack).toHaveBeenCalledTimes(3);
  });

  it('runs the out-of-stock compensation path', async () => {
    const orderId = 'ORD-E2E-OOS';
    const cms = await controller.handleCmsCreateOrder(
      { ...ORDER, orderId },
      context(),
    );

    const stock = await controller.handleWmsCheckStock(
      { orderId, items: [{ productId: 'PROD-BIG', quantity: 100 }] },
      context(),
    );
    expect(stock).toMatchObject({
      success: false,
      inStock: false,
      error: 'OUT_OF_STOCK',
    });

    const cancel = await controller.handleCmsCancelOrder(
      { orderId, cmsOrderId: cms.cmsOrderId },
      context(),
    );
    expect(cancel).toMatchObject({ success: true });
    expect(cancel.message).toMatch(/cancelled in CMS/);

    expect(ack).toHaveBeenCalledTimes(3);
  });

  it('treats cancelling an unknown route as success and still acks', async () => {
    const reply = await controller.handleRosCancelRoute(
      { orderId: 'X', rosRouteId: 'ROUTE-1' },
      context(),
    );
    expect(reply.success).toBe(true);
    expect(ack).toHaveBeenCalledTimes(1);
  });
});
