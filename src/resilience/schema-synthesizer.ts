/**
 * SchemaSynthesizer — self-healing schema coercion and argument repair.
 * Automatically coerces common LLM serialization anomalies (e.g. "true" -> true,
 * "42" -> 42, comma strings -> arrays) to conform to declared tool schemas.
 */

import type { ToolDefinition } from '../connectors/connector.js';
import { createLogger } from '../observability/logging.js';

const logger = createLogger('schema-synthesizer');

export class SchemaSynthesizer {
  /**
   * Coerce arguments to match the declared JSON Schema properties.
   * Returns a repaired shallow/deep copy without mutating original.
   */
  static coerceArguments(
    args: Record<string, unknown>,
    schema?: ToolDefinition['inputSchema']
  ): Record<string, unknown> {
    if (!schema || !schema.properties || typeof args !== 'object' || args === null) {
      return args;
    }

    const repaired: Record<string, unknown> = { ...args };
    const properties = schema.properties as Record<string, { type?: string; items?: { type?: string } }>;

    for (const [key, propSchema] of Object.entries(properties)) {
      if (!(key in repaired) || repaired[key] === undefined || repaired[key] === null) {
        continue;
      }

      const val = repaired[key];
      const targetType = propSchema.type;

      if (targetType === 'boolean') {
        repaired[key] = this.coerceBoolean(val);
      } else if (targetType === 'number' || targetType === 'integer') {
        repaired[key] = this.coerceNumber(val);
      } else if (targetType === 'array') {
        repaired[key] = this.coerceArray(val);
      } else if (targetType === 'string' && typeof val !== 'string') {
        repaired[key] = String(val);
      }
    }

    return repaired;
  }

  private static coerceBoolean(val: unknown): unknown {
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') {
      const lower = val.trim().toLowerCase();
      if (lower === 'true' || lower === '1' || lower === 'yes') return true;
      if (lower === 'false' || lower === '0' || lower === 'no') return false;
    }
    if (typeof val === 'number') {
      return val !== 0;
    }
    return val;
  }

  private static coerceNumber(val: unknown): unknown {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') {
      const trimmed = val.trim();
      const parsed = Number(trimmed);
      if (!isNaN(parsed) && trimmed !== '') {
        return parsed;
      }
    }
    return val;
  }

  private static coerceArray(val: unknown): unknown {
    if (Array.isArray(val)) return val;
    if (typeof val === 'string') {
      // Split comma-delimited strings
      return val
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
    return [val];
  }
}
