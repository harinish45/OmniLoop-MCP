/**
 * AnomalyDetector — detects model confusion, infinite loops,
 * velocity spikes, and high-entropy suspicious payloads.
 */

import { createHash } from 'crypto';
import { createLogger } from '../observability/logging.js';

const logger = createLogger('anomaly-detector');

export interface AnomalyConfig {
  enabled: boolean;
  /** Max identical calls to a tool within the window before triggering loop alert */
  maxIdenticalCallsInWindow: number;
  /** Window duration in milliseconds (default: 10,000ms = 10s) */
  windowMs: number;
  /** Max Shannon entropy threshold for arguments (default: 5.5) */
  maxEntropyThreshold: number;
}

export const DEFAULT_ANOMALY_CONFIG: AnomalyConfig = {
  enabled: true,
  maxIdenticalCallsInWindow: 5,
  windowMs: 10_000,
  maxEntropyThreshold: 5.8
};

export interface AnomalyCheckResult {
  anomalous: boolean;
  reasons: string[];
}

interface CallSignatureRecord {
  signature: string;
  timestamps: number[];
}

export class AnomalyDetector {
  private readonly config: AnomalyConfig;
  /** Hash -> CallSignatureRecord */
  private readonly history = new Map<string, CallSignatureRecord>();

  constructor(config: Partial<AnomalyConfig> = {}) {
    this.config = { ...DEFAULT_ANOMALY_CONFIG, ...config };
  }

  /**
   * Evaluate a tool call for anomalies.
   */
  evaluate(toolName: string, args: unknown): AnomalyCheckResult {
    if (!this.config.enabled) {
      return { anomalous: false, reasons: [] };
    }

    const reasons: string[] = [];
    const now = Date.now();

    // 1. Loop detection
    const sig = this.computeSignature(toolName, args);
    const loopDetected = this.checkLoopBomb(sig, now);
    if (loopDetected) {
      reasons.push(
        `Runaway loop detected: ${toolName} invoked ${this.config.maxIdenticalCallsInWindow} times in ${this.config.windowMs}ms with identical arguments`
      );
    }

    // 2. Entropy analysis on string payloads
    const highEntropyViolation = this.checkEntropy(args);
    if (highEntropyViolation) {
      reasons.push(highEntropyViolation);
    }

    if (reasons.length > 0) {
      logger.warn({ toolName, reasons }, 'Tool call anomaly detected');
    }

    return {
      anomalous: reasons.length > 0,
      reasons
    };
  }

  /**
   * Reset tracking history (e.g. for testing).
   */
  clear(): void {
    this.history.clear();
  }

  /**
   * Calculate Shannon entropy of a string (bits per symbol).
   * Range is 0 to 8 for byte data. Normal English text is ~3.5 to 4.5.
   * Obfuscated / encrypted / base64 ciphertext is usually > 5.5.
   */
  static calculateEntropy(text: string): number {
    if (!text || text.length === 0) return 0;

    const frequencies = new Map<string, number>();
    for (const char of text) {
      frequencies.set(char, (frequencies.get(char) ?? 0) + 1);
    }

    let entropy = 0;
    const len = text.length;
    for (const count of frequencies.values()) {
      const p = count / len;
      entropy -= p * Math.log2(p);
    }

    return entropy;
  }

  private computeSignature(toolName: string, args: unknown): string {
    const raw = JSON.stringify({ toolName, args });
    return createHash('sha256').update(raw).digest('hex').slice(0, 32);
  }

  private checkLoopBomb(sig: string, now: number): boolean {
    let record = this.history.get(sig);
    if (!record) {
      record = { signature: sig, timestamps: [] };
      this.history.set(sig, record);
    }

    // Filter out timestamps outside rolling window
    const cutoff = now - this.config.windowMs;
    record.timestamps = record.timestamps.filter((t) => t > cutoff);
    record.timestamps.push(now);

    return record.timestamps.length >= this.config.maxIdenticalCallsInWindow;
  }

  private checkEntropy(args: unknown): string | undefined {
    if (typeof args === 'string' && args.length > 64) {
      const entropy = AnomalyDetector.calculateEntropy(args);
      if (entropy > this.config.maxEntropyThreshold) {
        return `High entropy payload (${entropy.toFixed(2)} > ${this.config.maxEntropyThreshold}) - potential obfuscation`;
      }
    }

    if (args !== null && typeof args === 'object') {
      for (const [key, val] of Object.entries(args as Record<string, unknown>)) {
        if (typeof val === 'string' && val.length > 64) {
          const entropy = AnomalyDetector.calculateEntropy(val);
          if (entropy > this.config.maxEntropyThreshold) {
            return `High entropy in property '${key}' (${entropy.toFixed(2)} > ${this.config.maxEntropyThreshold})`;
          }
        }
      }
    }

    return undefined;
  }
}
