/**
 * OpenAI / ChatGPT Provider Adapter - v4.1.0 Contract
 * Supports gpt-4o, gpt-4o-mini, o3-mini, o1
 * Tool calling delta accumulation, reasoning parameter support, and strict connection states.
 */

import { BaseProviderAdapter, ConnectionState, ErrorCode, WorkbenchError } from './base_adapter.js';

export class OpenAIAdapter extends BaseProviderAdapter {
  constructor(modelId = 'gpt-4o') {
    const isReasoning = modelId.startsWith('o1') || modelId.startsWith('o3');
    super(modelId, 'OpenAI ChatGPT', {
      streaming: true,
      tools: true,
      vision: !isReasoning,
      reasoning: isReasoning,
      contextWindow: isReasoning ? 200000 : 128000
    });
    this.baseUrl = 'https://api.openai.com/v1';
  }

  formatPayload({ prompt, messages = [], tools = [] }) {
    const formattedMsgs = messages.length > 0 
      ? messages.map(m => {
          if (m.role === 'tool') {
            return {
              role: 'tool',
              tool_call_id: m.tool_call_id || m.callId || 'call_0',
              content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
            };
          }
          if (m.tool_calls) {
            return {
              role: 'assistant',
              content: m.content || null,
              tool_calls: m.tool_calls
            };
          }
          return { role: m.role, content: m.content };
        })
      : [{ role: 'user', content: prompt }];

    const payload = {
      model: this.id,
      messages: formattedMsgs,
      stream: true
    };

    if (this.capabilities.tools && tools && tools.length > 0) {
      payload.tools = tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description || '',
          parameters: t.parameters || { type: 'object', properties: {} }
        }
      }));
    }

    if (this.capabilities.reasoning) {
      payload.reasoning_effort = 'medium';
    }

    return payload;
  }

  async validateConnection(apiKey) {
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      this.setConnectionState(ConnectionState.NOT_CONFIGURED);
      return { valid: false, state: ConnectionState.NOT_CONFIGURED, error: 'OpenAI API key is required' };
    }

    this.setConnectionState(ConnectionState.VALIDATING);
    const cleanKey = apiKey.trim();
    const startTime = Date.now();

    try {
      const endpoint = `${this.baseUrl}/models`;
      const res = await fetch(endpoint, {
        headers: {
          'Authorization': `Bearer ${cleanKey}`,
          'User-Agent': 'OMENA-Agent-Workbench/4.1.0'
        },
        signal: AbortSignal.timeout(10000)
      });

      const latencyMs = Date.now() - startTime;

      if (res.ok) {
        this.setConnectionState(ConnectionState.CONNECTED);
        return { valid: true, state: ConnectionState.CONNECTED, latencyMs };
      }

      const data = await res.json().catch(() => ({}));
      const msg = data.error?.message || `HTTP ${res.status}: Invalid OpenAI API Key`;
      const normErr = this.normalizeError(new Error(msg), { status: res.status });
      return { valid: false, state: this.connectionState, error: normErr.message, latencyMs };
    } catch (e) {
      const latencyMs = Date.now() - startTime;
      const normErr = this.normalizeError(e);
      return { valid: false, state: this.connectionState, error: normErr.message, latencyMs };
    }
  }

  /**
   * OpenAI Capability Resolver
   * Resolves capabilities dynamically from model ID and architecture patterns
   */
  resolveModelCapabilities(modelId) {
    const isReasoning = modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.includes('reasoning');
    const isVision = modelId.includes('4o') || modelId.includes('4-turbo') || modelId.includes('vision') || (modelId.startsWith('o1') && !modelId.includes('mini'));
    const isTools = !modelId.includes('instruct') && !modelId.startsWith('o1-preview') && !modelId.startsWith('o1-mini');
    const contextWindow = isReasoning ? 200000 : (modelId.includes('4o') ? 128000 : 16384);

    return {
      streaming: true,
      tools: isTools,
      vision: isVision,
      reasoning: isReasoning,
      contextWindow
    };
  }

  async discoverModels(apiKey) {
    const cleanKey = (apiKey || '').trim();
    if (!cleanKey) return [];
    try {
      const endpoint = `${this.baseUrl}/models`;
      const res = await fetch(endpoint, {
        headers: {
          'Authorization': `Bearer ${cleanKey}`,
          'User-Agent': 'OMENA-Agent-Workbench/4.1.1'
        },
        signal: AbortSignal.timeout(12000)
      });
      if (!res.ok) return [];
      const data = await res.json();
      if (!data.data || !Array.isArray(data.data)) return [];

      const nonChatPrefixes = ['text-embedding', 'whisper', 'dall-e', 'tts', 'babbage', 'davinci', 'curie', 'omni-moderation', 'canary'];
      const now = new Date().toISOString();

      return data.data
        .filter(m => !nonChatPrefixes.some(p => m.id.startsWith(p)))
        .map(m => {
          const caps = this.resolveModelCapabilities(m.id);
          return {
            id: m.id,
            name: `OpenAI ${m.id}`,
            provider: 'openai',
            providerName: 'OpenAI API',
            ...caps,
            source: 'provider_discovery',
            discoveredAt: now,
            lastValidatedAt: now,
            available: true,
            verified: true,
            discovered: true
          };
        });
    } catch {
      return [];
    }
  }

  async streamChat({ prompt, messages = [], tools = [], credentials = {}, emit, signal, callId = null }) {
    const apiKey = credentials.openai || credentials.openaiKey || process.env.OPENAI_API_KEY;

    if (!apiKey) {
      this.setConnectionState(ConnectionState.AUTH_REQUIRED);
      throw new WorkbenchError(ErrorCode.AUTH_FAILED, 'OpenAI API key is not configured. Please add it in Settings.');
    }

    const startTime = Date.now();
    let ttftRecorded = false;
    let ttftMs = 0;
    let completionTokens = 0;

    const controller = new AbortController();
    if (callId) this.activeControllers.set(callId, controller);
    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

    try {
      const endpoint = `${this.baseUrl}/chat/completions`;
      const payload = this.formatPayload({ prompt, messages, tools });

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`
        },
        body: JSON.stringify(payload),
        signal: combinedSignal
      });

      if (!res.ok) {
        const errText = await res.text();
        let errMsg = errText;
        try {
          const parsed = JSON.parse(errText);
          if (parsed.error?.message) errMsg = parsed.error.message;
        } catch {}
        throw this.normalizeError(new Error(`OpenAI API Error: ${errMsg}`), { status: res.status });
      }

      this.setConnectionState(ConnectionState.CONNECTED);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const toolCallAccumulators = new Map();

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
            const choice = parsed.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta?.content;
            if (delta) {
              completionTokens += Math.ceil(delta.length / 4);
              emit({ type: 'text_chunk', token: delta });
            }

            const toolDeltas = choice.delta?.tool_calls;
            if (toolDeltas && Array.isArray(toolDeltas)) {
              for (const td of toolDeltas) {
                const idx = td.index ?? 0;
                if (!toolCallAccumulators.has(idx)) {
                  toolCallAccumulators.set(idx, {
                    id: td.id || `call_${Date.now()}_${idx}`,
                    name: td.function?.name || '',
                    arguments: ''
                  });
                }
                const acc = toolCallAccumulators.get(idx);
                if (td.id) acc.id = td.id;
                if (td.function?.name) acc.name = td.function.name;
                if (td.function?.arguments) acc.arguments += td.function.arguments;
              }
            }
          } catch {}
        }
      }

      for (const [idx, call] of toolCallAccumulators.entries()) {
        let parsedArgs = {};
        try {
          parsedArgs = JSON.parse(call.arguments || '{}');
        } catch {
          parsedArgs = { raw: call.arguments };
        }
        emit({
          type: 'tool_call',
          call: {
            id: call.id,
            name: call.name,
            arguments: parsedArgs
          }
        });
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
