// OMENA Enterprise Mobile Agent Workbench Client Engine v2.0
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
    btnSaveKeys: document.getElementById('btn-save-keys'),
    btnOpenWorkspaceFolder: document.getElementById('btn-open-workspace-folder'),
    btnOpenMemoryViewer: document.getElementById('btn-open-memory-viewer'),
    sessionsList: document.getElementById('sessions-list'),
    // Auth elements
    authModal: document.getElementById('auth-modal'),
    authForm: document.getElementById('auth-form'),
    authPassword: document.getElementById('auth-password'),
    authErrorMsg: document.getElementById('auth-error-msg'),
    btnLogout: document.getElementById('btn-logout')
  };

  let isGenerating = false;
  let recognition = null;
  let isRecording = false;
  let currentSessionId = localStorage.getItem('omena_active_session') || `session_${Date.now()}`;
  let availableModels = [];

  // --- Viewport & Mobile Virtual Keyboard Fixes ---
  function initViewportKeyboardHandling() {
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        if (elements.appContainer) {
          elements.appContainer.style.height = `${window.visualViewport.height}px`;
        }
        scrollToBottom();
      });
      window.visualViewport.addEventListener('scroll', () => {
        scrollToBottom();
      });
    }
  }

  // --- Authentication System ---
  async function checkAuthStatus() {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      const data = await res.json();
      if (!data.authenticated) {
        showAuthModal();
      } else {
        hideAuthModal();
        initWorkbench();
      }
    } catch {
      showAuthModal();
    }
  }

  function showAuthModal() {
    if (elements.authModal) {
      elements.authModal.classList.add('open');
      if (elements.authPassword) {
        elements.authPassword.value = '';
        setTimeout(() => elements.authPassword.focus(), 200);
      }
    }
  }

  function hideAuthModal() {
    if (elements.authModal) elements.authModal.classList.remove('open');
    if (elements.authErrorMsg) elements.authErrorMsg.style.display = 'none';
  }

  if (elements.authForm) {
    elements.authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = elements.authPassword.value;
      if (elements.authErrorMsg) elements.authErrorMsg.style.display = 'none';

      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ password })
        });
        const data = await res.json();
        if (res.ok && data.ok) {
          hideAuthModal();
          initWorkbench();
        } else {
          if (elements.authErrorMsg) {
            elements.authErrorMsg.innerText = data.error || 'Authentication failed';
            elements.authErrorMsg.style.display = 'block';
          }
        }
      } catch (err) {
        if (elements.authErrorMsg) {
          elements.authErrorMsg.innerText = err.message || 'Connection error';
          elements.authErrorMsg.style.display = 'block';
        }
      }
    });
  }

  if (elements.btnLogout) {
    elements.btnLogout.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      } catch {}
      if (elements.settingsModal) elements.settingsModal.classList.remove('open');
      showAuthModal();
    });
  }

  // --- Dynamic Model Provider Capabilities ---
  async function loadModels() {
    try {
      const res = await fetch('/api/models');
      const data = await res.json();
      if (data && data.models) {
        availableModels = data.models;
        if (elements.selectModel) {
          elements.selectModel.innerHTML = availableModels.map(m => {
            const caps = [];
            if (m.tools) caps.push('Tools');
            if (m.vision) caps.push('Vision');
            if (m.reasoning) caps.push('Reasoning');
            const capStr = caps.length > 0 ? ` [${caps.join(', ')}]` : '';
            return `<option value="${m.id}">${m.name} (${m.id})${capStr}</option>`;
          }).join('');

          const savedModel = localStorage.getItem('omena_model') || data.default || 'gemini-2.0-flash';
          elements.selectModel.value = savedModel;
          updateModelPill(savedModel);
        }
      }
    } catch (e) {
      console.warn('[Model Load Notice]', e.message);
    }
  }

  function updateModelPill(modelId) {
    if (!elements.pillModel) return;
    const span = elements.pillModel.querySelector('span');
    const matched = availableModels.find(m => m.id === modelId);
    if (span) span.innerText = matched ? matched.name : modelId;
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
      if (elements.settingsModal) {
        elements.settingsModal.classList.add('open');
        if (elements.selectModel) elements.selectModel.focus();
      }
    });
  }

  // --- Theme Mode ---
  function initTheme() {
    const savedTheme = localStorage.getItem('omena_theme') || 'dark';
    setTheme(savedTheme);
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('omena_theme', theme);
    if (elements.selectTheme) elements.selectTheme.value = theme;
  }

  if (elements.btnToggleTheme) {
    elements.btnToggleTheme.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme') || 'dark';
      setTheme(current === 'dark' ? 'light' : 'dark');
    });
  }

  if (elements.selectTheme) {
    elements.selectTheme.addEventListener('change', (e) => setTheme(e.target.value));
  }

  // Auto-resize Textarea
  elements.userPrompt.addEventListener('input', () => {
    elements.userPrompt.style.height = 'auto';
    elements.userPrompt.style.height = Math.min(elements.userPrompt.scrollHeight, 120) + 'px';
  });

  elements.userPrompt.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  elements.btnSend.addEventListener('click', handleSend);

  // --- Voice Input (Web Speech API) ---
  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRec = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRec();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map(r => r[0].transcript)
        .join('');
      elements.userPrompt.value = transcript;
      elements.userPrompt.style.height = 'auto';
      elements.userPrompt.style.height = Math.min(elements.userPrompt.scrollHeight, 120) + 'px';
    };

    recognition.onend = () => {
      isRecording = false;
      elements.btnMic.classList.remove('recording');
    };

    elements.btnMic.addEventListener('click', () => {
      if (!isRecording) {
        try {
          recognition.start();
          isRecording = true;
          elements.btnMic.classList.add('recording');
        } catch {}
      } else {
        recognition.stop();
        isRecording = false;
        elements.btnMic.classList.remove('recording');
      }
    });
  } else {
    elements.btnMic.style.opacity = '0.4';
  }

  // --- Attachment Upload ---
  elements.btnAttach.addEventListener('click', () => elements.fileUploader.click());
  elements.fileUploader.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    appendUserMessage(`📎 Attached file: **${file.name}** (${(file.size / 1024).toFixed(1)} KB)`);
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        credentials: 'include',
        body: file
      });
      const data = await res.json();
      if (data.ok) {
        appendAssistantNotice(`✅ File **${file.name}** uploaded safely to \`storage/workbench_uploads/\``);
      }
    } catch (err) {
      appendAssistantNotice(`⚠️ File upload failed: ${err.message}`);
    }
  });

  // --- Sidebar & Sessions Management (SQLite API) ---
  async function loadSessionsList() {
    if (!elements.sessionsList) return;
    try {
      const res = await fetch('/api/sessions', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      renderSessions(data.sessions || []);
    } catch {}
  }

  function renderSessions(sessions) {
    if (!elements.sessionsList) return;
    if (sessions.length === 0) {
      elements.sessionsList.innerHTML = `<div style="padding: 12px; font-size: 13px; color: var(--text-muted); text-align: center;">No previous sessions</div>`;
      return;
    }

    elements.sessionsList.innerHTML = sessions.map(s => `
      <div class="session-item ${s.id === currentSessionId ? 'active' : ''}" data-id="${s.id}">
        <div style="flex:1; overflow:hidden;">
          <div class="session-title">${escapeHtml(s.title || 'Conversation')}</div>
          <div class="session-date">${formatDate(s.updatedAt)}</div>
        </div>
        <button class="icon-btn btn-del-session" data-del="${s.id}" title="Delete session" style="padding: 4px; opacity: 0.6;">✕</button>
      </div>
    `).join('');

    elements.sessionsList.querySelectorAll('.session-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (e.target.closest('.btn-del-session')) return;
        const id = item.getAttribute('data-id');
        switchSession(id);
      });
    });

    elements.sessionsList.querySelectorAll('.btn-del-session').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = btn.getAttribute('data-del');
        await deleteSession(id);
      });
    });
  }

  async function switchSession(sessionId) {
    currentSessionId = sessionId;
    localStorage.setItem('omena_active_session', sessionId);
    closeSidebar();

    try {
      const res = await fetch(`/api/sessions/${sessionId}`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      const session = data.session;
      if (session) {
        elements.messagesContainer.innerHTML = '';
        if (session.messages && session.messages.length > 0) {
          elements.heroSection.classList.add('hidden');
          for (const m of session.messages) {
            if (m.role === 'user') {
              appendUserMessage(m.content, false);
            } else {
              renderStoredAssistantMessage(m);
            }
          }
        } else {
          elements.heroSection.classList.remove('hidden');
        }
      }
    } catch {}
    loadSessionsList();
  }

  async function deleteSession(id) {
    try {
      await fetch(`/api/sessions/${id}`, { method: 'DELETE', credentials: 'include' });
      if (currentSessionId === id) {
        startNewChat();
      } else {
        loadSessionsList();
      }
    } catch {}
  }

  function startNewChat() {
    currentSessionId = `session_${Date.now()}`;
    localStorage.setItem('omena_active_session', currentSessionId);
    elements.messagesContainer.innerHTML = '';
    elements.heroSection.classList.remove('hidden');
    closeSidebar();
    loadSessionsList();
  }

  if (elements.btnNewChat) {
    elements.btnNewChat.addEventListener('click', startNewChat);
  }

  function openSidebar() {
    elements.sidebar.classList.add('open');
    elements.sidebarOverlay.classList.add('open');
    loadSessionsList();
  }

  function closeSidebar() {
    elements.sidebar.classList.remove('open');
    elements.sidebarOverlay.classList.remove('open');
  }

  elements.btnToggleSidebar.addEventListener('click', openSidebar);
  elements.btnCloseSidebar.addEventListener('click', closeSidebar);
  elements.sidebarOverlay.addEventListener('click', closeSidebar);

  // --- Bottom Sheet ---
  function openBottomSheet(title, imgSrc) {
    elements.bottomSheetTitle.innerText = title;
    elements.bottomSheetImg.src = imgSrc;
    elements.bottomSheet.classList.add('open');
    elements.bottomSheetOverlay.classList.add('open');
  }

  function closeBottomSheet() {
    elements.bottomSheet.classList.remove('open');
    elements.bottomSheetOverlay.classList.remove('open');
  }

  elements.btnCloseBottomSheet.addEventListener('click', closeBottomSheet);
  elements.bottomSheetOverlay.addEventListener('click', closeBottomSheet);

  if (elements.btnOpenBrowserView) {
    elements.btnOpenBrowserView.addEventListener('click', () => {
      closeSidebar();
      openBottomSheet('Live Chrome Viewport', `/api/browser/frame?t=${Date.now()}`);
    });
  }

  if (elements.btnOpenMonitorView) {
    elements.btnOpenMonitorView.addEventListener('click', () => {
      closeSidebar();
      openBottomSheet('27" 4K Monitor Render', `/api/browser/monitor?t=${Date.now()}`);
    });
  }

  // --- Settings Modal ---
  elements.btnOpenSettings.addEventListener('click', () => elements.settingsModal.classList.add('open'));
  elements.btnCloseSettings.addEventListener('click', () => elements.settingsModal.classList.remove('open'));

  // --- Message Sending & Real-Time Event Streaming ---
  async function handleSend() {
    const prompt = elements.userPrompt.value.trim();
    if (!prompt || isGenerating) return;

    elements.userPrompt.value = '';
    elements.userPrompt.style.height = 'auto';
    isGenerating = true;
    elements.heroSection.classList.add('hidden');

    appendUserMessage(prompt);
    scrollToBottom();

    // Create assistant container
    const assistantBubble = document.createElement('div');
    assistantBubble.className = 'message-row assistant';
    
    const card = document.createElement('div');
    card.className = 'assistant-bubble';
    
    // Tools container inside message
    const toolsContainer = document.createElement('div');
    toolsContainer.className = 'assistant-tools-section';

    // Content container inside message
    const contentContainer = document.createElement('div');
    contentContainer.className = 'assistant-content markdown-body';
    contentContainer.innerHTML = '<span class="cursor-blink">▍</span>';

    card.appendChild(toolsContainer);
    card.appendChild(contentContainer);
    assistantBubble.appendChild(card);
    elements.messagesContainer.appendChild(assistantBubble);
    scrollToBottom();

    const selectedModel = elements.selectModel ? elements.selectModel.value : 'gemini-2.0-flash';
    const credentials = {
      geminiKey: localStorage.getItem('omena_gemini_key') || '',
      openaiKey: localStorage.getItem('omena_openai_key') || '',
      claudeKey: localStorage.getItem('omena_claude_key') || '',
      localEndpoint: localStorage.getItem('omena_local_endpoint') || 'http://localhost:11434'
    };

    let fullText = '';
    const activeToolElements = new Map();

    try {
      const response = await fetch('/api/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          prompt,
          model: selectedModel,
          credentials,
          sessionId: currentSessionId
        })
      });

      if (response.status === 401) {
        showAuthModal();
        contentContainer.innerHTML = '⚠️ *Session expired. Please sign in to continue.*';
        isGenerating = false;
        return;
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errText}`);
      }

      const reader = response.body.getReader();
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
          if (!trimmed.startsWith('data: ')) continue;
          const dataStr = trimmed.slice(6);
          if (dataStr === '[DONE]') break;

          try {
            const event = JSON.parse(dataStr);
            handleStreamEvent(event, {
              toolsContainer,
              contentContainer,
              activeToolElements,
              appendText: (chunk) => {
                fullText += chunk;
                contentContainer.innerHTML = marked.parse(fullText) + '<span class="cursor-blink">▍</span>';
                scrollToBottom();
              }
            });
          } catch {}
        }
      }

      // Finalize text
      contentContainer.innerHTML = marked.parse(fullText || 'Done.');
      loadSessionsList();
    } catch (err) {
      contentContainer.innerHTML = marked.parse(`\n\n⚠️ **Connection Notice:** ${err.message}`);
    } finally {
      isGenerating = false;
      scrollToBottom();
    }
  }

  // Handle Structured SSE Stream Events
  function handleStreamEvent(event, ctx) {
    if (event.type === 'text_chunk') {
      ctx.appendText(event.token || '');
    } else if (event.type === 'tool_start') {
      const details = document.createElement('details');
      details.className = 'tool-accordion';
      details.open = true;

      const summary = document.createElement('summary');
      summary.className = 'tool-summary';
      summary.innerHTML = `
        <span class="tool-badge">
          ⚙️ <strong>${escapeHtml(event.tool || 'Tool')}</strong>
          <span style="opacity:0.7;">${escapeHtml(event.input?.command || event.input?.action || event.input?.url || '')}</span>
        </span>
        <span class="tool-badge-pill" id="badge-${event.callId}">Running...</span>
      `;

      const logBody = document.createElement('div');
      logBody.className = 'tool-log-body';
      logBody.id = `log-${event.callId}`;

      details.appendChild(summary);
      details.appendChild(logBody);
      ctx.toolsContainer.appendChild(details);
      ctx.activeToolElements.set(event.callId, { details, logBody, summary });
      scrollToBottom();
    } else if (event.type === 'tool_log') {
      const toolEl = ctx.activeToolElements.get(event.callId);
      if (toolEl) {
        toolEl.logBody.textContent += event.chunk;
        toolEl.logBody.scrollTop = toolEl.logBody.scrollHeight;
      }
    } else if (event.type === 'tool_done') {
      const toolEl = ctx.activeToolElements.get(event.callId);
      if (toolEl) {
        const badge = toolEl.summary.querySelector(`#badge-${event.callId}`);
        if (badge) {
          badge.innerText = event.exitCode === 0 ? `✓ ${event.durationMs}ms` : `⛔ Blocked`;
          badge.className = `tool-badge-pill ${event.exitCode === 0 ? 'success' : 'blocked'}`;
        }
        if (event.result && !toolEl.logBody.textContent.includes(event.result)) {
          toolEl.logBody.textContent += `\n[Result] ${event.result}\n`;
        }
        // Auto-collapse completed safe tools after 1s
        if (event.exitCode === 0) {
          setTimeout(() => { toolEl.details.open = false; }, 1000);
        }
      }
    } else if (event.type === 'browser_frame') {
      const previewCard = document.createElement('div');
      previewCard.style.cssText = 'margin: 10px 0; padding: 12px; border: 1px solid var(--border-color); border-radius: 12px; background: var(--bg-card); display:flex; gap:12px; align-items:center;';
      previewCard.innerHTML = `
        <img src="${event.frameUrl}?t=${Date.now()}" style="width:72px; height:48px; object-fit:cover; border-radius:6px; border:1px solid var(--border-subtle);">
        <div style="flex:1; overflow:hidden;">
          <div style="font-weight:600; font-size:13px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${escapeHtml(event.title || 'Captured Viewport')}</div>
          <div style="font-size:11px; color:var(--text-muted);">${escapeHtml(event.url || '')}</div>
        </div>
        <button class="pill-badge" style="background:var(--text-primary); color:var(--bg-primary); border:none; padding:6px 10px; font-size:11px; font-weight:600; cursor:pointer;">Inspect</button>
      `;
      previewCard.querySelector('button').addEventListener('click', () => {
        openBottomSheet(event.title || 'Page Viewport', `${event.monitorUrl}?t=${Date.now()}`);
      });
      ctx.toolsContainer.appendChild(previewCard);
    }
  }

  function appendUserMessage(text, scroll = true) {
    const row = document.createElement('div');
    row.className = 'message-row user';
    row.innerHTML = `<div class="user-bubble">${escapeHtml(text)}</div>`;
    elements.messagesContainer.appendChild(row);
    if (scroll) scrollToBottom();
  }

  function appendAssistantNotice(text) {
    const row = document.createElement('div');
    row.className = 'message-row assistant';
    row.innerHTML = `<div class="assistant-bubble"><div class="assistant-content markdown-body">${marked.parse(text)}</div></div>`;
    elements.messagesContainer.appendChild(row);
    scrollToBottom();
  }

  function renderStoredAssistantMessage(m) {
    const row = document.createElement('div');
    row.className = 'message-row assistant';
    const card = document.createElement('div');
    card.className = 'assistant-bubble';

    if (m.tools && m.tools.length > 0) {
      const toolsSec = document.createElement('div');
      toolsSec.className = 'assistant-tools-section';
      m.tools.forEach(t => {
        const details = document.createElement('details');
        details.className = 'tool-accordion';
        details.innerHTML = `
          <summary class="tool-summary">
            <span class="tool-badge">⚙️ <strong>${escapeHtml(t.tool || 'Tool')}</strong></span>
            <span class="tool-badge-pill ${t.exitCode === 0 ? 'success' : 'blocked'}">${t.exitCode === 0 ? `✓ ${t.durationMs || 0}ms` : '⛔ Blocked'}</span>
          </summary>
          <div class="tool-log-body">${escapeHtml(t.result || 'Executed')}</div>
        `;
        toolsSec.appendChild(details);
      });
      card.appendChild(toolsSec);
    }

    const contentSec = document.createElement('div');
    contentSec.className = 'assistant-content markdown-body';
    contentSec.innerHTML = marked.parse(m.content || '');
    card.appendChild(contentSec);

    row.appendChild(card);
    elements.messagesContainer.appendChild(row);
  }

  function scrollToBottom() {
    if (elements.chatScroller) {
      elements.chatScroller.scrollTop = elements.chatScroller.scrollHeight;
    }
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>'"]/g, tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag));
  }

  function formatDate(isoStr) {
    if (!isoStr) return '';
    try {
      const d = new Date(isoStr);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  // --- Initialize App ---
  function initWorkbench() {
    initTheme();
    loadModels();
    loadSessionsList();
    initViewportKeyboardHandling();
  }

  // Kick off auth check on load
  checkAuthStatus();
})();
