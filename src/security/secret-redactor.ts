/**
 * SecretRedactor — scans strings for secret patterns and replaces them
 * with [REDACTED:type] BEFORE writing to logs or audit trail.
 *
 * CRITICAL: originals are NEVER modified — this only applies to
 * log/audit copies. The actual data flowing to downstream servers is untouched.
 *
 * Built-in patterns cover:
 *   - AWS access/secret keys
 *   - GitHub / GitLab tokens
 *   - Generic Bearer tokens
 *   - Private keys (PEM)
 *   - Database connection strings
 *   - API key patterns (sk-, pk-, xoxb-, etc.)
 *   - JWT tokens
 *   - Passwords in URLs
 */

export interface RedactionPattern {
  name: string;
  pattern: RegExp;
  replacement: string | ((match: string, ...args: any[]) => string);
}

export interface RedactorConfig {
  enabled: boolean;
  /** Additional patterns to merge with built-ins */
  extraPatterns?: RedactionPattern[];
}

// ── Built-in patterns ─────────────────────────────────────────────────────────

const BUILTIN_PATTERNS: RedactionPattern[] = [
  // AWS
  { name: 'aws-access-key', pattern: /AKIA[0-9A-Z]{16}/g, replacement: '[REDACTED:aws-access-key]' },
  { name: 'aws-secret-key', pattern: /(?:aws_secret|secret_access_key)[=:]["']?\s*[A-Za-z0-9/+=]{40}/gi, replacement: '[REDACTED:aws-secret-key]' },

  // GitHub / GitLab
  { name: 'github-token', pattern: /ghp_[A-Za-z0-9]{36}/g, replacement: '[REDACTED:github-token]' },
  { name: 'github-app-token', pattern: /ghs_[A-Za-z0-9]{36}/g, replacement: '[REDACTED:github-app-token]' },
  { name: 'gitlab-token', pattern: /glpat-[A-Za-z0-9_-]{20}/g, replacement: '[REDACTED:gitlab-token]' },

  // Stripe / Square
  { name: 'stripe-key', pattern: /(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{24,}/g, replacement: '[REDACTED:stripe-key]' },

  // Slack
  { name: 'slack-token', pattern: /xox[baprs]-[A-Za-z0-9-]{10,}/g, replacement: '[REDACTED:slack-token]' },

  // JWT
  { name: 'jwt', pattern: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, replacement: '[REDACTED:jwt]' },

  // PEM private keys
  { name: 'pem-key', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, replacement: '[REDACTED:private-key]' },

  // Bearer tokens in Authorization header values
  { name: 'bearer-token', pattern: /bearer\s+[A-Za-z0-9\-._~+/]{20,}/gi, replacement: 'Bearer [REDACTED:bearer-token]' },

  // Database connection strings
  { name: 'db-url', pattern: /(?:postgres|mysql|mongodb|redis|mssql):\/\/[^:]+:[^@]+@[^\s"']+/gi, replacement: '[REDACTED:db-url]' },

  // Passwords in key=value forms
  { name: 'password', pattern: /(?:password|passwd|pwd|secret)[=:]["']?[^\s"',;}{]{4,}/gi, replacement: (match: string) => match.split(/[=:]/)[0] + '=[REDACTED:password]' },

  // Generic API keys
  { name: 'api-key', pattern: /api[_-]?key[=:]["']\s*[A-Za-z0-9\-_.]{16,}/gi, replacement: '[REDACTED:api-key]' },

  // OpenAI keys
  { name: 'openai-key', pattern: /sk-[A-Za-z0-9]{32,}/g, replacement: '[REDACTED:openai-key]' },

  // Anthropic keys
  { name: 'anthropic-key', pattern: /sk-ant-[A-Za-z0-9\-_]{40,}/g, replacement: '[REDACTED:anthropic-key]' }
];

// ── Redactor ──────────────────────────────────────────────────────────────────

export class SecretRedactor {
  private readonly patterns: RedactionPattern[];
  private readonly enabled: boolean;

  constructor(config: RedactorConfig = { enabled: true }) {
    this.enabled = config.enabled;
    this.patterns = [...BUILTIN_PATTERNS, ...(config.extraPatterns ?? [])];
  }

  /**
   * Redact secrets from a string value.
   * Returns a new string with secrets replaced — original is unchanged.
   */
  redactString(input: string): string {
    if (!this.enabled) return input;

    let result = input;
    for (const { pattern, replacement } of this.patterns) {
      // Reset lastIndex for global regexes
      pattern.lastIndex = 0;
      result = result.replace(pattern, replacement as any);
    }
    return result;
  }

  /**
   * Deep-redact an object for safe logging.
   * Returns a new deep copy with all string values redacted.
   * Non-string primitives pass through unchanged.
   */
  redactForLogging(value: unknown): unknown {
    if (!this.enabled) return value;
    return this.deepRedact(value);
  }

  private deepRedact(value: unknown): unknown {
    if (typeof value === 'string') {
      return this.redactString(value);
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.deepRedact(item));
    }
    if (value !== null && typeof value === 'object') {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        if (this.isSecretKey(key) && (val === null || typeof val !== 'object')) {
          result[key] = '[REDACTED:sensitive-field]';
        } else {
          result[key] = this.deepRedact(val);
        }
      }
      return result;
    }
    return value;
  }

  private isSecretKey(key: string): boolean {
    const lower = key.toLowerCase();
    return ['password', 'secret', 'token', 'api_key', 'apikey', 'credential',
      'private_key', 'privatekey', 'auth', 'authorization', 'passwd'].some((k) =>
      lower.includes(k)
    );
  }
}

/** Module-level singleton for import convenience */
export const defaultRedactor = new SecretRedactor({ enabled: true });
