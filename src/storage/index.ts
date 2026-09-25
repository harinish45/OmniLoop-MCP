/**
 * Storage Backend Factory
 * Creates the appropriate storage backend based on configuration.
 */

import { StorageBackend, StorageConfig, DEFAULT_STORAGE_CONFIG } from './backend.js';
import { InMemoryStorage } from './memory.js';
import { RedisStorage } from './redis.js';
import { createLogger } from '../observability/logging.js';

const logger = createLogger('storage:factory');

export async function createStorageBackend(config: StorageConfig = DEFAULT_STORAGE_CONFIG): Promise<StorageBackend> {
  const mergedConfig = { ...DEFAULT_STORAGE_CONFIG, ...config };

  switch (mergedConfig.type) {
    case 'redis': {
      const storage = new RedisStorage(mergedConfig);
      await storage.connect();
      logger.info('Redis storage backend initialized');
      return storage;
    }
    case 'memory':
    default: {
      const storage = new InMemoryStorage(mergedConfig);
      logger.info('In-memory storage backend initialized');
      return storage;
    }
  }
}

export { StorageBackend, StorageConfig, DEFAULT_STORAGE_CONFIG } from './backend.js';
export { InMemoryStorage } from './memory.js';
export { RedisStorage } from './redis.js';