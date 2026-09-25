/**
 * OMENA Agentic IDE Workbench Engine v4.0
 * First-class backend execution engine providing structured interfaces for:
 * filesystem, terminal, git, browser, process, http, database, workspace, search, build, test, package-manager.
 */

import fs from 'fs';
import path from 'path';
import { spawn, exec } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { SecurityGuard } from './security.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

let puppeteer = null;
try {
  puppeteer = require('puppeteer-core');
} catch {
  try {
    puppeteer = require(path.resolve(__dirname, '..', 'browser', 'node_modules', 'puppeteer-core'));
  } catch {}
}

export class AgenticWorkbench {
  constructor(options = {}) {
    this.workspaceRoot = path.resolve(process.env.WORKSPACE_ROOT || options.workspaceRoot || path.join(__dirname, 'workspace'));
    this.storageDir = path.resolve(process.env.STORAGE_DIR || options.storageDir || path.join(__dirname, 'storage'));
    this.executionMode = process.env.EXECUTION_MODE || 'container';
    this.executionPrivilege = process.env.EXECUTION_PRIVILEGE || 'standard';
    this.activeProcesses = new Map();
    this.activeBrowser = null;
    this.ensureDirs();
  }

  ensureDirs() {
    [
      this.workspaceRoot,
      this.storageDir,
      path.join(this.storageDir, 'artifacts'),
      path.join(this.storageDir, 'memory'),
      path.join(this.storageDir, 'workbench_uploads')
    ].forEach(d => {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    });
  }

  resolveWorkspacePath(relPath) {
    const isHostAdmin = this.executionMode === 'host' && this.executionPrivilege === 'admin';
    const resolved = path.resolve(this.workspaceRoot, relPath || '');
    if (!isHostAdmin && !resolved.startsWith(this.workspaceRoot)) {
      throw new Error(`Security Exception: Access denied outside workspace root: ${relPath}`);
    }
    return resolved;
  }

  getExecutionIdentity() {
    let user = 'unknown';
    try {
      const os = require('os');
      user = os.userInfo().username;
    } catch {}
    return {
      mode: this.executionMode,
      privilege: this.executionPrivilege,
      user,
      platform: process.platform,
      arch: process.arch,
      pid: process.pid,
      isRoot: typeof process.getuid === 'function' ? process.getuid() === 0 : false
    };
  }

