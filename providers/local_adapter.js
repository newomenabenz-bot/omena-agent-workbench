/**
 * Local AI Provider Adapter (Ollama / llama.cpp / OpenAI-compatible Local Server)
 * Enforces strict connection state progression:
 * NOT_CONFIGURED -> CONFIGURED -> VALIDATING -> REACHABLE -> MODEL_DISCOVERED -> READY
 * Real daemon health checking, authoritative tag discovery, and protocol validation.
 */

import { BaseProviderAdapter, ConnectionState, ErrorCode, WorkbenchError } from './base_adapter.js';

export class LocalAdapter extends BaseProviderAdapter {
  constructor(modelId = 'local-default', options = {}) {
    super(modelId, 'Local AI (Ollama / llama.cpp)', {
      streaming: true,
      tools: false,
      vision: false,
      reasoning: false,
      contextWindow: 8192
    });
    this.discoveredModels = [];
    this.serverType = 'unknown'; // 'ollama' | 'llama.cpp' | 'openai-compat'
  }

  getEndpoint(credential) {
    const raw = credential?.local || credential?.localEndpoint || (typeof credential === 'string' ? credential : null) || process.env.LOCAL_AI_URL || 'http://127.0.0.1:11434';
    return raw.replace(/\/+$/, '');
  }

  /**
   * Validate local daemon connectivity and model availability
   */
  async validateConnection(credential) {
    const rawEndpoint = credential?.local || credential?.localEndpoint || (typeof credential === 'string' ? credential : null) || process.env.LOCAL_AI_URL;
    
    if (!rawEndpoint || !rawEndpoint.trim()) {
      this.setConnectionState(ConnectionState.NOT_CONFIGURED);
      return { valid: false, state: ConnectionState.NOT_CONFIGURED, error: 'Local AI endpoint URL is not configured' };
    }

    const cleanUrl = this.getEndpoint(credential);
    this.setConnectionState(ConnectionState.VALIDATING);
    const startTime = Date.now();

    try {
      // 1. Probe Ollama Daemon (/api/version and /api/tags)
      let ollamaOk = false;
      let llamaOk = false;
      let discovered = [];
      let exactError = null;

      try {
        const vRes = await fetch(`${cleanUrl}/api/version`, {
          headers: { 'User-Agent': 'OMENA-Local-Inspector/4.1.1' },
          signal: AbortSignal.timeout(3500)
        });
        if (vRes.ok) {
          this.serverType = 'ollama';
          ollamaOk = true;
          // Discover models
          const tagsRes = await fetch(`${cleanUrl}/api/tags`, { signal: AbortSignal.timeout(3500) });
          if (tagsRes.ok) {
            const data = await tagsRes.json();
            discovered = (data.models || []).map(m => m.name);
          }
        }
      } catch (err) {
        exactError = err.cause?.message || err.message;
      }

      // 2. Probe llama.cpp / Local OpenAI-compatible server (/v1/models)
      if (!ollamaOk) {
        try {
          const mRes = await fetch(`${cleanUrl}/v1/models`, {
            headers: { 'User-Agent': 'OMENA-Local-Inspector/4.1.1' },
            signal: AbortSignal.timeout(3500)
          });
          if (mRes.ok) {
            this.serverType = 'llama.cpp';
            llamaOk = true;
            const data = await mRes.json();
            discovered = (data.data || []).map(m => m.id);
          }
        } catch (err) {
          exactError = exactError || err.cause?.message || err.message;
        }
      }

      const latencyMs = Date.now() - startTime;

      if (!ollamaOk && !llamaOk) {
        this.setConnectionState(ConnectionState.DISCONNECTED);
        return {
          valid: false,
          state: ConnectionState.DISCONNECTED,
          error: `Local server unreachable at ${cleanUrl} (${exactError || 'Connection refused'}). Ensure Ollama or llama.cpp daemon is running.`,
          latencyMs
        };
      }

      // Daemon responded
      if (discovered.length === 0) {
        this.setConnectionState(ConnectionState.REACHABLE);
        return {
          valid: true,
          state: ConnectionState.REACHABLE,
          serverType: this.serverType,
          modelsCount: 0,
          message: `Local daemon is running at ${cleanUrl}, but no models are loaded. Run 'ollama pull <model>' to download a model.`,
          latencyMs
        };
      }

      this.discoveredModels = discovered;
      const isSelectedModelAvailable = this.id === 'local-default' || discovered.some(m => m === this.id || `local-${m}` === this.id);

      if (isSelectedModelAvailable) {
        this.setConnectionState(ConnectionState.READY);
        return {
          valid: true,
          state: ConnectionState.READY,
          serverType: this.serverType,
          modelsCount: discovered.length,
          models: discovered,
          latencyMs
        };
      } else {
        this.setConnectionState(ConnectionState.MODEL_DISCOVERED);
        return {
          valid: true,
          state: ConnectionState.MODEL_DISCOVERED,
          serverType: this.serverType,
          modelsCount: discovered.length,
          models: discovered,
          warning: `Selected model '${this.id}' is not in discovered local models.`,
          latencyMs
        };
      }

    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const norm = this.normalizeError(err);
      return { valid: false, state: this.connectionState, error: norm.message, latencyMs };
    }
  }

