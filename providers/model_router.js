/**
 * OMENA Model Router & Fallback Chain Manager v4.1.1
 * Dynamically constructs candidates from:
 * configured credentials + live provider health + live discovered models + required capabilities
 * Enforces explicit, auditable provider transitions with zero silent switching.
 */

import { modelRegistry } from './model_registry.js';
import { ConnectionState, WorkbenchError, ErrorCode } from './base_adapter.js';

export class ModelRouter {
  constructor(adapterManager) {
    this.adapterManager = adapterManager;
    this.fallbackChains = new Map();
    this.transitionLogs = [];
    this.defaultPriority = ['gemini', 'openai', 'anthropic', 'deepseek', 'local'];

    this.initDefaultFallbackChains();
  }

  initDefaultFallbackChains() {
    this.fallbackChains.set('gemini-2.0-flash', ['gpt-4o', 'claude-3-5-sonnet', 'local-gguf']);
    this.fallbackChains.set('gpt-4o', ['gemini-2.0-flash', 'claude-3-5-sonnet', 'local-gguf']);
    this.fallbackChains.set('claude-3-5-sonnet', ['gemini-2.0-flash', 'gpt-4o', 'local-gguf']);
    this.fallbackChains.set('deepseek-reasoner', ['o3-mini', 'gemini-2.0-flash-thinking-exp']);
    this.fallbackChains.set('o3-mini', ['deepseek-reasoner', 'gemini-2.0-flash-thinking-exp']);
  }

  setFallbackChain(modelId, chain = []) {
    this.fallbackChains.set(modelId, chain);
  }

  getFallbackChain(modelId) {
    return this.fallbackChains.get(modelId) || [];
  }

  logTransition(record) {
    const entry = {
      event: 'provider.transition',
      ...record,
      timestamp: Date.now()
    };
    this.transitionLogs.push(entry);
    if (this.transitionLogs.length > 200) {
      this.transitionLogs.shift();
    }
    return entry;
  }

  getTransitionLogs() {
    return [...this.transitionLogs];
  }

  /**
   * Dynamically constructs eligible live candidate models
   * Based on live health, discovered models, and capability requirements
   */
  findEligibleCandidates({ requirements = {}, credentials = {} }) {
    // 1. Get all live discovered models matching requirements
    const discoveredMatching = modelRegistry.filterByCapabilities({
      ...requirements,
      includeBootstrap: false // STRICT: Live discovered only
    });

    // 2. Filter to providers that have credentials and are in an eligible state
    const eligible = [];
    for (const model of discoveredMatching) {
      const adapter = this.adapterManager.getAdapter(model.id);
      if (!adapter) continue;

      const providerKey = model.provider;
      const hasCred = credentials[providerKey] || credentials[`${providerKey}Key`] || process.env[`${providerKey.toUpperCase()}_API_KEY`] || providerKey === 'local';
      
      const eligibleStates = [
        ConnectionState.CONNECTED,
        ConnectionState.READY,
        ConnectionState.AUTHENTICATED,
        ConnectionState.MODEL_DISCOVERED
      ];

      const isLiveState = eligibleStates.includes(adapter.connectionState);

      if (hasCred && (isLiveState || adapter.connectionState === ConnectionState.VALIDATING || adapter.connectionState === ConnectionState.NOT_CONFIGURED)) {
        eligible.push(model);
      }
    }

    // 3. Sort by priority policy
    eligible.sort((a, b) => {
      const pA = this.defaultPriority.indexOf(a.provider);
      const pB = this.defaultPriority.indexOf(b.provider);
      return (pA === -1 ? 999 : pA) - (pB === -1 ? 999 : pB);
    });

    return eligible;
  }

  /**
   * Capability-based model selector (strictly live discovered)
   */
  selectModelForCapabilities(requirements = {}, credentials = {}) {
    const eligible = this.findEligibleCandidates({ requirements, credentials });
    if (eligible.length === 0) {
      // If no live discovered models exist yet, return null
      return null;
    }
    return eligible[0].id;
  }

