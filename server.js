/**
 * OMENA Mobile Agent Workbench & Agentic IDE - Production Server
 * Native Node.js HTTP & SSE Server on port 8080
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AgentEngine } from './agent_engine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..');
const PUBLIC_DIR = path.join(__dirname, 'public');
const ARTIFACTS_DIR = path.join(WORKSPACE_ROOT, 'storage', 'artifacts');
const UPLOADS_DIR = path.join(WORKSPACE_ROOT, 'storage', 'workbench_uploads');

const PORT = 8080;
const engine = new AgentEngine();

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost:8080'}`);
  const pathname = parsedUrl.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API Routes
  if (pathname === '/api/chat' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { prompt, model, credentials } = JSON.parse(body || '{}');
        if (!prompt) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing prompt' }));
          return;
        }

        // Setup SSE Stream
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive'
        });

        const emit = (event) => {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        };

        await engine.processPromptStream(prompt, emit, { model, credentials });
        res.write('data: [DONE]\n\n');
        res.end();
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      }
    });
    return;
  }

  if (pathname === '/api/status' && req.method === 'GET') {
    const portFile = 'C:\\Users\\Administrator\\AppData\\Local\\Google\\Chrome\\User Data\\DevToolsActivePort';
    const chromeActive = fs.existsSync(portFile);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      agent: 'OMENA Autonomous Agent v2.0',
      browserActive: chromeActive,
      port: PORT,
      timestamp: new Date().toISOString()
    }));
    return;
  }

  if (pathname === '/api/browser/frame' && req.method === 'GET') {
    const frameCandidates = [
      path.join(ARTIFACTS_DIR, 'desktop_screen.png'),
      path.join(ARTIFACTS_DIR, 'live_frame.jpg'),
      path.join(ARTIFACTS_DIR, 'facebook_form_filled_live.png')
    ];
    for (const f of frameCandidates) {
      if (fs.existsSync(f)) {
        res.writeHead(200, { 'Content-Type': f.endsWith('.png') ? 'image/png' : 'image/jpeg' });
        fs.createReadStream(f).pipe(res);
        return;
      }
    }
    res.writeHead(404);
    res.end('No frame available');
    return;
  }

  if (pathname === '/api/browser/monitor' && req.method === 'GET') {
    const monitorFile = path.join(ARTIFACTS_DIR, 'computer_monitor_screen.png');
    if (fs.existsSync(monitorFile)) {
      res.writeHead(200, { 'Content-Type': 'image/png' });
      fs.createReadStream(monitorFile).pipe(res);
      return;
    }
    res.writeHead(404);
    res.end('Monitor image not found');
    return;
  }

  // File Upload Endpoint
  if (pathname === '/api/upload' && req.method === 'POST') {
    const filename = `upload_${Date.now()}.bin`;
    const dest = path.join(UPLOADS_DIR, filename);
    const fileStream = fs.createWriteStream(dest);
    req.pipe(fileStream);
    fileStream.on('finish', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, filenames: [filename] }));
    });
    return;
  }

  // Static File Serving
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

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[OMENA Workbench] Server listening on http://0.0.0.0:${PORT}`);
  console.log(`[OMENA Workbench] Local URL: http://localhost:${PORT}`);
});