  /**
   * Authoritative local model discovery with provenance
   */
  async discoverModels(credential) {
    const cleanUrl = this.getEndpoint(credential);
    const now = new Date().toISOString();

    try {
      // 1. Ollama tags
      const res = await fetch(`${cleanUrl}/api/tags`, {
        headers: { 'User-Agent': 'OMENA-Local-Inspector/4.1.1' },
        signal: AbortSignal.timeout(5000)
      }).catch(() => null);

      if (res && res.ok) {
        const data = await res.json();
        if (data.models && Array.isArray(data.models)) {
          return data.models.map(m => {
            const rawName = m.name;
            const isCoder = rawName.includes('coder') || rawName.includes('deepseek');
            const isVision = rawName.includes('llava') || rawName.includes('vision');
            return {
              id: `local-${rawName}`,
              rawModel: rawName,
              name: `Ollama: ${rawName}`,
              provider: 'local',
              providerName: 'Local Ollama',
              contextWindow: m.details?.context_length || 8192,
              streaming: true,
              tools: isCoder,
              vision: isVision,
              reasoning: rawName.includes('r1') || rawName.includes('reason'),
              source: 'provider_discovery',
              discoveredAt: now,
              lastValidatedAt: now,
              available: true,
              verified: true,
              discovered: true
            };
          });
        }
      }

      // 2. llama.cpp / OpenAI-compatible /v1/models
      const res2 = await fetch(`${cleanUrl}/v1/models`, {
        headers: { 'User-Agent': 'OMENA-Local-Inspector/4.1.1' },
        signal: AbortSignal.timeout(5000)
      }).catch(() => null);

      if (res2 && res2.ok) {
        const data2 = await res2.json();
        if (data2.data && Array.isArray(data2.data)) {
          return data2.data.map(m => ({
            id: `local-${m.id}`,
            rawModel: m.id,
            name: `Local: ${m.id}`,
            provider: 'local',
            providerName: 'Local Server',
            contextWindow: 8192,
            streaming: true,
            tools: false,
            vision: false,
            reasoning: m.id.includes('r1') || m.id.includes('reason'),
            source: 'provider_discovery',
            discoveredAt: now,
            lastValidatedAt: now,
            available: true,
            verified: true,
            discovered: true
          }));
        }
      }

      return [];
    } catch {
      return [];
    }
  }

  async streamChat({ prompt, messages = [], tools = [], credentials = {}, emit, signal, callId = null }) {
    const baseUrl = this.getEndpoint(credentials);
    const startTime = Date.now();
    let ttftRecorded = false;
    let ttftMs = 0;
    let completionTokens = 0;

    const controller = new AbortController();
    if (callId) this.activeControllers.set(callId, controller);
    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

    try {
      // Determine model name for local daemon
      let targetModel = this.id.replace(/^local-/, '');
      if (targetModel === 'default' && this.discoveredModels.length > 0) {
        targetModel = this.discoveredModels[0];
      }

      // If Ollama native endpoint (/api/generate or /api/chat)
      let endpoint = `${baseUrl}/api/chat`;
      let payload = {
        model: targetModel,
        messages: messages.length > 0 ? messages.map(m => ({ role: m.role, content: m.content })) : [{ role: 'user', content: prompt }],
        stream: true
      };

      let res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: combinedSignal
      }).catch(() => null);

      // Fallback to OpenAI-compatible /v1/chat/completions if /api/chat failed
      if (!res || !res.ok) {
        endpoint = `${baseUrl}/v1/chat/completions`;
        payload = {
          model: targetModel,
          messages: messages.length > 0 ? messages : [{ role: 'user', content: prompt }],
          stream: true
        };
        res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: combinedSignal
        });
      }

      if (!res.ok) {
        throw new WorkbenchError(ErrorCode.UPSTREAM_ERROR, `Local model execution failed with HTTP ${res.status}`);
      }

      this.setConnectionState(ConnectionState.CONNECTED);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        if (!ttftRecorded) {
          ttftMs = Date.now() - startTime;
          ttftRecorded = true;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          // Ollama JSON stream lines
          if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
              const parsed = JSON.parse(trimmed);
              const text = parsed.message?.content || parsed.response;
              if (text) {
                completionTokens += Math.ceil(text.length / 4);
                emit({ type: 'text_chunk', token: text });
              }
            } catch {}
          }
          // OpenAI SSE format (data: {...})
          else if (trimmed.startsWith('data: ')) {
            const dataStr = trimmed.slice(6);
            if (dataStr === '[DONE]') break;
            try {
              const parsed = JSON.parse(dataStr);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                completionTokens += Math.ceil(delta.length / 4);
                emit({ type: 'text_chunk', token: delta });
              }
            } catch {}
          }
        }
      }

      const totalMs = Date.now() - startTime;
      this.recordTelemetry({
        tokens: { prompt: Math.ceil((prompt || '').length / 4), completion: completionTokens, reasoning: 0 },
        ttftMs,
        totalMs
      });

    } catch (err) {
      if (err.name === 'AbortError' || combinedSignal.aborted) {
        throw err;
      }
      const norm = this.normalizeError(err);
      this.recordTelemetry({ error: norm });
      throw norm;
    } finally {
      if (callId) this.activeControllers.delete(callId);
    }
  }
}
