/**
 * AuditLogger — append-only, tamper-evident JSONL audit trail.
 *
 * Every tool call is recorded with:
 *   - traceId, timestamp, toolName, serverId
 *   - redacted args and result (secrets masked)
 *   - riskLevel, authorization decision, verification outcome
 *   - SHA-256 chain hash (each entry hashes previous entry + current entry)
 *
 * The chain hash makes retrospective tampering detectable.
 * Supports log rotation by day and configurable retention.
 */

import { createWriteStream, mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { createLogger } from '../observability/logging.js';

const logger = createLogger('audit');

export interface AuditEvent {
  traceId: string;
  timestamp: string;
  toolName: string;
  serverId: string;
  /** Redacted (secrets masked) */
  args: unknown;
  /** Redacted result summary */
  resultSummary: string;
  riskLevel: string;
  authorized: boolean;
  verificationPassed: boolean;
  durationMs: number;
  cacheHit: boolean;
  idempotencyHit: boolean;
  threatDetected: boolean;
  threats: string[];
  /** SHA-256(prevHash + JSON.stringify(eventWithoutHash)) */
  chainHash?: string;
}

export interface AuditConfig {
  enabled: boolean;
  directory: string;
  retentionDays: number;
}

export const DEFAULT_AUDIT_CONFIG: AuditConfig = {
  enabled: true,
  directory: './logs/audit',
  retentionDays: 90
};

export class AuditLogger {
  private _prevHash = '0'.repeat(64); // Genesis hash
  private _stream?: ReturnType<typeof createWriteStream>;
  private _currentDate = '';
  private readonly config: AuditConfig;

  constructor(config: Partial<AuditConfig> = {}) {
    this.config = { ...DEFAULT_AUDIT_CONFIG, ...config };
  }

  /** Initialize audit directory and open today's log stream */
  initialize(): void {
    if (!this.config.enabled) return;

    if (!existsSync(this.config.directory)) {
      mkdirSync(this.config.directory, { recursive: true });
    }

    this.rotateTo(this.todayString());
    this.cleanOldLogs();
    logger.info({ directory: this.config.directory }, 'Audit logger initialized');
  }

  /**
   * Write an audit event.
   * Computes chain hash before writing.
   */
  write(event: Omit<AuditEvent, 'chainHash'>): void {
    if (!this.config.enabled) return;

    // Rotate if date changed
    const today = this.todayString();
    if (today !== this._currentDate) {
      this.rotateTo(today);
    }

    // Compute chain hash
    const eventJson = JSON.stringify(event);
    const chainHash = createHash('sha256')
      .update(this._prevHash + eventJson)
      .digest('hex');

    this._prevHash = chainHash;

    const fullEvent: AuditEvent = { ...event, chainHash };
    const line = JSON.stringify(fullEvent) + '\n';

    this._stream?.write(line, (err) => {
      if (err) {
        logger.error({ err }, 'Failed to write audit event');
      }
    });
  }

  /** Close the audit stream gracefully */
  async close(): Promise<void> {
    return new Promise((resolve) => {
      if (!this._stream) { resolve(); return; }
      this._stream.end(resolve);
    });
  }

  private rotateTo(date: string): void {
    this._stream?.end();
    const filename = join(this.config.directory, `audit-${date}.jsonl`);
    this._stream = createWriteStream(filename, { flags: 'a' });
    this._currentDate = date;
    logger.debug({ filename }, 'Audit log rotated');
  }

  private cleanOldLogs(): void {
    const cutoff = Date.now() - this.config.retentionDays * 86_400_000;
    try {
      const files = readdirSync(this.config.directory).filter((f) => f.startsWith('audit-'));
      for (const file of files) {
        const filePath = join(this.config.directory, file);
        const mtime = statSync(filePath).mtimeMs;
        if (mtime < cutoff) {
          unlinkSync(filePath);
          logger.info({ file }, 'Old audit log deleted (retention policy)');
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Error during audit log cleanup');
    }
  }

  private todayString(): string {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  }
}
