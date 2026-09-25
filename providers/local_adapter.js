/**
 * Local AI Provider Adapter (Ollama / llama.cpp) - v4.1.0 Contract
 * Validates real daemon connectivity, dynamic model discovery, and streaming.
 */

import { BaseProviderAdapter, ConnectionState, ErrorCode, WorkbenchError } from './base_adapter.js';

export class LocalAdapter extends BaseProviderAdapter {
  constructor(modelId = 'local-gguf') {
    super(modelId, 'Local GGUF / Ollama', {
      streaming: true,
      tools: false,
      vision: false,
      reasoning: false,
      contextWindow: 8192
    });
  }

  getEndpoint(credential) {
    const raw = credential?.local || credential?.localEndpoint || (typeof credential === 'string' ? credential : null) || process.env.LOCAL_AI_URL || 'http://host.docker.internal:11434';
    return raw.replace(/\/+$/, '');
  }

  async validateConnection(credential) {
    const cleanUrl = this.getEndpoint(credential);
    this.setConnectionState(ConnectionState.VALIDATING);
    const startTime = Date.now();

    try {
      // 1. Check Ollama /api/tags
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${cleanUrl}/api/tags`, { signal: controller.signal }).catch(() => null);
      clearTimeout(timeout);

      if (res && res.ok) {
        const latencyMs = Date.now() - startTime;
        this.setConnectionState(ConnectionState.CONNECTED);
        return { valid: true, state: ConnectionState.CONNECTED, latencyMs };
      }

      // 2. Check OpenAI-compatible /v1/models
      const controller2 = new AbortController();
      const timeout2 = setTimeout(() => controller2.abort(), 4000);
      const res2 = await fetch(`${cleanUrl}/v1/models`, { signal: controller2.signal }).catch(() => null);
      clearTimeout(timeout2);

      if (res2 && res2.ok) {
        const latencyMs = Date.now() - startTime;
        this.setConnectionState(ConnectionState.CONNECTED);
        return { valid: true, state: ConnectionState.CONNECTED, latencyMs };
      }

      const latencyMs = Date.now() - startTime;
      this.setConnectionState(ConnectionState.DISCONNECTED);
      return {
        valid: false,
        state: ConnectionState.DISCONNECTED,
        error: `Local endpoint ${cleanUrl} not reachable. Verify Ollama or llama.cpp is running.`,
        latencyMs
      };
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const norm = this.normalizeError(err);
      return { valid: false, state: this.connectionState, error: norm.message, latencyMs };
    }
  }

  async discoverModels(credential) {
    const cleanUrl = this.getEndpoint(credential);
    try {
      const res = await fetch(`${cleanUrl}/api/tags`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (res && res.ok) {
        const data = await res.json();
        if (data.models && Array.isArray(data.models) && data.models.length > 0) {
          return data.models.map(m => ({
            id: `local-${m.name}`,
            name: `Local: ${m.name}`,
            provider: 'local',
            providerName: 'Local GGUF / Ollama',
            contextWindow: 8192,
            streaming: true,
            tools: false,
            vision: false,
            reasoning: false,
            discovered: true
          }));
        }
      }

      const res2 = await fetch(`${cleanUrl}/v1/models`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (res2 && res2.ok) {
        const data2 = await res2.json();
        if (data2.data && Array.isArray(data2.data) && data2.data.length > 0) {
          return data2.data.map(m => ({
            id: `local-${m.id}`,
            name: `Local: ${m.id}`,
            provider: 'local',
            providerName: 'Local GGUF / Ollama',
            contextWindow: 8192,
            streaming: true,
            tools: false,
            vision: false,
            reasoning: false,
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
      const endpoint = `${baseUrl}/v1/chat/completions`;
      const formattedMsgs = messages.length > 0 
        ? messages.map(m => ({ role: m.role, content: m.content }))
        : [{ role: 'user', content: prompt }];

      const targetModel = this.id.replace(/^local-/, '') || 'llama3:latest';

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: targetModel,
          messages: formattedMsgs,
          stream: true
        }),
        signal: combinedSignal
      });

      if (!res.ok) {
        throw this.normalizeError(new Error(`Local endpoint ${endpoint} returned HTTP ${res.status}`), { status: res.status });
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
          if (!trimmed || !trimmed.startsWith('data: ')) continue;
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

      const totalMs = Date.now() - startTime;
      this.recordTelemetry({
        tokens: { prompt: Math.ceil(prompt.length / 4), completion: completionTokens, reasoning: 0 },
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
