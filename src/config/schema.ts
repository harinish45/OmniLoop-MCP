/**
 * Config schema — Zod validation for omniloop.yaml.
 * All gateway configuration is declarative and validated at startup.
 * Secrets are NEVER embedded; use ${ENV_VAR} references.
 */

import { z } from 'zod';

// ── Risk levels ───────────────────────────────────────────────────────────────

export const RiskLevelSchema = z.enum(['low', 'medium', 'high', 'critical']);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

// ── Rate limit config ─────────────────────────────────────────────────────────

export const RateLimitConfigSchema = z.object({
  requests: z.number().int().positive(),
  /** Window in seconds */
  windowSeconds: z.number().int().positive()
});
export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;

// ── Tool policy override ──────────────────────────────────────────────────────

export const ToolPolicySchema = z.object({
  risk: RiskLevelSchema.optional(),
  confirmation: z.enum(['required', 'optional', 'none']).optional(),
  rateLimit: RateLimitConfigSchema.optional(),
  /** Timeout in seconds for this specific tool */
  timeoutSeconds: z.number().int().positive().optional(),
  /** Explicitly deny this tool even if downstream exposes it */
  deny: z.boolean().optional()
});
export type ToolPolicy = z.infer<typeof ToolPolicySchema>;

// ── Policy config ─────────────────────────────────────────────────────────────

export const PolicyConfigSchema = z.object({
  /** Glob patterns for each default risk level, e.g. ["read_*", "list_*"] */
  defaults: z.object({
    low: z.array(z.string()).optional(),
    medium: z.array(z.string()).optional(),
    high: z.array(z.string()).optional(),
    critical: z.array(z.string()).optional()
  }).optional(),
  /** Per-tool overrides keyed by "server.toolName" or bare "toolName" */
  overrides: z.record(z.string(), ToolPolicySchema).optional()
});
export type PolicyConfig = z.infer<typeof PolicyConfigSchema>;

// ── Verification config ───────────────────────────────────────────────────────

export const VerificationConfigSchema = z.object({
  maxIterations: z.number().int().min(1).max(20).default(5),
  /** Total verification loop timeout in seconds */
  timeoutSeconds: z.number().int().positive().default(300),
  requireConfirmationFor: z
    .array(z.enum(['destructive', 'financial', 'credential']))
    .default(['destructive', 'financial', 'credential'])
});
export type VerificationConfig = z.infer<typeof VerificationConfigSchema>;

// ── Auth config ───────────────────────────────────────────────────────────────

export const AuthConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bearer'), tokenEnv: z.string() }),
  z.object({ type: z.literal('api-key'), headerName: z.string(), keyEnv: z.string() }),
  z.object({ type: z.literal('none') })
]);
export type AuthConfig = z.infer<typeof AuthConfigSchema>;

// ── Inbound transport config ──────────────────────────────────────────────────

export const InboundTransportSchema = z.discriminatedUnion('transport', [
  z.object({ transport: z.literal('stdio') }),
  z.object({
    transport: z.literal('streamable-http'),
    port: z.number().int().min(1).max(65535).default(3000),
    host: z.string().default('127.0.0.1'),
    auth: AuthConfigSchema.optional()
  })
]);
export type InboundTransport = z.infer<typeof InboundTransportSchema>;

// ── Downstream server config ──────────────────────────────────────────────────

export const StdioServerConfigSchema = z.object({
  transport: z.literal('stdio'),
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string(), z.string()).optional(),
  /** Reconnect delay in milliseconds on crash */
  reconnectDelayMs: z.number().int().positive().default(2000),
  maxReconnects: z.number().int().min(0).default(5)
});

export const StreamableHttpServerConfigSchema = z.object({
  transport: z.literal('streamable-http'),
  url: z.string().url(),
  auth: AuthConfigSchema.optional(),
  timeoutMs: z.number().int().positive().default(30000)
});

export const LegacySseServerConfigSchema = z.object({
  transport: z.literal('legacy-sse'),
  url: z.string().url(),
  auth: AuthConfigSchema.optional()
});

