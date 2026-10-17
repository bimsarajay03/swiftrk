import * as http from 'http';
import { Logger } from '@nestjs/common';
import { CmsSoapAdapter } from './cms-soap.adapter';
import { startCmsServer } from '../systems/cms-soap.server';
import { RunningServer } from '../systems/running-server';

const ORDER = {
  orderId: 'ORD-CMS-1',
  customerId: 'CUST-001',
  customerName: 'Jane Perera',
  customerEmail: 'jane@example.com',
  items: [
    { productId: 'PROD-001', productName: 'Box', quantity: 2, unitPrice: 1500 },
  ],
  totalPrice: 3000,
};

describe('CmsSoapAdapter ↔ CMS simulator', () => {
  let server: RunningServer;
  let adapter: CmsSoapAdapter;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    server = await startCmsServer({ port: 0 });
    adapter = new CmsSoapAdapter({
      url: `http://127.0.0.1:${server.port}/cms/soap`,
      timeoutMs: 2000,
    });
  });

  afterAll(() => server.close());

  it('creates an order and returns the canonical reply', async () => {
    const reply = await adapter.createOrder(ORDER);
    expect(reply).toEqual({
      success: true,
      cmsOrderId: expect.stringMatching(/^CMS-\d+-\d{4}$/) as string,
      message: 'Order created in CMS (SOAP/XML)',
    });
  });

  it('is idempotent on orderId (redelivery does not duplicate)', async () => {
    const first = await adapter.createOrder({ ...ORDER, orderId: 'ORD-CMS-2' });
    const again = await adapter.createOrder({ ...ORDER, orderId: 'ORD-CMS-2' });
    expect(again.cmsOrderId).toBe(first.cmsOrderId);
  });

  it('cancels a created order', async () => {
    const created = await adapter.createOrder({
      ...ORDER,
      orderId: 'ORD-CMS-3',
    });
    const reply = await adapter.cancelOrder({
      orderId: 'ORD-CMS-3',
      cmsOrderId: created.cmsOrderId,
    });
    expect(reply.success).toBe(true);
    expect(reply.message).toMatch(/cancelled/);
  });

  it('treats cancelling an unknown order as success (fault CMS_ORDER_NOT_FOUND)', async () => {
    const reply = await adapter.cancelOrder({
      orderId: 'ORD-NOPE',
      cmsOrderId: 'CMS-0-0000',
    });
    expect(reply).toEqual({
      success: true,
      message: 'Order not present in CMS; nothing to cancel',
    });
  });

  it('maps a validation fault to its error code', async () => {
    const reply = await adapter.createOrder({ ...ORDER, items: [] });
    expect(reply.success).toBe(false);
    expect(reply.error).toBe('CMS_VALIDATION_ERROR');
  });

  it('returns CMS_UNAVAILABLE when nothing is listening', async () => {
    const down = new CmsSoapAdapter({
      url: 'http://127.0.0.1:1/cms/soap',
      timeoutMs: 2000,
    });
    const reply = await down.createOrder(ORDER);
    expect(reply.success).toBe(false);
    expect(reply.error).toBe('CMS_UNAVAILABLE');
  });

  it('returns CMS_TIMEOUT when the server is too slow', async () => {
    const slow = http.createServer(() => {
      /* never answers */
    });
    await new Promise<void>((resolve) => slow.listen(0, resolve));
    const port = (slow.address() as { port: number }).port;

    const adapterWithShortTimeout = new CmsSoapAdapter({
      url: `http://127.0.0.1:${port}/cms/soap`,
      timeoutMs: 200,
    });
    const reply = await adapterWithShortTimeout.createOrder(ORDER);
    slow.closeAllConnections();
    slow.close();

    expect(reply.error).toBe('CMS_TIMEOUT');
  });
});
