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
    if (modelId.startsWith('gemini')) return this.adapters.get('gemini-2.0-flash');
    if (modelId.startsWith('o1') || modelId.startsWith('o3')) return this.adapters.get('o3-mini');
    if (modelId.startsWith('gpt')) return this.adapters.get('gpt-4o');
    if (modelId.startsWith('claude')) return this.adapters.get('claude-3-5-sonnet');
    if (modelId.startsWith('deepseek')) return this.adapters.get('deepseek-r1');
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
