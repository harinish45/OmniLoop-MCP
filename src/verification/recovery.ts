/**
 * Recovery — repair strategies invoked when a verification fails.
 * Recovery attempts to fix the situation before the loop retries.
 *
 * Strategies:
 *   - retry:       try the same call again with the same args
 *   - fallback:    call a different tool (configured by name)
 *   - abort:       stop immediately (used for destructive or credential tools)
 *
 * Recovery is always bounded by VerificationLoop's maxIterations.
 */

import type { ToolResult } from '../connectors/connector.js';
import type { VerificationOutcome } from './verifier.js';
import type { ToolRouter } from '../routing/tool-router.js';
import { createLogger } from '../observability/logging.js';

const logger = createLogger('recovery');

export type RecoveryStrategy = 'retry' | 'fallback' | 'abort';

export interface RecoveryConfig {
  strategy: RecoveryStrategy;
  /** Required when strategy === 'fallback' */
  fallbackTool?: string;
  /** Delay between retry attempts in ms */
  retryDelayMs?: number;
}

export interface RecoveryResult {
  attempted: boolean;
  toolResult?: ToolResult;
  aborted: boolean;
  reason: string;
}

export class RecoveryService {
  constructor(private readonly router: ToolRouter) {}

  /**
   * Attempt to recover from a verification failure.
   *
   * @param toolName      Namespaced tool name that failed
   * @param args          Original args used in the failing call
   * @param outcome       The failed verification outcome
   * @param config        Recovery strategy to apply
   */
  async attempt(
    toolName: string,
    args: unknown,
    outcome: VerificationOutcome,
    config: RecoveryConfig
  ): Promise<RecoveryResult> {
    logger.info(
      { toolName, strategy: config.strategy, reason: outcome.reason },
      'Attempting recovery'
    );

    switch (config.strategy) {
      case 'abort': {
        logger.warn({ toolName }, 'Recovery strategy is abort — stopping loop');
        return { attempted: true, aborted: true, reason: 'Abort strategy configured for this tool' };
      }

      case 'retry': {
        if (config.retryDelayMs && config.retryDelayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, config.retryDelayMs));
        }
        try {
          const result = await this.router.route(toolName, args);
          return { attempted: true, toolResult: result, aborted: false, reason: 'Retry succeeded' };
        } catch (err) {
          return {
            attempted: true,
            aborted: false,
            reason: `Retry failed: ${(err as Error).message}`
          };
        }
      }

      case 'fallback': {
        if (!config.fallbackTool) {
          return { attempted: false, aborted: false, reason: 'Fallback strategy requires fallbackTool' };
        }
        try {
          const result = await this.router.route(config.fallbackTool, args);
          return {
            attempted: true,
            toolResult: result,
            aborted: false,
            reason: `Fallback to ${config.fallbackTool} succeeded`
          };
        } catch (err) {
          return {
            attempted: true,
            aborted: false,
            reason: `Fallback failed: ${(err as Error).message}`
          };
        }
      }
    }
  }
}
