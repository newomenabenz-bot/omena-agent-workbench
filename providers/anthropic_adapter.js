/**
 * Anthropic / Claude Provider Adapter - v4.1.0 Contract
 * Supports claude-3-5-sonnet, claude-3-5-haiku, claude-3-opus
 * Native Claude Messages streaming, tool use block parsing, and strict connection states.
 */

import { BaseProviderAdapter, ConnectionState, ErrorCode, WorkbenchError } from './base_adapter.js';

export class AnthropicAdapter extends BaseProviderAdapter {
  constructor(modelId = 'claude-3-5-sonnet') {
    super(modelId, 'Anthropic Claude', {
      streaming: true,
      tools: true,
      vision: modelId.includes('sonnet') || modelId.includes('opus'),
      reasoning: false,
      contextWindow: 200000
    });
    this.baseUrl = 'https://api.anthropic.com/v1';
  }

  formatPayload({ prompt, messages = [], tools = [] }) {
    const formattedMsgs = [];

    if (messages.length > 0) {
      for (const m of messages) {
        if (m.role === 'tool') {
          formattedMsgs.push({
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: m.tool_call_id || m.callId || 'call_0',
                content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
              }
            ]
          });
        } else if (m.tool_calls) {
          formattedMsgs.push({
            role: 'assistant',
            content: m.tool_calls.map(tc => ({
              type: 'tool_use',
              id: tc.id,
              name: tc.name || tc.function?.name,
              input: typeof tc.arguments === 'string' ? JSON.parse(tc.arguments || '{}') : (tc.arguments || {})
            }))
          });
        } else {
          formattedMsgs.push({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content
          });
        }
      }
    } else {
      formattedMsgs.push({ role: 'user', content: prompt });
    }

    const payload = {
      model: this.id || 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      messages: formattedMsgs,
      stream: true
    };

    if (tools && tools.length > 0) {
      payload.tools = tools.map(t => ({
        name: t.name,
        description: t.description || '',
        input_schema: t.parameters || { type: 'object', properties: {} }
      }));
    }

    return payload;
  }

  async validateConnection(credential) {
    const key = credential?.anthropic || credential?.claudeKey || credential?.apiKey || (typeof credential === 'string' ? credential : null) || process.env.ANTHROPIC_API_KEY;
    if (!key || typeof key !== 'string' || key.trim().length === 0) {
      this.setConnectionState(ConnectionState.NOT_CONFIGURED);
      return { valid: false, state: ConnectionState.NOT_CONFIGURED, error: 'Anthropic API key is required' };
    }

    this.setConnectionState(ConnectionState.VALIDATING);
    const cleanKey = key.trim();
    const startTime = Date.now();

    try {
      const endpoint = `${this.baseUrl}/models?limit=5`;
      const res = await fetch(endpoint, {
        headers: {
          'x-api-key': cleanKey,
          'anthropic-version': '2023-06-01',
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
      const msg = data.error?.message || `HTTP ${res.status}: ${res.statusText}`;
      const normErr = this.normalizeError(new Error(msg), { status: res.status });
      return { valid: false, state: this.connectionState, error: normErr.message, latencyMs };
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      const normErr = this.normalizeError(err);
      return { valid: false, state: this.connectionState, error: normErr.message, latencyMs };
    }
  }

  async discoverModels(credential) {
    const key = credential?.anthropic || credential?.claudeKey || credential?.apiKey || (typeof credential === 'string' ? credential : null) || process.env.ANTHROPIC_API_KEY;
    const staticList = [
      {
        id: 'claude-3-5-sonnet',
        name: 'Claude 3.5 Sonnet',
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
        name: 'Claude 3.5 Haiku',
        provider: 'anthropic',
        providerName: 'Anthropic Claude',
        contextWindow: 200000,
        streaming: true,
        tools: true,
        vision: false,
        reasoning: false
      }
    ];

    if (!key) return staticList;

    try {
      const endpoint = `${this.baseUrl}/models?limit=50`;
      const res = await fetch(endpoint, {
        headers: {
          'x-api-key': key.trim(),
          'anthropic-version': '2023-06-01',
          'User-Agent': 'OMENA-Agent-Workbench/4.1.0'
        },
        signal: AbortSignal.timeout(12000)
      });
      if (!res.ok) return staticList;
      const data = await res.json();
      if (!data.data || !Array.isArray(data.data)) return staticList;

      return data.data.map(m => ({
        id: m.id,
        name: m.display_name || m.id,
        provider: 'anthropic',
        providerName: 'Anthropic Claude',
        contextWindow: 200000,
        streaming: true,
        tools: true,
        vision: m.id.includes('sonnet') || m.id.includes('opus'),
        reasoning: false,
        discovered: true
      }));
    } catch {
      return staticList;
    }
  }

  async streamChat({ prompt, messages = [], tools = [], credentials = {}, emit, signal, callId = null }) {
    const apiKey = credentials.anthropic || credentials.claudeKey || credentials.apiKey || process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      this.setConnectionState(ConnectionState.AUTH_REQUIRED);
      throw new WorkbenchError(ErrorCode.AUTH_FAILED, 'Anthropic API key is not configured. Please add it in Settings.');
    }

    const startTime = Date.now();
    let ttftRecorded = false;
    let ttftMs = 0;
    let completionTokens = 0;

    const controller = new AbortController();
    if (callId) this.activeControllers.set(callId, controller);
    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

    try {
      const endpoint = `${this.baseUrl}/messages`;
      const payload = this.formatPayload({ prompt, messages, tools });

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey.trim(),
          'anthropic-version': '2023-06-01'
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
        throw this.normalizeError(new Error(`Claude API Error: ${errMsg}`), { status: res.status });
      }

      this.setConnectionState(ConnectionState.CONNECTED);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      let currentToolUse = null;

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
          try {
            const parsed = JSON.parse(trimmed.slice(6));
            if (parsed.type === 'content_block_start') {
              if (parsed.content_block?.type === 'tool_use') {
                currentToolUse = {
                  id: parsed.content_block.id || `call_${Date.now()}`,
                  name: parsed.content_block.name,
                  jsonBuf: ''
                };
              }
            } else if (parsed.type === 'content_block_delta') {
              if (parsed.delta?.type === 'text_delta') {
                const delta = parsed.delta.text || '';
                completionTokens += Math.ceil(delta.length / 4);
                emit({ type: 'text_chunk', token: delta });
              } else if (parsed.delta?.type === 'input_json_delta' && currentToolUse) {
                currentToolUse.jsonBuf += parsed.delta.partial_json || '';
              }
            } else if (parsed.type === 'content_block_stop') {
              if (currentToolUse) {
                let parsedArgs = {};
                try {
                  parsedArgs = JSON.parse(currentToolUse.jsonBuf || '{}');
                } catch {
                  parsedArgs = { raw: currentToolUse.jsonBuf };
                }
                emit({
                  type: 'tool_call',
                  call: {
                    id: currentToolUse.id,
                    name: currentToolUse.name,
                    arguments: parsedArgs
                  }
                });
                currentToolUse = null;
              }
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
