/**
 * OmniLoop-MCP Gateway — bootstrap entry point.
 *
 * Startup sequence:
 *   1. Load + validate config (omniloop.yaml)
 *   2. Initialize observability (logger, metrics)
 *   3. Build connector for each configured server
 *   4. Register connectors in server registry
 *   5. Connect all downstream servers
 *   6. Run initial discovery (tools/resources/prompts)
 *   7. Start health polling
 *   8. Initialize policy engine
 *   9. Start inbound MCP gateway (stdio by default)
 *  10. Register SIGINT/SIGTERM handlers
 */

import * as path from 'path';
import { loadConfig } from './config/loader.js';
import { initLogger, createLogger } from './observability/logging.js';
import { ServerRegistry } from './registry/server-registry.js';
import { ToolRegistry } from './registry/tool-registry.js';
import { ResourceRegistry } from './registry/resource-registry.js';
import { PromptRegistry } from './registry/prompt-registry.js';
import { DiscoveryService } from './routing/discovery.js';
import { AuthorizationService } from './policy/authorization.js';
import { OmniLoopGateway } from './gateway/gateway.js';
import { GatewayLifecycle } from './gateway/lifecycle.js';
import { StdioConnector } from './connectors/stdio.js';
import { StreamableHttpConnector } from './connectors/streamable-http.js';
import { LegacySseConnector } from './connectors/legacy-sse.js';
import type { MCPConnector } from './connectors/connector.js';
import type { ServerConfig } from './config/schema.js';
import { ArgumentGuard } from './security/argument-guard.js';
import { SecretRedactor } from './security/secret-redactor.js';
import { OutputScrubber } from './security/output-scrubber.js';
import { IdempotencyGate } from './security/idempotency.js';
import { ResponseCache } from './cache/response-cache.js';
import { MiddlewareBus } from './middleware/middleware-bus.js';
import { AuditLogger } from './audit/audit-logger.js';
import { ObservabilityServer } from './observability/prometheus.js';

// ── Bootstrap ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 1. Load config
  const configPath = process.env['OMNILOOP_CONFIG'] ?? path.resolve('config/omniloop.yaml');
  const config = loadConfig(configPath);

  // 2. Initialize logger
  initLogger(config.gateway.logLevel);
  const logger = createLogger('bootstrap');

  logger.info({ name: config.gateway.name, servers: Object.keys(config.servers) }, 'OmniLoop Gateway starting');

  // 3. Build registries
  const serverRegistry = new ServerRegistry();
  const toolRegistry = new ToolRegistry();
  const resourceRegistry = new ResourceRegistry();
  const promptRegistry = new PromptRegistry();

  // 4. Build connectors
  for (const [serverId, serverConfig] of Object.entries(config.servers)) {
    const connector = buildConnector(serverId, serverConfig);
    serverRegistry.register(connector);
  }

  // 5. Connect all servers (parallel, individual failures isolated)
  const connectResults = await Promise.allSettled(
    serverRegistry.listAll().map(async ({ connector, serverId }) => {
      try {
        await connector.connect();
        serverRegistry.setStatus(serverId, 'healthy');
        logger.info({ serverId }, 'Connected');
      } catch (err) {
        serverRegistry.setStatus(serverId, 'offline');
        logger.error({ serverId, err }, 'Failed to connect — server marked offline');
      }
    })
  );

  const connectedCount = connectResults.filter((r) => r.status === 'fulfilled').length;
  logger.info({ connectedCount, total: serverRegistry.size }, 'Connection phase complete');

  // 6. Initial discovery
  const discovery = new DiscoveryService(serverRegistry, toolRegistry, resourceRegistry, promptRegistry);
  await discovery.discoverAll();

  logger.info({ totalTools: toolRegistry.size }, 'Discovery complete');

  // 7. Health polling (every 30s)
  serverRegistry.startHealthPolling(30_000);

  // Re-discover tools when a server recovers from offline
  serverRegistry.onStatusChange((serverId, status) => {
    if (status === 'healthy') {
      const entry = serverRegistry.get(serverId);
      if (entry) {
        void discovery.refreshTools(entry.connector).catch((err) => {
          logger.error({ serverId, err }, 'Tool refresh after recovery failed');
        });
      }
    } else if (status === 'offline') {
      discovery.deregisterServer(serverId);
    }
  });

  // 8. Policy engine
  const authService = new AuthorizationService(toolRegistry, config.policy);

  // 9. Instantiate security, cache, middleware, and audit layers
  const argumentGuard = new ArgumentGuard(config.security?.argumentGuard);
  const secretRedactor = new SecretRedactor(config.security?.secretRedaction);
  const outputScrubber = new OutputScrubber(config.security?.outputScrubbing);
  const idempotencyGate = new IdempotencyGate(config.security?.idempotency);
  const responseCache = new ResponseCache(config.cache);
  const middlewareBus = new MiddlewareBus();
  const auditLogger = new AuditLogger(config.audit);

  // Register discovered tools with the argument guard
  for (const entry of toolRegistry.listAll()) {
    argumentGuard.registerTool(entry.namespacedName, entry.definition);
  }

  // 10. Start gateway with all federated layers
  const gateway = new OmniLoopGateway({
    toolRegistry,
    resourceRegistry,
    promptRegistry,
    serverRegistry,
    authService,
    argumentGuard,
    secretRedactor,
    outputScrubber,
    idempotencyGate,
    responseCache,
    middlewareBus,
    auditLogger
  });

  // Optional Prometheus / health observability server
  let obsServer: ObservabilityServer | undefined;
  if (config.observability?.prometheus?.enabled || config.observability?.healthEndpoint?.enabled) {
    obsServer = new ObservabilityServer(() =>
      Object.fromEntries(serverRegistry.listAll().map((e) => [e.serverId, e.status]))
    );
    obsServer.start(
      {
        enabled: config.observability.prometheus?.enabled ?? false,
        port: config.observability.prometheus?.port ?? 9090,
        host: config.observability.prometheus?.host ?? '127.0.0.1'
      },
      config.observability.healthEndpoint?.port
    );
  }

  // 11. Lifecycle + signal handlers
  const lifecycle = new GatewayLifecycle(serverRegistry);

  lifecycle.registerSignalHandlers(async () => {
    logger.info('Shutting down gateway...');
    lifecycle.logFinalMetrics();
    if (obsServer) {
      await obsServer.stop();
    }
    await gateway.stop();
    await lifecycle.disconnectAll();
  });

  // Start inbound transport
  await gateway.startStdio();

  logger.info(
    { tools: toolRegistry.size, servers: serverRegistry.size },
    'OmniLoop Gateway ready'
  );
}

// ── Connector factory ─────────────────────────────────────────────────────────

function buildConnector(serverId: string, config: ServerConfig): MCPConnector {
  switch (config.transport) {
    case 'stdio':
      return new StdioConnector(serverId, config);
    case 'streamable-http':
      return new StreamableHttpConnector(serverId, config);
    case 'legacy-sse':
      return new LegacySseConnector(serverId, config);
  }
}

// ── Run ───────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error('Fatal error during gateway startup:', err);
  process.exit(1);
});
