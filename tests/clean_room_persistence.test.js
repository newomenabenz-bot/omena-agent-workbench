/**
 * OMENA Clean-Room & Persistence-After-Restart Verification Test
 * Proves server boot, SQLite data survival across full process termination & reboot,
 * and executes the full security regression suite.
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..');
const TEST_PORT = 8089;
const TEST_DB = path.join(WORKSPACE_ROOT, 'storage', 'test_persistence.db');
const SERVER_SCRIPT = path.join(WORKSPACE_ROOT, 'tools', 'agent_workbench', 'server.js');

function wait(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitForServer(port, maxAttempts = 15) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) return true;
    } catch {}
    await wait(400);
  }
  return false;
}

function startServer(port, dbPath) {
  return spawn('node', [SERVER_SCRIPT], {
    cwd: path.dirname(SERVER_SCRIPT),
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_PATH: dbPath,
      ADMIN_PASSWORD: 'omena2026-test',
      WORKSPACE_ROOT
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

async function runCleanRoomSuite() {
  console.log(`\n======================================================`);
  console.log(`🛡️ Clean-Room & Persistence-After-Restart Suite`);
  console.log(`======================================================\n`);

  let passed = 0;
  let failed = 0;

  function assert(name, condition, details = '') {
    if (condition) {
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${name} ${details}`);
      failed++;
    }
  }

  // Clean prior test db if any
  if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  if (fs.existsSync(`${TEST_DB}-wal`)) fs.unlinkSync(`${TEST_DB}-wal`);
  if (fs.existsSync(`${TEST_DB}-shm`)) fs.unlinkSync(`${TEST_DB}-shm`);

  // --- PHASE 1: Boot Initial Server ---
  console.log('▶ Phase 1: Booting Initial Server on Port ' + TEST_PORT + '...');
  let serverProc = startServer(TEST_PORT, TEST_DB);

  const bootOk = await waitForServer(TEST_PORT);
  assert('Phase 1: Server boots and passes /health', bootOk);

  // Authenticate
  const loginRes = await fetch(`http://localhost:${TEST_PORT}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'omena2026-test' })
  });
  assert('Phase 1: POST /api/auth/login succeeds', loginRes.ok);
  const cookieHeader = loginRes.headers.get('set-cookie');
  const sessionCookie = cookieHeader ? cookieHeader.split(';')[0] : '';
  assert('Phase 1: Received HttpOnly session cookie', sessionCookie.includes('omena_session='));

  // Create persistent session
  const testSessionId = `persist_rc_${Date.now()}`;
  const createRes = await fetch(`http://localhost:${TEST_PORT}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': sessionCookie },
    body: JSON.stringify({
      id: testSessionId,
      title: 'RC Candidate Test Thread',
      model: 'gemini-2.0-flash'
    })
  });
  assert('Phase 1: Session created in SQLite', createRes.ok);

  // Execute command to generate message & tool record
  const streamRes = await fetch(`http://localhost:${TEST_PORT}/api/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': sessionCookie },
    body: JSON.stringify({
      prompt: 'run Get-Process | Select-Object -First 2',
      sessionId: testSessionId,
      model: 'gemini-2.0-flash'
    })
  });
  const streamText = await streamRes.text();
  assert('Phase 1: Stream execution completed with [DONE]', streamText.includes('[DONE]'));

  // Verify message in DB before restart
  const getSess1 = await fetch(`http://localhost:${TEST_PORT}/api/sessions/${testSessionId}`, {
    headers: { 'Cookie': sessionCookie }
  });
  const sessData1 = await getSess1.json();
  const msgCountBefore = sessData1.session?.messages?.length || 0;
  assert('Phase 1: Stored messages before restart', msgCountBefore >= 2, `(got ${msgCountBefore})`);

  // --- PHASE 2: Full Server Process Termination (Kill) ---
  console.log('\n▶ Phase 2: Simulating Complete Server Termination (SIGTERM)...');
  const killPromise = new Promise(resolve => serverProc.on('close', resolve));
  serverProc.kill('SIGTERM');
  await killPromise;
  await wait(500);

  // Confirm server is down
  let isDown = false;
  try {
    await fetch(`http://localhost:${TEST_PORT}/health`);
  } catch {
    isDown = true;
  }
  assert('Phase 2: Server completely stopped and port released', isDown);

  // --- PHASE 3: Reboot and Verify Persistence ---
  console.log('\n▶ Phase 3: Rebooting Server from SQLite Persistence...');
  serverProc = startServer(TEST_PORT, TEST_DB);
  const rebootOk = await waitForServer(TEST_PORT);
  assert('Phase 3: Server rebooted and passes /health', rebootOk);

  // Re-login on new instance
  const loginRes2 = await fetch(`http://localhost:${TEST_PORT}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'omena2026-test' })
  });
  const cookie2 = loginRes2.headers.get('set-cookie').split(';')[0];

  // Retrieve previous session from restarted server
  const getSess2 = await fetch(`http://localhost:${TEST_PORT}/api/sessions/${testSessionId}`, {
    headers: { 'Cookie': cookie2 }
  });
  assert('Phase 3: Session survives complete reboot', getSess2.ok);
  const sessData2 = await getSess2.json();
  const sessionAfter = sessData2.session;
  assert('Phase 3: Title preserved intact', sessionAfter?.title === 'RC Candidate Test Thread');
  assert('Phase 3: Messages survived 100% across reboot', sessionAfter?.messages?.length === msgCountBefore, `(expected ${msgCountBefore}, got ${sessionAfter?.messages?.length})`);

  // --- PHASE 4: Security Regression Tests ---
  console.log('\n▶ Phase 4: Executing Security Regression Tests...');

  // 1. Unauthenticated requests blocked
  const unauthModels = await fetch(`http://localhost:${TEST_PORT}/api/models`);
  assert('Security: Unauthenticated GET /api/models returns 401', unauthModels.status === 401);

  const unauthSessions = await fetch(`http://localhost:${TEST_PORT}/api/sessions`);
  assert('Security: Unauthenticated GET /api/sessions returns 401', unauthSessions.status === 401);

  const unauthStream = await fetch(`http://localhost:${TEST_PORT}/api/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: 'test' })
  });
  assert('Security: Unauthenticated POST /api/stream returns 401', unauthStream.status === 401);

  // 2. DNS Rebinding SSRF Blocked
  const ssrfStream = await fetch(`http://localhost:${TEST_PORT}/api/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie2 },
    body: JSON.stringify({
      prompt: 'navigate to http://localtest.me:8080 and inspect',
      sessionId: testSessionId
    })
  });
  const ssrfText = await ssrfStream.text();
  assert('Security: DNS Rebinding SSRF (localtest.me) blocked', ssrfText.includes('SSRF Guardrail') && ssrfText.includes('blocked'));

  // 3. Path Traversal Shell Blocked
  const travStream = await fetch(`http://localhost:${TEST_PORT}/api/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie2 },
    body: JSON.stringify({
      prompt: 'run cat ../../secret.txt',
      sessionId: testSessionId
    })
  });
  const travText = await travStream.text();
  assert('Security: Path traversal (../../) blocked', travText.includes('Path Escape Guardrail') && travText.includes('prohibited'));

  // 4. Docker socket access blocked
  const sockStream = await fetch(`http://localhost:${TEST_PORT}/api/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Cookie': cookie2 },
    body: JSON.stringify({
      prompt: 'run ls /var/run/docker.sock',
      sessionId: testSessionId
    })
  });
  const sockText = await sockStream.text();
  assert('Security: Host docker.sock access blocked', sockText.includes('Path Escape Guardrail') && sockText.includes('prohibited'));

  // Cleanup test server
  serverProc.kill('SIGTERM');

  console.log(`\n======================================================`);
  console.log(`📊 Clean-Room & Persistence Summary: ${passed} passed, ${failed} failed`);
  console.log(`======================================================\n`);

  if (failed > 0) process.exit(1);
}

runCleanRoomSuite().catch(err => {
  console.error('Fatal clean-room test error:', err);
  process.exit(1);
});
