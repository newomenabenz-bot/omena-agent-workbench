// OMENA Production Mobile Agent Workbench Client Engine
(function() {
  const elements = {
    appContainer: document.getElementById('app-container'),
    chatScroller: document.getElementById('chat-scroller'),
    heroSection: document.getElementById('hero-section'),
    messagesContainer: document.getElementById('messages-container'),
    userPrompt: document.getElementById('user-prompt'),
    btnSend: document.getElementById('btn-send'),
    btnMic: document.getElementById('btn-mic'),
    btnAttach: document.getElementById('btn-attach'),
    fileUploader: document.getElementById('file-uploader'),
    btnToggleTheme: document.getElementById('btn-toggle-theme'),
    btnToggleSidebar: document.getElementById('btn-toggle-sidebar'),
    btnCloseSidebar: document.getElementById('btn-close-sidebar'),
    sidebar: document.getElementById('sidebar'),
    sidebarOverlay: document.getElementById('sidebar-overlay'),
    bottomSheet: document.getElementById('bottom-sheet'),
    bottomSheetOverlay: document.getElementById('bottom-sheet-overlay'),
    bottomSheetTitle: document.getElementById('bottom-sheet-title'),
    bottomSheetImg: document.getElementById('bottom-sheet-img'),
    btnCloseBottomSheet: document.getElementById('btn-close-bottom-sheet'),
    btnOpenSettings: document.getElementById('btn-open-settings'),
    settingsModal: document.getElementById('settings-modal'),
    btnCloseSettings: document.getElementById('btn-close-settings'),
    selectTheme: document.getElementById('select-theme'),
    statusDot: document.getElementById('status-dot'),
    statusText: document.getElementById('status-text'),
    btnNewChat: document.getElementById('btn-new-chat'),
    btnOpenBrowserView: document.getElementById('btn-open-browser-view'),
    btnOpenMonitorView: document.getElementById('btn-open-monitor-view'),
    pillModel: document.getElementById('pill-model'),
    selectModel: document.getElementById('select-model'),
    inputGeminiKey: document.getElementById('input-gemini-key'),
    inputOpenaiKey: document.getElementById('input-openai-key'),
    inputClaudeKey: document.getElementById('input-claude-key'),
    inputLocalEndpoint: document.getElementById('input-local-endpoint'),
    btnSaveKeys: document.getElementById('btn-save-keys')
  };

  let isGenerating = false;
  let recognition = null;
  let isRecording = false;

  // Initialize Theme & Model Settings
  function initTheme() {
    const savedTheme = localStorage.getItem('omena_theme') || 'dark';
    setTheme(savedTheme);

    const savedModel = localStorage.getItem('omena_model') || 'gemini-2.0-flash';
    if (elements.selectModel) {
      elements.selectModel.value = savedModel;
      updateModelPill(savedModel);
    }

    // Load saved subscription keys
    if (elements.inputGeminiKey) elements.inputGeminiKey.value = localStorage.getItem('omena_gemini_key') || '';
    if (elements.inputOpenaiKey) elements.inputOpenaiKey.value = localStorage.getItem('omena_openai_key') || '';
    if (elements.inputClaudeKey) elements.inputClaudeKey.value = localStorage.getItem('omena_claude_key') || '';
    if (elements.inputLocalEndpoint) elements.inputLocalEndpoint.value = localStorage.getItem('omena_local_endpoint') || 'http://localhost:11434';
  }

  function updateModelPill(modelId) {
    if (!elements.pillModel) return;
    const names = {
      'gemini-2.0-flash': 'Gemini 2.0 Flash',
      'gemini-1.5-pro': 'Gemini 1.5 Pro',
      'gpt-4o': 'ChatGPT / GPT-4o',
      'claude-3-5-sonnet': 'Claude 3.5 Sonnet',
      'deepseek-r1': 'DeepSeek R1',
      'local-gguf': 'Local GGUF / llama.cpp'
    };
    const span = elements.pillModel.querySelector('span');
    if (span) span.innerText = names[modelId] || modelId;
  }

  if (elements.selectModel) {
    elements.selectModel.addEventListener('change', (e) => {
      const m = e.target.value;
      localStorage.setItem('omena_model', m);
      updateModelPill(m);
    });
  }

  if (elements.pillModel) {
    elements.pillModel.addEventListener('click', () => {
      elements.settingsModal.classList.add('open');
      elements.selectModel.focus();
    });
  }

  if (elements.btnSaveKeys) {
    elements.btnSaveKeys.addEventListener('click', () => {
      localStorage.setItem('omena_gemini_key', elements.inputGeminiKey.value.trim());
      localStorage.setItem('omena_openai_key', elements.inputOpenaiKey.value.trim());
      localStorage.setItem('omena_claude_key', elements.inputClaudeKey.value.trim());
      localStorage.setItem('omena_local_endpoint', elements.inputLocalEndpoint.value.trim());
      elements.btnSaveKeys.innerText = '✓ Saved Successfully!';
      setTimeout(() => { elements.btnSaveKeys.innerText = 'Save Subscriptions'; }, 2000);
    });
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('omena_theme', theme);
    if (elements.selectTheme) elements.selectTheme.value = theme;
  }

  elements.btnToggleTheme.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    setTheme(current === 'dark' ? 'light' : 'dark');
  });

  if (elements.selectTheme) {
    elements.selectTheme.addEventListener('change', (e) => setTheme(e.target.value));
  }

  // Auto-resize Textarea
  elements.userPrompt.addEventListener('input', () => {
    elements.userPrompt.style.height = 'auto';
    elements.userPrompt.style.height = Math.min(elements.userPrompt.scrollHeight, 180) + 'px';
    if (elements.userPrompt.value.trim().length > 0) {
      elements.btnSend.classList.add('active');
    } else {
      elements.btnSend.classList.remove('active');
    }
  });

  // Keyboard shortcut: Enter to send, Shift+Enter for newline
  elements.userPrompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  elements.btnSend.addEventListener('click', handleSend);

  // Send Prompt Handler
  async function handleSend() {
    const prompt = elements.userPrompt.value.trim();
    if (!prompt || isGenerating) return;

    // Transition out of hero view
    elements.heroSection.style.display = 'none';
    elements.messagesContainer.style.display = 'flex';

    // Append user message
    appendUserMessage(prompt);

    // Reset textarea
    elements.userPrompt.value = '';
    elements.userPrompt.style.height = 'auto';
    elements.btnSend.classList.remove('active');
    isGenerating = true;

    // Create assistant message placeholder
    const assistantMsgObj = createAssistantMessage();
    scrollToBottom();

    const startTime = performance.now();
    let toolCount = 0;

    try {
      const activeModel = localStorage.getItem('omena_model') || 'gemini-2.0-flash';
      const credentials = {
        geminiKey: localStorage.getItem('omena_gemini_key') || '',
        openaiKey: localStorage.getItem('omena_openai_key') || '',
        claudeKey: localStorage.getItem('omena_claude_key') || '',
        localEndpoint: localStorage.getItem('omena_local_endpoint') || 'http://localhost:11434'
      };

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, model: activeModel, credentials })
      });

      if (!res.ok) {
        throw new Error(`Server returned ${res.status}: ${res.statusText}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let fullAssistantText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep last incomplete line

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;
          const jsonStr = line.replace(/^data: /, '').trim();
          if (jsonStr === '[DONE]') continue;

          try {
            const event = JSON.parse(jsonStr);

            if (event.type === 'tool_start') {
              toolCount++;
              addToolAccordion(assistantMsgObj.container, event.toolName, event.args);
            } else if (event.type === 'tool_end') {
              updateToolAccordion(assistantMsgObj.container, event.toolName, event.result, event.durationMs);
            } else if (event.type === 'artifact') {
              addArtifactPill(assistantMsgObj.container, event.title, event.sub, event.imgUrl);
            } else if (event.type === 'token') {
              fullAssistantText += event.token;
              assistantMsgObj.contentEl.innerHTML = marked.parse(fullAssistantText);
              scrollToBottom();
            } else if (event.type === 'complete') {
              // Finalize stats
              const totalSec = ((performance.now() - startTime) / 1000).toFixed(1);
              assistantMsgObj.statsEl.innerText = `OMENA v2.0 • ⏱ ${totalSec}s • ⚡ ${toolCount} tools • 🟢 Done`;
            }
          } catch (err) {
            console.error('Error parsing SSE event:', err, jsonStr);
          }
        }
      }
    } catch (err) {
      assistantMsgObj.contentEl.innerHTML += `<p style="color: #ef4444; margin-top: 8px;"><strong>Error:</strong> ${err.message}</p>`;
    } finally {
      isGenerating = false;
      scrollToBottom();
    }
  }

  function appendUserMessage(text) {
    const wrap = document.createElement('div');
    wrap.className = 'message-wrapper user';
    wrap.innerHTML = `<div class="message-bubble">${escapeHtml(text)}</div>`;
    elements.messagesContainer.appendChild(wrap);
  }

  function createAssistantMessage() {
    const wrap = document.createElement('div');
    wrap.className = 'message-wrapper assistant';

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    const contentEl = document.createElement('div');
    contentEl.className = 'assistant-content';
    bubble.appendChild(contentEl);

    // Metadata Strip
    const metaStrip = document.createElement('div');
    metaStrip.className = 'message-meta-strip';

    const statsEl = document.createElement('div');
    statsEl.className = 'meta-stats';
    statsEl.innerHTML = `<span class="meta-model-pill">OMENA v2.0</span> <span>Executing...</span>`;

    const actionsEl = document.createElement('div');
    actionsEl.className = 'meta-actions';
    actionsEl.innerHTML = `
      <button class="meta-icon-btn" title="Copy text" onclick="navigator.clipboard.writeText(this.closest('.message-wrapper').querySelector('.assistant-content').innerText)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
      </button>
    `;

    metaStrip.appendChild(statsEl);
    metaStrip.appendChild(actionsEl);

    wrap.appendChild(bubble);
    wrap.appendChild(metaStrip);
    elements.messagesContainer.appendChild(wrap);

    return { container: bubble, contentEl, statsEl };
  }

  function addToolAccordion(container, toolName, args) {
    const acc = document.createElement('div');
    acc.className = 'tool-accordion';
    acc.id = `tool-acc-${Date.now()}-${Math.floor(Math.random()*1000)}`;

    const summaryArgs = typeof args === 'string' ? args : JSON.stringify(args || {}).slice(0, 45);

    acc.innerHTML = `
      <div class="tool-accordion-header" onclick="this.parentElement.classList.toggle('open')">
        <div class="tool-badge-left">
          <span class="tool-status-dot"></span>
          <span>▶ ${escapeHtml(toolName)}</span>
          <span style="color: var(--text-muted); font-size: 11px;">(${escapeHtml(summaryArgs)})</span>
        </div>
        <span style="font-size: 11px;">⏳ running...</span>
      </div>
      <div class="tool-accordion-body">Starting autonomous tool execution...</div>
    `;

    container.appendChild(acc);
    scrollToBottom();
  }

  function updateToolAccordion(container, toolName, result, durationMs) {
    const accs = container.querySelectorAll('.tool-accordion');
    const lastAcc = accs[accs.length - 1];
    if (lastAcc) {
      const header = lastAcc.querySelector('.tool-accordion-header');
      const timeSpan = header.querySelector('span:last-child');
      if (timeSpan) {
        timeSpan.innerText = `✓ ${durationMs || 300}ms`;
        timeSpan.style.color = 'var(--accent-color)';
      }
      const body = lastAcc.querySelector('.tool-accordion-body');
      if (body) {
        body.innerText = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      }
    }
  }

  function addArtifactPill(container, title, sub, imgUrl) {
    const pill = document.createElement('div');
    pill.className = 'artifact-preview-card';
    pill.innerHTML = `
      <div class="artifact-icon">🖥️</div>
      <div class="artifact-info">
        <div class="artifact-title">${escapeHtml(title)}</div>
        <div class="artifact-sub">${escapeHtml(sub || 'Tap to inspect 27" monitor screen')}</div>
      </div>
    `;
    pill.addEventListener('click', () => {
      openBottomSheet(title, imgUrl || '/api/browser/frame');
    });
    container.appendChild(pill);
    scrollToBottom();
  }

  // Voice Dictation via Web Speech API
  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRec();
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => {
      isRecording = true;
      elements.btnMic.classList.add('recording');
    };

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        interim += event.results[i][0].transcript;
      }
      elements.userPrompt.value = interim;
      elements.userPrompt.dispatchEvent(new Event('input'));
    };

    recognition.onerror = () => {
      isRecording = false;
      elements.btnMic.classList.remove('recording');
    };

    recognition.onend = () => {
      isRecording = false;
      elements.btnMic.classList.remove('recording');
    };

    elements.btnMic.addEventListener('click', () => {
      if (isRecording) {
        recognition.stop();
      } else {
        recognition.start();
      }
    });
  } else {
    elements.btnMic.style.display = 'none';
  }

  // File Attach Handler
  elements.btnAttach.addEventListener('click', () => {
    elements.fileUploader.click();
  });

  elements.fileUploader.addEventListener('change', async () => {
    const files = elements.fileUploader.files;
    if (!files.length) return;

    const formData = new FormData();
    for (const f of files) {
      formData.append('files', f);
    }

    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.ok) {
        elements.userPrompt.value += ` [Attached: ${data.filenames.join(', ')}] `;
        elements.userPrompt.dispatchEvent(new Event('input'));
      }
    } catch (err) {
      alert('Upload failed: ' + err.message);
    }
  });

  // Sidebar Controls
  elements.btnToggleSidebar.addEventListener('click', () => {
    elements.sidebar.classList.toggle('open');
    elements.sidebarOverlay.classList.toggle('open');
  });

  elements.btnCloseSidebar.addEventListener('click', closeSidebar);
  elements.sidebarOverlay.addEventListener('click', closeSidebar);

  function closeSidebar() {
    elements.sidebar.classList.remove('open');
    elements.sidebarOverlay.classList.remove('open');
  }

  // Bottom Sheet Controls
  function openBottomSheet(title, imgUrl) {
    elements.bottomSheetTitle.innerText = title;
    elements.bottomSheetImg.src = imgUrl + '?t=' + Date.now();
    elements.bottomSheet.classList.add('open');
    elements.bottomSheetOverlay.classList.add('open');
  }

  function closeBottomSheet() {
    elements.bottomSheet.classList.remove('open');
    elements.bottomSheetOverlay.classList.remove('open');
  }

  elements.btnCloseBottomSheet.addEventListener('click', closeBottomSheet);
  elements.bottomSheetOverlay.addEventListener('click', closeBottomSheet);

  // Settings Modal Controls
  elements.btnOpenSettings.addEventListener('click', () => {
    elements.settingsModal.classList.add('open');
  });

  elements.btnCloseSettings.addEventListener('click', () => {
    elements.settingsModal.classList.remove('open');
  });

  elements.settingsModal.addEventListener('click', (e) => {
    if (e.target === elements.settingsModal) {
      elements.settingsModal.classList.remove('open');
    }
  });

  // Sidebar Actions
  elements.btnNewChat.addEventListener('click', () => {
    elements.messagesContainer.innerHTML = '';
    elements.messagesContainer.style.display = 'none';
    elements.heroSection.style.display = 'flex';
    closeSidebar();
  });

  elements.btnOpenBrowserView.addEventListener('click', () => {
    closeSidebar();
    openBottomSheet('Live Remote Chrome Browser', '/api/browser/frame');
  });

  elements.btnOpenMonitorView.addEventListener('click', () => {
    closeSidebar();
    openBottomSheet('27" 4K Monitor Screen', '/api/browser/monitor');
  });

  function scrollToBottom() {
    elements.chatScroller.scrollTop = elements.chatScroller.scrollHeight;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Check system status periodically
  async function checkStatus() {
    try {
      const res = await fetch('/api/status');
      const data = await res.json();
      if (data.ok) {
        elements.statusText.innerText = data.browserActive ? 'Chrome 9222 Active' : 'Autonomous Online';
        elements.statusDot.style.backgroundColor = 'var(--accent-color)';
      }
    } catch {
      elements.statusText.innerText = 'Connecting...';
      elements.statusDot.style.backgroundColor = 'var(--text-muted)';
    }
  }

  initTheme();
  checkStatus();
  setInterval(checkStatus, 15000);

})();
