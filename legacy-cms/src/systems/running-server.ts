import * as http from 'http';
import * as net from 'net';
import type { Express } from 'express';

/** Handle returned by every simulator: the bound port and a way to stop it. */
export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

/**
 * Listens on `port` (0 = any free port, used by tests) and resolves once bound.
 * close() also destroys open sockets so tests and shutdowns don't hang on
 * keep-alive connections.
 */
export function listen(
  server: net.Server,
  port: number,
): Promise<RunningServer> {
  const sockets = new Set<net.Socket>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => {
      server.off('error', reject);
      const address = server.address() as net.AddressInfo;
      resolve({
        port: address.port,
        close: () =>
          new Promise<void>((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

export function listenHttp(app: Express, port: number): Promise<RunningServer> {
  return listen(http.createServer(app), port);
}

export function randomInt(
  maxExclusive: number,
  random: () => number = Math.random,
): number {
  return Math.floor(random() * maxExclusive);
}
