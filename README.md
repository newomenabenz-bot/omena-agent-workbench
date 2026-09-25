# OMENA Autonomous Agentic IDE & Multi-Provider Workbench v4.1.0
> **Production-Grade Provider-Agnostic Autonomous AI Agent Workbench & Agentic IDE**  
> Minimalist `llama.cpp`-style mobile web UI backed by an enterprise-hardened Node.js engine, multi-provider runtime contract, AES-256-GCM encrypted secret persistence, dynamic model registry & capability routing, multi-turn tool continuation loop, and native SQLite WAL persistence.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg?logo=docker&logoColor=white)](Dockerfile)
[![Node.js](https://img.shields.io/badge/Node.js-v22+-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org)
[![SQLite](https://img.shields.io/badge/Database-SQLite%20WAL-003B57.svg?logo=sqlite&logoColor=white)](https://sqlite.org)
[![Version](https://img.shields.io/badge/Release-v4.1.0-emerald.svg)](https://github.com/newomenabenz-bot/omena-agent-workbench)

---

## 🌟 Full Backend Agent ↔ Frontend Architecture

The architecture functions as a unified pipeline:
```text
User
  ↓
Web UI (Minimalist Mobile & Desktop PWA)
  ↓
Agent Session (Persistent SQLite WAL)
  ↓
Model / Provider Adapter (Gemini / OpenAI / Claude / DeepSeek / Local GGUF)
  ↓
Agent Orchestrator
  ↓
Planner / Tool Loop
  ↓
┌────────────────────────────────────────────────────────┐
│ Agentic IDE / Workbench                                │
│                                                        │
│ • Terminal: live streaming execution & timeouts        │
│ • Filesystem: read, write, edit, delete, directory tree│
│ • Git: status, diff, add, commit, log                  │
│ • Browser: headless Chromium, navigation, screenshots  │
│ • Processes: process listing, kill & emergency stop    │
│ • Database: SQLite WAL query & schema inspection       │
│ • Build/Test: automated test runner & error recovery   │
│ • Package Manager: dependency install & audit          │
└────────────────────────────────────────────────────────┘
  ↓
Tool results / screenshots / logs
  ↓
Agent Runtime
  ↓
SSE Bidirectional Event Stream (Unbuffered)
  ↓
Web UI
```

---

## 🚀 Key System Features

### 1. True Autonomous Agentic Loop
The model does not merely chat; it genuinely operates the Workbench:
1. Receives the user's task.
2. Inspects workspace structure.
3. Selects and executes Workbench tools.
4. Observes structured results and stderr.
5. Reasons over failures and patches implementation files.
6. Retests until assertions succeed.
7. Captures visual browser rendering.
8. Commits clean changes to Git.
9. Returns verifiable final results.

### 2. First-Class Workbench Interfaces
Structured tool interfaces return complete telemetry:
* `filesystem`: read, write, edit (string replacement), delete, list
* `terminal`: child process spawn, live output streaming, exit code, execution duration
* `git`: status, diff, commit, log, branch
* `browser`: real Chromium viewport capture, DOM inspection, screenshot buffer
* `process`: process inspection, process termination, emergency stop
* `build` & `test`: automated test execution and defect recovery
* `workspace`: repository tree exploration and dependency inspection

### 3. Bidirectional Streaming Event Protocol
Real-time SSE events with unbuffered reverse proxy headers (`X-Accel-Buffering: no`):
* `agent.started`: execution start with runId
* `agent.status` & `agent.thinking`: real-time phase updates
* `tool.started`: tool invocation with input payload
* `terminal.output` & `tool.output`: live character streaming
* `tool.completed`: execution result, duration, exit code
* `file.changed`: file creation/modification notifications
* `browser.screenshot`: responsive visual viewport card
* `agent.completed`: final status and execution duration
* `agent.error` & `agent.cancelled`: error telemetry and user cancellation

### 4. Enterprise Security & Guardrails
* **HttpOnly Session Cookies:** Constant-time password validation (`crypto.timingSafeEqual`) issuing `HttpOnly`, `SameSite=Lax`, Secure cookies.
* **True DNS SSRF Defense:** Actively resolves hostnames (`dns.promises.lookup`) to block loopback (`127.0.0.1`), cloud metadata (`169.254.169.254`), and private subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
* **Path Containment Guardrails:** Scopes execution strictly to `WORKSPACE_ROOT`. Blocks directory traversal (`../`) and sensitive host system paths (`/var/run/docker.sock`, `/etc/shadow`).
* **Emergency Agent Stop:** Endpoint (`POST /api/agent/emergency-stop`) instantly terminates running child processes.

---

## 🛠️ Multi-Provider Capability Matrix

| Model ID | Provider | Streaming | Tools | Vision | Reasoning |
| :--- | :--- | :---: | :---: | :---: | :---: |
| `gemini-2.0-flash` | Google Gemini | ✅ | ✅ | ✅ | ❌ |
| `gemini-1.5-pro` | Google Gemini | ✅ | ✅ | ✅ | ❌ |
| `gpt-4o` | OpenAI ChatGPT | ✅ | ✅ | ✅ | ❌ |
| `o3-mini` | OpenAI ChatGPT | ✅ | ✅ | ❌ | ✅ |
| `claude-3-5-sonnet` | Anthropic Claude | ✅ | ✅ | ✅ | ❌ |
| `deepseek-r1` | DeepSeek | ✅ | ✅ | ❌ | ✅ |
| `local-gguf` | Ollama / llama.cpp | ✅ | ❌ | ❌ | ❌ |

---

## 📦 Production Deployment

Refer to [`DEPLOY.md`](DEPLOY.md) for complete Linux deployment instructions:

```bash
git clone <REPOSITORY_URL> /opt/omena/app
cd /opt/omena/app
cp .env.example .env
# Edit .env with your ADMIN_PASSWORD
docker compose up -d --build
```

### Health Check:
```bash
curl -sf http://localhost:8080/health
curl -sf http://localhost:8080/ready
```

---

## 🧪 Automated Test Suite

Run the full verification suite locally:
```bash
# Model adapter capability schemas (22 tests)
node tests/adapters.test.js

# Process kill, SQLite persistence & security regressions (17 tests)
node tests/clean_room_persistence.test.js

# Full HTTP API & SSRF endpoint validation (14 tests)
node test_endpoints.js

# Directive v4.0 End-to-End autonomous task (6 phases)
node tests/e2e_autonomous_task.test.js
```
Total: **54 / 54 Automated Tests Passing (100%)**.
