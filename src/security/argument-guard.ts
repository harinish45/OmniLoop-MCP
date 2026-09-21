/**
 * ArgumentGuard — validates all tool arguments against the tool's declared
 * JSON Schema BEFORE the call reaches the downstream server.
 *
 * Defense goals:
 *   1. Schema conformance — reject calls that don't match declared inputSchema
 *   2. Depth bomb protection — max nesting depth 10
 *   3. Size bomb protection — max 1MB per payload
 *   4. No extra properties — prevents injection via undeclared fields
 */

import _Ajv, { type ValidateFunction } from 'ajv';
import _addFormats from 'ajv-formats';
import type { ToolDefinition } from '../connectors/connector.js';
import { createLogger } from '../observability/logging.js';

// Support both ESM and CJS bundle shapes under NodeNext
const AjvClass: any = (_Ajv as unknown as { default: any }).default ?? _Ajv;
const addFormatsFunc: any = (_addFormats as unknown as { default: any }).default ?? _addFormats;

const logger = createLogger('argument-guard');

export interface GuardConfig {
  enabled: boolean;
  maxDepth: number;
  maxPayloadBytes: number;
  /** Whether to reject extra properties not in schema (default: false — warn only) */
  strictExtraProperties: boolean;
}

export const DEFAULT_GUARD_CONFIG: GuardConfig = {
  enabled: true,
  maxDepth: 10,
  maxPayloadBytes: 1_048_576, // 1 MB
  strictExtraProperties: false
};

export interface GuardResult {
  valid: boolean;
  errors: string[];
}

export class ArgumentGuard {
  private readonly ajv: any;
  /** Cache compiled validators per namespaced tool name */
  private readonly _validators = new Map<string, ValidateFunction>();
  private readonly config: GuardConfig;

  constructor(config: Partial<GuardConfig> = {}) {
    this.config = { ...DEFAULT_GUARD_CONFIG, ...config };
    this.ajv = new AjvClass({
      allErrors: true,
      strict: false,
      coerceTypes: false
    });
    addFormatsFunc(this.ajv);
  }

  /** Pre-compile a validator for a tool's input schema */
  registerTool(namespacedName: string, tool: ToolDefinition): void {
    try {
      const schema = {
        ...tool.inputSchema,
        additionalProperties: this.config.strictExtraProperties ? false : tool.inputSchema.additionalProperties
      };
      const validator = this.ajv.compile(schema);
      this._validators.set(namespacedName, validator);
    } catch (err) {
      // Malformed schema from downstream — log and skip validation for this tool
      logger.warn({ namespacedName, err }, 'Failed to compile tool schema — argument guard disabled for this tool');
    }
  }

  /** Remove a tool's validator (called on deregister) */
  deregisterTool(namespacedName: string): void {
    this._validators.delete(namespacedName);
  }

  /**
   * Validate arguments for a tool call.
   * @returns GuardResult — check .valid before proceeding
   */
  validate(namespacedName: string, args: unknown): GuardResult {
    if (!this.config.enabled) {
      return { valid: true, errors: [] };
    }

    const errors: string[] = [];

    // 1. Size check — fast, before any deep parsing
    const serialized = JSON.stringify(args);
    if (serialized.length > this.config.maxPayloadBytes) {
      return {
        valid: false,
        errors: [`Argument payload exceeds maximum size (${this.config.maxPayloadBytes} bytes)`]
      };
    }

    // 2. Depth check
    const depth = this.measureDepth(args);
    if (depth > this.config.maxDepth) {
      return {
        valid: false,
        errors: [`Argument nesting depth ${depth} exceeds maximum (${this.config.maxDepth})`]
      };
    }

    // 3. Schema validation
    const validator = this._validators.get(namespacedName);
    if (!validator) {
      // No schema registered — allow but log
      logger.debug({ namespacedName }, 'No schema registered for tool — skipping schema validation');
      return { valid: true, errors: [] };
    }

    const valid = validator(args) as boolean;
    if (!valid && validator.errors) {
      for (const err of validator.errors) {
        const field = err.instancePath || 'root';
        errors.push(`${field}: ${err.message ?? 'validation failed'}`);
      }
      logger.warn({ namespacedName, errors }, 'Argument validation failed');
      return { valid: false, errors };
    }

    return { valid: true, errors: [] };
  }

  /** Recursively measure the nesting depth of a value */
  private measureDepth(value: unknown, current = 0): number {
    if (current > this.config.maxDepth) return current; // early exit
    if (value === null || typeof value !== 'object') return current;

    const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
    if (children.length === 0) return current;

    return Math.max(...children.map((child) => this.measureDepth(child, current + 1)));
  }
}
