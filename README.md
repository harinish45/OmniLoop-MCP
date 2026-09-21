# 🔄 OmniLoop-MCP — Enterprise MCP Federation Gateway & Resilience Layer

> **The most advanced Model Context Protocol (MCP) Federation Layer connecting LLMs (Claude Desktop, ChatGPT Desktop, Cursor, Windsurf) with distributed downstream MCP servers, self-healing verification loops, and enterprise security guardrails.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://www.typescriptlang.org/)
[![MCP Spec](https://img.shields.io/badge/MCP%20Spec-2024--11--05-orange)](https://modelcontextprotocol.io/)
[![Tests: 81 Passed](https://img.shields.io/badge/Tests-81%20Passed-brightgreen)](https://github.com/harinish45/OmniLoop-MCP)
[![Status: Production](https://img.shields.io/badge/Status-Production%20Hardened-brightgreen.svg)]()

---

## 🏛️ System Architecture

Instead of running an isolated tool monolith, OmniLoop-MCP acts as a **Federated MCP Gateway**:
1. Single unified MCP connection for your LLM (Claude, ChatGPT, Cursor).
2. Federates multiple downstream independent MCP servers (GitHub, Filesystem, Postgres, Custom).
3. Enforces an **11-Stage Security & Resilience Pipeline** on every tool execution.

```
                      ┌─────────────────────────────────────────┐
  LLM Client          │      11-STAGE REQUEST PIPELINE          │
  (Claude/GPT)        │                                         │
       │              │  [1]  Trace ID & Inbound Auth           │
       │              │  [2]  Policy & Rate Limiting            │
       │              │  [3]  Argument Guard (AJV Schema/Depth) │
       │              │  [4]  Idempotency Gate (Dedup)          │
       │              │  [5]  Middleware Bus (Before-Hooks)     │
       │              │  [6]  Response Cache (Read Tools TTL)   │
       │              │  [7]  Verification Loop & Recovery      │
       │              │  [8]  Output Scrubber (Prompt Injection)│
       │              │  [9]  Idempotency Result Store          │
       │              │  [10] Middleware Bus (After-Hooks)      │
       │              │  [11] Tamper-Evident Audit Logger       │
       └──────────────┴─────────────────────────────────────────┘
                                   │
                      Downstream MCP Servers
            ┌──────────────────────┼──────────────────────┐
            ▼                      ▼                      ▼
       GitHub MCP           Filesystem MCP          Remote HTTP MCP
```

---

## ⚡ 9 Enterprise Defense & Resilience Layers

1. **Inbound Authentication & Identity:**
   - Multi-tenant API key (`X-OmniLoop-Key`) & Bearer token verification.
   - Trusted local stdio transport mode with zero configuration overhead.

2. **Argument Guard (Schema & Bomb Defense):**
   - Pre-compiles JSON Schemas using **AJV** with all standard formats.
   - Restricts argument depth (`maxDepth: 10`) and payload size (`maxPayloadBytes: 1MB`).
   - Prevents parameter injection via undeclared properties.

3. **Secret Redactor:**
   - Detects 25+ secret patterns (AWS, GitHub tokens, Bearer auth, private PEM keys, DB credentials, OpenAI/Anthropic keys).
   - Deep-redacts objects before logging without altering downstream data execution.

4. **Idempotency Gate:**
   - Prevents destructive double-executions from LLM retry loops.
   - Deterministic key hashing and LRU cache with configurable TTL.

5. **Response Cache:**
   - High-performance in-memory cache for read-only tools.
   - Arg-normalized SHA-256 keys, per-tool TTL overrides, and automatic error skipping.

6. **Middleware Bus:**
   - Composable async hook pipeline (`before`, `after`, `onError`) per-tool or globally.
   - Allows custom plugins, metrics capture, and seamless error recovery fallbacks.

7. **Circuit Breakers (Per-Connector Fault Isolation):**
   - State machine: `CLOSED` ➔ `OPEN` ➔ `HALF_OPEN` ➔ `CLOSED`.
   - Protects agents from hanging on broken downstream servers. Fail-fast error reporting.

8. **Tamper-Evident Audit Logger:**
   - Append-only JSONL event stream with SHA-256 cryptographic chain hashing.
   - Daily log rotation and automated retention cleanup.

9. **Output Scrubber (Prompt Injection Defense):**
   - Real-time scanner for system prompt overrides, zero-width instructions, and jailbreak tokens (`DAN`, `system-override`).
   - Strips malicious `<script>` and `<iframe>` tags from text outputs.

---

## 🖥️ Desktop App One-Command Installers

### Claude Desktop
Installs OmniLoop into Claude Desktop's `claude_desktop_config.json` automatically:
```bash
node scripts/install-claude.mjs
# Dry-run preview:
node scripts/install-claude.mjs --dry-run
```

### ChatGPT Desktop
Installs OmniLoop into ChatGPT Desktop's `mcp_servers.json`:
```bash
node scripts/install-chatgpt.mjs
# Dry-run preview:
node scripts/install-chatgpt.mjs --dry-run
```

### Manual Configuration
Add to `claude_desktop_config.json` or `.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "omniloop": {
      "command": "node",
      "args": ["<PATH_TO_OMNILOOP>/dist/index.js"],
      "env": {
        "OMNILOOP_CONFIG": "<PATH_TO_OMNILOOP>/config/omniloop.yaml",
        "NODE_ENV": "production"
      }
    }
  }
}
```

---

## 🛠️ Configuration (`config/omniloop.yaml`)

```yaml
version: 1

gateway:
  name: omniloop
  logLevel: info
  inbound:
    - transport: stdio

servers:
  github:
    transport: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}

  filesystem:
    transport: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "c:/workspace"]

security:
  argumentGuard:
    enabled: true
    maxDepth: 10
    maxPayloadBytes: 1048576
  secretRedaction:
    enabled: true
  idempotency:
    enabled: true
    ttlSeconds: 300
  outputScrubbing:
    enabled: true
    blockPromptInjection: true
    stripHtml: true

cache:
  enabled: true
  defaultTtlSeconds: 60
  perToolTtlSeconds:
    "github.search_repositories": 120

resilience:
  circuitBreaker:
    failureThreshold: 5
    windowMs: 60000
    probeIntervalMs: 30000

audit:
  enabled: true
  directory: "./logs/audit"
  retentionDays: 90
```

---

## 🧪 Testing & Verification

```bash
# Run full Vitest suite (81 unit and integration tests)
npm test

# Production TypeScript build
npm run build
```

---

## 📄 License
MIT License — see [LICENSE](LICENSE) for details.
