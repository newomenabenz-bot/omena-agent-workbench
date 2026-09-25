/**
 * Google Gemini Provider Adapter
 * Supports gemini-2.0-flash, gemini-1.5-pro
 * Declares capabilities: streaming: true, tools: true, vision: true, reasoning: false
 */

import { BaseProviderAdapter } from './base_adapter.js';

export class GeminiAdapter extends BaseProviderAdapter {
  constructor(modelId = 'gemini-2.0-flash') {
    super(modelId, 'Google Gemini', {
      streaming: true,
      tools: true,
      vision: true,
      reasoning: false // Standard multimodal, does not expose dedicated reasoning token API
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
  async validateCredential(apiKey) {
    if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      return { valid: false, error: 'Gemini API key is required' };
    }
    const cleanKey = apiKey.trim();
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${cleanKey}`, {
        headers: { 'User-Agent': 'OMENA-Agent-Workbench/4.0.1' },
        signal: AbortSignal.timeout(10000)
      });
      if (res.ok) {
        return { valid: true };
      }
      const data = await res.json().catch(() => ({}));
      const msg = data.error?.message || `HTTP ${res.status}: Invalid Gemini API Key`;
      return { valid: false, error: msg };
    } catch (e) {
      return { valid: false, error: `Network error connecting to Google Gemini: ${e.message}` };
    }
  }

  /**
   * Dynamically discover Gemini models available to this API key
   */
  async discoverModels(apiKey) {
    const cleanKey = (apiKey || '').trim();
    if (!cleanKey) return [];
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${cleanKey}`, {
        headers: { 'User-Agent': 'OMENA-Agent-Workbench/4.0.1' },
        signal: AbortSignal.timeout(12000)
      });
      if (!res.ok) return [];
      const data = await res.json();
      if (!data.models || !Array.isArray(data.models)) return [];

      return data.models
        .filter(m => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
        .map(m => {
          const cleanId = m.name.replace(/^models\//, '');
          const isReasoning = cleanId.includes('thinking') || cleanId.includes('2.0-flash-thinking');
          return {
            id: cleanId,
            name: m.displayName || cleanId,
            provider: 'Google Gemini',
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

  async streamChat({ prompt, messages = [], tools = [], credentials = {}, emit }) {
    const apiKey = credentials.geminiKey || process.env.GEMINI_API_KEY;
    
    if (apiKey) {
      try {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`;
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
          throw new Error(`Gemini API Error (${res.status}): ${errText}`);
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
        emit({ type: 'text_chunk', token: `⚠️ *Gemini API Notice:* ${err.message}\nContinuing with autonomous local tool execution...\n\n` });
      }
    } else {
      emit({ type: 'text_chunk', token: `ℹ️ *Autonomous Local Execution:* Model "${this.id}" requested without configured Gemini API key. Executing via local tool loop...\n\n` });
    }
  }
}
