/**
 * Prometheus metrics exporter.
 * Exposes GET /metrics in Prometheus text format.
 * Also provides a health endpoint at GET /health.
 *
 * No external Prometheus client library required — we generate
 * the text format directly from our in-process metrics store.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { getMetrics } from './metrics.js';
import { createLogger } from './logging.js';

const logger = createLogger('prometheus');

export interface PrometheusConfig {
  enabled: boolean;
  port: number;
  host: string;
}

export const DEFAULT_PROMETHEUS_CONFIG: PrometheusConfig = {
  enabled: false, // opt-in
  port: 9090,
  host: '127.0.0.1'
};

export interface HealthConfig {
  enabled: boolean;
  port: number;
  host: string;
}

// ── Prometheus text format helpers ────────────────────────────────────────────

function gauge(name: string, help: string, value: number, labels: Record<string, string> = {}): string {
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
    .join(',');
  const labelPart = labelStr ? `{${labelStr}}` : '';
  return `# HELP ${name} ${help}\n# TYPE ${name} gauge\n${name}${labelPart} ${value}\n`;
}

function counter(name: string, help: string, value: number, labels: Record<string, string> = {}): string {
  const labelStr = Object.entries(labels)
    .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
    .join(',');
  const labelPart = labelStr ? `{${labelStr}}` : '';
  return `# HELP ${name} ${help}\n# TYPE ${name} counter\n${name}${labelPart} ${value}\n`;
}

/** Generate the full Prometheus metrics text */
function generateMetricsText(): string {
  const m = getMetrics();
  const lines: string[] = [];
  const uptimeSec = (Date.now() - m.startedAt.getTime()) / 1000;

  lines.push(gauge('omniloop_uptime_seconds', 'Gateway uptime in seconds', uptimeSec));
  lines.push(counter('omniloop_tool_calls_total', 'Total tool calls processed', m.totalToolCalls));
  lines.push(counter('omniloop_tool_errors_total', 'Total tool call errors', m.totalErrors));

  lines.push(counter('omniloop_verification_loops_total',
    'Total verification loops started', m.verificationLoopsStarted));
  lines.push(counter('omniloop_verification_loops_passed_total',
    'Verification loops that passed', m.verificationLoopsPassed));
  lines.push(counter('omniloop_verification_loops_failed_total',
    'Verification loops that failed', m.verificationLoopsFailed));

  // Per-tool metrics
  for (const [toolKey, metric] of m.byTool.entries()) {
    const labels = { server: metric.serverId, tool: metric.toolName };
    const avgLatency = metric.totalCalls > 0
      ? metric.totalLatencyMs / metric.totalCalls / 1000
      : 0;

    lines.push(`# HELP omniloop_tool_call_success_total Tool calls that succeeded\n# TYPE omniloop_tool_call_success_total counter\nomniloop_tool_call_success_total{server="${metric.serverId}",tool="${metric.toolName}"} ${metric.successCalls}\n`);
    lines.push(`# HELP omniloop_tool_call_error_total Tool calls that errored\n# TYPE omniloop_tool_call_error_total counter\nomniloop_tool_call_error_total{server="${metric.serverId}",tool="${metric.toolName}"} ${metric.errorCalls}\n`);
    lines.push(`# HELP omniloop_tool_avg_latency_seconds Average tool call latency\n# TYPE omniloop_tool_avg_latency_seconds gauge\nomniloop_tool_avg_latency_seconds{server="${metric.serverId}",tool="${metric.toolName}"} ${avgLatency.toFixed(4)}\n`);
    void labels; void toolKey;
  }

  // Per-server health
  for (const [serverId, health] of m.byServer.entries()) {
    const isHealthy = health.lastStatus === 'healthy' ? 1 : 0;
    lines.push(gauge('omniloop_server_healthy', 'Whether server is currently healthy', isHealthy, { server: serverId }));
  }

  return lines.join('\n');
}

/** Generate JSON health report */
export function generateHealthJson(serverStatuses: Record<string, string>): string {
  const m = getMetrics();
  const uptimeSec = Math.round((Date.now() - m.startedAt.getTime()) / 1000);

  const allHealthy = Object.values(serverStatuses).every((s) => s === 'healthy');

  return JSON.stringify({
    status: allHealthy ? 'healthy' : 'degraded',
    uptime: uptimeSec,
    servers: serverStatuses,
    tools: m.byTool.size,
    metrics: {
      totalCalls: m.totalToolCalls,
      totalErrors: m.totalErrors,
      verificationPassRate: m.verificationLoopsStarted > 0
        ? `${((m.verificationLoopsPassed / m.verificationLoopsStarted) * 100).toFixed(1)}%`
        : 'N/A'
    }
  }, null, 2);
}

// ── HTTP server ───────────────────────────────────────────────────────────────

export class ObservabilityServer {
  private _server?: ReturnType<typeof createServer>;
  private getServerStatuses: () => Record<string, string>;

  constructor(getStatuses: () => Record<string, string>) {
    this.getServerStatuses = getStatuses;
  }

  start(promConfig: PrometheusConfig, healthPort?: number): void {
    const port = promConfig.port;
    const host = promConfig.host;

    this._server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const url = req.url ?? '/';

      if (url === '/metrics') {
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8' });
        res.end(generateMetricsText());
        return;
      }

      if (url === '/health' || url === '/healthz') {
        const statuses = this.getServerStatuses();
        const body = generateHealthJson(statuses);
        const allHealthy = Object.values(statuses).every((s) => s === 'healthy');
        res.writeHead(allHealthy ? 200 : 503, { 'Content-Type': 'application/json' });
        res.end(body);
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    this._server.listen(port, host, () => {
      logger.info({ host, port, endpoints: ['/metrics', '/health'] }, 'Observability server started');
    });

    this._server.on('error', (err) => {
      logger.error({ err }, 'Observability server error');
    });

    void healthPort;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this._server) { resolve(); return; }
      this._server.close(() => resolve());
    });
  }
}
