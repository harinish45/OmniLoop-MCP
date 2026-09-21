/**
 * OutputScrubber — scans tool results from downstream servers BEFORE
 * they are returned to the LLM client.
 *
 * Defense goals:
 *   1. Prompt injection — block attempts to override system prompt
 *   2. Hidden instruction patterns — detect zero-width chars, base64 encoded commands
 *   3. Shell command injection in text — flag suspicious shell syntax
 *   4. HTML/script tag sanitization — strip script/iframe tags from text content
 *
 * Strategy: flag and optionally block — operators choose severity.
 */

import { createLogger } from '../observability/logging.js';

const logger = createLogger('output-scrubber');

export interface ScrubberConfig {
  enabled: boolean;
  /** If true, block results that contain injection attempts. If false, log-only. */
  blockPromptInjection: boolean;
  /** If true, strip HTML script/iframe tags from text content */
  stripHtml: boolean;
}

export const DEFAULT_SCRUBBER_CONFIG: ScrubberConfig = {
  enabled: true,
  blockPromptInjection: true,
  stripHtml: true
};

export interface ScrubResult {
  clean: boolean;
  /** If clean=false and blocking enabled, this replaces the original content */
  sanitizedContent?: string;
  threats: string[];
}

// ── Threat patterns ───────────────────────────────────────────────────────────

/** Prompt injection markers */
const INJECTION_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'system-override', pattern: /(?:^|\n)\s*SYSTEM\s*:/i },
  { name: 'ignore-instructions', pattern: /ignore\s+(?:all\s+)?(?:previous|above|prior)\s+instructions?/i },
  { name: 'new-instructions', pattern: /(?:your\s+new\s+instructions?|from\s+now\s+on[\s,]+you\s+(?:are|must|should))/i },
  { name: 'assistant-role', pattern: /\[(?:ASSISTANT|AI|GPT|CLAUDE|SYSTEM)\]\s*:/i },
  { name: 'xml-injection', pattern: /<\/(?:tool|function|result|system|human|assistant)>/i },
  { name: 'openai-delimiters', pattern: /<\|(?:im_start|im_end|endoftext|fim_prefix)\|>/i },
  { name: 'hidden-unicode', pattern: /[\u200B-\u200D\u2060\uFEFF\u00AD]/g }, // Zero-width, soft hyphen
  { name: 'jailbreak-token', pattern: /(?:DAN|STAN|DUDE|JAILBREAK)\s+mode/i }
];

/** Suspicious shell patterns (warn only — not blocked by default) */
const SHELL_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: 'eval', pattern: /\beval\s*\(/i },
  { name: 'exec', pattern: /\bexec\s*\(/i },
  { name: 'rm-rf', pattern: /rm\s+-[rf]+/i },
  { name: 'curl-pipe', pattern: /curl\s+.*\|\s*(?:bash|sh|zsh)/i },
  { name: 'wget-pipe', pattern: /wget\s+.*\|\s*(?:bash|sh|zsh)/i }
];

/** HTML tags to strip */
const HTML_STRIP_PATTERN = /<script[\s\S]*?<\/script>|<iframe[\s\S]*?<\/iframe>|<style[\s\S]*?<\/style>/gi;

// ── Scrubber ──────────────────────────────────────────────────────────────────

export class OutputScrubber {
  private readonly config: ScrubberConfig;

  constructor(config: Partial<ScrubberConfig> = {}) {
    this.config = { ...DEFAULT_SCRUBBER_CONFIG, ...config };
  }

  /**
   * Scrub a text value from tool output.
   * @returns ScrubResult with threat list and optionally sanitized replacement
   */
  scrubText(text: string, toolName: string): ScrubResult {
    if (!this.config.enabled) {
      return { clean: true, threats: [] };
    }

    const threats: string[] = [];

    // 1. Check for prompt injection patterns
    for (const { name, pattern } of INJECTION_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        threats.push(name);
      }
    }

    if (threats.length > 0) {
      logger.warn({ toolName, threats }, 'Prompt injection detected in tool output');

      if (this.config.blockPromptInjection) {
        const blocked = `[OmniLoop: Output blocked — potential prompt injection detected. Threats: ${threats.join(', ')}]`;
        return { clean: false, sanitizedContent: blocked, threats };
      }
    }

    // 2. Check for suspicious shell commands (warn only)
    const shellThreats: string[] = [];
    for (const { name, pattern } of SHELL_PATTERNS) {
      pattern.lastIndex = 0;
      if (pattern.test(text)) {
        shellThreats.push(name);
      }
    }
    if (shellThreats.length > 0) {
      logger.warn({ toolName, shellThreats }, 'Suspicious shell patterns in tool output (not blocked)');
    }

    // 3. Strip HTML if configured
    let sanitized = text;
    if (this.config.stripHtml) {
      HTML_STRIP_PATTERN.lastIndex = 0;
      sanitized = text.replace(HTML_STRIP_PATTERN, '[HTML_STRIPPED]');
    }

    return {
      clean: threats.length === 0,
      sanitizedContent: sanitized !== text ? sanitized : undefined,
      threats: [...threats, ...shellThreats]
    };
  }

  /**
   * Scrub all text content items in a tool result.
   * Returns a new content array (original unchanged).
   */
  scrubContentItems(
    content: Array<{ type: string; [key: string]: unknown }>,
    toolName: string
  ): { items: typeof content; blocked: boolean; threats: string[] } {
    if (!this.config.enabled) {
      return { items: content, blocked: false, threats: [] };
    }

    const allThreats: string[] = [];
    let blocked = false;
    const items = content.map((item) => {
      if (item.type !== 'text' || typeof item['text'] !== 'string') return item;

      const result = this.scrubText(item['text'] as string, toolName);
      allThreats.push(...result.threats);

      if (!result.clean && result.sanitizedContent !== undefined) {
        blocked = true;
        return { type: 'text' as const, text: result.sanitizedContent };
      }
      if (result.sanitizedContent !== undefined) {
        return { type: 'text' as const, text: result.sanitizedContent };
      }
      return item;
    });

    return { items, blocked, threats: allThreats };
  }
}
