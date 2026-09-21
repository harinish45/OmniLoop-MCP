/**
 * In-memory metrics counters for the OmniLoop gateway.
 * Tracks tool calls, routing errors, connector health, and latency buckets.
 * Design: pure in-process — no external dependency required for Phase 7.
 * Can be replaced with Prometheus/OpenTelemetry exporter later.
 */

export interface ToolCallMetric {
  serverId: string;
  toolName: string;
  totalCalls: number;
  successCalls: number;
  errorCalls: number;
  totalLatencyMs: number;
  lastCalledAt?: Date;
}

export interface GatewayMetrics {
  startedAt: Date;
  totalToolCalls: number;
  totalErrors: number;
  verificationLoopsStarted: number;
  verificationLoopsPassed: number;
  verificationLoopsFailed: number;
  /** Per-tool breakdown */
  byTool: Map<string, ToolCallMetric>;
  /** Per-server health history (last 10 checks) */
  byServer: Map<string, { healthy: number; offline: number; lastStatus: string }>;
}

/** Singleton metrics store */
const _metrics: GatewayMetrics = {
  startedAt: new Date(),
  totalToolCalls: 0,
  totalErrors: 0,
  verificationLoopsStarted: 0,
  verificationLoopsPassed: 0,
  verificationLoopsFailed: 0,
  byTool: new Map(),
  byServer: new Map()
};

/** Record a tool call outcome */
export function recordToolCall(
  serverId: string,
  toolName: string,
  success: boolean,
  latencyMs: number
): void {
  const key = `${serverId}.${toolName}`;
  _metrics.totalToolCalls++;
  if (!success) _metrics.totalErrors++;

  let metric = _metrics.byTool.get(key);
  if (!metric) {
    metric = { serverId, toolName, totalCalls: 0, successCalls: 0, errorCalls: 0, totalLatencyMs: 0 };
    _metrics.byTool.set(key, metric);
  }
  metric.totalCalls++;
  metric.totalLatencyMs += latencyMs;
  metric.lastCalledAt = new Date();
  if (success) {
    metric.successCalls++;
  } else {
    metric.errorCalls++;
  }
}

/** Record a server health check result */
export function recordHealthCheck(serverId: string, healthy: boolean): void {
  let server = _metrics.byServer.get(serverId);
  if (!server) {
    server = { healthy: 0, offline: 0, lastStatus: 'unknown' };
    _metrics.byServer.set(serverId, server);
  }
  if (healthy) {
    server.healthy++;
    server.lastStatus = 'healthy';
  } else {
    server.offline++;
    server.lastStatus = 'offline';
  }
}

/** Record verification loop outcome */
export function recordVerificationLoop(passed: boolean): void {
  _metrics.verificationLoopsStarted++;
  if (passed) {
    _metrics.verificationLoopsPassed++;
  } else {
    _metrics.verificationLoopsFailed++;
  }
}

/** Get a snapshot of current metrics */
export function getMetrics(): Readonly<GatewayMetrics> {
  return _metrics;
}

/** Format metrics as a human-readable summary (for dashboard/status endpoint) */
export function formatMetricsSummary(): string {
  const uptimeMs = Date.now() - _metrics.startedAt.getTime();
  const uptimeSec = Math.round(uptimeMs / 1000);

  const lines: string[] = [
    `Gateway uptime: ${uptimeSec}s`,
    `Total tool calls: ${_metrics.totalToolCalls}`,
    `Total errors: ${_metrics.totalErrors}`,
    `Verification loops: ${_metrics.verificationLoopsStarted} started, ` +
      `${_metrics.verificationLoopsPassed} passed, ${_metrics.verificationLoopsFailed} failed`
  ];

  for (const [key, m] of _metrics.byTool.entries()) {
    const avgLatency = m.totalCalls > 0 ? Math.round(m.totalLatencyMs / m.totalCalls) : 0;
    lines.push(`  ${key}: ${m.successCalls} ok / ${m.errorCalls} err / avg ${avgLatency}ms`);
  }

  return lines.join('\n');
}
