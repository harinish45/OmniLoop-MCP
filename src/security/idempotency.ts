/**
 * IdempotencyGate — prevents double-execution of tool calls.
 *
 * LLM clients and retry loops sometimes call the same tool twice with
 * identical arguments. For destructive or expensive tools, this can be
 * catastrophic (double-delete, double-charge, etc.).
 *
 * Usage:
 *   - Client sends `_idempotencyKey` in tool arguments metadata, OR
 *   - Gateway auto-generates a key from hash(toolName + args) for read tools
 *
 * Behavior:
 *   - First call: execute and cache result for ttlSeconds
 *   - Subsequent calls with same key: return cached result immediately
 *   - Expired keys: treated as new calls
 */

import { createHash } from 'crypto';
import type { ToolResult } from '../connectors/connector.js';
import { createLogger } from '../observability/logging.js';

const logger = createLogger('idempotency');

export interface IdempotencyConfig {
  enabled: boolean;
  /** How long to cache a result for a given key */
  ttlSeconds: number;
  /** Maximum number of cached results (LRU eviction) */
  maxCacheSize: number;
}

export const DEFAULT_IDEMPOTENCY_CONFIG: IdempotencyConfig = {
  enabled: true,
  ttlSeconds: 300,
  maxCacheSize: 1000
};

interface CachedEntry {
  result: ToolResult;
  expiresAt: number;
  key: string;
  toolName: string;
  usedCount: number;
}

export class IdempotencyGate {
  /** Key → cached entry */
  private readonly _cache = new Map<string, CachedEntry>();
  private readonly config: IdempotencyConfig;

  constructor(config: Partial<IdempotencyConfig> = {}) {
    this.config = { ...DEFAULT_IDEMPOTENCY_CONFIG, ...config };
  }

  /**
   * Generate a deterministic idempotency key from tool name + args.
   * Use this for auto-keying read tools.
   */
  static generateKey(toolName: string, args: unknown): string {
    const payload = JSON.stringify({ toolName, args });
    return createHash('sha256').update(payload).digest('hex').slice(0, 32);
  }

  /**
   * Check if a result already exists for this idempotency key.
   * @returns cached ToolResult or undefined if not found/expired
   */
  check(key: string): ToolResult | undefined {
    if (!this.config.enabled) return undefined;

    const entry = this._cache.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.expiresAt) {
      this._cache.delete(key);
      return undefined;
    }

    entry.usedCount++;
    logger.debug({ key, toolName: entry.toolName, usedCount: entry.usedCount }, 'Idempotency cache hit');
    return entry.result;
  }

  /**
   * Store a result for a given idempotency key.
   * Enforces LRU eviction when cache is full.
   */
  store(key: string, toolName: string, result: ToolResult): void {
    if (!this.config.enabled) return;

    // LRU eviction: remove oldest entry if at capacity
    if (this._cache.size >= this.config.maxCacheSize) {
      const oldestKey = this._cache.keys().next().value;
      if (oldestKey) {
        this._cache.delete(oldestKey);
      }
    }

    this._cache.set(key, {
      result,
      expiresAt: Date.now() + this.config.ttlSeconds * 1000,
      key,
      toolName,
      usedCount: 0
    });

    logger.debug({ key, toolName }, 'Idempotency result stored');
  }

  /** Invalidate a specific key (e.g., after a mutation that affects this resource) */
  invalidate(key: string): void {
    this._cache.delete(key);
  }

  /** Clear all expired entries */
  gc(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this._cache.entries()) {
      if (now > entry.expiresAt) {
        this._cache.delete(key);
        removed++;
      }
    }
    return removed;
  }

  get size(): number {
    return this._cache.size;
  }
}
