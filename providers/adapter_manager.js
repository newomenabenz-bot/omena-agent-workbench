/**
 * OMENA Provider Adapter Manager
 * Central registry for model capabilities, routing, and schema declarations
 */

import { GeminiAdapter } from './gemini_adapter.js';
import { OpenAIAdapter } from './openai_adapter.js';
import { AnthropicAdapter } from './anthropic_adapter.js';
import { LocalAdapter } from './local_adapter.js';

export class AdapterManager {
  constructor() {
    this.adapters = new Map();
    this.registerDefaults();
  }

  registerDefaults() {
    // Gemini
    this.adapters.set('gemini-2.0-flash', new GeminiAdapter('gemini-2.0-flash'));
    this.adapters.set('gemini-1.5-pro', new GeminiAdapter('gemini-1.5-pro'));

    // OpenAI
    this.adapters.set('gpt-4o', new OpenAIAdapter('gpt-4o'));
    this.adapters.set('o3-mini', new OpenAIAdapter('o3-mini'));

    // Anthropic
    this.adapters.set('claude-3-5-sonnet', new AnthropicAdapter('claude-3-5-sonnet'));

    // Local
    this.adapters.set('local-gguf', new LocalAdapter('local-gguf'));
  }

  getAdapter(modelId = 'gemini-2.0-flash') {
    if (this.adapters.has(modelId)) {
      return this.adapters.get(modelId);
    }
    // Fallback: check prefix
    if (modelId.startsWith('gemini')) return this.adapters.get('gemini-2.0-flash');
    if (modelId.startsWith('gpt') || modelId.startsWith('o3')) return this.adapters.get('gpt-4o');
    if (modelId.startsWith('claude')) return this.adapters.get('claude-3-5-sonnet');
    if (modelId.includes('local') || modelId.includes('ollama') || modelId.includes('gguf')) return this.adapters.get('local-gguf');

    return this.adapters.get('gemini-2.0-flash');
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
