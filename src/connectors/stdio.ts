/**
 * StdioConnector — connects to a downstream MCP server via child process stdio.
 * Uses the MCP SDK's StdioClientTransport to spawn and manage the subprocess.
 * Implements automatic reconnection with exponential backoff on process crash.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
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

type StdioServerConfig = Extract<ServerConfig, { transport: 'stdio' }>;

const logger = createLogger('stdio-connector');

export class StdioConnector implements MCPConnector {
  public readonly serverId: string;

  private readonly config: StdioServerConfig;
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private reconnectCount = 0;
  private _isConnected = false;

  constructor(serverId: string, config: StdioServerConfig) {
    this.serverId = serverId;
    this.config = config;
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  async connect(): Promise<void> {
    logger.info({ serverId: this.serverId, command: this.config.command }, 'Connecting via stdio');

    this.transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args ?? [],
      env: this.config.env
        ? { ...process.env, ...this.config.env } as Record<string, string>
        : undefined
    });

    this.client = new Client(
      { name: 'omniloop-gateway', version: '1.0.0' },
      { capabilities: {} }
    );

    await this.client.connect(this.transport);
    this._isConnected = true;
    this.reconnectCount = 0;

    // Handle unexpected process termination
    this.transport.onclose = () => {
      this._isConnected = false;
      logger.warn({ serverId: this.serverId }, 'Stdio process closed unexpectedly');
      void this.scheduleReconnect();
    };

    logger.info({ serverId: this.serverId }, 'Stdio connector ready');
  }

  async disconnect(): Promise<void> {
    this._isConnected = false;
    if (this.client) {
      await this.client.close();
      this.client = null;
      this.transport = null;
    }
    logger.info({ serverId: this.serverId }, 'Stdio connector disconnected');
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
      // Some servers don't implement resources — treat as empty
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
        return {
          serverId: this.serverId,
          status: 'offline',
          error: 'Not connected',
          checkedAt: new Date()
        };
      }
      // Ping via tools/list as a liveness probe
      await this.client.listTools();
      return {
        serverId: this.serverId,
        status: 'healthy',
        latencyMs: Date.now() - start,
        checkedAt: new Date()
      };
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
      throw new Error(`StdioConnector [${this.serverId}] is not connected`);
    }
    return this.client;
  }

  private async scheduleReconnect(): Promise<void> {
    const maxReconnects = this.config.maxReconnects ?? 5;
    if (this.reconnectCount >= maxReconnects) {
      logger.error(
        { serverId: this.serverId, reconnectCount: this.reconnectCount },
        'Max reconnect attempts reached — server marked offline'
      );
      return;
    }

    const delayMs = (this.config.reconnectDelayMs ?? 2000) * Math.pow(2, this.reconnectCount);
    this.reconnectCount++;
    logger.info(
      { serverId: this.serverId, attempt: this.reconnectCount, delayMs },
      'Scheduling reconnect'
    );

    await new Promise((resolve) => setTimeout(resolve, delayMs));

    try {
      await this.connect();
      logger.info({ serverId: this.serverId }, 'Reconnected successfully');
    } catch (err) {
      logger.error({ serverId: this.serverId, err }, 'Reconnect attempt failed');
      void this.scheduleReconnect();
    }
  }
}


