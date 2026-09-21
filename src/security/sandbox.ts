/**
 * Sandbox — execution isolation, path traversal defense,
 * SSRF network boundary enforcement, and shell argument sanitization.
 */

import { resolve, normalize } from 'path';
import { createLogger } from '../observability/logging.js';

const logger = createLogger('sandbox');

export interface SandboxConfig {
  enabled: boolean;
  /** Allowed root directories for file operations */
  allowedPaths: string[];
  /** Whether to block private/internal IP requests in URL parameters */
  blockPrivateNetworks: boolean;
  /** Whether to sanitize shell command strings */
  sanitizeShell: boolean;
}

export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  enabled: true,
  allowedPaths: [],
  blockPrivateNetworks: true,
  sanitizeShell: true
};

export interface SandboxCheckResult {
  allowed: boolean;
  violations: string[];
}

/** Suspicious shell operator pattern */
const DANGEROUS_SHELL_PATTERNS: RegExp[] = [
  /[;&|`$><]/,
  /\b(eval|exec|spawn|fork)\b/i,
  /\b(bash|sh|zsh|cmd\.exe|powershell|pwsh)\b/i,
  /\bInvoke-Expression\b/i
];

/** Private IPv4 address ranges and loopbacks */
const PRIVATE_IP_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/,
  /^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/,
  /^192\.168\.\d{1,3}\.\d{1,3}$/,
  /^169\.254\.\d{1,3}\.\d{1,3}$/, // Cloud metadata endpoint
  /^0\.0\.0\.0$/,
  /^::1$/,
  /^[fF][cCdD]/, // IPv6 Unique Local Address
  /\.local$/i,
  /\.internal$/i
];

export class SandboxGuard {
  private readonly config: SandboxConfig;
  private readonly normalizedAllowedPaths: string[];

  constructor(config: Partial<SandboxConfig> = {}) {
    this.config = { ...DEFAULT_SANDBOX_CONFIG, ...config };
    this.normalizedAllowedPaths = this.config.allowedPaths.map((p) =>
      normalize(resolve(p)).toLowerCase()
    );
  }

  /**
   * Validate all tool arguments against sandbox boundaries.
   */
  validate(args: unknown): SandboxCheckResult {
    if (!this.config.enabled) {
      return { allowed: true, violations: [] };
    }

    const violations: string[] = [];
    this.scanRecursive(args, violations);

    if (violations.length > 0) {
      logger.warn({ violations }, 'Sandbox policy violation detected');
    }

    return {
      allowed: violations.length === 0,
      violations
    };
  }

  /**
   * Check if a filesystem path is safe and stays within allowed directories.
   */
  isPathAllowed(rawPath: string): boolean {
    if (!this.config.enabled) return true;

    // Check for traversal sequences and special Windows data streams
    if (this.hasTraversalSequences(rawPath)) {
      return false;
    }

    if (this.normalizedAllowedPaths.length === 0) {
      return true; // No directory restrictions configured
    }

    const resolved = normalize(resolve(rawPath)).toLowerCase();
    return this.normalizedAllowedPaths.some((allowed) =>
      resolved.startsWith(allowed)
    );
  }

  /**
   * Check if a URL targets a forbidden private or link-local address (SSRF).
   */
  isUrlAllowed(urlString: string): boolean {
    if (!this.config.enabled || !this.config.blockPrivateNetworks) {
      return true;
    }

    try {
      const parsed = new URL(urlString);
      const hostname = parsed.hostname.replace(/^\[|\]$/g, ''); // strip IPv6 brackets

      const isPrivate = PRIVATE_IP_PATTERNS.some((pattern) => pattern.test(hostname));
      return !isPrivate;
    } catch {
      return false; // Malformed URL
    }
  }

  /**
   * Check if a shell argument contains dangerous command injection operators.
   */
  isShellSafe(commandString: string): boolean {
    if (!this.config.enabled || !this.config.sanitizeShell) {
      return true;
    }
    return !DANGEROUS_SHELL_PATTERNS.some((pattern) => pattern.test(commandString));
  }

  private hasTraversalSequences(rawPath: string): boolean {
    const lower = rawPath.toLowerCase();
    return (
      lower.includes('..') ||
      lower.includes('%2e%2e') ||
      lower.includes('::$data') ||
      lower.startsWith('\\\\') // Windows UNC path
    );
  }

  private scanRecursive(val: unknown, violations: string[]): void {
    if (typeof val === 'string') {
      this.scanStringValue(val, violations);
      return;
    }

    if (Array.isArray(val)) {
      for (const item of val) {
        this.scanRecursive(item, violations);
      }
      return;
    }

    if (val !== null && typeof val === 'object') {
      for (const [key, prop] of Object.entries(val as Record<string, unknown>)) {
        this.scanProperty(key, prop, violations);
      }
    }
  }

  private scanProperty(key: string, prop: unknown, violations: string[]): void {
    const lowerKey = key.toLowerCase();
    if (typeof prop === 'string') {
      if (lowerKey.includes('path') || lowerKey.includes('file') || lowerKey.includes('dir')) {
        if (!this.isPathAllowed(prop)) {
          violations.push(`Path traversal or unauthorized path detected in field '${key}': ${prop}`);
        }
      }
      if (lowerKey.includes('url') || lowerKey.includes('uri') || lowerKey.includes('endpoint')) {
        if (!this.isUrlAllowed(prop)) {
          violations.push(`SSRF violation: private/metadata network access forbidden in field '${key}': ${prop}`);
        }
      }
      if (lowerKey.includes('command') || lowerKey.includes('cmd') || lowerKey.includes('script')) {
        if (!this.isShellSafe(prop)) {
          violations.push(`Shell injection pattern detected in field '${key}'`);
        }
      }
      return;
    }
    this.scanRecursive(prop, violations);
  }

  private scanStringValue(str: string, violations: string[]): void {
    if (str.startsWith('http://') || str.startsWith('https://')) {
      if (!this.isUrlAllowed(str)) {
        violations.push(`SSRF forbidden URL detected: ${str}`);
      }
    }
  }
}
