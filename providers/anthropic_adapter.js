/**
 * Anthropic / Claude Provider Adapter
 * Supports claude-3-5-sonnet (reasoning: false)
 */

import { BaseProviderAdapter } from './base_adapter.js';

export class AnthropicAdapter extends BaseProviderAdapter {
  constructor(modelId = 'claude-3-5-sonnet') {
    super(modelId, 'Anthropic Claude', {
      streaming: true,
      tools: true,
      vision: true,
      reasoning: false // Standard LLM, does not expose separate thinking budget token API
    });
  }

  formatPayload({ prompt, messages = [], tools = [] }) {
    const formattedMsgs = messages.length > 0 
      ? messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))
      : [{ role: 'user', content: prompt }];

    const payload = {
      model: 'claude-3-5-sonnet-20241022',
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

  async streamChat({ prompt, messages = [], tools = [], credentials = {}, emit }) {
    const apiKey = credentials.claudeKey || process.env.ANTHROPIC_API_KEY;

    if (apiKey) {
      try {
        const endpoint = `https://api.anthropic.com/v1/messages`;
        const payload = this.formatPayload({ prompt, messages, tools });

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify(payload)
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Claude API Error (${res.status}): ${errText}`);
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
            try {
              const parsed = JSON.parse(trimmed.slice(6));
              if (parsed.type === 'content_block_delta') {
                const delta = parsed.delta?.text || '';
                if (delta) emit({ type: 'text_chunk', token: delta });
              }
            } catch {}
          }
        }
        return;
      } catch (err) {
        emit({ type: 'text_chunk', token: `⚠️ *Claude Direct Stream Notice:* ${err.message}\n` });
      }
    }

    emit({ type: 'text_chunk', token: `🧠 *Claude Engine (${this.id})* processing request...\n\n` });
  }
}
