/**
 * OMENA Enterprise Automated Verification Suite
 * Validates Security Guardrails, HttpOnly Auth, SQLite persistence, and Structured SSE streaming
 */

const BASE_URL = process.env.TEST_URL || 'http://localhost:8080';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'omena-dev-admin';

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

  // 3. Unauthenticated Access Blocked (including /api/models)
  await assertTest('Unauthenticated GET /api/models returns 401 Unauthorized', async () => {
    const res = await fetch(`${BASE_URL}/api/models`);
    if (res.status !== 401) throw new Error(`Expected 401, got ${res.status}`);
  });

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

  // 8. Authenticated Capabilities Schema
  await assertTest('GET /api/models with session cookie returns capability flags', async () => {
    const res = await fetch(`${BASE_URL}/api/models`, {
      headers: { 'Cookie': sessionCookie }
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.models) || data.models.length === 0) throw new Error(`No models declared`);
    const flash = data.models.find(m => m.id === 'gemini-2.0-flash');
    if (!flash || flash.reasoning !== false) throw new Error(`Expected gemini-2.0-flash to have reasoning: false`);
    const o3 = data.models.find(m => m.id === 'o3-mini');
    if (!o3 || o3.reasoning !== true) throw new Error(`Expected o3-mini to have reasoning: true`);
  });

  // 9. Authenticated Sessions API
  await assertTest('GET /api/sessions with cookie returns persistent sessions from SQLite', async () => {
    const res = await fetch(`${BASE_URL}/api/sessions`, {
      headers: { 'Cookie': sessionCookie }
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.sessions)) throw new Error(`Expected sessions array`);
  });

  // 10. Command Execution via SSE Stream
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

  // 11. Security Guardrail: Dangerous Command Blocked
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

  // 12. Security Guardrail: Path Traversal Blocked
  await assertTest('Security Guardrail blocks directory escape (../../)', async () => {
    const testSessionId = `test_path_${Date.now()}`;
    const res = await fetch(`${BASE_URL}/api/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': sessionCookie
      },
      body: JSON.stringify({
        prompt: 'run cat ../../secret.txt',
        model: 'gemini-2.0-flash',
        sessionId: testSessionId
      })
    });

    const text = await res.text();
    if (!text.includes('Path Escape Guardrail') && !text.includes('prohibited')) {
      throw new Error(`Path escape was not blocked! Output: ${text.slice(0, 200)}`);
    }
  });

  // 13. Security Guardrail: SSRF Target & DNS Rebinding Blocked
  await assertTest('SSRF Guardrail blocks DNS rebinding domain (localtest.me)', async () => {
    const testSessionId = `test_ssrf_${Date.now()}`;
    const res = await fetch(`${BASE_URL}/api/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': sessionCookie
      },
      body: JSON.stringify({
        prompt: 'navigate to http://localtest.me:8080 and inspect',
        model: 'gemini-2.0-flash',
        sessionId: testSessionId
      })
    });

    const text = await res.text();
    if (!text.includes('SSRF Guardrail') && !text.includes('blocked')) {
      throw new Error(`SSRF was not blocked! Output: ${text.slice(0, 200)}`);
    }
  });

  // 14. Providers Status API
  await assertTest('GET /api/providers/status returns masked status', async () => {
    const res = await fetch(`${BASE_URL}/api/providers/status`, {
      headers: { 'Cookie': sessionCookie }
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.providers || typeof data.providers !== 'object') throw new Error(`Expected providers object`);
    if (!('gemini' in data.providers) || !('openai' in data.providers)) throw new Error(`Missing provider fields`);
  });

  // 15. Providers Config API (Persistence in SQLite without network test)
  await assertTest('POST /api/providers/config saves credentials to SQLite database', async () => {
    const res = await fetch(`${BASE_URL}/api/providers/config`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': sessionCookie
      },
      body: JSON.stringify({
        credentials: {
          local: 'http://localhost:11434'
        },
        testConnection: false
      })
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error(`Expected success: true, got ${JSON.stringify(data)}`);
    if (!data.status || !data.status.local.configured) throw new Error(`Local provider not reported as configured`);
  });

  // 16. System Status Telemetry
  await assertTest('GET /api/system/status returns truthfulness telemetry (CDP, model, ctx)', async () => {
    const res = await fetch(`${BASE_URL}/api/system/status?model=gemini-2.0-flash`, {
      headers: { 'Cookie': sessionCookie }
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (data.status !== 'online') throw new Error(`Expected status: online`);
    if (!data.cdp || typeof data.cdp.active !== 'boolean') throw new Error(`Expected cdp.active boolean`);
    if (!data.activeModel || data.activeModel.id !== 'gemini-2.0-flash') throw new Error(`Expected activeModel gemini-2.0-flash`);
    if (typeof data.activeModel.contextWindow !== 'number') throw new Error(`Expected numeric contextWindow`);
  });

  // 17. Terminal Command Runner
  await assertTest('POST /api/terminal/exec executes shell command and returns output', async () => {
    const res = await fetch(`${BASE_URL}/api/terminal/exec`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': sessionCookie
      },
      body: JSON.stringify({
        command: process.platform === 'win32' ? 'echo OMENA_TERMINAL_TEST' : 'echo OMENA_TERMINAL_TEST'
      })
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.stdout || !data.stdout.includes('OMENA_TERMINAL_TEST')) {
      throw new Error(`Output missing test token: ${JSON.stringify(data)}`);
    }
  });

  // 18. Workspace Tree API
  await assertTest('GET /api/workspace/tree returns files list', async () => {
    const res = await fetch(`${BASE_URL}/api/workspace/tree`, {
      headers: { 'Cookie': sessionCookie }
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.tree || !Array.isArray(data.tree)) throw new Error(`Expected tree array`);
  });

  // 19. Memory Store Viewer
  await assertTest('GET /api/memory/view returns memory files', async () => {
    const res = await fetch(`${BASE_URL}/api/memory/view`, {
      headers: { 'Cookie': sessionCookie }
    });
    if (!res.ok) throw new Error(`Status ${res.status}`);
    const data = await res.json();
    if (!data.memory || typeof data.memory !== 'object') throw new Error(`Expected memory object`);
  });

  // 20. Clean Browser Frame Standby SVG Placeholder (No 404 console errors)
  await assertTest('GET /api/browser/frame returns 200 with SVG placeholder when no screenshot exists', async () => {
    const res = await fetch(`${BASE_URL}/api/browser/frame`, {
      headers: { 'Cookie': sessionCookie }
    });
    if (res.status !== 200) throw new Error(`Expected status 200, got ${res.status}`);
    const contentType = res.headers.get('content-type');
    if (!contentType || (!contentType.includes('image/svg+xml') && !contentType.includes('image/png'))) {
      throw new Error(`Expected image content-type, got ${contentType}`);
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
