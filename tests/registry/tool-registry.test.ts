/**
 * Unit tests for ToolRegistry — namespace resolution, collision detection,
 * server deregistration, and bare-name lookup.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry } from '../../src/registry/tool-registry.js';
import type { ToolDefinition } from '../../src/connectors/connector.js';

const makeTool = (name: string): ToolDefinition => ({
  name,
  description: `Tool ${name}`,
  inputSchema: { type: 'object' }
});

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  describe('registerServerTools', () => {
    it('registers tools under namespaced keys', () => {
      registry.registerServerTools('github', [makeTool('search_repos'), makeTool('create_issue')]);
      expect(registry.size).toBe(2);
    });

    it('replaces existing tools when re-registering same server', () => {
      registry.registerServerTools('github', [makeTool('search_repos'), makeTool('create_issue')]);
      registry.registerServerTools('github', [makeTool('search_repos')]);
      expect(registry.size).toBe(1);
    });

    it('handles multiple servers with different tool sets', () => {
      registry.registerServerTools('github', [makeTool('search_repos')]);
      registry.registerServerTools('filesystem', [makeTool('read_file'), makeTool('write_file')]);
      expect(registry.size).toBe(3);
    });
  });

  describe('resolve', () => {
    beforeEach(() => {
      registry.registerServerTools('github', [makeTool('search_repos'), makeTool('read_file')]);
      registry.registerServerTools('filesystem', [makeTool('read_file'), makeTool('write_file')]);
    });

    it('resolves fully namespaced names', () => {
      const entry = registry.resolve('github.search_repos');
      expect(entry).toBeDefined();
      expect(entry?.serverId).toBe('github');
      expect(entry?.bareName).toBe('search_repos');
    });

    it('resolves unambiguous bare names', () => {
      const entry = registry.resolve('write_file');
      expect(entry).toBeDefined();
      expect(entry?.serverId).toBe('filesystem');
    });

    it('returns undefined for ambiguous bare names (collision)', () => {
      // read_file exists on both github and filesystem
      const entry = registry.resolve('read_file');
      expect(entry).toBeUndefined();
    });

    it('returns undefined for unknown tool names', () => {
      expect(registry.resolve('nonexistent_tool')).toBeUndefined();
    });

    it('collision resolves correctly via namespace', () => {
      const githubEntry = registry.resolve('github.read_file');
      const fsEntry = registry.resolve('filesystem.read_file');
      expect(githubEntry?.serverId).toBe('github');
      expect(fsEntry?.serverId).toBe('filesystem');
    });
  });

  describe('deregisterServer', () => {
    it('removes all tools for the given server', () => {
      registry.registerServerTools('github', [makeTool('search_repos')]);
      registry.registerServerTools('filesystem', [makeTool('read_file')]);
      registry.deregisterServer('github');
      expect(registry.size).toBe(1);
      expect(registry.resolve('github.search_repos')).toBeUndefined();
    });

    it('re-enables bare name resolution after collision is removed', () => {
      registry.registerServerTools('github', [makeTool('read_file')]);
      registry.registerServerTools('filesystem', [makeTool('read_file')]);
      // Ambiguous now
      expect(registry.resolve('read_file')).toBeUndefined();
      // Remove one server
      registry.deregisterServer('github');
      // Now unambiguous
      expect(registry.resolve('read_file')?.serverId).toBe('filesystem');
    });
  });

  describe('listAll / listForServer', () => {
    it('lists all tools across servers', () => {
      registry.registerServerTools('github', [makeTool('search_repos')]);
      registry.registerServerTools('filesystem', [makeTool('read_file')]);
      expect(registry.listAll()).toHaveLength(2);
    });

    it('lists only tools for a specific server', () => {
      registry.registerServerTools('github', [makeTool('search_repos'), makeTool('create_issue')]);
      registry.registerServerTools('filesystem', [makeTool('read_file')]);
      expect(registry.listForServer('github')).toHaveLength(2);
      expect(registry.listForServer('filesystem')).toHaveLength(1);
    });
  });
});
