/**
 * =============================================================================
 * ROS SIMULATOR - REST/JSON over HTTP
 * =============================================================================
 *
 * Stands in for the third-party cloud Route Optimisation System.
 *
 *   GET    /health
 *   POST   /api/v1/routes            201 { routeId, eta, legs[], distanceKm, durationMin }
 *   DELETE /api/v1/routes/:routeId   204, or 404 if unknown
 *
 * Every /api/v1 call needs `X-API-Key: <apiKey>`, otherwise 401.
 * POST is idempotent on `reference`: a repeat returns the same route.
 * =============================================================================
 */

import express, { NextFunction, Request, Response } from 'express';
import { Logger } from '@nestjs/common';
import { RunningServer, listenHttp, randomInt } from './running-server';

export interface RosServerOptions {
  port?: number;
  apiKey: string;
  latencyMs?: number;
}

interface Point {
  lat: number;
  lng: number;
  label: string;
}

interface Route {
  routeId: string;
  reference: string;
  eta: string;
  legs: Point[];
  distanceKm: number;
  durationMin: number;
}

function isPoint(value: unknown): value is Point {
  const p = value as Point;
  return (
    !!p &&
    typeof p.lat === 'number' &&
    typeof p.lng === 'number' &&
    typeof p.label === 'string'
  );
}

export async function startRosServer(
  options: RosServerOptions,
): Promise<RunningServer> {
  const logger = new Logger('ROS-System');
  const latencyMs = options.latencyMs ?? 0;
  const routes = new Map<string, Route>(); // routeId -> route
  const routeByRef = new Map<string, string>(); // reference -> routeId

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', system: 'ROS', routes: routes.size });
  });

  app.use('/api/v1', (req: Request, res: Response, next: NextFunction) => {
    if (req.header('X-API-Key') !== options.apiKey) {
      logger.warn(`${req.method} ${req.originalUrl}: rejected, bad API key`);
      res.status(401).json({ error: 'UNAUTHORIZED' });
      return;
    }
    if (latencyMs > 0) {
      setTimeout(next, latencyMs);
      return;
    }
    next();
  });

  app.post('/api/v1/routes', (req: Request, res: Response) => {
    const { reference, origin, destination, parcelCount } = (req.body ??
      {}) as {
      reference?: unknown;
      origin?: unknown;
      destination?: unknown;
      parcelCount?: unknown;
    };
    if (
      typeof reference !== 'string' ||
      !reference ||
      !isPoint(origin) ||
      !isPoint(destination) ||
      typeof parcelCount !== 'number' ||
      !Number.isInteger(parcelCount) ||
      parcelCount < 0
    ) {
      res.status(400).json({
        error: 'BAD_REQUEST',
        details:
          'Expected { reference, origin{lat,lng,label}, destination{lat,lng,label}, parcelCount }',
      });
      return;
    }

    const existingId = routeByRef.get(reference);
    if (existingId) {
      logger.log(
        `POST /routes ${reference}: existing route ${existingId} (idempotent replay)`,
      );
      res.status(201).json(routes.get(existingId));
      return;
    }

    let routeId: string;
    do {
      routeId = `ROUTE-${randomInt(1000)}`;
    } while (routes.has(routeId));

    const route: Route = {
      routeId,
      reference,
      eta: new Date(Date.now() + 45 * 60000).toISOString(),
      legs: [origin, destination],
      distanceKm: randomInt(30) + 5,
      durationMin: randomInt(60) + 20,
    };
    routes.set(routeId, route);
    routeByRef.set(reference, routeId);

    logger.log(
      `POST /routes ${reference}: ${routeId}, ${route.distanceKm} km, ETA ${route.eta}`,
    );
    res.status(201).json(route);
  });

  app.delete('/api/v1/routes/:routeId', (req: Request, res: Response) => {
    const routeId = String(req.params.routeId);
    const route = routes.get(routeId);
    if (!route) {
      logger.warn(`DELETE /routes/${routeId}: not found`);
      res.status(404).json({ error: 'NOT_FOUND' });
      return;
    }

    routes.delete(routeId);
    routeByRef.delete(route.reference);
    logger.log(`DELETE /routes/${routeId}: cancelled`);
    res.status(204).end();
  });

  // Malformed JSON and other errors: answer in JSON, like a real API would.
  app.use(
    (
      err: { status?: number; message?: string },
      _req: Request,
      res: Response,
      // Express only treats 4-argument middleware as an error handler.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _next: NextFunction,
    ) => {
      const status =
        err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
      res.status(status).json({
        error: status === 500 ? 'INTERNAL' : 'BAD_REQUEST',
        details: err.message,
      });
    },
  );

  return listenHttp(app, options.port ?? 0);
}
