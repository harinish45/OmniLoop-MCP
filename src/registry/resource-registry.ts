/**
 * ResourceRegistry — federated map of all resources exposed by downstream servers.
 * Mirrors ToolRegistry structure but for MCP resources.
 */

import type { ResourceDefinition } from '../connectors/connector.js';
import { createLogger } from '../observability/logging.js';

const logger = createLogger('resource-registry');

export interface ResourceEntry {
  serverId: string;
  namespacedUri: string;
  originalUri: string;
  definition: ResourceDefinition;
}

export class ResourceRegistry {
  /** Key: "serverId::originalUri" */
  private readonly _entries = new Map<string, ResourceEntry>();

  registerServerResources(serverId: string, resources: ResourceDefinition[]): void {
    this.deregisterServer(serverId);

    for (const resource of resources) {
      const namespacedUri = `${serverId}::${resource.uri}`;
      this._entries.set(namespacedUri, {
        serverId,
        namespacedUri,
        originalUri: resource.uri,
        definition: resource
      });
    }

    logger.info({ serverId, count: resources.length }, 'Server resources registered');
  }

  deregisterServer(serverId: string): void {
    const prefix = `${serverId}::`;
    for (const key of [...this._entries.keys()]) {
      if (key.startsWith(prefix)) {
        this._entries.delete(key);
      }
    }
  }

  /**
   * Resolve a resource URI.
   * Accepts both namespaced ("serverId::uri") and original URI forms.
   * Original URI is only unambiguous if exactly one server exposes it.
   */
  resolve(uri: string): ResourceEntry | undefined {
    // Try namespaced lookup
    const direct = this._entries.get(uri);
    if (direct) return direct;

    // Try matching by original URI
    const matches = [...this._entries.values()].filter((e) => e.originalUri === uri);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      logger.warn({ uri, count: matches.length }, 'Ambiguous resource URI — use "serverId::uri" format');
    }
    return undefined;
  }

  listAll(): ResourceEntry[] {
    return [...this._entries.values()];
  }

  listForServer(serverId: string): ResourceEntry[] {
    const prefix = `${serverId}::`;
    return [...this._entries.values()].filter((e) => e.namespacedUri.startsWith(prefix));
  }
}
