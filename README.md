<div align="center">

# 🔄 OmniLoop-MCP

**Enterprise Model Context Protocol Federation Gateway**

[![CI](https://github.com/harinish45/OmniLoop-MCP/actions/workflows/ci.yml/badge.svg)](https://github.com/harinish45/OmniLoop-MCP/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![MCP](https://img.shields.io/badge/MCP-Protocol-6B4FBB)](https://spec.modelcontextprotocol.io)

> *Enterprise MCP server connecting Claude, Gemini, and GPT to real-world tools — Slack, GitHub, databases, and more*

[📋 TODO](TODO.md) · [📄 PRD](PRD.md) · [⚙️ Config](config/)

</div>

---

## 🏗️ Architecture

```mermaid
graph TB
    subgraph LLMs["🤖 AI Clients"]
        Claude["Anthropic Claude\nDesktop"]
        Cursor["Cursor / Windsurf\nIDE"]
        Gemini["Google Gemini\nCLI"]
    end

    subgraph Gateway["🔄 OmniLoop MCP Gateway"]
        Auth["🔐 Auth Middleware\n(API Keys / OAuth)"]
        Router["🔀 Tool Router"]
        RateLimit["⏱️ Rate Limiter"]
        Logger["📋 Audit Logger"]
    end

    subgraph Tools["🔧 MCP Tools"]
        WebSearch["🌐 web_search"]
        GitHub["🐙 github_pr\ngithub_issues"]
        Slack["💬 slack_message"]
        DB["🗄️ db_query\n(PostgreSQL)"]
        HTTP["📡 http_request"]
        Code["⚡ run_code\n(Sandboxed)"]
    end

    Claude -->|MCP Protocol| Auth
    Cursor -->|MCP Protocol| Auth
    Gemini -->|MCP Protocol| Auth
    Auth --> Router
    Auth --> RateLimit
    Router --> WebSearch
    Router --> GitHub
    Router --> Slack
    Router --> DB
    Router --> HTTP
    Router --> Code
    Router --> Logger
```

---

## 🚀 Quick Start

```bash
git clone https://github.com/harinish45/OmniLoop-MCP.git
cd OmniLoop-MCP
npm install
npm run build
npm start
```

**Claude Desktop config** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "omniloop": {
      "command": "node",
      "args": ["/path/to/OmniLoop-MCP/dist/server.js"]
    }
  }
}
```

---

## 🔧 Tool Coverage

| Tool | Implemented | Tests | Priority |
|------|-------------|-------|----------|
| `web_search` | 🔧 | ❌ | HIGH |
| `read_file` | 🔧 | ❌ | HIGH |
| `http_request` | 🔧 | ❌ | HIGH |
| `github_pr` | ❌ | ❌ | MEDIUM |
| `slack_message` | ❌ | ❌ | MEDIUM |
| `db_query` | ❌ | ❌ | MEDIUM |
| `run_code` | ❌ | ❌ | HIGH |

---

## 📁 Structure

```
OmniLoop-MCP/
├── 🔧  src/
│   ├── tools/         # MCP tool implementations
│   ├── resources/     # Resource providers
│   ├── prompts/       # Prompt templates
│   └── server.ts      # Entry point
├── ⚙️  config/        # Server configuration
├── 🧪  tests/         # Vitest test suite
└── 📋  task.md        # Sprint tasks
```

---

<div align="center">
<a href="LICENSE">MIT License</a> · Built by harinish45
</div>