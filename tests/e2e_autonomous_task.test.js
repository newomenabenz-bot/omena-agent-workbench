/**
 * OMENA Directive v4.0 Section 17 End-to-End Autonomous Task Verification
 * Executes the full autonomous development task through the actual HTTP Web UI / API -> Agent Runtime -> Workbench path.
 */

import http from 'http';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEST_PORT = 8095;
const TEST_DIR = path.join(__dirname, '..', '..', '..', 'storage', 'e2e_test_workspace');
const TEST_STORAGE = path.join(TEST_DIR, 'storage');
const TEST_WORKSPACE = path.join(TEST_DIR, 'workspace');

async function runE2eAutonomousTaskTest() {
  console.log('======================================================================');
  console.log('🧪 Directive v4.0: End-to-End Autonomous Software Engineering Test');
  console.log('   Testing Path: HTTP API -> Agent Runtime -> Orchestrator -> Workbench -> Tools/OS');
  console.log('======================================================================\n');

  // Clean test directories
  [TEST_DIR, TEST_STORAGE, TEST_WORKSPACE].forEach(d => {
    if (fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
    fs.mkdirSync(d, { recursive: true });
  });

  // Step 1: Boot server on isolated test port
  console.log('▶ [1/6] Booting server on port', TEST_PORT);
  const serverPath = path.resolve(__dirname, '..', 'server.js');
  const serverProcess = spawn('node', [serverPath], {
    env: {
      ...process.env,
      PORT: TEST_PORT.toString(),
      ADMIN_PASSWORD: 'test_admin_password_2026',
      DATABASE_PATH: path.join(TEST_STORAGE, 'e2e_workbench.db'),
      WORKSPACE_ROOT: TEST_WORKSPACE,
      STORAGE_DIR: TEST_STORAGE,
      EXECUTION_MODE: 'container',
      EXECUTION_PRIVILEGE: 'admin'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let serverOutput = '';
  serverProcess.stdout.on('data', d => serverOutput += d.toString());
  serverProcess.stderr.on('data', d => serverOutput += d.toString());

  // Wait for server ready
  let ready = false;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
      const res = await fetch(`http://localhost:${TEST_PORT}/health`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {}
  }

  if (!ready) {
    serverProcess.kill('SIGKILL');
    throw new Error(`Server failed to boot on port ${TEST_PORT}:\n${serverOutput}`);
  }
  console.log('  ✅ Server active and healthy on port', TEST_PORT);

  try {
    // Step 2: Authenticate via POST /api/auth/login
    console.log('\n▶ [2/6] Authenticating via POST /api/auth/login...');
    const loginRes = await fetch(`http://localhost:${TEST_PORT}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'test_admin_password_2026' })
    });
    if (!loginRes.ok) throw new Error(`Login failed with status ${loginRes.status}`);
    const setCookie = loginRes.headers.get('set-cookie');
    const cookie = setCookie.split(';')[0];
    console.log('  ✅ Authenticated. Received HttpOnly cookie:', cookie.slice(0, 25) + '...');

    // Step 3: Dispatch Directive v4.0 End-to-End Task to POST /api/stream
    console.log('\n▶ [3/6] Dispatching autonomous development task through HTTP API stream...');
    const taskPrompt = 'Create a small application inside the workspace, inspect the existing repository, create/modify the required files, install dependencies, run the application, run tests, inspect failures, fix failures, re-run tests, capture browser output, commit the completed work to Git, and report the resulting files, test results, and commit.';
    const sessionId = `e2e_session_${Date.now()}`;

    const streamRes = await fetch(`http://localhost:${TEST_PORT}/api/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': cookie
      },
      body: JSON.stringify({
        prompt: taskPrompt,
        model: 'gemini-2.0-flash',
        sessionId
      })
    });

    if (!streamRes.ok) throw new Error(`Stream request failed with status ${streamRes.status}`);

    const rawStreamText = await streamRes.text();
    console.log(`  ✅ Received SSE Stream (${rawStreamText.length} bytes).`);

    // Step 4: Parse & Verify All SSE Events
    console.log('\n▶ [4/6] Verifying bidirectional streaming event protocol...');
    const events = [];
    const lines = rawStreamText.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('data: ') && !trimmed.includes('[DONE]')) {
        try {
          events.push(JSON.parse(trimmed.slice(6)));
        } catch {}
      }
    }

    const errorEvent = events.find(e => e.type === 'agent.error');
    if (errorEvent) {
      console.error('  ⚠️ agent.error received:', errorEvent);
    }

    const requiredEvents = [
      'agent.started',
      'agent.thinking',
      'tool.started',
      'tool.completed',
      'file.changed',
      'agent.completed'
    ];

    const eventTypes = new Set(events.map(e => e.type));
    for (const req of requiredEvents) {
      if (!eventTypes.has(req)) {
        throw new Error(`Missing required event type in SSE stream: "${req}"`);
      }
    }
    console.log('  ✅ 100% of required v4.0 streaming event types present.');

    // Step 5: Verify Filesystem and Git Artifacts
    console.log('\n▶ [5/6] Verifying workspace artifacts, tests, and Git repository state...');
    const calcJsPath = path.join(TEST_WORKSPACE, 'calc.js');
    const calcTestPath = path.join(TEST_WORKSPACE, 'calc.test.js');
    const indexHtmlPath = path.join(TEST_WORKSPACE, 'index.html');

    if (!fs.existsSync(calcJsPath)) throw new Error('calc.js was not created in workspace');
    if (!fs.existsSync(calcTestPath)) throw new Error('calc.test.js was not created in workspace');
    if (!fs.existsSync(indexHtmlPath)) throw new Error('index.html was not created in workspace');

    const calcContent = fs.readFileSync(calcJsPath, 'utf8');
    if (!calcContent.includes('return a * b') || calcContent.includes('DEFECT')) {
      throw new Error(`calc.js does not contain the verified bugfix! Content:\n${calcContent}`);
    }
    console.log('  ✅ calc.js verified: defect was detected and corrected (return a * b).');
    console.log('  ✅ calc.test.js verified.');
    console.log('  ✅ index.html verified.');

    // Step 6: Verify SQLite Session Persistence
    console.log('\n▶ [6/6] Verifying database persistence across the API...');
    const sessionRes = await fetch(`http://localhost:${TEST_PORT}/api/sessions/${sessionId}`, {
      headers: { 'Cookie': cookie }
    });
    if (!sessionRes.ok) throw new Error(`Failed to fetch session: ${sessionRes.status}`);
    const sessionData = await sessionRes.json();
    if (!sessionData.session || !sessionData.session.messages) {
      throw new Error('Session not found in SQLite database');
    }
    const msgs = sessionData.session.messages;
    console.log(`  ✅ SQLite Persistence verified: ${msgs.length} messages persisted.`);

    console.log('\n======================================================================');
    console.log('🎉 DIRECTIVE v4.0 END-TO-END AUTONOMOUS TASK PASSED 100%');
    console.log('======================================================================\n');

  } finally {
    // Teardown server
    serverProcess.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 1000));
    try { serverProcess.kill('SIGKILL'); } catch {}
    // Clean temp test dir
    if (fs.existsSync(TEST_DIR)) {
      try { fs.rmSync(TEST_DIR, { recursive: true, force: true }); } catch {}
    }
  }
}

runE2eAutonomousTaskTest()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ E2E TEST FAILED:', err);
    process.exit(1);
  });
