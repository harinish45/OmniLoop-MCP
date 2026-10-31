import { describe, it, expect } from 'vitest';
import { OmniLoopMCPServer, type JsonRpcRequest } from '../../src/server.js';
import { ToolNotFoundError } from '../../src/errors/gateway-errors.js';

describe('OmniLoopMCPServer & JSON-RPC 2.0 Protocol', () => {
  const server = new OmniLoopMCPServer();

  describe('Tool Registry & Execution', () => {
    it('registers all core tools with input schemas', () => {
      const tools = server.listTools();
      const toolNames = tools.map((t) => t.name);

      expect(toolNames).toContain('get_system_metrics');
      expect(toolNames).toContain('execute_safe_diagnostic');
      expect(toolNames).toContain('web_search');
      expect(toolNames).toContain('read_file');
      expect(toolNames).toContain('write_file');
      expect(toolNames).toContain('http_request');
      expect(toolNames).toContain('run_code');
      expect(toolNames).toContain('database_query');
      expect(toolNames).toContain('slack_message');
      expect(toolNames).toContain('github_pr');

      for (const tool of tools) {
        expect(tool.description).toBeTruthy();
        expect(tool.inputSchema).toBeDefined();
        expect(tool.inputSchema.type).toBe('object');
      }
    });

    it('executes tool via handleCallTool', async () => {
      const metrics = (await server.handleCallTool('get_system_metrics')) as { platform: string };
      expect(metrics.platform).toBeDefined();

      const diag = (await server.handleCallTool('execute_safe_diagnostic', 'ping')) as { status: string };
      expect(diag.status).toBe('SUCCESS');

      const search = (await server.handleCallTool('web_search', {
        query: 'test query',
        provider: 'mock'
      })) as { query: string };
      expect(search.query).toBe('test query');
    });

    it('throws ToolNotFoundError on unmapped tool', async () => {
      await expect(server.handleCallTool('non_existent_tool')).rejects.toThrow(ToolNotFoundError);
    });
  });

  describe('Resources & Prompts Provider', () => {
    it('lists and reads system resources', () => {
      const resources = server.listResources();
      expect(resources.length).toBeGreaterThanOrEqual(3);
      expect(resources.some((r) => r.uri === 'system://info')).toBe(true);

      const infoResult = server.readResource('system://info');
      expect(infoResult.uri).toBe('system://info');
      expect(infoResult.contents[0]?.text).toContain('platform');
    });

    it('lists and gets prompt templates', () => {
      const prompts = server.listPrompts();
      expect(prompts.some((p) => p.name === 'code_review')).toBe(true);

      const reviewPrompt = server.getPrompt('code_review', {
        code: 'const x = 10;',
        language: 'typescript'
      });
      expect(reviewPrompt.messages[0]?.content.text).toContain('const x = 10;');
    });
  });

  describe('JSON-RPC 2.0 Dispatcher', () => {
    it('handles initialize handshake', async () => {
      const req: JsonRpcRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize'
      };

      const res = await server.handleJsonRpc(req);
      expect(res.jsonrpc).toBe('2.0');
      expect(res.id).toBe(1);
      const result = res.result as { serverInfo: { name: string } };
      expect(result.serverInfo.name).toBe('OmniLoop-MCP');
    });

    it('handles ping request', async () => {
      const res = await server.handleJsonRpc({
        jsonrpc: '2.0',
        id: 2,
        method: 'ping'
      });
      expect(res.id).toBe(2);
      expect(res.result).toEqual({});
    });

    it('handles tools/list request', async () => {
      const res = await server.handleJsonRpc({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/list'
      });

      expect(res.id).toBe(3);
      const result = res.result as { tools: Array<{ name: string }> };
      expect(Array.isArray(result.tools)).toBe(true);
      expect(result.tools.some((t) => t.name === 'database_query')).toBe(true);
    });

    it('handles tools/call for run_code', async () => {
      const res = await server.handleJsonRpc({
        jsonrpc: '2.0',
        id: 'call-1',
        method: 'tools/call',
        params: {
          name: 'run_code',
          arguments: {
            language: 'javascript',
            code: 'console.log("hello mcp"); 10 * 5;'
          }
        }
      });

      expect(res.id).toBe('call-1');
      const result = res.result as { content: Array<{ type: string; text: string }>; isError: boolean };
      expect(result.isError).toBe(false);
      expect(result.content[0]?.text).toContain('hello mcp');
      expect(result.content[0]?.text).toContain('50');
    });

    it('handles tools/call for database_query', async () => {
      const res = await server.handleJsonRpc({
        jsonrpc: '2.0',
        id: 'call-2',
        method: 'tools/call',
        params: {
          name: 'database_query',
          arguments: {
            query: "SELECT 42 as answer, 'universe' as scope;"
          }
        }
      });

      expect(res.id).toBe('call-2');
      const result = res.result as { content: Array<{ type: string; text: string }>; isError: boolean };
      expect(result.isError).toBe(false);
      expect(result.content[0]?.text).toContain('| answer | scope |');
      expect(result.content[0]?.text).toContain('| 42 | universe |');
    });

    it('returns error content when tool fails execution', async () => {
      const res = await server.handleJsonRpc({
        jsonrpc: '2.0',
        id: 'call-err',
        method: 'tools/call',
        params: {
          name: 'non_existent_tool',
          arguments: {}
        }
      });

      expect(res.id).toBe('call-err');
      const result = res.result as { content: Array<{ type: string; text: string }>; isError: boolean };
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain('not found');
    });

    it('returns JSON-RPC error -32602 when params.name is missing in tools/call', async () => {
      const res = await server.handleJsonRpc({
        jsonrpc: '2.0',
        id: 99,
        method: 'tools/call',
        params: {}
      });

      expect(res.error?.code).toBe(-32602);
      expect(res.error?.message).toContain('tool "name" string required');
    });

    it('returns JSON-RPC error -32601 on unknown method', async () => {
      const res = await server.handleJsonRpc({
        jsonrpc: '2.0',
        id: 100,
        method: 'custom/unknown_method'
      });

      expect(res.error?.code).toBe(-32601);
      expect(res.error?.message).toContain('Method not found');
    });

    it('returns JSON-RPC error -32700 on malformed JSON string', async () => {
      const res = await server.handleJsonRpc('{ malformed json string');
      expect(res.error?.code).toBe(-32700);
      expect(res.error?.message).toContain('Parse error');
    });

    it('handles resources/list and resources/read via JSON-RPC', async () => {
      const listRes = await server.handleJsonRpc({
        jsonrpc: '2.0',
        id: 'res-list',
        method: 'resources/list'
      });
      const listResult = listRes.result as { resources: Array<{ uri: string }> };
      expect(listResult.resources.length).toBeGreaterThan(0);

      const readRes = await server.handleJsonRpc({
        jsonrpc: '2.0',
        id: 'res-read',
        method: 'resources/read',
        params: { uri: 'system://metrics' }
      });
      const readResult = readRes.result as { contents: Array<{ text: string }> };
      expect(readResult.contents[0]?.text).toContain('uptimeSeconds');
    });

    it('handles prompts/list and prompts/get via JSON-RPC', async () => {
      const listRes = await server.handleJsonRpc({
        jsonrpc: '2.0',
        id: 'p-list',
        method: 'prompts/list'
      });
      const listResult = listRes.result as { prompts: Array<{ name: string }> };
      expect(listResult.prompts.length).toBeGreaterThan(0);

      const getRes = await server.handleJsonRpc({
        jsonrpc: '2.0',
        id: 'p-get',
        method: 'prompts/get',
        params: { name: 'diagnostic_check', arguments: { component: 'database' } }
      });
      const getResult = getRes.result as { messages: Array<{ content: { text: string } }> };
      expect(getResult.messages[0]?.content.text).toContain('database');
    });
  });

  describe('Connector Adapter (asConnector)', () => {
    it('creates an MCPConnector compliant adapter for federation', async () => {
      const connector = server.asConnector('internal-core');

      expect(connector.serverId).toBe('internal-core');
      await connector.connect();

      const tools = await connector.listTools();
      expect(tools.length).toBeGreaterThanOrEqual(10);

      const callResult = await connector.callTool('database_query', {
        query: 'SELECT 100 as count;'
      });
      expect(callResult.isError).toBe(false);
      expect(callResult.content[0]?.text).toContain('100');

      const health = await connector.health();
      expect(health.status).toBe('healthy');
      expect(health.serverId).toBe('internal-core');

      await connector.disconnect();
    });
  });
});