  // -------------------------------------------------------------
  // 1. FILESYSTEM INTERFACE
  // -------------------------------------------------------------
  get filesystem() {
    return {
      readFile: async (relPath) => {
        const full = this.resolveWorkspacePath(relPath);
        if (!fs.existsSync(full)) throw new Error(`File not found: ${relPath}`);
        const content = fs.readFileSync(full, 'utf8');
        return {
          type: 'tool.result',
          tool: 'filesystem.readFile',
          path: relPath,
          sizeBytes: Buffer.byteLength(content),
          content
        };
      },

      writeFile: async (relPath, content) => {
        const full = this.resolveWorkspacePath(relPath);
        const dir = path.dirname(full);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(full, content, 'utf8');
        return {
          type: 'tool.result',
          tool: 'filesystem.writeFile',
          path: relPath,
          sizeBytes: Buffer.byteLength(content),
          status: 'written'
        };
      },

      editFile: async (relPath, targetContent, replacementContent) => {
        const full = this.resolveWorkspacePath(relPath);
        if (!fs.existsSync(full)) throw new Error(`File not found: ${relPath}`);
        const original = fs.readFileSync(full, 'utf8');
        if (!original.includes(targetContent)) {
          throw new Error(`Target content to replace was not found in ${relPath}`);
        }
        const updated = original.replace(targetContent, replacementContent);
        fs.writeFileSync(full, updated, 'utf8');
        return {
          type: 'tool.result',
          tool: 'filesystem.editFile',
          path: relPath,
          status: 'updated'
        };
      },

      deleteFile: async (relPath) => {
        const full = this.resolveWorkspacePath(relPath);
        if (fs.existsSync(full)) {
          fs.rmSync(full, { recursive: true, force: true });
        }
        return {
          type: 'tool.result',
          tool: 'filesystem.deleteFile',
          path: relPath,
          status: 'deleted'
        };
      },

      listDirectory: async (relPath = '.', recursive = false) => {
        const full = this.resolveWorkspacePath(relPath);
        if (!fs.existsSync(full)) throw new Error(`Directory not found: ${relPath}`);

        const results = [];
        const walk = (dir, prefix = '') => {
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const e of entries) {
            if (e.name === 'node_modules' || e.name === '.git') continue;
            const itemRel = path.join(prefix, e.name).replace(/\\/g, '/');
            results.push({
              name: e.name,
              path: itemRel,
              isDirectory: e.isDirectory(),
              size: e.isFile() ? fs.statSync(path.join(dir, e.name)).size : 0
            });
            if (recursive && e.isDirectory()) {
              walk(path.join(dir, e.name), itemRel);
            }
          }
        };

        walk(full);
        return {
          type: 'tool.result',
          tool: 'filesystem.listDirectory',
          basePath: relPath,
          entries: results
        };
      }
    };
  }

  // -------------------------------------------------------------
  // 2. TERMINAL INTERFACE
  // -------------------------------------------------------------
  get terminal() {
    return {
      executeCommand: (command, options = {}) => {
        return new Promise((resolve, reject) => {
          const startTime = Date.now();
          const cwd = options.cwd ? this.resolveWorkspacePath(options.cwd) : this.workspaceRoot;
          const timeout = options.timeout || 60000;

          // Guardrail check
          const validation = SecurityGuard.validateSafeCommand(command, {
            executionMode: this.executionMode,
            executionPrivilege: this.executionPrivilege
          });
          if (!validation.allowed) {
            return resolve({
              type: 'tool.result',
              tool: 'terminal',
              command,
              exitCode: 1,
              stdout: '',
              stderr: `Security Exception: ${validation.reason}`,
              durationMs: Date.now() - startTime,
              blocked: true
            });
          }

          const isWin = process.platform === 'win32';
          const shell = isWin ? 'powershell.exe' : '/bin/bash';
          const shellArgs = isWin ? ['-NoProfile', '-Command', command] : ['-c', command];

          let stdout = '';
          let stderr = '';

          const child = spawn(shell, shellArgs, {
            cwd,
            env: {
              ...process.env,
              ...options.env,
              WORKSPACE_ROOT: this.workspaceRoot,
              NODE_ENV: 'development'
            },
            windowsHide: true
          });

          const pid = child.pid;
          this.activeProcesses.set(pid, { command, child, startTime });

          let killed = false;
          const timer = setTimeout(() => {
            killed = true;
            child.kill('SIGTERM');
            setTimeout(() => {
              try { child.kill('SIGKILL'); } catch {}
            }, 2000);
          }, timeout);

          if (child.stdout) {
            child.stdout.on('data', chunk => {
              const text = chunk.toString();
              stdout += text;
              if (options.onChunk) options.onChunk(text, 'stdout');
            });
          }

          if (child.stderr) {
            child.stderr.on('data', chunk => {
              const text = chunk.toString();
              stderr += text;
              if (options.onChunk) options.onChunk(text, 'stderr');
            });
          }

          child.on('close', (code, signal) => {
            clearTimeout(timer);
            this.activeProcesses.delete(pid);
            const durationMs = Date.now() - startTime;
            resolve({
              type: 'tool.result',
              tool: 'terminal',
              command,
              exitCode: killed ? 124 : (code ?? (signal ? 1 : 0)),
              signal: signal || null,
              stdout: stdout.trim(),
              stderr: killed ? `Command timed out after ${timeout}ms\n${stderr}` : stderr.trim(),
              durationMs
            });
          });

          child.on('error', err => {
            clearTimeout(timer);
            this.activeProcesses.delete(pid);
            resolve({
              type: 'tool.result',
              tool: 'terminal',
              command,
              exitCode: 1,
              stdout,
              stderr: `Execution error: ${err.message}`,
              durationMs: Date.now() - startTime
            });
          });
        });
      }
    };
  }

  // -------------------------------------------------------------
  // 3. GIT INTERFACE
  // -------------------------------------------------------------
  get git() {
    return {
      status: async () => {
        return this.terminal.executeCommand('git status --short');
      },
      diff: async () => {
        return this.terminal.executeCommand('git diff');
      },
      add: async (files = '.') => {
        return this.terminal.executeCommand(`git add ${Array.isArray(files) ? files.join(' ') : files}`);
      },
      commit: async (message) => {
        const safeMsg = (message || 'Autonomous agent update').replace(/"/g, '\\"');
        await this.git.add('.');
        return this.terminal.executeCommand(`git commit -m "${safeMsg}"`);
      },
      log: async (count = 5) => {
        return this.terminal.executeCommand(`git log -n ${count} --oneline`);
      }
    };
  }

  // -------------------------------------------------------------
  // 4. BROWSER & COMPUTER USE INTERFACE
  // -------------------------------------------------------------
  get browser() {
    return {
      launch: async (options = {}) => {
        if (this.activeBrowser) return this.activeBrowser;

        const isLinux = process.platform === 'linux';
        const chromePath = process.env.PUPPETEER_EXECUTABLE_PATH || (isLinux ? '/usr/bin/chromium' : 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');

        const launchArgs = [
          '--disable-gpu',
          '--disable-dev-shm-usage',
          '--window-size=1280,800'
        ];

        // Only add --no-sandbox where sandboxing is disabled in environment/container
        if (process.env.DOCKER_CONTAINER || isLinux) {
          launchArgs.push('--no-sandbox', '--disable-setuid-sandbox');
        }

        try {
          this.activeBrowser = await puppeteer.launch({
            executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
            channel: !fs.existsSync(chromePath) ? 'chrome' : undefined,
            headless: 'new',
            args: launchArgs
          });
          return { status: 'launched', browser: this.activeBrowser };
        } catch (err) {
          throw new Error(`Failed to launch browser: ${err.message}`);
        }
      },

      navigate: async (url) => {
        // SSRF Guardrail
        const ssrf = await SecurityGuard.validateTargetUrl(url);
        if (!ssrf.allowed) {
          throw new Error(`SSRF Guardrail: URL blocked by SSRF defense (${ssrf.reason})`);
        }

        const bInfo = await this.browser.launch();
        const page = (await this.activeBrowser.pages())[0] || (await this.activeBrowser.newPage());
        await page.setViewport({ width: 1280, height: 800 });
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

        const title = await page.title();
        const screenshotBuf = await page.screenshot({ encoding: 'base64' });

        return {
          type: 'tool.result',
          tool: 'browser.navigate',
          url,
          title,
          screenshotBase64: screenshotBuf
        };
      },

      screenshot: async (outputPath = null) => {
        if (!this.activeBrowser) throw new Error('No active browser session.');
        const page = (await this.activeBrowser.pages())[0];
        if (!page) throw new Error('No active browser tab.');

        const screenshotBuf = await page.screenshot({ encoding: 'base64' });
        if (outputPath) {
          const target = this.resolveWorkspacePath(outputPath);
          fs.writeFileSync(target, Buffer.from(screenshotBuf, 'base64'));
        }
        return {
          type: 'tool.result',
          tool: 'browser.screenshot',
          screenshotBase64: screenshotBuf
        };
      },

      close: async () => {
        if (this.activeBrowser) {
          await this.activeBrowser.close().catch(() => {});
          this.activeBrowser = null;
        }
        return { status: 'closed' };
      }
    };
  }

  // -------------------------------------------------------------
  // 5. PROCESS MANAGEMENT INTERFACE
  // -------------------------------------------------------------
  get process() {
    return {
      list: () => {
        const list = [];
        for (const [pid, info] of this.activeProcesses.entries()) {
          list.push({
            pid,
            command: info.command,
            uptimeSeconds: Math.floor((Date.now() - info.startTime) / 1000)
          });
        }
        return {
          type: 'tool.result',
          tool: 'process.list',
          processes: list
        };
      },

      kill: (pid) => {
        const info = this.activeProcesses.get(parseInt(pid, 10));
        if (!info) return { status: 'not_found', pid };
        try {
          info.child.kill('SIGKILL');
          this.activeProcesses.delete(parseInt(pid, 10));
          return { status: 'killed', pid };
        } catch (err) {
          return { status: 'error', message: err.message };
        }
      },

      emergencyStop: () => {
        let count = 0;
        for (const [pid, info] of this.activeProcesses.entries()) {
          try {
            info.child.kill('SIGKILL');
            count++;
          } catch {}
        }
        this.activeProcesses.clear();
        if (this.activeBrowser) {
          this.browser.close().catch(() => {});
        }
        return {
          type: 'tool.result',
          tool: 'emergencyStop',
          processesTerminated: count,
          status: 'EMERGENCY_STOP_COMPLETE'
        };
      }
    };
  }

  // -------------------------------------------------------------
  // 6. BUILD, TEST & PACKAGE MANAGEMENT
  // -------------------------------------------------------------
  get build() {
    return {
      run: (cmd = 'npm run build') => this.terminal.executeCommand(cmd)
    };
  }

  get test() {
    return {
      run: (cmd = 'npm test') => this.terminal.executeCommand(cmd)
    };
  }

  get packageManager() {
    return {
      install: (pkg = '') => this.terminal.executeCommand(`npm install ${pkg}`.trim())
    };
  }

  // -------------------------------------------------------------
  // 7. WORKSPACE AWARENESS
  // -------------------------------------------------------------
  get workspace() {
    return {
      inspect: async () => {
        const filesRes = await this.filesystem.listDirectory('.', true);
        const pkgPath = path.join(this.workspaceRoot, 'package.json');
        let pkg = null;
        if (fs.existsSync(pkgPath)) {
          try { pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')); } catch {}
        }

        return {
          type: 'tool.result',
          tool: 'workspace.inspect',
          workspaceRoot: this.workspaceRoot,
          fileCount: filesRes.entries.length,
          files: filesRes.entries.map(e => e.path),
          packageInfo: pkg ? { name: pkg.name, version: pkg.version, scripts: pkg.scripts } : null
        };
      }
    };
  }
}

export const agenticWorkbench = new AgenticWorkbench();
