/**
 * In-Memory Storage Backend
 * Default implementation for single-instance deployments.
 */

import { StorageBackend, StorageConfig } from './backend.js';
import { createLogger } from '../observability/logging.js';

const logger = createLogger('storage:memory');

interface MemoryEntry {
  value: string;
  expiresAt: number;
}

export class InMemoryStorage implements StorageBackend {
  private readonly store = new Map<string, MemoryEntry>();
  private readonly prefix: string;
  private gcInterval: NodeJS.Timeout | undefined;

  constructor(config: StorageConfig = { type: 'memory' }) {
    this.prefix = config.redis?.keyPrefix ?? 'omniloop:';
    this.startGC();
  }

  private prefixed(key: string): string {
    return `${this.prefix}${key}`;
  }

  private startGC(): void {
    this.gcInterval = setInterval(() => this.gc(), 60_000);
    // Don't prevent process exit
    this.gcInterval.unref?.();
  }

  private gc(): void {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        removed++;
      }
    }
    if (removed > 0) {
      logger.debug({ removed }, 'In-memory storage GC complete');
    }
  }

  async get(key: string): Promise<string | null> {
    const entry = this.store.get(this.prefixed(key));
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.store.delete(this.prefixed(key));
      return null;
    }

    return entry.value;
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    this.store.set(this.prefixed(key), {
      value,
      expiresAt: Date.now() + ttlMs
    });
  }

  async del(key: string): Promise<void> {
    this.store.delete(this.prefixed(key));
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp('^' + this.prefix + pattern.replace(/\*/g, '.*') + '$');
    const result: string[] = [];
    for (const key of this.store.keys()) {
      if (regex.test(key)) {
        result.push(key.slice(this.prefix.length));
      }
    }
    return result;
  }

  async eval(_script: string, _keys: string[], _args: string[]): Promise<unknown> {
    // Lua scripts not supported in memory backend
    throw new Error('eval() not supported in InMemoryStorage');
  }

  async close(): Promise<void> {
    if (this.gcInterval) {
      clearInterval(this.gcInterval);
      this.gcInterval = undefined;
    }
    this.store.clear();
  }

  async ping(): Promise<boolean> {
    return true;
  }

  get size(): number {
    return this.store.size;
  }
}