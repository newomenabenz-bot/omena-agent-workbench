/**
 * OMENA Provider Adapter Manager v3.0
 * Central registry for model capabilities, routing, and schema declarations
 */

import { GeminiAdapter } from './gemini_adapter.js';
import { OpenAIAdapter } from './openai_adapter.js';
import { AnthropicAdapter } from './anthropic_adapter.js';
import { LocalAdapter } from './local_adapter.js';
import { DeepSeekAdapter } from './deepseek_adapter.js';

export class AdapterManager {
  constructor() {
    this.adapters = new Map();
    this.registerDefaults();
  }

  registerDefaults() {
    // Google Gemini (Standard Multimodal - reasoning: false)
    this.adapters.set('gemini-2.0-flash', new GeminiAdapter('gemini-2.0-flash'));
    this.adapters.set('gemini-1.5-pro', new GeminiAdapter('gemini-1.5-pro'));

    // OpenAI ChatGPT
    this.adapters.set('gpt-4o', new OpenAIAdapter('gpt-4o')); // Multimodal standard - reasoning: false
    this.adapters.set('o3-mini', new OpenAIAdapter('o3-mini')); // Dedicated Reasoning - reasoning: true

    // Anthropic Claude (reasoning: false)
    this.adapters.set('claude-3-5-sonnet', new AnthropicAdapter('claude-3-5-sonnet'));

    // DeepSeek AI (Dedicated Reasoning - reasoning: true)
    this.adapters.set('deepseek-r1', new DeepSeekAdapter('deepseek-r1'));

    // Local Ollama / llama.cpp (reasoning: false)
    this.adapters.set('local-gguf', new LocalAdapter('local-gguf'));
  }

  getAdapter(modelId = 'gemini-2.0-flash') {
    if (this.adapters.has(modelId)) {
      return this.adapters.get(modelId);
    }
    // Fallback: check prefix
    if (modelId.startsWith('gemini')) return this.adapters.get('gemini-2.0-flash') || new GeminiAdapter(modelId);
    if (modelId.startsWith('o1') || modelId.startsWith('o3')) return this.adapters.get('o3-mini') || new OpenAIAdapter(modelId);
    if (modelId.startsWith('gpt')) return this.adapters.get('gpt-4o') || new OpenAIAdapter(modelId);
    if (modelId.startsWith('claude')) return this.adapters.get('claude-3-5-sonnet') || new AnthropicAdapter(modelId);
    if (modelId.startsWith('deepseek')) return this.adapters.get('deepseek-r1') || new DeepSeekAdapter(modelId);
    if (modelId.includes('local') || modelId.includes('ollama') || modelId.includes('gguf')) return this.adapters.get('local-gguf') || new LocalAdapter(modelId);

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
      return { valid: false, error: `Unknown provider: ${providerName}` };
    }
    return await adapter.validateCredential(credential);
  }

  async discoverProviderModels(providerName, credential) {
    const adapter = this.getProviderAdapter(providerName);
    if (!adapter) return [];
    return await adapter.discoverModels(credential);
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
        // Overlay capabilities if provided in discovered model
        if (model.contextWindow) adapter.capabilities.contextWindow = model.contextWindow;
        if (typeof model.vision === 'boolean') adapter.capabilities.vision = model.vision;
        if (typeof model.reasoning === 'boolean') adapter.capabilities.reasoning = model.reasoning;
        if (model.name) adapter.capabilities.name = model.name;
        this.adapters.set(model.id, adapter);
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
            this.registerDiscoveredModels(prov, models);
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
    const list = [];
    for (const [id, adapter] of this.adapters.entries()) {
      list.push(adapter.getCapabilities());
    }
    return list;
  }
}

export const adapterManager = new AdapterManager();