export const ServerConfigSchema = z.discriminatedUnion('transport', [
  StdioServerConfigSchema,
  StreamableHttpServerConfigSchema,
  LegacySseServerConfigSchema
]);
export type ServerConfig = z.infer<typeof ServerConfigSchema>;

// ── Gateway config ────────────────────────────────────────────────────────────

export const GatewayConfigSchema = z.object({
  name: z.string().default('omniloop'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  inbound: z.array(InboundTransportSchema).default([{ transport: 'stdio' }])
});
export type GatewayConfig = z.infer<typeof GatewayConfigSchema>;

// ── Security config ───────────────────────────────────────────────────────────

export const SecurityConfigSchema = z.object({
  argumentGuard: z.object({
    enabled: z.boolean().default(true),
    maxDepth: z.number().int().positive().default(10),
    maxPayloadBytes: z.number().int().positive().default(1_048_576),
    strictExtraProperties: z.boolean().default(false)
  }).optional(),
  secretRedaction: z.object({
    enabled: z.boolean().default(true)
  }).optional(),
  idempotency: z.object({
    enabled: z.boolean().default(true),
    ttlSeconds: z.number().int().positive().default(300),
    maxCacheSize: z.number().int().positive().default(1000)
  }).optional(),
  outputScrubbing: z.object({
    enabled: z.boolean().default(true),
    blockPromptInjection: z.boolean().default(true),
    stripHtml: z.boolean().default(true)
  }).optional()
});
export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;

// ── Cache config ──────────────────────────────────────────────────────────────

export const CacheConfigSchema = z.object({
  enabled: z.boolean().default(true),
  defaultTtlSeconds: z.number().int().positive().default(60),
  maxEntries: z.number().int().positive().default(500),
  perToolTtlSeconds: z.record(z.string(), z.number().int().positive()).optional()
});
export type CacheConfig = z.infer<typeof CacheConfigSchema>;

// ── Resilience config ─────────────────────────────────────────────────────────

export const ResilienceConfigSchema = z.object({
  circuitBreaker: z.object({
    failureThreshold: z.number().int().positive().default(5),
    windowMs: z.number().int().positive().default(60_000),
    probeIntervalMs: z.number().int().positive().default(30_000)
  }).optional()
});
export type ResilienceConfig = z.infer<typeof ResilienceConfigSchema>;

// ── Audit config ──────────────────────────────────────────────────────────────

export const AuditConfigSchema = z.object({
  enabled: z.boolean().default(true),
  directory: z.string().default('./logs/audit'),
  retentionDays: z.number().int().positive().default(90)
});
export type AuditConfig = z.infer<typeof AuditConfigSchema>;

// ── Observability config ──────────────────────────────────────────────────────

export const ObservabilityConfigSchema = z.object({
  prometheus: z.object({
    enabled: z.boolean().default(false),
    port: z.number().int().positive().default(9090),
    host: z.string().default('127.0.0.1')
  }).optional(),
  healthEndpoint: z.object({
    enabled: z.boolean().default(false),
    port: z.number().int().positive().default(3001),
    host: z.string().default('127.0.0.1')
  }).optional()
});
export type ObservabilityConfig = z.infer<typeof ObservabilityConfigSchema>;

// ── Root config ───────────────────────────────────────────────────────────────

export const OmniLoopConfigSchema = z.object({
  version: z.literal(1),
  gateway: GatewayConfigSchema,
  servers: z.record(z.string(), ServerConfigSchema),
  policy: PolicyConfigSchema.optional(),
  verification: VerificationConfigSchema.optional(),
  security: SecurityConfigSchema.optional(),
  cache: CacheConfigSchema.optional(),
  resilience: ResilienceConfigSchema.optional(),
  audit: AuditConfigSchema.optional(),
  observability: ObservabilityConfigSchema.optional()
});
export type OmniLoopConfig = z.infer<typeof OmniLoopConfigSchema>;
