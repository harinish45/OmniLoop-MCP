/**
 * OmniLoop-MCP Gateway — bootstrap entry point.
 *
 * Startup sequence:
 *   1. Load + validate config (omniloop.yaml)
 *   2. Initialize observability (logger, metrics)
 *   3. Initialize storage backend (memory/Redis)
 *   4. Build connector for each configured server
 *   5. Register connectors in server registry
 *   6. Connect all downstream servers
 *   7. Run initial discovery (tools/resources/prompts)
 *   8. Start health polling
 *   9. Initialize policy engine
 *  10. Start inbound MCP gateway (stdio by default)
 *  11. Register SIGINT/SIGTERM handlers
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
import { SandboxGuard } from './security/sandbox.js';
import { AnomalyDetector } from './security/anomaly-detector.js';
import { HitlGate } from './security/hitl-gate.js';
import { RbacManager } from './policy/rbac.js';
import { ProvenanceSigner } from './security/provenance.js';
import { ServerLoadBalancer } from './resilience/load-balancer.js';
import { createStorageBackend } from './storage/index.js';
import type { StorageBackend } from './storage/backend.js';

// ── Bootstrap ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 1. Load config
  const configPath = process.env['OMNILOOP_CONFIG'] ?? path.resolve('config/omniloop.yaml');
  const config = loadConfig(configPath);

  // 2. Initialize logger
  initLogger(config.gateway.logLevel);
  const logger = createLogger('bootstrap');

  logger.info({ name: config.gateway.name, servers: Object.keys(config.servers) }, 'OmniLoop Gateway starting');

  // 3. Initialize storage backend
  const storage: StorageBackend = await createStorageBackend(config.storage);

  // 4. Build registries
  const serverRegistry = new ServerRegistry();
  const toolRegistry = new ToolRegistry();
  const resourceRegistry = new ResourceRegistry();
  const promptRegistry = new PromptRegistry();

  // 5. Build connectors
  for (const [serverId, serverConfig] of Object.entries(config.servers)) {
    const connector = buildConnector(serverId, serverConfig);
    serverRegistry.register(connector);
  }

  // 6. Connect all servers (parallel, individual failures isolated)
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

  // 7. Initial discovery
  const discovery = new DiscoveryService(serverRegistry, toolRegistry, resourceRegistry, promptRegistry);
  await discovery.discoverAll();

  logger.info({ totalTools: toolRegistry.size }, 'Discovery complete');

  // 8. Health polling (every 30s)
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

  // 9. Policy engine
  const authService = new AuthorizationService(toolRegistry, config.policy);

  // 10. Instantiate security, cache, middleware, and audit layers
  const argumentGuard = new ArgumentGuard(config.security?.argumentGuard);
  const secretRedactor = new SecretRedactor(config.security?.secretRedaction);
  const outputScrubber = new OutputScrubber(config.security?.outputScrubbing);
  const idempotencyGate = new IdempotencyGate(config.security?.idempotency);
  const responseCache = new ResponseCache(config.cache);
  const middlewareBus = new MiddlewareBus();
  const auditLogger = new AuditLogger(config.audit);
  const sandboxGuard = new SandboxGuard(config.security?.sandbox);
  const anomalyDetector = new AnomalyDetector(config.security?.anomaly);
  const hitlGate = new HitlGate(config.security?.hitl);
  const rbacManager = new RbacManager();
  const provenanceSigner = new ProvenanceSigner(config.security?.provenance);
  const loadBalancer = new ServerLoadBalancer(serverRegistry);

  // Register discovered tools with the argument guard
  for (const entry of toolRegistry.listAll()) {
    argumentGuard.registerTool(entry.namespacedName, entry.definition);
  }

  // 11. Start gateway with all federated layers
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
    auditLogger,
    sandboxGuard,
    anomalyDetector,
    hitlGate,
    rbacManager,
    provenanceSigner
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

  // 12. Lifecycle + signal handlers
  const lifecycle = new GatewayLifecycle(serverRegistry);

  lifecycle.registerSignalHandlers(async () => {
    logger.info('Shutting down gateway...');
    lifecycle.logFinalMetrics();
    if (obsServer) {
      await obsServer.stop();
    }
    await gateway.stop();
    await lifecycle.disconnectAll();
    await storage.close();
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
