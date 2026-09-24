/**
 * OpenAI / ChatGPT Provider Adapter
 * Supports gpt-4o (reasoning: false) and o3-mini (reasoning: true)
 */

import { BaseProviderAdapter } from './base_adapter.js';

export class OpenAIAdapter extends BaseProviderAdapter {
  constructor(modelId = 'gpt-4o') {
    const isReasoningModel = modelId.startsWith('o1') || modelId.startsWith('o3');
    super(modelId, 'OpenAI ChatGPT', {
      streaming: true,
      tools: true,
      vision: !isReasoningModel,
      reasoning: isReasoningModel // True only for dedicated reasoning token API (o1/o3)
    });
  }

  formatPayload({ prompt, messages = [], tools = [] }) {
    const formattedMsgs = messages.length > 0 
      ? messages.map(m => ({ role: m.role, content: m.content }))
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

  async streamChat({ prompt, messages = [], tools = [], credentials = {}, emit }) {
    const apiKey = credentials.openaiKey || process.env.OPENAI_API_KEY;

    if (apiKey) {
      try {
        const endpoint = `https://api.openai.com/v1/chat/completions`;
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
          throw new Error(`OpenAI API Error (${res.status}): ${errText}`);
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
        emit({ type: 'text_chunk', token: `⚠️ *OpenAI Direct Stream Notice:* ${err.message}\n` });
      }
    }

    emit({ type: 'text_chunk', token: `🧠 *OpenAI Engine (${this.id})* processing request...\n\n` });
  }
}
