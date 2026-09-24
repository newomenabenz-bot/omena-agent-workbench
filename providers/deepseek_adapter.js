/**
 * DeepSeek Provider Adapter
 * Supports deepseek-r1 (reasoning: true)
 */

import { BaseProviderAdapter } from './base_adapter.js';

export class DeepSeekAdapter extends BaseProviderAdapter {
  constructor(modelId = 'deepseek-r1') {
    super(modelId, 'DeepSeek AI', {
      streaming: true,
      tools: true,
      vision: false,
      reasoning: true // Exposes dedicated reasoning/thinking token stream
    });
  }

  formatPayload({ prompt, messages = [], tools = [] }) {
    const formattedMsgs = messages.length > 0 
      ? messages.map(m => ({ role: m.role, content: m.content }))
      : [{ role: 'user', content: prompt }];

    const payload = {
      model: 'deepseek-reasoner',
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

  async streamChat({ prompt, messages = [], tools = [], credentials = {}, emit }) {
    const apiKey = credentials.deepseekKey || process.env.DEEPSEEK_API_KEY;

    if (apiKey) {
      try {
        const endpoint = `https://api.deepseek.com/chat/completions`;
        const payload = this.formatPayload({ prompt, messages, tools });

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`DeepSeek API Error (${res.status}): ${errText}`);
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
              // Handle reasoning_content if present
              const reasoning = parsed.choices?.[0]?.delta?.reasoning_content || '';
              if (reasoning) emit({ type: 'text_chunk', token: `💭 *${reasoning}*` });
              const delta = parsed.choices?.[0]?.delta?.content || '';
              if (delta) emit({ type: 'text_chunk', token: delta });
            } catch {}
          }
        }
        return;
      } catch (err) {
        emit({ type: 'text_chunk', token: `⚠️ *DeepSeek Direct Stream Notice:* ${err.message}\n` });
      }
    }

    emit({ type: 'text_chunk', token: `🧠 *DeepSeek Engine (${this.id})* processing reasoning request...\n\n` });
  }
}
