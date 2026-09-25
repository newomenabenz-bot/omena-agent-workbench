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

  /**
   * Validate OpenAI API key
   */
  async validateCredential(apiKey) {
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      return { valid: false, error: 'OpenAI API key is required' };
    }
    const cleanKey = apiKey.trim();
    try {
      const res = await fetch(`https://api.openai.com/v1/models`, {
        headers: {
          'Authorization': `Bearer ${cleanKey}`,
          'User-Agent': 'OMENA-Agent-Workbench/4.0.1'
        },
        signal: AbortSignal.timeout(10000)
      });
      if (res.ok) {
        return { valid: true };
      }
      const data = await res.json().catch(() => ({}));
      return { valid: false, error: data.error?.message || `HTTP ${res.status}: Invalid OpenAI API Key` };
    } catch (e) {
      return { valid: false, error: `Network error connecting to OpenAI: ${e.message}` };
    }
  }

  /**
   * Dynamically discover OpenAI models available to this credential
   */
  async discoverModels(apiKey) {
    const cleanKey = (apiKey || '').trim();
    if (!cleanKey) return [];
    try {
      const res = await fetch(`https://api.openai.com/v1/models`, {
        headers: {
          'Authorization': `Bearer ${cleanKey}`,
          'User-Agent': 'OMENA-Agent-Workbench/4.0.1'
        },
        signal: AbortSignal.timeout(12000)
      });
      if (!res.ok) return [];
      const data = await res.json();
      if (!data.data || !Array.isArray(data.data)) return [];

      const relevant = ['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini', 'o3-mini', 'gpt-4-turbo'];
      return data.data
        .filter(m => relevant.includes(m.id) || m.id.startsWith('gpt-4o') || m.id.startsWith('o3'))
        .map(m => {
          const isReasoning = m.id.startsWith('o1') || m.id.startsWith('o3');
          return {
            id: m.id,
            name: `OpenAI ${m.id}`,
            provider: 'OpenAI ChatGPT',
            streaming: true,
            tools: true,
            vision: !isReasoning,
            reasoning: isReasoning,
            contextWindow: 128000,
            discovered: true
          };
        });
    } catch {
      return [];
    }
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
        emit({ type: 'text_chunk', token: `⚠️ *OpenAI API Notice:* ${err.message}\nContinuing with autonomous local tool execution...\n\n` });
      }
    } else {
      emit({ type: 'text_chunk', token: `ℹ️ *Autonomous Local Execution:* Model "${this.id}" requested without configured OpenAI API key. Executing via local tool loop...\n\n` });
    }
  }
}
