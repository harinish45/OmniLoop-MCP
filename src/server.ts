import type {
  MCPConnector,
  ToolDefinition,
  ToolResult,
  ResourceDefinition,
  ResourceResult,
  PromptDefinition,
  HealthReport
} from './connectors/connector.js';
import {
  SystemMetricsTool,
  TaskRunnerTool,
  WebSearchTool,
  ReadFileTool,
  WriteFileTool,
  HttpRequestTool,
  RunCodeTool,
  DatabaseQueryTool,
  SlackMessageTool,
  GitHubPRTool
} from './tools/index.js';
import { SystemResourceProvider } from './resources/system_resources.js';
import { DiagnosticPromptProvider, type PromptGetResult } from './prompts/diagnostic_prompts.js';
import { ToolNotFoundError } from './errors/gateway-errors.js';
import { createLogger } from './observability/logging.js';

const logger = createLogger('mcp-server');

export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  readonly id?: string | number | null;
  readonly method: string;
  readonly params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: string | number | null;
  readonly result?: unknown;
  readonly error?: {
    readonly code: number;
    readonly message: string;
    readonly data?: unknown;
  };
}

export interface RegisteredToolItem {
  readonly definition: ToolDefinition;
  readonly handler: (args?: unknown) => Promise<unknown> | unknown;
}

export class OmniLoopMCPServer {
  private readonly toolMap = new Map<string, RegisteredToolItem>();

  constructor() {
    this.registerBuiltInTools();
  }

  // ── Tool Management ────────────────────────────────────────────────────────

  public registerTool(
    definition: ToolDefinition,
    handler: (args?: unknown) => Promise<unknown> | unknown
  ): void {
    this.toolMap.set(definition.name, { definition, handler });
    logger.debug({ tool: definition.name }, 'Registered MCP tool');
  }

  public listTools(): ToolDefinition[] {
    return Array.from(this.toolMap.values()).map((item) => item.definition);
  }

  public async handleCallTool(name: string, args?: unknown): Promise<unknown> {
    const item = this.toolMap.get(name);
    if (!item) {
      throw new ToolNotFoundError(name);
    }
    return item.handler(args);
  }

  // ── Resources & Prompts ─────────────────────────────────────────────────────

  public listResources(): ResourceDefinition[] {
    return SystemResourceProvider.listResources();
  }

  public readResource(uri: string): ResourceResult {
    return SystemResourceProvider.readResource(uri);
  }

  public listPrompts(): PromptDefinition[] {
    return DiagnosticPromptProvider.listPrompts();
  }

  public getPrompt(name: string, args?: Record<string, unknown>): PromptGetResult {
    return DiagnosticPromptProvider.getPrompt(name, args);
  }

  // ── JSON-RPC 2.0 Dispatcher ────────────────────────────────────────────────

  public async handleJsonRpc(rawInput: string | JsonRpcRequest): Promise<JsonRpcResponse> {
    let req: JsonRpcRequest;
    try {
      req = typeof rawInput === 'string' ? JSON.parse(rawInput) : rawInput;
    } catch {
      return this.buildJsonRpcError(null, -32700, 'Parse error: invalid JSON');
    }

    const id = req.id ?? null;

    if (!req || typeof req !== 'object' || req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
      return this.buildJsonRpcError(id, -32600, 'Invalid Request: expected JSON-RPC 2.0 object with method');
    }

    try {
      return await this.dispatchMethod(req, id);
    } catch (err) {
      const msg = (err as Error).message;
      logger.error({ method: req.method, error: msg }, 'Unhandled error in JSON-RPC dispatch');
      return this.buildJsonRpcError(id, -32603, `Internal error: ${msg}`);
    }
  }

