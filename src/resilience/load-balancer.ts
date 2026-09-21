/**
 * LoadBalancer — multi-server routing with health-aware round-robin and automatic failover.
 */

import type { MCPConnector } from '../connectors/connector.js';
import type { ServerRegistry } from '../registry/server-registry.js';
import { createLogger } from '../observability/logging.js';

const logger = createLogger('load-balancer');

export type BalancingStrategy = 'round-robin' | 'failover' | 'random';

export interface ServerPool {
  poolName: string;
  strategy: BalancingStrategy;
  serverIds: string[];
}

export class ServerLoadBalancer {
  private readonly pools = new Map<string, ServerPool>();
  private readonly roundRobinIndices = new Map<string, number>();

  constructor(private readonly serverRegistry: ServerRegistry) {}

  /** Register a named server pool */
  registerPool(pool: ServerPool): void {
    this.pools.set(pool.poolName, pool);
    this.roundRobinIndices.set(pool.poolName, 0);
    logger.info({ poolName: pool.poolName, servers: pool.serverIds }, 'Server pool registered');
  }

  /**
   * Select an available, healthy connector for a given pool or serverId.
   * If serverId is a pool name, routes according to pool strategy.
   * If serverId is a single server, returns that server connector directly.
   */
  selectConnector(targetId: string): MCPConnector {
    const pool = this.pools.get(targetId);
    if (!pool) {
      return this.serverRegistry.getConnector(targetId);
    }

    const availableServers = pool.serverIds.filter((id) => {
      const entry = this.serverRegistry.get(id);
      return entry && entry.status === 'healthy';
    });

    if (availableServers.length === 0) {
      // Fallback: try any server that isn't explicitly offline
      const nonOffline = pool.serverIds.filter((id) => {
        const entry = this.serverRegistry.get(id);
        return entry && entry.status !== 'offline';
      });
      if (nonOffline.length > 0) {
        return this.serverRegistry.getConnector(nonOffline[0]!);
      }
      throw new Error(`All servers in pool '${pool.poolName}' are unavailable or offline`);
    }

    if (pool.strategy === 'failover') {
      // Always pick the first healthy primary
      return this.serverRegistry.getConnector(availableServers[0]!);
    }

    if (pool.strategy === 'random') {
      const idx = Math.floor(Math.random() * availableServers.length);
      return this.serverRegistry.getConnector(availableServers[idx]!);
    }

    // Default: Round Robin
    const currentIndex = this.roundRobinIndices.get(pool.poolName) ?? 0;
    const selectedServer = availableServers[currentIndex % availableServers.length]!;
    this.roundRobinIndices.set(pool.poolName, (currentIndex + 1) % availableServers.length);

    return this.serverRegistry.getConnector(selectedServer);
  }
}
