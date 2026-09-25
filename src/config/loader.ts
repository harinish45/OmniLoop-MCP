/**
 * Config loader — reads omniloop.yaml, substitutes ${ENV_VAR} references,
 * merges with centralized defaults, and validates the result against the Zod schema.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { OmniLoopConfigSchema, type OmniLoopConfig } from './schema.js';
import { ALL_DEFAULTS, mergeWithDefaults } from './defaults.js';

/** Regex matching ${VAR_NAME} placeholders */
const ENV_VAR_PATTERN = /\$\{([A-Z0-9_]+)\}/g;

/**
 * Recursively walks a parsed YAML object and substitutes all
 * ${ENV_VAR} string references with their process.env values.
 * Throws if a referenced variable is not set.
 */
function substituteEnvVars(value: unknown, context: string): unknown {
  if (typeof value === 'string') {
    return value.replace(ENV_VAR_PATTERN, (_match, varName: string) => {
      const envValue = process.env[varName];
      if (envValue === undefined) {
        throw new Error(
          `Config error at "${context}": environment variable \${${varName}} is not set`
        );
      }
      return envValue;
    });
  }

  if (Array.isArray(value)) {
    return value.map((item, idx) => substituteEnvVars(item, `${context}[${idx}]`));
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = substituteEnvVars(val, `${context}.${key}`);
    }
    return result;
  }

  return value;
}

/**
 * Load and validate the OmniLoop gateway configuration.
 *
 * @param configPath  Absolute or relative path to omniloop.yaml
 * @returns           Validated OmniLoopConfig
 * @throws            If file not found, YAML is invalid, env vars missing, or schema fails
 */
export function loadConfig(configPath: string): OmniLoopConfig {
  const absolutePath = path.resolve(configPath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Config file not found: ${absolutePath}`);
  }

  const raw = fs.readFileSync(absolutePath, 'utf-8');

  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (err) {
    throw new Error(`YAML parse error in ${absolutePath}: ${(err as Error).message}`);
  }

  // Substitute environment variable references before schema validation
  const substituted = substituteEnvVars(parsed, 'root');

  // Merge user config with centralized defaults
  const merged = mergeWithDefaults(substituted as Partial<OmniLoopConfig>, ALL_DEFAULTS);

  const result = OmniLoopConfigSchema.safeParse(merged);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  • ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Config validation failed:\n${issues}`);
  }

  return result.data;
}
