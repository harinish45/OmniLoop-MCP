/**
 * ConfirmationGate — pause-and-ask mechanism for high/critical risk tools.
 *
 * When a tool requires confirmation, the gateway emits a special MCP
 * notification back to the LLM client, waits for explicit approval,
 * and only then routes the actual tool call.
 *
 * In Phase 5 this is implemented as an in-process Promise gate.
 * Future: tie into a real human-in-the-loop UI or approval webhook.
 */

import { createLogger } from '../observability/logging.js';

const logger = createLogger('confirmation');

export interface ConfirmationRequest {
  id: string;
  toolName: string;
  risk: string;
  args: unknown;
  requestedAt: Date;
  timeoutMs: number;
}

export type ConfirmationDecision = 'approved' | 'denied' | 'timeout';

export class ConfirmationGate {
  /** Pending confirmations: id → { resolve, reject } */
  private readonly _pending = new Map<
    string,
    { resolve: (d: ConfirmationDecision) => void; timer: ReturnType<typeof setTimeout> }
  >();

  /**
   * Request confirmation for a tool call.
   * Returns a Promise that resolves once the caller approves, denies, or times out.
   */
  async request(req: ConfirmationRequest): Promise<ConfirmationDecision> {
    logger.warn(
      { toolName: req.toolName, risk: req.risk, id: req.id },
      'Confirmation required for tool call'
    );

    return new Promise<ConfirmationDecision>((resolve) => {
      const timer = setTimeout(() => {
        this._pending.delete(req.id);
        logger.warn({ id: req.id, toolName: req.toolName }, 'Confirmation timed out — denying');
        resolve('timeout');
      }, req.timeoutMs);

      this._pending.set(req.id, { resolve, timer });
    });
  }

  /**
   * Respond to a pending confirmation request.
   * Called by the gateway when it receives an explicit approval/denial from the client.
   */
  respond(id: string, decision: ConfirmationDecision): boolean {
    const pending = this._pending.get(id);
    if (!pending) {
      logger.warn({ id }, 'Confirmation response for unknown or expired request');
      return false;
    }

    clearTimeout(pending.timer);
    this._pending.delete(id);
    pending.resolve(decision);
    logger.info({ id, decision }, 'Confirmation resolved');
    return true;
  }

  /** Number of currently pending confirmations */
  get pendingCount(): number {
    return this._pending.size;
  }
}
