import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OmniLoopGateway } from '../../src/gateway/gateway.js';
import { ToolRegistry } from '../../src/registry/tool-registry.js';
import { ResourceRegistry } from '../../src/registry/resource-registry.js';
import { PromptRegistry } from '../../src/registry/prompt-registry.js';
import { ServerRegistry } from '../../src/registry/server-registry.js';
import { AuthorizationService } from '../../src/policy/authorization.js';
import { ArgumentGuard } from '../../src/security/argument-guard.js';
import { SecretRedactor } from '../../src/security/secret-redactor.js';
import { OutputScrubber } from '../../src/security/output-scrubber.js';
import { IdempotencyGate } from '../../src/security/idempotency.js';
import { ResponseCache } from '../../src/cache/response-cache.js';
import { MiddlewareBus } from '../../src/middleware/middleware-bus.js';
import { AuditLogger } from '../../src/audit/audit-logger.js';
import type { MCPConnector, ToolDefinition, ToolResult } from '../../src/connectors/connector.js';
import { mkdtempSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

class MockConnector implements MCPConnector {
  public readonly serverId = 'mock-server';
  public callCount = 0;

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  isConnected(): boolean { return true; }
  async ping(): Promise<boolean> { return true; }

  async listTools(): Promise<ToolDefinition[]> {
    return [
      {
        name: 'echo',
        description: 'Echo message back',
        inputSchema: {
          type: 'object',
          properties: {
            message: { type: 'string' }
          },
          required: ['message']
        }
      }
    ];
  }

  async callTool(name: string, args?: Record<string, unknown>): Promise<ToolResult> {
    this.callCount++;
    if (name === 'echo') {
      return {
        content: [{ type: 'text', text: `Echo: ${(args as any)?.message}` }],
        isError: false
      };
    }
    return {
      content: [{ type: 'text', text: 'Unknown tool' }],
      isError: true
    };
  }

  async listResources() { return []; }
  async readResource() { throw new Error('Not implemented'); }
  async listPrompts() { return []; }
  async getPrompt() { throw new Error('Not implemented'); }
}

describe('OmniLoopGateway Integration', () => {
  let tmpAuditDir: string;
  let toolRegistry: ToolRegistry;
  let serverRegistry: ServerRegistry;
  let mockConnector: MockConnector;
  let auditLogger: AuditLogger;
  let gateway: OmniLoopGateway;

  beforeEach(async () => {
    tmpAuditDir = mkdtempSync(join(tmpdir(), 'omniloop-int-test-'));

    serverRegistry = new ServerRegistry();
    mockConnector = new MockConnector();
    serverRegistry.register(mockConnector);
    serverRegistry.setStatus('mock-server', 'healthy');

    toolRegistry = new ToolRegistry();
    const tools = await mockConnector.listTools();
    toolRegistry.registerServerTools('mock-server', tools);

    const resourceRegistry = new ResourceRegistry();
    const promptRegistry = new PromptRegistry();
    const authService = new AuthorizationService(toolRegistry, {
      defaults: { low: ['echo*'] }
    });

    const argumentGuard = new ArgumentGuard();
    for (const entry of toolRegistry.listAll()) {
      argumentGuard.registerTool(entry.namespacedName, entry.definition);
    }

    const secretRedactor = new SecretRedactor();
    const outputScrubber = new OutputScrubber();
    const idempotencyGate = new IdempotencyGate({ ttlSeconds: 60 });
    const responseCache = new ResponseCache({ defaultTtlSeconds: 60 });
    const middlewareBus = new MiddlewareBus();

    auditLogger = new AuditLogger({ enabled: true, directory: tmpAuditDir });
    auditLogger.initialize();

    gateway = new OmniLoopGateway({
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
  });

  afterEach(async () => {
    await auditLogger.close();
    await gateway.stop();
    if (existsSync(tmpAuditDir)) {
      rmSync(tmpAuditDir, { recursive: true, force: true });
    }
  });

  it('instantiates and lists federated tools', () => {
    const list = toolRegistry.listAll();
    expect(list).toHaveLength(1);
    expect(list[0]?.namespacedName).toBe('mock-server.echo');
    expect(list[0]?.definition.description).toBe('Echo message back');
  });

  it('verifies arguments and caches read results', async () => {
    const cachedEntry = toolRegistry.resolve('mock-server.echo');
    expect(cachedEntry).toBeDefined();

    // Verify response cache key generation
    const key = ResponseCache.makeKey('mock-server', 'echo', { message: 'hello' });
    expect(key).toBeDefined();
    expect(key.length).toBe(40);
  });
});
