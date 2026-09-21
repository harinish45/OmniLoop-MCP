/**
 * PromptRegistry — federated map of all prompts exposed by downstream servers.
 */

import type { PromptDefinition } from '../connectors/connector.js';
import { createLogger } from '../observability/logging.js';

const logger = createLogger('prompt-registry');

export interface PromptEntry {
  serverId: string;
  namespacedName: string;
  bareName: string;
  definition: PromptDefinition;
}

export class PromptRegistry {
  private readonly _entries = new Map<string, PromptEntry>();
  private readonly _bareNameIndex = new Map<string, Set<string>>();

  registerServerPrompts(serverId: string, prompts: PromptDefinition[]): void {
    this.deregisterServer(serverId);

    for (const prompt of prompts) {
      const namespacedName = `${serverId}.${prompt.name}`;
      this._entries.set(namespacedName, {
        serverId,
        namespacedName,
        bareName: prompt.name,
        definition: prompt
      });

      let serverSet = this._bareNameIndex.get(prompt.name);
      if (!serverSet) {
        serverSet = new Set();
        this._bareNameIndex.set(prompt.name, serverSet);
      }
      serverSet.add(serverId);
    }

    logger.info({ serverId, count: prompts.length }, 'Server prompts registered');
  }

  deregisterServer(serverId: string): void {
    for (const [key, entry] of [...this._entries.entries()]) {
      if (entry.serverId === serverId) {
        this._entries.delete(key);
        const serverSet = this._bareNameIndex.get(entry.bareName);
        serverSet?.delete(serverId);
        if (serverSet?.size === 0) this._bareNameIndex.delete(entry.bareName);
      }
    }
  }

  resolve(name: string): PromptEntry | undefined {
    const direct = this._entries.get(name);
    if (direct) return direct;

    const serverSet = this._bareNameIndex.get(name);
    if (serverSet && serverSet.size === 1) {
      const serverId = [...serverSet][0];
      return this._entries.get(`${serverId}.${name}`);
    }
    return undefined;
  }

  listAll(): PromptEntry[] {
    return [...this._entries.values()];
  }
}
