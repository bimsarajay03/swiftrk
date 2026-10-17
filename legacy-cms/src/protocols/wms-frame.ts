/**
 * =============================================================================
 * WMS TCP FRAME CODEC
 * =============================================================================
 *
 * The WMS speaks a proprietary framed protocol over a raw TCP socket:
 *
 *   ┌────────────────┬──────────────────────────────────────┐
 *   │ length: u32 BE │ body: UTF-8, `|`-separated fields     │
 *   │ (body bytes)   │ TYPE|SEQ|field3|field4|...            │
 *   └────────────────┴──────────────────────────────────────┘
 *
 * SEQ is chosen by the client and echoed by the server, so many requests can
 * share one socket and replies are matched by SEQ, not arrival order.
 *
 * Requests                         Replies
 *   CHK|seq|orderId|sku:qty,...      ACK|seq|OK|pkgId    NAK|seq|OUT_OF_STOCK|sku
 *   RSV|seq|orderId                  ACK|seq|OK          NAK|seq|NOT_FOUND
 *   REL|seq|orderId|pkgId            ACK|seq|OK          NAK|seq|NOT_FOUND
 *   PNG|seq                          PON|seq
 *   (anything else)                  NAK|seq|BAD_REQUEST
 *
 * Field escaping: `%` → %25, `|` → %7C, `,` → %2C, `:` → %3A. Scalar fields go
 * through escapeField(); item lists through encodeItems(). encodeMessage()
 * itself does not escape, and rejects any field that still contains `|`.
 * =============================================================================
 */

export const HEADER_BYTES = 4;
export const MAX_BODY_BYTES = 64 * 1024;

export type WmsMessageType =
  | 'CHK'
  | 'RSV'
  | 'REL'
  | 'PNG'
  | 'ACK'
  | 'NAK'
  | 'PON';

export interface WmsMessage {
  type: string;
  seq: number;
  /** Fields after TYPE and SEQ, still escaped as they were on the wire. */
  fields: string[];
}

export interface WmsItem {
  sku: string;
  qty: number;
}

export class WmsProtocolError extends Error {
  readonly name = 'WmsProtocolError';
}

// --- Field escaping ----------------------------------------------------------

const RESERVED = /[%|,:]/g;

export function escapeField(value: string): string {
  return value.replace(
    RESERVED,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'),
  );
}

export function unescapeField(value: string): string {
  return value.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

export function encodeItems(items: WmsItem[]): string {
  return items
    .map((i) => `${escapeField(i.sku)}:${Math.trunc(i.qty)}`)
    .join(',');
}

/** Parses `sku:qty,sku:qty`. Throws WmsProtocolError on a malformed entry. */
export function decodeItems(field: string): WmsItem[] {
  if (field === '') return [];
  return field.split(',').map((entry) => {
    const [sku, qty, extra] = entry.split(':');
    const parsedQty = Number(qty);
    if (
      !sku ||
      extra !== undefined ||
      !Number.isInteger(parsedQty) ||
      parsedQty < 0
    ) {
      throw new WmsProtocolError(`Bad item entry "${entry}"`);
    }
    return { sku: unescapeField(sku), qty: parsedQty };
  });
}

// --- Frames ------------------------------------------------------------------

export function encodeMessage(
  type: WmsMessageType,
  seq: number,
  fields: string[] = [],
): Buffer {
  for (const field of fields) {
    if (field.includes('|')) {
      throw new WmsProtocolError(`Unescaped "|" in field "${field}"`);
    }
  }

  const body = Buffer.from([type, String(seq), ...fields].join('|'), 'utf8');
  if (body.length > MAX_BODY_BYTES) {
    throw new WmsProtocolError(
      `Frame body of ${body.length} bytes exceeds ${MAX_BODY_BYTES}`,
    );
  }

  const header = Buffer.alloc(HEADER_BYTES);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

/** Decodes one frame body (without its length header). */
export function decodeBody(body: Buffer): WmsMessage {
  const [type, seqText, ...fields] = body.toString('utf8').split('|');
  const seq = Number(seqText);
  if (!type || seqText === undefined || !Number.isInteger(seq) || seq < 0) {
    throw new WmsProtocolError(
      `Bad frame "${body.toString('utf8').slice(0, 80)}"`,
    );
  }
  return { type, seq, fields };
}

/**
 * Reassembles frames from a TCP byte stream. TCP has no message boundaries:
 * one `data` event may hold part of a frame, several frames, or a split
 * length header. push() buffers what it is given and returns every frame
 * body that is now complete.
 */
export class FrameDecoder {
  private buffer: Buffer = Buffer.alloc(0);

  constructor(private readonly maxBodyBytes = MAX_BODY_BYTES) {}

  push(chunk: Buffer): Buffer[] {
    this.buffer =
      this.buffer.length === 0 ? chunk : Buffer.concat([this.buffer, chunk]);

    const frames: Buffer[] = [];
    while (this.buffer.length >= HEADER_BYTES) {
      const length = this.buffer.readUInt32BE(0);
      if (length > this.maxBodyBytes) {
        throw new WmsProtocolError(
          `Frame length ${length} exceeds ${this.maxBodyBytes}`,
        );
      }
      if (this.buffer.length < HEADER_BYTES + length) break;

      frames.push(
        Buffer.from(this.buffer.subarray(HEADER_BYTES, HEADER_BYTES + length)),
      );
      this.buffer = this.buffer.subarray(HEADER_BYTES + length);
    }
    return frames;
  }

  /** Bytes received but not yet part of a complete frame. */
  get pendingBytes(): number {
    return this.buffer.length;
  }
}
