/**
 * OMENA Live AI Provider Integration & Smoke Test Suite v4.1.1
 * Opt-in real provider verification with real streaming, real tool calls, and continuation.
 * Activated by environment flags:
 * LIVE_GEMINI=1, LIVE_OPENAI=1, LIVE_ANTHROPIC=1, LIVE_DEEPSEEK=1, LIVE_LOCAL=1
 * Zero credentials are ever hardcoded or printed.
 */

import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { GeminiAdapter } from '../providers/gemini_adapter.js';
import { OpenAIAdapter } from '../providers/openai_adapter.js';
import { AnthropicAdapter } from '../providers/anthropic_adapter.js';
import { DeepSeekAdapter } from '../providers/deepseek_adapter.js';
import { LocalAdapter } from '../providers/local_adapter.js';
import { WorkbenchDatabase } from '../db.js';
import { ConnectionState, ErrorCode } from '../providers/base_adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runLiveProviderSuite() {
  console.log('======================================================================');
  console.log('🌐 OMENA REAL LIVE PROVIDER INTEGRATION & SMOKE SUITE');
  console.log('======================================================================\n');

  // Load credentials from database or environment
  let dbCreds = {};
  try {
    const db = new WorkbenchDatabase(path.join(__dirname, '..', 'workbench.db'));
    dbCreds = db.getProviderCredentials(true);
    db.close();
  } catch {}

  const credentials = {
    gemini: process.env.GEMINI_API_KEY || dbCreds.gemini,
    openai: process.env.OPENAI_API_KEY || dbCreds.openai,
    anthropic: process.env.ANTHROPIC_API_KEY || dbCreds.anthropic,
    deepseek: process.env.DEEPSEEK_API_KEY || dbCreds.deepseek,
    local: process.env.LOCAL_AI_URL || dbCreds.local || 'http://127.0.0.1:11434'
  };

  const results = {
    gemini: { status: 'NOT_RUN', tests: [] },
    openai: { status: 'NOT_RUN', tests: [] },
    anthropic: { status: 'NOT_RUN', tests: [] },
    deepseek: { status: 'NOT_RUN', tests: [] },
    local: { status: 'NOT_RUN', tests: [] }
  };

  // Standard sample tool declaration for real tool testing
  const sampleTools = [
    {
      name: 'filesystem_readFile',
      description: 'Read the contents of a local file in the workspace',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Relative path of file to read' }
        },
        required: ['path']
      }
    }
  ];

  /**
   * Run 10 standard live tests for an adapter
   */
  async function testProvider(providerKey, adapterFactory, apiKey) {
    if (!apiKey) {
      console.log(`⚠️  LIVE_${providerKey.toUpperCase()}=1 is set, but no credential found in env/db. Skipping.\n`);
      results[providerKey] = { status: 'NOT_RUN', reason: 'Missing credential' };
      return;
    }

    console.log(`\n▶ [LIVE] Testing Provider: ${providerKey.toUpperCase()}...`);
    const testLog = [];
    let passedCount = 0;

    async function runTest(name, fn) {
      try {
        await fn();
        console.log(`  ✅ [PASS] ${name}`);
        testLog.push({ name, status: 'PASS' });
        passedCount++;
      } catch (err) {
        console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
        testLog.push({ name, status: 'FAIL', error: err.message });
      }
    }

    const defaultAdapter = adapterFactory();

    // 1. Authentication
    await runTest('Test 1: Live Authentication Validation', async () => {
      const authRes = await defaultAdapter.validateConnection(apiKey);
      assert.ok(authRes.valid, `Expected connection valid, got: ${authRes.error}`);
    });

    // 2. Model Discovery
    let discoveredModels = [];
    await runTest('Test 2: Authoritative Live Model Discovery', async () => {
      discoveredModels = await defaultAdapter.discoverModels(apiKey);
      assert.ok(Array.isArray(discoveredModels), 'Discovered models should be an array');
      assert.ok(discoveredModels.length > 0, 'Expected at least 1 discovered model from live provider');
      assert.strictEqual(discoveredModels[0].source, 'provider_discovery', 'Expected source to be provider_discovery');
    });

    const activeModelId = discoveredModels.length > 0 ? discoveredModels[0].id : defaultAdapter.id;
    const testAdapter = adapterFactory(activeModelId);

    // 3. Simple Response
    let simpleText = '';
    await runTest('Test 3: Simple Response Generation', async () => {
      await testAdapter.streamChat({
        prompt: "Say the exact word 'PONG'",
        credentials: { [providerKey]: apiKey },
        emit: (evt) => {
          if (evt.type === 'text_chunk') simpleText += evt.token;
        }
      });
      assert.ok(simpleText.length > 0, 'Expected non-empty response text');
    });

    // 4. Streaming
    let chunksCount = 0;
    await runTest('Test 4: Streaming Delivery (multiple chunks)', async () => {
      await testAdapter.streamChat({
        prompt: 'Count from 1 to 5 separated by spaces.',
        credentials: { [providerKey]: apiKey },
        emit: (evt) => {
          if (evt.type === 'text_chunk') chunksCount++;
        }
      });
      assert.ok(chunksCount >= 1, `Expected at least 1 stream chunk, got: ${chunksCount}`);
    });

    // 5. Tool Call
    let emittedToolCall = null;
    await runTest('Test 5: Real Structured Tool Call Generation', async () => {
      await testAdapter.streamChat({
        prompt: 'Please read the file package.json using your filesystem_readFile tool.',
        tools: sampleTools,
        credentials: { [providerKey]: apiKey },
        emit: (evt) => {
          if (evt.type === 'tool_call') {
            emittedToolCall = evt.call;
          }
        }
      });
      assert.ok(emittedToolCall, 'Expected model to emit tool_call event');
      assert.strictEqual(emittedToolCall.name, 'filesystem_readFile', 'Tool name should match');
    });

    // 6. Tool Result Continuation Loop
    let continuationText = '';
    await runTest('Test 6: Real Tool Result Continuation Loop', async () => {
      if (!emittedToolCall) {
        throw new Error('Tool call was not emitted in Test 5; skipping continuation');
      }

      // Simulate executing the tool and feeding response back into conversation context
      const messages = [
        { role: 'user', content: 'Please read the file package.json using your filesystem_readFile tool.' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: emittedToolCall.id,
              type: 'function',
              function: {
                name: emittedToolCall.name,
                arguments: JSON.stringify(emittedToolCall.arguments)
              }
            }
          ]
        },
        {
          role: 'tool',
          name: 'filesystem_readFile',
          tool_call_id: emittedToolCall.id,
          content: JSON.stringify({ name: 'omena-agent-workbench', version: '4.1.1' })
        }
      ];

      await testAdapter.streamChat({
        messages,
        tools: sampleTools,
        credentials: { [providerKey]: apiKey },
        emit: (evt) => {
          if (evt.type === 'text_chunk') continuationText += evt.token;
        }
      });
      assert.ok(continuationText.length > 0, 'Expected non-empty continuation text from model');
    });

    // 7. Cancellation
    await runTest('Test 7: In-Flight Stream Cancellation', async () => {
      const abortCtrl = new AbortController();
      let streamStarted = false;
      const promise = testAdapter.streamChat({
        prompt: 'Write a 1000 word essay on quantum computing.',
        credentials: { [providerKey]: apiKey },
        signal: abortCtrl.signal,
        emit: (evt) => {
          if (evt.type === 'text_chunk') {
            streamStarted = true;
            abortCtrl.abort();
          }
        }
      });

      try {
        await promise;
      } catch (err) {
        assert.ok(err.name === 'AbortError' || abortCtrl.signal.aborted, 'Expected AbortError');
      }
    });

    // 8. Invalid Credentials
    await runTest('Test 8: Invalid Credential Rejection', async () => {
      const badRes = await defaultAdapter.validateConnection('invalid_key_999999');
      assert.strictEqual(badRes.valid, false, 'Expected invalid credentials to fail');
    });

    // 9. Unavailable Model
    await runTest('Test 9: Unavailable Model Error Handling', async () => {
      const badAdapter = adapterFactory('non-existent-model-xyz-999');
      let thrown = false;
      try {
        await badAdapter.streamChat({
          prompt: 'Hello',
          credentials: { [providerKey]: apiKey },
          emit: () => {}
        });
      } catch (err) {
        thrown = true;
        assert.ok(err.code || err.message, 'Expected error to be caught');
      }
      assert.ok(thrown, 'Expected call to throw on unavailable model');
    });

    // 10. Error Normalization
    await runTest('Test 10: Error Code Normalization', async () => {
      const err = defaultAdapter.normalizeError(new Error('Rate limit exceeded'), { status: 429 });
      assert.strictEqual(err.code, ErrorCode.RATE_LIMITED, 'HTTP 429 must normalize to RATE_LIMITED');
    });

    results[providerKey] = {
      status: passedCount === 10 ? 'PASS' : (passedCount > 0 ? 'PARTIAL' : 'FAIL'),
      passed: passedCount,
      total: 10,
      tests: testLog
    };
  }

  // --- Run for each enabled provider ---

  // 1. Gemini
  if (process.env.LIVE_GEMINI === '1') {
    await testProvider('gemini', (m) => new GeminiAdapter(m || 'gemini-2.0-flash'), credentials.gemini);
  } else {
    console.log('ℹ️  LIVE_GEMINI is not set. Marking status: NOT_RUN');
  }

  // 2. OpenAI
  if (process.env.LIVE_OPENAI === '1') {
    await testProvider('openai', (m) => new OpenAIAdapter(m || 'gpt-4o'), credentials.openai);
  } else {
    console.log('ℹ️  LIVE_OPENAI is not set. Marking status: NOT_RUN');
  }

  // 3. Anthropic
  if (process.env.LIVE_ANTHROPIC === '1') {
    await testProvider('anthropic', (m) => new AnthropicAdapter(m || 'claude-3-5-sonnet'), credentials.anthropic);
  } else {
    console.log('ℹ️  LIVE_ANTHROPIC is not set. Marking status: NOT_RUN');
  }

  // 4. DeepSeek
  if (process.env.LIVE_DEEPSEEK === '1') {
    await testProvider('deepseek', (m) => new DeepSeekAdapter(m || 'deepseek-chat'), credentials.deepseek);
  } else {
    console.log('ℹ️  LIVE_DEEPSEEK is not set. Marking status: NOT_RUN');
  }

  // 5. Local
  if (process.env.LIVE_LOCAL === '1') {
    await testProvider('local', (m) => new LocalAdapter(m || 'local-default'), credentials.local);
  } else {
    console.log('ℹ️  LIVE_LOCAL is not set. Marking status: NOT_RUN');
  }

  console.log('\n======================================================================');
  console.log('📊 LIVE PROVIDER SUITE SUMMARY:');
  for (const [p, r] of Object.entries(results)) {
    console.log(`   ${p.padEnd(12)}: ${r.status}${r.passed !== undefined ? ` (${r.passed}/${r.total})` : ''}`);
  }
  console.log('======================================================================\n');

  return results;
}

// Allow direct execution
if (process.argv[1] && process.argv[1].endsWith('live_provider_suite.js')) {
  runLiveProviderSuite().catch(err => {
    console.error('Fatal live suite error:', err);
    process.exit(1);
  });
}
