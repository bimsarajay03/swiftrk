/**
 * =============================================================================
 * ADAPTER ERRORS
 * =============================================================================
 *
 * Adapters never throw back to the saga. Every transport or protocol problem is
 * turned into a canonical `{ success: false, error: <CODE>, message }` reply,
 * which the saga already treats as a failed step.
 *
 * Codes: <SYSTEM>_UNAVAILABLE, <SYSTEM>_TIMEOUT, plus protocol-specific codes
 * produced by each adapter (CMS_FAULT, OUT_OF_STOCK, ROS_REJECTED:<status>, ...).
 * =============================================================================
 */

export type LegacySystem = 'CMS' | 'WMS' | 'ROS';

/** Raised by the WMS adapter when a request gets no reply in time. */
export class AdapterTimeoutError extends Error {
  readonly name = 'TimeoutError';
}

/** Raised by the WMS adapter when the socket is down or drops mid-request. */
export class AdapterUnavailableError extends Error {
  readonly name = 'AdapterUnavailableError';
}

export interface TransportFailure {
  code: string;
  message: string;
}

/**
 * Maps a thrown transport error to a canonical code.
 * `fetch` aborted by `AbortSignal.timeout` throws a DOMException named
 * `TimeoutError`; network failures throw a TypeError whose `cause` carries the
 * socket error code (ECONNREFUSED, ENOTFOUND, ...).
 */
export function transportFailure(
  system: LegacySystem,
  err: unknown,
): TransportFailure {
  const e = err as {
    name?: string;
    code?: string;
    message?: string;
    cause?: { code?: string };
  };

  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
    return {
      code: `${system}_TIMEOUT`,
      message: `${system} did not respond in time`,
    };
  }

  const detail = e?.cause?.code || e?.code || e?.message || String(err);
  return {
    code: `${system}_UNAVAILABLE`,
    message: `${system} unreachable: ${detail}`,
  };
}
