import * as net from 'net';
import { Logger } from '@nestjs/common';
import { WmsTcpAdapter } from './wms-tcp.adapter';
import { startWmsServer } from '../systems/wms-tcp.server';
import { RunningServer } from '../systems/running-server';

const items = (quantity = 1) => [{ productId: 'PROD-001', quantity }];

describe('WmsTcpAdapter ↔ WMS simulator', () => {
  let server: RunningServer;
  let adapter: WmsTcpAdapter;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    server = await startWmsServer({ port: 0, oosRate: 0 });
  });

  beforeEach(() => {
    adapter = new WmsTcpAdapter({
      host: '127.0.0.1',
      port: server.port,
      timeoutMs: 2000,
    });
  });

  afterEach(() => adapter.close());
  afterAll(() => server.close());

  it('checks stock and returns a package id', async () => {
    const reply = await adapter.checkStock({
      orderId: 'ORD-W1',
      items: items(),
    });
    expect(reply).toEqual({
      success: true,
      inStock: true,
      wmsPackageId: expect.stringMatching(/^WMS-PKG-\d+$/) as string,
      message: 'Stock available (WMS TCP)',
    });
  });

  it('is idempotent on orderId', async () => {
    const first = await adapter.checkStock({
      orderId: 'ORD-W2',
      items: items(),
    });
    const again = await adapter.checkStock({
      orderId: 'ORD-W2',
      items: items(),
    });
    expect(again.wmsPackageId).toBe(first.wmsPackageId);
  });

  it('reports OUT_OF_STOCK for quantity >= 100', async () => {
    const reply = await adapter.checkStock({
      orderId: 'ORD-W3',
      items: [
        { productId: 'PROD-001', quantity: 1 },
        { productId: 'PROD|ODD', quantity: 100 },
      ],
    });
    expect(reply).toEqual({
      success: false,
      inStock: false,
      error: 'OUT_OF_STOCK',
      message: 'Out of stock: PROD|ODD',
    });
  });

  it('releases held stock, and treats an unknown release as success', async () => {
    const held = await adapter.checkStock({
      orderId: 'ORD-W4',
      items: items(),
    });
    const released = await adapter.releaseStock({
      orderId: 'ORD-W4',
      wmsPackageId: held.wmsPackageId,
    });
    expect(released).toEqual({
      success: true,
      message: 'Stock released in WMS (TCP compensating transaction)',
    });

    const again = await adapter.releaseStock({
      orderId: 'ORD-W4',
      wmsPackageId: held.wmsPackageId,
    });
    expect(again).toEqual({
      success: true,
      message: 'Package not held in WMS; nothing to release',
    });
  });

  it('reserve fails for an order it has never seen', async () => {
    const reply = await adapter.reserveStock({ orderId: 'ORD-UNKNOWN' });
    expect(reply.success).toBe(false);
    expect(reply.error).toBe('WMS_NOT_FOUND');
  });

  it('matches 20 concurrent requests on one socket by SEQ', async () => {
    const replies = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        adapter.checkStock({ orderId: `ORD-C${i}`, items: items() }),
      ),
    );
    expect(replies.every((r) => r.success)).toBe(true);

    // Each order got its own package, and a replay returns the same one,
    // proving every reply was routed back to the request that sent it.
    const replays = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        adapter.checkStock({ orderId: `ORD-C${i}`, items: items() }),
      ),
    );
    expect(replays.map((r) => r.wmsPackageId)).toEqual(
      replies.map((r) => r.wmsPackageId),
    );
  });

  it('returns WMS_UNAVAILABLE when nothing is listening', async () => {
    const down = new WmsTcpAdapter({
      host: '127.0.0.1',
      port: 1,
      timeoutMs: 1000,
    });
    const reply = await down.checkStock({ orderId: 'ORD-X', items: items() });
    down.close();
    expect(reply.success).toBe(false);
    expect(reply.error).toBe('WMS_UNAVAILABLE');
  });

  it('fails pending requests with WMS_UNAVAILABLE when the connection drops', async () => {
    // A server that accepts the request, then hangs up without replying.
    const rude = net.createServer((socket) => {
      socket.once('data', () => socket.destroy());
    });
    await new Promise<void>((resolve) => rude.listen(0, resolve));
    const port = (rude.address() as net.AddressInfo).port;

    const victim = new WmsTcpAdapter({
      host: '127.0.0.1',
      port,
      timeoutMs: 2000,
    });
    const reply = await victim.checkStock({ orderId: 'ORD-D', items: items() });
    victim.close();
    rude.close();

    expect(reply.error).toBe('WMS_UNAVAILABLE');
  });

  it('returns WMS_TIMEOUT when the server never answers', async () => {
    const silent = net.createServer(() => {
      /* reads nothing, answers nothing */
    });
    await new Promise<void>((resolve) => silent.listen(0, resolve));
    const port = (silent.address() as net.AddressInfo).port;

    const waiting = new WmsTcpAdapter({
      host: '127.0.0.1',
      port,
      timeoutMs: 200,
    });
    const reply = await waiting.checkStock({
      orderId: 'ORD-T',
      items: items(),
    });
    waiting.close();
    silent.close();

    expect(reply.error).toBe('WMS_TIMEOUT');
  });

  it('reconnects after the WMS restarts', async () => {
    const first = await startWmsServer({ port: 0, oosRate: 0 });
    const port = first.port;
    const resilient = new WmsTcpAdapter({
      host: '127.0.0.1',
      port,
      timeoutMs: 2000,
    });

    expect(
      (await resilient.checkStock({ orderId: 'R1', items: items() })).success,
    ).toBe(true);

    await first.close();
    const second = await startWmsServer({ port, oosRate: 0 });

    // Give the background reconnect (500 ms backoff) a chance, then use it.
    await new Promise((resolve) => setTimeout(resolve, 700));
    const reply = await resilient.checkStock({ orderId: 'R2', items: items() });

    resilient.close();
    await second.close();
    expect(reply.success).toBe(true);
  });
});
