/**
 * ToolRouter — resolves a tool name (namespaced or bare) to its connector
 * and forwards the call, recording metrics on the result.
 */

import type { ToolRegistry } from '../registry/tool-registry.js';
import type { ServerRegistry } from '../registry/server-registry.js';
import type { ToolResult } from '../connectors/connector.js';
import { createLogger } from '../observability/logging.js';
import { recordToolCall } from '../observability/metrics.js';

const logger = createLogger('tool-router');

export class ToolRouter {
  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly serverRegistry: ServerRegistry
  ) {}

  /**
   * Route a tool call to the correct downstream connector.
   *
   * @param namespacedName  Full "server.tool" key or unambiguous bare name
   * @param args            Validated arguments (policy layer runs before this)
   * @returns               ToolResult from the downstream server
   * @throws                If tool not found, server offline, or call fails
   */
  async route(namespacedName: string, args: unknown): Promise<ToolResult> {
    // Resolve tool in registry
    const entry = this.toolRegistry.resolve(namespacedName);
    if (!entry) {
      throw new Error(
        `Tool "${namespacedName}" not found. ` +
        `Use "server.toolName" format or check that the server is healthy.`
      );
    }

    const { serverId, bareName } = entry;
    logger.debug({ namespacedName, serverId, bareName }, 'Routing tool call');

    // Get connector (throws if server is offline)
    const connector = this.serverRegistry.getConnector(serverId);

    const start = Date.now();
    let success = false;

    try {
      const result = await connector.callTool(bareName, args);
      success = !(result.isError ?? false);
      return result;
    } catch (err) {
      logger.error({ namespacedName, serverId, err }, 'Tool call failed');
      throw err;
    } finally {
      recordToolCall(serverId, bareName, success, Date.now() - start);
    }
  }
}
