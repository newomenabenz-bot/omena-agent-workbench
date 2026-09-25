/**
 * OMENA Unified Model Registry v4.1.0
 * Dynamic catalog and capability registry for all verified AI models.
 */

export class ModelRegistry {
  constructor() {
    this.models = new Map();
    this.registerDefaults();
  }

  registerDefaults() {
    // Google Gemini
    this.register({
      id: 'gemini-2.0-flash',
      name: 'Google Gemini 2.0 Flash',
      provider: 'gemini',
      providerName: 'Google Gemini',
      contextWindow: 1048576,
      streaming: true,
      tools: true,
      vision: true,
      reasoning: false,
      recommended: true
    });
    this.register({
      id: 'gemini-1.5-pro',
      name: 'Google Gemini 1.5 Pro',
      provider: 'gemini',
      providerName: 'Google Gemini',
      contextWindow: 2097152,
      streaming: true,
      tools: true,
      vision: true,
      reasoning: false
    });
    this.register({
      id: 'gemini-2.0-flash-thinking-exp',
      name: 'Google Gemini 2.0 Flash Thinking',
      provider: 'gemini',
      providerName: 'Google Gemini',
      contextWindow: 1048576,
      streaming: true,
      tools: true,
      vision: true,
      reasoning: true
    });

    // OpenAI
    this.register({
      id: 'gpt-4o',
      name: 'OpenAI GPT-4o',
      provider: 'openai',
      providerName: 'OpenAI ChatGPT',
      contextWindow: 128000,
      streaming: true,
      tools: true,
      vision: true,
      reasoning: false
    });
    this.register({
      id: 'gpt-4o-mini',
      name: 'OpenAI GPT-4o Mini',
      provider: 'openai',
      providerName: 'OpenAI ChatGPT',
      contextWindow: 128000,
      streaming: true,
      tools: true,
      vision: true,
      reasoning: false
    });
    this.register({
      id: 'o3-mini',
      name: 'OpenAI o3-mini',
      provider: 'openai',
      providerName: 'OpenAI ChatGPT',
      contextWindow: 200000,
      streaming: true,
      tools: true,
      vision: false,
      reasoning: true
    });
    this.register({
      id: 'o1',
      name: 'OpenAI o1',
      provider: 'openai',
      providerName: 'OpenAI ChatGPT',
      contextWindow: 200000,
      streaming: true,
      tools: true,
      vision: true,
      reasoning: true
    });

    // Anthropic Claude
    this.register({
      id: 'claude-3-5-sonnet',
      name: 'Claude 3.5 Sonnet',
      provider: 'anthropic',
      providerName: 'Anthropic Claude',
      contextWindow: 200000,
      streaming: true,
      tools: true,
      vision: true,
      reasoning: false
    });
    this.register({
      id: 'claude-3-5-haiku',
      name: 'Claude 3.5 Haiku',
      provider: 'anthropic',
      providerName: 'Anthropic Claude',
      contextWindow: 200000,
      streaming: true,
      tools: true,
      vision: false,
      reasoning: false
    });

    // DeepSeek
    this.register({
      id: 'deepseek-chat',
      name: 'DeepSeek V3 (Chat)',
      provider: 'deepseek',
      providerName: 'DeepSeek AI',
      contextWindow: 64000,
      streaming: true,
      tools: true,
      vision: false,
      reasoning: false
    });
    this.register({
      id: 'deepseek-reasoner',
      name: 'DeepSeek R1 (Reasoner)',
      provider: 'deepseek',
      providerName: 'DeepSeek AI',
      contextWindow: 64000,
      streaming: true,
      tools: true,
      vision: false,
      reasoning: true
    });
    this.register({
      id: 'deepseek-r1',
      name: 'DeepSeek R1 (Alias)',
      provider: 'deepseek',
      providerName: 'DeepSeek AI',
      contextWindow: 64000,
      streaming: true,
      tools: true,
      vision: false,
      reasoning: true
    });

    // Local AI
    this.register({
      id: 'local-gguf',
      name: 'Local Ollama / llama.cpp',
      provider: 'local',
      providerName: 'Local GGUF / Ollama',
      contextWindow: 8192,
      streaming: true,
      tools: false,
      vision: false,
      reasoning: false
    });
  }

  register(model) {
    if (!model || !model.id) return;
    const existing = this.models.get(model.id) || {};
    this.models.set(model.id, {
      ...existing,
      ...model,
      updatedAt: Date.now()
    });
  }

  registerBatch(models = []) {
    for (const m of models) {
      this.register(m);
    }
  }

  get(modelId) {
    return this.models.get(modelId) || null;
  }

  list() {
    return Array.from(this.models.values());
  }

  filterByCapabilities(reqs = {}) {
    return this.list().filter(m => {
      if (reqs.vision && !m.vision) return false;
      if (reqs.tools && !m.tools) return false;
      if (reqs.reasoning && !m.reasoning) return false;
      if (reqs.streaming && !m.streaming) return false;
      if (reqs.provider && m.provider !== reqs.provider) return false;
      if (reqs.minContext && m.contextWindow < reqs.minContext) return false;
      return true;
    });
  }
}

export const modelRegistry = new ModelRegistry();
