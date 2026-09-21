/**
 * HitlGate — Human-in-the-Loop interactive confirmation gate.
 * Protects critical and destructive tool invocations with explicit operator approval.
 */

import { randomBytes } from 'crypto';
import { createLogger } from '../observability/logging.js';

const logger = createLogger('hitl-gate');

export type HitlMode = 'token' | 'callback' | 'auto-approve-safe';

export interface HitlConfig {
  enabled: boolean;
  mode: HitlMode;
  /** Risk levels that strictly require human confirmation */
  requiredForRisks: Array<'low' | 'medium' | 'high' | 'critical'>;
  /** Token validity in seconds */
  tokenTtlSeconds: number;
}

export const DEFAULT_HITL_CONFIG: HitlConfig = {
  enabled: true,
  mode: 'auto-approve-safe',
  requiredForRisks: ['critical'],
  tokenTtlSeconds: 300
};

export interface ConfirmationRequest {
  toolName: string;
  args: unknown;
  riskLevel: string;
  traceId: string;
}

export type ApprovalHandler = (req: ConfirmationRequest) => Promise<boolean> | boolean;

export class HitlGate {
  private readonly config: HitlConfig;
  private readonly activeTokens = new Map<string, { expiresAt: number; toolName: string }>();
  private customHandler?: ApprovalHandler;

  constructor(config: Partial<HitlConfig> = {}, handler?: ApprovalHandler) {
    this.config = { ...DEFAULT_HITL_CONFIG, ...config };
    this.customHandler = handler;
  }

  /**
   * Set custom approval callback (e.g. for desktop or terminal UI).
   */
  setHandler(handler: ApprovalHandler): void {
    this.customHandler = handler;
  }

  /**
   * Issue a one-time pre-approval token for a tool.
   */
  issueToken(toolName: string): string {
    const token = `hitl_${randomBytes(16).toString('hex')}`;
    const expiresAt = Date.now() + this.config.tokenTtlSeconds * 1000;
    this.activeTokens.set(token, { expiresAt, toolName });
    return token;
  }

  /**
   * Validate whether a tool call is approved.
   */
  async checkApproval(req: ConfirmationRequest, providedToken?: string): Promise<{ approved: boolean; reason?: string }> {
    if (!this.config.enabled) {
      return { approved: true };
    }

    // Check if this risk level requires confirmation
    const requiresCheck = this.config.requiredForRisks.includes(
      req.riskLevel as 'low' | 'medium' | 'high' | 'critical'
    );

    if (!requiresCheck) {
      return { approved: true };
    }

    // 1. Check one-time confirmation token if provided
    if (providedToken && this.validateToken(providedToken, req.toolName)) {
      logger.info({ toolName: req.toolName, traceId: req.traceId }, 'HITL token approved');
      return { approved: true };
    }

    // 2. Delegate to custom handler if registered
    if (this.customHandler) {
      try {
        const approved = await this.customHandler(req);
        if (approved) {
          logger.info({ toolName: req.toolName, traceId: req.traceId }, 'HITL callback approved');
          return { approved: true };
        }
        return { approved: false, reason: 'Denied by operator approval handler' };
      } catch (err) {
        logger.error({ err, toolName: req.toolName }, 'HITL approval handler error');
        return { approved: false, reason: `Approval handler failed: ${(err as Error).message}` };
      }
    }

    // Gated and unconfirmed
    return {
      approved: false,
      reason: `Tool '${req.toolName}' has '${req.riskLevel}' risk and requires operator confirmation token`
    };
  }

  private validateToken(token: string, toolName: string): boolean {
    const entry = this.activeTokens.get(token);
    if (!entry) return false;

    // One-time use: delete on validation
    this.activeTokens.delete(token);

    if (Date.now() > entry.expiresAt) {
      return false;
    }

    return entry.toolName === toolName || entry.toolName === '*';
  }
}
