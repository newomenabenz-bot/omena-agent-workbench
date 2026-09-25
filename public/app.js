// OMENA Enterprise Mobile Agent Workbench Client Engine v4.0.1
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
    btnOpenTerminalView: document.getElementById('btn-open-terminal-view'),
    btnOpenWorkspaceView: document.getElementById('btn-open-workspace-view'),
    btnOpenMemoryView: document.getElementById('btn-open-memory-view'),
    pillModel: document.getElementById('pill-model'),
    pillCtx: document.getElementById('pill-ctx'),
    pillBrowser: document.getElementById('pill-browser'),
    pillVision: document.getElementById('pill-vision'),
    pillShell: document.getElementById('pill-shell'),
    selectModel: document.getElementById('select-model'),
    // Provider inputs & status
    inputGeminiKey: document.getElementById('input-gemini-key'),
    inputOpenaiKey: document.getElementById('input-openai-key'),
    inputClaudeKey: document.getElementById('input-claude-key'),
    inputDeepseekKey: document.getElementById('input-deepseek-key'),
    inputLocalEndpoint: document.getElementById('input-local-endpoint'),
    statusGemini: document.getElementById('status-gemini'),
    statusOpenai: document.getElementById('status-openai'),
    statusClaude: document.getElementById('status-claude'),
    statusDeepseek: document.getElementById('status-deepseek'),
    statusLocal: document.getElementById('status-local'),
    saveStatusMsg: document.getElementById('save-status-msg'),
    btnSaveKeys: document.getElementById('btn-save-keys'),
    settingsCdpStatus: document.getElementById('settings-cdp-status'),
    checkAutoExec: document.getElementById('check-auto-exec'),
    sessionsList: document.getElementById('sessions-list'),
    // Modals
    terminalModal: document.getElementById('terminal-modal'),
    btnCloseTerminal: document.getElementById('btn-close-terminal'),
    terminalOutput: document.getElementById('terminal-output'),
    terminalCmdInput: document.getElementById('terminal-cmd-input'),
    btnRunCmd: document.getElementById('btn-run-cmd'),
    workspaceModal: document.getElementById('workspace-modal'),
    btnCloseWorkspace: document.getElementById('btn-close-workspace'),
    workspaceTreeContainer: document.getElementById('workspace-tree-container'),
    workspaceFilePreview: document.getElementById('workspace-file-preview'),
    memoryModal: document.getElementById('memory-modal'),
    btnCloseMemory: document.getElementById('btn-close-memory'),
    memoryTabs: document.getElementById('memory-tabs'),
    memoryJsonView: document.getElementById('memory-json-view'),
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

  const SUN_SVG = `<svg id="theme-icon-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
  const MOON_SVG = `<svg id="theme-icon-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;

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

  // --- Theme Mode ---
  function initTheme() {
    const savedTheme = localStorage.getItem('omena_theme') || 'dark';
    setTheme(savedTheme);
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('omena_theme', theme);
    if (elements.selectTheme) elements.selectTheme.value = theme;
    if (elements.btnToggleTheme) {
      elements.btnToggleTheme.innerHTML = theme === 'dark' ? SUN_SVG : MOON_SVG;
      elements.btnToggleTheme.title = theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    }
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

  // --- Dynamic Model Provider Capabilities & Telemetry ---
  async function loadModels() {
    try {
      const res = await fetch('/api/models', { credentials: 'include' });
      const data = await res.json();
      if (data && data.models) {
        availableModels = data.models;
        if (elements.selectModel) {
          const savedModel = localStorage.getItem('omena_model') || data.default || 'gemini-2.0-flash';
          elements.selectModel.innerHTML = availableModels.map(m => {
            const caps = [];
            if (m.tools) caps.push('Tools');
            if (m.vision) caps.push('Vision');
            if (m.reasoning) caps.push('Reasoning');
            const capStr = caps.length > 0 ? ` [${caps.join(', ')}]` : '';
            const selected = m.id === savedModel ? ' selected' : '';
            return `<option value="${m.id}"${selected}>${m.name} (${m.id})${capStr}</option>`;
          }).join('');

          elements.selectModel.value = savedModel;
          updateSystemStatus(savedModel);
        }
      }
    } catch (e) {
      console.warn('[Model Load Notice]', e.message);
    }
  }

  async function updateSystemStatus(modelId) {
    const currentModel = modelId || (elements.selectModel ? elements.selectModel.value : 'gemini-2.0-flash');
    try {
      const res = await fetch(`/api/system/status?model=${encodeURIComponent(currentModel)}`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();

      // 1. Model Pill
      if (elements.pillModel) {
        const span = elements.pillModel.querySelector('span');
        if (span) span.innerText = data.activeModel?.name || currentModel;
      }

      // 2. Context Window Pill
      if (elements.pillCtx) {
        const span = elements.pillCtx.querySelector('span');
        const ctxLimit = data.activeModel?.contextWindow || 1048576;
        if (span) span.innerText = `ctx: ${ctxLimit.toLocaleString()}`;
      }

      // 3. CDP Browser Pill
      if (elements.pillBrowser) {
        const span = elements.pillBrowser.querySelector('span');
        if (span) {
          span.innerText = data.cdp?.active ? 'Chrome DevTools Active' : 'Chrome (CDP Standby)';
        }
        elements.pillBrowser.style.borderColor = data.cdp?.active ? 'var(--accent-color)' : 'var(--pill-border)';
      }

      // 4. Vision Pill
      if (elements.pillVision) {
        elements.pillVision.style.opacity = data.vision ? '1' : '0.4';
      }

      // 5. Settings CDP Status
      if (elements.settingsCdpStatus) {
        elements.settingsCdpStatus.innerText = data.cdp?.active ? '127.0.0.1:9222 (Connected)' : '127.0.0.1:9222 (Standby)';
        elements.settingsCdpStatus.style.color = data.cdp?.active ? 'var(--accent-color)' : 'var(--text-muted)';
      }
    } catch (e) {
      console.warn('[System Status Notice]', e.message);
    }
  }

  if (elements.selectModel) {
    elements.selectModel.addEventListener('change', (e) => {
      const m = e.target.value;
      localStorage.setItem('omena_model', m);
      updateSystemStatus(m);
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

  // --- Provider Subscriptions Management ---
  async function loadProviderStatus() {
    try {
      const res = await fetch('/api/providers/status', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      const providers = data.providers || {};

      const updateBadge = (el, pData) => {
        if (!el) return;
        if (pData && pData.configured) {
          el.innerText = `Active (${pData.maskedKey || 'configured'})`;
          el.className = 'provider-status-badge valid';
        } else {
          el.innerText = 'Not configured';
          el.className = 'provider-status-badge invalid';
        }
      };

      updateBadge(elements.statusGemini, providers.gemini);
      updateBadge(elements.statusOpenai, providers.openai);
      updateBadge(elements.statusClaude, providers.anthropic);
      updateBadge(elements.statusDeepseek, providers.deepseek);
      updateBadge(elements.statusLocal, providers.local);

      if (providers.local && providers.local.maskedKey && elements.inputLocalEndpoint) {
        elements.inputLocalEndpoint.value = providers.local.maskedKey;
      }
    } catch (err) {
      console.warn('[Provider Status Load Notice]', err.message);
    }
  }

  async function saveSubscriptions() {
    const creds = {};
    const geminiVal = elements.inputGeminiKey?.value.trim();
    const openaiVal = elements.inputOpenaiKey?.value.trim();
    const claudeVal = elements.inputClaudeKey?.value.trim();
    const deepseekVal = elements.inputDeepseekKey?.value.trim();
    const localVal = elements.inputLocalEndpoint?.value.trim();

    if (geminiVal) creds.gemini = geminiVal;
    if (openaiVal) creds.openai = openaiVal;
    if (claudeVal) creds.anthropic = claudeVal;
    if (deepseekVal) creds.deepseek = deepseekVal;
    if (localVal) creds.local = localVal;

    if (elements.saveStatusMsg) {
      elements.saveStatusMsg.style.display = 'block';
      elements.saveStatusMsg.style.color = 'var(--text-secondary)';
      elements.saveStatusMsg.innerText = 'Validating credentials with AI providers...';
    }

    try {
      const res = await fetch('/api/providers/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          credentials: creds,
          testConnection: true
        })
      });

      const data = await res.json();
      if (res.ok && data.success) {
        if (elements.saveStatusMsg) {
          elements.saveStatusMsg.style.color = 'var(--accent-color)';
          elements.saveStatusMsg.innerText = '✓ Subscriptions successfully validated and persisted to SQLite.';
        }
        // Clear password fields for safety
        if (elements.inputGeminiKey) elements.inputGeminiKey.value = '';
        if (elements.inputOpenaiKey) elements.inputOpenaiKey.value = '';
        if (elements.inputClaudeKey) elements.inputClaudeKey.value = '';
        if (elements.inputDeepseekKey) elements.inputDeepseekKey.value = '';

        await loadProviderStatus();
        await loadModels();
        setTimeout(() => {
          if (elements.saveStatusMsg) elements.saveStatusMsg.style.display = 'none';
        }, 4000);
      } else {
        const errorDetails = Object.entries(data.validation || {})
          .filter(([, v]) => !v.valid)
          .map(([k, v]) => `${k}: ${v.error}`)
          .join('; ');
        if (elements.saveStatusMsg) {
          elements.saveStatusMsg.style.color = '#ef4444';
          elements.saveStatusMsg.innerText = `Validation Failed: ${errorDetails || data.error || 'Check API keys'}`;
        }
      }
    } catch (err) {
      if (elements.saveStatusMsg) {
        elements.saveStatusMsg.style.color = '#ef4444';
        elements.saveStatusMsg.innerText = `Network Error: ${err.message}`;
      }
    }
  }

  if (elements.btnSaveKeys) {
    elements.btnSaveKeys.addEventListener('click', saveSubscriptions);
  }

  // --- Auto-resize Textarea ---
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

  if (elements.btnSend) {
    elements.btnSend.addEventListener('click', handleSend);
  }

  // --- Voice Dictation ---
  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      elements.userPrompt.value += (elements.userPrompt.value ? ' ' : '') + transcript;
      elements.userPrompt.dispatchEvent(new Event('input'));
    };

    recognition.onend = () => {
      isRecording = false;
      elements.btnMic.classList.remove('active');
    };

    elements.btnMic.addEventListener('click', () => {
      if (!isRecording) {
        try {
          recognition.start();
          isRecording = true;
          elements.btnMic.classList.add('active');
        } catch {}
      } else {
        recognition.stop();
        isRecording = false;
        elements.btnMic.classList.remove('active');
      }
    });
  } else {
    if (elements.btnMic) elements.btnMic.style.display = 'none';
  }

  // --- File Upload ---
  if (elements.btnAttach) {
    elements.btnAttach.addEventListener('click', () => elements.fileUploader.click());
  }

  if (elements.fileUploader) {
    elements.fileUploader.addEventListener('change', async (e) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);
        try {
          elements.userPrompt.value += `\n[Uploading ${file.name}...]`;
          const res = await fetch('/api/upload', {
            method: 'POST',
            credentials: 'include',
            body: file
          });
          const data = await res.json();
          elements.userPrompt.value = elements.userPrompt.value.replace(
            `\n[Uploading ${file.name}...]`,
            `\n[Attached: ${file.name} (server: ${data.filename})]`
          );
          elements.userPrompt.dispatchEvent(new Event('input'));
        } catch (err) {
          console.error('[Upload Error]', err);
        }
      }
    });
  }

  // --- Sidebar & Sessions Management ---
  async function loadSessionsList() {
    if (!elements.sessionsList) return;
    try {
      const res = await fetch('/api/sessions', { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      const sessions = data.sessions || [];

      if (sessions.length === 0) {
        elements.sessionsList.innerHTML = '<div class="sidebar-item" style="color: var(--text-muted); font-size: 13px;">No archived sessions</div>';
        return;
      }

      elements.sessionsList.innerHTML = sessions.map(s => `
        <div class="sidebar-item session-item ${s.id === currentSessionId ? 'active' : ''}" data-id="${s.id}">
          <div style="flex:1; overflow:hidden;">
            <div style="font-weight: 500; font-size: 13px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${escapeHtml(s.title || 'Untitled Session')}</div>
            <div style="font-size: 11px; color: var(--text-muted);">${formatDate(s.updatedAt)}</div>
          </div>
          <button class="icon-btn btn-del-session" data-del="${s.id}" title="Delete session" style="padding: 4px; font-size: 12px; color: var(--text-muted);">🗑️</button>
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
    } catch (e) {
      console.warn('[Sessions Load Warning]', e.message);
    }
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

  // --- Bottom Sheet (Live Remote Browser & Monitor) ---
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

  // --- Terminal Console Modal ---
  if (elements.btnOpenTerminalView) {
    elements.btnOpenTerminalView.addEventListener('click', () => {
      closeSidebar();
      elements.terminalModal.classList.add('open');
      if (elements.terminalCmdInput) elements.terminalCmdInput.focus();
    });
  }

  if (elements.btnCloseTerminal) {
    elements.btnCloseTerminal.addEventListener('click', () => {
      elements.terminalModal.classList.remove('open');
    });
  }

  async function executeTerminalCommand() {
    const cmd = elements.terminalCmdInput.value.trim();
    if (!cmd) return;
    elements.terminalCmdInput.value = '';
    elements.terminalOutput.textContent += `\n$ ${cmd}\n`;
    elements.terminalOutput.scrollTop = elements.terminalOutput.scrollHeight;

    try {
      const res = await fetch('/api/terminal/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ command: cmd })
      });
      const data = await res.json();
      if (data.stdout) elements.terminalOutput.textContent += data.stdout;
      if (data.stderr) elements.terminalOutput.textContent += data.stderr;
      if (!data.stdout && !data.stderr) elements.terminalOutput.textContent += `[Exited with code ${data.exitCode}]\n`;
    } catch (err) {
      elements.terminalOutput.textContent += `[Error: ${err.message}]\n`;
    }
    elements.terminalOutput.scrollTop = elements.terminalOutput.scrollHeight;
  }

  if (elements.btnRunCmd) {
    elements.btnRunCmd.addEventListener('click', executeTerminalCommand);
  }
  if (elements.terminalCmdInput) {
    elements.terminalCmdInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        executeTerminalCommand();
      }
    });
  }

  // --- Workspace Explorer Modal ---
  if (elements.btnOpenWorkspaceView) {
    elements.btnOpenWorkspaceView.addEventListener('click', async () => {
      closeSidebar();
      elements.workspaceModal.classList.add('open');
      await loadWorkspaceTree();
    });
  }

  if (elements.btnCloseWorkspace) {
    elements.btnCloseWorkspace.addEventListener('click', () => {
      elements.workspaceModal.classList.remove('open');
    });
  }

  async function loadWorkspaceTree() {
    if (!elements.workspaceTreeContainer) return;
    elements.workspaceTreeContainer.innerHTML = '<div>Loading workspace files...</div>';
    elements.workspaceFilePreview.style.display = 'none';

    try {
      const res = await fetch('/api/workspace/tree', { credentials: 'include' });
      const data = await res.json();
      const files = data.tree || [];

      if (files.length === 0) {
        elements.workspaceTreeContainer.innerHTML = '<div style="color:var(--text-muted);">Workspace root is empty.</div>';
        return;
      }

      elements.workspaceTreeContainer.innerHTML = files.map(f => {
        const isDir = f.isDirectory || f.type === 'directory';
        const icon = isDir ? '📁' : '📄';
        return `
          <div class="workspace-tree-item" data-path="${f.name || f.path}" style="padding: 4px 6px; cursor: pointer; border-radius: 6px; display: flex; align-items: center; gap: 8px;">
            <span>${icon}</span>
            <span>${escapeHtml(f.name || f.path)}</span>
          </div>
        `;
      }).join('');

      elements.workspaceTreeContainer.querySelectorAll('.workspace-tree-item').forEach(item => {
        item.addEventListener('click', async () => {
          const filePath = item.getAttribute('data-path');
          try {
            const fRes = await fetch(`/api/workspace/file?path=${encodeURIComponent(filePath)}`, { credentials: 'include' });
            if (fRes.ok) {
              const fData = await fRes.json();
              elements.workspaceFilePreview.style.display = 'block';
              elements.workspaceFilePreview.textContent = typeof fData.content === 'string' ? fData.content : JSON.stringify(fData, null, 2);
            }
          } catch {}
        });
      });
    } catch (e) {
      elements.workspaceTreeContainer.innerHTML = `<div style="color:#ef4444;">Error loading files: ${e.message}</div>`;
    }
  }

  // --- Memory State Viewer Modal ---
  if (elements.btnOpenMemoryView) {
    elements.btnOpenMemoryView.addEventListener('click', async () => {
      closeSidebar();
      elements.memoryModal.classList.add('open');
      await loadMemoryView();
    });
  }

  if (elements.btnCloseMemory) {
    elements.btnCloseMemory.addEventListener('click', () => {
      elements.memoryModal.classList.remove('open');
    });
  }

  async function loadMemoryView() {
    if (!elements.memoryJsonView) return;
    elements.memoryJsonView.textContent = 'Loading persistent memory stores...';

    try {
      const res = await fetch('/api/memory/view', { credentials: 'include' });
      const data = await res.json();
      const mem = data.memory || {};
      const keys = Object.keys(mem);

      if (keys.length === 0) {
        elements.memoryTabs.innerHTML = '';
        elements.memoryJsonView.textContent = 'No memory store files initialized yet.';
        return;
      }

      elements.memoryTabs.innerHTML = keys.map((k, idx) => `
        <button class="memory-tab-btn ${idx === 0 ? 'active' : ''}" data-key="${k}">${k}</button>
      `).join('');

      const renderTab = (k) => {
        const val = mem[k];
        elements.memoryJsonView.textContent = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val);
      };

      renderTab(keys[0]);

      elements.memoryTabs.querySelectorAll('.memory-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          elements.memoryTabs.querySelectorAll('.memory-tab-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          renderTab(btn.getAttribute('data-key'));
        });
      });
    } catch (e) {
      elements.memoryJsonView.textContent = `Error reading memory store: ${e.message}`;
    }
  }

  // --- Settings Modal ---
  elements.btnOpenSettings.addEventListener('click', () => {
    loadProviderStatus();
    updateSystemStatus();
    elements.settingsModal.classList.add('open');
  });
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
    
    const toolsContainer = document.createElement('div');
    toolsContainer.className = 'assistant-tools-section';

    const contentContainer = document.createElement('div');
    contentContainer.className = 'assistant-content markdown-body';
    contentContainer.innerHTML = '<span class="cursor-blink">▍</span>';

    card.appendChild(toolsContainer);
    card.appendChild(contentContainer);
    assistantBubble.appendChild(card);
    elements.messagesContainer.appendChild(assistantBubble);
    scrollToBottom();

    const selectedModel = elements.selectModel ? elements.selectModel.value : 'gemini-2.0-flash';
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
      summary.className = 'tool-accordion-header';
      summary.innerHTML = `
        <div class="tool-badge-left">
          <span class="tool-status-dot"></span>
          <span>⚙️ <strong>${escapeHtml(event.tool || 'Tool')}</strong></span>
          <span style="opacity:0.7; font-size:11px;">${escapeHtml(event.input?.command || event.input?.action || event.input?.url || '')}</span>
        </div>
        <span class="provider-status-badge" id="badge-${event.callId}">Running...</span>
      `;

      const logBody = document.createElement('div');
      logBody.className = 'tool-accordion-body';
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
          badge.innerText = event.exitCode === 0 ? `✓ ${event.durationMs || 0}ms` : `⛔ Blocked`;
          badge.className = `provider-status-badge ${event.exitCode === 0 ? 'valid' : 'invalid'}`;
        }
        if (event.result && !toolEl.logBody.textContent.includes(event.result)) {
          toolEl.logBody.textContent += `\n[Result] ${event.result}\n`;
        }
        if (event.exitCode === 0) {
          setTimeout(() => { toolEl.details.open = false; }, 1500);
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
          <summary class="tool-accordion-header">
            <div class="tool-badge-left">
              <span class="tool-status-dot"></span>
              <span>⚙️ <strong>${escapeHtml(t.tool || 'Tool')}</strong></span>
            </div>
            <span class="provider-status-badge ${t.exitCode === 0 ? 'valid' : 'invalid'}">${t.exitCode === 0 ? `✓ ${t.durationMs || 0}ms` : '⛔ Blocked'}</span>
          </summary>
          <div class="tool-accordion-body" style="display:block;">${escapeHtml(t.result || 'Executed')}</div>
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
    loadProviderStatus();
    loadSessionsList();
    initViewportKeyboardHandling();
  }

  // Kick off auth check on load
  checkAuthStatus();
})();
