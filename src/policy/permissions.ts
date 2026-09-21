/**
 * Permissions — risk level classification for tools.
 *
 * Risk levels determine what gates apply before a tool call:
 *   low      → automatic execution, no confirmation
 *   medium   → optional confirmation (default: skip)
 *   high     → confirmation required before execution
 *   critical → explicit confirmation required + audit event
 *
 * Classification sources (in priority order):
 *   1. Per-tool override in omniloop.yaml policy.overrides
 *   2. Config-level glob patterns in policy.defaults
 *   3. Built-in heuristics based on tool name prefixes
 */

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** Built-in prefix patterns → risk level */
const BUILTIN_RISK_PREFIXES: Array<[string[], RiskLevel]> = [
  // Critical — data destruction, drops, resets
  [['destroy_', 'drop_', 'truncate_', 'reset_', 'wipe_', 'purge_'], 'critical'],
  // High — deletion and removal
  [['delete_', 'remove_', 'unlink_', 'revoke_', 'terminate_'], 'high'],
  // Medium — mutations
  [['create_', 'write_', 'update_', 'patch_', 'send_', 'push_', 'post_', 'execute_', 'run_', 'deploy_'], 'medium'],
  // Low — reads and discovery
  [['read_', 'get_', 'list_', 'search_', 'describe_', 'fetch_', 'show_', 'query_', 'check_', 'ping_', 'health'], 'low']
];

/**
 * Classify a tool's risk level using built-in heuristics.
 * Falls back to 'medium' if no prefix matches (conservative default).
 */
export function classifyRisk(toolName: string): RiskLevel {
  const lower = toolName.toLowerCase();

  for (const [prefixes, risk] of BUILTIN_RISK_PREFIXES) {
    for (const prefix of prefixes) {
      if (lower.startsWith(prefix) || lower.includes(prefix)) {
        return risk;
      }
    }
  }

  // Unknown tools default to medium — requires opt-in to lower
  return 'medium';
}

/**
 * Resolve the effective risk level for a tool, applying config overrides
 * on top of built-in heuristics.
 *
 * @param toolName        Namespaced tool name, e.g. "github.create_issue"
 * @param overrides       policy.overrides map from config (optional)
 */
export function resolveRisk(
  toolName: string,
  overrides?: Record<string, { risk?: RiskLevel }>
): RiskLevel {
  // Check explicit override first
  const override = overrides?.[toolName];
  if (override?.risk) {
    return override.risk;
  }

  // Also check bare name override
  const bareName = toolName.includes('.') ? toolName.split('.').slice(1).join('.') : toolName;
  const bareOverride = overrides?.[bareName];
  if (bareOverride?.risk) {
    return bareOverride.risk;
  }

  return classifyRisk(bareName || toolName);
}
