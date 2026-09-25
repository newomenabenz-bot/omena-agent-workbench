/**
 * Google Gemini Provider Adapter - v4.1.0 Contract
 * Supports gemini-2.0-flash, gemini-1.5-pro, gemini-2.0-flash-thinking-exp
 * Native function calling, multimodal input, granular connection states, and telemetry.
 */

import { BaseProviderAdapter, ConnectionState, ErrorCode, WorkbenchError } from './base_adapter.js';

export class GeminiAdapter extends BaseProviderAdapter {
  constructor(modelId = 'gemini-2.0-flash') {
    const isReasoning = modelId.includes('thinking');
    super(modelId, 'Google Gemini', {
      streaming: true,
      tools: true,
      vision: true,
      reasoning: isReasoning,
      contextWindow: modelId.includes('1.5-pro') ? 2097152 : 1048576
    });
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
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

    if (tools && tools.length > 0) {
      payload.tools = tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description || '',
          parameters: t.parameters || { type: 'object', properties: {} }
        }
      }));
    }

    return payload;
  }

  /**
   * Validate Gemini API key against Google endpoint
   */
  async validateConnection(apiKey) {
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      this.setConnectionState(ConnectionState.NOT_CONFIGURED);
      return { valid: false, state: ConnectionState.NOT_CONFIGURED, error: 'Gemini API key is required' };
    }

    this.setConnectionState(ConnectionState.VALIDATING);
    const cleanKey = apiKey.trim();
    const startTime = Date.now();

    try {
      const endpoint = `${this.baseUrl}/models?key=${cleanKey}`;
      const res = await fetch(endpoint, {
        headers: { 'User-Agent': 'OMENA-Agent-Workbench/4.1.0' },
        signal: AbortSignal.timeout(10000)
      });

      const latencyMs = Date.now() - startTime;

      if (res.ok) {
        this.setConnectionState(ConnectionState.CONNECTED);
        return { valid: true, state: ConnectionState.CONNECTED, latencyMs };
      }

      const data = await res.json().catch(() => ({}));
      const msg = data.error?.message || `HTTP ${res.status}: Invalid Gemini API Key`;
      const normErr = this.normalizeError(new Error(msg), { status: res.status });
      return { valid: false, state: this.connectionState, error: normErr.message, latencyMs };
    } catch (e) {
      const latencyMs = Date.now() - startTime;
      const normErr = this.normalizeError(e);
      return { valid: false, state: this.connectionState, error: normErr.message, latencyMs };
    }
  }

  /**
   * Dynamically discover Gemini models available to this API key
   */
  async discoverModels(apiKey) {
    const cleanKey = (apiKey || '').trim();
    if (!cleanKey) return [];
    try {
      const endpoint = `${this.baseUrl}/models?key=${cleanKey}`;
      const res = await fetch(endpoint, {
        headers: { 'User-Agent': 'OMENA-Agent-Workbench/4.1.0' },
        signal: AbortSignal.timeout(12000)
      });
      if (!res.ok) return [];
      const data = await res.json();
      if (!data.models || !Array.isArray(data.models)) return [];

      return data.models
        .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
        .map(m => {
          const cleanId = m.name.replace(/^models\//, '');
          const isReasoning = cleanId.includes('thinking');
          return {
            id: cleanId,
            name: m.displayName || cleanId,
            provider: 'gemini',
            providerName: 'Google Gemini',
            streaming: true,
            tools: true,
            vision: true,
            reasoning: isReasoning,
            contextWindow: m.inputTokenLimit || 1048576,
            discovered: true
          };
        });
    } catch {
      return [];
    }
  }

  async streamChat({ prompt, messages = [], tools = [], credentials = {}, emit, signal, callId = null }) {
    const apiKey = credentials.gemini || credentials.geminiKey || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      this.setConnectionState(ConnectionState.AUTH_REQUIRED);
      throw new WorkbenchError(ErrorCode.AUTH_FAILED, 'Gemini API key is not configured. Please add it in Settings.');
    }

    const startTime = Date.now();
    let ttftRecorded = false;
    let ttftMs = 0;
    let completionTokens = 0;

    const controller = new AbortController();
    if (callId) this.activeControllers.set(callId, controller);
    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

    try {
      const endpoint = `${this.baseUrl}/openai/chat/completions`;
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
        throw this.normalizeError(new Error(`Gemini API Error: ${errMsg}`), { status: res.status });
      }

      this.setConnectionState(ConnectionState.CONNECTED);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      // Accumulator for tool calls
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

            // Stream text chunk
            const delta = choice.delta?.content;
            if (delta) {
              completionTokens += Math.ceil(delta.length / 4);
              emit({ type: 'text_chunk', token: delta });
            }

            // Stream tool calls
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

      // Finalize any accumulated tool calls
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
