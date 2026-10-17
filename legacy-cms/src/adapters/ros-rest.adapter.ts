/**
 * =============================================================================
 * ROS ADAPTER - canonical JSON <-> REST/JSON
 * =============================================================================
 *
 * Calls the Route Optimisation System's REST API with `fetch` and an API key.
 *
 *   orderId                                -> reference
 *   deliveryAddress.latitude/longitude     -> destination.lat/lng (fallback 6.93, 79.87)
 *   deliveryAddress.street + city          -> destination.label
 *   items.length                           -> parcelCount
 *   routeId / eta / legs                   -> rosRouteId / estimatedDeliveryTime / optimizedRoute.waypoints
 *   distanceKm / durationMin               -> optimizedRoute.totalDistance / totalDuration
 *
 * Status mapping: 2xx success; 404 on DELETE is success (already gone);
 * other 4xx -> ROS_REJECTED:<status>; 5xx/network -> ROS_UNAVAILABLE;
 * timeout -> ROS_TIMEOUT.
 * =============================================================================
 */

import { Logger } from '@nestjs/common';
import { transportFailure } from './adapter-error';
import {
  BaseReply,
  RosCancelRouteCommand,
  RosOptimizeRouteCommand,
  RosOptimizeRouteReply,
} from './commands';

export interface RosRestAdapterOptions {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}

interface RosPoint {
  lat: number;
  lng: number;
  label: string;
}

interface RosRoute {
  routeId: string;
  eta: string;
  legs: RosPoint[];
  distanceKm: number;
  durationMin: number;
}

/** Every route starts at the SwiftTrack warehouse in Colombo. */
export const WAREHOUSE: RosPoint = {
  lat: 6.9271,
  lng: 79.8612,
  label: 'SwiftTrack Warehouse, Colombo',
};

type RestResult =
  | { ok: true; status: number; json: unknown }
  | { ok: false; status?: number; error: string; message: string };

export class RosRestAdapter {
  private readonly logger = new Logger(RosRestAdapter.name);

  constructor(private readonly options: RosRestAdapterOptions) {}

  async optimizeRoute(
    cmd: RosOptimizeRouteCommand,
  ): Promise<RosOptimizeRouteReply> {
    const address = cmd.deliveryAddress ?? {};
    const request = {
      reference: cmd.orderId,
      origin: WAREHOUSE,
      destination: {
        lat: address.latitude ?? 6.93,
        lng: address.longitude ?? 79.87,
        label: [address.street, address.city || 'Colombo']
          .filter(Boolean)
          .join(', '),
      },
      parcelCount: cmd.items?.length ?? 0,
    };

    const result = await this.call('POST', '/api/v1/routes', request);
    if (!result.ok) {
      return { success: false, error: result.error, message: result.message };
    }

    const route = result.json as RosRoute | undefined;
    if (!route?.routeId || !Array.isArray(route.legs)) {
      return {
        success: false,
        error: 'ROS_BAD_RESPONSE',
        message: 'Route response missing routeId/legs',
      };
    }

    return {
      success: true,
      rosRouteId: route.routeId,
      estimatedDeliveryTime: route.eta,
      optimizedRoute: {
        waypoints: route.legs.map((leg) => ({
          lat: leg.lat,
          lng: leg.lng,
          address: leg.label,
        })),
        totalDistance: route.distanceKm,
        totalDuration: route.durationMin,
      },
      message: 'Route optimized via ROS REST API',
    };
  }

  async cancelRoute(cmd: RosCancelRouteCommand): Promise<BaseReply> {
    const routeId = encodeURIComponent(cmd.rosRouteId ?? '');
    const result = await this.call('DELETE', `/api/v1/routes/${routeId}`);

    if (result.ok) {
      return {
        success: true,
        message: 'Route cancelled in ROS (REST compensating transaction)',
      };
    }
    // Nothing to undo: compensation is idempotent.
    if (result.status === 404) {
      return {
        success: true,
        message: 'Route not present in ROS; nothing to cancel',
      };
    }
    return { success: false, error: result.error, message: result.message };
  }

  private async call(
    method: 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<RestResult> {
    const url = new URL(path, this.options.baseUrl).toString();
    const payload = body === undefined ? undefined : JSON.stringify(body);
    this.logger.debug(`→ ${method} ${url}${payload ? ` ${payload}` : ''}`);

    let status: number;
    let text: string;
    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-API-Key': this.options.apiKey,
        },
        body: payload,
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
      status = response.status;
      text = await response.text();
    } catch (err) {
      const failure = transportFailure('ROS', err);
      this.logger.warn(
        `✗ ${method} ${path}: ${failure.code} ${failure.message}`,
      );
      return { ok: false, error: failure.code, message: failure.message };
    }

    this.logger.debug(`← HTTP ${status}${text ? ` ${text}` : ''}`);

    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }

    if (status >= 200 && status < 300) {
      return { ok: true, status, json };
    }
    if (status >= 500) {
      return {
        ok: false,
        status,
        error: 'ROS_UNAVAILABLE',
        message: `ROS returned HTTP ${status}`,
      };
    }
    return {
      ok: false,
      status,
      error: `ROS_REJECTED:${status}`,
      message: `ROS rejected ${method} ${path}: ${(json as { error?: string } | undefined)?.error ?? `HTTP ${status}`}`,
    };
  }
}
