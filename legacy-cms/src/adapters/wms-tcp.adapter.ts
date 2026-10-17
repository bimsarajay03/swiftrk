/**
 * =============================================================================
 * WMS ADAPTER - canonical JSON <-> framed TCP
 * =============================================================================
 *
 * Keeps one persistent TCP connection to the WMS and multiplexes requests on
 * it, matching replies to requests by SEQ (see ../protocols/wms-frame.ts).
 *
 * Connection lifecycle:
 *   - Opened lazily on first use. main.ts builds the module once per queue,
 *     so connecting in the constructor would open three sockets.
 *   - On close/error every pending request fails with WMS_UNAVAILABLE and a
 *     reconnect is scheduled with backoff (0.5 s, 1 s, 2 s ... capped at 10 s).
 *   - Requests are never retried automatically: a CHK may already have been
 *     applied before the socket dropped. The saga decides what to do.
 *
 *   wms_check_stock {orderId, items}   -> CHK|seq|orderId|productId:quantity,...
 *   ACK|seq|OK|pkg                     -> { success, inStock: true, wmsPackageId }
 *   NAK|seq|OUT_OF_STOCK|sku           -> { success: false, inStock: false, error: OUT_OF_STOCK }
 *   wms_release_stock {orderId, pkg}   -> REL|seq|orderId|pkg
 * =============================================================================
 */

import * as net from 'net';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
  FrameDecoder,
  WmsMessage,
  WmsMessageType,
  decodeBody,
  encodeItems,
  encodeMessage,
  escapeField,
  unescapeField,
} from '../protocols/wms-frame';
import {
  AdapterTimeoutError,
  AdapterUnavailableError,
  transportFailure,
} from './adapter-error';
import {
  BaseReply,
  WmsCheckStockCommand,
  WmsCheckStockReply,
  WmsReleaseStockCommand,
  WmsReserveStockCommand,
} from './commands';

export interface WmsTcpAdapterOptions {
  host: string;
  port: number;
  timeoutMs: number;
}

interface PendingRequest {
  resolve: (message: WmsMessage) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

const MIN_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 10000;
const MAX_SEQ = 2 ** 31 - 1;

export class WmsTcpAdapter implements OnModuleDestroy {
  private readonly logger = new Logger(WmsTcpAdapter.name);
  private readonly pending = new Map<number, PendingRequest>();

  private socket?: net.Socket;
  private connecting?: Promise<net.Socket>;
  private reconnectTimer?: NodeJS.Timeout;
  private backoffMs = MIN_BACKOFF_MS;
  private seq = 0;
  private closed = false;

  constructor(private readonly options: WmsTcpAdapterOptions) {}

  // --- Canonical operations --------------------------------------------------

  async checkStock(cmd: WmsCheckStockCommand): Promise<WmsCheckStockReply> {
    const items = (cmd.items ?? []).map((i) => ({
      sku: i.productId,
      qty: i.quantity,
    }));

    let reply: WmsMessage;
    try {
      reply = await this.request('CHK', [
        escapeField(cmd.orderId),
        encodeItems(items),
      ]);
    } catch (err) {
      const failure = transportFailure('WMS', err);
      return {
        success: false,
        inStock: false,
        error: failure.code,
        message: failure.message,
      };
    }

    if (reply.type === 'ACK' && reply.fields[0] === 'OK' && reply.fields[1]) {
      return {
        success: true,
        inStock: true,
        wmsPackageId: unescapeField(reply.fields[1]),
        message: 'Stock available (WMS TCP)',
      };
    }

    const { code, detail } = this.nakOf(reply);
    if (code === 'OUT_OF_STOCK') {
      return {
        success: false,
        inStock: false,
        error: 'OUT_OF_STOCK',
        message: `Out of stock: ${detail ?? 'unknown item'}`,
      };
    }
    return {
      success: false,
      inStock: false,
      error: `WMS_${code}`,
      message: `WMS rejected CHK: ${code}`,
    };
  }

  async reserveStock(cmd: WmsReserveStockCommand): Promise<BaseReply> {
    return this.simpleCommand('RSV', [escapeField(cmd.orderId)], {
      ok: 'Stock reserved in WMS (TCP)',
    });
  }

  async releaseStock(cmd: WmsReleaseStockCommand): Promise<BaseReply> {
    return this.simpleCommand(
      'REL',
      [escapeField(cmd.orderId), escapeField(cmd.wmsPackageId ?? '')],
      {
        ok: 'Stock released in WMS (TCP compensating transaction)',
        // Nothing to undo: compensation is idempotent.
        notFound: 'Package not held in WMS; nothing to release',
      },
    );
  }

  onModuleDestroy(): void {
    this.close();
  }

  /** Stops reconnecting, fails pending requests and closes the socket. */
  close(): void {
    this.closed = true;
    clearTimeout(this.reconnectTimer);
    this.failAll(new AdapterUnavailableError('adapter closed'));
    this.socket?.destroy();
    this.socket = undefined;
  }

  // --- Request / reply -------------------------------------------------------

