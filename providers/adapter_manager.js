/**
 * OMENA Provider Adapter Manager v4.1.0
 * Central registry for model capabilities, routing, and schema declarations
 */

import { GeminiAdapter } from './gemini_adapter.js';
import { OpenAIAdapter } from './openai_adapter.js';
import { AnthropicAdapter } from './anthropic_adapter.js';
import { LocalAdapter } from './local_adapter.js';
import { DeepSeekAdapter } from './deepseek_adapter.js';
import { modelRegistry } from './model_registry.js';
import { ModelRouter } from './model_router.js';
import { ConnectionState } from './base_adapter.js';

export class AdapterManager {
  constructor() {
    this.adapters = new Map();
    this.router = new ModelRouter(this);
    this.registerDefaults();
  }

  registerDefaults() {
    // Google Gemini
    this.adapters.set('gemini-2.0-flash', new GeminiAdapter('gemini-2.0-flash'));
    this.adapters.set('gemini-1.5-pro', new GeminiAdapter('gemini-1.5-pro'));
    this.adapters.set('gemini-2.0-flash-thinking-exp', new GeminiAdapter('gemini-2.0-flash-thinking-exp'));

    // OpenAI ChatGPT
    this.adapters.set('gpt-4o', new OpenAIAdapter('gpt-4o'));
    this.adapters.set('gpt-4o-mini', new OpenAIAdapter('gpt-4o-mini'));
    this.adapters.set('o3-mini', new OpenAIAdapter('o3-mini'));
    this.adapters.set('o1', new OpenAIAdapter('o1'));

    // Anthropic Claude
    this.adapters.set('claude-3-5-sonnet', new AnthropicAdapter('claude-3-5-sonnet'));
    this.adapters.set('claude-3-5-haiku', new AnthropicAdapter('claude-3-5-haiku'));

    // DeepSeek AI
    this.adapters.set('deepseek-r1', new DeepSeekAdapter('deepseek-r1'));
    this.adapters.set('deepseek-reasoner', new DeepSeekAdapter('deepseek-reasoner'));
    this.adapters.set('deepseek-chat', new DeepSeekAdapter('deepseek-chat'));

    // Local Ollama / llama.cpp
    this.adapters.set('local-gguf', new LocalAdapter('local-gguf'));
  }

  getAdapter(modelId = 'gemini-2.0-flash') {
    if (this.adapters.has(modelId)) {
      return this.adapters.get(modelId);
    }
    // Dynamic matching by prefix
    if (modelId.startsWith('gemini')) {
      const a = new GeminiAdapter(modelId);
      this.adapters.set(modelId, a);
      return a;
    }
    if (modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('gpt')) {
      const a = new OpenAIAdapter(modelId);
      this.adapters.set(modelId, a);
      return a;
    }
    if (modelId.startsWith('claude')) {
      const a = new AnthropicAdapter(modelId);
      this.adapters.set(modelId, a);
      return a;
    }
    if (modelId.startsWith('deepseek')) {
      const a = new DeepSeekAdapter(modelId);
      this.adapters.set(modelId, a);
      return a;
    }
    if (modelId.includes('local') || modelId.includes('ollama') || modelId.includes('gguf')) {
      const a = new LocalAdapter(modelId);
      this.adapters.set(modelId, a);
      return a;
    }

    return this.adapters.get('gemini-2.0-flash');
  }

  getProviderAdapter(providerName) {
    const norm = (providerName || '').toLowerCase().trim();
    if (norm === 'gemini' || norm === 'google') return new GeminiAdapter();
    if (norm === 'openai' || norm === 'chatgpt') return new OpenAIAdapter();
    if (norm === 'anthropic' || norm === 'claude') return new AnthropicAdapter();
    if (norm === 'deepseek') return new DeepSeekAdapter();
    if (norm === 'local' || norm === 'ollama') return new LocalAdapter();
    return null;
  }

