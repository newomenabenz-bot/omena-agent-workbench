/**
 * OMENA Multi-Provider Runtime & Contract Verification Suite v4.1.0
 * Comprehensive offline verification of provider state machines, wire protocols,
 * error normalizations, telemetry, model router, and agent tool continuation loop.
 */

import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ConnectionState, ErrorCode, WorkbenchError, BaseProviderAdapter } from '../providers/base_adapter.js';
import { GeminiAdapter } from '../providers/gemini_adapter.js';
import { OpenAIAdapter } from '../providers/openai_adapter.js';
import { AnthropicAdapter } from '../providers/anthropic_adapter.js';
import { DeepSeekAdapter } from '../providers/deepseek_adapter.js';
import { LocalAdapter } from '../providers/local_adapter.js';
import { adapterManager } from '../providers/adapter_manager.js';
import { modelRegistry } from '../providers/model_registry.js';
import { ModelRouter } from '../providers/model_router.js';
import { WorkbenchDatabase } from '../db.js';
import { AgentOrchestrator } from '../agent_orchestrator.js';
import { MockProviderServer } from './mock_provider_server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_DB_PATH = path.join(__dirname, 'test_contract_workbench.db');

let mockServer = null;
let mockBaseUrl = null;

async function runTests() {
  console.log('===============================================================');
  console.log('🧪 OMENA v4.1.0 Multi-Provider AI Runtime Contract Test Suite');
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✅ PASS: ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ FAIL: ${name}`);
      console.error(`     Error: ${err.message}`);
      if (err.stack) {
        console.error(`     ${err.stack.split('\n').slice(1, 4).join('\n     ')}`);
      }
      failed++;
    }
  }

  // Spin up Mock Provider Server
  const mockPort = 8098;
  mockServer = new MockProviderServer(mockPort);
  mockBaseUrl = await mockServer.start();
  console.log(`📡 Mock Provider Server running at ${mockBaseUrl}\n`);

  try {
    // -------------------------------------------------------------
    // Test Group 1: Base Provider Adapter & State Machine
    // -------------------------------------------------------------
    console.log('--- Group 1: Base Provider Adapter & State Machine ---');

    await test('BaseProviderAdapter initializes with NOT_CONFIGURED state', () => {
      const adapter = new BaseProviderAdapter('test-model', 'Test Provider', { streaming: true });
      assert.strictEqual(adapter.getConnectionState(), ConnectionState.NOT_CONFIGURED);
      assert.strictEqual(adapter.capabilities.streaming, true);
      assert.strictEqual(adapter.telemetry.requestCount, 0);
    });

    await test('BaseProviderAdapter transitions through valid connection states', () => {
      const adapter = new BaseProviderAdapter('test-model', 'Test Provider');
      adapter.setConnectionState(ConnectionState.VALIDATING);
      assert.strictEqual(adapter.getConnectionState(), ConnectionState.VALIDATING);

      adapter.setConnectionState(ConnectionState.CONNECTED);
      assert.strictEqual(adapter.getConnectionState(), ConnectionState.CONNECTED);
      assert.ok(adapter.telemetry.lastConnected > 0);

      adapter.setConnectionState(ConnectionState.AUTH_FAILED, { error: 'Invalid key' });
      assert.strictEqual(adapter.getConnectionState(), ConnectionState.AUTH_FAILED);
      assert.strictEqual(adapter.telemetry.errorCount, 1);
      assert.strictEqual(adapter.telemetry.lastError.message, 'Invalid key');
    });

    await test('BaseProviderAdapter rejects invalid connection state strings', () => {
      const adapter = new BaseProviderAdapter('test-model', 'Test Provider');
      assert.throws(() => adapter.setConnectionState('UNKNOWN_STATE'), /Invalid connection state/);
    });

    await test('normalizeError maps HTTP 401/403 to AUTH_FAILED', () => {
      const adapter = new BaseProviderAdapter('test-model', 'Test Provider');
      const err = adapter.normalizeError(new Error('Unauthorized'), { status: 401 });
      assert.ok(err instanceof WorkbenchError);
      assert.strictEqual(err.code, ErrorCode.AUTH_FAILED);
      assert.strictEqual(adapter.getConnectionState(), ConnectionState.AUTH_FAILED);
    });

    await test('normalizeError maps HTTP 429 to RATE_LIMITED', () => {
      const adapter = new BaseProviderAdapter('test-model', 'Test Provider');
      const err = adapter.normalizeError(new Error('Rate limit exceeded'), { status: 429 });
      assert.strictEqual(err.code, ErrorCode.RATE_LIMITED);
      assert.strictEqual(adapter.getConnectionState(), ConnectionState.RATE_LIMITED);
    });

    await test('normalizeError maps 503 and network timeout to appropriate codes', () => {
      const adapter = new BaseProviderAdapter('test-model', 'Test Provider');
      const err503 = adapter.normalizeError(new Error('Service Unavailable'), { status: 503 });
      assert.strictEqual(err503.code, ErrorCode.PROVIDER_UNAVAILABLE);
      assert.strictEqual(adapter.getConnectionState(), ConnectionState.DEGRADED);

      const errTimeout = adapter.normalizeError(new Error('Request timed out'));
      assert.strictEqual(errTimeout.code, ErrorCode.REQUEST_TIMEOUT);
      assert.strictEqual(adapter.getConnectionState(), ConnectionState.NETWORK_ERROR);
    });

    await test('recordTelemetry aggregates token counts and TTFT metrics', () => {
      const adapter = new BaseProviderAdapter('test-model', 'Test Provider');
      adapter.recordTelemetry({
        tokens: { prompt: 50, completion: 120, reasoning: 30 },
        ttftMs: 240,
        totalMs: 1100
      });
      assert.strictEqual(adapter.telemetry.requestCount, 1);
      assert.strictEqual(adapter.telemetry.tokenCount.prompt, 50);
      assert.strictEqual(adapter.telemetry.tokenCount.completion, 120);
      assert.strictEqual(adapter.telemetry.tokenCount.reasoning, 30);
      assert.strictEqual(adapter.telemetry.latency.ttft, 240);
      assert.strictEqual(adapter.telemetry.latency.total, 1100);
      assert.strictEqual(adapter.telemetry.latency.history.length, 1);
    });

    // -------------------------------------------------------------
    // Test Group 2: Provider Adapters Wire Protocol & Discovery
    // -------------------------------------------------------------
    console.log('\n--- Group 2: Provider Adapters Wire Protocol & Discovery ---');

    await test('GeminiAdapter validates connection and discovers models from mock server', async () => {
      const gemini = new GeminiAdapter('gemini-2.0-flash');
      gemini.baseUrl = mockBaseUrl; // Point to mock server

      const validation = await gemini.validateConnection('test-gemini-key');
      assert.strictEqual(validation.valid, true);
      assert.strictEqual(validation.state, ConnectionState.CONNECTED);
      assert.strictEqual(gemini.getConnectionState(), ConnectionState.CONNECTED);

      const models = await gemini.discoverModels('test-gemini-key');
      assert.ok(Array.isArray(models));
      assert.strictEqual(models.length, 2);
      assert.strictEqual(models[0].id, 'gemini-2.0-flash');

      // Test invalid key
      const invalidValidation = await gemini.validateConnection('invalid-key');
      assert.strictEqual(invalidValidation.valid, false);
      assert.strictEqual(gemini.getConnectionState(), ConnectionState.AUTH_FAILED);
    });

    await test('GeminiAdapter streaming accumulates deltas and emits chunks', async () => {
      const gemini = new GeminiAdapter('gemini-2.0-flash');
      gemini.baseUrl = mockBaseUrl;

      const receivedTokens = [];
      await gemini.streamChat({
        prompt: 'Hello Gemini',
        credentials: { gemini: 'test-valid-key' },
        emit: (ev) => {
          if (ev.type === 'text_chunk') receivedTokens.push(ev.token);
        }
      });

      assert.ok(receivedTokens.length >= 2);
      assert.strictEqual(receivedTokens.join(''), 'Mock provider stream chunk 1. Operation completed successfully.');
      assert.strictEqual(gemini.telemetry.requestCount, 1);
      assert.ok(gemini.telemetry.latency.ttft >= 0);
    });

    await test('GeminiAdapter parses tool calls and emits tool_call events', async () => {
      const gemini = new GeminiAdapter('gemini-2.0-flash');
      gemini.baseUrl = mockBaseUrl;

      mockServer.setSimulatedToolCall({
        id: 'call_gemini_test_1',
        name: 'terminal_executeCommand',
        arguments: { command: 'node -v' }
      });

      const toolCalls = [];
      await gemini.streamChat({
        prompt: 'Run node -v',
        credentials: { gemini: 'test-valid-key' },
        emit: (ev) => {
          if (ev.type === 'tool_call') toolCalls.push(ev.call);
        }
      });

      mockServer.clearSimulation();
      assert.strictEqual(toolCalls.length, 1);
      assert.strictEqual(toolCalls[0].name, 'terminal_executeCommand');
      assert.strictEqual(toolCalls[0].arguments.command, 'node -v');
    });

    await test('OpenAIAdapter validates connection and discovers models', async () => {
      const openai = new OpenAIAdapter('gpt-4o');
      openai.baseUrl = `${mockBaseUrl}/v1`;

      const validation = await openai.validateConnection('sk-valid-key');
      assert.strictEqual(validation.valid, true);
      assert.strictEqual(validation.state, ConnectionState.CONNECTED);

      const models = await openai.discoverModels('sk-valid-key');
      assert.ok(models.some(m => m.id === 'gpt-4o'));
      assert.ok(models.some(m => m.id === 'o3-mini'));

      const invalid = await openai.validateConnection('invalid-key');
      assert.strictEqual(invalid.valid, false);
      assert.strictEqual(openai.getConnectionState(), ConnectionState.AUTH_FAILED);
    });

    await test('AnthropicAdapter handles Messages API streaming and tool_use', async () => {
      const claude = new AnthropicAdapter('claude-3-5-sonnet');
      claude.baseUrl = `${mockBaseUrl}/v1`;

      mockServer.setSimulatedToolCall({
        id: 'call_claude_1',
        name: 'filesystem_writeFile',
        arguments: { path: 'test.txt', content: 'hello' }
      });

      const toolCalls = [];
      await claude.streamChat({
        prompt: 'Write test file',
        credentials: { anthropic: 'sk-ant-valid' },
        emit: (ev) => {
          if (ev.type === 'tool_call') toolCalls.push(ev.call);
        }
      });

      mockServer.clearSimulation();
      assert.strictEqual(toolCalls.length, 1);
      assert.strictEqual(toolCalls[0].name, 'filesystem_writeFile');
      assert.strictEqual(toolCalls[0].arguments.path, 'test.txt');
    });

    await test('LocalAdapter validates Ollama tags and dynamic models', async () => {
      const local = new LocalAdapter('local-gguf');
      const val = await local.validateConnection({ local: mockBaseUrl });
      assert.strictEqual(val.valid, true);
      assert.strictEqual(val.state, ConnectionState.CONNECTED);

      const models = await local.discoverModels({ local: mockBaseUrl });
      assert.ok(models.length >= 2);
      assert.strictEqual(models[0].id, 'local-llama3:latest');

      // Unreachable port check
      const unreachable = await local.validateConnection({ local: 'http://127.0.0.1:59999' });
      assert.strictEqual(unreachable.valid, false);
      assert.strictEqual(unreachable.state, ConnectionState.DISCONNECTED);
    });

    // -------------------------------------------------------------
    // Test Group 3: Model Router & Capability Selection
    // -------------------------------------------------------------
    console.log('\n--- Group 3: Model Router & Capability Selection ---');

    await test('ModelRouter selects appropriate model by capabilities', () => {
      const router = new ModelRouter(adapterManager);
      const reasoningModel = router.selectModelForCapabilities({ reasoning: true });
      assert.ok(reasoningModel === 'gemini-2.0-flash-thinking-exp' || reasoningModel === 'o3-mini' || reasoningModel.includes('reasoner') || reasoningModel.includes('r1'));

      const visionModel = router.selectModelForCapabilities({ vision: true });
      assert.ok(visionModel.includes('flash') || visionModel.includes('gpt-4o') || visionModel.includes('sonnet'));
    });

    await test('ModelRouter transitions between models on retryable errors and logs sequence', async () => {
      const router = new ModelRouter(adapterManager);
      const log = router.logTransition('gemini-2.0-flash', 'gpt-4o', 'RATE_LIMITED', { latencyMs: 320 });
      assert.strictEqual(log.fromModel, 'gemini-2.0-flash');
      assert.strictEqual(log.toModel, 'gpt-4o');
      assert.strictEqual(log.reason, 'RATE_LIMITED');

      const logs = router.getTransitionLogs();
      assert.ok(logs.length >= 1);
    });

    // -------------------------------------------------------------
    // Test Group 4: AES-256-GCM Encryption & Database Migrations
    // -------------------------------------------------------------
    console.log('\n--- Group 4: Security & Database Persistence ---');

    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    const testDb = new WorkbenchDatabase(TEST_DB_PATH);

    await test('Database runs migrations up to version 2', () => {
      const ver = testDb.getCurrentSchemaVersion();
      assert.strictEqual(ver, 2);
    });

    await test('AES-256-GCM encrypts secrets and decrypts accurately', () => {
      const secret = 'sk-proj-test1234567890abcdefghijklmnopqrstuvwxyz';
      const encrypted = testDb.encryptSecret(secret);
      assert.ok(encrypted.startsWith('enc:v1:'));
      assert.notStrictEqual(encrypted, secret);

      const decrypted = testDb.decryptSecret(encrypted);
      assert.strictEqual(decrypted, secret);
    });

    await test('saveProviderCredentials encrypts at rest in SQLite', () => {
      testDb.saveProviderCredentials({
        gemini: 'AIzaSyTestingKey123',
        openai: 'sk-testOpenAI456'
      });

      const rawSetting = testDb.getSetting('provider_credentials_encrypted');
      assert.ok(rawSetting.includes('enc:v1:'));
      assert.ok(!rawSetting.includes('AIzaSyTestingKey123')); // Plaintext must not exist!

      const retrieved = testDb.getProviderCredentials(false);
      assert.strictEqual(retrieved.gemini, 'AIzaSyTestingKey123');
      assert.strictEqual(retrieved.openai, 'sk-testOpenAI456');

      const masked = testDb.getMaskedProviderStatus();
      assert.strictEqual(masked.gemini.configured, true);
      assert.strictEqual(masked.gemini.maskedKey, 'AIza...y123');
    });

    await test('Database persists agent runs and sequenced events', () => {
      const runId = 'test_run_100';
      testDb.createAgentRun({
        id: runId,
        sessionId: 'sess_1',
        model: 'gemini-2.0-flash',
        provider: 'gemini',
        prompt: 'Build application'
      });

      testDb.recordAgentEvent({
        runId,
        seq: 1,
        type: 'agent.started',
        payload: { status: 'started' }
      });

      testDb.recordAgentEvent({
        runId,
        seq: 2,
        type: 'tool.completed',
        payload: { tool: 'terminal', exitCode: 0 }
      });

      const events = testDb.getAgentEventsSince(runId, 0);
      assert.strictEqual(events.length, 2);
      assert.strictEqual(events[0].seq, 1);
      assert.strictEqual(events[1].seq, 2);
      assert.strictEqual(events[1].type, 'tool.completed');

      const eventsSince1 = testDb.getAgentEventsSince(runId, 1);
      assert.strictEqual(eventsSince1.length, 1);
      assert.strictEqual(eventsSince1[0].seq, 2);
    });

    // -------------------------------------------------------------
    // Test Group 5: Real Agent Tool-Calling Continuation Loop
    // -------------------------------------------------------------
    console.log('\n--- Group 5: Real Agent Tool-Calling Continuation Loop ---');

    await test('AgentOrchestrator runs sequenced events and tool execution', async () => {
      const orchestrator = new AgentOrchestrator(testDb);
      const eventsEmitted = [];

      await orchestrator.runTaskStream({
        prompt: 'powershell node -v',
        model: 'gemini-2.0-flash',
        sessionId: 'test_session_tools',
        credentials: {}
      }, (ev) => {
        eventsEmitted.push(ev);
      });

      assert.ok(eventsEmitted.length > 0);
      const hasToolCompleted = eventsEmitted.some(e => e.type === 'tool.completed' || e.type === 'tool_done');
      assert.ok(hasToolCompleted, 'Tool completed event must be emitted');

      // Check sequence numbers are monotonically increasing
      const sequencedEvents = eventsEmitted.filter(e => typeof e.seq === 'number');
      assert.ok(sequencedEvents.length > 2);
      for (let i = 1; i < sequencedEvents.length; i++) {
        assert.ok(sequencedEvents[i].seq >= sequencedEvents[i - 1].seq);
      }
    });

    testDb.close();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);

  } finally {
    if (mockServer) {
      await mockServer.stop();
      console.log('\n🛑 Mock Provider Server stopped.');
    }
  }

  console.log('\n===============================================================');
  console.log(`Contract Suite Results: ${passed} PASSED, ${failed} FAILED`);
  console.log('===============================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal Test Runner Error:', err);
  process.exit(1);
});
