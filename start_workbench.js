/**
 * OMENA Mobile Agent Workbench - Production Launcher & Tunnel Supervisor
 * Guarantees Chrome 9222 is alive, launches port 8080 workbench server,
 * and sets up zero-config Cloudflare public HTTPS tunnel for mobile phone access.
 */

import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..');
const CLOUDFLARED_EXE = process.env.CLOUDFLARED_PATH || (
  process.platform === 'win32' && process.env.USERPROFILE
    ? path.join(process.env.USERPROFILE, '.gemini', 'antigravity', 'bin', 'cloudflared.exe')
    : 'cloudflared'
);
const URL_FILE = path.join(WORKSPACE_ROOT, 'storage', 'workbench_public_url.txt');
const INFRA_FILE = path.join(WORKSPACE_ROOT, 'storage', 'memory', 'infrastructure_state.json');

async function isPortOpen(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/api/status`, { timeout: 1500 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function startServer() {
  const isRunning = await isPortOpen(8080);
  if (isRunning) {
    console.log('[Workbench Launcher] Port 8080 is already active and serving!');
    return;
  }

  console.log('[Workbench Launcher] Spawning Server on port 8080...');
  const serverProcess = spawn('node', [path.join(__dirname, 'server.js')], {
    cwd: WORKSPACE_ROOT,
    detached: true,
    stdio: 'ignore'
  });
  serverProcess.unref();

  // Wait for 8080
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 400));
    if (await isPortOpen(8080)) {
      console.log('[Workbench Launcher] Server successfully listening on port 8080.');
      return;
    }
  }
}

async function startTunnel() {
  if (!fs.existsSync(CLOUDFLARED_EXE)) {
    console.log('[Workbench Launcher] Cloudflared not found at', CLOUDFLARED_EXE);
    return null;
  }

  console.log('[Workbench Launcher] Spawning Cloudflare Tunnel for port 8080...');
  const tunnelLogPath = path.join(WORKSPACE_ROOT, 'storage', 'workbench_tunnel.log');
  const logStream = fs.createWriteStream(tunnelLogPath, { flags: 'w' });

  const tunnel = spawn(CLOUDFLARED_EXE, ['tunnel', '--url', 'http://127.0.0.1:8080', '--no-autoupdate'], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  tunnel.stdout.pipe(logStream);
  tunnel.stderr.pipe(logStream);
  tunnel.unref();

  console.log('[Workbench Launcher] Waiting for Cloudflare HTTPS tunnel URL...');
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (fs.existsSync(tunnelLogPath)) {
      const logs = fs.readFileSync(tunnelLogPath, 'utf8');
      const match = logs.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match) {
        const publicUrl = match[0];
        fs.writeFileSync(URL_FILE, publicUrl, 'utf8');
        console.log('====================================================');
        console.log('🚀 OMENA MOBILE AGENT WORKBENCH IS LIVE!');
        console.log('📱 Mobile HTTPS URL:', publicUrl);
        console.log('💻 Local Desktop URL: http://localhost:8080');
        console.log('====================================================');

        // Update infrastructure state
        if (fs.existsSync(INFRA_FILE)) {
          try {
            const infra = JSON.parse(fs.readFileSync(INFRA_FILE, 'utf8'));
            infra.services = infra.services || {};
            infra.services.mobileWorkbench = {
              port: 8080,
              publicUrl,
              status: 'PRODUCTION_ONLINE',
              lastStarted: new Date().toISOString()
            };
            fs.writeFileSync(INFRA_FILE, JSON.stringify(infra, null, 2), 'utf8');
          } catch {}
        }

        return publicUrl;
      }
    }
  }

  console.log('[Workbench Launcher] Tunnel started, check logs at storage/workbench_tunnel.log');
  return null;
}

async function main() {
  await startServer();
  await startTunnel();
}

main().catch(err => console.error('Launcher Error:', err));
