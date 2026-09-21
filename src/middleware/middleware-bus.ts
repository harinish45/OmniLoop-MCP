/**
 * MiddlewareBus — composable async pipeline for tool call hooks.
 *
 * Allows before/after/onError hooks to be registered globally or per-tool.
 * Each hook receives the full context and can mutate args or result.
 *
 * Built-in middleware (registered by default):
 *   - SecretRedactionMiddleware — redacts args for logging
 *   - MetricsMiddleware — records call metrics
 *   - AuditMiddleware — writes to audit log
 *
 * Custom middleware can be registered via the bus for extensibility.
 */

import type { ToolResult } from '../connectors/connector.js';
import { createLogger } from '../observability/logging.js';

const logger = createLogger('middleware-bus');

// ── Context ───────────────────────────────────────────────────────────────────

export interface MiddlewareContext {
  traceId: string;
  toolName: string;
  serverId: string;
  riskLevel: string;
  /** Mutable — middleware can transform args before routing */
  args: unknown;
  /** Populated after the tool call completes */
  result?: ToolResult;
  /** Any additional metadata middleware wants to attach */
  meta: Record<string, unknown>;
  startedAt: number;
}

// ── Middleware interface ───────────────────────────────────────────────────────

export interface Middleware {
  name: string;
  /**
   * Runs BEFORE the tool call.
   * Can throw to abort the call (treated as authorization denial).
   * Can mutate ctx.args to transform inputs.
   */
  before?(ctx: MiddlewareContext): Promise<void> | void;

  /**
   * Runs AFTER the tool call completes (success or failure).
   * ctx.result is populated.
   * Can mutate ctx.result to transform outputs.
   */
  after?(ctx: MiddlewareContext): Promise<void> | void;

  /**
   * Runs when the tool call throws an unexpected error.
   * Can return a fallback ToolResult to recover gracefully.
   */
  onError?(ctx: MiddlewareContext, err: unknown): Promise<ToolResult | undefined> | ToolResult | undefined;
}

// ── Bus ───────────────────────────────────────────────────────────────────────

export class MiddlewareBus {
  private readonly _global: Middleware[] = [];
  /** per-tool middleware: key is namespaced tool name or "*" */
  private readonly _perTool = new Map<string, Middleware[]>();

  /** Register middleware to run for ALL tool calls */
  useGlobal(middleware: Middleware): void {
    this._global.push(middleware);
    logger.debug({ name: middleware.name }, 'Global middleware registered');
  }

  /** Register middleware to run for a specific tool only */
  useTool(namespacedTool: string, middleware: Middleware): void {
    const existing = this._perTool.get(namespacedTool) ?? [];
    existing.push(middleware);
    this._perTool.set(namespacedTool, existing);
    logger.debug({ name: middleware.name, tool: namespacedTool }, 'Per-tool middleware registered');
  }

  /** Collect middleware for a specific tool call (global + per-tool) */
  private collectFor(toolName: string): Middleware[] {
    const toolSpecific = this._perTool.get(toolName) ?? [];
    return [...this._global, ...toolSpecific];
  }

  /**
   * Run all BEFORE hooks.
   * If any hook throws, the error propagates and the call is aborted.
   */
  async runBefore(ctx: MiddlewareContext): Promise<void> {
    for (const mw of this.collectFor(ctx.toolName)) {
      if (mw.before) {
        try {
          await mw.before(ctx);
        } catch (err) {
          logger.error({ middleware: mw.name, tool: ctx.toolName, err }, 'Before middleware threw');
          throw err;
        }
      }
    }
  }

  /**
   * Run all AFTER hooks.
   * Errors in after hooks are logged but do NOT abort result delivery.
   */
  async runAfter(ctx: MiddlewareContext): Promise<void> {
    for (const mw of this.collectFor(ctx.toolName)) {
      if (mw.after) {
        try {
          await mw.after(ctx);
        } catch (err) {
          logger.error({ middleware: mw.name, tool: ctx.toolName, err }, 'After middleware threw — continuing');
        }
      }
    }
  }

  /**
   * Run all onError hooks.
   * Returns the first non-undefined fallback result from any hook.
   */
  async runOnError(ctx: MiddlewareContext, err: unknown): Promise<ToolResult | undefined> {
    for (const mw of this.collectFor(ctx.toolName)) {
      if (mw.onError) {
        try {
          const fallback = await mw.onError(ctx, err);
          if (fallback !== undefined) {
            logger.info({ middleware: mw.name, tool: ctx.toolName }, 'onError middleware provided fallback result');
            return fallback;
          }
        } catch (innerErr) {
          logger.error({ middleware: mw.name, err: innerErr }, 'onError middleware itself threw');
        }
      }
    }
    return undefined;
  }
}
