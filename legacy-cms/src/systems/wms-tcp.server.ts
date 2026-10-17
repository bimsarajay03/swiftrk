/**
 * =============================================================================
 * WMS SIMULATOR - proprietary framed TCP
 * =============================================================================
 *
 * Stands in for the Warehouse Management System. Frame format and message
 * types are documented in ../protocols/wms-frame.ts.
 *
 * State is in memory (orderId -> package id):
 *   - CHK is idempotent on orderId: a repeat returns the same package.
 *   - REL / RSV for an unknown order return NAK NOT_FOUND.
 *
 * Out-of-stock rules:
 *   - any line with qty >= 100 is always out of stock (deterministic demos/tests);
 *   - otherwise random, with probability `oosRate` (default 0.1).
 * =============================================================================
 */

import * as net from 'net';
import { Logger } from '@nestjs/common';
import {
  FrameDecoder,
  WmsMessage,
  decodeBody,
  decodeItems,
  encodeMessage,
  escapeField,
  unescapeField,
} from '../protocols/wms-frame';
import { RunningServer, listen, randomInt } from './running-server';

export const ALWAYS_OUT_OF_STOCK_QTY = 100;

export interface WmsServerOptions {
  port?: number;
  oosRate?: number;
  random?: () => number;
}

export async function startWmsServer(
  options: WmsServerOptions = {},
): Promise<RunningServer> {
  const logger = new Logger('WMS-System');
  const oosRate = options.oosRate ?? 0.1;
  const random = options.random ?? Math.random;
  const packages = new Map<string, string>(); // orderId -> package id

  function handle(message: WmsMessage): Buffer {
    const { type, seq, fields } = message;
    const nak = (code: string, detail?: string) =>
      encodeMessage(
        'NAK',
        seq,
        detail === undefined ? [code] : [code, escapeField(detail)],
      );

    switch (type) {
      case 'PNG':
        return encodeMessage('PON', seq);

      case 'CHK': {
        const orderId = unescapeField(fields[0] ?? '');
        const items = decodeItems(fields[1] ?? '');
        if (!orderId || items.length === 0) return nak('BAD_REQUEST');

        const existing = packages.get(orderId);
        if (existing) {
          logger.log(
            `CHK ${orderId}: already held as ${existing} (idempotent replay)`,
          );
          return encodeMessage('ACK', seq, ['OK', escapeField(existing)]);
        }

        const short =
          items.find((i) => i.qty >= ALWAYS_OUT_OF_STOCK_QTY) ??
          (random() < oosRate ? items[0] : undefined);
        if (short) {
          logger.warn(
            `CHK ${orderId}: out of stock on ${short.sku} x${short.qty}`,
          );
          return nak('OUT_OF_STOCK', short.sku);
        }

        const packageId = `WMS-PKG-${randomInt(10000, random)}`;
        packages.set(orderId, packageId);
        logger.log(
          `CHK ${orderId}: ${items.length} lines held as ${packageId}`,
        );
        return encodeMessage('ACK', seq, ['OK', escapeField(packageId)]);
      }

      case 'RSV': {
        const orderId = unescapeField(fields[0] ?? '');
        if (!packages.has(orderId)) return nak('NOT_FOUND');
        logger.log(`RSV ${orderId}: reserved`);
        return encodeMessage('ACK', seq, ['OK']);
      }

      case 'REL': {
        const orderId = unescapeField(fields[0] ?? '');
        const packageId = unescapeField(fields[1] ?? '');
        if (packages.get(orderId) !== packageId) return nak('NOT_FOUND');
        packages.delete(orderId);
        logger.log(`REL ${orderId}: released ${packageId}`);
        return encodeMessage('ACK', seq, ['OK']);
      }

      default:
        return nak('BAD_REQUEST');
    }
  }

  const server = net.createServer((socket) => {
    const peer = `${socket.remoteAddress}:${socket.remotePort}`;
    const decoder = new FrameDecoder();
    logger.log(`Connection from ${peer}`);

    socket.on('data', (chunk) => {
      let frames: Buffer[];
      try {
        frames = decoder.push(chunk);
      } catch (err) {
        // The stream is out of sync; there is no safe way to find the next frame.
        logger.error(`Dropping ${peer}: ${(err as Error).message}`);
        socket.destroy();
        return;
      }

      for (const frame of frames) {
        let reply: Buffer;
        try {
          reply = handle(decodeBody(frame));
        } catch (err) {
          logger.warn(`Bad request from ${peer}: ${(err as Error).message}`);
          const seq = safeSeq(frame);
          reply = encodeMessage('NAK', seq, ['BAD_REQUEST']);
        }
        socket.write(reply);
      }
    });

    socket.on('error', (err) => logger.warn(`Socket ${peer}: ${err.message}`));
    socket.on('close', () => logger.log(`Connection from ${peer} closed`));
  });

  return listen(server, options.port ?? 0);
}

/** Best-effort SEQ from a frame that failed to decode, so the NAK can still be matched. */
function safeSeq(frame: Buffer): number {
  const seq = Number(frame.toString('utf8').split('|')[1]);
  return Number.isInteger(seq) && seq >= 0 ? seq : 0;
}
