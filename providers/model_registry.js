/**
 * OMENA Unified Model Registry v4.1.1
 * Authoritative catalog and capability registry with strict model provenance:
 * - 'provider_discovery': Live models returned by provider APIs (available: true, verified: true)
 * - 'static_bootstrap': Static suggestions / fallback metadata only (available: false, verified: false)
 */

export class ModelRegistry {
  constructor() {
    this.models = new Map();
    this.registerBootstrapDefaults();
  }

  /**
   * Register static bootstrap defaults (available: false, verified: false)
   */
  registerBootstrapDefaults() {
    const bootstrapModels = [
      // Google Gemini
      {
        id: 'gemini-2.0-flash',
        name: 'Google Gemini 2.0 Flash (Suggested)',
        provider: 'gemini',
        providerName: 'Google Gemini',
        contextWindow: 1048576,
        streaming: true,
        tools: true,
        vision: true,
        reasoning: false
      },
      {
        id: 'gemini-1.5-pro',
        name: 'Google Gemini 1.5 Pro (Suggested)',
        provider: 'gemini',
        providerName: 'Google Gemini',
        contextWindow: 2097152,
        streaming: true,
        tools: true,
        vision: true,
        reasoning: false
      },
      {
        id: 'gemini-2.0-flash-thinking-exp',
        name: 'Google Gemini 2.0 Flash Thinking (Suggested)',
        provider: 'gemini',
        providerName: 'Google Gemini',
        contextWindow: 1048576,
        streaming: true,
        tools: true,
        vision: true,
        reasoning: true
      },
      // OpenAI
      {
        id: 'gpt-4o',
        name: 'OpenAI GPT-4o (Suggested)',
        provider: 'openai',
        providerName: 'OpenAI API',
        contextWindow: 128000,
        streaming: true,
        tools: true,
        vision: true,
        reasoning: false
      },
      {
        id: 'gpt-4o-mini',
        name: 'OpenAI GPT-4o Mini (Suggested)',
        provider: 'openai',
        providerName: 'OpenAI API',
        contextWindow: 128000,
        streaming: true,
        tools: true,
        vision: true,
        reasoning: false
      },
      {
        id: 'o3-mini',
        name: 'OpenAI o3-mini (Suggested)',
        provider: 'openai',
        providerName: 'OpenAI API',
        contextWindow: 200000,
        streaming: true,
        tools: true,
        vision: false,
        reasoning: true
      },
      {
        id: 'o1',
        name: 'OpenAI o1 (Suggested)',
        provider: 'openai',
        providerName: 'OpenAI API',
        contextWindow: 200000,
        streaming: true,
        tools: true,
        vision: true,
        reasoning: true
      },
      // Anthropic Claude
      {
        id: 'claude-3-5-sonnet',
        name: 'Claude 3.5 Sonnet (Suggested)',
        provider: 'anthropic',
        providerName: 'Anthropic Claude',
        contextWindow: 200000,
        streaming: true,
        tools: true,
        vision: true,
        reasoning: false
      },
      {
        id: 'claude-3-5-haiku',
        name: 'Claude 3.5 Haiku (Suggested)',
        provider: 'anthropic',
        providerName: 'Anthropic Claude',
        contextWindow: 200000,
        streaming: true,
        tools: true,
        vision: false,
        reasoning: false
      },
      // DeepSeek
      {
        id: 'deepseek-chat',
        name: 'DeepSeek Chat (Suggested)',
        provider: 'deepseek',
        providerName: 'DeepSeek AI',
        contextWindow: 64000,
        streaming: true,
        tools: true,
        vision: false,
        reasoning: false
      },
      {
        id: 'deepseek-reasoner',
        name: 'DeepSeek Reasoner (Suggested)',
        provider: 'deepseek',
        providerName: 'DeepSeek AI',
        contextWindow: 64000,
        streaming: true,
        tools: true,
        vision: false,
        reasoning: true
      },
      // Local AI
      {
        id: 'local-gguf',
        name: 'Local Ollama / llama.cpp (Suggested)',
        provider: 'local',
        providerName: 'Local GGUF / Ollama',
        contextWindow: 8192,
        streaming: true,
        tools: false,
        vision: false,
        reasoning: false
      }
    ];

    for (const m of bootstrapModels) {
      this.registerBootstrap(m);
    }
  }

  /**
   * Register a static bootstrap entry (provenance: static_bootstrap)
   */
  registerBootstrap(model) {
    if (!model || !model.id) return;
    this.models.set(model.id, {
      ...model,
      source: 'static_bootstrap',
      available: false,
      verified: false,
      discovered: false,
      discoveredAt: null,
      lastValidatedAt: null,
      updatedAt: Date.now()
    });
  }

  /**
   * Authoritative registration from live provider discovery
   * Replaces or updates models for the given provider with verified provenance
   */
  registerDiscovered(provider, discoveredList = []) {
    const now = new Date().toISOString();
    const newModelIds = new Set(discoveredList.map(m => m.id));

    // Remove or decommission previous live models for this provider that disappeared
    for (const [id, m] of this.models.entries()) {
      if (m.provider === provider && m.source === 'provider_discovery') {
        if (!newModelIds.has(id)) {
          // Model disappeared from provider
          this.models.delete(id);
        }
      }
    }

    // Register active live models
    for (const m of discoveredList) {
      this.models.set(m.id, {
        ...m,
        provider,
        source: 'provider_discovery',
        available: true,
        verified: true,
        discovered: true,
        discoveredAt: m.discoveredAt || now,
        lastValidatedAt: now,
        updatedAt: Date.now()
      });
    }
  }

  get(modelId) {
    return this.models.get(modelId) || null;
  }

  /**
   * Returns only live, verified, discovered models (available: true)
   */
  listDiscovered(provider = null) {
    return Array.from(this.models.values()).filter(m => {
      if (m.source !== 'provider_discovery' || !m.available) return false;
      if (provider && m.provider !== provider) return false;
      return true;
    });
  }

  /**
   * Returns all models (including static bootstrap entries)
   */
  listAll() {
    return Array.from(this.models.values());
  }

  /**
   * Filters models by requested capabilities.
   * By default, filters ONLY live discovered models (available: true).
   */
  filterByCapabilities(reqs = {}) {
    const candidateList = reqs.includeBootstrap
      ? this.listAll()
      : this.listDiscovered(reqs.provider);

    return candidateList.filter(m => {
      if (reqs.vision && !m.vision) return false;
      if (reqs.tools && !m.tools) return false;
      if (reqs.reasoning && !m.reasoning) return false;
      if (reqs.streaming && !m.streaming) return false;
      if (reqs.provider && m.provider !== reqs.provider) return false;
      if (reqs.minContext && (m.contextWindow || 0) < reqs.minContext) return false;
      return true;
    });
  }
}

export const modelRegistry = new ModelRegistry();
