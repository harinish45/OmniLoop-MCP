/**
 * ResponseCache — TTL-based caching for read-only tool results.
 *
 * Only low-risk (read) tools are cached by default.
 * Cache key: SHA-256(serverId + toolName + sorted JSON args)
 *
 * Benefits:
 *   - Reduces downstream server load for repeated queries
 *   - Faster responses for common lookups (e.g. list_files, search_repos)
 *   - Configurable per-tool TTL
 */

import { createHash } from 'crypto';
import type { ToolResult } from '../connectors/connector.js';
import { createLogger } from '../observability/logging.js';

const logger = createLogger('response-cache');

export interface CacheConfig {
  enabled: boolean;
  /** Default TTL in seconds */
  defaultTtlSeconds: number;
  /** Maximum cached entries (LRU eviction) */
  maxEntries: number;
  /** Per-namespaced-tool TTL overrides */
  perToolTtlSeconds?: Record<string, number>;
}

export const DEFAULT_CACHE_CONFIG: CacheConfig = {
  enabled: true,
  defaultTtlSeconds: 60,
  maxEntries: 500
};

interface CacheEntry {
  result: ToolResult;
  expiresAt: number;
  hits: number;
  cachedAt: Date;
}

export class ResponseCache {
  private readonly _store = new Map<string, CacheEntry>();
  /** Reverse index: serverId -> Set of cache keys for O(1) invalidation */
  private readonly _serverIndex = new Map<string, Set<string>>();
  private readonly config: CacheConfig;

  /** Metrics */
  private _hits = 0;
  private _misses = 0;
  private _evictions = 0;

  constructor(config: Partial<CacheConfig> = {}) {
    this.config = { ...DEFAULT_CACHE_CONFIG, ...config };
  }

  /** Compute a deterministic cache key */
  static makeKey(serverId: string, toolName: string, args: unknown): string {
    const sorted = JSON.stringify(args, (_, v) =>
      v !== null && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort())
        : v
    );
    return createHash('sha256')
      .update(`${serverId}::${toolName}::${sorted}`)
      .digest('hex')
      .slice(0, 40);
  }

  /**
   * Look up a cached result.
   * @returns cached ToolResult or undefined on miss/expiry
   */
  get(key: string): ToolResult | undefined {
    if (!this.config.enabled) return undefined;

    const entry = this._store.get(key);
    if (!entry) {
      this._misses++;
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this._store.delete(key);
      this._misses++;
      return undefined;
    }

    entry.hits++;
    this._hits++;
    return entry.result;
  }

  /**
   * Store a result in the cache.
   * @param namespacedTool  Used for per-tool TTL lookup and server index
   */
  set(key: string, namespacedTool: string, result: ToolResult): void {
    if (!this.config.enabled) return;

    // Skip caching error results
    if (result.isError) return;

    // LRU eviction
    if (this._store.size >= this.config.maxEntries) {
      const oldest = this._store.keys().next().value;
      if (oldest) {
        this._deleteKey(oldest);
        this._evictions++;
      }
    }

    const ttl = (this.config.perToolTtlSeconds?.[namespacedTool] ?? this.config.defaultTtlSeconds) * 1000;
    this._store.set(key, {
      result,
      expiresAt: Date.now() + ttl,
      hits: 0,
      cachedAt: new Date()
    });

    // Maintain server index for granular invalidation
    const serverId = namespacedTool.split('.')[0];
    if (!serverId) return;
    if (!this._serverIndex.has(serverId)) {
      this._serverIndex.set(serverId, new Set());
    }
    this._serverIndex.get(serverId)!.add(key);

    logger.debug({ key, namespacedTool, ttlMs: ttl }, 'Response cached');
  }

  /** Internal helper to delete a key and clean up server index */
  private _deleteKey(key: string): void {
    // Find and remove from server index
    for (const [serverId, keys] of this._serverIndex.entries()) {
      if (keys.delete(key)) {
        if (keys.size === 0) {
          this._serverIndex.delete(serverId);
        }
        break;
      }
    }
    this._store.delete(key);
  }

  /** Invalidate all entries for a server (called when server reconnects) */
  invalidateServer(serverId: string): void {
    const keys = this._serverIndex.get(serverId);
    if (keys) {
      for (const key of keys) {
        this._store.delete(key);
      }
      this._serverIndex.delete(serverId);
      logger.info({ serverId, invalidated: keys.size }, 'Response cache invalidated for server');
    }
  }

  /** Remove all expired entries */
  gc(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this._store.entries()) {
      if (now > entry.expiresAt) {
        this._deleteKey(key);
        removed++;
      }
    }
    if (removed > 0) {
      logger.debug({ removed }, 'Response cache GC complete');
    }
    return removed;
  }

  get size(): number {
    return this._store.size;
  }

  get stats(): { hits: number; misses: number; evictions: number; size: number; hitRate: string } {
    const total = this._hits + this._misses;
    const hitRate = total > 0 ? `${((this._hits / total) * 100).toFixed(1)}%` : 'N/A';
    return { hits: this._hits, misses: this._misses, evictions: this._evictions, size: this._store.size, hitRate };
  }
}
