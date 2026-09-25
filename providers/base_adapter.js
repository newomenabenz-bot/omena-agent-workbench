/**
 * OMENA Base Model Provider Adapter - v4.1.0 Contract
 * Enforces strict runtime contract, connection state machine, error normalization,
 * telemetry tracking, and tool execution protocol.
 */

export const ConnectionState = Object.freeze({
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  AUTHENTICATING: 'AUTHENTICATING',
  AUTHENTICATED: 'AUTHENTICATED',
  VALIDATING: 'VALIDATING',
  CONNECTED: 'CONNECTED',
  DEGRADED: 'DEGRADED',
  RATE_LIMITED: 'RATE_LIMITED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  AUTH_FAILED: 'AUTH_FAILED',
  NETWORK_ERROR: 'NETWORK_ERROR',
  MODEL_UNAVAILABLE: 'MODEL_UNAVAILABLE',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  DISCONNECTED: 'DISCONNECTED'
});

export const ErrorCode = Object.freeze({
  AUTH_FAILED: 'AUTH_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  CONTEXT_OVERFLOW: 'CONTEXT_OVERFLOW',
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  INVALID_REQUEST: 'INVALID_REQUEST'
});

export class WorkbenchError extends Error {
  constructor(code, message, details = {}, originalError = null) {
    super(message);
    this.name = 'WorkbenchError';
    this.code = code;
    this.details = details;
    this.originalError = originalError;
    this.timestamp = Date.now();
  }
}

export class BaseProviderAdapter {
  constructor(id, name, capabilities = {}) {
    this.id = id;
    this.name = name;
    this.capabilities = {
      streaming: Boolean(capabilities.streaming),
      tools: Boolean(capabilities.tools),
      vision: Boolean(capabilities.vision),
      reasoning: Boolean(capabilities.reasoning),
      contextWindow: capabilities.contextWindow || 128000
    };

    this.connectionState = ConnectionState.NOT_CONFIGURED;
    this.activeControllers = new Map();

    this.telemetry = {
      requestCount: 0,
      tokenCount: { prompt: 0, completion: 0, reasoning: 0 },
      latency: { ttft: 0, total: 0, history: [] },
      errorCount: 0,
      lastError: null,
      lastHealthCheck: null,
      lastConnected: null
    };
  }

  setConnectionState(state, details = null) {
    if (!Object.values(ConnectionState).includes(state)) {
      throw new Error(`Invalid connection state: ${state}`);
    }
    this.connectionState = state;
    if (state === ConnectionState.CONNECTED) {
      this.telemetry.lastConnected = Date.now();
    }
    if (details && details.error) {
      this.telemetry.lastError = {
        message: details.error,
        code: details.code || ErrorCode.PROVIDER_ERROR,
        timestamp: Date.now()
      };
      this.telemetry.errorCount++;
    }
  }

  getConnectionState() {
    return this.connectionState;
  }

  getCapabilities() {
    return {
      id: this.id,
      name: this.name,
      connectionState: this.connectionState,
      ...this.capabilities,
      telemetry: {
        requestCount: this.telemetry.requestCount,
        tokenCount: { ...this.telemetry.tokenCount },
        latency: {
          ttft: this.telemetry.latency.ttft,
          total: this.telemetry.latency.total
        },
        errorCount: this.telemetry.errorCount,
        lastError: this.telemetry.lastError,
        lastConnected: this.telemetry.lastConnected
      }
    };
  }

  recordTelemetry(metrics = {}) {
    this.telemetry.requestCount++;
    if (metrics.tokens) {
      this.telemetry.tokenCount.prompt += metrics.tokens.prompt || 0;
      this.telemetry.tokenCount.completion += metrics.tokens.completion || 0;
      this.telemetry.tokenCount.reasoning += metrics.tokens.reasoning || 0;
    }
    if (metrics.ttftMs) {
      this.telemetry.latency.ttft = metrics.ttftMs;
    }
    if (metrics.totalMs) {
      this.telemetry.latency.total = metrics.totalMs;
      this.telemetry.latency.history.push(metrics.totalMs);
      if (this.telemetry.latency.history.length > 50) {
        this.telemetry.latency.history.shift();
      }
    }
    if (metrics.error) {
      this.telemetry.errorCount++;
      this.telemetry.lastError = {
        message: metrics.error.message || String(metrics.error),
        code: metrics.error.code || ErrorCode.PROVIDER_ERROR,
        timestamp: Date.now()
      };
    }
  }

