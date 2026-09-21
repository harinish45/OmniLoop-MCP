/**
 * MCPConnector — core abstraction over any downstream MCP server.
 * OmniLoop Gateway communicates with all downstream servers exclusively
 * through this interface, regardless of their transport (stdio, HTTP, SSE).
 */

// ── Tool types ───────────────────────────────────────────────────────────────

export interface ToolInputSchema {
  type: 'object';
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  /** Original server-reported annotations (untrusted — policy layer validates) */
  annotations?: Record<string, unknown>;
}

export type ContentItem =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; resource: { uri: string; text?: string } };

export interface ToolResult {
  content: ContentItem[];
  isError?: boolean;
}

// ── Resource types ───────────────────────────────────────────────────────────

export interface ResourceDefinition {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface ResourceResult {
  uri: string;
  mimeType?: string;
  contents: Array<{ type: 'text'; text: string } | { type: 'blob'; blob: string }>;
}

// ── Prompt types ─────────────────────────────────────────────────────────────

export interface PromptDefinition {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

// ── Health ───────────────────────────────────────────────────────────────────

export type HealthStatus = 'healthy' | 'degraded' | 'offline';

export interface HealthReport {
  serverId: string;
  status: HealthStatus;
  latencyMs?: number;
  error?: string;
  checkedAt: Date;
}

// ── Core interface ───────────────────────────────────────────────────────────

export interface MCPConnector {
  /** Unique identifier for the downstream server (from config) */
  readonly serverId: string;

  /** Establish transport connection and complete MCP initialization handshake */
  connect(): Promise<void>;

  /** Gracefully disconnect from the downstream server */
  disconnect(): Promise<void>;

  /** Fetch the full tool list from the downstream server */
  listTools(): Promise<ToolDefinition[]>;

  /**
   * Invoke a tool on the downstream server.
   * @param name  The bare tool name (namespace prefix stripped by router)
   * @param args  Validated tool arguments
   */
  callTool(name: string, args: unknown): Promise<ToolResult>;

  /** Fetch the resource list from the downstream server */
  listResources(): Promise<ResourceDefinition[]>;

  /**
   * Read a specific resource by URI.
   * @param uri  Resource URI as reported by listResources
   */
  readResource(uri: string): Promise<ResourceResult>;

  /** Fetch the prompt list from the downstream server */
  listPrompts(): Promise<PromptDefinition[]>;

  /** Check liveness of the downstream server */
  health(): Promise<HealthReport>;
}

// ── Event types (used by server-registry) ────────────────────────────────────

export type ConnectorEventType =
  | 'connected'
  | 'disconnected'
  | 'tools_changed'
  | 'resources_changed'
  | 'error';

export interface ConnectorEvent {
  type: ConnectorEventType;
  serverId: string;
  timestamp: Date;
  data?: unknown;
}
