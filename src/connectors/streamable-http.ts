/**
 * StreamableHttpConnector — connects to a downstream MCP server
 * via the MCP 2026-07-28 Streamable HTTP transport.
 * This is the preferred transport for remote/cloud MCP servers.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type {
  MCPConnector,
  ToolDefinition,
  ToolResult,
  ResourceDefinition,
  ResourceResult,
  PromptDefinition,
  HealthReport
} from './connector.js';
import type { ServerConfig } from '../config/schema.js';
import { createLogger } from '../observability/logging.js';

type StreamableHttpServerConfig = Extract<ServerConfig, { transport: 'streamable-http' }>;

const logger = createLogger('http-connector');

export class StreamableHttpConnector implements MCPConnector {
  public readonly serverId: string;

  private readonly config: StreamableHttpServerConfig;
  private client: Client | null = null;
  private _isConnected = false;

  constructor(serverId: string, config: StreamableHttpServerConfig) {
    this.serverId = serverId;
    this.config = config;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    logger.info({ serverId: this.serverId, url: this.config.url }, 'Connecting via Streamable HTTP');

    const headers: Record<string, string> = {};

    // Inject auth headers
    if (this.config.auth) {
      if (this.config.auth.type === 'bearer') {
        const token = process.env[this.config.auth.tokenEnv];
        if (!token) {
          throw new Error(
            `[${this.serverId}] Bearer token env var "${this.config.auth.tokenEnv}" is not set`
          );
        }
        headers['Authorization'] = `Bearer ${token}`;
      } else if (this.config.auth.type === 'api-key') {
        const key = process.env[this.config.auth.keyEnv];
        if (!key) {
          throw new Error(
            `[${this.serverId}] API key env var "${this.config.auth.keyEnv}" is not set`
          );
        }
        headers[this.config.auth.headerName] = key;
      }
    }

    const transport = new StreamableHTTPClientTransport(
      new URL(this.config.url),
      { requestInit: { headers } }
    );

    this.client = new Client(
      { name: 'omniloop-gateway', version: '1.0.0' },
      { capabilities: {} }
    );

    await this.client.connect(transport);
    this._isConnected = true;

    logger.info({ serverId: this.serverId }, 'Streamable HTTP connector ready');
  }

  async disconnect(): Promise<void> {
    this._isConnected = false;
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
    logger.info({ serverId: this.serverId }, 'HTTP connector disconnected');
  }

  // ── Tool operations ──────────────────────────────────────────────────────────

  async listTools(): Promise<ToolDefinition[]> {
    const response = await this.getClient().listTools();
    return response.tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: (t.inputSchema as ToolDefinition['inputSchema']) ?? { type: 'object' },
      annotations: t.annotations as Record<string, unknown> | undefined
    }));
  }

  async callTool(name: string, args: unknown): Promise<ToolResult> {
    const response = await this.getClient().callTool(
      { name, arguments: args as Record<string, unknown> },
      undefined
    );
    return {
      content: response.content as ToolResult['content'],
      isError: (response.isError ?? false) as boolean
    };
  }

  // ── Resource operations ──────────────────────────────────────────────────────

  async listResources(): Promise<ResourceDefinition[]> {
    try {
      const response = await this.getClient().listResources();
      return response.resources.map((r) => ({
        uri: r.uri,
        name: r.name,
        description: r.description,
        mimeType: r.mimeType
      }));
    } catch {
      return [];
    }
  }

  async readResource(uri: string): Promise<ResourceResult> {
    const response = await this.getClient().readResource({ uri });
    return {
      uri,
      contents: response.contents as unknown as ResourceResult['contents']
    };
  }

  // ── Prompt operations ────────────────────────────────────────────────────────

  async listPrompts(): Promise<PromptDefinition[]> {
    try {
      const response = await this.getClient().listPrompts();
      return response.prompts.map((p) => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments?.map((a) => ({
          name: a.name,
          description: a.description,
          required: a.required
        }))
      }));
    } catch {
      return [];
    }
  }

  // ── Health ───────────────────────────────────────────────────────────────────

  async health(): Promise<HealthReport> {
    const start = Date.now();
    try {
      if (!this._isConnected || !this.client) {
        return { serverId: this.serverId, status: 'offline', error: 'Not connected', checkedAt: new Date() };
      }
      await this.client.listTools();
      return { serverId: this.serverId, status: 'healthy', latencyMs: Date.now() - start, checkedAt: new Date() };
    } catch (err) {
      return {
        serverId: this.serverId,
        status: 'offline',
        latencyMs: Date.now() - start,
        error: (err as Error).message,
        checkedAt: new Date()
      };
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private getClient(): Client {
    if (!this.client || !this._isConnected) {
      throw new Error(`StreamableHttpConnector [${this.serverId}] is not connected`);
    }
    return this.client;
  }
}
