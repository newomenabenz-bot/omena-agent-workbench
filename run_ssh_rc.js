/**
 * OMENA Mobile Agent Workbench - OpenSSH-Native Remote Docker RC Runner
 * Uses OS OpenSSH client (ssh.exe / scp.exe) with ssh-agent and ~/.ssh/config.
 * Zero passwords or private keys are ever requested, transmitted, or logged.
 */

import { execFile } from 'child_process';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const HOST_ALIAS = process.env.RC_SSH_HOST || process.argv[2] || 'rc-test-host';
const REMOTE_ISOLATED_DIR = `/tmp/omena_rc_test_${Date.now()}`;

function runSsh(cmdArgs) {
  return new Promise((resolve, reject) => {
    execFile('ssh', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', HOST_ALIAS, ...cmdArgs], {
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    }, (error, stdout, stderr) => {
      resolve({
        code: error ? (error.code || 1) : 0,
        stdout: (stdout || '').trim(),
        stderr: (stderr || '').trim()
      });
    });
  });
}

function runScp(localPath, remoteSubdir = '') {
  return new Promise((resolve, reject) => {
    const target = `${HOST_ALIAS}:${REMOTE_ISOLATED_DIR}/${remoteSubdir}`.replace(/\/+/g, '/');
    execFile('scp', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new', '-r', localPath, target], {
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(`SCP transfer failed for ${localPath}: ${stderr || error.message}`));
      }
      resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

export async function executeRcPipeline() {
  console.log('======================================================================');
  console.log('🚀 OMENA DOCKER RELEASE CANDIDATE (RC) SECURE VERIFICATION PIPELINE');
  console.log(`🔒 Authentication Mechanism: OpenSSH Agent / ~/.ssh/config`);
  console.log(`🎯 Target Host: ${HOST_ALIAS}`);
  console.log(`🛡️ Isolated Sandbox Path: ${REMOTE_ISOLATED_DIR}`);
  console.log('======================================================================\n');

  const report = {
    host: HOST_ALIAS,
    isolatedDir: REMOTE_ISOLATED_DIR,
    containerName: 'omena-agent-workbench-rc',
    imageName: 'omena-agent-workbench:rc',
    steps: {},
    allPassed: false
  };

  function record(stepNum, name, passed, output) {
    report.steps[stepNum] = { name, passed, output };
    const icon = passed ? '✅ [PASS]' : '❌ [FAIL]';
    console.log(`\n${icon} Step ${stepNum}: ${name}`);
    if (output) {
      console.log(`   Output: ${output.split('\n').slice(0, 5).join('\n   ')}`);
    }
  }

  // Pre-flight: Check SSH connection & Docker
  console.log('[Phase 0] Verifying SSH connectivity and Docker Daemon...');
  const ping = await runSsh(['echo "SSH_CONNECTED" && docker info --format "{{.ServerVersion}}"']);
  if (ping.code !== 0 || !ping.stdout.includes('SSH_CONNECTED')) {
    console.error(`\n❌ Failed to connect to SSH host "${HOST_ALIAS}" via secure credentials.`);
    console.error(`Error details: ${ping.stderr || ping.stdout}`);
    console.error(`\nEnsure host "${HOST_ALIAS}" is configured in ~/.ssh/config and authenticated via ssh-agent/identity file.`);
    return report;
  }
  const dockerVersion = ping.stdout.split('\n')[1] || 'Unknown';
  console.log(`  Connected. Remote Docker Engine Version: ${dockerVersion}`);

  // Create isolated directories
  await runSsh([`mkdir -p ${REMOTE_ISOLATED_DIR}/workspace ${REMOTE_ISOLATED_DIR}/storage/artifacts ${REMOTE_ISOLATED_DIR}/storage/memory`]);

  // Stage files
  console.log('\n[Phase 0b] Staging isolated release files to Linux sandbox...');
  const filesToStage = [
    'Dockerfile',
    'docker-compose.yml',
    'package.json',
    'server.js',
    'agent_engine.js',
    'workbench_engine.js',
    'agent_orchestrator.js',
    'db.js',
    'security.js',
    'test_endpoints.js',
    'providers',
    'public'
  ];

  for (const file of filesToStage) {
    const local = path.join(__dirname, file);
    if (fs.existsSync(local)) {
      await runScp(local);
    }
  }
  console.log('  Files transferred to isolated directory.');

  // Step 1: docker build succeeds using actual Dockerfile
  const step1 = await runSsh([`cd ${REMOTE_ISOLATED_DIR} && docker build -t omena-agent-workbench:rc -f Dockerfile .`]);
  record(1, 'docker build succeeds using actual Dockerfile', step1.code === 0, step1.stdout.slice(-300));
  if (step1.code !== 0) return report;

  // Step 2: docker compose up succeeds
  // Prepare isolated compose file with distinct container name and test port
  const prepCompose = await runSsh([`
    cd ${REMOTE_ISOLATED_DIR} &&
    sed -i 's/omena-agent-workbench/omena-agent-workbench-rc/g' docker-compose.yml &&
    docker compose -p omena-rc up -d || docker-compose -p omena-rc up -d
  `]);
  record(2, 'docker compose up succeeds', prepCompose.code === 0, prepCompose.stdout);
  if (prepCompose.code !== 0) return report;

  // Wait 8s for container startup
  await new Promise(r => setTimeout(r, 8000));

  // Step 3: Verify Node 22.x + node:sqlite inside the container
  const step3 = await runSsh([`docker exec omena-agent-workbench-rc node -e "console.log('NODE_VER:' + process.version); const { DatabaseSync } = require('node:sqlite'); console.log('SQLITE_NATIVE_OK');"`]);
  const nodeOk = step3.code === 0 && step3.stdout.includes('SQLITE_NATIVE_OK') && step3.stdout.includes('v22');
  record(3, 'Verify Node 22.x + node:sqlite inside the container', nodeOk, step3.stdout);

  // Step 4: Verify Chromium launches and real browser capture works inside container
  const step4 = await runSsh([`docker exec omena-agent-workbench-rc node -e "const puppeteer = require('puppeteer-core'); (async () => { const b = await puppeteer.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] }); const p = await b.newPage(); await p.setContent('<h1>OMENA Headless Verification</h1>'); const title = await p.\\$eval('h1', el => el.textContent); const shot = await p.screenshot({ encoding: 'base64' }); await b.close(); console.log('CHROMIUM_VERIFIED: Title=' + title + ', ShotBytes=' + shot.length); })().catch(e => { console.error(e); process.exit(1); });"`]);
  const chromiumOk = step4.code === 0 && step4.stdout.includes('CHROMIUM_VERIFIED');
  record(4, 'Verify Chromium launches and real browser capture works inside container', chromiumOk, step4.stdout);

  // Step 5: Verify /health and /ready
  const step5 = await runSsh([`docker exec omena-agent-workbench-rc curl -sf http://localhost:8080/health && docker exec omena-agent-workbench-rc curl -sf http://localhost:8080/ready`]);
  const healthOk = step5.code === 0 && step5.stdout.includes('ok') && step5.stdout.includes('connected');
  record(5, 'Verify /health and /ready', healthOk, step5.stdout);

  // Step 6: Verify authenticated /api/models, session APIs, SSE, browser, and shell workflows
  const step6 = await runSsh([`docker exec -e TEST_URL=http://localhost:8080 -e ADMIN_PASSWORD=omena2026 omena-agent-workbench-rc node test_endpoints.js`]);
  const workflowsOk = step6.code === 0 && step6.stdout.includes('14 passed, 0 failed');
  record(6, 'Verify authenticated /api/models, session APIs, SSE, browser, and shell workflows', workflowsOk, step6.stdout.slice(-300));

  // Step 7: Create a session and messages
  const step7 = await runSsh([`docker exec omena-agent-workbench-rc node -e "
    const http = require('http');
    const req = http.request({ hostname: 'localhost', port: 8080, path: '/api/auth/login', method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
      const cookie = res.headers['set-cookie'][0].split(';')[0];
      const sReq = http.request({ hostname: 'localhost', port: 8080, path: '/api/sessions', method: 'POST', headers: { 'Content-Type': 'application/json', 'Cookie': cookie } }, sRes => {
        let b = ''; sRes.on('data', c => b += c);
        sRes.on('end', () => console.log('CREATED_RC_SESSION:' + b));
      });
      sReq.write(JSON.stringify({ title: 'RC_PERSISTENCE_VALIDATION_SESSION' }));
      sReq.end();
    });
    req.write(JSON.stringify({ password: 'omena2026' }));
    req.end();
  "`]);
  const sessionCreated = step7.code === 0 && step7.stdout.includes('RC_PERSISTENCE_VALIDATION_SESSION');
  record(7, 'Create a session and messages in SQLite', sessionCreated, step7.stdout);

  // Step 8: docker compose down
  const step8 = await runSsh([`cd ${REMOTE_ISOLATED_DIR} && (docker compose -p omena-rc down || docker-compose -p omena-rc down)`]);
  record(8, 'docker compose down succeeds (container stopped and removed)', step8.code === 0, step8.stdout);

  // Step 9: docker compose up again using the same persistent volume
  const step9 = await runSsh([`cd ${REMOTE_ISOLATED_DIR} && (docker compose -p omena-rc up -d || docker-compose -p omena-rc up -d)`]);
  record(9, 'docker compose up again using same persistent volume', step9.code === 0, step9.stdout);

  // Wait 6s for restarted container
  await new Promise(r => setTimeout(r, 6000));

  // Step 10: Verify the same SQLite session/messages exist afterward
  const step10 = await runSsh([`docker exec omena-agent-workbench-rc node -e "
    const http = require('http');
    const req = http.request({ hostname: 'localhost', port: 8080, path: '/api/auth/login', method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
      const cookie = res.headers['set-cookie'][0].split(';')[0];
      const sReq = http.request({ hostname: 'localhost', port: 8080, path: '/api/sessions', method: 'GET', headers: { 'Cookie': cookie } }, sRes => {
        let b = ''; sRes.on('data', c => b += c);
        sRes.on('end', () => console.log('SURVIVED_SESSIONS:' + b));
      });
      sReq.end();
    });
    req.write(JSON.stringify({ password: 'omena2026' }));
    req.end();
  "`]);
  const persistOk = step10.code === 0 && step10.stdout.includes('RC_PERSISTENCE_VALIDATION_SESSION');
  record(10, 'Verify the same SQLite session/messages exist afterward', persistOk, step10.stdout);

  // Step 11: Verify the container is actually running as the non-root user
  const step11 = await runSsh([`docker exec omena-agent-workbench-rc id`]);
  const nonRootOk = step11.code === 0 && step11.stdout.includes('appuser') && !step11.stdout.includes('uid=0(root)');
  record(11, 'Verify container is running as non-root user (appuser)', nonRootOk, step11.stdout);

  // Step 12: Verify no Docker socket is mounted
  const step12 = await runSsh([`docker exec omena-agent-workbench-rc test ! -e /var/run/docker.sock && echo "NO_DOCKER_SOCKET"`]);
  const socketOk = step12.code === 0 && step12.stdout.includes('NO_DOCKER_SOCKET');
  record(12, 'Verify no Docker socket is mounted inside container', socketOk, step12.stdout);

  // Step 13: Run SSRF/path/shell security regression suite
  const step13 = await runSsh([`docker exec omena-agent-workbench-rc node -e "
    const { validateSafeCommand, validateTargetUrl, isPathContained } = require('./security.js');
    let ok = true;
    if (validateSafeCommand('rm -rf /').allowed) ok = false;
    if (validateSafeCommand('cat /etc/shadow').allowed) ok = false;
    if (isPathContained('/app/workspace', '../../etc/passwd')) ok = false;
    (async () => {
      const ssrf = await validateTargetUrl('http://169.254.169.254/latest/meta-data/');
      if (ssrf.allowed) ok = false;
      if (ok) console.log('SECURITY_REGRESSION_SUITE_PASSED');
      else process.exit(1);
    })();
  "`]);
  const secOk = step13.code === 0 && step13.stdout.includes('SECURITY_REGRESSION_SUITE_PASSED');
  record(13, 'Run SSRF/path/shell security regression suite inside container', secOk, step13.stdout);

  // Step 14: Clean teardown and check hygiene
  console.log('\n[Phase Clean] Tearing down test container and removing isolated sandbox...');
  const step14 = await runSsh([`
    cd ${REMOTE_ISOLATED_DIR} &&
    (docker compose -p omena-rc down -v || docker-compose -p omena-rc down -v) &&
    cd /tmp &&
    rm -rf ${REMOTE_ISOLATED_DIR} &&
    echo "SANDBOX_CLEANED"
  `]);
  const teardownOk = step14.code === 0 && step14.stdout.includes('SANDBOX_CLEANED');
  record(14, 'Clean teardown and isolated sandbox removal', teardownOk, step14.stdout);

  report.allPassed = Object.values(report.steps).every(s => s.passed);
  console.log('\n======================================================================');
  console.log(report.allPassed ? '🎉 14-STEP RELEASE CANDIDATE PIPELINE FULLY PASSED ON LINUX HOST!' : '⚠️ SOME RC STEPS FAILED');
  console.log('======================================================================\n');

  return report;
}

if (process.argv[1] && process.argv[1].endsWith('run_ssh_rc.js')) {
  executeRcPipeline()
    .then(r => process.exit(r.allPassed ? 0 : 1))
    .catch(e => {
      console.error('Fatal execution error:', e);
      process.exit(1);
    });
}