  /**
   * Execute with dynamic fallback routing & auditable transition events
   */
  async executeWithRouting({ model, prompt, messages, tools, credentials, emit, signal }) {
    let currentModel = model;
    let currentAdapter = this.adapterManager.getAdapter(currentModel);

    // If adapter not found for model ID, try to find an eligible model
    if (!currentAdapter) {
      const requiredCaps = {
        tools: Boolean(tools && tools.length > 0)
      };
      const candidateId = this.selectModelForCapabilities(requiredCaps, credentials);
      if (candidateId) {
        currentModel = candidateId;
        currentAdapter = this.adapterManager.getAdapter(currentModel);
      }
    }

    if (!currentAdapter) {
      throw new WorkbenchError(ErrorCode.MODEL_NOT_FOUND, `No provider adapter found for requested model '${model}'`);
    }

    const attemptedModels = [currentModel];
    let lastError = null;

    // Retry loop with explicit transition logging
    const maxAttempts = 3;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await currentAdapter.streamChat({
          prompt,
          messages,
          tools,
          credentials,
          emit,
          signal
        });
        return { success: true, modelUsed: currentModel, attemptedModels };
      } catch (err) {
        lastError = err;

        if (err.name === 'AbortError' || signal?.aborted) {
          throw err;
        }

        const normalized = currentAdapter.normalizeError(err);
        const retryable = [
          ErrorCode.RATE_LIMITED,
          ErrorCode.PROVIDER_UNAVAILABLE,
          ErrorCode.REQUEST_TIMEOUT,
          ErrorCode.UPSTREAM_ERROR,
          ErrorCode.QUOTA_EXCEEDED
        ].includes(normalized.code);

        if (!retryable || attempt === maxAttempts - 1) {
          throw normalized;
        }

        // Determine fallback requirements
        const reqs = {
          tools: Boolean(tools && tools.length > 0)
        };

        // Find candidate models from explicit fallback chain first, then live eligible discovery
        const configuredChain = this.getFallbackChain(currentModel);
        let nextModel = null;

        for (const candidate of configuredChain) {
          if (!attemptedModels.includes(candidate)) {
            const candAdapter = this.adapterManager.getAdapter(candidate);
            if (candAdapter && candAdapter.connectionState !== ConnectionState.AUTH_FAILED && candAdapter.connectionState !== ConnectionState.DISCONNECTED) {
              nextModel = candidate;
              break;
            }
          }
        }

        // If configured chain exhausted, discover eligible live candidates
        if (!nextModel) {
          const liveEligible = this.findEligibleCandidates({ requirements: reqs, credentials });
          for (const cand of liveEligible) {
            if (!attemptedModels.includes(cand.id)) {
              nextModel = cand.id;
              break;
            }
          }
        }

        if (!nextModel) {
          throw normalized;
        }

        const nextAdapter = this.adapterManager.getAdapter(nextModel);
        if (!nextAdapter) {
          throw normalized;
        }

        // Log and emit auditable transition event
        const transitionRecord = {
          event: 'provider.transition',
          fromProvider: currentAdapter.name,
          fromModel: currentModel,
          toProvider: nextAdapter.name,
          toModel: nextModel,
          reason: normalized.code,
          policy: configuredChain.includes(nextModel) ? 'configured-fallback-chain' : 'live-eligible-fallback'
        };

        this.logTransition(transitionRecord);

        emit({
          type: 'provider.transition',
          ...transitionRecord,
          message: `Provider fallback: Switched from ${currentAdapter.name} (${currentModel}) to ${nextAdapter.name} (${nextModel}) due to ${normalized.code}`
        });

        currentModel = nextModel;
        currentAdapter = nextAdapter;
        attemptedModels.push(currentModel);
      }
    }

    throw lastError || new WorkbenchError(ErrorCode.PROVIDER_UNAVAILABLE, 'Routing fallback chain exhausted without successful completion');
  }
}