  private async simpleCommand(
    type: WmsMessageType,
    fields: string[],
    messages: { ok: string; notFound?: string },
  ): Promise<BaseReply> {
    let reply: WmsMessage;
    try {
      reply = await this.request(type, fields);
    } catch (err) {
      const failure = transportFailure('WMS', err);
      return { success: false, error: failure.code, message: failure.message };
    }

    if (reply.type === 'ACK' && reply.fields[0] === 'OK') {
      return { success: true, message: messages.ok };
    }

    const { code } = this.nakOf(reply);
    if (code === 'NOT_FOUND' && messages.notFound) {
      return { success: true, message: messages.notFound };
    }
    return {
      success: false,
      error: `WMS_${code}`,
      message: `WMS rejected ${type}: ${code}`,
    };
  }

  private nakOf(reply: WmsMessage): { code: string; detail?: string } {
    if (reply.type !== 'NAK') return { code: 'BAD_RESPONSE' };
    return {
      code: reply.fields[0] || 'ERROR',
      detail:
        reply.fields[1] !== undefined
          ? unescapeField(reply.fields[1])
          : undefined,
    };
  }

  private async request(
    type: WmsMessageType,
    fields: string[],
  ): Promise<WmsMessage> {
    const socket = await this.ensureConnected();
    const seq = this.nextSeq();
    const frame = encodeMessage(type, seq, fields);

    return new Promise<WmsMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(seq);
        reject(
          new AdapterTimeoutError(
            `No reply to ${type} #${seq} within ${this.options.timeoutMs} ms`,
          ),
        );
      }, this.options.timeoutMs);

      this.pending.set(seq, { resolve, reject, timer });
      this.logger.debug(`→ ${frame.subarray(4).toString('utf8')}`);
      socket.write(frame);
    });
  }

  private nextSeq(): number {
    this.seq = this.seq >= MAX_SEQ ? 1 : this.seq + 1;
    return this.seq;
  }

  // --- Connection management -------------------------------------------------

  private ensureConnected(): Promise<net.Socket> {
    if (this.closed) {
      return Promise.reject(new AdapterUnavailableError('adapter closed'));
    }
    if (this.socket && !this.socket.destroyed) {
      return Promise.resolve(this.socket);
    }
    if (!this.connecting) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
      this.connecting = this.openSocket().finally(() => {
        this.connecting = undefined;
      });
    }
    return this.connecting;
  }

  private openSocket(): Promise<net.Socket> {
    const { host, port, timeoutMs } = this.options;

    return new Promise<net.Socket>((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      const decoder = new FrameDecoder();
      let connected = false;
      let lastError: Error | undefined;

      const connectTimer = setTimeout(() => {
        socket.destroy(
          new AdapterTimeoutError(`connect to ${host}:${port} timed out`),
        );
      }, timeoutMs);

      socket.once('connect', () => {
        clearTimeout(connectTimer);
        if (this.closed) {
          socket.destroy();
          return;
        }
        connected = true;
        this.socket = socket;
        this.backoffMs = MIN_BACKOFF_MS;
        this.logger.log(`Connected to WMS at ${host}:${port}`);
        resolve(socket);
      });

      socket.on('data', (chunk) => this.onData(decoder, socket, chunk));

      socket.on('error', (err) => {
        lastError = err;
      });

      socket.on('close', () => {
        clearTimeout(connectTimer);

        if (!connected) {
          const err = lastError as (Error & { code?: string }) | undefined;
          this.logger.warn(
            `Cannot reach WMS at ${host}:${port}: ${err?.code ?? err?.message ?? 'closed'}`,
          );
          reject(err ?? new AdapterUnavailableError('connection closed'));
        } else {
          this.logger.warn(
            `Connection to WMS lost${lastError ? `: ${lastError.message}` : ''}`,
          );
          if (this.socket === socket) this.socket = undefined;
          this.failAll(new AdapterUnavailableError('connection to WMS lost'));
        }

        this.scheduleReconnect();
      });
    });
  }

  private onData(
    decoder: FrameDecoder,
    socket: net.Socket,
    chunk: Buffer,
  ): void {
    let frames: Buffer[];
    try {
      frames = decoder.push(chunk);
    } catch (err) {
      this.logger.error(
        `Corrupt stream from WMS, dropping connection: ${(err as Error).message}`,
      );
      socket.destroy();
      return;
    }

    for (const frame of frames) {
      let message: WmsMessage;
      try {
        message = decodeBody(frame);
      } catch (err) {
        this.logger.warn(
          `Ignoring undecodable frame: ${(err as Error).message}`,
        );
        continue;
      }

      this.logger.debug(`← ${frame.toString('utf8')}`);
      const pending = this.pending.get(message.seq);
      if (!pending) {
        this.logger.warn(
          `Reply for unknown or timed-out request #${message.seq}`,
        );
        continue;
      }
      clearTimeout(pending.timer);
      this.pending.delete(message.seq);
      pending.resolve(message);
    }
  }

  private failAll(err: Error): void {
    for (const [seq, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this.pending.delete(seq);
    }
  }

  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;

    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    this.logger.log(`Reconnecting to WMS in ${delay} ms`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.ensureConnected().catch(() => {
        // Logged in openSocket; the close handler schedules the next attempt.
      });
    }, delay);
    this.reconnectTimer.unref();
  }
}
