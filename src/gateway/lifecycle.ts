/**
 * Lifecycle — startup and graceful shutdown for the OmniLoop Gateway.
 * Handles SIGINT/SIGTERM, drains in-flight calls, and disconnects all connectors.
 */

import type { ServerRegistry } from '../registry/server-registry.js';
import { createLogger } from '../observability/logging.js';
import { formatMetricsSummary } from '../observability/metrics.js';

const logger = createLogger('lifecycle');

export class GatewayLifecycle {
  private _shutdownRequested = false;

  constructor(private readonly serverRegistry: ServerRegistry) {}

  /** Register OS signal handlers for graceful shutdown */
  registerSignalHandlers(shutdownFn: () => Promise<void>): void {
    const handle = (signal: string) => async () => {
      if (this._shutdownRequested) {
        logger.warn({ signal }, 'Forced exit on second signal');
        process.exit(1);
      }
      this._shutdownRequested = true;
      logger.info({ signal }, 'Shutdown signal received — starting graceful shutdown');

      try {
        await shutdownFn();
        logger.info('Graceful shutdown complete');
        process.exit(0);
      } catch (err) {
        logger.error({ err }, 'Error during shutdown');
        process.exit(1);
      }
    };

    process.on('SIGINT', handle('SIGINT'));
    process.on('SIGTERM', handle('SIGTERM'));
  }

  /** Disconnect all registered downstream servers */
  async disconnectAll(): Promise<void> {
    const servers = this.serverRegistry.listAll();
    logger.info({ count: servers.length }, 'Disconnecting all downstream servers');

    this.serverRegistry.stopHealthPolling();

    await Promise.allSettled(
      servers.map(async ({ connector, serverId }) => {
        try {
          await connector.disconnect();
          logger.info({ serverId }, 'Server disconnected');
        } catch (err) {
          logger.error({ serverId, err }, 'Error disconnecting server');
        }
      })
    );
  }

  /** Log final metrics summary before exit */
  logFinalMetrics(): void {
    logger.info({ metrics: formatMetricsSummary() }, 'Final gateway metrics');
  }

  get isShuttingDown(): boolean {
    return this._shutdownRequested;
  }
}
