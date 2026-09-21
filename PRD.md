# 📋 Product Requirements Document (PRD)
## Project: OmniLoop-MCP (Model Context Protocol Enterprise Federation Gateway)
**Version:** 3.0.0-PROD  
**Owner:** Harinish S V ([@harinish45](https://github.com/harinish45))

---

## 1. Product Vision
OmniLoop-MCP is an enterprise-grade MCP Federation Layer and Security Gateway that provides a unified, hardened endpoint for LLM clients (Claude Desktop, ChatGPT Desktop, Cursor, and Windsurf), federating multiple downstream MCP servers with continuous self-healing verification loops and 9 multi-tier security and resilience layers.

## 2. Federation Architecture
- **Inbound Transports:** Local `stdio` (IDE and desktop clients) and `streamable-http` (cloud agents and remote workflows).
- **Downstream Connectors:** `stdio` sub-processes, `streamable-http` remote endpoints, and legacy `SSE` connectors.
- **Dynamic Namespacing & Discovery:** Discovers tools, resources, and prompt templates, registering them under isolated namespaces (`<server>.<tool>`) while supporting backward-compatible collision-checked bare names.

## 3. Request Pipeline & Guardrails
1. **Trace ID & Inbound Authentication:** Distributed trace assignment (`x-trace-id`) and API-key / Bearer token validation.
2. **Policy & Rate Limiting:** Configurable rate limits with sliding-window token buckets and risk categorization (`low`, `medium`, `high`, `critical`).
3. **Argument Guard:** AJV-powered JSON schema conformance, maximum depth limiting (`10`), payload byte limiting (`1MB`), and prevention of property injection.
4. **Idempotency Gate:** LRU deduplication with deterministic hashing to prevent unintended duplicate tool execution.
5. **Middleware Bus:** Extensible hook bus supporting `before`, `after`, and `onError` hooks with fallback capabilities.
6. **Response Cache:** In-memory TTL caching for read-only tools with sorted key hashing and stale-while-revalidate protection.
7. **Verification & Recovery Loop:** Autonomous retry and recovery loop with configurable thresholds.
8. **Output Scrubber:** Defense-in-depth scanner blocking prompt injection strings, jailbreak tokens, and HTML script/iframe tags.
9. **Tamper-Evident Audit Logging:** Append-only JSONL logging featuring continuous SHA-256 chain hashing.
10. **Circuit Breakers:** Per-connector state machine (`CLOSED` ➔ `OPEN` ➔ `HALF_OPEN`) preventing cascading latency and server hangs.

## 4. Desktop Integration Support
- Auto-detecting CLI installers for **Claude Desktop** (`claude_desktop_config.json`) and **ChatGPT Desktop** (`mcp_servers.json`) across Windows, macOS, and Linux.
- Cursor IDE `.cursor/mcp.json` generator.

## 5. Verification & Quality Gates
- **100% Type-Safe:** Clean TypeScript 5 compilation with zero `tsc` warnings.
- **Vitest Suite:** 81 passing unit and integration tests across all policy, security, registry, routing, cache, resilience, audit, and installer components.
