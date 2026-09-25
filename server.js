/**
 * OMENA Mobile Agent Workbench & Agentic IDE - Enterprise Production Server
 * Hardened with HttpOnly Session Auth, SSRF Guardrails, SQLite WAL, and Multi-Provider Adapters.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WorkbenchDatabase } from './db.js';
import { SecurityGuard } from './security.js';
import { AgentEngine } from './agent_engine.js';
import { adapterManager } from './providers/adapter_manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT || path.resolve(__dirname, '..', '..');
const PUBLIC_DIR = path.join(__dirname, 'public');
const ARTIFACTS_DIR = path.join(WORKSPACE_ROOT, 'storage', 'artifacts');
const UPLOADS_DIR = path.join(WORKSPACE_ROOT, 'storage', 'workbench_uploads');

const PORT = parseInt(process.env.PORT || '8080', 10);
const HOST = process.env.HOST || '0.0.0.0';

const db = new WorkbenchDatabase();
const engine = new AgentEngine(db);

// Discover models on boot from saved credentials
try {
  const bootCreds = db.getProviderCredentials(true);
  adapterManager.discoverAll(bootCreds).then(res => {
    console.log('[OMENA] Boot model discovery completed for providers:', Object.keys(res));
  }).catch(err => {
    console.warn('[OMENA] Boot model discovery warning:', err.message);
  });
} catch (e) {
  console.warn('[OMENA] Boot credential load warning:', e.message);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 10 * 1024 * 1024) { // 10MB limit
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, data, headers = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    ...headers
  });
  res.end(JSON.stringify(data));
}

/**
 * Authenticate incoming request via HttpOnly session cookie
 */
function checkAuth(req) {
  const cookies = SecurityGuard.parseCookies(req.headers.cookie || '');
  const token = cookies.omena_session;
  if (!token) return null;
  return db.validateAuthSession(token);
}

