/**
 * OMENA Multi-Provider Adapter Unit & Smoke Test Suite
 * Validates payload formatting, schema translation, and reasoning flag definitions across all providers
 */

import { adapterManager } from '../providers/adapter_manager.js';

async function runAdapterTests() {
  console.log(`\n======================================================`);
  console.log(`🧪 Running Provider Adapter Unit & Schema Smoke Tests`);
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

  const sampleTools = [
    {
      name: 'execute_shell',
      description: 'Run safe command',
      parameters: {
        type: 'object',
        properties: { command: { type: 'string' } },
        required: ['command']
      }
    }
  ];

  // 1. Gemini Adapter
  const gemini = adapterManager.getAdapter('gemini-2.0-flash');
  const geminiCaps = gemini.getCapabilities();
  assert('Gemini: reasoning is FALSE', geminiCaps.reasoning === false);
  assert('Gemini: tools is TRUE', geminiCaps.tools === true);
  assert('Gemini: streaming is TRUE', geminiCaps.streaming === true);

  const geminiPayload = gemini.formatPayload({
    prompt: 'list files',
    tools: sampleTools
  });
  assert('Gemini payload: has function tools', geminiPayload.tools?.[0]?.type === 'function');
  assert('Gemini payload: maps tool name correctly', geminiPayload.tools?.[0]?.function?.name === 'execute_shell');

  // 2. OpenAI GPT-4o Adapter
  const gpt4o = adapterManager.getAdapter('gpt-4o');
  const gpt4oCaps = gpt4o.getCapabilities();
  assert('GPT-4o: reasoning is FALSE', gpt4oCaps.reasoning === false);
  assert('GPT-4o: vision is TRUE', gpt4oCaps.vision === true);

  const gpt4oPayload = gpt4o.formatPayload({
    prompt: 'hello',
    tools: sampleTools
  });
  assert('GPT-4o payload: omits reasoning_effort', gpt4oPayload.reasoning_effort === undefined);
  assert('GPT-4o payload: formats tools with function wrapper', gpt4oPayload.tools?.[0]?.function?.name === 'execute_shell');

  // 3. OpenAI o3-mini Adapter
  const o3 = adapterManager.getAdapter('o3-mini');
  const o3Caps = o3.getCapabilities();
  assert('o3-mini: reasoning is TRUE', o3Caps.reasoning === true);
  assert('o3-mini: tools is TRUE', o3Caps.tools === true);

  const o3Payload = o3.formatPayload({
    prompt: 'solve riddle'
  });
  assert('o3-mini payload: includes reasoning_effort medium', o3Payload.reasoning_effort === 'medium');

  // 4. Anthropic Claude Adapter
  const claude = adapterManager.getAdapter('claude-3-5-sonnet');
  const claudeCaps = claude.getCapabilities();
  assert('Claude: reasoning is FALSE', claudeCaps.reasoning === false);
  assert('Claude: tools is TRUE', claudeCaps.tools === true);

  const claudePayload = claude.formatPayload({
    prompt: 'inspect code',
    tools: sampleTools
  });
  assert('Claude payload: uses Anthropic input_schema format (not parameters)', Boolean(claudePayload.tools?.[0]?.input_schema));
  assert('Claude payload: tool input_schema matches properties', claudePayload.tools?.[0]?.input_schema?.properties?.command?.type === 'string');

  // 5. DeepSeek R1 Adapter
  const deepseek = adapterManager.getAdapter('deepseek-r1');
  const deepseekCaps = deepseek.getCapabilities();
  assert('DeepSeek R1: reasoning is TRUE', deepseekCaps.reasoning === true);
  assert('DeepSeek R1: tools is TRUE', deepseekCaps.tools === true);

  const deepseekPayload = deepseek.formatPayload({
    prompt: 'math reasoning'
  });
  assert('DeepSeek payload: uses deepseek-reasoner model ID', deepseekPayload.model === 'deepseek-reasoner');

  // 6. Local GGUF Adapter
  const local = adapterManager.getAdapter('local-gguf');
  const localCaps = local.getCapabilities();
  assert('Local GGUF: tools is FALSE', localCaps.tools === false);
  assert('Local GGUF: reasoning is FALSE', localCaps.reasoning === false);
  assert('Local GGUF: streaming is TRUE', localCaps.streaming === true);

  console.log(`\n======================================================`);
  console.log(`📊 Adapter Tests: ${passed} passed, ${failed} failed`);
  console.log(`======================================================\n`);

  if (failed > 0) process.exit(1);
}

runAdapterTests().catch(err => {
  console.error('Fatal adapter test error:', err);
  process.exit(1);
});
