# OmniLoop-MCP Gateway — Task Tracker

## Phase 1 — Repository Setup
- [x] Clone OmniLoop-MCP from GitHub into `c:\Documents\Projects\OMNI\omniloop-mcp\`
- [x] Install dependencies + add new deps (SDK, zod, pino, js-yaml, vitest, ajv, ajv-formats)
- [x] Fix/create tsconfig.json
- [x] Verify build compiles (tsc)
- [x] Run existing tests, record output

## Phase 2 — Interfaces & Config Schema
- [x] `src/connectors/connector.ts` — MCPConnector interface + types
- [x] `src/config/schema.ts` — Zod schema for omniloop.yaml (extended for security, cache, resilience, audit, observability)
- [x] `src/config/loader.ts` — YAML loader + env substitution
- [x] `config/omniloop.example.yaml` — declarative config template with all 9 layers

## Phase 3 — Connector Layer
- [x] `src/connectors/stdio.ts` — StdioConnector
- [x] `src/connectors/streamable-http.ts` — StreamableHttpConnector
- [x] `src/connectors/legacy-sse.ts` — LegacySseConnector (compat)
- [x] `tests/connectors/stdio.test.ts`
- [x] `tests/connectors/streamable-http.test.ts`

## Phase 4 — Registry & Federation
- [x] `src/registry/server-registry.ts`
- [x] `src/registry/tool-registry.ts`
- [x] `src/registry/resource-registry.ts`
- [x] `src/registry/prompt-registry.ts`
- [x] `src/routing/namespace.ts`
- [x] `src/routing/discovery.ts`
- [x] `src/routing/tool-router.ts`
- [x] `tests/registry/tool-registry.test.ts`
- [x] `tests/routing/tool-router.test.ts`

## Phase 5 — Policy Engine
- [x] `src/policy/permissions.ts`
- [x] `src/policy/authorization.ts`
- [x] `src/policy/confirmation.ts`
- [x] `src/policy/rate-limit.ts`
- [x] `tests/policy/authorization.test.ts`
- [x] `tests/policy/rate-limit.test.ts`

## Phase 6 — Verification Loop
- [x] `src/verification/verifier.ts`
- [x] `src/verification/loop.ts`
- [x] `src/verification/recovery.ts`
- [x] `tests/verification/loop.test.ts`

## Phase 7 — 9 Enterprise Defense & Resilience Layers
- [x] `src/security/argument-guard.ts` — AJV schema, size, depth limits
- [x] `src/security/secret-redactor.ts` — 25+ secret patterns masking
- [x] `src/security/idempotency.ts` — Request deduplication and replay protection
- [x] `src/security/output-scrubber.ts` — Prompt injection defense & HTML sanitization
- [x] `src/cache/response-cache.ts` — In-memory TTL cache for read operations
- [x] `src/resilience/circuit-breaker.ts` — Per-connector fault isolation
- [x] `src/middleware/middleware-bus.ts` — Async hook pipeline with error fallbacks
- [x] `src/audit/audit-logger.ts` — Tamper-evident append-only log with SHA-256 chain hash
- [x] `src/observability/prometheus.ts` — Prometheus metrics & health endpoint
- [x] `tests/security/argument-guard.test.ts`
- [x] `tests/security/secret-redactor.test.ts`
- [x] `tests/security/idempotency.test.ts`
- [x] `tests/security/output-scrubber.test.ts`
- [x] `tests/cache/response-cache.test.ts`
- [x] `tests/resilience/circuit-breaker.test.ts`
- [x] `tests/audit/audit-logger.test.ts`
- [x] `tests/middleware/middleware-bus.test.ts`

## Phase 8 — Desktop App Integrations
- [x] `src/install/config-gen.ts` — Claude Desktop, ChatGPT Desktop, and Cursor config generator
- [x] `scripts/install-claude.mjs` — One-click Claude Desktop installer
- [x] `scripts/install-chatgpt.mjs` — One-click ChatGPT Desktop installer
- [x] `tests/install/config-gen.test.ts`

## Phase 9 — Assembly, Integration & Documentation
- [x] `src/gateway/gateway.ts` — Full 11-stage request pipeline integration
- [x] `src/index.ts` — Bootstrapping, observability servers, and lifecycle handlers
- [x] `tests/integration/gateway-stdio.test.ts` — End-to-end integration test
- [x] `README.md` — Complete architecture, layer documentation, and quickstart
- [x] `PRD.md` — Complete enterprise PRD
- [x] `tsc` — Clean build with 0 warnings
- [x] `npm test` — All 15 test suites and 81 tests green
