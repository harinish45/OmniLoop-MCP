/**
 * Redis Storage Backend
 * Cluster-ready implementation for horizontal scaling.
 * Uses ioredis for connection pooling and cluster support.
 */

import { Redis } from 'ioredis';
import type { Redis as RedisClient } from 'ioredis';
import { StorageBackend, StorageConfig } from './backend.js';
import { createLogger } from '../observability/logging.js';

const logger = createLogger('storage:redis');

export class RedisStorage implements StorageBackend {
  private client: RedisClient | undefined;
  private readonly config: Required<StorageConfig['redis']>;
  private connected = false;

  constructor(config: StorageConfig) {
    this.config = {
      url: config.redis?.url ?? 'redis://127.0.0.1:6379',
      keyPrefix: config.redis?.keyPrefix ?? 'omniloop:',
      connectionPoolSize: config.redis?.connectionPoolSize ?? 10,
      maxRetries: config.redis?.maxRetries ?? 3,
      retryDelayMs: config.redis?.retryDelayMs ?? 100
    } as Required<StorageConfig['redis']>;
  }

  private prefixed(key: string): string {
    return `${this.config!.keyPrefix}${key}`;
  }

  async connect(): Promise<void> {
    if (this.connected && this.client) return;

    const client = new Redis(this.config!.url, {
      maxRetriesPerRequest: this.config!.maxRetries,
      retryStrategy: (times: number) => {
        if (times > this.config!.maxRetries) return null; // Stop retrying
        return this.config!.retryDelayMs;
      },
      lazyConnect: true,
      family: 4 // Force IPv4
    });

    this.client = client;

    client.on('error', (err: Error) => {
      logger.error({ err }, 'Redis connection error');
      this.connected = false;
    });

    client.on('connect', () => {
      logger.info('Redis connected');
      this.connected = true;
    });

    client.on('ready', () => {
      this.connected = true;
    });

    client.on('close', () => {
      this.connected = false;
    });

    await client.connect();
  }

  async get(key: string): Promise<string | null> {
    await this.ensureConnected();
    return this.client!.get(this.prefixed(key));
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    await this.ensureConnected();
    const ttlSeconds = Math.ceil(ttlMs / 1000);
    await this.client!.set(this.prefixed(key), value, 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.ensureConnected();
    await this.client!.del(this.prefixed(key));
  }

  async keys(pattern: string): Promise<string[]> {
    await this.ensureConnected();
    const fullPattern = this.prefixed(pattern);
    // Use SCAN for production safety (KEYS blocks Redis)
    const result: string[] = [];
    let cursor = '0';
    const client = this.client!;
    do {
      const [nextCursor, keys] = await client.scan(cursor, 'MATCH', fullPattern, 'COUNT', 100);
      cursor = nextCursor;
      result.push(...keys.map((k: string) => k.slice(this.config!.keyPrefix.length)));
    } while (cursor !== '0');
    return result;
  }

  async eval(script: string, keys: string[], args: string[]): Promise<unknown> {
    await this.ensureConnected();
    const prefixedKeys = keys.map((k) => this.prefixed(k));
    return this.client!.eval(script, prefixedKeys.length, ...prefixedKeys, ...args);
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.quit();
      this.client = undefined;
      this.connected = false;
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.ensureConnected();
      const result = await this.client!.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  private async ensureConnected(): Promise<void> {
    if (!this.connected || !this.client) {
      await this.connect();
    }
  }
}