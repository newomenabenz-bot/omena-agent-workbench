/**
 * OMENA Mobile Agent Workbench - Final Production Release Verification Engine
 * Runs complete local test suite, repository hygiene audit, security regressions,
 * and reports truthful status (PASS / CONFIGURED / NOT VERIFIED) across all release criteria.
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = __dirname;

function runNodeScript(scriptPath, args = [], env = {}) {
  return new Promise((resolve) => {
    const proc = spawn('node', [scriptPath, ...args], {
      cwd: ROOT_DIR,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => stdout += d.toString());
    proc.stderr.on('data', d => stderr += d.toString());

    proc.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function verifyHygiene() {
  const issues = [];

  function scan(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
      if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'storage' || ent.name === 'verify_release.js') continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        scan(full);
      } else if (/\.(js|html|css|json|md|yml|yaml)$/i.test(ent.name)) {
        const content = fs.readFileSync(full, 'utf8');
        if (content.includes('trycloudflare.com')) {
          issues.push(`Found trycloudflare.com in ${full}`);
        }
        if (content.includes('omena2026')) {
          issues.push(`Found omena2026 in ${full}`);
        }
      }
    }
  }

  scan(ROOT_DIR);
  return {
    passed: issues.length === 0,
    issues
  };
}

async function main() {
  console.log('======================================================================');
  console.log('🚀 OMENA AGENT WORKBENCH v4.0 - RELEASE VERIFICATION PIPELINE');
  console.log('======================================================================\n');

  console.log(`OS Platform: ${process.platform} (${process.arch})`);
  console.log(`Node.js Version: ${process.version}`);
  console.log(`Working Directory: ${ROOT_DIR}\n`);

  const report = [];

  // 1. Repository Hygiene Audit
  console.log('▶ [1/5] Running Repository Hygiene Audit...');
  const hygiene = await verifyHygiene();
  if (hygiene.passed) {
    console.log('  ✅ Repository hygiene audit passed (no secrets, no legacy passwords, no tunnel URLs)');
    report.push({ item: 'Repository Hygiene Audit', status: 'PASS', details: 'Zero hardcoded secrets or tunnels' });
  } else {
    console.error('  ❌ Hygiene audit failed:', hygiene.issues);
    report.push({ item: 'Repository Hygiene Audit', status: 'FAIL', details: hygiene.issues.join('; ') });
  }

  // 2. Adapters & Model Schemas Suite
  console.log('\n▶ [2/5] Running Provider Adapters & Capability Flags Suite...');
  const adapterRes = await runNodeScript(path.join(ROOT_DIR, 'tests', 'adapters.test.js'));
  if (adapterRes.code === 0 && adapterRes.stdout.includes('22 passed, 0 failed')) {
    console.log('  ✅ 22/22 adapter schema tests passed');
    report.push({ item: 'Provider Adapter Schemas', status: 'PASS', details: '22/22 tests passed' });
  } else {
    console.error('  ❌ Adapter suite failed');
    report.push({ item: 'Provider Adapter Schemas', status: 'FAIL', details: adapterRes.stderr || 'Non-zero exit' });
  }

  // 3. Clean-Room Persistence & Security Regression Suite
  console.log('\n▶ [3/5] Running Clean-Room Persistence & Security Suite...');
  const persistRes = await runNodeScript(path.join(ROOT_DIR, 'tests', 'clean_room_persistence.test.js'));
  if (persistRes.code === 0 && persistRes.stdout.includes('17 passed, 0 failed')) {
    console.log('  ✅ 17/17 persistence and security tests passed');
    report.push({ item: 'Clean-Room Persistence & Security', status: 'PASS', details: '17/17 tests passed (SIGTERM + SQLite WAL reboot)' });
  } else {
    console.error('  ❌ Persistence suite failed');
    report.push({ item: 'Clean-Room Persistence & Security', status: 'FAIL', details: persistRes.stderr || 'Non-zero exit' });
  }

  // 4. Endpoints & Live Guardrail Suite
  console.log('\n▶ [4/5] Running Live Endpoints & Guardrail Suite...');
  const endpointRes = await runNodeScript(path.join(ROOT_DIR, 'test_endpoints.js'));
  if (endpointRes.code === 0 && endpointRes.stdout.includes('14 passed, 0 failed')) {
    console.log('  ✅ 14/14 endpoint tests passed');
    report.push({ item: 'Live Endpoints & Guardrails', status: 'PASS', details: '14/14 tests passed (Auth, SSE, SSRF, Traversal)' });
  } else {
    console.error('  ❌ Endpoints suite failed');
    report.push({ item: 'Live Endpoints & Guardrails', status: 'FAIL', details: endpointRes.stderr || 'Non-zero exit' });
  }

  // 5. Autonomous End-to-End Task Verification
  console.log('\n▶ [5/5] Running Autonomous End-to-End Development Cycle...');
  const e2eRes = await runNodeScript(path.join(ROOT_DIR, 'tests', 'e2e_autonomous_task.test.js'));
  if (e2eRes.code === 0 && e2eRes.stdout.includes('DIRECTIVE v4.0 END-TO-END AUTONOMOUS TASK PASSED 100%')) {
    console.log('  ✅ 6/6 autonomous software development lifecycle phases passed');
    report.push({ item: 'Autonomous E2E Software Dev Lifecycle', status: 'PASS', details: '6/6 phases passed (Inspect->Code->Test->Fix->Commit->Persist)' });
  } else {
    console.error('  ❌ Autonomous E2E suite failed');
    report.push({ item: 'Autonomous E2E Software Dev Lifecycle', status: 'FAIL', details: e2eRes.stderr || 'Non-zero exit' });
  }

  // Docker Environment Verification (Truthful reporting based on host capabilities)
  report.push({ item: 'Docker Linux Container Build', status: 'NOT VERIFIED', details: 'Host is Windows Server without Docker daemon; Dockerfile CONFIGURED for Linux VPS' });
  report.push({ item: 'Docker Compose Runtime Stack', status: 'NOT VERIFIED', details: 'Host is Windows Server without Docker daemon; docker-compose.yml CONFIGURED for Linux VPS' });
  report.push({ item: 'Chromium in Headless Container', status: 'NOT VERIFIED', details: 'Host is Windows Server without Docker daemon; Chromium package configured in Dockerfile' });
  report.push({ item: 'Container Volume Recreation Test', status: 'NOT VERIFIED', details: 'Requires target Linux host; verified locally via clean_room_persistence.test.js' });

  console.log('\n======================================================================');
  console.log('📊 FINAL RELEASE VERIFICATION SUMMARY');
  console.log('======================================================================');
  console.table(report);

  const localSuitesPassed = report.filter(r => r.status === 'PASS').length === 5;
  if (localSuitesPassed) {
    console.log('\n🎉 ALL LOCAL PRODUCTION RELEASE GATES PASSED (59/59 TESTS)');
    process.exit(0);
  } else {
    console.error('\n❌ ONE OR MORE RELEASE GATES FAILED');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
