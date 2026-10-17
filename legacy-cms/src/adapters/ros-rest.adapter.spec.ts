import { Logger } from '@nestjs/common';
import { RosRestAdapter, WAREHOUSE } from './ros-rest.adapter';
import { startRosServer } from '../systems/ros-rest.server';
import { RunningServer } from '../systems/running-server';

const COMMAND = {
  orderId: 'ORD-R1',
  deliveryAddress: {
    street: '12 Galle Road',
    city: 'Colombo',
    latitude: 6.9,
    longitude: 79.85,
  },
  items: [{ productId: 'PROD-001', quantity: 1 }],
};

describe('RosRestAdapter ↔ ROS simulator', () => {
  let server: RunningServer;
  let adapter: RosRestAdapter;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    server = await startRosServer({ port: 0, apiKey: 'test-key' });
    adapter = new RosRestAdapter({
      baseUrl: `http://127.0.0.1:${server.port}`,
      apiKey: 'test-key',
      timeoutMs: 2000,
    });
  });

  afterAll(() => server.close());

  it('optimises a route and returns the canonical reply', async () => {
    const reply = await adapter.optimizeRoute(COMMAND);

    expect(reply.success).toBe(true);
    expect(reply.rosRouteId).toMatch(/^ROUTE-\d+$/);
    expect(new Date(reply.estimatedDeliveryTime!).getTime()).toBeGreaterThan(
      Date.now(),
    );
    expect(reply.optimizedRoute?.waypoints).toEqual([
      { lat: WAREHOUSE.lat, lng: WAREHOUSE.lng, address: WAREHOUSE.label },
      { lat: 6.9, lng: 79.85, address: '12 Galle Road, Colombo' },
    ]);
    expect(reply.optimizedRoute?.totalDistance).toBeGreaterThanOrEqual(5);
    expect(reply.optimizedRoute?.totalDuration).toBeGreaterThanOrEqual(20);
  });

  it('falls back to Colombo coordinates when the address has none', async () => {
    const reply = await adapter.optimizeRoute({
      orderId: 'ORD-R2',
      deliveryAddress: { street: '1 Main St' },
    });
    expect(reply.optimizedRoute?.waypoints[1]).toEqual({
      lat: 6.93,
      lng: 79.87,
      address: '1 Main St, Colombo',
    });
  });

  it('cancels a route, and treats an unknown route (404) as success', async () => {
    const created = await adapter.optimizeRoute({
      ...COMMAND,
      orderId: 'ORD-R3',
    });
    const cancel = { orderId: 'ORD-R3', rosRouteId: created.rosRouteId };

    expect(await adapter.cancelRoute(cancel)).toEqual({
      success: true,
      message: 'Route cancelled in ROS (REST compensating transaction)',
    });
    expect(await adapter.cancelRoute(cancel)).toEqual({
      success: true,
      message: 'Route not present in ROS; nothing to cancel',
    });
  });

  it('maps a wrong API key to ROS_REJECTED:401', async () => {
    const badKey = new RosRestAdapter({
      baseUrl: `http://127.0.0.1:${server.port}`,
      apiKey: 'wrong',
      timeoutMs: 2000,
    });
    const reply = await badKey.optimizeRoute(COMMAND);
    expect(reply.success).toBe(false);
    expect(reply.error).toBe('ROS_REJECTED:401');
  });

  it('returns ROS_UNAVAILABLE when nothing is listening', async () => {
    const down = new RosRestAdapter({
      baseUrl: 'http://127.0.0.1:1',
      apiKey: 'test-key',
      timeoutMs: 2000,
    });
    expect((await down.optimizeRoute(COMMAND)).error).toBe('ROS_UNAVAILABLE');
  });

  it('returns ROS_TIMEOUT when the API is slower than the timeout', async () => {
    const slowServer = await startRosServer({
      port: 0,
      apiKey: 'test-key',
      latencyMs: 500,
    });
    const impatient = new RosRestAdapter({
      baseUrl: `http://127.0.0.1:${slowServer.port}`,
      apiKey: 'test-key',
      timeoutMs: 100,
    });
    const reply = await impatient.optimizeRoute(COMMAND);
    await slowServer.close();
    expect(reply.error).toBe('ROS_TIMEOUT');
  });
});
