/**
 * Centralized Configuration Defaults
 * Single source of truth for all default configuration values.
 * Used by config/loader.ts to merge with user config before validation.
 */

import type {
  GatewayConfig,
  SecurityConfig,
  CacheConfig,
  ResilienceConfig,
  VerificationConfig,
  PolicyConfig,
  AuditConfig,
  ObservabilityConfig,
  StorageConfig,
  RateLimitConfig,
  ToolPolicy
} from './schema.js';

// ── Gateway Defaults ────────────────────────────────────────────────────────────

export const GATEWAY_DEFAULTS: GatewayConfig = {
  name: 'omniloop',
  logLevel: 'info',
  inbound: [{ transport: 'stdio' }]
};

// ── Security Defaults ────────────────────────────────────────────────────────────

export const SECURITY_DEFAULTS: SecurityConfig = {
  argumentGuard: {
    enabled: true,
    maxDepth: 10,
    maxPayloadBytes: 1_048_576, // 1 MB
    strictExtraProperties: false
  },
  secretRedaction: {
    enabled: true
  },
  idempotency: {
    enabled: true,
    ttlSeconds: 300, // 5 minutes
    maxCacheSize: 1000
  },
  outputScrubbing: {
    enabled: true,
    blockPromptInjection: true,
    stripHtml: true
  },
  sandbox: {
    enabled: true,
    allowedPaths: [],
    blockPrivateNetworks: true,
    sanitizeShell: true
  },
  anomaly: {
    enabled: true,
    maxIdenticalCallsInWindow: 5,
    windowMs: 10_000, // 10 seconds
    maxEntropyThreshold: 5.8
  },
  hitl: {
    enabled: true,
    mode: 'auto-approve-safe',
    requiredForRisks: ['critical'],
    tokenTtlSeconds: 300
  },
  provenance: {
    enabled: true,
    signingSecret: 'omniloop-provenance-default-key-change-in-production',
    gatewayId: 'omniloop-v4'
  },
  rbac: {
    enabled: true,
    defaultRole: 'admin'
  }
};

// ── Cache Defaults ────────────────────────────────────────────────────────────────

export const CACHE_DEFAULTS: CacheConfig = {
  enabled: true,
  defaultTtlSeconds: 60,
  maxEntries: 500
};

// ── Resilience Defaults ──────────────────────────────────────────────────────────

export const RESILIENCE_DEFAULTS: ResilienceConfig = {
  circuitBreaker: {
    failureThreshold: 5,
    windowMs: 60_000, // 1 minute
    probeIntervalMs: 30_000 // 30 seconds
  }
};

// ── Verification Defaults ────────────────────────────────────────────────────────

export const VERIFICATION_DEFAULTS: VerificationConfig = {
  maxIterations: 5,
  timeoutSeconds: 300,
  requireConfirmationFor: ['destructive', 'financial', 'credential']
};

// ── Policy Defaults ──────────────────────────────────────────────────────────────

export const POLICY_DEFAULTS: PolicyConfig = {
  defaults: {
    low: ['read_*', 'list_*', 'get_*', 'search_*', 'describe_*'],
    medium: ['create_*', 'update_*', 'write_*', 'send_*'],
    high: ['delete_*', 'remove_*', 'destroy_*', 'execute_*', 'deploy_*'],
    critical: ['admin_*', 'config_*', 'credential_*', 'secret_*', 'billing_*']
  },
  overrides: {}
};

// ── Audit Defaults ────────────────────────────────────────────────────────────────

export const AUDIT_DEFAULTS: AuditConfig = {
  enabled: true,
  directory: './logs/audit',
  retentionDays: 90
};

// ── Observability Defaults ───────────────────────────────────────────────────────

export const OBSERVABILITY_DEFAULTS: ObservabilityConfig = {
  prometheus: {
    enabled: false,
    port: 9090,
    host: '127.0.0.1'
  },
  healthEndpoint: {
    enabled: false,
    port: 3001,
    host: '127.0.0.1'
  }
};

// ── Storage Defaults ─────────────────────────────────────────────────────────────

export const STORAGE_DEFAULTS: StorageConfig = {
  type: 'memory',
  redis: {
    url: 'redis://127.0.0.1:6379',
    keyPrefix: 'omniloop:',
    connectionPoolSize: 10,
    maxRetries: 3,
    retryDelayMs: 100
  }
};

// ── Rate Limit Defaults ──────────────────────────────────────────────────────────

export const RATE_LIMIT_DEFAULTS: RateLimitConfig = {
  requests: 60,
  windowSeconds: 60
};

// ── Tool Policy Defaults ─────────────────────────────────────────────────────────

export const TOOL_POLICY_DEFAULTS: ToolPolicy = {
  risk: 'medium',
  confirmation: 'optional',
  deny: false
};

// ── All Defaults Combined ────────────────────────────────────────────────────────

import type { OmniLoopConfig } from './schema.js';

export const ALL_DEFAULTS: Omit<OmniLoopConfig, 'servers'> & { servers: {} } = {
  version: 1,
  gateway: GATEWAY_DEFAULTS,
  security: SECURITY_DEFAULTS,
  cache: CACHE_DEFAULTS,
  resilience: RESILIENCE_DEFAULTS,
  verification: VERIFICATION_DEFAULTS,
  policy: POLICY_DEFAULTS,
  audit: AUDIT_DEFAULTS,
  observability: OBSERVABILITY_DEFAULTS,
  storage: STORAGE_DEFAULTS,
  servers: {}
} as const;

// ── Deep Merge Utility ───────────────────────────────────────────────────────────

/**
 * Deep merge user config with defaults.
 * Arrays are replaced (not merged) to avoid unexpected combinations.
 */
export function mergeWithDefaults<T extends Record<string, unknown>>(
  userConfig: Partial<T>,
  defaults: T
): T {
  const result = { ...defaults } as Record<string, unknown>;

  for (const [key, userValue] of Object.entries(userConfig)) {
    const defaultValue = result[key];
    if (
      userValue !== null &&
      typeof userValue === 'object' &&
      !Array.isArray(userValue) &&
      defaultValue !== null &&
      typeof defaultValue === 'object' &&
      !Array.isArray(defaultValue)
    ) {
      result[key] = mergeWithDefaults(
        userValue as Record<string, unknown>,
        defaultValue as Record<string, unknown>
      );
    } else {
      result[key] = userValue;
    }
  }

  return result as T;
}