(function initContentScript() {
  'use strict';

  const PANEL_ID = 'codex-overleaf-panel';
  const LEGACY_STORAGE_KEY = 'codexOverleafPanelState';
  const RUN_PROJECT_SYNC_MAX_AGE_MS = 30000;
  const MAX_RUN_EVENTS = 300;
  const pageBridgeReady = injectPageBridge();
  const {
    createSession,
    deleteSession,
    getActiveSession,
    isDisplayableSession,
    normalizePanelState,
    recordSessionResult,
    setActiveSession,
    updateActiveSession
  } = window.CodexOverleafSessionState;
  const { getProjectStorageKey } = window.CodexOverleafStorageKeys;
  const { HIGH_RISK_TYPES, buildChangeSummaryLine, hasSkippedApplyOperations } = window.CodexOverleafSummary;
  const { buildUndoCheckpoint } = window.CodexOverleafUndoOperations;
  const {
    buildHumanCompletionReport,
    mapAgentEventToActivity,
    translateRawError
  } = window.CodexOverleafAgentTranscript;

  let panel = null;
  let state = null;
  let storageKey = LEGACY_STORAGE_KEY;
  let interactionRefreshTimer = null;
  let interactionRefreshAttached = false;
  let activeNativeRequestId = null;
  let currentRunView = null;
  let saveStateTimer = null;
  let contextProject = null;
  let contextLoadId = 0;
  let projectSyncTimer = null;
  let lastMirrorSyncAt = 0;
  let logAutoFollow = true;
  let userScrollIntentUntil = 0;

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'codex-overleaf/open-panel') {
      ensurePanelOpen();
    }
    if (message?.type === 'codex-overleaf/native-event' && message.id === activeNativeRequestId) {
      appendNativeEvent(message.event);
    }
  });

  init();
  setInterval(updateMirrorAge, 10000);

  async function init() {
    storageKey = getProjectStorageKey(LEGACY_STORAGE_KEY, window.location.href);
    state = normalizePanelState(await loadStoredState());
    ensurePanelOpen();
    applyStateToPanel();
    await refreshProbe();
    scheduleProbeRefresh(1200);
    scheduleProbeRefresh(4000);
    scheduleProbeRefresh(9000);
    scheduleProjectSync(15000);
  }

  function ensurePanelOpen() {
    if (!panel) {
      panel = document.createElement('aside');
      panel.id = PANEL_ID;
      panel.innerHTML = `
        <div class="codex-vscode-head">
          <div class="codex-vscode-title">CODEX</div>
          <div class="codex-vscode-head-actions" aria-label="Codex actions">
            <button type="button" data-refresh title="刷新状态" aria-label="刷新状态">↻</button>
            <div class="codex-diagnostics-wrap">
              <button type="button" data-diagnostics-menu title="诊断" aria-label="诊断" aria-expanded="false">⋯</button>
              <div class="codex-diagnostics-menu" data-diagnostics-popover hidden>
                <button type="button" data-diagnostics-native-env>本机环境诊断</button>
                <button type="button" data-diagnostics-page-state>页面状态诊断</button>
                <button type="button" data-diagnostics-snapshot>项目快照诊断</button>
              </div>
            </div>
            <button type="button" data-new-session title="新建会话" aria-label="新建会话">✎</button>
          </div>
        </div>

        <div class="codex-vscode-main" data-main>
          <section class="codex-task-section">
            <div class="codex-section-head">
              <span>任务</span>
              <span data-session-count></span>
            </div>
            <div class="codex-session-list" data-session-list></div>
            <button type="button" class="codex-view-all" data-view-all hidden></button>
          </section>

          <section class="codex-thread-section">
            <div class="codex-thread-title" data-session-label></div>
            <div class="col-log" data-log></div>
          </section>
        </div>

        <div class="codex-probe-line" data-probe-status>Checking Overleaf state...</div>

        <form class="codex-composer" data-composer-form>
          <textarea data-task rows="3" placeholder="问 Codex 任何事。输入 @ 添加上下文"></textarea>
          <div class="codex-context-summary" data-context-summary hidden></div>
          <div class="codex-mode-row">
            <span class="codex-mode-label">模式</span>
            <div class="codex-mode-switch" role="group" aria-label="写入模式">
              <button type="button" data-mode-choice="ask" aria-pressed="false" title="只读取和分析，不写入 Overleaf">只问不改</button>
              <button type="button" data-mode-choice="confirm" aria-pressed="false" title="先给出修改方案，确认后写入">建议修改</button>
              <button type="button" data-mode-choice="auto" aria-pressed="false" title="授权后直接写入，删除仍需确认">自动写入</button>
            </div>
            <select data-mode aria-label="模式" hidden>
              <option value="ask">只问不改</option>
              <option value="confirm">建议修改</option>
              <option value="auto">自动写入</option>
            </select>
          </div>
          <div class="codex-composer-toolbar">
            <button type="button" data-add-context title="添加 @ 上下文" aria-label="添加 @ 上下文" aria-expanded="false">＋</button>
            <label class="codex-review-toggle" title="开启后，写入前会要求 Overleaf 留痕/Reviewing 可用；删除仍需确认。">
              <input type="checkbox" data-require-reviewing>
              <span class="codex-review-label">留痕</span>
            </label>
            <select data-model aria-label="Model">
              <option value="gpt-5.5">GPT-5.5</option>
              <option value="gpt-5.4">GPT-5.4</option>
              <option value="gpt-5.4-mini">GPT-5.4 Mini</option>
              <option value="gpt-5.3-codex">GPT-5.3 Codex</option>
              <option value="gpt-5.3-codex-spark">GPT-5.3 Codex Spark</option>
              <option value="gpt-5.2">GPT-5.2</option>
            </select>
            <select data-reasoning aria-label="Reasoning">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="xhigh">XHigh</option>
            </select>
            <button type="submit" data-run title="发送" aria-label="发送">↑</button>
          </div>
          <div class="codex-context-tray" data-context-tray hidden>
            <div class="codex-context-head">
              <span>@ 上下文</span>
              <button type="button" data-context-refresh title="刷新文件列表" aria-label="刷新文件列表">↻</button>
            </div>
            <div class="codex-context-selection" data-context-selection></div>
            <div class="codex-context-status" data-context-status>输入 @ 添加上下文：@文件、@compile-log、@current-section。</div>
            <div class="codex-context-files" data-context-file-list></div>
          </div>
        </form>
      `;
      document.documentElement.append(panel);
      document.documentElement.classList.add('codex-overleaf-panel-mounted');

      panel.querySelector('[data-new-session]').addEventListener('click', () => startNewSession());
      panel.querySelector('[data-composer-form]').addEventListener('submit', event => {
        event.preventDefault();
        safeRunTask();
      });
      panel.querySelector('[data-run]').addEventListener('click', event => {
        event.preventDefault();
        panel.querySelector('[data-composer-form]')?.requestSubmit();
      });
      panel.querySelector('[data-task]').addEventListener('keydown', event => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          panel.querySelector('[data-composer-form]')?.requestSubmit();
        }
      });
      panel.addEventListener('click', event => event.stopPropagation());
      panel.addEventListener('mousedown', event => event.stopPropagation());
      panel.querySelector('[data-refresh]').addEventListener('click', () => refreshProbe());
      panel.querySelector('[data-diagnostics-menu]').addEventListener('click', () => toggleDiagnosticsMenu());
      panel.querySelector('[data-diagnostics-native-env]').addEventListener('click', () => {
        closeDiagnosticsMenu();
        inspectNativeEnvironment();
      });
      panel.querySelector('[data-diagnostics-page-state]').addEventListener('click', () => {
        closeDiagnosticsMenu();
        inspectPageStateDiagnostics();
      });
      panel.querySelector('[data-diagnostics-snapshot]').addEventListener('click', () => {
        closeDiagnosticsMenu();
        inspectProjectSnapshot();
      });
      panel.querySelector('[data-view-all]').addEventListener('click', () => renderSessionList({ showAll: true }));
      panel.querySelector('[data-add-context]').addEventListener('click', () => toggleContextTray());
      panel.querySelector('[data-context-refresh]').addEventListener('click', () => loadContextFiles({ force: true }));
      for (const button of panel.querySelectorAll('[data-mode-choice]')) {
        button.addEventListener('click', () => {
          selectMode(button.dataset.modeChoice).catch(error => appendPlainLog(`切换模式失败：${error.message}`));
        });
      }

      for (const selector of ['[data-model]', '[data-reasoning]', '[data-mode]', '[data-task]', '[data-require-reviewing]']) {
        panel.querySelector(selector).addEventListener('change', persistPanelInputs);
        panel.querySelector(selector).addEventListener('input', persistPanelInputs);
      }

      installInteractionRefresh();
      installDiagnosticsDismiss();
      installContextDismiss();
      bindLogAutoFollow();
      renderSessionList();
      renderRunHistory();
      renderContextSelection();
    }

    panel.classList.add('is-open');
  }

  function toggleDiagnosticsMenu() {
    const popover = panel?.querySelector('[data-diagnostics-popover]');
    const button = panel?.querySelector('[data-diagnostics-menu]');
    if (!popover || !button) {
      return;
    }

    const open = popover.hidden;
    popover.hidden = !open;
    button.dataset.active = open ? 'true' : 'false';
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function closeDiagnosticsMenu() {
    const popover = panel?.querySelector('[data-diagnostics-popover]');
    const button = panel?.querySelector('[data-diagnostics-menu]');
    if (!popover || !button) {
      return;
    }
    popover.hidden = true;
    button.dataset.active = 'false';
    button.setAttribute('aria-expanded', 'false');
  }

  function installDiagnosticsDismiss() {
    document.addEventListener('click', event => {
      const wrap = panel?.querySelector('.codex-diagnostics-wrap');
      if (!wrap || wrap.contains(event.target)) {
        return;
      }
      closeDiagnosticsMenu();
    }, true);
  }

  function installContextDismiss() {
    document.addEventListener('click', event => {
      if (isContextTrayClickTarget(event.target)) {
        return;
      }
      closeContextTray();
    }, true);
  }

  function bindLogAutoFollow() {
    const log = panel?.querySelector('[data-log]');
    if (!log || log.dataset.autoFollowBound === 'true') {
      return;
    }
    log.dataset.autoFollowBound = 'true';
    log.addEventListener('wheel', markUserScrollIntent, { passive: true });
    log.addEventListener('touchmove', markUserScrollIntent, { passive: true });
    log.addEventListener('pointerdown', markUserScrollIntent, { passive: true });
    log.addEventListener('keydown', event => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
        markUserScrollIntent();
      }
    });
    log.addEventListener('scroll', () => {
      if (Date.now() <= userScrollIntentUntil) {
        logAutoFollow = isLogNearBottom(log);
        return;
      }
      if (isLogNearBottom(log)) {
        logAutoFollow = true;
      }
    }, { passive: true });
  }

  function markUserScrollIntent() {
    userScrollIntentUntil = Date.now() + 1200;
  }

  function isLogNearBottom(log) {
    if (!log) {
      return true;
    }
    return log.scrollHeight - log.scrollTop - log.clientHeight < 48;
  }

  function scrollLogToBottom(options = {}) {
    const log = panel?.querySelector('[data-log]');
    if (!log) {
      return;
    }
    if (options.force || logAutoFollow || isLogNearBottom(log)) {
      log.scrollTop = log.scrollHeight;
      logAutoFollow = true;
    }
  }

  function isContextTrayClickTarget(target) {
    const tray = panel?.querySelector('[data-context-tray]');
    const button = panel?.querySelector('[data-add-context]');
    return Boolean(
      (tray && tray.contains(target)) ||
      (button && button.contains(target))
    );
  }

  function toggleContextTray() {
    const tray = panel?.querySelector('[data-context-tray]');
    const button = panel?.querySelector('[data-add-context]');
    if (!tray || !button) {
      return;
    }

    const open = tray.hidden;
    tray.hidden = !open;
    button.dataset.active = open ? 'true' : 'false';
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
    renderContextSelection();
    if (open) {
      loadContextFiles({ force: false });
    }
  }

  function closeContextTray() {
    const tray = panel?.querySelector('[data-context-tray]');
    const button = panel?.querySelector('[data-add-context]');
    if (!tray || !button) {
      return;
    }
    tray.hidden = true;
    button.dataset.active = 'false';
    button.setAttribute('aria-expanded', 'false');
  }

  async function loadContextFiles(options = {}) {
    const list = panel?.querySelector('[data-context-file-list]');
    if (!list) {
      return;
    }
    if (contextProject && !options.force) {
      renderContextFiles(contextProject);
      return;
    }

    const loadId = ++contextLoadId;
    setContextStatus('正在读取可添加的 @文件...');
    list.textContent = '';

    try {
      const project = await callPageBridge('getProjectFileList', {});
      if (loadId !== contextLoadId) {
        return;
      }
      contextProject = project;
      renderContextFiles(project);
    } catch (error) {
      if (loadId !== contextLoadId) {
        return;
      }
      setContextStatus(`读取文件失败：${error.message}`);
    }
  }

  function renderContextFiles(project) {
    const list = panel?.querySelector('[data-context-file-list]');
    if (!list) {
      return;
    }

    list.textContent = '';
    const files = sortContextFiles(project?.files || [], project?.activePath);
    renderContextSelection();

    if (!files.length) {
      setContextStatus('没有从当前 Overleaf 项目读取到可用文本文件。');
      return;
    }

    const selected = getActiveFocusFiles();
    setContextStatus(selected.length
      ? `已添加 ${selected.length} 个 @file；后续任务会优先围绕它们。`
      : '默认使用整个项目。可添加 @file；@compile-log 和 @current-section 将作为后续上下文能力。');

    for (const file of files) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'codex-context-file';
      button.dataset.path = file.path;
      button.dataset.selected = selected.includes(file.path) ? 'true' : 'false';
      button.setAttribute('aria-pressed', selected.includes(file.path) ? 'true' : 'false');
      button.addEventListener('click', () => selectFocusFile(file.path));

      const name = document.createElement('span');
      name.className = 'codex-context-file-name';
      name.textContent = file.path;

      const meta = document.createElement('span');
      meta.className = 'codex-context-file-meta';
      meta.textContent = file.content ? `${String(file.content).length} chars` : file.source || '';

      button.append(name, meta);
      list.append(button);
    }
  }

  function renderContextSelection() {
    const selection = panel?.querySelector('[data-context-selection]');
    const addButton = panel?.querySelector('[data-add-context]');
    if (!selection || !addButton) {
      return;
    }

    selection.textContent = '';
    const selected = getActiveFocusFiles();
    addButton.dataset.hasFocus = selected.length ? 'true' : 'false';
    addButton.title = selected.length ? `@context：${selected.map(path => `@file:${path}`).join(', ')}` : '添加 @ 上下文';

    const chip = document.createElement('div');
    chip.className = 'codex-context-chip';

    const dot = document.createElement('span');
    dot.className = 'codex-context-dot';
    dot.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.textContent = selected.length ? selected.map(path => `@file:${path}`).join(', ') : '默认：整个项目';
    chip.append(dot, label);

    if (selected.length) {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.dataset.contextClear = '';
      clear.title = '清除全部 @file';
      clear.setAttribute('aria-label', '清除全部 @file');
      clear.textContent = '×';
      clear.addEventListener('click', clearFocusFile);
      chip.append(clear);
    }

    selection.append(chip);
    renderContextSummary();
  }

  function renderContextSummary() {
    const summary = panel?.querySelector('[data-context-summary]');
    if (!summary) {
      return;
    }

    const selected = getActiveFocusFiles();
    summary.textContent = '';
    summary.hidden = selected.length === 0;
    if (!selected.length) {
      return;
    }

    const prefix = document.createElement('span');
    prefix.className = 'codex-context-summary-label';
    prefix.textContent = '@context';
    summary.append(prefix);

    for (const path of selected) {
      const chip = document.createElement('span');
      chip.className = 'codex-context-summary-chip';
      chip.textContent = path;
      summary.append(chip);
    }

    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'codex-context-summary-clear';
    clear.setAttribute('data-context-summary-clear', '');
    clear.title = '清除全部 @file';
    clear.setAttribute('aria-label', '清除全部 @file');
    clear.textContent = '×';
    clear.addEventListener('click', clearFocusFile);
    summary.append(clear);
  }

  async function selectFocusFile(path) {
    if (typeof path !== 'string' || !path.trim()) {
      return;
    }
    const normalizedPath = path.trim();
    const currentFocusFiles = getActiveFocusFiles();
    const nextFocusFiles = currentFocusFiles.includes(normalizedPath)
      ? currentFocusFiles.filter(item => item !== normalizedPath)
      : [...currentFocusFiles, normalizedPath].slice(-5);
    state = updateActiveSession(state, {
      focusFiles: nextFocusFiles
    });
    await saveState();
    renderContextSelection();
    renderContextFiles(contextProject);
  }

  async function clearFocusFile() {
    state = updateActiveSession(state, {
      focusFiles: []
    });
    await saveState();
    renderContextSelection();
    renderContextFiles(contextProject);
  }

  function getActiveFocusFiles() {
    return Array.isArray(state?.session?.focusFiles) ? state.session.focusFiles : [];
  }

  function sortContextFiles(files, activePath) {
    return files
      .filter(file => typeof file?.path === 'string' && file.path.trim())
      .sort((left, right) => {
        if (left.path === activePath) {
          return -1;
        }
        if (right.path === activePath) {
          return 1;
        }
        const leftRank = getContextFileRank(left.path);
        const rightRank = getContextFileRank(right.path);
        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }
        return left.path.localeCompare(right.path);
      });
  }

  function getContextFileRank(path) {
    if (/\.tex$/i.test(path)) {
      return 0;
    }
    if (/\.bib$/i.test(path)) {
      return 1;
    }
    return 2;
  }

  function setContextStatus(text) {
    const status = panel?.querySelector('[data-context-status]');
    if (status) {
      status.textContent = text;
    }
  }

  async function inspectProjectSnapshot() {
    appendLog('Inspecting project snapshot.');
    const project = await callPageBridge('getProjectSnapshot', { force: true });
    appendLog(formatProjectSnapshotLog(project));
    appendProjectWarnings(project);
  }

  async function inspectNativeEnvironment() {
    appendLog('本机环境诊断：正在检查 Codex 和 LaTeX 工具。');
    const response = await sendBackgroundNative({ method: 'bridge.ping', params: {} });
    if (!response?.ok) {
      appendLog(`本机环境诊断失败：${response?.error?.message || 'native host 没有响应'}`);
      return;
    }

    appendLog(formatNativeEnvironmentLog(response.result?.environment));
  }

  function formatNativeEnvironmentLog(environment) {
    if (!environment) {
      return '本机环境：native host 已连接，但没有返回环境详情。';
    }

    const codex = environment.codex?.ok
      ? `Codex 已连接：${environment.codex.path}`
      : 'Codex 未找到：请确认终端里可以运行 codex。';
    const latexTools = environment.latex?.available || [];
    const latex = latexTools.length
      ? `LaTeX 可用：${latexTools.join(', ')}`
      : 'LaTeX 未找到：当前可以编辑文本，但不能本地编译。';
    return `${codex} ${latex}`;
  }

  async function inspectPageStateDiagnostics() {
    appendLog('页面状态诊断：正在读取 Overleaf 连接细节。');
    const probe = await callPageBridge('probe', {
      manualOverride: state?.requireReviewing === false
    });
    appendLog(`诊断摘要：${formatProbeStatusBar(probe)}。`);
    appendReviewingDiagnostics(probe.reviewingDiagnostics);
    appendEditorDiagnostics(probe.editorDiagnostics, probe.projectDiagnostics);
  }

  async function runTask() {
    readPanelInputs();

    const task = state.task.trim();
    if (!task) {
      appendLog('Enter a task first.');
      return;
    }

    setRunning(true);
    currentRunView = startRunView({
      task,
      mode: state.mode,
      model: state.model,
      reasoningEffort: state.reasoningEffort
    });
    clearTaskComposer();
    appendRunEvent({
      title: '我会先理解你的请求，再检查相关 Overleaf 文件。',
      status: 'running',
      detail: {
        '模式': formatModeLabel(state.mode),
        '模型': state.model,
        '推理强度': state.reasoningEffort,
        '要求留痕': state.requireReviewing ? '是' : '否',
        '@context': formatContextItems(getActiveFocusFiles())
      }
    });
    appendRunEvent({
      title: `这轮会优先参考：${formatContextItems(getActiveFocusFiles())}`,
      status: 'completed'
    });

    try {
      appendRunEvent({
        title: '正在同步 Overleaf 项目到本地 Codex workspace。',
        status: 'running'
      });
      const project = await getRunProjectSnapshot();
      appendLog(formatProjectSnapshotUserLog(project));
      const snapshotWarnings = getProjectSnapshotWarnings(project);
      if (snapshotWarnings.blocking.length) {
        for (const warning of snapshotWarnings.blocking) {
          appendLog(`无法继续：${formatProjectSnapshotWarning(warning)}`);
        }
        appendCompletionReport({
          conclusion: '这轮没有继续：没有读到完整的 Overleaf 项目内容。',
          status: 'blocked',
          operations: [],
          applyResults: [],
          nextStep: '请刷新 Overleaf 项目或重新打开要处理的 .tex 文件后再试。'
        });
        finishRunView('已阻止：没有读到完整项目', 'failed');
        return;
      }
      for (const warning of snapshotWarnings.nonBlocking) {
        appendLog(`提示：${formatProjectSnapshotWarning(warning)}`);
      }

      appendRunEvent({ title: '本地 Codex session 开始运行。', status: 'running' });
      const response = await sendNative({
        method: 'codex.run',
        params: {
          projectId: getCurrentProjectId(),
          mode: state.mode,
          task,
          project,
          focusFiles: getActiveFocusFiles(),
          model: state.model,
          reasoningEffort: state.reasoningEffort,
          session: state.session
        }
      });

      if (!response.ok) {
        const translated = translateRawError(response.error.message, { mode: state.mode });
        appendRunEvent({
          title: translated.conclusion,
          status: 'failed',
          technicalDetail: response.error
        });
        appendTechnicalEvent({
          type: 'native.error',
          title: 'Native bridge error',
          status: 'failed',
          detail: response.error
        });
        appendCompletionReport({
          conclusion: translated.conclusion,
          status: 'failed',
          operations: [],
          applyResults: [],
          nextStep: translated.nextStep,
          errorMessage: response.error.message,
          mode: state.mode
        });
        finishRunView('本地 Codex 错误', 'failed');
        return;
      }

      const syncOutcome = await applySyncChangesToOverleaf(response.result.syncChanges || [], project, {
        assistantMessage: response.result.assistantMessage
      });
      scheduleProjectSync(1500);
      finishRunView(syncOutcome.hasSkippedOperations ? '同步完成但有跳过项' : '同步完成', syncOutcome.hasSkippedOperations ? 'failed' : 'completed');
      const activeSession = getActiveSession(state);
      const updatedSession = recordSessionResult(activeSession, {
        task,
        result: syncOutcome.summaryLine
      });
      state = updateActiveSession(state, {
        history: updatedSession.history
      });
      await saveState();
      applyStateToPanel();
    } catch (error) {
      const translated = translateRawError(error.message, { mode: state?.mode });
      appendRunEvent({
        title: translated.conclusion,
        status: 'failed',
        technicalDetail: {
          message: error.message,
          stack: error.stack
        }
      });
      appendTechnicalEvent({
        type: 'task.exception',
        title: 'Task exception',
        status: 'failed',
        detail: {
          message: error.message,
          stack: error.stack
        }
      });
      appendCompletionReport({
        conclusion: translated.conclusion,
        status: 'failed',
        operations: [],
        applyResults: [],
        nextStep: translated.nextStep,
        errorMessage: error.message,
        mode: state?.mode
      });
      finishRunView('任务失败', 'failed');
    } finally {
      setRunning(false);
      activeNativeRequestId = null;
      currentRunView = null;
      saveStateSoon();
    }
  }

  function safeRunTask() {
    if (currentRunView) {
      return;
    }
    runTask().catch(error => {
      setRunning(false);
      activeNativeRequestId = null;
      currentRunView = null;
      console.error('[codex-overleaf] failed to start task', error);
      appendPlainLog(`无法启动 Codex 任务：${error.message}`);
    });
  }

  function renderDiffReview(syncChanges) {
    return new Promise(resolve => {
      const container = document.createElement('div');
      container.className = 'codex-diff-review';
      const fileStates = new Map();

      for (const change of syncChanges) {
        fileStates.set(change.path, true);
        const card = document.createElement('div');
        card.className = 'codex-diff-file';
        card.dataset.path = change.path;
        card.dataset.accepted = 'true';

        const header = document.createElement('div');
        header.className = 'codex-diff-file-header';
        const pathEl = document.createElement('span');
        pathEl.className = 'codex-diff-file-path';
        pathEl.textContent = change.type === 'delete' ? `[delete] ${change.path}` : change.path;
        const actions = document.createElement('div');
        actions.className = 'codex-diff-file-actions';
        const acceptBtn = document.createElement('button');
        acceptBtn.type = 'button';
        acceptBtn.dataset.diffAccept = '';
        acceptBtn.textContent = '✓';
        acceptBtn.title = '接受';
        const rejectBtn = document.createElement('button');
        rejectBtn.type = 'button';
        rejectBtn.dataset.diffReject = '';
        rejectBtn.textContent = '✗';
        rejectBtn.title = '拒绝';

        acceptBtn.addEventListener('click', () => {
          card.dataset.accepted = 'true';
          fileStates.set(change.path, true);
        });
        rejectBtn.addEventListener('click', () => {
          card.dataset.accepted = 'false';
          fileStates.set(change.path, false);
        });

        actions.append(acceptBtn, rejectBtn);
        header.append(pathEl, actions);
        card.append(header);

        if (change.diff?.length) {
          const body = document.createElement('div');
          body.className = 'codex-diff-body';
          for (const hunk of change.diff) {
            const hunkEl = document.createElement('div');
            hunkEl.className = 'codex-diff-hunk';
            for (const line of hunk.lines) {
              const lineEl = document.createElement('div');
              lineEl.className = 'codex-diff-line';
              lineEl.dataset.type = line.type;
              lineEl.textContent = line.text;
              hunkEl.append(lineEl);
            }
            body.append(hunkEl);
          }
          card.append(body);
        }

        container.append(card);
      }

      const toolbar = document.createElement('div');
      toolbar.className = 'codex-diff-toolbar';
      const applyBtn = document.createElement('button');
      applyBtn.type = 'button';
      applyBtn.dataset.diffApplyAll = '';
      applyBtn.textContent = '应用选中';
      const rejectAllBtn = document.createElement('button');
      rejectAllBtn.type = 'button';
      rejectAllBtn.textContent = '全部拒绝';

      applyBtn.addEventListener('click', () => {
        container.remove();
        const accepted = syncChanges.filter(c => fileStates.get(c.path) === true);
        resolve(accepted);
      });
      rejectAllBtn.addEventListener('click', () => {
        container.remove();
        resolve([]);
      });

      toolbar.append(rejectAllBtn, applyBtn);
      container.append(toolbar);

      if (currentRunView?.events) {
        currentRunView.events.append(container);
        scrollLogToBottom();
      }
    });
  }

  async function applySyncChangesToOverleaf(syncChanges = [], project = {}, options = {}) {
    const assistantMessage = cleanFinalAnswer(options.assistantMessage || getLatestAssistantAnswerForCurrentRun());
    let operations = buildSyncApplyOperations(syncChanges, project);
    if (!operations.length) {
      appendRunEvent({
        title: 'Codex 没有产生需要同步回 Overleaf 的文件改动。',
        status: 'completed'
      });
      appendCompletionReport({
        conclusion: assistantMessage || 'Codex 已完成本地处理，没有需要同步回 Overleaf 的改动。',
        status: state.mode === 'ask' ? '只问不改' : 'completed',
        operations: [],
        applyResults: [],
        unchangedReason: assistantMessage ? '没有产生需要同步回 Overleaf 的文件改动。' : '',
        mode: state.mode,
        nextStep: '可以继续追问，或调整 @context 后重新运行。'
      });
      return {
        summaryLine: assistantMessage || '没有需要同步的改动',
        hasSkippedOperations: false
      };
    }

    if (state.mode === 'confirm') {
      appendRunEvent({
        title: `本地 Codex 产生了 ${operations.length} 项改动，请查看差异后确认。`,
        status: 'running'
      });
      const accepted = await renderDiffReview(syncChanges);
      if (!accepted.length) {
        appendRunEvent({
          title: '已取消同步：Overleaf 没有被修改。',
          status: 'completed'
        });
        appendCompletionReport({
          conclusion: '你取消了同步，本地 Codex 改动没有写回 Overleaf。',
          status: 'rejected',
          operations: [],
          applyResults: [],
          mode: state.mode,
          nextStep: '可以重新运行任务，或切换到自动写入后再同步。'
        });
        return {
          summaryLine: '已取消同步',
          hasSkippedOperations: false
        };
      }
      operations = buildSyncApplyOperations(accepted, project);
    }

    const deleteOperations = operations.filter(operation => operation.type === 'delete');
    if (deleteOperations.length) {
      const approved = window.confirm([
        'Codex 要删除 Overleaf 文件，是否允许？',
        '',
        formatOperationFiles(deleteOperations),
        '',
        '未确认删除时，其它改动仍可继续同步。'
      ].join('\n'));
      if (!approved) {
        operations = operations.filter(operation => operation.type !== 'delete');
      }
    }

    if (state.mode === 'auto' && syncChanges.some(c => c.diff?.length)) {
      appendRunEvent({
        title: `本地 Codex 改动预览：${syncChanges.filter(c => c.diff?.length).length} 个文件有差异。`,
        status: 'completed'
      });
    }

    appendOperationsPreview(operations, '同步本地 Codex 改动到 Overleaf');
    const applied = operations.length
      ? await callPageBridge('applyOperations', {
        operations,
        baseFiles: project?.files || []
      })
      : { ok: true, applied: [], skipped: [] };
    appendApplyResult(applied);
    recordUndoFromApply(project, applied);
    const summaryLine = appendChangeSummary({
      notes: '本地 Codex 改动已同步回 Overleaf。',
      operations,
      applyResults: [applied],
      status: 'synced from local Codex workspace'
    });
    appendCompletionReport({
      conclusion: applied.skipped?.length
        ? '本地 Codex 改动已尝试同步回 Overleaf，但有部分项目被跳过。'
        : '本地 Codex 改动已同步回 Overleaf。',
      status: applied.skipped?.length ? 'failed' : 'completed',
      operations,
      applyResults: [applied],
      mode: state.mode,
      nextStep: applied.skipped?.length ? '请查看跳过原因，处理冲突后重试同步。' : '请在 Overleaf 中查看同步后的文件。'
    });

    return {
      summaryLine,
      hasSkippedOperations: hasSkippedApplyOperations([applied])
    };
  }

  function buildSyncApplyOperations(syncChanges = [], project = {}) {
    const existingPaths = new Set((project.files || []).map(file => file.path));
    return (syncChanges || []).map(change => {
      if (change.type === 'delete') {
        return {
          type: 'delete',
          path: change.path,
          reason: '本地 Codex workspace 删除了这个文件。'
        };
      }
      if (change.type === 'write' && existingPaths.has(change.path)) {
        return {
          type: 'edit',
          path: change.path,
          replaceAll: change.content || '',
          reason: '同步本地 Codex workspace 中的文件内容。'
        };
      }
      return {
        type: 'create',
        path: change.path,
        content: change.content || '',
        reason: '同步本地 Codex workspace 中的新文件。'
      };
    }).filter(operation => operation.path);
  }

  function getCurrentProjectId() {
    return window.location.pathname.match(/\/project\/([^/?#]+)/)?.[1] || window.location.href;
  }

  async function handleTaskResult(mode, result, project) {
    const notes = result.notes?.trim() || '';
    if (notes) {
      appendRunEvent({
        title: 'Codex 总结',
        status: 'completed',
        detail: notes
      });
    }
    appendSummary(result.summary);

    if (mode === 'ask') {
      appendRunEvent({
        title: '本轮没有写入，无需撤销。',
        status: 'completed'
      });
      const summaryLine = appendChangeSummary({
        notes,
        operations: [],
        status: '只问不改'
      });
      appendCompletionReport({
        conclusion: notes || '这轮只做了检查和说明，没有写入文件。',
        status: '只问不改',
        notes,
        userReport: result.userReport,
        mode,
        operations: [],
        applyResults: [],
        nextStep: '可以继续追问，或切换到建议修改/自动写入后让 Codex 修改文件。'
      });
      return { status: '只问不改', summaryLine };
    }

    if (result.status === 'requires_task_confirmation') {
      appendPlannedChangeSummary(result.summary, '准备修改');
      const approved = window.confirm(formatSummary('应用修改？', result.summary));
      if (!approved) {
        appendLog('已取消：Codex 没有写入任何文件。');
        const summaryLine = appendChangeSummary({ notes, summary: result.summary, status: 'rejected' });
        appendCompletionReport({
          conclusion: '你取消了这轮修改，Codex 没有写入文件。',
          status: 'rejected',
          notes,
          summary: result.summary,
          userReport: result.userReport,
          mode,
          operations: [],
          applyResults: [],
          nextStep: '可以调整任务描述后重新运行，或切到只问不改先让 Codex 解释方案。'
        });
        return { status: 'rejected', summaryLine };
      }
      const confirmed = result.planId
        ? await sendNative({ method: 'task.confirm', params: { planId: result.planId } })
        : { ok: true, result: { operations: result.operations || [] } };
      if (!confirmed.ok) {
        appendLog(`Confirm failed: ${confirmed.error.message}`);
        const summaryLine = appendChangeSummary({ notes, operations: [], status: 'confirm failed' });
        appendCompletionReport({
          conclusion: '确认后没有拿到可写入的修改。',
          status: 'confirm failed',
          notes,
          userReport: result.userReport,
          mode,
          operations: [],
          applyResults: [],
          nextStep: confirmed.error.message
        });
        return { status: 'confirm failed', summaryLine };
      }
      const operations = confirmed.result.operations || [];
      appendOperationsPreview(operations, '用户已确认，准备写入');
      const applied = await applyTaskOperations(project, operations, { allowHighRisk: true });
      appendApplyResult(applied);
      recordUndoFromApply(project, applied);
      const summaryLine = appendChangeSummary({
        notes,
        operations,
        applyResults: [applied],
        status: 'confirmed and applied'
      });
      appendCompletionReport({
        conclusion: notes || '已按你的确认写入修改。',
        status: 'confirmed and applied',
        notes,
        userReport: result.userReport,
        mode,
        operations,
        applyResults: [applied]
      });
      return {
        status: 'confirmed and applied',
        summaryLine,
        hasSkippedOperations: hasSkippedApplyOperations([applied])
      };
    }

    if (result.status === 'delete_plan_required') {
      const operations = result.operations || [];
      const applyResults = [];
      appendOperationsPreview(operations, '准备先写入非删除修改');
      const applied = await applyTaskOperations(project, operations);
      applyResults.push(applied);
      appendApplyResult(applied);
      recordUndoFromApply(project, applied);
      const approved = window.confirm(formatDeletePlan(result.deletePlan || []));
      if (approved) {
        const pendingOperations = result.pendingOperations || [];
        appendOperationsPreview(pendingOperations, '用户已确认删除，准备写入');
        const deleteApplied = await applyTaskOperations(project, pendingOperations, { allowHighRisk: true });
        applyResults.push(deleteApplied);
        appendApplyResult(deleteApplied);
        recordUndoFromApply(project, deleteApplied);
        appendLog('已按确认删除文件。');
        const summaryLine = appendChangeSummary({
          notes,
          operations: [...operations, ...pendingOperations],
          applyResults,
          status: 'applied with delete plan'
        });
        appendCompletionReport({
          conclusion: notes || '已写入修改，并按你的确认处理删除项。',
          status: 'applied with delete plan',
          notes,
          userReport: result.userReport,
          mode,
          operations: [...operations, ...pendingOperations],
          applyResults
        });
        return {
          status: 'applied with delete plan',
          summaryLine,
          hasSkippedOperations: hasSkippedApplyOperations(applyResults)
        };
      }
      appendLog('已取消删除；非删除修改已保留。');
      const summaryLine = appendChangeSummary({
        notes,
        operations,
        applyResults,
        status: 'applied without deletes',
        deletePlanRejected: true
      });
      appendCompletionReport({
        conclusion: '已保留非删除修改；删除项没有写入。',
        status: 'applied without deletes',
        notes,
        userReport: result.userReport,
        mode,
        operations,
        applyResults,
        deletePlanRejected: true,
        nextStep: '如果仍需要删除文件，请重新运行并单独确认删除。'
      });
      return {
        status: 'applied without deletes',
        summaryLine,
        hasSkippedOperations: hasSkippedApplyOperations(applyResults)
      };
    }

    const operations = result.operations || [];
    appendOperationsPreview(operations, '准备写入');
    const applied = await applyTaskOperations(project, operations, { allowHighRisk: mode === 'confirm' });
    appendApplyResult(applied);
    recordUndoFromApply(project, applied);
    appendLog(mode === 'auto' ? '自动写入任务完成。' : '任务完成。');
    const summaryLine = appendChangeSummary({
      notes,
      operations,
      applyResults: [applied],
      status: result.status || 'completed'
    });
    appendCompletionReport({
      conclusion: notes || '这轮任务已完成。',
      status: result.status || 'completed',
      notes,
      userReport: result.userReport,
      mode,
      operations,
      applyResults: [applied]
    });
    return {
      status: result.status || 'completed',
      summaryLine,
      hasSkippedOperations: hasSkippedApplyOperations([applied])
    };
  }

  async function applyTaskOperations(project, operations, options = {}) {
    const partitioned = partitionOperationsForApply(operations, options);
    if (!partitioned.safe.length) {
      appendRunEvent({
        title: '本轮没有写入，无需撤销。',
        status: 'completed'
      });
    } else {
      appendRunEvent({
        title: '已保存本轮写入前的可恢复版本。',
        status: 'completed',
        detail: {
          '将写入的文件': formatOperationFiles(partitioned.safe)
        }
      });
    }
    const applied = partitioned.safe.length
      ? await callPageBridge('applyOperations', {
        operations: partitioned.safe,
        baseFiles: project?.files || []
      })
      : { ok: true, applied: [], skipped: [] };

    return {
      ...applied,
      ok: applied.ok && partitioned.skipped.length === 0,
      skipped: [
        ...(applied.skipped || []),
        ...partitioned.skipped
      ]
    };
  }

  function partitionOperationsForApply(operations, options = {}) {
    if (options.allowHighRisk) {
      return {
        safe: operations || [],
        skipped: []
      };
    }

    const safe = [];
    const skipped = [];
    for (const operation of operations || []) {
      if (HIGH_RISK_TYPES.includes(operation?.type)) {
        skipped.push({
          operation,
          result: {
            ok: false,
            reason: 'High-risk operation requires explicit approval before application'
          }
        });
      } else {
        safe.push(operation);
      }
    }

    return { safe, skipped };
  }

  async function refreshProbe(options = {}) {
    const probe = await callPageBridge('probe', {
      manualOverride: state?.requireReviewing === false
    });
    const status = panel?.querySelector('[data-probe-status]');
    if (status) {
      status.textContent = formatProbeStatusBar(probe);
      status.dataset.ok = probe.reviewing?.ok && probe.editor?.ok ? 'true' : 'false';
    }
    if (!options.quiet) {
      appendProbeUserStatus(probe);
    } else {
      updateExistingProbeNotice(probe);
    }
    return probe;
  }

  function formatProbeStatusBar(probe) {
    const reviewingOk = probe.reviewing?.ok === true;
    const editorOk = probe.editor?.ok === true;

    if (reviewingOk && editorOk) {
      return '可以运行 · 已读到当前文件';
    }
    if (reviewingOk && !editorOk) {
      return '需要打开一个 .tex 文件';
    }
    if (!reviewingOk && editorOk) {
      return '需要开启 Reviewing';
    }
    return '需要开启 Reviewing 并打开文件';
  }

  function updateMirrorAge() {
    const status = panel?.querySelector('[data-probe-status]');
    if (!status || !lastMirrorSyncAt) {
      return;
    }
    const seconds = Math.round((Date.now() - lastMirrorSyncAt) / 1000);
    const age = seconds < 5 ? '刚刚' : `${seconds}s`;
    const current = status.textContent || '';
    const withoutMirror = current.replace(/ · Mirror:.*$/, '');
    status.textContent = `${withoutMirror} · Mirror: ${age}`;
  }

  function formatModeLabel(mode) {
    if (mode === 'ask') {
      return '只问不改';
    }
    if (mode === 'confirm') {
      return '建议修改';
    }
    if (mode === 'auto') {
      return '自动写入';
    }
    return mode || '未知模式';
  }

  function formatRunStatusText(status) {
    const value = String(status || '');
    const labels = {
      completed: '已完成',
      rejected: '已取消',
      'confirm failed': '确认失败',
      'confirmed and applied': '已应用建议修改',
      'applied with delete plan': '已应用并删除确认项',
      'applied without deletes': '已应用非删除修改',
      '只问不改': '只问不改'
    };
    return labels[value] || value || '已完成';
  }

  function formatContextItems(focusFiles = []) {
    const fileItems = (focusFiles || []).map(path => `@file:${path}`);
    return fileItems.length
      ? fileItems.join(', ')
      : '@whole-project（默认）；可添加 @file、@compile-log、@current-section';
  }

  function appendProbeUserStatus(probe) {
    const { ready, message } = formatProbeUserNotice(probe);
    if (!currentRunView) {
      updateProbeNotice(ready ? '' : message);
      return;
    }
    appendLog(message);
  }

  function updateExistingProbeNotice(probe) {
    if (currentRunView || !panel?.querySelector('[data-probe-notice]')) {
      return;
    }
    const { ready, message } = formatProbeUserNotice(probe);
    updateProbeNotice(ready ? '' : message);
  }

  function formatProbeUserNotice(probe) {
    const reviewingOk = probe.reviewing?.ok === true;
    const editorOk = probe.editor?.ok === true;
    const manualOverride = probe.reviewing?.status === 'manual-override';

    if (reviewingOk && editorOk) {
      return {
        ready: true,
        message: manualOverride
          ? '可以运行：你已确认 Overleaf 已开启留痕，Codex 已读到当前文件。'
          : '可以运行：Codex 已确认 Overleaf Reviewing/Track Changes 已开启，并读到当前文件。'
      };
    }

    if (reviewingOk && !editorOk) {
      return {
        ready: false,
        message: '还差一步：Codex 没读到当前文件。请在 Overleaf 左侧文件列表点开要处理的 .tex 文件（例如 main.tex），再点刷新或直接运行。'
      };
    }

    if (!reviewingOk && editorOk) {
      return {
        ready: false,
        message: '还不能安全写入：Codex 已读到当前文件，但没有确认 Overleaf 已开启 Reviewing/Track Changes。请先打开 Reviewing，或关闭下方的安全检查。'
      };
    }

    return {
      ready: false,
      message: '还不能安全写入：请先在 Overleaf 打开 Reviewing/Track Changes，并在左侧文件列表点开要处理的 .tex 文件（例如 main.tex）。'
    };
  }

  function installInteractionRefresh() {
    if (interactionRefreshAttached) {
      return;
    }
    interactionRefreshAttached = true;

    const refreshAfterPageInteraction = event => {
      if (panel?.contains(event.target)) {
        return;
      }
      scheduleDebouncedProbeRefresh(250);
    };

    document.addEventListener('click', refreshAfterPageInteraction, true);
    document.addEventListener('focusin', refreshAfterPageInteraction, true);
  }

  function scheduleProbeRefresh(delayMs) {
    window.setTimeout(() => {
      refreshProbe({ quiet: true }).catch(error => appendLog(`State refresh failed: ${error.message}`));
    }, delayMs);
  }

  function scheduleProjectSync(delayMs = 30000) {
    window.clearTimeout(projectSyncTimer);
    projectSyncTimer = window.setTimeout(async () => {
      try {
        if (!currentRunView) {
          const project = await callPageBridge('getProjectSnapshot', { maxAgeMs: 30000 });
          if (project?.files?.length) {
            contextProject = project;
            if (!panel?.querySelector('[data-context-tray]')?.hidden) {
              renderContextFiles(contextProject);
            }
            sendBackgroundNative({
              method: 'mirror.sync',
              params: {
                projectId: getCurrentProjectId(),
                project
              }
            }).then(response => {
              if (!response?.ok) {
                return;
              }
              lastMirrorSyncAt = Date.now();
              updateMirrorAge();
            }).catch(() => {});
          }
        }
      } catch {
        // Background sync should never interrupt the visible Codex session.
      } finally {
        scheduleProjectSync(30000);
      }
    }, delayMs);
  }

  async function getRunProjectSnapshot() {
    const project = await callPageBridge('getProjectSnapshot', { maxAgeMs: RUN_PROJECT_SYNC_MAX_AGE_MS });
    if (project?.files?.length) {
      contextProject = project;
    }
    return project;
  }

  function scheduleDebouncedProbeRefresh(delayMs) {
    window.clearTimeout(interactionRefreshTimer);
    interactionRefreshTimer = window.setTimeout(() => {
      refreshProbe({ quiet: true }).catch(error => appendLog(`State refresh failed: ${error.message}`));
    }, delayMs);
  }

  function formatProjectSnapshotLog(project) {
    const files = project.files || [];
    const skipped = project.capabilities?.skipped || [];
    const mode = project.capabilities?.fullProjectSnapshot ? 'project' : 'active file';
    const fileNames = files.slice(0, 5)
      .map(file => `${file.path}:${String(file.content || '').length}/${file.source || 'unknown'}`)
      .join(', ');
    const suffix = files.length > 5 ? `, +${files.length - 5} more` : '';
    const skippedText = skipped.length
      ? `; skipped ${skipped.slice(0, 3).map(item => `${item.path || 'unknown'} (${item.reason || 'no reason'})`).join(', ')}${skipped.length > 3 ? `, +${skipped.length - 3} more` : ''}`
      : '';
    const method = project.capabilities?.method ? ` via ${project.capabilities.method}` : '';
    const docRecords = project.capabilities?.diagnostics?.docRecordCount;
    const docRecordText = Number.isInteger(docRecords) ? `; doc records ${docRecords}` : '';
    return `Snapshot: ${files.length} ${mode} file(s)${method}, chars/source ${fileNames}${suffix}${skippedText}${docRecordText}.`;
  }

  function formatProjectSnapshotUserLog(project) {
    const files = project?.files || [];
    if (!files.length) {
      return '还没有读到 Overleaf 项目文件。请确认项目已加载完成，或在 Overleaf 点开一个 .tex 文件后重试。';
    }

    const activePath = project.activePath ? `，当前文件：${project.activePath}` : '';
    const focusFiles = getActiveFocusFiles();
    const focusText = focusFiles.length ? `，优先处理：${focusFiles.join(', ')}` : '';
    return `已读取 Overleaf 项目：${files.length} 个文本文件${activePath}${focusText}。`;
  }

  function formatProjectSnapshotWarning(warning) {
    if (/No source files were captured/i.test(warning)) {
      return '没有读取到项目源文件。请确认 Overleaf 页面加载完成，或点开一个 .tex 文件后重试。';
    }
    if (/empty or still loading/i.test(warning)) {
      return '读取到的文件内容还在加载中。请等 Overleaf 加载完成后重试。';
    }
    if (/suspiciously short|shorter than 80 characters/i.test(warning)) {
      return '部分文件内容很短，可能还没完全加载。结果可能不完整。';
    }
    if (/identical captured content/i.test(warning)) {
      return '多个文件内容看起来相同，Overleaf 文件切换可能没有成功。请刷新页面后重试。';
    }
    if (/were skipped/i.test(warning)) {
      return '有些项目文件被跳过，通常是图片、PDF 或无法读取的文件。';
    }
    return warning;
  }

  function appendEditorDiagnostics(editorDiagnostics, projectDiagnostics) {
    if (editorDiagnostics) {
      const active = editorDiagnostics.active;
      appendLog(`Editor probe: active ${active?.tag || 'none'} ${active?.ariaLabel || active?.className || ''} len=${active?.valueLength || 0}; textareas=${editorDiagnostics.textareaCount || 0}; editables=${editorDiagnostics.editableCount || 0}; iframes=${editorDiagnostics.iframeCount || 0}.`);
      if (editorDiagnostics.documentStats) {
        const stats = editorDiagnostics.documentStats;
        appendLog(`DOM stats: elements=${stats.elementCount || 0}; textareas=${stats.textareaCount || 0}; cm=${stats.cmCount || 0}; role textbox=${stats.roleTextboxCount || 0}.`);
      }
      if (editorDiagnostics.unstableStore) {
        const store = editorDiagnostics.unstableStore;
        const readable = (store.readable || [])
          .map(item => `${item.path}:${item.present ? item.type : 'missing'}`)
          .join(', ');
        appendLog(`Overleaf store: ${store.present ? 'present' : 'missing'}${readable ? `; ${readable}` : ''}.`);
      }
      if (editorDiagnostics.codeMirrorView) {
        const view = editorDiagnostics.codeMirrorView;
        appendLog(`CodeMirror view: docLength=${view.docLength || 0}; dispatch=${Boolean(view.hasDispatch)}; source=${view.source || 'unknown'}.`);
      }
      if (editorDiagnostics.globals) {
        const globals = editorDiagnostics.globals;
        appendLog(`Overleaf globals: overleaf=${globals.overleaf || 'missing'}; Overleaf=${globals.Overleaf || 'missing'}; _ide=${globals._ide || 'missing'}.`);
      }
      for (const item of [...(editorDiagnostics.textareas || []), ...(editorDiagnostics.editables || [])].slice(0, 3)) {
        appendLog(`Editor candidate: ${item.tag || 'node'} ${item.ariaLabel || item.className || item.id || ''} len=${item.valueLength || 0}.`);
      }
    }
    if (projectDiagnostics) {
      const records = projectDiagnostics.docRecords || [];
      appendLog(`Project probe: doc records=${projectDiagnostics.docRecordCount || 0}; roots=${(projectDiagnostics.internalRootKeys || []).slice(0, 6).join(', ') || 'none'}.`);
      for (const record of records.slice(0, 4)) {
        appendLog(`Doc record: ${record.path} id=${record.id} source=${record.source || 'internal'}.`);
      }
    }
  }

  function appendProjectWarnings(project) {
    const warnings = getProjectSnapshotWarnings(project);
    for (const warning of warnings.blocking) {
      appendLog(`Snapshot blocked: ${warning}`);
    }
    for (const warning of warnings.nonBlocking) {
      appendLog(`Snapshot warning: ${warning}`);
    }
  }

  function getProjectSnapshotWarnings(project) {
    const files = project?.files || [];
    const skipped = project?.capabilities?.skipped || [];
    const blocking = [];
    const nonBlocking = [];

    if (!files.length) {
      blocking.push('No source files were captured.');
      return { blocking, nonBlocking };
    }

    const unusable = files.filter(file => !window.CodexOverleafProjectFiles.isUsableProjectFileContent(file.content));
    if (unusable.length === files.length) {
      blocking.push('Captured file contents are empty or still loading.');
    } else if (unusable.length) {
      nonBlocking.push(`${unusable.length} file(s) have empty/loading content.`);
    }

    const shortFiles = files.filter(file => String(file.content || '').trim().length < 80);
    if (shortFiles.length === files.length) {
      blocking.push('Every captured file is suspiciously short; Overleaf editor content was not read correctly.');
    } else if (shortFiles.length) {
      nonBlocking.push(`${shortFiles.length} captured file(s) are shorter than 80 characters.`);
    }

    if (files.length > 1 && uniqueContentSignatures(files).length <= 1) {
      blocking.push('Multiple paths have identical captured content; file switching likely failed.');
    }

    if (skipped.length) {
      nonBlocking.push(`${skipped.length} project file(s) were skipped.`);
    }

    return { blocking, nonBlocking };
  }

  function uniqueContentSignatures(files) {
    const signatures = files.map(file => {
      const content = String(file.content || '');
      return `${content.length}:${content.slice(0, 120)}:${content.slice(-120)}`;
    });
    return Array.from(new Set(signatures));
  }

  function appendReviewingDiagnostics(diagnostics) {
    if (!diagnostics) {
      appendLog('Probe diagnostics unavailable.');
      return;
    }

    appendLog(`Probe saw ${diagnostics.controlCount || 0} controls; body Reviewing=${Boolean(diagnostics.bodyTextHasReviewing)}, text Reviewing=${Boolean(diagnostics.textContentHasReviewing)}.`);
    const controls = diagnostics.reviewLikeControls || [];
    if (!controls.length) {
      appendLog('Probe did not see review/track/suggest controls in the page DOM.');
      return;
    }

    for (const control of controls.slice(0, 4)) {
      const label = [
        control.text,
        control.ariaLabel && `aria:${control.ariaLabel}`,
        control.title && `title:${control.title}`,
        control.dataTestId && `test:${control.dataTestId}`,
        control.id && `id:${control.id}`
      ].filter(Boolean).join(' | ');
      appendLog(`Review-like ${control.tag || 'node'}: ${label || control.htmlSnippet || '(no label)'}`);
    }
  }

  function sendNative(payload) {
    const id = crypto.randomUUID();
    activeNativeRequestId = id;
    return chrome.runtime.sendMessage({
      type: 'codex-overleaf/native-request',
      payload: {
        id,
        ...payload
      }
    });
  }

  function sendBackgroundNative(payload) {
    const id = crypto.randomUUID();
    return chrome.runtime.sendMessage({
      type: 'codex-overleaf/native-request',
      payload: {
        id,
        ...payload
      }
    });
  }

  async function callPageBridge(method, params) {
    try {
      await pageBridgeReady;
    } catch (error) {
      return {
        ok: false,
        error: `Page bridge unavailable: ${error.message}`
      };
    }
    const id = crypto.randomUUID();
    window.postMessage({
      source: 'codex-overleaf/content',
      id,
      method,
      params
    }, window.location.origin);

    return new Promise(resolve => {
      const timeoutMs = method === 'getProjectSnapshot' ? 60000 : 8000;
      const timeout = window.setTimeout(() => {
        window.removeEventListener('message', onMessage);
        resolve({ ok: false, error: 'Page bridge timed out' });
      }, timeoutMs);

      function onMessage(event) {
        if (event.source !== window || event.data?.source !== 'codex-overleaf/page' || event.data.id !== id) {
          return;
        }
        window.clearTimeout(timeout);
        window.removeEventListener('message', onMessage);
        resolve(event.data.result);
      }

      window.addEventListener('message', onMessage);
    });
  }

  async function injectPageBridge() {
    await injectScriptOnce('src/shared/reviewing.js', 'codex-overleaf-reviewing-script');
    await injectScriptOnce('src/shared/projectFiles.js', 'codex-overleaf-project-files-script');
    await injectScriptOnce('src/shared/staleGuard.js', 'codex-overleaf-stale-guard-script');
    await injectScriptOnce('src/pageBridge.js', 'codex-overleaf-page-bridge-script');
  }

  function injectScriptOnce(src, id) {
    return new Promise((resolve, reject) => {
      if (document.getElementById(id)) {
        resolve();
        return;
      }
      const script = document.createElement('script');
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error(`Timed out loading ${src}`));
      }, 8000);
      function cleanup() {
        window.clearTimeout(timeout);
        script.onload = null;
        script.onerror = null;
        script.remove();
      }
      script.id = id;
      script.src = chrome.runtime.getURL(src);
      script.onload = () => {
        cleanup();
        resolve();
      };
      script.onerror = () => {
        cleanup();
        reject(new Error(`Failed to load ${src}`));
      };
      (document.head || document.documentElement).append(script);
    });
  }

  async function loadStoredState() {
    const keys = storageKey === LEGACY_STORAGE_KEY
      ? [LEGACY_STORAGE_KEY]
      : [storageKey, LEGACY_STORAGE_KEY];
    const stored = await chrome.storage.local.get(keys);
    return stored[storageKey] || stored[LEGACY_STORAGE_KEY] || {};
  }

  async function saveState() {
    await chrome.storage.local.set({ [storageKey]: state });
  }

  function saveStateSoon() {
    if (saveStateTimer) {
      clearTimeout(saveStateTimer);
    }
    saveStateTimer = setTimeout(() => {
      saveStateTimer = null;
      saveState();
    }, 120);
  }

  async function persistPanelInputs() {
    readPanelInputs();
    await saveState();
    syncModeControls();
    applySessionLabel();
    renderSessionList();
  }

  async function selectMode(mode) {
    if (!['ask', 'confirm', 'auto'].includes(mode)) {
      return;
    }
    const modeSelect = panel?.querySelector('[data-mode]');
    if (!modeSelect) {
      return;
    }
    modeSelect.value = mode;
    syncModeControls();
    await persistPanelInputs();
  }

  function syncModeControls() {
    const currentMode = panel?.querySelector('[data-mode]')?.value || state?.mode || 'ask';
    panel?.querySelectorAll('[data-mode-choice]').forEach(button => {
      const active = button.dataset.modeChoice === currentMode;
      button.dataset.active = active ? 'true' : 'false';
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }

  function readPanelInputs() {
    state = updateActiveSession(state, {
      model: panel.querySelector('[data-model]').value,
      reasoningEffort: panel.querySelector('[data-reasoning]').value,
      mode: panel.querySelector('[data-mode]').value,
      task: panel.querySelector('[data-task]').value,
      requireReviewing: panel.querySelector('[data-require-reviewing]').checked
    });
  }

  function clearTaskComposer() {
    const taskInput = panel?.querySelector('[data-task]');
    if (taskInput) {
      taskInput.value = '';
    }
    state = updateActiveSession(state, { task: '' });
    saveStateSoon();
  }

  function applyStateToPanel() {
    panel.querySelector('[data-model]').value = state.model;
    panel.querySelector('[data-reasoning]').value = state.reasoningEffort;
    panel.querySelector('[data-mode]').value = state.mode;
    panel.querySelector('[data-task]').value = state.task;
    panel.querySelector('[data-require-reviewing]').checked = state.requireReviewing;
    syncModeControls();
    applySessionLabel();
    renderSessionList();
    renderRunHistory();
    renderContextSelection();
    renderContextSummary();
    if (!panel.querySelector('[data-context-tray]')?.hidden) {
      renderContextFiles(contextProject);
    }
  }

  function applySessionLabel() {
    const label = panel.querySelector('[data-session-label]');
    const active = getActiveSession(state);
    label.textContent = active && isDisplayableSession(active) ? active.title : '';
  }

  async function startNewSession() {
    if (currentRunView) {
      appendPlainLog('Finish the current Codex task before starting a new session.');
      return;
    }
    readPanelInputs();
    const session = createSession({
      mode: state.mode,
      model: state.model,
      reasoningEffort: state.reasoningEffort,
      requireReviewing: state.requireReviewing
    });
    state = normalizePanelState({
      ...state,
      sessions: [...(state.sessions || []), session].slice(-20),
      activeSessionId: session.id
    });
    await saveState();
    applyStateToPanel();
  }

  async function switchSession(sessionId) {
    if (currentRunView) {
      appendPlainLog('Finish the current Codex task before switching sessions.');
      return;
    }
    readPanelInputs();
    state = setActiveSession(state, sessionId);
    await saveState();
    applyStateToPanel();
  }

  async function deleteSessionWithConfirm(sessionId) {
    if (currentRunView) {
      appendPlainLog('Finish the current Codex task before deleting a session.');
      return;
    }
    const target = (state.sessions || []).find(session => session.id === sessionId);
    if (!target) {
      return;
    }

    const approved = window.confirm([
      'Delete this Codex session?',
      '',
      target.title || 'New task',
      '',
      'This deletes local session history and run records for this Overleaf project. It does not modify Overleaf files.'
    ].join('\n'));
    if (!approved) {
      return;
    }

    state = deleteSession(state, sessionId);
    await saveState();
    applyStateToPanel();
  }

  function setRunning(running) {
    panel.querySelector('[data-run]').disabled = running;
    panel.querySelector('[data-new-session]').disabled = running;
    panel.querySelector('[data-diagnostics-snapshot]').disabled = running;
    if (running) {
      closeDiagnosticsMenu();
    }
    panel.dataset.running = running ? 'true' : 'false';
  }

  function startRunView({ task, mode, model, reasoningEffort }) {
    logAutoFollow = true;
    userScrollIntentUntil = 0;
    const record = {
      id: createRunId(),
      task,
      mode,
      model,
      reasoningEffort,
      status: 'running',
      statusText: '处理中',
      startedAt: new Date().toISOString(),
      finishedAt: '',
      events: [],
      undoOperations: [],
      undoStatus: ''
    };
    const active = getActiveSession(state);
    const title = active?.title && active.title !== 'New task'
      ? active.title
      : truncateRunTitle(task);
    state = updateActiveSession(state, {
      runs: [...(state.runs || []), record].slice(-20),
      title
    });
    saveStateSoon();

    const log = panel.querySelector('[data-log]');
    removeEmptyRunsMessage(log);
    const root = renderRunCard(record);
    log.append(root);
    scrollLogToBottom({ force: true });
    renderSessionList();
    applySessionLabel();

    return {
      recordId: record.id,
      root,
      runProcess: root.querySelector('[data-run-process]'),
      processLabel: root.querySelector('[data-run-process-summary]'),
      events: root.querySelector('[data-run-events]'),
      report: root.querySelector('[data-run-report]'),
      status: root.querySelector('[data-run-status]'),
      startedAt: Date.now()
    };
  }

  function finishRunView(text, status) {
    if (!currentRunView) {
      return;
    }
    const record = findRunRecord(currentRunView.recordId);
    const statusText = formatProcessedSummary(status, Date.now() - currentRunView.startedAt);
    if (record) {
      record.status = status;
      record.statusText = statusText;
      record.finishedAt = new Date().toISOString();
      saveStateSoon();
      renderSessionList();
    }
    currentRunView.root.dataset.status = status;
    currentRunView.root.title = [
      text,
      record?.mode ? `模式：${formatModeLabel(record.mode)}` : '',
      record?.model,
      record?.reasoningEffort
    ].filter(Boolean).join(' · ');
    collapseRunProcess(currentRunView, statusText);
  }

  function collapseRunProcess(view, statusText) {
    const runProcess = view?.runProcess || view?.root?.querySelector('[data-run-process]');
    if (runProcess) {
      runProcess.open = false;
    }
    const statusEl = view?.status || view?.root?.querySelector('[data-run-status]');
    if (statusEl) {
      statusEl.textContent = statusText;
    }
  }

  function formatProcessedSummary(status, elapsedMs) {
    const elapsed = formatElapsed(elapsedMs);
    if (status === 'failed') {
      return `处理失败 ${elapsed}`;
    }
    if (status === 'running') {
      return `处理中 ${elapsed}`;
    }
    return `已处理 ${elapsed}`;
  }

  function appendNativeEvent(event) {
    if (!event) {
      return;
    }

    const activity = mapAgentEventToActivity(event);
    if (!activity?.visible || activity.kind === 'technical') {
      return;
    }

    appendRunEvent({
      kind: activity.kind || 'activity',
      title: activity.title,
      status: activity.status || 'running',
      detail: activity.detail,
      technicalDetail: activity.technicalDetail,
      streamKey: activity.streamKey,
      streamRole: activity.streamRole,
      appendText: activity.appendText,
      replaceText: activity.replaceText
    });
  }

  function appendTechnicalEvent(event) {
    void event;
  }

  function normalizeRawAgentEvent(event) {
    return {
      type: event?.type || 'unknown',
      title: event?.title || '',
      status: event?.status || '',
      timestamp: event?.timestamp || '',
      detail: event?.detail || {}
    };
  }

  function appendRunEvent(input = {}) {
    const { title, status = 'info', detail, timestamp } = input;
    if (!currentRunView?.events) {
      appendPlainLog(title || '');
      return;
    }

    const event = {
      title: title || 'Event',
      status,
      detail,
      timestamp: timestamp || new Date().toISOString(),
      kind: input.kind || 'activity',
      technicalDetail: input.technicalDetail,
      streamKey: input.streamKey,
      streamRole: input.streamRole,
      appendText: input.appendText,
      replaceText: input.replaceText
    };
    const record = findRunRecord(currentRunView.recordId);
    let renderedEvent = event;
    if (record) {
      renderedEvent = event.kind === 'stream'
        ? upsertRunStreamRecordEvent(record, event)
        : event;
      if (event.kind !== 'stream') {
        record.events = [...(record.events || []), event].slice(-MAX_RUN_EVENTS);
      }
      saveStateSoon();
    }

    appendRunEventToView(currentRunView, renderedEvent);
    scrollLogToBottom();
  }

  function appendRunEventToView(view, event) {
    if (event.kind === 'report') {
      view.report.hidden = false;
      view.report.replaceChildren(renderCompletionReport(event));
      return;
    }
    if (event.kind === 'technical') {
      return;
    }
    if (event.kind === 'stream') {
      upsertStreamEvent(view, event);
      return;
    }
    view.events.append(renderRunEvent(event));
    appendEventTechnicalDetail(view, event);
  }

  function upsertRunStreamRecordEvent(record, event) {
    const streamKey = event.streamKey || event.streamRole || 'codex-stream';
    const events = Array.isArray(record.events) ? record.events : [];
    const existing = [...events].reverse().find(item => item.kind === 'stream' && item.streamKey === streamKey);
    if (existing) {
      existing.title = event.replaceText
        ? event.title
        : appendStreamText(existing.title, event.title);
      existing.status = event.status || existing.status || 'running';
      existing.timestamp = event.timestamp || existing.timestamp;
      existing.streamRole = event.streamRole || existing.streamRole;
      return existing;
    }

    const next = {
      ...event,
      streamKey,
      title: event.title || ''
    };
    delete next.appendText;
    delete next.replaceText;
    record.events = [...events, next].slice(-MAX_RUN_EVENTS);
    return next;
  }

  function appendStreamText(current, delta) {
    const left = String(current || '');
    const right = String(delta || '');
    if (!left) {
      return right;
    }
    if (!right) {
      return left;
    }
    return `${left}${right}`;
  }

  function getLatestAssistantAnswerForCurrentRun() {
    const record = currentRunView?.recordId ? findRunRecord(currentRunView.recordId) : null;
    const events = Array.isArray(record?.events) ? record.events : [];
    const assistant = [...events].reverse().find(event =>
      event.kind === 'stream' &&
      event.streamRole === 'assistant' &&
      cleanFinalAnswer(event.title)
    );
    return cleanFinalAnswer(assistant?.title || '');
  }

  function cleanFinalAnswer(value) {
    return String(value || '').trim();
  }

  function renderSessionList({ showAll = false } = {}) {
    const list = panel?.querySelector('[data-session-list]');
    if (!list) {
      return;
    }

    const sessions = (state.sessions || []).filter(isDisplayableSession);
    const visibleSessions = showAll ? sessions : sessions.slice(-3).reverse();
    const count = panel.querySelector('[data-session-count]');
    if (count) {
      count.textContent = sessions.length ? `${sessions.length}` : '';
    }

    list.replaceChildren();
    for (const session of visibleSessions) {
      const row = document.createElement('div');
      row.className = 'codex-session-row';
      row.dataset.active = session.id === state.activeSessionId ? 'true' : 'false';
      row.innerHTML = `
        <button type="button" class="codex-session-switch">
          <span class="codex-session-row-title"></span>
          <time></time>
        </button>
        <button type="button" class="codex-session-delete" title="Delete session" aria-label="Delete session">×</button>
      `;
      row.querySelector('.codex-session-row-title').textContent = session.title || 'New task';
      row.querySelector('time').textContent = formatSessionTime(session.updatedAt || session.createdAt);
      row.querySelector('.codex-session-switch').addEventListener('click', () => switchSession(session.id));
      row.querySelector('.codex-session-delete').addEventListener('click', event => {
        event.stopPropagation();
        deleteSessionWithConfirm(session.id);
      });
      list.append(row);
    }

    const viewAll = panel.querySelector('[data-view-all]');
    if (viewAll) {
      viewAll.hidden = showAll || sessions.length <= 3;
      viewAll.textContent = `查看全部（${sessions.length} 个）`;
    }
  }

  function renderRunHistory() {
    const log = panel?.querySelector('[data-log]');
    if (!log) {
      return;
    }
    log.replaceChildren();
    if (!state.runs?.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-runs';
      const icon = document.createElement('img');
      icon.className = 'codex-empty-icon';
      icon.alt = '';
      icon.setAttribute('aria-hidden', 'true');
      icon.src = chrome.runtime.getURL('assets/icons/codex-overleaf-icon.png');
      const label = document.createElement('div');
      label.textContent = '开始一个 Codex 任务';
      empty.append(icon, label);
      log.append(empty);
      return;
    }
    for (const run of state.runs) {
      log.append(renderRunCard(run));
    }
    scrollLogToBottom({ force: true });
  }

  function renderRunCard(run) {
    const root = document.createElement('section');
    root.className = 'transcript-turn run-card';
    root.dataset.status = run.status || 'completed';
    root.dataset.runId = run.id;
    root.title = [
      `模式：${formatModeLabel(run.mode)}`,
      run.model,
      run.reasoningEffort,
      run.startedAt ? formatEventTime(run.startedAt) : ''
    ].filter(Boolean).join(' · ');
    root.innerHTML = `
      <div class="transcript-turn-main">
        <div class="run-prompt" data-run-task></div>
        <div class="run-turn-meta">
          <button type="button" data-run-undo hidden>撤销本轮写入</button>
        </div>
        <details class="run-process" data-run-process>
          <summary data-run-process-summary>
            <span class="run-status" data-run-status></span>
          </summary>
          <div class="run-activity-list" data-run-events></div>
        </details>
        <div class="run-report" data-run-report hidden></div>
      </div>
    `;

    root.querySelector('[data-run-task]').textContent = run.task || '';
    root.querySelector('[data-run-status]').textContent = getRunStatusText(run);
    const process = root.querySelector('[data-run-process]');
    process.open = run.status === 'running';

    const events = root.querySelector('[data-run-events]');
    const report = root.querySelector('[data-run-report]');
    for (const event of run.events || []) {
      if (event.kind === 'report') {
        report.hidden = false;
        report.replaceChildren(renderCompletionReport(event));
      } else if (event.kind === 'technical') {
        continue;
      } else if (event.kind === 'stream') {
        upsertStreamEvent({ events }, event);
      } else {
        events.append(renderRunEvent(event));
      }
    }

    configureUndoButton(root, run);
    return root;
  }

  function getRunStatusText(run = {}) {
    if (run.statusText) {
      return run.statusText;
    }
    if (run.status === 'running') {
      return '处理中';
    }
    if (run.startedAt && run.finishedAt) {
      return formatProcessedSummary(run.status || 'completed', new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime());
    }
    return run.status === 'failed' ? '处理失败' : '已处理';
  }

  function renderRunEvent(event) {
    return renderActivityLine(event);
  }

  function upsertStreamEvent(view, event) {
    if (!view?.events) {
      return;
    }
    const streamKey = event.streamKey || event.streamRole || 'codex-stream';
    const selector = `[data-stream-key="${cssEscape(streamKey)}"]`;
    const existing = view.events.querySelector(selector);
    if (existing) {
      existing.dataset.status = event.status || 'running';
      existing.dataset.streamRole = event.streamRole || '';
      const text = existing.querySelector('[data-stream-text]');
      if (text) {
        text.textContent = event.title || '';
      }
      return;
    }
    view.events.append(renderStreamEvent({ ...event, streamKey }));
  }

  function renderStreamEvent(event) {
    const row = document.createElement('div');
    row.className = 'run-stream';
    row.dataset.status = event.status || 'running';
    row.dataset.streamKey = event.streamKey || event.streamRole || 'codex-stream';
    row.dataset.streamRole = event.streamRole || '';

    const text = document.createElement('div');
    text.className = 'run-stream-text';
    text.dataset.streamText = '';
    text.textContent = event.title || '';

    row.append(text);
    return row;
  }

  function renderActivityLine(event) {
    const row = document.createElement('div');
    row.className = 'run-activity';
    row.dataset.status = event.status || 'info';
    row.dataset.kind = event.kind || 'activity';
    row.title = buildActivityTooltip(event);

    const marker = document.createElement('span');
    marker.className = 'run-activity-dot';
    marker.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'run-activity-title';
    label.textContent = event.title || 'Event';

    const time = document.createElement('time');
    time.className = 'run-activity-time';
    time.textContent = event.timestamp ? formatEventTime(event.timestamp) : '';

    row.append(marker, label, time);
    return row;
  }

  function appendEventTechnicalDetail(view, event) {
    void view;
    void event;
  }

  function hasEventTechnicalDetail(event) {
    return hasNonEmptyDetail(event?.detail) || hasNonEmptyDetail(event?.technicalDetail);
  }

  function hasNonEmptyDetail(value) {
    if (value === undefined || value === null || value === '') {
      return false;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    if (typeof value === 'object') {
      return Object.keys(value).length > 0;
    }
    return true;
  }

  function renderTechnicalEvent(event) {
    const block = document.createElement('section');
    block.className = 'run-technical-event';
    block.dataset.status = event.status || 'info';

    const title = document.createElement('div');
    title.className = 'run-technical-event-title';
    title.textContent = event.title || '技术详情';

    const body = document.createElement('pre');
    body.textContent = formatEventDetail(buildTechnicalEventDetail(event));
    block.append(title, body);
    return block;
  }

  function buildTechnicalEventDetail(event) {
    if (event?.kind === 'technical') {
      return event.detail || {};
    }

    const detail = {
      '步骤': event?.title || '',
      '状态': event?.status || ''
    };
    if (event?.timestamp) {
      detail['时间'] = formatEventTime(event.timestamp);
    }
    if (hasNonEmptyDetail(event?.detail)) {
      detail['内容'] = event.detail;
    }
    if (hasNonEmptyDetail(event?.technicalDetail)) {
      detail['原始事件'] = event.technicalDetail;
    }
    return detail;
  }

  function buildActivityTooltip(event) {
    return [
      event?.title || '',
      event?.timestamp ? formatEventTime(event.timestamp) : ''
    ].filter(Boolean).join('\n');
  }

  function renderCompletionReport(event) {
    const report = document.createElement('section');
    report.className = 'run-completion-report';
    report.dataset.status = event.status || 'completed';

    const body = document.createElement('div');
    body.className = 'run-final-answer';
    body.textContent = formatEventDetail(event.detail || {});
    report.append(body);
    return report;
  }

  function configureUndoButton(root, run) {
    const existing = root.querySelector('[data-run-undo]');
    const button = existing.cloneNode(true);
    existing.replaceWith(button);
    const undoCount = run.undoOperations?.length || 0;
    if (!undoCount && run.undoStatus !== 'applied') {
      button.hidden = true;
      return;
    }

    button.hidden = false;
    button.disabled = run.undoStatus === 'running' || run.undoStatus === 'applied';
    button.textContent = run.undoStatus === 'applied' ? '已撤销' : '撤销本轮写入';
    button.addEventListener('click', event => {
      event.stopPropagation();
      undoRun(run.id);
    });
  }

  function refreshRunCard(runId) {
    const log = panel?.querySelector('[data-log]');
    const existing = log?.querySelector(`[data-run-id="${cssEscape(runId)}"]`);
    const run = findRunRecord(runId);
    if (!log || !existing || !run) {
      return;
    }
    existing.replaceWith(renderRunCard(run));
  }

  async function undoRun(runId) {
    const run = findRunRecord(runId);
    if (!run?.undoOperations?.length || run.undoStatus === 'applied') {
      return;
    }

    const approved = window.confirm([
      '撤销本轮写入？',
      '',
      truncateRunTitle(run.task),
      '',
      `将撤销本轮对 ${formatOperationFiles(run.undoOperations)} 的写入。`
    ].join('\n'));
    if (!approved) {
      return;
    }

    if (state.requireReviewing) {
      const probe = await refreshProbe({ quiet: true });
      if (!probe.reviewing?.ok) {
        appendRunRecordEvent(runId, {
          title: '无法撤销：没有确认 Overleaf 已开启 Reviewing/Track Changes',
          status: 'failed',
          detail: { '来源': probe.reviewing?.source || 'none' }
        });
        return;
      }
    }

    setRunUndoStatus(runId, 'running');
    appendRunRecordEvent(runId, {
      title: '开始撤销本轮写入',
      status: 'running',
      detail: { '将撤销': formatOperationFiles(run.undoOperations) }
    });

    const result = await callPageBridge('applyOperations', {
      operations: run.undoOperations,
      baseFiles: run.undoBaseFiles || []
    });
    appendRunRecordEvent(runId, {
      title: `撤销结果：已撤销 ${result.applied?.length || 0} 项，跳过 ${result.skipped?.length || 0} 项`,
      status: result.skipped?.length ? 'failed' : 'completed',
      detail: {
        '已撤销': (result.applied || []).map(item => ({
          '动作': formatOperationType(item.operation?.type),
          '文件': item.operation?.path
        })),
        '跳过': (result.skipped || []).map(item => ({
          '动作': formatOperationType(item.operation?.type),
          '文件': item.operation?.path,
          '原因': item.result?.reason || item.result?.error || '未知原因'
        }))
      }
    });
    setRunUndoStatus(runId, result.skipped?.length ? 'partial' : 'applied');
  }

  function recordUndoFromApply(project, applyResult) {
    if (!currentRunView?.recordId || !applyResult?.applied?.length) {
      return;
    }
    const appliedOperations = applyResult.applied
      .map(item => item.operation)
      .filter(Boolean);
    const record = findRunRecord(currentRunView.recordId);
    if (!record) {
      return;
    }

    const combinedAppliedOperations = [
      ...(Array.isArray(record.appliedOperations) ? record.appliedOperations : []),
      ...appliedOperations
    ];
    const checkpoint = buildUndoCheckpoint(project, combinedAppliedOperations);
    if (!checkpoint.undoOperations.length) {
      return;
    }

    record.appliedOperations = combinedAppliedOperations;
    record.undoOperations = checkpoint.undoOperations;
    record.undoBaseFiles = checkpoint.undoBaseFiles;
    record.undoStatus = '';
    refreshRunCardControls(record.id);
    appendRunEvent({
      title: `已创建撤销点：可撤销本轮 ${record.undoOperations.length} 项写入`,
      status: 'completed',
      detail: checkpoint.undoOperations.map(operation => ({
        '动作': formatOperationType(operation.type),
        '文件': operation.path,
        '目标': operation.to,
        '原因': operation.reason
      }))
    });
  }

  function appendRunRecordEvent(runId, event) {
    const record = findRunRecord(runId);
    if (!record) {
      return;
    }
    const normalized = {
      title: event.title || 'Event',
      status: event.status || 'info',
      detail: event.detail,
      timestamp: event.timestamp || new Date().toISOString(),
      kind: event.kind || 'activity',
      technicalDetail: event.technicalDetail
    };
    record.events = [...(record.events || []), normalized].slice(-MAX_RUN_EVENTS);
    saveStateSoon();

    const root = panel?.querySelector(`[data-run-id="${cssEscape(runId)}"]`);
    const view = {
      events: root?.querySelector('[data-run-events]'),
      report: root?.querySelector('[data-run-report]')
    };
    if (view.events) {
      appendRunEventToView(view, normalized);
      scrollLogToBottom();
    }
  }

  function setRunUndoStatus(runId, undoStatus) {
    const run = findRunRecord(runId);
    if (!run) {
      return;
    }
    run.undoStatus = undoStatus;
    saveStateSoon();
    refreshRunCardControls(runId);
  }

  function refreshRunCardControls(runId) {
    const run = findRunRecord(runId);
    const root = panel?.querySelector(`[data-run-id="${cssEscape(runId)}"]`);
    if (!run || !root) {
      return;
    }
    configureUndoButton(root, run);
  }

  function findRunRecord(runId) {
    return (state.runs || []).find(run => run.id === runId);
  }

  function createRunId() {
    return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  function truncateRunTitle(text) {
    const value = String(text || 'Untitled run');
    return value.length > 58 ? `${value.slice(0, 58)}...` : value;
  }

  function truncateInline(text, maxLength = 80) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
  }

  function removeEmptyRunsMessage(log) {
    const empty = log?.querySelector('.empty-runs');
    if (empty) {
      empty.remove();
    }
  }

  function cssEscape(value) {
    if (window.CSS?.escape) {
      return window.CSS.escape(value);
    }
    return String(value).replace(/"/g, '\\"');
  }

  function appendSummary(summary) {
    if (!summary) {
      appendRunEvent({
        title: '本轮未修改文件。',
        status: 'completed'
      });
      return;
    }

    const total = Object.values(summary.counts || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
    if (!total) {
      appendRunEvent({
        title: '本轮未修改文件。',
        status: 'completed',
        detail: {
          '说明': 'Codex 没有提出需要写入 Overleaf 的修改。'
        }
      });
      return;
    }

    appendRunEvent({
      title: `准备修改 ${summary.affectedFiles?.length || 0} 个文件。`,
      status: 'completed',
      detail: {
        '会影响的文件': summary.affectedFiles?.length ? summary.affectedFiles : '无',
        '编辑': summary.counts?.edit || 0,
        '新建': summary.counts?.create || 0,
        '重命名': summary.counts?.rename || 0,
        '移动': summary.counts?.move || 0,
        '删除': summary.counts?.delete || 0,
        '需要单独确认的删除': summary.deletePlan?.length ? summary.deletePlan : '无'
      }
    });
  }

  function appendPlannedChangeSummary(summary, title) {
    if (!summary) {
      appendRunEvent({ title: `${title}：没有文件需要修改`, status: 'completed' });
      return;
    }
    const files = summary.affectedFiles || [];
    appendRunEvent({
      title: files.length
        ? `${title}：${files.join(', ')}`
        : `${title}：没有文件需要修改`,
      status: 'completed',
      detail: {
        '编辑': summary.counts?.edit || 0,
        '新建': summary.counts?.create || 0,
        '删除': summary.counts?.delete || 0
      }
    });
  }

  function appendChangeSummary(input) {
    const line = buildChangeSummaryLine(input);
    appendRunEvent({
      title: line,
      status: 'completed',
      detail: {
        status: input.status,
        notes: input.notes || '',
        deletePlanRejected: Boolean(input.deletePlanRejected)
      }
    });
    return line;
  }

  function appendCompletionReport(input = {}) {
    const operations = input.operations || [];
    const applyResults = input.applyResults || [];
    const record = currentRunView?.recordId ? findRunRecord(currentRunView.recordId) : null;
    const undoCount = record?.undoOperations?.length || 0;
    const report = buildHumanCompletionReport({
      ...input,
      operations,
      applyResults,
      undoCount,
      includeWriteResult: true
    });

    appendRunEvent({
      kind: 'report',
      title: report.title,
      status: report.status,
      detail: report.text
    });
  }

  function formatCompletionWork(operations, input) {
    if (input.deletePlanRejected) {
      return '已保留非删除修改，删除项已取消。';
    }
    if (!operations?.length) {
      return '本轮未修改文件。';
    }
    return groupOperationsByFile(operations)
      .map(group => `${group.path}: ${group.operations.map(operation => formatOperationType(operation.type)).join('、')}`)
      .join('；');
  }

  function formatCompletionNextStep(input, skippedCount) {
    if (skippedCount) {
      return '请展开写入结果查看跳过原因，处理后可以重试。';
    }
    if (input.status === 'rejected') {
      return '可以调整任务描述后重新运行。';
    }
    if (input.status === 'blocked' || input.status === 'failed') {
      return '请处理上面的原因后重试。';
    }
    return '可以继续追问，或运行下一项任务。';
  }

  function collectAffectedFiles(operations = [], summary, applyResults = []) {
    const files = [];
    const seen = new Set();
    const add = path => {
      if (!path || seen.has(path)) {
        return;
      }
      seen.add(path);
      files.push(path);
    };
    for (const path of summary?.affectedFiles || []) {
      add(path);
    }
    for (const operation of operations || []) {
      add(operation?.path || operation?.from || operation?.to);
    }
    for (const result of applyResults || []) {
      for (const item of [...(result?.applied || []), ...(result?.skipped || [])]) {
        add(item?.operation?.path || item?.operation?.from || item?.operation?.to);
      }
    }
    return files;
  }

  function appendOperationsPreview(operations, title) {
    if (!operations?.length) {
      appendRunEvent({
        title: `${title}：本轮未修改文件`,
        status: 'completed'
      });
      return;
    }

    const groups = groupOperationsByFile(operations);
    appendRunEvent({
      title: `${title}：${groups.length} 个文件`,
      status: 'completed',
      detail: groups.map(group => ({
        '文件': group.path,
        '修改': group.operations.map(formatFileChangePreview)
      }))
    });
  }

  function groupOperationsByFile(operations = []) {
    const groups = [];
    const byPath = new Map();
    for (const operation of operations || []) {
      const path = operation?.path || operation?.from || operation?.to || '未知文件';
      if (!byPath.has(path)) {
        byPath.set(path, { path, operations: [] });
        groups.push(byPath.get(path));
      }
      byPath.get(path).operations.push(operation);
    }
    return groups;
  }

  function formatFileChangePreview(operation) {
    const parts = [formatOperationType(operation?.type)];
    if (operation?.reason) {
      parts.push(`原因：${operation.reason}`);
    }
    if (operation?.type === 'edit') {
      if (operation.find || operation.replace) {
        parts.push(`把「${truncateInline(operation.find || '')}」改为「${truncateInline(operation.replace || '')}」`);
      } else if (operation.replaceAll) {
        parts.push(`全文替换为 ${String(operation.replaceAll).length} 字符`);
      }
    }
    if (operation?.to) {
      parts.push(`目标：${operation.to}`);
    }
    return parts.join('；');
  }

  function appendApplyResult(result) {
    if (!result) {
      return;
    }
    const applied = result.applied?.length || 0;
    const skipped = result.skipped?.length || 0;
    appendRunEvent({
      title: `写入结果：已写入 ${applied} 项，跳过 ${skipped} 项`,
      status: skipped ? 'failed' : 'completed',
      detail: {
        '已写入': (result.applied || []).map(item => ({
          '动作': formatOperationType(item.operation?.type),
          '文件': item.operation?.path,
          '状态': item.result?.status
        })),
        '跳过': (result.skipped || []).map(item => ({
          '动作': formatOperationType(item.operation?.type),
          '文件': item.operation?.path,
          '原因': item.result?.reason || item.result?.error || '未知原因'
        }))
      }
    });
  }

  function formatOperationType(type) {
    const labels = {
      edit: '编辑',
      create: '新建',
      rename: '重命名',
      move: '移动',
      delete: '删除'
    };
    return labels[type] || type || '未知';
  }

  function formatOperationFiles(operations = []) {
    const files = [];
    const seen = new Set();
    for (const operation of operations || []) {
      const path = operation?.path || operation?.from || operation?.to;
      if (!path || seen.has(path)) {
        continue;
      }
      seen.add(path);
      files.push(path);
    }
    return files.length ? files.join(', ') : '无';
  }

  function appendLog(text) {
    if (currentRunView) {
      appendRunEvent({ title: text, status: 'info' });
      return;
    }
    appendPlainLog(text);
  }

  function appendPlainLog(text) {
    const log = panel?.querySelector('[data-log]');
    if (!log) {
      return;
    }
    const item = document.createElement('div');
    item.className = 'log-line';
    item.textContent = text;
    log.append(item);
    scrollLogToBottom();
  }

  function updateProbeNotice(text) {
    const log = panel?.querySelector('[data-log]');
    if (!log) {
      return;
    }

    const existing = log.querySelector('[data-probe-notice]');
    if (!text) {
      existing?.remove();
      return;
    }

    const item = existing || document.createElement('div');
    item.className = 'log-line';
    item.dataset.probeNotice = 'true';
    item.textContent = text;
    if (!existing) {
      log.append(item);
    }
    scrollLogToBottom();
  }

  function formatEventDetail(detail) {
    if (typeof detail === 'string') {
      return detail;
    }
    if (Array.isArray(detail)) {
      return detail.map(item => typeof item === 'string' ? item : JSON.stringify(item, null, 2)).join('\n');
    }
    if (typeof detail === 'object') {
      return Object.entries(detail)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${key}: ${formatDetailValue(value)}`)
        .join('\n') || JSON.stringify(detail, null, 2);
    }
    return String(detail);
  }

  function formatDetailValue(value) {
    if (Array.isArray(value)) {
      if (!value.length) {
        return 'none';
      }
      return value.map(item => typeof item === 'string' ? item : JSON.stringify(item)).join(', ');
    }
    if (typeof value === 'object' && value !== null) {
      return JSON.stringify(value, null, 2);
    }
    return String(value);
  }

  function formatEventTime(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function formatSessionTime(timestamp) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) {
      return '刚刚';
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return `${minutes} 分钟`;
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${hours} 小时`;
    }
    return `${Math.floor(hours / 24)} 天`;
  }

  function formatElapsed(ms) {
    const seconds = Math.max(0, Math.round(ms / 1000));
    if (seconds < 60) {
      return `${seconds}s`;
    }
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  }

  function humanizeEventType(type) {
    return String(type || 'event')
      .split(/[._-]+/)
      .filter(Boolean)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  function formatSummary(title, summary) {
    const counts = summary?.counts || {};
    const files = summary?.affectedFiles || [];
    return [
      title,
      '',
      `Edit: ${counts.edit || 0}`,
      `Create: ${counts.create || 0}`,
      `Rename: ${counts.rename || 0}`,
      `Move: ${counts.move || 0}`,
      `Delete: ${counts.delete || 0}`,
      '',
      files.length ? `Affected files:\n${files.join('\n')}` : 'Affected files: none'
    ].join('\n');
  }

  function formatDeletePlan(deletePlan) {
    if (!deletePlan.length) {
      return 'No files are proposed for deletion.';
    }

    return [
      `Codex proposes deleting ${deletePlan.length} item(s):`,
      '',
      ...deletePlan.map(item => `${item.path}\nReason: ${item.reason || 'No reason provided'}`),
      '',
      'Approve all deletions?'
    ].join('\n');
  }
})();