  normalizeError(err, context = {}) {
    if (err instanceof WorkbenchError) {
      return err;
    }

    const msg = (err?.message || String(err || '')).toLowerCase();
    const status = err?.status || context?.status;

    let code = ErrorCode.UPSTREAM_ERROR;
    let state = ConnectionState.PROVIDER_ERROR;

    if (status === 401 || status === 403 || msg.includes('api key') || msg.includes('unauthorized') || msg.includes('permission denied') || msg.includes('forbidden')) {
      code = ErrorCode.AUTH_FAILED;
      state = ConnectionState.AUTH_FAILED;
    } else if (status === 429 || msg.includes('rate limit') || msg.includes('too many requests')) {
      code = ErrorCode.RATE_LIMITED;
      state = ConnectionState.RATE_LIMITED;
    } else if (msg.includes('quota') || msg.includes('insufficient funds') || msg.includes('credit limit') || msg.includes('balance')) {
      code = ErrorCode.QUOTA_EXCEEDED;
      state = ConnectionState.QUOTA_EXCEEDED;
    } else if (status === 404 || msg.includes('model not found') || msg.includes('does not exist')) {
      code = ErrorCode.MODEL_NOT_FOUND;
      state = ConnectionState.MODEL_UNAVAILABLE;
    } else if (msg.includes('context length') || msg.includes('maximum context') || msg.includes('token limit exceeded')) {
      code = ErrorCode.CONTEXT_OVERFLOW;
      state = ConnectionState.CONNECTED;
    } else if (status === 503 || status === 502 || status === 504 || msg.includes('unavailable') || msg.includes('service unavailable')) {
      code = ErrorCode.PROVIDER_UNAVAILABLE;
      state = ConnectionState.DEGRADED;
    } else if (msg.includes('timeout') || msg.includes('timed out') || err?.name === 'TimeoutError') {
      code = ErrorCode.REQUEST_TIMEOUT;
      state = ConnectionState.NETWORK_ERROR;
    } else if (msg.includes('enotfound') || msg.includes('econnrefused') || msg.includes('fetch failed')) {
      code = ErrorCode.PROVIDER_UNAVAILABLE;
      state = ConnectionState.NETWORK_ERROR;
    }

    this.setConnectionState(state, { error: err?.message || msg, code });
    return new WorkbenchError(code, err?.message || 'Upstream provider error', { status, context }, err);
  }

  /**
   * Validate provider credentials against upstream API
   * @param {Object|string} credential
   * @returns {Promise<{ valid: boolean, state: string, error?: string, latencyMs?: number }>}
   */
  async validateConnection(credential) {
    throw new Error(`validateConnection() must be implemented by adapter ${this.id}`);
  }

  // Alias for backward compatibility
  async validateCredential(credential) {
    return this.validateConnection(credential);
  }

  /**
   * Dynamically discover models available to this credential
   * @param {Object|string} credential
   * @returns {Promise<Array<Object>>}
   */
  async discoverModels(credential) {
    return [];
  }

  /**
   * Retrieve metadata for a specific model ID
   * @param {string} modelId
   * @returns {Object|null}
   */
  getModelMetadata(modelId) {
    return {
      id: modelId || this.id,
      name: this.name,
      ...this.capabilities
    };
  }

  /**
   * Health check on adapter connection
   * @param {Object|string} credential
   * @returns {Promise<{ healthy: boolean, state: string, latencyMs: number, error?: string }>}
   */
  async healthCheck(credential) {
    const start = Date.now();
    try {
      const res = await this.validateConnection(credential);
      const latencyMs = Date.now() - start;
      this.telemetry.lastHealthCheck = { healthy: res.valid, latencyMs, timestamp: Date.now() };
      return { healthy: res.valid, state: res.state || this.connectionState, latencyMs, error: res.error };
    } catch (e) {
      const latencyMs = Date.now() - start;
      const normalized = this.normalizeError(e);
      this.telemetry.lastHealthCheck = { healthy: false, latencyMs, timestamp: Date.now(), error: normalized.message };
      return { healthy: false, state: this.connectionState, latencyMs, error: normalized.message };
    }
  }

  /**
   * Execute chat generation with streaming tokens and tool calls
   * @param {Object} params - { prompt, messages, tools, credentials, emit, callId, signal }
   */
  async streamChat(params) {
    throw new Error(`streamChat() must be implemented by adapter ${this.id}`);
  }

  /**
   * Execute single completion (non-streaming)
   * @param {Object} params
   */
  async complete(params) {
    let text = '';
    const toolCalls = [];
    await this.streamChat({
      ...params,
      emit: (ev) => {
        if (ev.type === 'text_chunk') {
          text += ev.token || '';
        } else if (ev.type === 'tool_call') {
          toolCalls.push(ev.call);
        }
      }
    });
    return { text, toolCalls };
  }

  /**
   * Parse tool calls from provider raw response
   */
  parseToolCalls(raw) {
    return [];
  }

  /**
   * Abort an active request by call ID
   */
  abortRequest(callId) {
    if (callId && this.activeControllers.has(callId)) {
      const controller = this.activeControllers.get(callId);
      controller.abort();
      this.activeControllers.delete(callId);
      return true;
    }
    return false;
  }
}
