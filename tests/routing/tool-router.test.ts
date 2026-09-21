/**
 * Unit tests for ToolRouter — namespaced routing, bare name routing,
 * offline server handling, and metric recording.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolRouter } from '../../src/routing/tool-router.js';
import { ToolRegistry } from '../../src/registry/tool-registry.js';
import { ServerRegistry } from '../../src/registry/server-registry.js';
import type { MCPConnector, ToolResult } from '../../src/connectors/connector.js';

const successResult: ToolResult = {
  content: [{ type: 'text', text: 'result' }],
  isError: false
};

function mockConnector(serverId: string, callResult: ToolResult = successResult): MCPConnector {
  return {
    serverId,
    connect: vi.fn(),
    disconnect: vi.fn(),
    listTools: vi.fn().mockResolvedValue([]),
    callTool: vi.fn().mockResolvedValue(callResult),
    listResources: vi.fn().mockResolvedValue([]),
    readResource: vi.fn(),
    listPrompts: vi.fn().mockResolvedValue([]),
    health: vi.fn().mockResolvedValue({ serverId, status: 'healthy', checkedAt: new Date() })
  };
}

describe('ToolRouter', () => {
  let toolRegistry: ToolRegistry;
  let serverRegistry: ServerRegistry;

  beforeEach(() => {
    toolRegistry = new ToolRegistry();
    serverRegistry = new ServerRegistry();
  });

  it('routes namespaced tool call to correct connector', async () => {
    const connector = mockConnector('github');
    serverRegistry.register(connector);
    serverRegistry.setStatus('github', 'healthy');
    toolRegistry.registerServerTools('github', [
      { name: 'search_repos', description: '', inputSchema: { type: 'object' } }
    ]);

    const router = new ToolRouter(toolRegistry, serverRegistry);
    const result = await router.route('github.search_repos', { query: 'test' });

    expect(result).toEqual(successResult);
    expect(connector.callTool).toHaveBeenCalledWith('search_repos', { query: 'test' });
  });

  it('throws when tool is not found in registry', async () => {
    const router = new ToolRouter(toolRegistry, serverRegistry);
    await expect(router.route('github.nonexistent', {})).rejects.toThrow('not found');
  });

  it('throws when target server is offline', async () => {
    const connector = mockConnector('github');
    serverRegistry.register(connector);
    serverRegistry.setStatus('github', 'offline');
    toolRegistry.registerServerTools('github', [
      { name: 'search_repos', description: '', inputSchema: { type: 'object' } }
    ]);

    const router = new ToolRouter(toolRegistry, serverRegistry);
    await expect(router.route('github.search_repos', {})).rejects.toThrow('offline');
  });

  it('strips namespace before forwarding bare name to connector', async () => {
    const connector = mockConnector('filesystem');
    serverRegistry.register(connector);
    serverRegistry.setStatus('filesystem', 'healthy');
    toolRegistry.registerServerTools('filesystem', [
      { name: 'read_file', description: '', inputSchema: { type: 'object' } }
    ]);

    const router = new ToolRouter(toolRegistry, serverRegistry);
    await router.route('filesystem.read_file', { path: '/tmp/test.txt' });

    // Connector receives the BARE name, not the namespaced one
    expect(connector.callTool).toHaveBeenCalledWith('read_file', { path: '/tmp/test.txt' });
  });
});
