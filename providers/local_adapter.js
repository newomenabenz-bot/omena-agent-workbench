/**
 * Local AI Provider Adapter (Ollama / llama.cpp)
 * Base URL defaults to http://host.docker.internal:11434/v1 (or LOCAL_AI_URL)
 * Declares capabilities: streaming: true, tools: false, vision: false, reasoning: false
 */

import { BaseProviderAdapter } from './base_adapter.js';

export class LocalAdapter extends BaseProviderAdapter {
  constructor(modelId = 'local-gguf') {
    super(modelId, 'Local GGUF / Ollama', {
      streaming: true,
      tools: false,
      vision: false,
      reasoning: false
    });
  }

  async validateCredential(credential) {
    const endpoint = credential?.localEndpoint || (typeof credential === 'string' ? credential : null) || process.env.LOCAL_AI_URL || 'http://host.docker.internal:11434';
    const cleanUrl = endpoint.replace(/\/+$/, '');

    try {
      // Try Ollama tags endpoint
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 4000);
      const res = await fetch(`${cleanUrl}/api/tags`, { signal: controller.signal }).catch(() => null);
      clearTimeout(timeout);

      if (res && res.ok) {
        return { valid: true };
      }

      // Try OpenAI-compatible /v1/models
      const controller2 = new AbortController();
      const timeout2 = setTimeout(() => controller2.abort(), 4000);
      const res2 = await fetch(`${cleanUrl}/v1/models`, { signal: controller2.signal }).catch(() => null);
      clearTimeout(timeout2);

      if (res2 && res2.ok) {
        return { valid: true };
      }

      return { valid: false, error: `Local endpoint ${cleanUrl} not reachable. Verify Ollama or local LLM server is running.` };
    } catch (err) {
      return { valid: false, error: `Local endpoint error: ${err.message}` };
    }
  }

  async discoverModels(credential) {
    const endpoint = credential?.localEndpoint || (typeof credential === 'string' ? credential : null) || process.env.LOCAL_AI_URL || 'http://host.docker.internal:11434';
    const cleanUrl = endpoint.replace(/\/+$/, '');
    const staticFallback = [
      {
        id: 'local-gguf',
        name: 'Local Ollama / GGUF (Llama 3)',
        provider: 'Local GGUF / Ollama',
        contextWindow: 8192,
        streaming: true,
        tools: false,
        vision: false,
        reasoning: false
      }
    ];

    try {
      const res = await fetch(`${cleanUrl}/api/tags`).catch(() => null);
      if (res && res.ok) {
        const data = await res.json();
        if (data.models && Array.isArray(data.models) && data.models.length > 0) {
          return data.models.map(m => ({
            id: `local-${m.name}`,
            name: `Local: ${m.name}`,
            provider: 'Local GGUF / Ollama',
            contextWindow: 8192,
            streaming: true,
            tools: false,
            vision: false,
            reasoning: false
          }));
        }
      }
      return staticFallback;
    } catch {
      return staticFallback;
    }
  }

  async streamChat({ prompt, messages = [], tools = [], credentials = {}, emit }) {
    const baseUrl = credentials.localEndpoint || process.env.LOCAL_AI_URL || 'http://host.docker.internal:11434/v1';

    try {
      const endpoint = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
      const formattedMsgs = messages.length > 0 
        ? messages.map(m => ({ role: m.role, content: m.content }))
        : [{ role: 'user', content: prompt }];

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'llama3:latest',
          messages: formattedMsgs,
          stream: true
        })
      });

      if (!res.ok) {
        throw new Error(`Local endpoint ${endpoint} returned HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
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
            const delta = parsed.choices?.[0]?.delta?.content || '';
            if (delta) emit({ type: 'text_chunk', token: delta });
          } catch {}
        }
      }
      return;
    } catch (err) {
      emit({ type: 'text_chunk', token: `⚠️ *Local Endpoint Notice:* ${err.message}\nOperating under local fallback execution.\n\n` });
    }
  }
}