const server = http.createServer(async (req, res) => {
  const hostHeader = req.headers.host || `localhost:${PORT}`;
  const parsedUrl = new URL(req.url, `http://${hostHeader}`);
  const pathname = parsedUrl.pathname;

  // CORS headers for local testing / cross-origin mobile clients
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Cookie');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // --- Operational Endpoints (Public) ---
  if (pathname === '/health' && req.method === 'GET') {
    const isDbHealthy = db.healthCheck();
    const execIdentity = engine.orchestrator.workbench.getExecutionIdentity();
    sendJson(res, isDbHealthy ? 200 : 503, {
      status: isDbHealthy ? 'ok' : 'degraded',
      uptime: process.uptime(),
      db: isDbHealthy ? 'connected' : 'error',
      executionMode: execIdentity.mode,
      executionPrivilege: execIdentity.privilege,
      executionIdentity: execIdentity,
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (pathname === '/ready' && req.method === 'GET') {
    const isDbHealthy = db.healthCheck();
    const portFile = process.env.DEVTOOLS_PORT_FILE || (
      process.platform === 'win32' && process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'DevToolsActivePort')
        : '/tmp/DevToolsActivePort'
    );
    const chromeActive = fs.existsSync(portFile);
    const execIdentity = engine.orchestrator.workbench.getExecutionIdentity();
    sendJson(res, 200, {
      ready: true,
      database: isDbHealthy,
      browser: { active: chromeActive },
      executionMode: execIdentity.mode,
      executionPrivilege: execIdentity.privilege,
      executionIdentity: execIdentity,
      port: PORT,
      timestamp: new Date().toISOString()
    });
    return;
  }

  // --- Authentication Routes ---
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const { password } = body;

      if (!password || !SecurityGuard.verifyPassword(password)) {
        sendJson(res, 401, { error: 'Invalid admin credentials' });
        return;
      }

      const token = SecurityGuard.generateSessionToken();
      db.createAuthSession(token, 'admin');

      const isHttps = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted;
      const cookieHeader = `omena_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${isHttps ? '; Secure' : ''}`;

      sendJson(res, 200, { ok: true, user: { role: 'admin' } }, {
        'Set-Cookie': cookieHeader
      });
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const cookies = SecurityGuard.parseCookies(req.headers.cookie || '');
    if (cookies.omena_session) {
      db.deleteAuthSession(cookies.omena_session);
    }
    sendJson(res, 200, { ok: true }, {
      'Set-Cookie': 'omena_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
    });
    return;
  }

  if (pathname === '/api/auth/me' && req.method === 'GET') {
    const session = checkAuth(req);
    sendJson(res, 200, {
      authenticated: Boolean(session),
      user: session ? { role: session.role } : null
    });
    return;
  }

  // --- Auth Boundary: Protected API Routes ---
  const isProtectedApi = pathname.startsWith('/api/') && !pathname.startsWith('/api/auth/');
  if (isProtectedApi) {
    const authSession = checkAuth(req);
    if (!authSession) {
      sendJson(res, 401, {
        error: 'Authentication required. Please authenticate via POST /api/auth/login.'
      });
      return;
    }
  }

  // --- Capabilities Schema (Protected) ---
  if (pathname === '/api/models' && req.method === 'GET') {
    sendJson(res, 200, {
      models: adapterManager.listModels(),
      default: 'gemini-2.0-flash'
    });
    return;
  }

  // --- Provider Configuration & Masked Status ---
  if (pathname === '/api/providers/status' && req.method === 'GET') {
    sendJson(res, 200, {
      providers: db.getMaskedProviderStatus()
    });
    return;
  }

  if (pathname === '/api/providers/config' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const { credentials = {}, testConnection = true } = body;
      const validation = {};
      let allValid = true;

      for (const [prov, key] of Object.entries(credentials)) {
        if (key && typeof key === 'string' && key.trim().length > 0) {
          if (testConnection) {
            const check = await adapterManager.validateProvider(prov, key);
            validation[prov] = check;
            if (!check.valid) {
              allValid = false;
            }
          } else {
            validation[prov] = { valid: true };
          }
        }
      }

      if (allValid || !testConnection) {
        // Save to DB
        db.saveProviderCredentials(credentials);
        // Discover models for valid providers
        for (const [prov, key] of Object.entries(credentials)) {
          if (key && typeof key === 'string' && key.trim().length > 0) {
            const models = await adapterManager.discoverProviderModels(prov, key);
            if (models && models.length > 0) {
              adapterManager.registerDiscoveredModels(prov, models);
            }
          }
        }
      }

      sendJson(res, allValid ? 200 : 400, {
        success: allValid,
        validation,
        status: db.getMaskedProviderStatus(),
        models: adapterManager.listModels()
      });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // --- System Status & Hardware/CDP Telemetry ---
  if (pathname === '/api/system/status' && req.method === 'GET') {
    const isDbHealthy = db.healthCheck();
    const portFile = process.env.DEVTOOLS_PORT_FILE || (
      process.platform === 'win32' && process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data', 'DevToolsActivePort')
        : '/tmp/DevToolsActivePort'
    );
    const chromeActive = fs.existsSync(portFile);
    const execIdentity = engine.orchestrator.workbench.getExecutionIdentity();
    
    const modelParam = parsedUrl.searchParams.get('model') || 'gemini-2.0-flash';
    const adapter = adapterManager.getAdapter(modelParam);
    const modelCaps = adapter ? adapter.getCapabilities() : {
      id: modelParam,
      name: modelParam,
      contextWindow: 1048576,
      vision: true,
      reasoning: false
    };

    sendJson(res, 200, {
      status: 'online',
      cdp: {
        active: chromeActive,
        target: chromeActive ? 'Chromium 134+ (CDP: Connected)' : 'Chromium (CDP: Standby)'
      },
      vision: Boolean(modelCaps.vision),
      activeModel: {
        id: modelCaps.id,
        name: modelCaps.name,
        contextWindow: modelCaps.contextWindow || 1048576,
        vision: Boolean(modelCaps.vision),
        reasoning: Boolean(modelCaps.reasoning)
      },
      execution: execIdentity,
      uptime: process.uptime()
    });
    return;
  }

  // --- Terminal Command Runner ---
  if (pathname === '/api/terminal/exec' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const command = body.command;
      if (!command) {
        sendJson(res, 400, { error: 'Missing command' });
        return;
      }
      const output = await engine.orchestrator.workbench.terminal.executeCommand(command);
      sendJson(res, 200, output);
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // --- Workspace Tree ---
  if (pathname === '/api/workspace/tree' && req.method === 'GET') {
    try {
      const files = await engine.orchestrator.workbench.filesystem.listDirectory('.', true);
      const list = Array.isArray(files) ? files : (files.entries || []);
      sendJson(res, 200, { tree: list, root: engine.orchestrator.workbench.workspaceRoot });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // --- Memory Store Viewer ---
  if (pathname === '/api/memory/view' && req.method === 'GET') {
    try {
      const memDir = path.join(WORKSPACE_ROOT, 'storage', 'memory');
      const memoryFiles = {};
      if (fs.existsSync(memDir)) {
        const files = fs.readdirSync(memDir);
        for (const f of files) {
          if (f.endsWith('.json')) {
            try {
              memoryFiles[f] = JSON.parse(fs.readFileSync(path.join(memDir, f), 'utf8'));
            } catch {
              memoryFiles[f] = fs.readFileSync(path.join(memDir, f), 'utf8');
            }
          }
        }
      }
      sendJson(res, 200, { memory: memoryFiles, path: memDir });
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  // --- Protected: Streaming Chat / SSE (/api/chat and /api/stream) ---
  if ((pathname === '/api/chat' || pathname === '/api/stream') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { prompt, model, credentials, sessionId } = JSON.parse(body || '{}');
        if (!prompt) {
          sendJson(res, 400, { error: 'Missing prompt' });
          return;
        }

        // Setup SSE Stream (with reverse proxy unbuffered streaming)
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no'
        });

        const emit = (event) => {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        };

        await engine.processPromptStream(prompt, emit, {
          model,
          credentials,
          sessionId: sessionId || 'default_session'
        });

        res.write('data: [DONE]\n\n');
        res.end();
      } catch (err) {
        if (!res.headersSent) {
          sendJson(res, 500, { error: err.message });
        }
      }
    });
    return;
  }

  // --- Emergency Agent Stop / Kill Mechanism ---
  if (pathname === '/api/agent/emergency-stop' && req.method === 'POST') {
    const stopResult = engine.orchestrator.workbench.process.emergencyStop();
    sendJson(res, 200, { ok: true, result: stopResult });
    return;
  }

  // --- Workspace File System API ---
  if (pathname === '/api/workspace/files' && req.method === 'GET') {
    try {
      const files = await engine.orchestrator.workbench.filesystem.listDirectory('.', true);
      sendJson(res, 200, files);
    } catch (err) {
      sendJson(res, 500, { error: err.message });
    }
    return;
  }

  if (pathname === '/api/workspace/file' && req.method === 'GET') {
    const filePath = parsedUrl.searchParams.get('path');
    if (!filePath) {
      sendJson(res, 400, { error: 'Missing path parameter' });
      return;
    }
    try {
      const fileData = await engine.orchestrator.workbench.filesystem.readFile(filePath);
      sendJson(res, 200, fileData);
    } catch (err) {
      sendJson(res, 404, { error: err.message });
    }
    return;
  }

  // --- Process Management API ---
  if (pathname === '/api/processes' && req.method === 'GET') {
    sendJson(res, 200, engine.orchestrator.workbench.process.list());
    return;
  }

  if (pathname === '/api/processes/kill' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const killRes = engine.orchestrator.workbench.process.kill(body.pid);
      sendJson(res, 200, killRes);
    } catch (err) {
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  // --- Protected: Sessions API ---
  if (pathname === '/api/sessions' && req.method === 'GET') {
    const sessions = db.getAllSessions();
    sendJson(res, 200, { sessions });
    return;
  }

  if (pathname.startsWith('/api/sessions/') && req.method === 'GET') {
    const id = pathname.replace('/api/sessions/', '');
    const session = db.getSession(id);
    if (!session) {
      sendJson(res, 404, { error: 'Session not found' });
      return;
    }
    sendJson(res, 200, { session });
    return;
  }

  if (pathname === '/api/sessions' && req.method === 'POST') {
    try {
      const { id, title, model } = await readJsonBody(req);
      const sessId = id || `session_${Date.now()}`;
      const session = db.createSession(sessId, title || 'New Conversation', model || 'gemini-2.0-flash');
      sendJson(res, 200, { ok: true, session });
    } catch (e) {
      sendJson(res, 400, { error: e.message });
    }
    return;
  }

  if (pathname.startsWith('/api/sessions/') && req.method === 'DELETE') {
    const id = pathname.replace('/api/sessions/', '');
    db.deleteSession(id);
    sendJson(res, 200, { ok: true });
    return;
  }

  // --- Protected: Browser Artifacts ---
  if (pathname === '/api/browser/frame' && req.method === 'GET') {
    const frameFile = path.join(ARTIFACTS_DIR, 'desktop_screen.png');
    if (fs.existsSync(frameFile)) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      fs.createReadStream(frameFile).pipe(res);
      return;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450"><rect width="800" height="450" fill="#090d16"/><rect x="20" y="20" width="760" height="410" rx="12" fill="#0f172a" stroke="#1e293b" stroke-width="2"/><circle cx="50" cy="50" r="6" fill="#ef4444"/><circle cx="70" cy="50" r="6" fill="#f59e0b"/><circle cx="90" cy="50" r="6" fill="#10b981"/><text x="400" y="220" dominant-baseline="middle" text-anchor="middle" fill="#94a3b8" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif" font-size="16" font-weight="600">Browser Display Standby</text><text x="400" y="250" dominant-baseline="middle" text-anchor="middle" fill="#64748b" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif" font-size="13">Trigger a browser automation or navigation task to stream live frames.</text></svg>`;
    res.writeHead(200, {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'no-cache'
    });
    res.end(svg);
    return;
  }

  if (pathname === '/api/browser/monitor' && req.method === 'GET') {
    const monitorFile = path.join(ARTIFACTS_DIR, 'computer_monitor_screen.png');
    if (fs.existsSync(monitorFile)) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      fs.createReadStream(monitorFile).pipe(res);
      return;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450"><rect width="800" height="450" fill="#090d16"/><rect x="20" y="20" width="760" height="410" rx="12" fill="#0f172a" stroke="#1e293b" stroke-width="2"/><text x="400" y="220" dominant-baseline="middle" text-anchor="middle" fill="#94a3b8" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif" font-size="16" font-weight="600">4K Monitor Composer Standby</text><text x="400" y="250" dominant-baseline="middle" text-anchor="middle" fill="#64748b" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif" font-size="13">Launch a monitor rendering task to compose photorealistic screen capture.</text></svg>`;
    res.writeHead(200, {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'no-cache'
    });
    res.end(svg);
    return;
  }

  // --- Protected: File Upload ---
  if (pathname === '/api/upload' && req.method === 'POST') {
    const filename = `upload_${Date.now()}.bin`;
    const dest = path.join(UPLOADS_DIR, filename);
    const fileStream = fs.createWriteStream(dest);
    req.pipe(fileStream);
    fileStream.on('finish', () => {
      sendJson(res, 200, { ok: true, filename });
    });
    return;
  }

  // --- Static Files ---
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    }
  });
});

// Graceful Shutdown
function handleShutdown(signal) {
  console.log(`\n[OMENA Server] Received ${signal}. Starting graceful shutdown...`);
  server.close(() => {
    console.log('[OMENA Server] HTTP server closed.');
    try {
      db.close();
      console.log('[OMENA Server] SQLite database connection closed.');
    } catch {}
    process.exit(0);
  });

  // Force close after 5s if hanging
  setTimeout(() => {
    console.error('[OMENA Server] Forceful shutdown timeout.');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

server.listen(PORT, HOST, () => {
  console.log(`[OMENA Workbench v2.0] Listening on http://${HOST}:${PORT}`);
  console.log(`[OMENA Workbench v2.0] Local Address: http://localhost:${PORT}`);
  console.log(`[OMENA Workbench v2.0] Database: SQLite WAL at storage/workbench.db`);
  console.log(`[OMENA Workbench v2.0] Security: HttpOnly Session Cookies & SSRF Guardrails Enabled`);
});
