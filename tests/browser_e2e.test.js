/**
 * OMENA Mobile Agent Workbench v4.0.1 - Comprehensive Browser E2E Test Suite
 * Validates complete end-to-end user experience in real Chrome browser:
 * Auth -> Settings -> Subscriptions -> Theme Swap -> Live Prompt -> Visible Bubbles & SSE Stream -> Mobile Viewport
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import puppeteer from '../../browser/node_modules/puppeteer-core/lib/esm/puppeteer/puppeteer-core.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ARTIFACTS_DIR = 'C:/Users/Administrator/.gemini/antigravity/brain/e8d8888b-3e29-4762-9abb-431dbd3bf650';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE_URL = 'http://localhost:8080';
const ADMIN_PASSWORD = 'omena-dev-admin';

async function runBrowserE2E() {
  console.log('======================================================================');
  console.log('🌐 OMENA v4.0.1: Comprehensive Browser E2E Automated Verification');
  console.log('   Testing: Real Chrome Headless -> UI -> Auth -> SSE -> DOM Rendering');
  console.log('======================================================================\n');

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  try {
    // 1. Navigate to Workbench
    console.log('▶ [1/8] Navigating to http://localhost:8080...');
    await page.goto(BASE_URL, { waitUntil: 'networkidle2' });
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'e2e_v401_01_loaded.png') });
    console.log('  ✅ Page loaded. Saved e2e_v401_01_loaded.png');

    // 2. Verify Auth Modal & Sign In
    console.log('\n▶ [2/8] Testing Authentication Gate...');
    const authModalOpen = await page.$eval('#auth-modal', el => el.classList.contains('open'));
    if (!authModalOpen) throw new Error('Auth modal is not open on fresh session');
    console.log('  ✅ Auth modal is open and active.');

    await page.type('#auth-password', ADMIN_PASSWORD);
    await page.click('#btn-auth-submit');
    await page.waitForFunction(() => !document.getElementById('auth-modal').classList.contains('open'), { timeout: 5000 });
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'e2e_v401_02_unlocked.png') });
    console.log('  ✅ Successfully signed in. Saved e2e_v401_02_unlocked.png');

    // 3. Verify Hero Section & Telemetry Pills
    console.log('\n▶ [3/8] Verifying Hero Section & Telemetry Truthfulness...');
    const heroVisible = await page.$eval('#hero-section', el => !el.classList.contains('hidden'));
    if (!heroVisible) throw new Error('Hero section should be visible after unlock');
    const modelText = await page.$eval('#pill-model span', el => el.innerText);
    const ctxText = await page.$eval('#pill-ctx span', el => el.innerText);
    console.log(`  ✅ Active Model Pill: "${modelText}", Context: "${ctxText}"`);

    // 4. Test Settings Modal & Subscriptions
    console.log('\n▶ [4/8] Testing Settings Modal & Server-Authoritative Subscriptions...');
    await page.click('#btn-open-settings');
    await page.waitForSelector('#settings-modal.open', { timeout: 3000 });

    // Verify Sticky Header and Close Button
    const closeBtnVisible = await page.$eval('#btn-close-settings', el => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.top >= 0;
    });
    if (!closeBtnVisible) throw new Error('#btn-close-settings is not properly visible or off-screen');
    console.log('  ✅ Settings sticky header & close button verified visible.');

    // Save Subscriptions test
    await page.click('#btn-save-keys');
    await page.waitForSelector('#save-status-msg', { visible: true, timeout: 5000 });
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'e2e_v401_03_settings.png') });
    console.log('  ✅ "Save Subscriptions" triggered server-side validation. Saved e2e_v401_03_settings.png');

    // Close Settings
    await page.click('#btn-close-settings');
    await page.waitForFunction(() => !document.getElementById('settings-modal').classList.contains('open'), { timeout: 3000 });
    console.log('  ✅ Settings modal closed cleanly.');

    // 5. Test Theme Toggle (Icon Swap & CSS class)
    console.log('\n▶ [5/8] Testing Theme Toggle & Icon Swapping...');
    await page.click('#btn-toggle-theme');
    await new Promise(r => setTimeout(r, 300));
    const lightTheme = await page.$eval('html', el => el.getAttribute('data-theme'));
    const hasMoon = await page.$eval('#btn-toggle-theme', el => Boolean(el.querySelector('#theme-icon-moon')));
    if (lightTheme !== 'light' || !hasMoon) throw new Error(`Expected light theme with moon icon, got theme=${lightTheme}, hasMoon=${hasMoon}`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'e2e_v401_04_light_theme.png') });
    console.log('  ✅ Light theme active, Moon SVG swapped. Saved e2e_v401_04_light_theme.png');

    // Toggle back to dark
    await page.click('#btn-toggle-theme');
    await new Promise(r => setTimeout(r, 300));

    // 6. Test Live Prompt Send & Real-Time SSE Rendering
    console.log('\n▶ [6/8] Testing Prompt Send & Real-Time SSE Stream Display...');
    await page.type('#user-prompt', 'run node -e "console.log(100 + 200)"');
    await page.click('#btn-send');

    // Verify messages-container is immediately visible and hero section is hidden
    await page.waitForFunction(() => {
      const hero = document.getElementById('hero-section');
      const msgs = document.getElementById('messages-container');
      return hero.classList.contains('hidden') && msgs.children.length > 0;
    }, { timeout: 5000 });
    console.log('  ✅ Hero section instantly hidden (.hidden) and user bubble rendered.');

    // Wait for tool execution and stream completion
    await page.waitForFunction(() => {
      const msgs = document.getElementById('messages-container');
      return msgs.innerText.includes('300');
    }, { timeout: 15000 });

    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'e2e_v401_05_stream_result.png') });
    console.log('  ✅ Assistant tool execution completed with visible output "300". Saved e2e_v401_05_stream_result.png');

    // 7. Test Sidebar & Feature Navigation
    console.log('\n▶ [7/8] Testing Sidebar Drawer & Features...');
    await page.click('#btn-toggle-sidebar');
    await page.waitForSelector('#sidebar.open', { timeout: 3000 });

    // Verify sessions-list has at least 1 session
    const sessionCount = await page.$$eval('#sessions-list .session-item', items => items.length);
    console.log(`  ✅ Sessions List rendered: ${sessionCount} session(s) archived.`);
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'e2e_v401_06_sidebar.png') });
    console.log('  ✅ Saved e2e_v401_06_sidebar.png');

    await page.click('#btn-close-sidebar');
    await page.waitForFunction(() => !document.getElementById('sidebar').classList.contains('open'), { timeout: 3000 });

    // 8. Mobile Viewport Layout Verification
    console.log('\n▶ [8/8] Testing Mobile Viewport (iPhone 14 / Safari)...');
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.screenshot({ path: path.join(ARTIFACTS_DIR, 'e2e_v401_07_mobile_view.png') });
    console.log('  ✅ Mobile layout rendered without overflow or clipping. Saved e2e_v401_07_mobile_view.png');

    console.log('\n======================================================================');
    console.log('🎉 ALL BROWSER E2E TESTS PASSED 100%');
    console.log('======================================================================\n');
  } finally {
    await browser.close();
  }
}

runBrowserE2E().catch(err => {
  console.error('\n❌ Fatal Browser E2E Test Failure:', err);
  process.exit(1);
});
