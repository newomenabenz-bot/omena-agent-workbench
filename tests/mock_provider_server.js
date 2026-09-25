/**
 * OMENA Mock Provider Server v4.1.0
 * Lightweight HTTP server implementing real wire protocols for Gemini, OpenAI,
 * Claude, DeepSeek, and Local AI for offline deterministic contract testing.
 */

import http from 'http';

export class MockProviderServer {
  constructor(port = 8098) {
    this.port = port;
    this.server = null;
    this.requests = [];
    this.simulatedError = null;
    this.simulatedToolCall = null;
  }

  setSimulatedError(errorObj) {
    this.simulatedError = errorObj;
  }

  setSimulatedToolCall(toolCallObj) {
    this.simulatedToolCall = toolCallObj;
  }

  clearSimulation() {
    this.simulatedError = null;
    this.simulatedToolCall = null;
    this.requests = [];
  }

  async start() {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          let parsedBody = null;
          try { parsedBody = JSON.parse(body || '{}'); } catch {}

          this.requests.push({
            method: req.method,
            url: req.url,
            headers: req.headers,
            body: parsedBody
          });

          // Check if error simulation is active
          if (this.simulatedError) {
            res.writeHead(this.simulatedError.status || 500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(this.simulatedError.body || { error: { message: this.simulatedError.message || 'Simulated error' } }));
            return;
          }

          // 1. Google Gemini endpoints
          if (req.url.includes('/models?key=')) {
            const keyMatch = req.url.match(/key=([^&]+)/);
            const key = keyMatch ? keyMatch[1] : '';
            if (key === 'invalid-key') {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: { message: 'API key not valid' } }));
              return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              models: [
                { name: 'models/gemini-2.0-flash', displayName: 'Gemini 2.0 Flash', supportedGenerationMethods: ['generateContent'] },
                { name: 'models/gemini-1.5-pro', displayName: 'Gemini 1.5 Pro', supportedGenerationMethods: ['generateContent'] }
              ]
            }));
            return;
          }

          if (req.url.includes('/openai/chat/completions') || (req.url.includes('/chat/completions') && !req.url.includes('deepseek'))) {
            // Check auth header
            const auth = req.headers.authorization || '';
            if (auth.includes('invalid')) {
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: { message: 'Incorrect API key provided' } }));
              return;
            }

            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive'
            });

            if (this.simulatedToolCall) {
              const tcChunk = {
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        {
                          index: 0,
                          id: this.simulatedToolCall.id || 'call_mock_1',
                          type: 'function',
                          function: {
                            name: this.simulatedToolCall.name,
                            arguments: JSON.stringify(this.simulatedToolCall.arguments || {})
                          }
                        }
                      ]
                    }
                  }
                ]
              };
              res.write(`data: ${JSON.stringify(tcChunk)}\n\n`);
            } else {
              res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Mock provider stream chunk 1. ' } }] })}\n\n`);
              res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Operation completed successfully.' } }] })}\n\n`);
            }

            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }

          // 2. OpenAI /v1/models
          if (req.url === '/v1/models' || req.url === '/models') {
            const auth = req.headers.authorization || req.headers['x-api-key'] || '';
            if (auth.includes('invalid')) {
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: { message: 'Invalid API key' } }));
              return;
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              data: [
                { id: 'gpt-4o' },
                { id: 'o3-mini' },
                { id: 'deepseek-reasoner' },
                { id: 'deepseek-chat' },
                { id: 'claude-3-5-sonnet' }
              ]
            }));
            return;
          }

          // 3. Anthropic Messages API
          if (req.url === '/v1/messages' || req.url === '/messages') {
            const apiKey = req.headers['x-api-key'] || '';
            if (apiKey.includes('invalid')) {
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: { message: 'invalid x-api-key' } }));
              return;
            }

            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive'
            });

            if (this.simulatedToolCall) {
              res.write(`data: ${JSON.stringify({ type: 'content_block_start', content_block: { type: 'tool_use', id: this.simulatedToolCall.id || 'call_anthropic_1', name: this.simulatedToolCall.name } })}\n\n`);
              res.write(`data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: JSON.stringify(this.simulatedToolCall.arguments || {}) } })}\n\n`);
              res.write(`data: ${JSON.stringify({ type: 'content_block_stop' })}\n\n`);
            } else {
              res.write(`data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello from Claude stream.' } })}\n\n`);
            }

            res.write(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
            res.end();
            return;
          }

          // 4. Local Ollama endpoints
          if (req.url === '/api/tags') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              models: [{ name: 'llama3:latest' }, { name: 'codellama:latest' }]
            }));
            return;
          }

          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
        });
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        resolve(`http://127.0.0.1:${this.port}`);
      });
      this.server.on('error', reject);
    });
  }

  async stop() {
    return new Promise(resolve => {
      if (this.server) {
        this.server.close(resolve);
      } else {
        resolve();
      }
    });
  }
}
