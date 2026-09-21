/**
 * LegacySseConnector — compatibility adapter for pre-2026 MCP servers
 * that use the deprecated Server-Sent Events transport (MCP 2024-11-05).
 *
 * This connector wraps the SDK's SSEClientTransport to allow legacy servers
 * to participate in the federation without modification.
 *
 * NOTE: New servers should use Streamable HTTP. This adapter will be removed
 * once all downstream servers have migrated to the current MCP spec.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
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

type LegacySseServerConfig = Extract<ServerConfig, { transport: 'legacy-sse' }>;

const logger = createLogger('sse-connector');

export class LegacySseConnector implements MCPConnector {
  public readonly serverId: string;

  private readonly config: LegacySseServerConfig;
  private client: Client | null = null;
  private _isConnected = false;

  constructor(serverId: string, config: LegacySseServerConfig) {
    this.serverId = serverId;
    this.config = config;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    logger.warn(
      { serverId: this.serverId, url: this.config.url },
      'Connecting via legacy SSE transport — migrate this server to Streamable HTTP'
    );

    const headers: Record<string, string> = {};

    if (this.config.auth) {
      if (this.config.auth.type === 'bearer') {
        const token = process.env[this.config.auth.tokenEnv];
        if (!token) {
          throw new Error(`[${this.serverId}] Bearer token env var not set`);
        }
        headers['Authorization'] = `Bearer ${token}`;
      } else if (this.config.auth.type === 'api-key') {
        const key = process.env[this.config.auth.keyEnv];
        if (!key) {
          throw new Error(`[${this.serverId}] API key env var not set`);
        }
        headers[this.config.auth.headerName] = key;
      }
    }

    const transport = new SSEClientTransport(new URL(this.config.url));

    this.client = new Client(
      { name: 'omniloop-gateway', version: '1.0.0' },
      { capabilities: {} }
    );

    await this.client.connect(transport);
    this._isConnected = true;
    logger.info({ serverId: this.serverId }, 'Legacy SSE connector ready');
  }

  async disconnect(): Promise<void> {
    this._isConnected = false;
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  // ── Tool operations ──────────────────────────────────────────────────────────

  async listTools(): Promise<ToolDefinition[]> {
    const response = await this.getClient().listTools();
    return response.tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      inputSchema: (t.inputSchema as ToolDefinition['inputSchema']) ?? { type: 'object' }
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
    return { uri, contents: response.contents as unknown as ResourceResult['contents'] };
  }

  async listPrompts(): Promise<PromptDefinition[]> {
    try {
      const response = await this.getClient().listPrompts();
      return response.prompts.map((p) => ({
        name: p.name,
        description: p.description
      }));
    } catch {
      return [];
    }
  }

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
      throw new Error(`LegacySseConnector [${this.serverId}] is not connected`);
    }
    return this.client;
  }
}
