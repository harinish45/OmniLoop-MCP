/**
 * Trace ID propagation for the OmniLoop gateway.
 * Each inbound tool call gets a unique trace ID that flows through:
 *   gateway → policy → router → connector → downstream server → verifier
 * This enables correlating log lines across the full call chain.
 */

import { randomUUID } from 'crypto';

/** Generate a new RFC 4122 v4 trace ID */
export function newTraceId(): string {
  return randomUUID();
}

/**
 * Active trace context — uses AsyncLocalStorage when available (Node 12.17+).
 * Falls back to a module-level variable for environments that don't support it.
 */
import { AsyncLocalStorage } from 'async_hooks';

const _traceStorage = new AsyncLocalStorage<string>();

/**
 * Run a function within a trace context.
 * All log calls within the callback will automatically have the trace ID available.
 */
export function runWithTrace<T>(traceId: string, fn: () => Promise<T>): Promise<T> {
  return _traceStorage.run(traceId, fn);
}

/** Get the current trace ID from async context, or undefined if not in a trace */
export function currentTraceId(): string | undefined {
  return _traceStorage.getStore();
}
