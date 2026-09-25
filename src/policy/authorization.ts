/**
 * Authorization — the policy gate that runs before every tool call.
 * Combines: allowlist check, risk classification, rate limiting, and timeout.
 *
 * Call sequence:
 *   1. Check tool is not explicitly denied
 *   2. Check rate limit (fast reject)
 *   3. Resolve risk level
 *   4. Return AuthorizationResult with risk + confirmation requirement
 *
 * The caller (gateway) is responsible for acting on confirmationRequired.
 */

import type { ToolRegistry } from '../registry/tool-registry.js';
import type { PolicyConfig } from '../config/schema.js';
import { resolveRisk, type RiskLevel } from './permissions.js';
import { RateLimiter, type RateLimitCheckResult } from './rate-limit.js';
import { createLogger } from '../observability/logging.js';

const logger = createLogger('authorization');

export interface AuthorizationResult {
  allowed: boolean;
  risk: RiskLevel;
  /** Whether a confirmation gate must be passed before calling the tool */
  confirmationRequired: boolean;
  /** Human-readable reason when denied */
  reason?: string;
  /** Timeout in ms to apply to this tool call */
  timeoutMs: number;
}

export class AuthorizationService {
  private readonly rateLimiter: RateLimiter;

  constructor(
    private readonly toolRegistry: ToolRegistry,
    private readonly policyConfig: PolicyConfig | undefined,
    rateLimiter?: RateLimiter
  ) {
    this.rateLimiter = rateLimiter ?? new RateLimiter();

    // Pre-configure rate limits from policy
    if (policyConfig?.overrides) {
      for (const [toolName, policy] of Object.entries(policyConfig.overrides)) {
        if (policy.rateLimit) {
          const parts = toolName.split('.');
          const serverId = parts.length > 1 ? parts[0] : '*';
          const bare = parts.length > 1 ? parts.slice(1).join('.') : toolName;
          this.rateLimiter.configure(`${serverId}.${bare}`, policy.rateLimit);
        }
      }
    }
  }

  /**
   * Authorize a tool call.
   *
   * @param namespacedName  Full "server.toolName" key
   * @returns               Authorization result — ALWAYS check .allowed before proceeding
   */
  authorize(namespacedName: string): AuthorizationResult {
    // 1. Resolve tool entry
    const entry = this.toolRegistry.resolve(namespacedName);
    if (!entry) {
      return {
        allowed: false,
        risk: 'high',
        confirmationRequired: false,
        reason: `Tool "${namespacedName}" not found in registry`,
        timeoutMs: 30_000
      };
    }

    const { serverId, bareName } = entry;

    // 2. Check explicit deny
    const toolOverride = this.policyConfig?.overrides?.[namespacedName]
      ?? this.policyConfig?.overrides?.[bareName];

    if (toolOverride?.deny === true) {
      logger.warn({ namespacedName }, 'Tool call denied by policy');
      return {
        allowed: false,
        risk: 'critical',
        confirmationRequired: false,
        reason: `Tool "${namespacedName}" is explicitly denied by gateway policy`,
        timeoutMs: 0
      };
    }

    // 3. Rate limit check
    const rateLimitResult: RateLimitCheckResult = this.rateLimiter.check(serverId, bareName);
    if (!rateLimitResult.allowed) {
      return {
        allowed: false,
        risk: 'low',
        confirmationRequired: false,
        reason: `Rate limit exceeded for "${namespacedName}" (retry in ${Math.ceil((rateLimitResult.retryAfterMs ?? 0) / 1000)}s)`,
        timeoutMs: 0
      };
    }

    // 4. Resolve risk level
    const risk = resolveRisk(namespacedName, this.policyConfig?.overrides);

    // 5. Determine confirmation requirement
    const confirmationPolicy = toolOverride?.confirmation;
    const confirmationRequired =
      confirmationPolicy === 'required' ||
      (confirmationPolicy === undefined && (risk === 'high' || risk === 'critical'));

    // 6. Resolve timeout
    const timeoutMs = (toolOverride?.timeoutSeconds ?? this.defaultTimeoutSeconds(risk)) * 1000;

    logger.debug({ namespacedName, risk, confirmationRequired }, 'Tool authorized');

    return { allowed: true, risk, confirmationRequired, timeoutMs };
  }

  private defaultTimeoutSeconds(risk: RiskLevel): number {
    switch (risk) {
      case 'low': return 10;
      case 'medium': return 30;
      case 'high': return 60;
      case 'critical': return 120;
    }
  }
}
