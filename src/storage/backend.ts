/**
 * Storage Backend Interface
 * Abstracts key-value storage for horizontal scaling support.
 * Implementations: InMemory (default), Redis (cluster-ready)
 */

export interface StorageBackend {
  /** Get a value by key */
  get(key: string): Promise<string | null>;

  /** Set a key-value pair with TTL in milliseconds */
  set(key: string, value: string, ttlMs: number): Promise<void>;

  /** Delete a key */
  del(key: string): Promise<void>;

  /** Find keys matching a pattern (for invalidation) */
  keys(pattern: string): Promise<string[]>;

  /** Execute a Lua script atomically (for complex operations) */
  eval(script: string, keys: string[], args: string[]): Promise<unknown>;

  /** Close the connection */
  close(): Promise<void>;

  /** Health check */
  ping(): Promise<boolean>;
}

export interface StorageConfig {
  type: 'memory' | 'redis';
  redis?: {
    url: string;
    keyPrefix: string;
    connectionPoolSize: number;
    maxRetries: number;
    retryDelayMs: number;
  };
}

export const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  type: 'memory',
  redis: {
    url: 'redis://127.0.0.1:6379',
    keyPrefix: 'omniloop:',
    connectionPoolSize: 10,
    maxRetries: 3,
    retryDelayMs: 100
  }
};