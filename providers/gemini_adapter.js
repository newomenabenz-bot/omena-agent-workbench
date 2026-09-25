/**
 * Google Gemini Provider Adapter - v4.1.1 Native & OpenAI-Compatible Implementation
 * Implements two explicitly separated protocols:
 * 1. gemini-native (DEFAULT): Uses actual Gemini generateContent/streamGenerateContent semantics:
 *    - native contents/parts
 *    - native systemInstruction
 *    - native functionDeclarations
 *    - native functionCall & functionResponse
 *    - native multimodal inlineData
 *    - native usageMetadata & thinkingConfig
 * 2. gemini-openai-compatible: Retained as explicit secondary protocol (/openai/chat/completions)
 */

import { BaseProviderAdapter, ConnectionState, ErrorCode, WorkbenchError } from './base_adapter.js';

export class GeminiAdapter extends BaseProviderAdapter {
  constructor(modelId = 'gemini-2.0-flash', options = {}) {
    const isReasoning = modelId.includes('thinking');
    super(modelId, 'Google Gemini', {
      streaming: true,
      tools: true,
      vision: true,
      reasoning: isReasoning,
      contextWindow: modelId.includes('1.5-pro') ? 2097152 : 1048576
    });
    this.baseUrl = (options.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
    // Protocol selection: 'gemini-native' (default) vs 'gemini-openai-compatible'
    this.protocol = options.protocol || 'gemini-native';
  }

  /**
   * Format payload according to selected protocol
   */
  formatPayload({ prompt, messages = [], tools = [] }) {
    if (this.protocol === 'gemini-openai-compatible') {
      return this.formatOpenAIPayload({ prompt, messages, tools });
    }
    return this.formatNativePayload({ prompt, messages, tools });
  }

  /**
   * 1. NATIVE GEMINI PROTOCOL FORMATTER
   */
  formatNativePayload({ prompt, messages = [], tools = [] }) {
    let systemInstruction = null;
    const contents = [];

    // If explicit messages provided
    if (messages && messages.length > 0) {
      for (const m of messages) {
        if (m.role === 'system') {
          systemInstruction = {
            parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }]
          };
          continue;
        }

        if (m.role === 'tool') {
          // In native Gemini, tool responses are user parts containing functionResponse
          contents.push({
            role: 'user',
            parts: [
              {
                functionResponse: {
                  name: m.name || m.tool_name || 'tool',
                  response: {
                    content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
                  }
                }
              }
            ]
          });
          continue;
        }

        if (m.role === 'assistant' || m.role === 'model') {
          const parts = [];
          if (m.content) {
            parts.push({ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) });
          }
          if (m.tool_calls && Array.isArray(m.tool_calls)) {
            for (const tc of m.tool_calls) {
              const fn = tc.function || tc;
              let parsedArgs = fn.arguments;
              if (typeof parsedArgs === 'string') {
                try { parsedArgs = JSON.parse(parsedArgs); } catch { parsedArgs = { raw: parsedArgs }; }
              }
              parts.push({
                functionCall: {
                  name: fn.name,
                  args: parsedArgs || {}
                }
              });
            }
          }
          if (parts.length > 0) {
            contents.push({ role: 'model', parts });
          }
          continue;
        }

        // User role
        const parts = [];
        if (typeof m.content === 'string') {
          parts.push({ text: m.content });
        } else if (Array.isArray(m.content)) {
          for (const part of m.content) {
            if (part.type === 'text') {
              parts.push({ text: part.text });
            } else if (part.type === 'image_url' && part.image_url?.url) {
              const url = part.image_url.url;
              if (url.startsWith('data:')) {
                const match = url.match(/^data:([^;]+);base64,(.+)$/);
                if (match) {
                  parts.push({
                    inlineData: {
                      mimeType: match[1],
                      data: match[2]
                    }
                  });
                }
              }
            }
          }
        } else if (m.content) {
          parts.push({ text: JSON.stringify(m.content) });
        }

        if (parts.length > 0) {
          contents.push({ role: 'user', parts });
        }
      }
    } else if (prompt) {
      contents.push({
        role: 'user',
        parts: [{ text: prompt }]
      });
    }

    const payload = {
      contents: contents.length > 0 ? contents : [{ role: 'user', parts: [{ text: '' }] }]
    };

    if (systemInstruction) {
      payload.systemInstruction = systemInstruction;
    }

    // Native Function Declarations
    if (tools && tools.length > 0) {
      payload.tools = [
        {
          functionDeclarations: tools.map(t => ({
            name: t.name,
            description: t.description || '',
            parameters: t.parameters || { type: 'object', properties: {} }
          }))
        }
      ];
    }

    // Generation & Thinking Config
    payload.generationConfig = {
      temperature: 0.7,
      maxOutputTokens: 8192
    };

    if (this.capabilities.reasoning || this.id.includes('thinking')) {
      payload.generationConfig.thinkingConfig = {
        thinkingBudget: 2048
      };
    }

    return payload;
  }

  /**
   * 2. OPENAI-COMPATIBLE FORMATTER (gemini-openai-compatible)
   */
  formatOpenAIPayload({ prompt, messages = [], tools = [] }) {
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
   * Real validation against Gemini API
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
        headers: { 'User-Agent': 'OMENA-Agent-Workbench/4.1.1' },
        signal: AbortSignal.timeout(10000)
      });

      const latencyMs = Date.now() - startTime;

      if (res.ok) {
        this.setConnectionState(ConnectionState.AUTHENTICATED);
        return { valid: true, state: ConnectionState.AUTHENTICATED, latencyMs };
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
   * Authoritative dynamic model discovery with provenance
   */
  async discoverModels(apiKey) {
    const cleanKey = (apiKey || '').trim();
    if (!cleanKey) return [];

    try {
      const endpoint = `${this.baseUrl}/models?key=${cleanKey}`;
      const res = await fetch(endpoint, {
        headers: { 'User-Agent': 'OMENA-Agent-Workbench/4.1.1' },
        signal: AbortSignal.timeout(12000)
      });
      if (!res.ok) return [];
      const data = await res.json();
      if (!data.models || !Array.isArray(data.models)) return [];

      const now = new Date().toISOString();

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

  /**
   * Main streaming execution
   */
  async streamChat({ prompt, messages = [], tools = [], credentials = {}, emit, signal, callId = null }) {
    const apiKey = credentials.gemini || credentials.geminiKey || process.env.GEMINI_API_KEY;

    if (!apiKey) {
      this.setConnectionState(ConnectionState.AUTH_REQUIRED);
      throw new WorkbenchError(ErrorCode.AUTH_FAILED, 'Gemini API key is not configured. Please add it in Settings.');
    }

    if (this.protocol === 'gemini-openai-compatible') {
      return this.streamChatOpenAICompat({ prompt, messages, tools, apiKey, emit, signal, callId });
    }

    return this.streamChatNative({ prompt, messages, tools, apiKey, emit, signal, callId });
  }

  /**
   * 1. NATIVE GEMINI STREAMING (streamGenerateContent?alt=sse)
   */
  async streamChatNative({ prompt, messages = [], tools = [], apiKey, emit, signal, callId = null }) {
    const startTime = Date.now();
    let ttftRecorded = false;
    let ttftMs = 0;
    let completionTokens = 0;
    let promptTokens = 0;
    let reasoningTokens = 0;

    const controller = new AbortController();
    if (callId) this.activeControllers.set(callId, controller);
    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

    try {
      const modelName = this.id.replace(/^models\//, '');
      const endpoint = `${this.baseUrl}/models/${modelName}:streamGenerateContent?alt=sse&key=${apiKey.trim()}`;
      const payload = this.formatNativePayload({ prompt, messages, tools });

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'OMENA-Agent-Workbench/4.1.1'
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
        throw this.normalizeError(new Error(`Gemini Native Error: ${errMsg}`), { status: res.status });
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

            // Native usage metadata tracking
            if (parsed.usageMetadata) {
              if (parsed.usageMetadata.promptTokenCount) promptTokens = parsed.usageMetadata.promptTokenCount;
              if (parsed.usageMetadata.candidatesTokenCount) completionTokens = parsed.usageMetadata.candidatesTokenCount;
            }

            const candidate = parsed.candidates?.[0];
            if (!candidate || !candidate.content || !candidate.content.parts) continue;

            for (const part of candidate.content.parts) {
              // 1. Thinking / Thought chunk
              if (part.thought === true && part.text) {
                reasoningTokens += Math.ceil(part.text.length / 4);
                emit({ type: 'reasoning_chunk', token: part.text });
              }
              // 2. Normal text chunk
              else if (part.text) {
                completionTokens += Math.ceil(part.text.length / 4);
                emit({ type: 'text_chunk', token: part.text });
              }

              // 3. Native functionCall
              if (part.functionCall) {
                const callId = `call_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
                emit({
                  type: 'tool_call',
                  call: {
                    id: callId,
                    name: part.functionCall.name,
                    arguments: part.functionCall.args || {}
                  }
                });
              }
            }
          } catch {}
        }
      }

      const totalMs = Date.now() - startTime;
      this.recordTelemetry({
        tokens: {
          prompt: promptTokens || Math.ceil((prompt || '').length / 4),
          completion: completionTokens,
          reasoning: reasoningTokens
        },
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

  /**
   * 2. OPENAI-COMPATIBLE STREAMING (/openai/chat/completions)
   */
  async streamChatOpenAICompat({ prompt, messages = [], tools = [], apiKey, emit, signal, callId = null }) {
    const startTime = Date.now();
    let ttftRecorded = false;
    let ttftMs = 0;
    let completionTokens = 0;

    const controller = new AbortController();
    if (callId) this.activeControllers.set(callId, controller);
    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

    try {
      const endpoint = `${this.baseUrl}/openai/chat/completions`;
      const payload = this.formatOpenAIPayload({ prompt, messages, tools });

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
        throw this.normalizeError(new Error(`Gemini OpenAI-Compat Error: ${errMsg}`), { status: res.status });
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
