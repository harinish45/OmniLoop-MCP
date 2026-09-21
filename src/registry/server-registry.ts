/**
 * ServerRegistry — tracks all connected downstream MCP servers,
 * their connectors, health status, and emits lifecycle events.
 */

import type { MCPConnector, HealthReport } from '../connectors/connector.js';
import { createLogger } from '../observability/logging.js';
import { recordHealthCheck } from '../observability/metrics.js';

const logger = createLogger('server-registry');

export type ServerStatus = 'connecting' | 'healthy' | 'degraded' | 'offline';

export interface ServerEntry {
  serverId: string;
  connector: MCPConnector;
  status: ServerStatus;
  lastHealthReport?: HealthReport;
  connectedAt?: Date;
}

type ServerEventListener = (serverId: string, status: ServerStatus) => void;

export class ServerRegistry {
  private readonly _servers = new Map<string, ServerEntry>();
  private readonly _listeners = new Set<ServerEventListener>();
  private _healthInterval?: ReturnType<typeof setInterval>;

  // ── Registration ─────────────────────────────────────────────────────────────

  register(connector: MCPConnector): void {
    if (this._servers.has(connector.serverId)) {
      throw new Error(`Server "${connector.serverId}" is already registered`);
    }
    this._servers.set(connector.serverId, {
      serverId: connector.serverId,
      connector,
      status: 'connecting'
    });
    logger.info({ serverId: connector.serverId }, 'Server registered');
  }

  deregister(serverId: string): void {
    this._servers.delete(serverId);
    logger.info({ serverId }, 'Server deregistered');
  }

  // ── Lookup ───────────────────────────────────────────────────────────────────

  get(serverId: string): ServerEntry | undefined {
    return this._servers.get(serverId);
  }

  getConnector(serverId: string): MCPConnector {
    const entry = this._servers.get(serverId);
    if (!entry) {
      throw new Error(`Server "${serverId}" not found in registry`);
    }
    if (entry.status === 'offline') {
      throw new Error(`Server "${serverId}" is currently offline`);
    }
    return entry.connector;
  }

  listAll(): ServerEntry[] {
    return [...this._servers.values()];
  }

  get size(): number {
    return this._servers.size;
  }

  // ── Status updates ───────────────────────────────────────────────────────────

  setStatus(serverId: string, status: ServerStatus): void {
    const entry = this._servers.get(serverId);
    if (!entry) return;

    const prevStatus = entry.status;
    entry.status = status;

    if (status === 'healthy' && !entry.connectedAt) {
      entry.connectedAt = new Date();
    }

    if (prevStatus !== status) {
      logger.info({ serverId, prevStatus, newStatus: status }, 'Server status changed');
      for (const listener of this._listeners) {
        try {
          listener(serverId, status);
        } catch (err) {
          logger.error({ err }, 'Error in server status listener');
        }
      }
    }
  }

  onStatusChange(listener: ServerEventListener): () => void {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  // ── Health polling ───────────────────────────────────────────────────────────

  startHealthPolling(intervalMs = 30_000): void {
    if (this._healthInterval) {
      clearInterval(this._healthInterval);
    }
    this._healthInterval = setInterval(() => {
      void this.runHealthChecks();
    }, intervalMs);

    // Unref so the interval doesn't block process exit
    if (this._healthInterval.unref) {
      this._healthInterval.unref();
    }

    logger.info({ intervalMs }, 'Health polling started');
  }

  stopHealthPolling(): void {
    if (this._healthInterval) {
      clearInterval(this._healthInterval);
      this._healthInterval = undefined;
    }
  }

  async runHealthChecks(): Promise<void> {
    const checks = [...this._servers.values()].map(async (entry) => {
      try {
        const report = await entry.connector.health();
        entry.lastHealthReport = report;
        const healthy = report.status === 'healthy';
        recordHealthCheck(entry.serverId, healthy);

        const newStatus: ServerStatus = healthy
          ? 'healthy'
          : report.status === 'degraded'
          ? 'degraded'
          : 'offline';

        this.setStatus(entry.serverId, newStatus);
      } catch (err) {
        recordHealthCheck(entry.serverId, false);
        this.setStatus(entry.serverId, 'offline');
        logger.error({ serverId: entry.serverId, err }, 'Health check threw');
      }
    });

    await Promise.allSettled(checks);
  }
}
