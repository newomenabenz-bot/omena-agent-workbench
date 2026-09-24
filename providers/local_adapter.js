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
