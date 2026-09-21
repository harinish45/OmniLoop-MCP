/**
 * VerificationLoop — the core Plan→Execute→Verify→Repair engine.
 *
 * This is what makes OmniLoop more than a proxy: tool call results are
 * verified against success criteria before being returned. Failures
 * trigger recovery before the loop terminates with an error.
 *
 * Loop flow:
 *   1. EXECUTE  — route tool call through policy + router
 *   2. VERIFY   — run verifier against result
 *   3. PASS     → return result
 *   4. FAIL     → RECOVER (strategy) → goto 1 (bounded by maxIterations)
 *   5. EXHAUSTED → return structured failure
 */

import type { ToolResult } from '../connectors/connector.js';
import type { VerifierFn } from './verifier.js';
import { isSuccess } from './verifier.js';
import type { RecoveryConfig } from './recovery.js';
import { RecoveryService } from './recovery.js';
import type { ToolRouter } from '../routing/tool-router.js';
import { recordVerificationLoop } from '../observability/metrics.js';
import { createLogger } from '../observability/logging.js';

const logger = createLogger('verification-loop');

export interface LoopConfig {
  /** Maximum number of execute+verify attempts (default: 5) */
  maxIterations: number;
  /** Overall timeout for the entire loop in ms (default: 300_000) */
  timeoutMs: number;
  /** Verifier to apply to each result */
  verifier?: VerifierFn;
  /** Recovery strategy to use on verification failure */
  recovery?: RecoveryConfig;
}

export interface LoopResult {
  passed: boolean;
  iterations: number;
  finalResult: ToolResult;
  /** Populated if all iterations failed */
  failureReason?: string;
}

export class VerificationLoop {
  private readonly recoveryService: RecoveryService;

  constructor(private readonly router: ToolRouter) {
    this.recoveryService = new RecoveryService(router);
  }

  /**
   * Execute a tool call within the verification loop.
   *
   * @param toolName  Namespaced tool name
   * @param args      Tool arguments
   * @param config    Loop configuration (iterations, timeout, verifier, recovery)
   * @returns         LoopResult with final tool result and pass/fail verdict
   */
  async execute(
    toolName: string,
    args: unknown,
    config: Partial<LoopConfig> = {}
  ): Promise<LoopResult> {
    const maxIterations = config.maxIterations ?? 5;
    const timeoutMs = config.timeoutMs ?? 300_000;
    const verifier = config.verifier ?? isSuccess();
    const recovery = config.recovery ?? { strategy: 'retry', retryDelayMs: 1000 };

    const deadline = Date.now() + timeoutMs;
    let lastResult: ToolResult | undefined;
    let iteration = 0;

    logger.info({ toolName, maxIterations, timeoutMs }, 'Verification loop started');

    while (iteration < maxIterations) {
      // Check overall timeout
      if (Date.now() >= deadline) {
        logger.warn({ toolName, iteration }, 'Verification loop timed out');
        recordVerificationLoop(false);
        return {
          passed: false,
          iterations: iteration,
          finalResult: lastResult ?? { content: [{ type: 'text', text: 'Timeout' }], isError: true },
          failureReason: `Loop timed out after ${iteration} iterations`
        };
      }

      iteration++;
      logger.debug({ toolName, iteration, maxIterations }, 'Loop iteration');

      // EXECUTE
      let result: ToolResult;
      try {
        result = await this.router.route(toolName, args);
        lastResult = result;
      } catch (err) {
        const errMsg = (err as Error).message;
        logger.error({ toolName, iteration, err: errMsg }, 'Tool call threw during loop');

        // Treat thrown errors as failed results
        result = {
          content: [{ type: 'text', text: errMsg }],
          isError: true
        };
        lastResult = result;
      }

      // VERIFY
      const outcome = verifier(result);
      logger.debug({ toolName, iteration, status: outcome.status, reason: outcome.reason }, 'Verification outcome');

      if (outcome.status === 'pass') {
        logger.info({ toolName, iterations: iteration }, 'Verification loop passed');
        recordVerificationLoop(true);
        return { passed: true, iterations: iteration, finalResult: result };
      }

      // FAIL — attempt recovery if iterations remain
      if (iteration < maxIterations) {
        const recovery_result = await this.recoveryService.attempt(toolName, args, outcome, recovery);

        if (recovery_result.aborted) {
          recordVerificationLoop(false);
          return {
            passed: false,
            iterations: iteration,
            finalResult: lastResult,
            failureReason: recovery_result.reason
          };
        }

        if (recovery_result.toolResult) {
          // Recovery produced a new result — verify it in the next iteration
          // by using it as the new lastResult but continuing the loop
          lastResult = recovery_result.toolResult;
          const recoveryOutcome = verifier(recovery_result.toolResult);
          if (recoveryOutcome.status === 'pass') {
            logger.info({ toolName, iterations: iteration }, 'Loop passed after recovery');
            recordVerificationLoop(true);
            return { passed: true, iterations: iteration, finalResult: recovery_result.toolResult };
          }
        }
      }
    }

    // All iterations exhausted
    logger.warn({ toolName, maxIterations }, 'Verification loop exhausted all iterations');
    recordVerificationLoop(false);

    return {
      passed: false,
      iterations: iteration,
      finalResult: lastResult ?? { content: [{ type: 'text', text: 'All iterations failed' }], isError: true },
      failureReason: `All ${maxIterations} iterations failed verification`
    };
  }
}
