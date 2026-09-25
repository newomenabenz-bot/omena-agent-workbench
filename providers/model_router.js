/**
 * OMENA Model Router & Fallback Chain Manager v4.1.0
 * Handles priority routing, capability selection, explicit fallback chains,
 * and logged provider transitions.
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
    // Configured fallback chains for common models
    this.fallbackChains.set('gemini-2.0-flash', ['gpt-4o', 'claude-3-5-sonnet', 'local-gguf']);
    this.fallbackChains.set('gpt-4o', ['gemini-2.0-flash', 'claude-3-5-sonnet', 'local-gguf']);
    this.fallbackChains.set('claude-3-5-sonnet', ['gemini-2.0-flash', 'gpt-4o', 'local-gguf']);
    this.fallbackChains.set('deepseek-r1', ['o3-mini', 'gemini-2.0-flash-thinking-exp', 'deepseek-chat']);
    this.fallbackChains.set('o3-mini', ['deepseek-reasoner', 'gemini-2.0-flash-thinking-exp']);
  }

  setFallbackChain(modelId, chain = []) {
    this.fallbackChains.set(modelId, chain);
  }

  getFallbackChain(modelId) {
    return this.fallbackChains.get(modelId) || [];
  }

  logTransition(fromModel, toModel, reason, details = {}) {
    const entry = {
      fromModel,
      toModel,
      reason,
      details,
      timestamp: Date.now()
    };
    this.transitionLogs.push(entry);
    if (this.transitionLogs.length > 100) {
      this.transitionLogs.shift();
    }
    return entry;
  }

  getTransitionLogs() {
    return [...this.transitionLogs];
  }

  /**
   * Route request to primary adapter or fallback chain
   */
  async executeWithRouting({ model, prompt, messages, tools, credentials, emit, signal }) {
    const attemptedModels = [];
    const chain = [model, ...(this.getFallbackChain(model))];

    let lastError = null;

    for (let i = 0; i < chain.length; i++) {
      const candidateModel = chain[i];
      attemptedModels.push(candidateModel);

      const adapter = this.adapterManager.getAdapter(candidateModel);
      if (!adapter) continue;

      if (i > 0) {
        const transition = this.logTransition(chain[i - 1], candidateModel, 'FALLBACK_TRIGGERED', {
          lastError: lastError?.message,
          attempt: i
        });
        emit({
          type: 'provider.transition',
          from: transition.fromModel,
          to: transition.toModel,
          reason: transition.reason,
          message: `Routing fallback from ${transition.fromModel} to ${transition.toModel}`
        });
      }

      try {
        await adapter.streamChat({
          prompt,
          messages,
          tools,
          credentials,
          emit,
          signal
        });
        return { success: true, modelUsed: candidateModel, attemptedModels };
      } catch (err) {
        lastError = err;
        // If user cancelled, don't fallback
        if (err.name === 'AbortError' || signal?.aborted) {
          throw err;
        }
        // Normalize error and check if we should attempt fallback
        const normalized = adapter.normalizeError(err);
        const retryable = [
          ErrorCode.RATE_LIMITED,
          ErrorCode.PROVIDER_UNAVAILABLE,
          ErrorCode.REQUEST_TIMEOUT,
          ErrorCode.UPSTREAM_ERROR,
          ErrorCode.QUOTA_EXCEEDED
        ].includes(normalized.code);

        if (!retryable || i === chain.length - 1) {
          throw normalized;
        }
      }
    }

    throw lastError || new WorkbenchError(ErrorCode.PROVIDER_UNAVAILABLE, 'All models in routing chain failed');
  }

  /**
   * Capability-based model selector
   */
  selectModelForCapabilities(requirements = {}) {
    const candidates = modelRegistry.filterByCapabilities(requirements);
    if (candidates.length === 0) return null;

    // Sort by priority provider
    candidates.sort((a, b) => {
      const pA = this.defaultPriority.indexOf(a.provider);
      const pB = this.defaultPriority.indexOf(b.provider);
      return (pA === -1 ? 999 : pA) - (pB === -1 ? 999 : pB);
    });

    return candidates[0].id;
  }
}
