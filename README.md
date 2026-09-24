# OMENA Mobile Agent Workbench & Agentic IDE

Production-grade, ultra-lightweight, and fully autonomous **AI Agent Workbench & Agentic IDE** with a minimalist mobile web UI matching the clean aesthetic of `llama.cpp`'s server interface.

---

## 🌟 Key Features

- **Distraction-Free Minimalist UI:** 100% faithful reproduction of the `llama.cpp` server UI.
  - Clean White (Safari) & OLED True Black (Android) dual themes.
  - Large rounded signature input capsule with auto-expanding textarea.
  - Paperclip attachment button `📎` for images and files.
  - Microphone button `🎙️` with real-time Web Speech API voice dictation.
  - Circular send button `(↑)`.
- **Multi-Model & Subscription Integration:**
  - **Google Gemini:** Gemini 2.0 Flash & Gemini 1.5 Pro (API Key or Google Workspace / Gemini Advanced subscription).
  - **OpenAI / ChatGPT:** GPT-4o & o3-mini (OpenAI API Key or ChatGPT Plus Session Token).
  - **Anthropic Claude:** Claude 3.5 Sonnet & Claude 3.7 Sonnet.
  - **DeepSeek:** DeepSeek R1 & V3.
  - **Local Models:** Connects directly to local Ollama (`:11434`) or llama.cpp GGUF (`:8080`).
- **Full Autonomous DevOps Operator:**
  - **Chrome DevTools MCP (Port 9222):** Direct control of real Chrome with genuine human cookies and profiles.
  - **PowerShell & Bash Shell Runner:** Real-time terminal command execution with live streaming output.
  - **Workspace Code & File Engine:** Direct reading, searching, AST inspection, and diff-based code modifications.
  - **Document Ops:** Automated PDF, XLSX, and DOCX generation.
  - **Multi-Tier Memory Store:** Persistent state syncing across `user_memory.json` and `task_memory.json`.
- **Zero-Config Mobile Access (PWA):**
  - Installable as a standalone app on iOS Safari and Android Chrome via "Add to Home Screen".
  - Tunneled over secure public HTTPS via Cloudflare Tunnel.

---

## 🚀 Quick Start

```bash
# Clone the repository
git clone https://github.com/YOUR_ORG/omena-mobile-agent-workbench.git
cd omena-mobile-agent-workbench

# Launch the workbench and public Cloudflare tunnel
node start_workbench.js
```

---

## 📁 Repository Structure

```
omena-mobile-agent-workbench/
├── public/
│   ├── index.html        # Clean minimal HTML5 SPA
│   ├── style.css         # OLED Black & Clean White responsive styles
│   ├── app.js            # Client-side SSE stream, voice dictation & events
│   └── manifest.json     # PWA manifest for standalone mobile home screen
├── server.js             # Native Node.js HTTP & SSE backend server
├── agent_engine.js       # Autonomous multi-model dispatcher & tool operator
├── start_workbench.js    # Tunnel supervisor & daemon manager
├── package.json          # Project metadata and npm scripts
└── README.md             # Documentation
```

---

## 🛡️ License
MIT License. Built with OMENA Autonomous Workspace.
