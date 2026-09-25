/**
 * OMENA Enterprise Agent Workbench Engine v2.0
 * Multi-Provider Capability Adapters, Security Guardrails, and Safe Event Protocol
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SecurityGuard } from './security.js';
import { adapterManager } from './providers/adapter_manager.js';
import { WorkbenchDatabase } from './db.js';
import { AgentOrchestrator } from './agent_orchestrator.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '..', '..');
const MEMORY_DIR = path.join(WORKSPACE_ROOT, 'storage', 'memory');
const ARTIFACTS_DIR = path.join(WORKSPACE_ROOT, 'storage', 'artifacts');
const UPLOADS_DIR = path.join(WORKSPACE_ROOT, 'storage', 'workbench_uploads');

export class AgentEngine {
  constructor(db = null) {
    this.db = db || new WorkbenchDatabase();
    this.orchestrator = new AgentOrchestrator(this.db);
    this.ensureDirs();
  }

  ensureDirs() {
    [MEMORY_DIR, ARTIFACTS_DIR, UPLOADS_DIR].forEach(d => {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });
  }

  /**
   * Process prompt and stream structured events:
   * agent.started, tool.started, terminal.output, file.changed, browser.screenshot, agent.completed
   * Also translates to legacy tool_start, tool_log, tool_done, browser_frame, done
   */
  async processPromptStream(prompt, emit, options = {}) {
    return this.orchestrator.runTaskStream({
      prompt,
      model: options.model,
      sessionId: options.sessionId,
      credentials: options.credentials
    }, emit);
  }

  cancelRun(runId) {
    return this.orchestrator.cancelRun(runId);
  }

  detectIntent(prompt) {
    const lower = prompt.toLowerCase();

    // Browser automation
    if (
      lower.includes('browser') || lower.includes('chrome') || lower.includes('website') ||
      lower.includes('navigate') || lower.includes('url') || lower.includes('http') ||
      lower.includes('screenshot') || lower.includes('hacker news') || lower.includes('webpage')
    ) {
      return { category: 'BROWSER', raw: prompt };
    }

    // Direct shell
    if (
      lower.startsWith('run ') || lower.startsWith('powershell ') || lower.startsWith('cmd ') ||
      lower.startsWith('exec ') || lower.startsWith('bash ') || lower.includes('get-service') ||
      lower.includes('get-process') || lower.includes('git status') || lower.includes('npm ') ||
      lower.includes('docker ')
    ) {
      return { category: 'SHELL', raw: prompt };
    }

    // Code / File system
    if (
      lower.includes('file') || lower.includes('read') || lower.includes('write') ||
      lower.includes('code') || lower.includes('directory') || lower.includes('project structure')
    ) {
      return { category: 'CODE_OR_FILE', raw: prompt };
    }

    // Diagnostics / Status
    if (lower.includes('status') || lower.includes('memory') || lower.includes('health') || lower.includes('ready')) {
      return { category: 'MEMORY_OR_STATUS', raw: prompt };
    }

    return { category: 'GENERAL', raw: prompt };
  }

  async handleBrowserTask(intent, prompt, emit) {
    const callId = `call_${Date.now()}`;
    let targetUrl = 'https://news.ycombinator.com';

    const match = prompt.match(/https?:\/\/[^\s]+/);
    if (match) {
      targetUrl = match[0];
    } else if (prompt.toLowerCase().includes('google')) {
      targetUrl = 'https://www.google.com';
    } else if (prompt.toLowerCase().includes('wikipedia')) {
      targetUrl = 'https://www.wikipedia.org';
    }

    // SSRF Guardrail validation
    try {
      targetUrl = SecurityGuard.validateUrlForSSRF(targetUrl);
    } catch (ssrfErr) {
      emit({
        type: 'tool_start',
        tool: 'Browser Engine',
        callId,
        input: { target: targetUrl }
      });
      emit({
        type: 'tool_log',
        callId,
        chunk: `[Blocked] ${ssrfErr.message}`
      });
      emit({
        type: 'tool_done',
        callId,
        result: ssrfErr.message,
        durationMs: 5,
        exitCode: 1
      });
      emit({
        type: 'text_chunk',
        token: `⛔ **Security Notice:** Target URL was blocked by SSRF Guardrails.\n*${ssrfErr.message}*`
      });
      return;
    }

    emit({
      type: 'tool_start',
      tool: 'Chrome DevTools Protocol (CDP)',
      callId,
      input: { action: 'navigate', url: targetUrl }
    });

    const start = Date.now();
    let runnerStdout = '';
    let runnerStderr = '';

    const runnerScript = path.join(WORKSPACE_ROOT, 'tools', 'browser', 'execute_real_browser.js');

    const proc = spawn('node', [runnerScript, targetUrl], {
      cwd: WORKSPACE_ROOT,
      env: { ...process.env, WORKSPACE_ROOT }
    });

    proc.stdout.on('data', chunk => {
      const str = chunk.toString();
      runnerStdout += str;
      emit({ type: 'tool_log', callId, chunk: str });
    });

    proc.stderr.on('data', chunk => {
      const str = chunk.toString();
      runnerStderr += str;
      emit({ type: 'tool_log', callId, chunk: str });
    });

    const exitCode = await new Promise(resolve => {
      proc.on('close', resolve);
    });

    const durationMs = Date.now() - start;
    let browserData = null;

    try {
      browserData = JSON.parse(runnerStdout.trim());
    } catch {
      // Non-JSON output
    }

    emit({
      type: 'tool_done',
      callId,
      result: browserData 
        ? `Page: ${browserData.title} | Links: ${browserData.summary?.linksCount || 0}`
        : (runnerStdout.trim() || runnerStderr.trim() || 'Navigation complete'),
      durationMs,
      exitCode
    });

    if (exitCode === 0 && browserData) {
      emit({
        type: 'browser_frame',
        url: browserData.url,
        title: browserData.title,
        frameUrl: '/api/browser/frame',
        monitorUrl: '/api/browser/monitor'
      });

      emit({
        type: 'text_chunk',
        token: `✅ **Live Page Navigated & Inspected:**\n- **URL:** \`${browserData.url}\`\n- **Title:** **${browserData.title}**\n- **Elements Discovered:** ${browserData.summary?.headings?.length || 0} headings, ${browserData.summary?.linksCount || 0} links\n\n*The real viewport screenshot and photorealistic monitor render are available in the slide-up drawer.*`
      });
    } else {
      emit({
        type: 'text_chunk',
        token: `⚠️ **Browser Run Alert:** Finished with code ${exitCode}.\n\`\`\`\n${runnerStderr.trim() || runnerStdout.trim()}\n\`\`\``
      });
    }
  }

  async handleShellTask(intent, prompt, emit) {
    const callId = `call_${Date.now()}`;
    let cmd = prompt;
    ['run ', 'powershell ', 'cmd ', 'exec ', 'bash '].forEach(prefix => {
      if (cmd.toLowerCase().startsWith(prefix)) cmd = cmd.slice(prefix.length).trim();
    });

    // Guardrail Check
    const safety = SecurityGuard.validateCommand(cmd);
    if (!safety.allowed) {
      emit({
        type: 'tool_start',
        tool: 'Terminal Operator',
        callId,
        input: { command: cmd }
      });
      emit({
        type: 'tool_log',
        callId,
        chunk: `[Blocked] ${safety.reason}`
      });
      emit({
        type: 'tool_done',
        callId,
        result: safety.reason,
        durationMs: 2,
        exitCode: 1
      });
      emit({
        type: 'text_chunk',
        token: `⛔ **Command Blocked by Safety Policy:**\n*${safety.reason}*`
      });
      return;
    }

    emit({
      type: 'tool_start',
      tool: 'Terminal Operator',
      callId,
      input: { command: cmd }
    });

    const start = Date.now();
    let stdoutData = '';
    let stderrData = '';

    const isWindows = process.platform === 'win32';
    const shellBinary = isWindows ? 'powershell.exe' : 'bash';
    const shellArgs = isWindows ? ['-NoProfile', '-Command', cmd] : ['-c', cmd];

    const proc = spawn(shellBinary, shellArgs, {
      cwd: WORKSPACE_ROOT,
      env: process.env
    });

    proc.stdout.on('data', chunk => {
      const str = chunk.toString();
      stdoutData += str;
      emit({ type: 'tool_log', callId, chunk: str });
    });

    proc.stderr.on('data', chunk => {
      const str = chunk.toString();
      stderrData += str;
      emit({ type: 'tool_log', callId, chunk: str });
    });

    const exitCode = await new Promise(resolve => {
      proc.on('close', resolve);
    });

    const durationMs = Date.now() - start;

    emit({
      type: 'tool_done',
      callId,
      result: (stdoutData.trim() || stderrData.trim()).slice(0, 300) || 'Done',
      durationMs,
      exitCode
    });

    emit({
      type: 'text_chunk',
      token: `### Terminal Output (Exit Code ${exitCode})\n\`\`\`${isWindows ? 'powershell' : 'bash'}\n${(stdoutData.trim() || stderrData.trim() || 'Command completed with no output.')}\n\`\`\``
    });
  }

  async handleFileTask(intent, prompt, emit) {
    const callId = `call_${Date.now()}`;
    emit({
      type: 'tool_start',
      tool: 'Workspace Filesystem',
      callId,
      input: { query: prompt }
    });

    const start = Date.now();
    const files = fs.readdirSync(WORKSPACE_ROOT, { withFileTypes: true })
      .filter(d => !d.name.startsWith('.') && d.name !== 'node_modules')
      .map(d => `${d.isDirectory() ? '📁' : '📄'} ${d.name}`);

    emit({
      type: 'tool_log',
      callId,
      chunk: `Found ${files.length} top-level entries in workspace`
    });

    const durationMs = Date.now() - start;

    emit({
      type: 'tool_done',
      callId,
      result: `Listed ${files.length} items`,
      durationMs,
      exitCode: 0
    });

    emit({
      type: 'text_chunk',
      token: `### Workspace Directory (${path.basename(WORKSPACE_ROOT)})\n${files.map(f => `- ${f}`).join('\n')}`
    });
  }

  async handleStatusTask(intent, prompt, emit) {
    const callId = `call_${Date.now()}`;
    emit({
      type: 'tool_start',
      tool: 'Health & Diagnostics',
      callId,
      input: { query: prompt }
    });

    const start = Date.now();
    const dbStatus = this.db.healthCheck();
    const mem = process.memoryUsage();
    const uptimeSec = Math.round(process.uptime());

    const result = `DB: ${dbStatus ? 'Healthy' : 'Degraded'} | RSS: ${(mem.rss / 1024 / 1024).toFixed(1)}MB | Uptime: ${uptimeSec}s`;

    emit({
      type: 'tool_log',
      callId,
      chunk: result
    });

    emit({
      type: 'tool_done',
      callId,
      result,
      durationMs: Date.now() - start,
      exitCode: 0
    });

    emit({
      type: 'text_chunk',
      token: `### System Status & Telemetry\n- **Host Platform:** \`${process.platform} (${process.arch})\`\n- **Node.js:** \`${process.version}\`\n- **Database:** SQLite WAL (\`${dbStatus ? 'Connected & Healthy' : 'Error'}\`)\n- **Memory Usage:** \`${(mem.rss / 1024 / 1024).toFixed(1)} MB RSS\`\n- **Process Uptime:** \`${uptimeSec} seconds\`\n- **Security Mode:** HttpOnly Session Auth + SSRF Guardrails Active`
    });
  }

  async handleGeneralTask(prompt, emit, model) {
    emit({
      type: 'text_chunk',
      token: `I am your **OMENA Autonomous DevOps Assistant** powered by **${model}**.\n\nI can execute terminal commands, automate live Chrome browsers with zero mock data, inspect workspace codebases, and run persistent multi-step engineering tasks.\n\n*How can I assist your workflow today?*`
    });
  }
}