  private async dispatchMethod(req: JsonRpcRequest, id: string | number | null): Promise<JsonRpcResponse> {
    switch (req.method) {
      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: { tools: this.listTools() }
        };

      case 'tools/call':
        return this.handleRpcToolCall(req.params, id);

      case 'resources/list':
        return {
          jsonrpc: '2.0',
          id,
          result: { resources: this.listResources() }
        };

      case 'resources/read':
        return this.handleRpcResourceRead(req.params, id);

      case 'prompts/list':
        return {
          jsonrpc: '2.0',
          id,
          result: { prompts: this.listPrompts() }
        };

      case 'prompts/get':
        return this.handleRpcPromptGet(req.params, id);

      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {}, resources: {}, prompts: {} },
            serverInfo: { name: 'OmniLoop-MCP', version: '2.0.0' }
          }
        };

      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };

      default:
        return this.buildJsonRpcError(id, -32601, `Method not found: "${req.method}"`);
    }
  }

  private async handleRpcToolCall(
    params: Record<string, unknown> | undefined,
    id: string | number | null
  ): Promise<JsonRpcResponse> {
    if (!params || typeof params['name'] !== 'string') {
      return this.buildJsonRpcError(id, -32602, 'Invalid params: tool "name" string required');
    }

    const toolName = params['name'];
    const toolArgs = params['arguments'] ?? params['args'] ?? {};

    try {
      const executionResult = await this.handleCallTool(toolName, toolArgs);
      const formattedContent = this.formatToToolResult(executionResult);

      return {
        jsonrpc: '2.0',
        id,
        result: formattedContent
      };
    } catch (err) {
      const errorMsg = (err as Error).message;
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: `Tool error: ${errorMsg}` }],
          isError: true
        }
      };
    }
  }

  private handleRpcResourceRead(
    params: Record<string, unknown> | undefined,
    id: string | number | null
  ): JsonRpcResponse {
    if (!params || typeof params['uri'] !== 'string') {
      return this.buildJsonRpcError(id, -32602, 'Invalid params: resource "uri" string required');
    }
    const uri = params['uri'];
    const result = this.readResource(uri);
    return { jsonrpc: '2.0', id, result };
  }

  private handleRpcPromptGet(
    params: Record<string, unknown> | undefined,
    id: string | number | null
  ): JsonRpcResponse {
    if (!params || typeof params['name'] !== 'string') {
      return this.buildJsonRpcError(id, -32602, 'Invalid params: prompt "name" string required');
    }
    const name = params['name'];
    const args = (params['arguments'] ?? {}) as Record<string, unknown>;
    const result = this.getPrompt(name, args);
    return { jsonrpc: '2.0', id, result };
  }

  private buildJsonRpcError(
    id: string | number | null,
    code: number,
    message: string,
    data?: unknown
  ): JsonRpcResponse {
    return {
      jsonrpc: '2.0',
      id,
      error: { code, message, ...(data !== undefined ? { data } : {}) }
    };
  }

  private formatToToolResult(val: unknown): ToolResult {
    if (val && typeof val === 'object' && Array.isArray((val as Record<string, unknown>)['content'])) {
      return val as ToolResult;
    }

    const text = typeof val === 'string' ? val : JSON.stringify(val, null, 2);
    return {
      content: [{ type: 'text', text }],
      isError: false
    };
  }

  // ── Connector Adapter ──────────────────────────────────────────────────────

  public asConnector(serverId = 'internal'): MCPConnector {
    return {
      serverId,
      connect: async () => undefined,
      disconnect: async () => undefined,
      listTools: async () => this.listTools(),
      callTool: async (name: string, args: unknown): Promise<ToolResult> => {
        const raw = await this.handleCallTool(name, args);
        return this.formatToToolResult(raw);
      },
      listResources: async () => this.listResources(),
      readResource: async (uri: string) => this.readResource(uri),
      listPrompts: async () => this.listPrompts(),
      health: async (): Promise<HealthReport> => ({
        serverId,
        status: 'healthy',
        latencyMs: 1,
        checkedAt: new Date()
      })
    };
  }

  // ── Internal Tool Registration ─────────────────────────────────────────────

  private registerBuiltInTools(): void {
    // 1. System Metrics Tool
    this.registerTool(
      {
        name: SystemMetricsTool.NAME,
        description: SystemMetricsTool.DESCRIPTION,
        inputSchema: { type: 'object', properties: {} }
      },
      () => SystemMetricsTool.execute()
    );

    // 2. Safe Diagnostic Task Runner
    this.registerTool(
      {
        name: TaskRunnerTool.NAME,
        description: TaskRunnerTool.DESCRIPTION,
        inputSchema: {
          type: 'object',
          properties: {
            taskType: {
              type: 'string',
              description: 'Diagnostic task to perform (ping, healthcheck, version).'
            }
          },
          required: ['taskType']
        }
      },
      (args: unknown) => {
        const taskType = typeof args === 'string'
          ? args
          : String((args as Record<string, unknown>)?.['taskType'] ?? 'healthcheck');
        return TaskRunnerTool.execute(taskType);
      }
    );

    // 3. Web Search Tool
    this.registerTool(
      {
        name: WebSearchTool.NAME,
        description: WebSearchTool.DESCRIPTION,
        inputSchema: WebSearchTool.INPUT_SCHEMA
      },
      (args) => WebSearchTool.execute(args)
    );

    // 4. Safe Read File Tool
    this.registerTool(
      {
        name: ReadFileTool.NAME,
        description: ReadFileTool.DESCRIPTION,
        inputSchema: ReadFileTool.INPUT_SCHEMA
      },
      (args) => ReadFileTool.execute(args)
    );

    // 5. Safe Write File Tool
    this.registerTool(
      {
        name: WriteFileTool.NAME,
        description: WriteFileTool.DESCRIPTION,
        inputSchema: WriteFileTool.INPUT_SCHEMA
      },
      (args) => WriteFileTool.execute(args)
    );

    // 6. General HTTP Request Client
    this.registerTool(
      {
        name: HttpRequestTool.NAME,
        description: HttpRequestTool.DESCRIPTION,
        inputSchema: HttpRequestTool.INPUT_SCHEMA
      },
      (args) => HttpRequestTool.execute(args)
    );

    // 7. Sandboxed Code Runner
    this.registerTool(
      {
        name: RunCodeTool.NAME,
        description: RunCodeTool.DESCRIPTION,
        inputSchema: RunCodeTool.INPUT_SCHEMA
      },
      (args) => RunCodeTool.execute(args)
    );

    // 8. In-Memory SQLite Database Query Tool
    this.registerTool(
      {
        name: DatabaseQueryTool.NAME,
        description: DatabaseQueryTool.DESCRIPTION,
        inputSchema: DatabaseQueryTool.INPUT_SCHEMA
      },
      (args) => DatabaseQueryTool.execute(args)
    );

    // 9. Slack Message Integration
    this.registerTool(
      {
        name: SlackMessageTool.NAME,
        description: SlackMessageTool.DESCRIPTION,
        inputSchema: SlackMessageTool.INPUT_SCHEMA
      },
      (args) => SlackMessageTool.execute(args)
    );

    // 10. GitHub PR Integration
    this.registerTool(
      {
        name: GitHubPRTool.NAME,
        description: GitHubPRTool.DESCRIPTION,
        inputSchema: GitHubPRTool.INPUT_SCHEMA
      },
      (args) => GitHubPRTool.execute(args)
    );
  }
}
