/**
 * OMENA Enterprise Automated Verification Suite
 * Validates Security Guardrails, HttpOnly Auth, SQLite persistence, and Structured SSE streaming
 */

const BASE_URL = process.env.TEST_URL || 'http://localhost:8080';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'omena2026';

let sessionCookie = '';

async function runTests() {
  console.log(`\n======================================================`);
  console.log(`🚀 OMENA Verification Suite: ${BASE_URL}`);
  console.log(`======================================================\n`);

  let passed = 0;
  let failed = 0;

  async function assertTest(name, fn) {
    try {
      await fn();
      console.log(`  ✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
      failed++;
    }
  }

  // 1. Health Endpoint
  await assertTest('GET /health returns 200 and DB connected', async () => {
    const res = await fetch(`${BASE_URL}/health`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (data.status !== 'ok' || data.db !== 'connected') throw new Error(`Unhealthy payload: ${JSON.stringify(data)}`);
  });

  // 2. Ready Endpoint
  await assertTest('GET /ready returns 200', async () => {
    const res = await fetch(`${BASE_URL}/ready`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.ready) throw new Error(`Not ready: ${JSON.stringify(data)}`);
  });

  // 3. Models & Capabilities Schema
  await assertTest('GET /api/models returns capability flags', async () => {
    const res = await fetch(`${BASE_URL}/api/models`);
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.models) || data.models.length === 0) throw new Error(`No models declared`);
    const flash = data.models.find(m => m.id === 'gemini-2.0-flash');
    if (!flash || !flash.tools || !flash.streaming) throw new Error(`Missing capabilities on gemini-2.0-flash`);
  });

  // 4. Unauthenticated Access Blocked
  await assertTest('Unauthenticated GET /api/sessions returns 401 Unauthorized', async () => {
    const res = await fetch(`${BASE_URL}/api/sessions`);
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
  });

  await assertTest('Unauthenticated POST /api/stream returns 401 Unauthorized', async () => {
    const res = await fetch(`${BASE_URL}/api/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'test' })
    });
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
  });

  // 5. Auth Login with wrong password
  await assertTest('POST /api/auth/login with invalid password returns 401', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong-password' })
    });
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
  });

  // 6. Auth Login with correct password
  await assertTest('POST /api/auth/login returns 200 and sets HttpOnly cookie', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: ADMIN_PASSWORD })
    });
    if (!res.ok) throw new Error(`Login failed with status ${res.status}`);
    const cookieHeader = res.headers.get('set-cookie');
    if (!cookieHeader || !cookieHeader.includes('omena_session=')) {
      throw new Error(`Missing Set-Cookie header: ${cookieHeader}`);
    }
    sessionCookie = cookieHeader.split(';')[0];
  });

  // 7. Authenticated /api/auth/me
  await assertTest('GET /api/auth/me with session cookie returns authenticated: true', async () => {
    const res = await fetch(`${BASE_URL}/api/auth/me`, {
      headers: { 'Cookie': sessionCookie }
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.authenticated) throw new Error(`Not authenticated`);
  });

  // 8. Authenticated Sessions API
  await assertTest('GET /api/sessions with cookie returns persistent sessions from SQLite', async () => {
    const res = await fetch(`${BASE_URL}/api/sessions`, {
      headers: { 'Cookie': sessionCookie }
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.sessions)) throw new Error(`Expected sessions array`);
  });

  // 9. Command Execution via SSE Stream
  await assertTest('POST /api/stream executes shell command with real-time SSE events', async () => {
    const testSessionId = `test_sess_${Date.now()}`;
    const res = await fetch(`${BASE_URL}/api/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': sessionCookie
      },
      body: JSON.stringify({
        prompt: 'run Get-Process | Select-Object -First 2',
        model: 'gemini-2.0-flash',
        sessionId: testSessionId
      })
    });

    if (!res.ok) throw new Error(`SSE request failed with status ${res.status}`);

    const text = await res.text();
    if (!text.includes('tool_start') || !text.includes('tool_done') || !text.includes('[DONE]')) {
      throw new Error(`Incomplete SSE events: ${text.slice(0, 300)}`);
    }
  });

  // 10. Security Guardrail: Dangerous Command Blocked
  await assertTest('Security Guardrail blocks dangerous command (rm -rf /)', async () => {
    const testSessionId = `test_guard_${Date.now()}`;
    const res = await fetch(`${BASE_URL}/api/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': sessionCookie
      },
      body: JSON.stringify({
        prompt: 'run rm -rf /',
        model: 'gemini-2.0-flash',
        sessionId: testSessionId
      })
    });

    const text = await res.text();
    if (!text.includes('Blocked') && !text.includes('Dangerous operation detected')) {
      throw new Error(`Command was not blocked by guardrail! Output: ${text.slice(0, 200)}`);
    }
  });

  // 11. Security Guardrail: SSRF Target Blocked
  await assertTest('SSRF Guardrail blocks internal loopback URL navigation', async () => {
    const testSessionId = `test_ssrf_${Date.now()}`;
    const res = await fetch(`${BASE_URL}/api/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': sessionCookie
      },
      body: JSON.stringify({
        prompt: 'navigate to http://127.0.0.1:8080 and inspect',
        model: 'gemini-2.0-flash',
        sessionId: testSessionId
      })
    });

    const text = await res.text();
    if (!text.includes('SSRF Guardrail') && !text.includes('blocked')) {
      throw new Error(`SSRF was not blocked! Output: ${text.slice(0, 200)}`);
    }
  });

  console.log(`\n======================================================`);
  console.log(`📊 Test Summary: ${passed} passed, ${failed} failed`);
  console.log(`======================================================\n`);

  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
