/**
 * Gateway — the central MCP Server instance that federates all downstream servers.
 *
 * Request pipeline for every tools/call:
 *   [1] Trace ID assigned
 *   [2] Authorization (deny-list, rate limit, risk)
 *   [3] Argument Guard (schema validation, depth/size limits)
 *   [4] Idempotency check (return cached result if duplicate)
 *   [5] Middleware before-hooks
 *   [6] Response cache check (read tools)
 *   [7] Verification Loop (route → verify → recover)
 *   [8] Output scrubbing (prompt injection defense)
 *   [9] Idempotency store (cache result for future dedup)
 *  [10] Middleware after-hooks
 *  [11] Audit log write
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

import { GATEWAY_NAME, GATEWAY_VERSION, GATEWAY_CAPABILITIES } from './protocol.js';
import type { ToolRegistry } from '../registry/tool-registry.js';
import type { ResourceRegistry } from '../registry/resource-registry.js';
import type { PromptRegistry } from '../registry/prompt-registry.js';
import type { ServerRegistry } from '../registry/server-registry.js';
import type { AuthorizationService } from '../policy/authorization.js';
import { VerificationLoop } from '../verification/loop.js';
import { ToolRouter } from '../routing/tool-router.js';
import type { ArgumentGuard } from '../security/argument-guard.js';
import type { SecretRedactor } from '../security/secret-redactor.js';
import type { OutputScrubber } from '../security/output-scrubber.js';
import { IdempotencyGate } from '../security/idempotency.js';
import { ResponseCache } from '../cache/response-cache.js';
import type { MiddlewareBus, MiddlewareContext } from '../middleware/middleware-bus.js';
import type { AuditLogger } from '../audit/audit-logger.js';
import { createLogger } from '../observability/logging.js';
import { newTraceId, runWithTrace } from '../observability/tracing.js';
import type { ToolResult } from '../connectors/connector.js';

const logger = createLogger('gateway');

export interface GatewayDeps {
  toolRegistry: ToolRegistry;
  resourceRegistry: ResourceRegistry;
  promptRegistry: PromptRegistry;
  serverRegistry: ServerRegistry;
  authService: AuthorizationService;
  argumentGuard: ArgumentGuard;
  secretRedactor: SecretRedactor;
  outputScrubber: OutputScrubber;
  idempotencyGate: IdempotencyGate;
  responseCache: ResponseCache;
  middlewareBus: MiddlewareBus;
  auditLogger: AuditLogger;
}

export class OmniLoopGateway {
  private readonly server: Server;
  private readonly router: ToolRouter;
  private readonly loop: VerificationLoop;
  private readonly deps: GatewayDeps;

  constructor(deps: GatewayDeps) {
    this.deps = deps;
    this.server = new Server(
      { name: GATEWAY_NAME, version: GATEWAY_VERSION },
      { capabilities: GATEWAY_CAPABILITIES }
    );
    this.router = new ToolRouter(deps.toolRegistry, deps.serverRegistry);
    this.loop = new VerificationLoop(this.router);
    this.registerHandlers();
  }

  // ── Handler registration ─────────────────────────────────────────────────────

  private registerHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      const entries = this.deps.toolRegistry.listAll();
      return {
        tools: entries.map((e) => ({
          name: e.namespacedName,
          description: `[${e.serverId}] ${e.definition.description}`,
          inputSchema: e.definition.inputSchema
        }))
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const traceId = newTraceId();
      const toolName = request.params.name;
      const args = request.params.arguments ?? {};
      const startedAt = Date.now();

      return runWithTrace(traceId, async () => {
        logger.info({ traceId, toolName }, 'Tool call received');

        // ── [2] AUTHORIZATION ──────────────────────────────────────────────────
        const authResult = this.deps.authService.authorize(toolName);

        if (!authResult.allowed) {
          logger.warn({ traceId, toolName, reason: authResult.reason }, 'Tool call denied');
          this.deps.auditLogger.write({
            traceId, timestamp: new Date().toISOString(), toolName,
            serverId: 'gateway', args: this.deps.secretRedactor.redactForLogging(args),
            resultSummary: `DENIED: ${authResult.reason}`,
            riskLevel: authResult.risk, authorized: false,
            verificationPassed: false, durationMs: Date.now() - startedAt,
            cacheHit: false, idempotencyHit: false, threatDetected: false, threats: []
          });
          return { content: [{ type: 'text' as const, text: `Denied: ${authResult.reason}` }], isError: true };
        }

        if (authResult.confirmationRequired) {
          logger.warn({ traceId, toolName, risk: authResult.risk }, 'High-risk tool — confirmation required (log-only in this phase)');
        }

        // ── [3] ARGUMENT GUARD ────────────────────────────────────────────────
        const guardResult = this.deps.argumentGuard.validate(toolName, args);
        if (!guardResult.valid) {
          const reason = `Invalid arguments: ${guardResult.errors.join('; ')}`;
          logger.warn({ traceId, toolName, errors: guardResult.errors }, 'Argument validation failed');
          return { content: [{ type: 'text' as const, text: reason }], isError: true };
        }

        // ── [4] IDEMPOTENCY CHECK ─────────────────────────────────────────────
        const idempotencyKey = IdempotencyGate.generateKey(toolName, args);
        const idempotencyCached = this.deps.idempotencyGate.check(idempotencyKey);
        if (idempotencyCached) {
          logger.info({ traceId, toolName }, 'Idempotency cache hit — returning cached result');
          return this.toSdkResult(idempotencyCached);
        }

        // ── [5] MIDDLEWARE BEFORE ─────────────────────────────────────────────
        const entry = this.deps.toolRegistry.resolve(toolName);
        const serverId = entry?.serverId ?? 'unknown';
        const mwCtx: MiddlewareContext = {
          traceId, toolName, serverId,
          riskLevel: authResult.risk, args, meta: {}, startedAt
        };

        try {
          await this.deps.middlewareBus.runBefore(mwCtx);
        } catch (err) {
          return { content: [{ type: 'text' as const, text: `Middleware error: ${(err as Error).message}` }], isError: true };
        }

        // ── [6] RESPONSE CACHE ────────────────────────────────────────────────
        let cacheHit = false;
        if (authResult.risk === 'low') {
          const cacheKey = ResponseCache.makeKey(serverId, toolName, args);
          const cached = this.deps.responseCache.get(cacheKey);
          if (cached) {
            cacheHit = true;
            logger.debug({ traceId, toolName }, 'Response cache hit');
            mwCtx.meta['cacheHit'] = true;
            mwCtx.result = cached;
            await this.deps.middlewareBus.runAfter(mwCtx);
            return this.toSdkResult(cached);
          }
        }

        // ── [7] VERIFICATION LOOP ─────────────────────────────────────────────
        let loopResult: Awaited<ReturnType<VerificationLoop['execute']>>;
        try {
          loopResult = await Promise.race([
            this.loop.execute(toolName, mwCtx.args as Record<string, unknown>),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Tool call timeout')), authResult.timeoutMs)
            )
          ]);
        } catch (err) {
          const msg = (err as Error).message;
          logger.error({ traceId, toolName, err: msg }, 'Tool call error');
          const fallback = await this.deps.middlewareBus.runOnError(mwCtx, err);
          const result = fallback ?? { content: [{ type: 'text' as const, text: `Error: ${msg}` }], isError: true };
          return this.toSdkResult(result);
        }

        if (!loopResult.passed) {
          logger.warn({ traceId, toolName, iterations: loopResult.iterations, reason: loopResult.failureReason }, 'Verification loop failed');
        }

        // Cache read tool results
        if (authResult.risk === 'low' && loopResult.passed) {
          const cacheKey = ResponseCache.makeKey(serverId, toolName, args);
          this.deps.responseCache.set(cacheKey, toolName, loopResult.finalResult);
        }

        // ── [8] OUTPUT SCRUBBING ──────────────────────────────────────────────
        const { items: scrubbedContent, blocked, threats } = this.deps.outputScrubber.scrubContentItems(
          loopResult.finalResult.content as Array<{ type: string; [key: string]: unknown }>,
          toolName
        );

        const finalResult: ToolResult = {
          content: scrubbedContent as ToolResult['content'],
          isError: loopResult.finalResult.isError || blocked
        };

        // ── [9] IDEMPOTENCY STORE ─────────────────────────────────────────────
        if (loopResult.passed) {
          this.deps.idempotencyGate.store(idempotencyKey, toolName, finalResult);
        }

        // ── [10] MIDDLEWARE AFTER ─────────────────────────────────────────────
        mwCtx.result = finalResult;
        mwCtx.meta['verificationPassed'] = loopResult.passed;
        mwCtx.meta['iterations'] = loopResult.iterations;
        await this.deps.middlewareBus.runAfter(mwCtx);

        // ── [11] AUDIT LOG ────────────────────────────────────────────────────
        this.deps.auditLogger.write({
          traceId, timestamp: new Date().toISOString(), toolName, serverId,
          args: this.deps.secretRedactor.redactForLogging(args),
          resultSummary: finalResult.isError
            ? `ERROR: ${loopResult.failureReason ?? 'tool error'}`
            : `OK (${loopResult.iterations} iterations)`,
          riskLevel: authResult.risk, authorized: true,
          verificationPassed: loopResult.passed,
          durationMs: Date.now() - startedAt,
          cacheHit, idempotencyHit: false, threatDetected: threats.length > 0, threats
        });

        return this.toSdkResult(finalResult);
      });
    });

    // resources/list
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const entries = this.deps.resourceRegistry.listAll();
      return {
        resources: entries.map((e) => ({
          uri: e.namespacedUri,
          name: e.definition.name,
          description: e.definition.description,
          mimeType: e.definition.mimeType
        }))
      };
    });

    // resources/read
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;
      const entry = this.deps.resourceRegistry.resolve(uri);
      if (!entry) throw new Error(`Resource not found: ${uri}`);
      const connector = this.deps.serverRegistry.getConnector(entry.serverId);
      const result = await connector.readResource(entry.originalUri);
      return { contents: result.contents };
    });

    // prompts/list
    this.server.setRequestHandler(ListPromptsRequestSchema, async () => {
      const entries = this.deps.promptRegistry.listAll();
      return {
        prompts: entries.map((e) => ({
          name: e.namespacedName,
          description: e.definition.description,
          arguments: e.definition.arguments
        }))
      };
    });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private toSdkResult(result: ToolResult): { content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>; isError: boolean } {
    return {
      content: result.content.map((c) => {
        if (c.type === 'text') return { type: 'text' as const, text: (c as { type: 'text'; text: string }).text };
        if (c.type === 'image') {
          const img = c as { type: 'image'; data: string; mimeType: string };
          return { type: 'image' as const, data: img.data, mimeType: img.mimeType };
        }
        return { type: 'text' as const, text: JSON.stringify(c) };
      }),
      isError: result.isError ?? false
    };
  }

  // ── Transport ────────────────────────────────────────────────────────────────

  async startStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    logger.info('Gateway listening on stdio');
  }

  async notifyToolsChanged(): Promise<void> {
    await this.server.sendToolListChanged();
    logger.debug('Sent tools/list_changed notification');
  }

  async stop(): Promise<void> {
    await this.server.close();
    logger.info('Gateway server closed');
  }
}
