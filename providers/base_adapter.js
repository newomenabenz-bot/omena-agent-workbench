/**
 * OMENA Base Model Provider Adapter
 * Declares capabilities schema and streaming interface
 */

export class BaseProviderAdapter {
  constructor(id, name, capabilities = {}) {
    this.id = id;
    this.name = name;
    this.capabilities = {
      streaming: Boolean(capabilities.streaming),
      tools: Boolean(capabilities.tools),
      vision: Boolean(capabilities.vision),
      reasoning: Boolean(capabilities.reasoning)
    };
  }

  getCapabilities() {
    return {
      id: this.id,
      name: this.name,
      ...this.capabilities
    };
  }

  /**
   * Execute chat generation with streaming tokens and tool calls
   * @param {Object} params - { messages, prompt, tools, credentials, emit }
   */
  async streamChat(params) {
    throw new Error(`streamChat() must be implemented by adapter ${this.id}`);
  }
}
