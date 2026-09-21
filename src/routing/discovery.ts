/**
 * Discovery — connects to a downstream server and populates all registries.
 * Called at startup for each configured server, and again whenever the server
 * sends a tools/list_changed notification.
 */

import type { MCPConnector } from '../connectors/connector.js';
import type { ToolRegistry } from '../registry/tool-registry.js';
import type { ResourceRegistry } from '../registry/resource-registry.js';
import type { PromptRegistry } from '../registry/prompt-registry.js';
import type { ServerRegistry } from '../registry/server-registry.js';
import { createLogger } from '../observability/logging.js';

const logger = createLogger('discovery');

export class DiscoveryService {
  constructor(
    private readonly serverRegistry: ServerRegistry,
    private readonly toolRegistry: ToolRegistry,
    private readonly resourceRegistry: ResourceRegistry,
    private readonly promptRegistry: PromptRegistry
  ) {}

  /**
   * Full discovery for a single server:
   * lists tools, resources, and prompts and populates all registries.
   */
  async discoverServer(connector: MCPConnector): Promise<void> {
    const { serverId } = connector;
    logger.info({ serverId }, 'Starting discovery');

    try {
      // Discover tools
      const tools = await connector.listTools();
      this.toolRegistry.registerServerTools(serverId, tools);
      logger.info({ serverId, toolCount: tools.length }, 'Tools discovered');

      // Discover resources (optional — servers may not implement this)
      const resources = await connector.listResources();
      this.resourceRegistry.registerServerResources(serverId, resources);
      if (resources.length > 0) {
        logger.info({ serverId, resourceCount: resources.length }, 'Resources discovered');
      }

      // Discover prompts (optional)
      const prompts = await connector.listPrompts();
      this.promptRegistry.registerServerPrompts(serverId, prompts);
      if (prompts.length > 0) {
        logger.info({ serverId, promptCount: prompts.length }, 'Prompts discovered');
      }

      this.serverRegistry.setStatus(serverId, 'healthy');
    } catch (err) {
      logger.error({ serverId, err }, 'Discovery failed');
      this.serverRegistry.setStatus(serverId, 'offline');
      throw err;
    }
  }

  /**
   * Re-run tool discovery for a server (triggered by tools/list_changed).
   * Does not affect resource or prompt registries.
   */
  async refreshTools(connector: MCPConnector): Promise<void> {
    const { serverId } = connector;
    logger.info({ serverId }, 'Refreshing tool list');

    try {
      const tools = await connector.listTools();
      this.toolRegistry.registerServerTools(serverId, tools);
      logger.info({ serverId, toolCount: tools.length }, 'Tool list refreshed');
    } catch (err) {
      logger.error({ serverId, err }, 'Tool refresh failed');
      throw err;
    }
  }

  /**
   * Run full discovery for ALL registered servers in parallel.
   * Individual server failures do not block discovery for other servers.
   */
  async discoverAll(): Promise<void> {
    const servers = this.serverRegistry.listAll();
    logger.info({ count: servers.length }, 'Running discovery for all servers');

    const results = await Promise.allSettled(
      servers.map(({ connector }) => this.discoverServer(connector))
    );

    const failed = results.filter((r) => r.status === 'rejected');
    if (failed.length > 0) {
      logger.warn({ failedCount: failed.length, total: servers.length }, 'Some servers failed discovery');
    }

    logger.info(
      { totalTools: this.toolRegistry.size },
      'Discovery complete'
    );
  }

  /** Remove a server from all registries when it goes offline */
  deregisterServer(serverId: string): void {
    this.toolRegistry.deregisterServer(serverId);
    this.resourceRegistry.deregisterServer(serverId);
    this.promptRegistry.deregisterServer(serverId);
    logger.info({ serverId }, 'Server removed from all registries');
  }
}
