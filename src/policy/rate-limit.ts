/**
 * RateLimiter — token bucket rate limiting per (serverId, toolName).
 * Prevents runaway tool calls, whether from LLM loops or client bugs.
 * In-process implementation; swap to Redis for multi-instance deployments.
 */

import type { RateLimitConfig } from '../config/schema.js';
import { createLogger } from '../observability/logging.js';

const logger = createLogger('rate-limiter');

interface Bucket {
  tokens: number;
  lastRefillAt: number;
  config: RateLimitConfig;
}

export interface RateLimitCheckResult {
  allowed: boolean;
  remainingTokens: number;
  retryAfterMs?: number;
}

export class RateLimiter {
  /** Key: "serverId.toolName" */
  private readonly _buckets = new Map<string, Bucket>();

  /** Default limits applied when no per-tool config is set */
  private readonly defaultConfig: RateLimitConfig = {
    requests: 60,
    windowSeconds: 60
  };

  /**
   * Pre-register a rate limit config for a specific tool.
   * Called at startup from policy config.
   */
  configure(toolKey: string, config: RateLimitConfig): void {
    this._buckets.set(toolKey, {
      tokens: config.requests,
      lastRefillAt: Date.now(),
      config
    });
  }

  /**
   * Check whether a tool call is allowed under the rate limit.
   * Consumes one token if allowed.
   *
   * @param serverId  Server ID
   * @param toolName  Bare tool name
   * @returns         RateLimitCheckResult with allowed flag and retry info
   */
  check(serverId: string, toolName: string): RateLimitCheckResult {
    const key = `${serverId}.${toolName}`;
    let bucket = this._buckets.get(key);

    if (!bucket) {
      // Use default config for unconfigured tools
      bucket = {
        tokens: this.defaultConfig.requests,
        lastRefillAt: Date.now(),
        config: this.defaultConfig
      };
      this._buckets.set(key, bucket);
    }

    // Refill tokens based on elapsed time
    const nowMs = Date.now();
    const windowMs = bucket.config.windowSeconds * 1000;
    const elapsed = nowMs - bucket.lastRefillAt;

    if (elapsed >= windowMs) {
      bucket.tokens = bucket.config.requests;
      bucket.lastRefillAt = nowMs;
    }

    if (bucket.tokens <= 0) {
      const retryAfterMs = windowMs - elapsed;
      logger.warn({ key, remaining: 0, retryAfterMs }, 'Rate limit exceeded');
      return { allowed: false, remainingTokens: 0, retryAfterMs };
    }

    bucket.tokens--;
    return { allowed: true, remainingTokens: bucket.tokens };
  }

  /**
   * Check rate limit and throw if exceeded.
   * Convenience method for callers that prefer exception-based flow.
   */
  checkOrThrow(serverId: string, toolName: string): void {
    const result = this.check(serverId, toolName);
    if (!result.allowed) {
      throw new Error(`RATE_LIMIT_EXCEEDED: Rate limit exceeded for "${serverId}.${toolName}". Retry in ${Math.ceil((result.retryAfterMs ?? 0) / 1000)}s`);
    }
  }

  /** Returns remaining tokens for a tool (for status/debug) */
  remaining(serverId: string, toolName: string): number {
    const key = `${serverId}.${toolName}`;
    return this._buckets.get(key)?.tokens ?? this.defaultConfig.requests;
  }
}