  async validateProvider(providerName, credential) {
    const adapter = this.getProviderAdapter(providerName);
    if (!adapter) {
      return { valid: false, state: ConnectionState.NOT_CONFIGURED, error: `Unknown provider: ${providerName}` };
    }
    return await adapter.validateConnection(credential);
  }

  async discoverProviderModels(providerName, credential) {
    const adapter = this.getProviderAdapter(providerName);
    if (!adapter) return [];
    const models = await adapter.discoverModels(credential);
    if (Array.isArray(models) && models.length > 0) {
      this.registerDiscoveredModels(providerName, models);
    }
    return models;
  }

  registerDiscoveredModels(providerName, models = []) {
    const norm = (providerName || '').toLowerCase().trim();
    for (const model of models) {
      if (!model || !model.id) continue;
      let adapter;
      if (norm === 'gemini' || norm === 'google') adapter = new GeminiAdapter(model.id);
      else if (norm === 'openai' || norm === 'chatgpt') adapter = new OpenAIAdapter(model.id);
      else if (norm === 'anthropic' || norm === 'claude') adapter = new AnthropicAdapter(model.id);
      else if (norm === 'deepseek') adapter = new DeepSeekAdapter(model.id);
      else if (norm === 'local' || norm === 'ollama') adapter = new LocalAdapter(model.id);

      if (adapter) {
        if (model.contextWindow) adapter.capabilities.contextWindow = model.contextWindow;
        if (typeof model.vision === 'boolean') adapter.capabilities.vision = model.vision;
        if (typeof model.reasoning === 'boolean') adapter.capabilities.reasoning = model.reasoning;
        if (model.name) adapter.capabilities.name = model.name;
        this.adapters.set(model.id, adapter);

        modelRegistry.register({
          id: model.id,
          name: model.name || model.id,
          provider: norm,
          providerName: adapter.name,
          contextWindow: adapter.capabilities.contextWindow,
          streaming: adapter.capabilities.streaming,
          tools: adapter.capabilities.tools,
          vision: adapter.capabilities.vision,
          reasoning: adapter.capabilities.reasoning,
          discovered: true
        });
      }
    }
  }

  async discoverAll(credentials = {}) {
    const results = {};
    const providers = ['gemini', 'openai', 'anthropic', 'deepseek', 'local'];

    for (const prov of providers) {
      const cred = credentials[prov] || credentials[`${prov}Key`];
      if (cred) {
        try {
          const models = await this.discoverProviderModels(prov, cred);
          if (models && models.length > 0) {
            results[prov] = { success: true, count: models.length, models };
          }
        } catch (err) {
          results[prov] = { success: false, error: err.message };
        }
      }
    }
    return results;
  }

  listModels() {
    const registered = modelRegistry.list();
    const result = [];
    const seen = new Set();

    for (const m of registered) {
      seen.add(m.id);
      const adapter = this.adapters.get(m.id);
      result.push({
        ...m,
        connectionState: adapter ? adapter.getConnectionState() : ConnectionState.NOT_CONFIGURED,
        telemetry: adapter ? adapter.getCapabilities().telemetry : null
      });
    }

    for (const [id, adapter] of this.adapters.entries()) {
      if (!seen.has(id)) {
        seen.add(id);
        result.push(adapter.getCapabilities());
      }
    }

    return result;
  }

  getAggregatedTelemetry() {
    let totalRequests = 0;
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;
    let totalErrors = 0;

    for (const adapter of this.adapters.values()) {
      totalRequests += adapter.telemetry.requestCount;
      totalPromptTokens += adapter.telemetry.tokenCount.prompt;
      totalCompletionTokens += adapter.telemetry.tokenCount.completion;
      totalErrors += adapter.telemetry.errorCount;
    }

    return {
      totalRequests,
      totalPromptTokens,
      totalCompletionTokens,
      totalErrors
    };
  }
}

export const adapterManager = new AdapterManager();
