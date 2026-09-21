/**
 * ToolRegistry — stores the federated, namespaced tool map.
 * All tools from all downstream servers are stored here under a
 * "serverId.toolName" namespace key to prevent collision.
 *
 * Collision rule: if two servers expose the same bare tool name,
 * both are stored namespaced — neither is accessible by bare name.
 * If only ONE server exposes a bare name, it can be accessed either way.
 */

import type { ToolDefinition } from '../connectors/connector.js';
import { createLogger } from '../observability/logging.js';

const logger = createLogger('tool-registry');

export interface RegistryEntry {
  serverId: string;
  /** Namespaced key, e.g. "github.search_repositories" */
  namespacedName: string;
  /** Bare name as reported by the downstream server */
  bareName: string;
  definition: ToolDefinition;
  registeredAt: Date;
}

export class ToolRegistry {
  /** Primary store: namespacedName → RegistryEntry */
  private readonly _entries = new Map<string, RegistryEntry>();

  /** Bare name → set of serverIds that expose it (for collision detection) */
  private readonly _bareNameIndex = new Map<string, Set<string>>();

  // ── Write operations ─────────────────────────────────────────────────────────

  /**
   * Register all tools from a server.
   * Replaces any previously registered tools for the same serverId.
   */
  registerServerTools(serverId: string, tools: ToolDefinition[]): void {
    // Remove any existing entries for this server
    this.deregisterServer(serverId);

    for (const tool of tools) {
      const namespacedName = `${serverId}.${tool.name}`;

      const entry: RegistryEntry = {
        serverId,
        namespacedName,
        bareName: tool.name,
        definition: tool,
        registeredAt: new Date()
      };

      this._entries.set(namespacedName, entry);

      // Update bare name index
      let serverSet = this._bareNameIndex.get(tool.name);
      if (!serverSet) {
        serverSet = new Set();
        this._bareNameIndex.set(tool.name, serverSet);
      }
      serverSet.add(serverId);

      logger.debug({ serverId, namespacedName }, 'Tool registered');
    }

    logger.info({ serverId, count: tools.length }, 'Server tools registered');
  }

  /** Remove all tools registered for a given server */
  deregisterServer(serverId: string): void {
    const toRemove: string[] = [];

    for (const [key, entry] of this._entries.entries()) {
      if (entry.serverId === serverId) {
        toRemove.push(key);
        const serverSet = this._bareNameIndex.get(entry.bareName);
        serverSet?.delete(serverId);
        if (serverSet?.size === 0) {
          this._bareNameIndex.delete(entry.bareName);
        }
      }
    }

    for (const key of toRemove) {
      this._entries.delete(key);
    }

    if (toRemove.length > 0) {
      logger.info({ serverId, removed: toRemove.length }, 'Server tools deregistered');
    }
  }

  // ── Read operations ──────────────────────────────────────────────────────────

  /**
   * Resolve a tool name to its registry entry.
   * Accepts:
   *  - Fully namespaced: "github.search_repositories"
   *  - Bare name (only if unambiguous): "search_repositories"
   */
  resolve(name: string): RegistryEntry | undefined {
    // Try namespaced lookup first
    const direct = this._entries.get(name);
    if (direct) return direct;

    // Try bare name lookup — only succeeds if exactly one server has this tool
    const serverSet = this._bareNameIndex.get(name);
    if (serverSet && serverSet.size === 1) {
      const serverId = [...serverSet][0];
      return this._entries.get(`${serverId}.${name}`);
    }

    if (serverSet && serverSet.size > 1) {
      logger.warn(
        { name, servers: [...serverSet] },
        'Ambiguous bare tool name — use "server.toolName" format'
      );
    }

    return undefined;
  }

  /**
   * List all registered tools for the gateway's tools/list response.
   * Tools are returned with their namespaced names as the canonical identifier.
   */
  listAll(): RegistryEntry[] {
    return [...this._entries.values()];
  }

  /** List tools for a specific server */
  listForServer(serverId: string): RegistryEntry[] {
    return [...this._entries.values()].filter((e) => e.serverId === serverId);
  }

  /** Total number of registered tools across all servers */
  get size(): number {
    return this._entries.size;
  }
}
