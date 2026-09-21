# 🔄 OmniLoop-MCP — Enterprise MCP Federation Gateway (Titan Edition v4)

> **The most advanced, battle-hardened Model Context Protocol (MCP) Federation Layer and Security Gateway connecting LLMs (Claude Desktop, ChatGPT Desktop, Cursor, Windsurf) with distributed downstream MCP servers, self-healing verification loops, and enterprise security guardrails.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?logo=typescript)](https://www.typescriptlang.org/)
[![MCP Spec](https://img.shields.io/badge/MCP%20Spec-2024--11--05-orange)](https://modelcontextprotocol.io/)
[![Tests: 115 Passed](https://img.shields.io/badge/Tests-115%20Passed-brightgreen)](https://github.com/harinish45/OmniLoop-MCP)
[![Status: Production](https://img.shields.io/badge/Status-Titan%20Edition%20v4-brightgreen.svg)]()

---

## 🏛️ System Architecture

Instead of running isolated tool monoliths, OmniLoop-MCP operates as a **Unified MCP Federation & Security Gateway**:
1. Single consolidated MCP endpoint for your LLM (Claude, ChatGPT, Cursor).
2. Connects to multiple downstream independent MCP servers (GitHub, Filesystem, Postgres, Custom).
3. Executes a full **14-Stage Multi-Tier Defense Pipeline** on every tool execution.

```
                      ┌──────────────────────────────────────────────────────────┐
  LLM Client          │             14-STAGE REQUEST PIPELINE                    │
  (Claude/GPT)        │                                                          │
       │              │  [1]  Trace ID & Multi-Tenant RBAC Authentication        │
       │              │  [2]  Policy & Sliding-Window Rate Limiting              │
       │              │  [3]  Semantic Anomaly & Loop Bomb Detector              │
       │              │  [4]  Schema Synthesis & Self-Healing Coercion           │
       │              │  [5]  Sandboxing Guard (Path Traversal + SSRF + Shell)   │
       │              │  [6]  Human-in-the-Loop (HITL) Interactive Approval      │
       │              │  [7]  Argument Guard & Strict AJV Schema Validation      │
       │              │  [8]  Idempotency Gate & Deduplication                   │
       │              │  [9]  Middleware Bus (Before Hooks)                      │
       │              │  [10] Response Cache (Read Tools In-Memory TTL)          │
       │              │  [11] Verification Loop & Recovery Engine                │
       │              │  [12] Output Scrubber (Prompt Injection / Script Def)    │
       │              │  [13] Tamper-Evident SHA-256 Chained Audit Logger        │
       │              │  [14] Cryptographic Payload Provenance Attestation       │
       └──────────────┴──────────────────────────────────────────────────────────┘
                                             │
                          Federated Downstream MCP Server Clusters
                ┌────────────────────────────┼────────────────────────────┐
                ▼                            ▼                            ▼
           GitHub MCP                 Filesystem MCP                Remote HTTP MCP
        (stdio cluster)              (stdio cluster)             (Streamable HTTP/SSE)
```

---

## ⚡ Enterprise Defense & Resilience Layers

1. **Sandboxing & Execution Isolation (`src/security/sandbox.ts`):**
   - **Path Traversal Defense:** Detects `..`, `%2e%2e`, Windows UNC paths (`\\server\share`), and NTFS Alternate Data Streams (`::$DATA`). Enforces strict boundary chroots.
   - **SSRF Network Boundary:** Inspects URL arguments in tools; blocks private IP ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`), IPv6 loopback (`::1`), and cloud metadata (`169.254.169.254`).
   - **Shell Command Sanitizer:** Detects and blocks shell chaining characters (`|`, `;`, `&&`, `` ` ``, `$()`, `eval`).

2. **Semantic Anomaly & Loop-Bomb Detector (`src/security/anomaly-detector.ts`):**
   - **Model Confusion Defense:** Detects runaway LLM recursion loops calling identical tools in rapid succession.
   - **Payload Entropy Analysis:** Computes Shannon entropy on input strings to detect obfuscated data or exfiltration attempts (> 5.8 threshold).

3. **Human-in-the-Loop (HITL) Interactive Gate (`src/security/hitl-gate.ts`):**
   - Gates destructive and high-risk actions (`critical`) requiring operator approval.
   - Issues single-use cryptographic approval tokens (`hitl_*`) with configurable TTL or delegates to custom terminal/desktop approval handlers.

4. **Multi-Tenant RBAC & Capability Scoping (`src/policy/rbac.ts`):**
   - Hierarchical role definitions: `admin`, `operator`, `analyst`, `readonly`, `guest`.
   - Pattern-based tool authorization (`github:*`, `files:read_*`, `*`).

5. **Cryptographic Payload Provenance (`src/security/provenance.ts`):**
   - Digitally signs every tool output with HMAC-SHA256 signatures.
   - Upstream agents can verify that tool responses have not been spoofed or tainted in multi-agent pipelines.

6. **Self-Healing Schema Synthesizer (`src/resilience/schema-synthesizer.ts`):**
   - Auto-corrects common LLM argument type errors (`"true"` ➔ `true`, `"42"` ➔ `42`, `"a,b"` ➔ `["a", "b"]`) to match declared schemas before routing.

7. **Multi-Server Load Balancer & Failover (`src/resilience/load-balancer.ts`):**
   - Groups downstream servers into pools supporting `round-robin`, `failover`, and `random` routing with automatic health detection.

8. **Circuit Breaker (`src/resilience/circuit-breaker.ts`):**
   - Per-connector state machine (`CLOSED` ➔ `OPEN` ➔ `HALF_OPEN`) with rolling failure windows.

9. **Tamper-Evident Chained Audit Logger (`src/audit/audit-logger.ts`):**
   - Append-only JSONL event stream with SHA-256 cryptographic chain hashing.

10. **Output Scrubber (`src/security/output-scrubber.ts`):**
    - Real-time scanner blocking system prompt overrides, jailbreak tokens, and stripping malicious `<script>` and `<iframe>` HTML tags.

---

## 🛠️ CLI Diagnostics Suite

OmniLoop includes a native command-line suite:

```bash
# Verify environment, node runtime, and server configurations
npx omniloop doctor

# Verify the cryptographic integrity of audit logs
npx omniloop audit verify ./logs/audit/audit-2026-09-21.jsonl

# Measure in-memory pipeline throughput and latency
npx omniloop benchmark
```

---

## 🖥️ Desktop App One-Command Installers

### Claude Desktop
Installs OmniLoop into Claude Desktop's `claude_desktop_config.json`:
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

---

## 🧪 Testing & Verification

```bash
# Run full Vitest suite (115 unit and integration tests across 23 suites)
npm test

# Production TypeScript build
npm run build
```

---

## 📄 License
MIT License — see [LICENSE](LICENSE) for details.
