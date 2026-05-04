(function initContentScript() {
  'use strict';

  const PANEL_ID = 'codex-overleaf-panel';
  const LEGACY_STORAGE_KEY = 'codexOverleafPanelState';
  const RUN_PROJECT_SYNC_MAX_AGE_MS = 30000;
  const RUN_SNAPSHOT_ZIP_TIMEOUT_MS = 30000;
  const SNAPSHOT_PAGE_BRIDGE_TIMEOUT_MS = 70000;
  const CONTEXT_FILE_LIST_ZIP_TIMEOUT_MS = 12000;
  const CONTEXT_FILE_LIST_PAGE_BRIDGE_TIMEOUT_MS = 20000;
  const WARM_MIRROR_MAX_AGE_MS = 5 * 60 * 1000;
  const STREAM_RENDER_FLUSH_MS = 80;
  const STREAM_SAVE_DELAY_MS = 1000;
  const MAX_RUN_EVENTS = 300;
  const MAX_SAFE_UNDO_REPLACEALL_CHARS = 2000;
  const PANEL_DEFAULT_WIDTH = 380;
  const PANEL_MIN_WIDTH = 340;
  const PANEL_MAX_WIDTH = 760;
  const PAGE_MIN_WIDTH = 520;
  const INSTALL_COMMAND = 'curl -fsSL https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/main/install.sh | bash';
  const pageBridgeReady = injectPageBridge();
  const {
    createSession,
    deleteSession,
    deriveSessionTitle,
    getActiveSession,
    isDisplayableSession,
    normalizePanelState,
    prepareStateForStorage,
    recordSessionResult,
    selectVisibleSessionsForList,
    setActiveSession,
    updateActiveSession
  } = window.CodexOverleafSessionState;
  const { getProjectStorageKey } = window.CodexOverleafStorageKeys;
  const { HIGH_RISK_TYPES, buildChangeSummaryLine, hasSkippedApplyOperations } = window.CodexOverleafSummary;
  const {
    buildExpectedFilesAfterOperations,
    buildSnapshotRestoreUndo,
    buildUndoCheckpoint
  } = window.CodexOverleafUndoOperations;
  const {
    buildHumanCompletionReport,
    mapAgentEventToActivity,
    translateRawError
  } = window.CodexOverleafAgentTranscript;
  const i18n = window.CodexOverleafI18n;
  const nativeChannel = window.CodexOverleafNativeChannel.create({
    chrome,
    crypto
  });
  const writebackController = window.CodexOverleafWritebackController;
  const runController = window.CodexOverleafRunController;

  let panel = null;
  let state = null;
  let storageKey = LEGACY_STORAGE_KEY;
  let currentRunView = null;
  let saveStateTimer = null;
  let streamRenderTimer = null;
  let pendingStreamRenderEvents = new Map();
  let storageNoticeKeys = new Set();
  let contextProject = null;
  let contextLoadId = 0;
  let contextExpandedFolders = new Set();
  let logAutoFollow = true;
  let userScrollIntentUntil = 0;
  let runCancellationRequested = false;
  let activePluginConfirmResolve = null;
  let modelDiscovery = { status: 'fallback', source: 'fallback', fetchedAt: '' };

  chrome.runtime.onMessage.addListener(message => {
    if (message?.type === 'codex-overleaf/open-panel') {
      ensurePanelOpen();
    }
    if (nativeChannel.shouldHandleNativeEvent(message)) {
      appendNativeEvent(message.event);
    }
  });

  init();

  async function init() {
    storageKey = getProjectStorageKey(LEGACY_STORAGE_KEY, window.location.href);
    state = normalizePanelState(await loadStoredState(), { restoreRunningRuns: true });
    ensurePanelOpen();
    applyStateToPanel();
    loadModelOptions().catch(error => {
      applyFallbackModelOptions(resolveSelectedModel(), error);
    });
    await refreshProbe({ quiet: true });
  }

  function getLocale() {
    return i18n?.normalizeLocale?.(state?.locale) || 'en';
  }

  function tr(key, params) {
    return i18n?.t?.(getLocale(), key, params) || key;
  }

  function tx(en, zh) {
    return getLocale() === 'zh' ? zh : en;
  }

  function listSeparator() {
    return getLocale() === 'zh' ? '、' : ', ';
  }

  function ensurePanelOpen() {
    if (!panel) {
      panel = document.createElement('aside');
      panel.id = PANEL_ID;
      panel.innerHTML = `
        <div class="codex-panel-resize-handle" data-panel-resize-handle title="Drag to resize the Codex panel. Double click to reset." aria-label="Drag to resize the Codex panel. Double click to reset." role="separator"></div>
        <div class="codex-vscode-head">
          <div class="codex-vscode-title">CODEX</div>
          <div class="codex-vscode-head-actions" aria-label="Codex actions">
            <button type="button" data-refresh title="Refresh current file status. This will not sync or modify files." aria-label="Refresh current file status. This will not sync or modify files.">↻</button>
            <div class="codex-diagnostics-wrap">
              <button type="button" data-diagnostics-menu title="Diagnostics" aria-label="Diagnostics" aria-expanded="false">⋯</button>
              <div class="codex-diagnostics-menu" data-diagnostics-popover hidden>
                <div class="codex-diagnostics-hint" data-i18n="diagnosticsHint">Use when Codex cannot run, write, or read files</div>
                <button type="button" data-diagnostics-native-env>
                  <span data-i18n="diagnosticsNativeTitle">Check Local Connection</span>
                  <small data-i18n="diagnosticsNativeSubtitle">Codex, Native Host, LaTeX tools</small>
                </button>
                <button type="button" data-diagnostics-page-state>
                  <span data-i18n="diagnosticsPageTitle">Check Overleaf Write Access</span>
                  <small data-i18n="diagnosticsPageSubtitle">Current file, write access, track changes</small>
                </button>
                <button type="button" data-diagnostics-snapshot>
                  <span data-i18n="diagnosticsSnapshotTitle">Check Project Read</span>
                  <small data-i18n="diagnosticsSnapshotSubtitle">Full project, assets, read source</small>
                </button>
                <button type="button" data-language-toggle>
                  <span data-i18n="switchLanguage">Switch to Chinese</span>
                  <small data-i18n="switchLanguageHint">Change panel language</small>
                </button>
              </div>
              <section class="codex-diagnostics-result" data-diagnostics-result hidden>
                <div class="codex-diagnostics-result-head">
                  <div>
                    <div class="codex-diagnostics-result-title" data-diagnostics-result-title></div>
                    <div class="codex-diagnostics-result-subtitle" data-diagnostics-result-subtitle></div>
                  </div>
                  <button type="button" data-diagnostics-result-close title="Close" aria-label="Close diagnostics result">×</button>
                </div>
                <div class="codex-diagnostics-result-body" data-diagnostics-result-body></div>
                <details class="codex-diagnostics-technical" data-diagnostics-result-details>
                  <summary data-i18n="technicalDetails">Technical Details</summary>
                  <pre data-diagnostics-result-technical></pre>
                </details>
              </section>
            </div>
            <button type="button" data-new-session title="New Session" aria-label="New Session">✎</button>
          </div>
        </div>
        <div class="codex-toast-region" data-toast-region aria-live="polite" aria-atomic="false"></div>

        <div class="codex-vscode-main" data-main>
          <section class="codex-task-section">
            <div class="codex-section-head">
              <span data-i18n="tasks">Tasks</span>
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
          <textarea data-task rows="3" placeholder="Ask Codex anything. Type @ to add context"></textarea>
          <div class="codex-context-summary" data-context-summary hidden></div>
          <div class="codex-mode-row">
            <span class="codex-mode-label" data-i18n="mode">Mode</span>
            <div class="codex-mode-switch" role="group" aria-label="Write mode">
              <button type="button" data-mode-choice="ask" aria-pressed="false" title="Read and analyze only. Do not write to Overleaf.">Ask</button>
              <button type="button" data-mode-choice="confirm" aria-pressed="false" title="Show a change plan first, then write after approval.">Suggest</button>
              <button type="button" data-mode-choice="auto" aria-pressed="false" title="Write directly after authorization. Deletes still require confirmation.">Auto</button>
            </div>
            <select data-mode aria-label="Mode" hidden>
              <option value="ask">Ask</option>
              <option value="confirm">Suggest</option>
              <option value="auto">Auto</option>
            </select>
          </div>
          <div class="codex-composer-toolbar">
            <button type="button" data-add-context title="Add @ context" aria-label="Add @ context" aria-expanded="false">＋</button>
            <label class="codex-review-toggle" title="When enabled, Codex checks or switches Overleaf Reviewing/Track Changes before writing. Deletes still require confirmation.">
              <input type="checkbox" data-require-reviewing>
              <span class="codex-review-label" data-i18n="requireReviewing">Track</span>
            </label>
            <label class="codex-recompile-toggle" title="After Codex writes, click Overleaf Recompile and record the compile result for this task. Ask mode will not trigger it.">
              <input type="checkbox" data-auto-recompile>
              <span class="codex-recompile-label" data-i18n="autoCompile">Auto Compile</span>
            </label>
            <div class="codex-select-shell codex-model-picker" data-model-picker>
              <span data-model-display>GPT-5.4</span>
              <select data-model aria-label="Model">
                <option value="gpt-5.5">GPT-5.5</option>
                <option value="gpt-5.4">GPT-5.4</option>
                <option value="gpt-5.4-mini">GPT-5.4 Mini</option>
                <option value="gpt-5.3-codex">GPT-5.3 Codex</option>
                <option value="gpt-5.3-codex-spark">GPT-5.3 Codex Spark</option>
                <option value="gpt-5.2">GPT-5.2</option>
              </select>
            </div>
            <select data-reasoning aria-label="Reasoning">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="xhigh">XHigh</option>
            </select>
            <button type="submit" data-run title="Send" aria-label="Send">↑</button>
          </div>
          <div class="codex-context-tray" data-context-tray hidden>
            <div class="codex-context-head">
              <span data-i18n="contextTitle">@ Context</span>
              <button type="button" data-context-refresh title="Refresh file list" aria-label="Refresh file list">↻</button>
            </div>
            <div class="codex-context-selection" data-context-selection></div>
            <div class="codex-context-status" data-context-status>Type @ to add context: @file, @compile-log, @current-section.</div>
            <div class="codex-context-files" data-context-file-list></div>
          </div>
        </form>
      `;
      document.documentElement.append(panel);
      document.documentElement.classList.add('codex-overleaf-panel-mounted');

      panel.querySelector('[data-new-session]').addEventListener('click', () => startNewSession());
      panel.querySelector('[data-panel-resize-handle]').addEventListener('pointerdown', startPanelResize);
      panel.querySelector('[data-panel-resize-handle]').addEventListener('dblclick', resetPanelWidth);
      panel.querySelector('[data-composer-form]').addEventListener('submit', event => {
        event.preventDefault();
        safeRunTask();
      });
      panel.querySelector('[data-run]').addEventListener('click', event => {
        event.preventDefault();
        if (currentRunView) {
          cancelActiveRun();
          return;
        }
        panel.querySelector('[data-composer-form]')?.requestSubmit();
      });
      panel.querySelector('[data-task]').addEventListener('keydown', handleTaskInputKeydown);
      panel.addEventListener('click', event => event.stopPropagation());
      panel.addEventListener('mousedown', event => event.stopPropagation());
      panel.querySelector('[data-refresh]').addEventListener('click', () => refreshProbe({ userInitiated: true }));
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
      panel.querySelector('[data-language-toggle]').addEventListener('click', () => toggleLanguage());
      panel.querySelector('[data-diagnostics-result-close]').addEventListener('click', () => closeDiagnosticsResult());
      panel.querySelector('[data-view-all]').addEventListener('click', () => renderSessionList({ showAll: true }));
      panel.querySelector('[data-add-context]').addEventListener('click', () => toggleContextTray());
      panel.querySelector('[data-context-refresh]').addEventListener('click', () => loadContextFiles({ force: true }));
      for (const button of panel.querySelectorAll('[data-mode-choice]')) {
        button.addEventListener('click', () => {
          selectMode(button.dataset.modeChoice).catch(error => appendPlainLog(tr('modeSwitchFailedToast', { message: error.message })));
        });
      }

      for (const selector of ['[data-model]', '[data-reasoning]', '[data-mode]', '[data-task]', '[data-require-reviewing]', '[data-auto-recompile]']) {
        panel.querySelector(selector).addEventListener('change', persistPanelInputs);
        panel.querySelector(selector).addEventListener('input', persistPanelInputs);
      }
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

  async function toggleLanguage() {
    state = normalizePanelState({
      ...state,
      locale: i18n?.getOppositeLocale?.(getLocale()) || 'zh'
    });
    closeDiagnosticsMenu();
    applyLocaleToPanel();
    await saveState();
  }

  function applyLocaleToPanel() {
    if (!panel) {
      return;
    }

    panel.querySelectorAll('[data-i18n]').forEach(element => {
      element.textContent = tr(element.dataset.i18n);
    });

    setElementTitleAndAria('[data-panel-resize-handle]', tr('resizePanel'), tr('resizePanel'));
    setElementTitleAndAria('[data-refresh]', tr('refreshProbe'), tr('refreshProbe'));
    setElementTitleAndAria('[data-diagnostics-menu]', tr('diagnosticsMenu'), tr('diagnosticsMenu'));
    setElementTitleAndAria('[data-diagnostics-result-close]', tr('close'), tr('closeDiagnostics'));
    setElementTitleAndAria('[data-new-session]', tr('newSession'), tr('newSession'));
    setElementTitleAndAria('[data-add-context]', tr('addContext'), tr('addContext'));
    setElementTitleAndAria('[data-context-refresh]', tr('refreshFileList'), tr('refreshFileList'));
    setElementTitleAndAria('[data-run]', currentRunView ? tr('cancelRun') : tr('send'), currentRunView ? tr('cancelRun') : tr('send'));

    const actions = panel.querySelector('.codex-vscode-head-actions');
    if (actions) {
      actions.setAttribute('aria-label', tr('codexActions'));
    }
    const task = panel.querySelector('[data-task]');
    if (task) {
      task.placeholder = tr('placeholder');
    }
    const modeSwitch = panel.querySelector('.codex-mode-switch');
    if (modeSwitch) {
      modeSwitch.setAttribute('aria-label', tr('writeMode'));
    }
    const modeSelect = panel.querySelector('[data-mode]');
    if (modeSelect) {
      modeSelect.setAttribute('aria-label', tr('mode'));
      for (const option of modeSelect.options) {
        option.textContent = formatModeLabel(option.value);
      }
    }
    for (const button of panel.querySelectorAll('[data-mode-choice]')) {
      const mode = button.dataset.modeChoice;
      button.textContent = formatModeLabel(mode);
      button.title = tr(`mode${capitalizeModeKey(mode)}Title`);
    }
    const reviewToggle = panel.querySelector('.codex-review-toggle');
    if (reviewToggle) {
      reviewToggle.title = tr('requireReviewingTitle');
    }
    const recompileToggle = panel.querySelector('.codex-recompile-toggle');
    if (recompileToggle) {
      recompileToggle.title = tr('autoCompileTitle');
    }
    const contextStatus = panel.querySelector('[data-context-status]');
    if (contextStatus && !contextStatus.dataset.customStatus) {
      contextStatus.textContent = tr('contextStatus');
    }
    const emptyRunLabel = panel.querySelector('.empty-runs div');
    if (emptyRunLabel) {
      emptyRunLabel.textContent = tr('emptyRunLabel');
    }

    syncModeControls();
    updateModelDisplay();
    renderSessionList();
    renderContextSelection();
  }

  function setElementTitleAndAria(selector, title, ariaLabel) {
    const element = panel?.querySelector(selector);
    if (!element) {
      return;
    }
    element.title = title;
    element.setAttribute('aria-label', ariaLabel || title);
  }

  function capitalizeModeKey(mode) {
    if (mode === 'ask') {
      return 'Ask';
    }
    if (mode === 'confirm') {
      return 'Confirm';
    }
    if (mode === 'auto') {
      return 'Auto';
    }
    return '';
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

  function closeDiagnosticsResult() {
    const result = panel?.querySelector('[data-diagnostics-result]');
    if (result) {
      result.hidden = true;
    }
  }

  function showDiagnosticsLoading(title, subtitle = tr('diagnosticsLoading')) {
    showDiagnosticsResult({
      title,
      subtitle,
      status: 'running',
      summary: tr('diagnosticsLoadingSummary')
    });
  }

  function showDiagnosticsResult(result = {}) {
    const root = panel?.querySelector('[data-diagnostics-result]');
    if (!root) {
      return;
    }

    root.hidden = false;
    root.dataset.status = result.status || 'info';
    root.querySelector('[data-diagnostics-result-title]').textContent = result.title || tr('diagnosticsResult');
    root.querySelector('[data-diagnostics-result-subtitle]').textContent = result.subtitle || '';

    const body = root.querySelector('[data-diagnostics-result-body]');
    body.textContent = '';
    appendDiagnosticsParagraph(body, result.summary || tr('diagnosticsNoResult'));
    if (Array.isArray(result.bullets) && result.bullets.length) {
      const list = document.createElement('ul');
      for (const item of result.bullets) {
        const li = document.createElement('li');
        li.textContent = item;
        list.append(li);
      }
      body.append(list);
    }
    if (result.nextStep) {
      const next = document.createElement('p');
      next.className = 'codex-diagnostics-next-step';
      next.textContent = `${tr('nextStepPrefix')}${result.nextStep}`;
      body.append(next);
    }
    if (result.installCommand) {
      renderInstallCommand(body, result.installCommand);
    }

    const details = root.querySelector('[data-diagnostics-result-details]');
    const technical = root.querySelector('[data-diagnostics-result-technical]');
    const technicalText = String(result.technical || '').trim();
    details.open = false;
    details.hidden = !technicalText;
    technical.textContent = technicalText;
  }

  function renderInstallCommand(container, command) {
    const wrap = document.createElement('div');
    wrap.className = 'codex-install-command';

    const label = document.createElement('div');
    label.className = 'codex-install-command-label';
    label.textContent = tr('runInTerminal');
    wrap.append(label);

    const code = document.createElement('code');
    code.textContent = command;
    wrap.append(code);

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = tr('copyInstallCommand');
    copyButton.addEventListener('click', async () => {
      await navigator.clipboard.writeText(command);
      copyButton.textContent = tr('copied');
      setTimeout(() => {
        copyButton.textContent = tr('copyInstallCommand');
      }, 1400);
    });
    wrap.append(copyButton);

    container.append(wrap);
  }

  function appendDiagnosticsParagraph(container, text) {
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    container.append(paragraph);
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
    const scroller = getLogScrollContainer();
    if (!scroller || scroller.dataset.autoFollowBound === 'true') {
      return;
    }
    scroller.dataset.autoFollowBound = 'true';
    scroller.addEventListener('wheel', markUserScrollIntent, { passive: true });
    scroller.addEventListener('touchmove', markUserScrollIntent, { passive: true });
    scroller.addEventListener('pointerdown', markUserScrollIntent, { passive: true });
    scroller.addEventListener('keydown', event => {
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
        markUserScrollIntent();
      }
    });
    scroller.addEventListener('scroll', () => {
      if (Date.now() <= userScrollIntentUntil) {
        logAutoFollow = isLogNearBottom(scroller);
        return;
      }
      if (isLogNearBottom(scroller)) {
        logAutoFollow = true;
      }
    }, { passive: true });
  }

  function getLogScrollContainer() {
    return panel?.querySelector('[data-log]') || panel?.querySelector('[data-main]');
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
    const scroller = getLogScrollContainer();
    if (!scroller) {
      return;
    }
    if (!(options.force || logAutoFollow || isLogNearBottom(scroller))) {
      return;
    }

    logAutoFollow = true;
    setLogScrollPosition(scroller);
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => setLogScrollPosition(scroller));
    }
  }

  function setLogScrollPosition(scroller) {
    scroller.scrollTop = scroller.scrollHeight;
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
    if (isContextFileListProject(contextProject) && !options.force) {
      renderContextFiles(contextProject);
      return;
    }

    const loadId = ++contextLoadId;
    setContextStatus(tr('contextLoadingFiles'));
    list.textContent = '';

    try {
      const project = await callPageBridge('getProjectFileList', {
        preferExact: true,
        force: Boolean(options.force),
        maxAgeMs: 300000,
        zipTimeoutMs: CONTEXT_FILE_LIST_ZIP_TIMEOUT_MS
      });
      if (!project?.ok) {
        throw new Error(project?.error || project?.reason || tr('unknownReason'));
      }
      if (loadId !== contextLoadId) {
        return;
      }
      contextProject = project;
      renderContextFiles(project);
    } catch (error) {
      if (loadId !== contextLoadId) {
        return;
      }
      setContextStatus(tr('contextReadFailed', { message: error.message }));
    }
  }

  function isContextFileListProject(project) {
    const method = project?.capabilities?.method;
    return method === 'overleaf-zip-file-list' || method === 'overleaf-file-tree';
  }

  function renderContextFiles(project) {
    const list = panel?.querySelector('[data-context-file-list]');
    if (!list) {
      return;
    }

    list.textContent = '';
    const files = getContextProjectFiles(project?.files || []);
    renderContextSelection();

    if (!files.length) {
      setContextStatus(tr('contextNoFiles'));
      return;
    }

    const selected = getActiveFocusFiles();
    setContextStatus(selected.length
      ? tr('contextSelectedFiles', { count: selected.length })
      : tr('contextDefaultWholeProject'));

    const tree = buildContextTree(files);
    for (const child of tree.children) {
      renderContextTreeNode(child, list, selected, 0);
    }
  }

  function getContextProjectFiles(files = []) {
    const seen = new Set();
    const result = [];
    for (const file of files) {
      if (!file?.path || seen.has(file.path)) {
        continue;
      }
      seen.add(file.path);
      result.push(file);
    }
    return result;
  }

  function buildContextTree(files = []) {
    const root = { type: 'folder', name: '', path: '', children: [] };
    const folderByPath = new Map([['', root]]);

    for (const file of files) {
      if (!file?.path) {
        continue;
      }
      const parts = file.path.split('/').filter(Boolean);
      if (!parts.length) {
        continue;
      }
      let parent = root;
      let folderPath = '';
      for (const part of parts.slice(0, -1)) {
        folderPath = folderPath ? `${folderPath}/${part}` : part;
        let folder = folderByPath.get(folderPath);
        if (!folder) {
          folder = { type: 'folder', name: part, path: folderPath, children: [] };
          folderByPath.set(folderPath, folder);
          parent.children.push(folder);
        }
        parent = folder;
      }
      parent.children.push({
        type: 'file',
        name: parts[parts.length - 1],
        path: file.path,
        file
      });
    }

    sortContextTree(root);
    return root;
  }

  function sortContextTree(node) {
    node.children.sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === 'folder' ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
    for (const child of node.children) {
      if (child.type === 'folder') {
        sortContextTree(child);
      }
    }
  }

  function renderContextTreeNode(node, container, selected, depth) {
    if (node.type === 'folder') {
      const folder = document.createElement('details');
      folder.className = 'codex-context-folder';
      folder.dataset.path = node.path;
      folder.open = contextExpandedFolders.has(node.path);
      folder.addEventListener('toggle', () => {
        if (folder.open) {
          contextExpandedFolders.add(node.path);
        } else {
          contextExpandedFolders.delete(node.path);
        }
      });

      const label = document.createElement('summary');
      label.className = 'codex-context-folder-name';
      label.style.paddingLeft = `${depth * 14 + 7}px`;
      label.textContent = node.name;

      const children = document.createElement('div');
      children.className = 'codex-context-folder-children';

      for (const child of node.children) {
        renderContextTreeNode(child, children, selected, depth + 1);
      }
      folder.append(label, children);
      container.append(folder);
      return;
    }

    const file = node.file;
    const selectable = file.selectable !== false;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'codex-context-file';
    button.dataset.path = file.path;
    button.dataset.selected = selectable && selected.includes(file.path) ? 'true' : 'false';
    button.dataset.selectable = selectable ? 'true' : 'false';
    button.disabled = !selectable;
    button.setAttribute('aria-pressed', selectable && selected.includes(file.path) ? 'true' : 'false');
    button.style.paddingLeft = `${depth * 14 + 7}px`;
    button.title = selectable ? file.path : tr('contextResourceTitle', { path: file.path });
    if (selectable) {
      button.addEventListener('click', () => selectFocusFile(file.path));
    }

    const name = document.createElement('span');
    name.className = 'codex-context-file-name';
    name.textContent = node.name;

    const meta = document.createElement('span');
    meta.className = 'codex-context-file-meta';
    meta.textContent = selectable
      ? (file.content ? `${String(file.content).length} chars` : file.source || '')
      : tr('resource');

    button.append(name, meta);
    container.append(button);
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
    addButton.title = selected.length ? `@context: ${selected.map(path => `@file:${path}`).join(', ')}` : tr('addContext');

    const chip = document.createElement('div');
    chip.className = 'codex-context-chip';

    const dot = document.createElement('span');
    dot.className = 'codex-context-dot';
    dot.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.textContent = selected.length ? selected.map(path => `@file:${path}`).join(', ') : tr('contextWholeProjectChip');
    chip.append(dot, label);

    if (selected.length) {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.dataset.contextClear = '';
      clear.title = tr('clearFiles');
      clear.setAttribute('aria-label', tr('clearFiles'));
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
    clear.title = tr('clearFiles');
    clear.setAttribute('aria-label', tr('clearFiles'));
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
      status.dataset.customStatus = 'true';
    }
  }

  async function inspectProjectSnapshot() {
    showDiagnosticsLoading(tr('diagnosticsSnapshotTitle'), tr('diagnosticsSnapshotLoading'));
    try {
      const project = await callPageBridge('getProjectSnapshot', {
        force: true,
        preferLightweight: true,
        allowZipFallback: true,
        allowEditorNavigation: false,
        requireFullProject: true,
        zipOnly: true,
        zipTimeoutMs: RUN_SNAPSHOT_ZIP_TIMEOUT_MS
      });
      showDiagnosticsResult(formatProjectSnapshotDiagnosticsResult(project));
    } catch (error) {
      showDiagnosticsResult({
        title: tx('Project Read Failed', '项目读取失败'),
        subtitle: tx('The extension did not receive Overleaf project content.', '插件没有拿到 Overleaf 项目内容。'),
        status: 'failed',
        summary: tr('diagnosticsSnapshotErrorSummary'),
        nextStep: tx('Reload Overleaf, wait for the left file tree to finish loading, then retry.', '刷新 Overleaf 页面，等左侧文件树加载完成后重试。'),
        technical: error?.stack || error?.message || String(error)
      });
    }
  }

  async function inspectNativeEnvironment() {
    showDiagnosticsLoading(tr('diagnosticsNativeTitle'), tr('diagnosticsNativeLoading'));
    const response = await sendBackgroundNative({ method: 'bridge.ping', params: {} });
    showDiagnosticsResult(formatNativeEnvironmentResult(response));
  }

  function formatNativeEnvironmentResult(response) {
    if (!response?.ok) {
      return {
        title: tx('Local Connection Problem', '本机连接异常'),
        subtitle: tx('The extension could not connect to the local service.', '插件没有连上本机服务。'),
        status: 'failed',
        summary: tx('The extension is not connected to the local service, so it cannot run local Codex or sync the local workspace yet.', '插件没有连上本机服务，所以暂时不能调用本地 Codex 或同步本地 workspace。'),
        nextStep: tx('Make sure the native host is installed, reload the Chrome extension, then try again.', '确认 native host 已安装，并重新加载 Chrome 扩展后再试。'),
        installCommand: INSTALL_COMMAND,
        technical: response?.error?.message || tx('native host did not respond', 'native host 没有响应')
      };
    }

    const environment = response.result?.environment;
    if (!environment) {
      return {
        title: tx('Local Connection Available', '本机连接可用'),
        subtitle: tx('Native Host responded.', 'Native Host 已响应。'),
        status: 'completed',
        summary: tr('diagnosticsNativeEmptySummary'),
        nextStep: tx('If tasks fail to run, reinstall the native host or check the codex command in Terminal.', '如果运行任务失败，请重新安装 native host 或检查终端里的 codex 命令。'),
        technical: JSON.stringify(response.result || {}, null, 2)
      };
    }

    const codexOk = environment.codex?.ok === true;
    const latexTools = environment.latex?.available || [];
    const latexOk = latexTools.length > 0;
    const bullets = [
      codexOk
        ? tx(`Codex available: ${environment.codex.path || 'found on PATH'}`, `Codex 可用：${environment.codex.path || '已在 PATH 中找到'}`)
        : tx('Codex was not found: the extension cannot start local Codex.', 'Codex 没有找到：插件不能启动本地 Codex。'),
      latexOk
        ? tx(`LaTeX tools available: ${latexTools.join(', ')}`, `LaTeX 工具可用：${latexTools.join(', ')}`)
        : tx('LaTeX tools were not found: text editing works, but local compile checks are limited.', 'LaTeX 工具没有找到：可以编辑文本，但不能在本地编译验证。')
    ];

    if (codexOk && latexOk) {
      return {
        title: tx('Local Connection OK', '本机连接正常'),
        subtitle: tx('Codex and LaTeX are available.', 'Codex 和 LaTeX 都可以使用。'),
        status: 'completed',
        summary: tx('Codex is connected and local LaTeX tools are available. Codex can read, edit, and locally check this Overleaf project.', 'Codex 已连接，本机 LaTeX 工具可用。你可以让 Codex 读取、修改并本地检查 Overleaf 项目。'),
        bullets,
        technical: JSON.stringify(environment, null, 2)
      };
    }

    return {
      title: codexOk ? tx('Local Connection Partially Available', '本机连接部分可用') : tx('Codex Unavailable', 'Codex 不可用'),
      subtitle: codexOk ? tx('Codex is available, but compile tools are incomplete.', 'Codex 可用，但编译工具不完整。') : tx('Local Codex was not found.', '没有找到本机 Codex。'),
      status: codexOk ? 'warning' : 'failed',
      summary: codexOk
        ? tx('Local Codex can run, but LaTeX compile tools were not found. File edits are unaffected, but compile verification is limited.', '本机 Codex 可以运行，但没有找到 LaTeX 编译工具；修改文件不受影响，编译验证会受限。')
        : tx('The extension reached the native host, but local Codex was not found, so tasks cannot start.', '插件已经连上 native host，但没有找到本机 Codex，所以不能启动任务。'),
      bullets,
      nextStep: codexOk
        ? tx('For compile verification, make sure latexmk or pdflatex is available on your Terminal PATH.', '如需编译验证，请确认 latexmk 或 pdflatex 在终端 PATH 中可用。')
        : tx('Make sure codex works in Terminal, then reload the extension.', '请确认终端里可以运行 codex，然后重新加载扩展。'),
      technical: JSON.stringify(environment, null, 2)
    };
  }

  async function inspectPageStateDiagnostics() {
    showDiagnosticsLoading(tr('diagnosticsPageTitle'), tr('diagnosticsPageLoading'));
    try {
      const probe = await callPageBridge('probe', {
        manualOverride: state?.requireReviewing === false
      });
      showDiagnosticsResult(formatPageStateDiagnosticsResult(probe));
    } catch (error) {
      showDiagnosticsResult({
        title: tx('Overleaf Page Check Failed', 'Overleaf 页面检查失败'),
        subtitle: tx('The extension did not read the current page state.', '插件没有读到当前页面状态。'),
        status: 'failed',
        summary: tx('This usually means Overleaf is still loading, or the page script is temporarily unavailable.', '这通常表示 Overleaf 页面还在加载，或者页面脚本暂时不可用。'),
        nextStep: tx('Reload Overleaf, open the .tex file you want to work on, then try again.', '刷新 Overleaf 页面，点开要处理的 .tex 文件后再试。'),
        technical: error?.stack || error?.message || String(error)
      });
    }
  }

  function formatPageStateDiagnosticsResult(probe) {
    const readiness = getProbeRunReadiness(probe || {});
    const reviewingOk = probe?.reviewing?.ok === true;
    const writable = probe?.capabilities?.editor?.write !== false;
    const readable = probe?.editor?.ok === true;
    const bullets = [
      readable ? tx('Current file was read.', '当前文件已经读到。') : tx('Current file content has not been verified yet.', '还没有确认当前文件内容。'),
      writable ? tx('Editor write access will be verified again during writeback.', '当前编辑器写入能力会在写入时再次验证。') : tx('The current editor is not writable yet.', '当前编辑器暂时不可写。'),
      reviewingOk ? tx('Reviewing/Track Changes status is verified.', '留痕/Reviewing 状态已确认。') : tx('Reviewing/Track Changes status is not verified yet.', '留痕/Reviewing 状态还没有确认。')
    ];

    if (readable && writable) {
      return {
        title: tx('Overleaf Page Ready', 'Overleaf 页面可用'),
        subtitle: formatProbeStatusBar(probe),
        status: reviewingOk || state?.mode === 'ask' ? 'completed' : 'warning',
        summary: tx('The current Overleaf file can be read and written. The extension still verifies before writing to avoid overwriting new user or collaborator edits.', '当前 Overleaf 文件可以读取和写入。写入前插件仍会再次验证，避免覆盖用户或协作者的新改动。'),
        bullets,
        nextStep: reviewingOk || state?.mode === 'ask' ? '' : tx('If you need tracked writes, turn on Overleaf Reviewing/Track Changes first.', '如果需要留痕写入，请先在 Overleaf 开启 Reviewing/Track Changes。'),
        technical: formatPageDiagnosticsTechnicalDetails(probe)
      };
    }

    return {
      title: readable ? tx('Current File Read, Write Status Incomplete', '当前文件已读取，但写入状态不完整') : tx('Current File Not Verified Yet', '还没有确认当前文件'),
      subtitle: formatProbeStatusBar(probe),
      status: 'warning',
      summary: readable
        ? tx('The extension read the current Overleaf file, but has not verified that the current editor can be written.', '插件已读到当前 Overleaf 文件，但还没有确认当前编辑器可以写入。')
        : tx('The extension has not verified that the current editor can be written. Usually this means no .tex file is open yet, or Overleaf is still loading.', '插件没有确认当前编辑器可以写入。通常是还没点开 .tex 文件，或者 Overleaf 页面仍在加载。'),
      bullets,
      nextStep: tx('Open the target .tex file from the left Overleaf file tree, wait for the editor to load, then check again.', '在 Overleaf 左侧文件树点开要处理的 .tex 文件，等编辑器加载完成后重新检测。'),
      technical: formatPageDiagnosticsTechnicalDetails(probe)
    };
  }

  function formatProjectSnapshotDiagnosticsResult(project) {
    const files = project?.files || [];
    const textCount = files.filter(isTextSnapshotFile).length;
    const binaryCount = files.length - textCount;
    const fullProject = project?.capabilities?.fullProjectSnapshot === true;
    const warnings = getProjectSnapshotWarnings(project);
    const warningText = [...warnings.blocking, ...warnings.nonBlocking].map(formatProjectSnapshotWarning);
    const source = project?.capabilities?.method || 'unknown';
    const bullets = [
      tx(`Text files: ${textCount}`, `文本文件：${textCount} 个`),
      tx(`Asset files: ${binaryCount}`, `资源文件：${binaryCount} 个`),
      project?.activePath ? tx(`Current file: ${project.activePath}`, `当前文件：${project.activePath}`) : tx('Current file: not detected', '当前文件：未识别')
    ];

    if (fullProject && files.length) {
      return {
        title: tx('Project Read OK', '项目读取正常'),
        subtitle: tx(`Read source: ${source}`, `读取来源：${source}`),
        status: 'completed',
        summary: tx(
          `The extension read the full Overleaf project: ${textCount} text file(s)${binaryCount ? `, ${binaryCount} asset file(s)` : ''}.`,
          `插件已读到完整 Overleaf 项目：${textCount} 个文本文件${binaryCount ? `，${binaryCount} 个资源文件` : ''}。`
        ),
        bullets: warningText.length ? [...bullets, ...warningText] : bullets,
        technical: formatProjectSnapshotLog(project)
      };
    }

    return {
      title: files.length ? tx('Full Project Not Read', '没有读到完整项目') : tx('No Project Files Read', '没有读到项目文件'),
      subtitle: tx(`Read source: ${source}`, `读取来源：${source}`),
      status: 'warning',
      summary: files.length
        ? tx(
          `The full Overleaf project was not read. Currently read ${textCount} text file(s)${binaryCount ? `, ${binaryCount} asset file(s)` : ''}.`,
          `没有读到完整的 Overleaf 项目。当前只读到 ${textCount} 个文本文件${binaryCount ? `，${binaryCount} 个资源文件` : ''}。`
        )
        : tx('The full Overleaf project was not read, and no usable file content was available.', '没有读到完整的 Overleaf 项目，也没有拿到可用文件内容。'),
      bullets: warningText.length ? [...bullets, ...warningText] : bullets,
      nextStep: tx('Reload Overleaf and wait for the left file tree to load, then retry. If you only want one file, use + to add @file context.', '刷新 Overleaf 页面，等左侧文件树加载完成后重试；如果只想处理一个文件，可以用 + 添加 @file 上下文。'),
      technical: formatProjectSnapshotLog(project)
    };
  }

  function formatPageDiagnosticsTechnicalDetails(probe) {
    const lines = [];
    lines.push(tx(`Status: ${formatProbeStatusBar(probe || {})}`, `状态：${formatProbeStatusBar(probe || {})}`));
    const diagnostics = probe?.reviewingDiagnostics;
    if (diagnostics) {
      lines.push(`Reviewing controls: ${diagnostics.controlCount || 0}; body=${Boolean(diagnostics.bodyTextHasReviewing)}; text=${Boolean(diagnostics.textContentHasReviewing)}`);
      for (const control of (diagnostics.reviewLikeControls || []).slice(0, 4)) {
        const label = [
          control.text,
          control.ariaLabel && `aria:${control.ariaLabel}`,
          control.title && `title:${control.title}`,
          control.dataTestId && `test:${control.dataTestId}`,
          control.id && `id:${control.id}`
        ].filter(Boolean).join(' | ');
        lines.push(`Review-like ${control.tag || 'node'}: ${label || control.htmlSnippet || '(no label)'}`);
      }
    }
    const editorDiagnostics = probe?.editorDiagnostics;
    if (editorDiagnostics) {
      const active = editorDiagnostics.active;
      lines.push(`Editor: active ${active?.tag || 'none'} ${active?.ariaLabel || active?.className || ''} len=${active?.valueLength || 0}; textareas=${editorDiagnostics.textareaCount || 0}; editables=${editorDiagnostics.editableCount || 0}; iframes=${editorDiagnostics.iframeCount || 0}`);
      if (editorDiagnostics.documentStats) {
        const stats = editorDiagnostics.documentStats;
        lines.push(`DOM: elements=${stats.elementCount || 0}; textareas=${stats.textareaCount || 0}; cm=${stats.cmCount || 0}; role textbox=${stats.roleTextboxCount || 0}`);
      }
      if (editorDiagnostics.codeMirrorView) {
        const view = editorDiagnostics.codeMirrorView;
        lines.push(`CodeMirror: docLength=${view.docLength || 0}; dispatch=${Boolean(view.hasDispatch)}; source=${view.source || 'unknown'}`);
      }
    }
    const projectDiagnostics = probe?.projectDiagnostics;
    if (projectDiagnostics) {
      lines.push(`Project records: ${projectDiagnostics.docRecordCount || 0}; roots=${(projectDiagnostics.internalRootKeys || []).slice(0, 6).join(', ') || 'none'}`);
      for (const record of (projectDiagnostics.docRecords || []).slice(0, 4)) {
        lines.push(`Doc record: ${record.path} id=${record.id} source=${record.source || 'internal'}`);
      }
    }
    return lines.join('\n');
  }

  async function runTask() {
    readPanelInputs();

    const task = state.task.trim();
    if (!task) {
      appendLog('Enter a task first.');
      return;
    }

    runCancellationRequested = false;
    setRunning(true);
    currentRunView = startRunView({
      task,
      mode: state.mode,
      model: state.model,
      reasoningEffort: state.reasoningEffort
    });
    const runSessionId = currentRunView.sessionId;
    clearTaskComposer();
    appendRunEvent({
      title: tx('I will first understand your request, then inspect the relevant Overleaf files.', '我会先理解你的请求，再检查相关 Overleaf 文件。'),
      status: 'running',
      detail: {
        [tr('mode')]: formatModeLabel(state.mode),
        [tx('Model', '模型')]: state.model,
        [tx('Reasoning effort', '推理强度')]: state.reasoningEffort,
        [tx('Track required', '要求留痕')]: state.requireReviewing ? tx('yes', '是') : tx('no', '否'),
        '@context': formatContextItems(getActiveFocusFiles())
      }
    });
    appendRunEvent({
      title: tx(
        `This run will prioritize: ${formatContextItems(getActiveFocusFiles())}`,
        `这轮会优先参考：${formatContextItems(getActiveFocusFiles())}`
      ),
      status: 'completed'
    });

    try {
      const writeSafety = await preflightWriteSafety();
      if (!writeSafety.ok) {
        return;
      }

      appendRunEvent({
        title: tx('Syncing the Overleaf project to the local Codex workspace.', '正在同步 Overleaf 项目到本地 Codex workspace。'),
        status: 'running'
      });
      const project = await getRunProjectSnapshot();
      throwIfRunCancellationRequested();
      appendLog(formatProjectSnapshotUserLog(project));
      const snapshotWarnings = getProjectSnapshotWarnings(project);
      const focusFiles = getActiveFocusFiles();
      let useExistingMirror = false;
      let fileOverlays = null;
      const warmMirrorReuse = await resolveWarmMirrorReuse(project, {
        snapshotWarnings,
        focusFiles
      });
      const focusedPartialSnapshot = runController.canUseFocusedPartialSnapshot({
        project,
        snapshotWarnings,
        focusFiles,
        isUsableProjectFileContent: window.CodexOverleafProjectFiles.isUsableProjectFileContent
      });
      const restrictToFocusFiles = runController.shouldRestrictWritebackToFocus({ focusFiles });
      if (snapshotWarnings.blocking.length && !warmMirrorReuse.useExistingMirror && !focusedPartialSnapshot) {
        for (const warning of snapshotWarnings.blocking) {
          appendLog(tx(`Cannot continue: ${formatProjectSnapshotWarning(warning)}`, `无法继续：${formatProjectSnapshotWarning(warning)}`));
        }
        appendCompletionReport({
          conclusion: tx('This run did not continue: the full Overleaf project was not read.', '这轮没有继续：没有读到完整的 Overleaf 项目内容。'),
          status: 'blocked',
          operations: [],
          applyResults: [],
          nextStep: tx('Reload the Overleaf project or reopen the .tex file you want to process, then retry.', '请刷新 Overleaf 项目或重新打开要处理的 .tex 文件后再试。')
        });
        finishRunView(tx('Blocked: full project was not read', '已阻止：没有读到完整项目'), 'failed');
        return;
      }

      if (warmMirrorReuse.useExistingMirror) {
        useExistingMirror = true;
        fileOverlays = warmMirrorReuse.fileOverlays;
        appendRunEvent({
          title: warmMirrorReuse.partialSnapshot
            ? tx('The full Overleaf project was not read, but the local workspace was synced recently. Continuing with the latest full workspace plus current-file overlay.', '没有读到完整 Overleaf 项目，但本地 workspace 刚同步过；继续使用最近的完整 workspace，并叠加当前文件内容。')
            : tx('Using the warmed local workspace and syncing only focus-file deltas.', '使用已预热的本地 workspace（仅同步焦点文件差异）。'),
          status: 'completed'
        });
      } else if (focusedPartialSnapshot) {
        appendRunEvent({
          title: tx(
            `Only selected context files were read: ${focusFiles.join(', ')}. This run will read and write only these files.`,
            `只读到你选择的上下文文件：${focusFiles.join(', ')}；本轮将只基于这些文件运行和写回。`
          ),
          status: 'completed'
        });
      } else {
        for (const warning of snapshotWarnings.nonBlocking) {
          appendLog(tx(`Note: ${formatProjectSnapshotWarning(warning)}`, `提示：${formatProjectSnapshotWarning(warning)}`));
        }
      }

      const activeSession = findSessionById(runSessionId) || getActiveSession(state);
      const codexThreadId = activeSession?.codexThreadId || '';

      // Resolve @compile-log if mentioned in task
      let compileLogContext = null;
      if (/\b@compile-log\b/i.test(task)) {
        appendRunEvent({ title: tx('Fetching compile log (@compile-log).', '正在获取编译日志 (@compile-log)。'), status: 'running' });
        compileLogContext = await resolveCompileLogContext();
        if (compileLogContext.available) {
          appendRunEvent({
            title: tx(
              `Compile log fetched (${(compileLogContext.errors || []).length} errors, ${(compileLogContext.warnings || []).length} warnings).`,
              `编译日志已获取（${(compileLogContext.errors || []).length} 个错误，${(compileLogContext.warnings || []).length} 个警告）。`
            ),
            status: 'completed'
          });
        } else {
          appendRunEvent({ title: tx(`Compile log unavailable: ${compileLogContext.reason}`, `编译日志不可用：${compileLogContext.reason}`), status: 'failed' });
        }
      }

      appendRunEvent({ title: tx('Local Codex session is starting.', '本地 Codex session 开始运行。'), status: 'running' });
      let response = await sendNative({
        method: 'codex.run',
        params: buildCodexRunParams({
          task,
          project,
          useExistingMirror,
          fileOverlays,
          focusFiles,
          restrictToFocusFiles,
          codexThreadId,
          compileLogContext
        })
      });

      // Handle mirror_stale error by retrying with full sync
      if (!response.ok && response.error?.code === 'mirror_stale' && useExistingMirror) {
        if (project?.capabilities?.fullProjectSnapshot === false) {
          appendRunEvent({
            title: tx('The recent local workspace is stale, and this run did not read the full Overleaf project. Codex did not continue.', '最近的本地 workspace 已过期，而且这次没有读到完整 Overleaf 项目；Codex 没有继续。'),
            status: 'failed'
          });
          appendCompletionReport({
            conclusion: tx('This run did not continue: Overleaf did not provide the full project, and the local workspace is not fresh enough.', '这轮没有继续：Overleaf 没有提供完整项目内容，本地 workspace 也不够新。'),
            status: 'blocked',
            operations: [],
            applyResults: [],
            nextStep: tx('Reload the Overleaf project and wait for the file list to load, then retry. You can also select a specific .tex file as @context first.', '请刷新 Overleaf 项目，等文件列表加载完成后重试；也可以先选中一个具体 .tex 文件作为 @context。')
          });
          finishRunView(tx('Blocked: local workspace is stale', '已阻止：本地 workspace 过期'), 'failed');
          return;
        }
        appendRunEvent({ title: tx('Warmed workspace is stale. Running a fresh full sync.', '预热 workspace 已过期，正在重新完整同步。'), status: 'running' });
        useExistingMirror = false;
        response = await sendNative({
          method: 'codex.run',
          params: buildCodexRunParams({
            task,
            project,
            useExistingMirror: false,
            fileOverlays: null,
            focusFiles,
            restrictToFocusFiles: false,
            codexThreadId,
            compileLogContext
          })
        });
      }

      if (!response.ok && response.error?.code === 'thread_resume_failed') {
        const userChoice = await showThreadResumeFailedPrompt();
        if (userChoice === 'new') {
          updateSessionById(runSessionId, { codexThreadId: '' });
          const StorageDb = window.CodexOverleafStorageDb;
          if (StorageDb) {
            const record = await StorageDb.getRecord('sessions', runSessionId);
            if (record) {
              record.codexThreadId = '';
              await StorageDb.putRecord('sessions', record);
            }
          }
          appendRunEvent({ title: tx('Creating a new Codex conversation thread.', '正在新建 Codex 会话线程。'), status: 'running' });
          response = await sendNative({
            method: 'codex.run',
            params: buildCodexRunParams({
              task,
              project,
              useExistingMirror,
              fileOverlays,
              focusFiles,
              restrictToFocusFiles,
              codexThreadId: '',
              compileLogContext
            })
          });
        } else {
          appendRunEvent({ title: tx('Cancelled: user chose not to create a new thread.', '已取消：用户选择不新建线程。'), status: 'rejected' });
          finishRunView(tx('Cancelled', '已取消'), 'rejected');
          return;
        }
      }

      if (!response.ok) {
        if (runCancellationRequested || isRunCancellationError(response.error)) {
          appendRunCancelledReport();
          finishRunView(tx('Cancelled', '已中断'), 'rejected');
          return;
        }
        const translated = translateRawError(response.error.message, { mode: state.mode, locale: getLocale() });
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
        finishRunView(tx('Local Codex error', '本地 Codex 错误'), 'failed');
        return;
      }

      throwIfRunCancellationRequested();
      const assistantMessage = response.result.assistantMessage || getAssistantAnswerForCurrentRun();
      const syncChanges = response.result.syncChanges || [];
      const writebackProject = useExistingMirror
        ? mergeProjectWithSyncChangeBaseFiles(project, syncChanges)
        : project;
      const syncOutcome = await applySyncChangesToOverleaf(syncChanges, writebackProject, {
        assistantMessage,
        unsupportedChanges: response.result.unsupportedChanges || []
      });

      finishRunView(
        syncOutcome.hasSkippedOperations ? tx('Sync completed with skipped items', '同步完成但有跳过项') : tx('Sync completed', '同步完成'),
        syncOutcome.hasSkippedOperations ? 'failed' : 'completed'
      );
      try {
        const runSessionForHistory = findSessionById(runSessionId) || getActiveSession(state);
        const updatedSession = recordSessionResult(runSessionForHistory, {
          task,
          result: buildSessionHistoryResult({
            assistantMessage,
            syncOutcome,
            syncChanges
          })
        });
        replaceSessionInState(updatedSession);

        const returnedThreadId = response.result?.threadId || '';
        if (returnedThreadId && returnedThreadId !== codexThreadId) {
          updateSessionById(runSessionId, { codexThreadId: returnedThreadId });
          const StorageDb = window.CodexOverleafStorageDb;
          if (StorageDb) {
            const record = await StorageDb.getRecord('sessions', runSessionId);
            if (record) {
              record.codexThreadId = returnedThreadId;
              record.updatedAt = new Date().toISOString();
              await StorageDb.putRecord('sessions', record);
            }
          }
        }

        await saveState();
        applyStateToPanel();
      } catch (persistenceError) {
        appendRunEvent({
          title: tx('Codex result was generated, but saving local session history failed.', 'Codex 结果已生成，但保存本地会话记录失败。'),
          status: 'failed',
          detail: {
            [tx('Impact', '影响')]: tx('This answer is already visible. After reloading, this run may not appear in session history.', '本轮回答已经显示；刷新页面后，这轮可能不会出现在历史 session 里。')
          },
          technicalDetail: {
            message: persistenceError.message
          }
        });
      }
    } catch (error) {
      if (runCancellationRequested || isRunCancellationError(error)) {
        appendRunCancelledReport();
        finishRunView(tx('Cancelled', '已中断'), 'rejected');
        return;
      }
      const translated = translateRawError(error.message, { mode: state?.mode, locale: getLocale() });
      appendRunEvent({
        title: translated.conclusion,
        status: 'failed',
        technicalDetail: {
          message: error.message
        }
      });
      appendTechnicalEvent({
        type: 'task.exception',
        title: 'Task exception',
        status: 'failed',
        detail: {
          message: error.message
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
      finishRunView(tx('Task failed', '任务失败'), 'failed');
    } finally {
      setRunning(false);
      nativeChannel.clearActiveRequest();
      currentRunView = null;
      runCancellationRequested = false;
      saveStateSoon();
    }
  }

  async function preflightWriteSafety() {
    if (state.mode === 'ask' || !state?.requireReviewing) {
      return { ok: true, skipped: true };
    }

    appendRunEvent({
      title: tx('Checking Overleaf Reviewing/Track Changes before starting.', '正在确认 Overleaf 留痕状态。'),
      status: 'running'
    });

    let result = null;
    try {
      result = await callPageBridge('ensureReviewing', { waitMs: 1800 });
    } catch (error) {
      result = {
        ok: false,
        reason: error?.message || tx('Overleaf did not return track changes status', 'Overleaf 没有返回留痕状态'),
        reviewing: null
      };
    }

    if (result?.ok) {
      appendRunEvent({
        title: result.activated
          ? tx('Overleaf Reviewing/Track Changes is now on. Starting the task.', '已开启 Overleaf 留痕，开始处理任务。')
          : tx('Overleaf Reviewing/Track Changes is already on. Starting the task.', 'Overleaf 留痕已经开启，开始处理任务。'),
        status: 'completed'
      });
      return result;
    }

    const reason = localizeVisibleReason(result?.reason || tx('Overleaf did not return track changes status', 'Overleaf 没有返回留痕状态'));
    const nextStep = tx(
      'You may not have permission, or this Overleaf page did not expose the Reviewing switch. Switch to Reviewing manually and retry, or turn off Track before writing.',
      '你可能没有权限，或 Overleaf 当前页面没有暴露切换入口。可以手动切到 Reviewing 后重试，或关闭“留痕”再运行。'
    );
    appendRunEvent({
      title: tx('Task not started: could not enable Overleaf Reviewing/Track Changes.', '任务未开始：无法开启 Overleaf 留痕。'),
      status: 'failed',
      detail: {
        [tr('detailReason')]: reason,
        [tr('detailNext')]: nextStep
      },
      technicalDetail: {
        reason,
        reviewing: result?.reviewing || null
      }
    });
    appendCompletionReport({
      conclusion: tx('This task did not start: Codex did not run and no files were written.', '这轮任务没有开始：Codex 没有运行，也没有写入文件。'),
      status: 'blocked',
      operations: [],
      applyResults: [],
      nextStep
    });
    finishRunView(tx('Not started: could not enable Track Changes', '未开始：无法开启留痕'), 'failed');
    return {
      ok: false,
      reason,
      reviewing: result?.reviewing || null
    };
  }

  function buildSessionHistoryResult({ assistantMessage = '', syncOutcome = {}, syncChanges = [] } = {}) {
    return runController.buildSessionHistoryResult({ assistantMessage, syncOutcome, syncChanges, locale: getLocale() });
  }

  function truncateSessionHistoryText(value, maxLength) {
    return runController.truncateSessionHistoryText(value, maxLength);
  }

  function safeRunTask() {
    if (currentRunView) {
      return;
    }
    runTask().catch(error => {
      setRunning(false);
      nativeChannel.clearActiveRequest();
      currentRunView = null;
      console.error('[codex-overleaf] failed to start task', error);
      appendPlainLog(tx(`Could not start Codex task: ${error.message}`, `无法启动 Codex 任务：${error.message}`));
    });
  }

  async function cancelActiveRun() {
    if (!currentRunView || runCancellationRequested) {
      return;
    }
    runCancellationRequested = true;
    panel.dataset.cancelling = 'true';
    setRunning(true);
    appendRunEvent({
      title: tx('Cancelling the current Codex task.', '正在中断当前 Codex 任务。'),
      status: 'running'
    });

    const activeRequestId = nativeChannel.getActiveRequestId();
    if (!activeRequestId) {
      return;
    }

    const response = await sendBackgroundNative({
      method: 'codex.cancel',
      params: {
        requestId: activeRequestId
      }
    });
    if (!response?.ok) {
      const message = response?.error?.message || tx('native host did not respond', 'native host 没有响应');
      appendRunEvent({
        title: tx(`Cancel request was not delivered: ${message}`, `中断请求没有送达：${message}`),
        status: 'failed'
      });
    }
  }

  function throwIfRunCancellationRequested() {
    if (!runCancellationRequested) {
      return;
    }
    const error = new Error('Codex run was cancelled by the user');
    error.code = 'codex_cancelled';
    throw error;
  }

  function isRunCancellationError(error = {}) {
    return error.code === 'codex_cancelled' || /cancelled by the user|was cancelled/i.test(error.message || '');
  }

  async function showThreadResumeFailedPrompt() {
    const confirmed = await showPluginConfirm({
      title: tr('threadResumeFailedTitle'),
      message: tr('threadResumeFailedMessage'),
      confirmLabel: tr('threadResumeNew'),
      cancelLabel: tr('confirmDefaultCancel')
    });
    return confirmed ? 'new' : 'cancel';
  }

  async function showPluginConfirm({
    title = tr('confirmDefaultTitle'),
    message = '',
    confirmLabel = tr('confirmDefaultConfirm'),
    cancelLabel = tr('confirmDefaultCancel'),
    destructive = false
  } = {}) {
    if (!panel) {
      ensurePanelOpen();
    }

    if (activePluginConfirmResolve) {
      activePluginConfirmResolve(false);
      activePluginConfirmResolve = null;
    }

    return new Promise(resolve => {
      let settled = false;
      const overlay = document.createElement('div');
      overlay.className = 'codex-plugin-confirm';
      overlay.setAttribute('data-plugin-confirm', 'true');
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', title);

      const card = document.createElement('section');
      card.className = 'codex-plugin-confirm-card';

      const head = document.createElement('div');
      head.className = 'codex-plugin-confirm-head';
      const icon = document.createElement('img');
      icon.className = 'codex-plugin-confirm-icon';
      icon.alt = '';
      icon.setAttribute('aria-hidden', 'true');
      icon.src = chrome.runtime.getURL('assets/icons/codex-overleaf-dialog-icon.png');
      const titleWrap = document.createElement('div');
      const brand = document.createElement('div');
      brand.className = 'codex-plugin-confirm-brand';
      brand.textContent = tr('confirmBrand');
      const titleEl = document.createElement('div');
      titleEl.className = 'codex-plugin-confirm-title';
      titleEl.textContent = title;
      titleWrap.append(brand, titleEl);
      head.append(icon, titleWrap);

      const body = document.createElement('div');
      body.className = 'codex-plugin-confirm-body';
      body.textContent = String(message || '');

      const actions = document.createElement('div');
      actions.className = 'codex-plugin-confirm-actions';
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'codex-plugin-confirm-cancel';
      cancel.textContent = cancelLabel;
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.className = 'codex-plugin-confirm-confirm';
      if (destructive) {
        confirm.dataset.destructive = 'true';
      }
      confirm.textContent = confirmLabel;
      actions.append(cancel, confirm);
      card.append(head, body, actions);
      overlay.append(card);
      panel.append(overlay);

      const cleanup = value => {
        if (settled) {
          return;
        }
        settled = true;
        activePluginConfirmResolve = null;
        document.removeEventListener('keydown', onKeydown, true);
        overlay.remove();
        resolve(value);
      };
      activePluginConfirmResolve = cleanup;
      const onKeydown = event => {
        if (event.key === 'Escape') {
          event.preventDefault();
          cleanup(false);
        } else if (event.key === 'Enter') {
          event.preventDefault();
          cleanup(true);
        }
      };

      overlay.addEventListener('click', event => {
        if (event.target === overlay) {
          cleanup(false);
        }
      });
      cancel.addEventListener('click', () => cleanup(false));
      confirm.addEventListener('click', () => cleanup(true));
      document.addEventListener('keydown', onKeydown, true);
      confirm.focus();
    });
  }

  function buildCodexRunParams({
    task,
    project,
    useExistingMirror,
    fileOverlays,
    focusFiles,
    restrictToFocusFiles,
    codexThreadId,
    compileLogContext
  } = {}) {
    return runController.buildCodexRunParams({
      currentProjectId: getCurrentProjectId(),
      state,
      task,
      project,
      useExistingMirror,
      fileOverlays,
      focusFiles,
      restrictToFocusFiles,
      codexThreadId,
      compileLogContext
    });
  }

  function appendRunCancelledReport() {
    appendRunEvent({
      title: tx('Current Codex task was cancelled.', '已中断当前 Codex 任务。'),
      status: 'failed'
    });
    appendCompletionReport({
      conclusion: tx('This run was cancelled. It did not continue syncing or writing to Overleaf.', '这轮已中断，没有继续同步或写入 Overleaf。'),
      status: 'rejected',
      operations: [],
      applyResults: [],
      nextStep: tx('Edit the task and run again.', '可以修改任务后重新运行。')
    });
  }

  function handleTaskInputKeydown(event) {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) {
      return;
    }
    event.preventDefault();
    panel.querySelector('[data-composer-form]')?.requestSubmit();
  }

  function createDiffReviewElement(syncChanges, options = {}) {
    const readonly = Boolean(options.readonly);
    const container = document.createElement('div');
    container.className = 'codex-diff-review';
    if (readonly) {
      container.dataset.readonly = 'true';
    }
    const fileStates = new Map();
    const fileViews = new Map();
    const decisionListeners = new Set();

    function notifyDecisionChanged() {
      for (const listener of decisionListeners) {
        listener();
      }
    }

    function setDecisionStatus(actions, accepted) {
      const status = document.createElement('span');
      status.className = 'codex-diff-decision-label';
      status.textContent = accepted ? tr('diffAccepted') : tr('diffRejected');
      actions.replaceChildren(status);
    }

    function decideFileChange(path, accepted) {
      if (readonly || fileStates.get(path) !== null) {
        return;
      }
      const view = fileViews.get(path);
      if (!view) {
        return;
      }
      fileStates.set(path, accepted);
      view.card.dataset.accepted = accepted ? 'true' : 'false';
      view.card.dataset.decision = accepted ? 'accepted' : 'rejected';
      setDecisionStatus(view.actions, accepted);
      notifyDecisionChanged();
    }

    function getPendingCount() {
      let count = 0;
      for (const value of fileStates.values()) {
        if (value === null) {
          count += 1;
        }
      }
      return count;
    }

    function getAcceptedChanges() {
      return syncChanges.filter(change => fileStates.get(change.path) === true);
    }

    for (const change of syncChanges) {
      fileStates.set(change.path, readonly ? true : null);
      const card = document.createElement('div');
      card.className = 'codex-diff-file';
      card.dataset.path = change.path;
      card.dataset.decision = readonly ? 'accepted' : 'pending';
      if (readonly) {
        card.dataset.accepted = 'true';
      }

      const header = document.createElement('div');
      header.className = 'codex-diff-file-header';
      const pathEl = document.createElement('span');
      pathEl.className = 'codex-diff-file-path';
      pathEl.textContent = change.type === 'delete' ? `[delete] ${change.path}` : change.path;
      const actions = document.createElement('div');
      actions.className = 'codex-diff-file-actions';

      if (readonly) {
        const status = document.createElement('span');
        status.className = 'codex-diff-readonly-label';
        status.textContent = tr('diffWritten');
        actions.append(status);
      } else {
        const acceptBtn = document.createElement('button');
        acceptBtn.type = 'button';
        acceptBtn.dataset.diffAccept = '';
        acceptBtn.textContent = '✓';
        acceptBtn.title = tr('diffAccept');
        const rejectBtn = document.createElement('button');
        rejectBtn.type = 'button';
        rejectBtn.dataset.diffReject = '';
        rejectBtn.textContent = '✗';
        rejectBtn.title = tr('diffReject');

        acceptBtn.addEventListener('click', () => decideFileChange(change.path, true));
        rejectBtn.addEventListener('click', () => decideFileChange(change.path, false));

        actions.append(acceptBtn, rejectBtn);
      }

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
      fileViews.set(change.path, { card, actions });
    }

    return {
      container,
      fileStates,
      decideFileChange,
      getPendingCount,
      getAcceptedChanges,
      onDecision(callback) {
        decisionListeners.add(callback);
        return () => decisionListeners.delete(callback);
      }
    };
  }

  function renderDiffReview(syncChanges) {
    return new Promise(resolve => {
      const review = createDiffReviewElement(syncChanges);
      const { container } = review;
      let finished = false;

      const toolbar = document.createElement('div');
      toolbar.className = 'codex-diff-toolbar';
      const summary = document.createElement('span');
      summary.className = 'codex-diff-toolbar-summary';
      const rejectAllBtn = document.createElement('button');
      rejectAllBtn.type = 'button';
      rejectAllBtn.textContent = tr('diffRejectAll');
      const acceptAllBtn = document.createElement('button');
      acceptAllBtn.type = 'button';
      acceptAllBtn.dataset.diffAcceptAll = '';
      acceptAllBtn.textContent = tr('diffAcceptAll');

      function finish(accepted) {
        if (finished) {
          return;
        }
        finished = true;
        container.remove();
        resolve(accepted);
      }

      function updateSummary() {
        const pending = review.getPendingCount();
        summary.textContent = pending ? tr('diffPendingCount', { count: pending }) : tr('diffSelectionDone');
      }

      function finishIfAllDecided() {
        updateSummary();
        if (review.getPendingCount() === 0) {
          finish(review.getAcceptedChanges());
        }
      }

      acceptAllBtn.addEventListener('click', () => {
        finish(syncChanges);
      });
      rejectAllBtn.addEventListener('click', () => {
        finish([]);
      });
      review.onDecision(finishIfAllDecided);

      updateSummary();
      toolbar.append(summary, rejectAllBtn, acceptAllBtn);
      container.append(toolbar);

      if (currentRunView?.events) {
        currentRunView.events.append(container);
        scrollLogToBottom();
      }
    });
  }

  function renderReadOnlyDiffReview(syncChanges, title = tr('diffWrittenChangesTitle')) {
    const visibleChanges = (syncChanges || []).filter(change => change?.diff?.length);
    if (!visibleChanges.length || !currentRunView?.events) {
      return;
    }

    appendRunEvent({
      title,
      status: 'completed'
    });
    const { container } = createDiffReviewElement(visibleChanges, { readonly: true });
    currentRunView.events.append(container);
    scrollLogToBottom();
  }

  async function applySyncChangesToOverleaf(syncChanges = [], project = {}, options = {}) {
    const assistantMessage = cleanFinalAnswer(options.assistantMessage || getAssistantAnswerForCurrentRun());
    const unsupportedChanges = Array.isArray(options.unsupportedChanges) ? options.unsupportedChanges : [];
    appendUnsupportedLocalChanges(unsupportedChanges);
    let operations = buildSyncApplyOperations(syncChanges, project);
    if (!operations.length) {
      appendRunEvent({
        title: tx('Codex did not produce file changes that need to sync back to Overleaf.', 'Codex 没有产生需要同步回 Overleaf 的文件改动。'),
        status: 'completed'
      });
      appendCompletionReport({
        conclusion: assistantMessage || tx('Codex finished locally. There are no changes to sync back to Overleaf.', 'Codex 已完成本地处理，没有需要同步回 Overleaf 的改动。'),
        status: state.mode === 'ask' ? tr('modeAsk') : 'completed',
        operations: [],
        applyResults: [],
        unchangedReason: assistantMessage
          ? tx('No file changes need to sync back to Overleaf.', '没有产生需要同步回 Overleaf 的文件改动。')
          : formatUnsupportedLocalChangeSummary(unsupportedChanges),
        mode: state.mode,
        nextStep: tx('You can continue the conversation, or adjust @context and run again.', '可以继续追问，或调整 @context 后重新运行。')
      });
      return {
        summaryLine: assistantMessage || tx('No changes to sync', '没有需要同步的改动'),
        hasSkippedOperations: false
      };
    }

    if (state.mode === 'confirm') {
      appendRunEvent({
        title: tx(
          `Local Codex produced ${operations.length} change(s). Review the diff before applying.`,
          `本地 Codex 产生了 ${operations.length} 项改动，请查看差异后确认。`
        ),
        status: 'running'
      });
      const accepted = await renderDiffReview(syncChanges);
      if (!accepted.length) {
        appendRunEvent({
          title: tx('Sync cancelled: Overleaf was not modified.', '已取消同步：Overleaf 没有被修改。'),
          status: 'completed'
        });
        appendCompletionReport({
          conclusion: tx('You cancelled syncing. Local Codex changes were not written back to Overleaf.', '你取消了同步，本地 Codex 改动没有写回 Overleaf。'),
          status: 'rejected',
          operations: [],
          applyResults: [],
          mode: state.mode,
          nextStep: tx('Run the task again, or switch to Auto if you want changes synced directly.', '可以重新运行任务，或切换到自动写入后再同步。')
        });
        return {
          summaryLine: tx('Sync cancelled', '已取消同步'),
          hasSkippedOperations: false
        };
      }
      operations = buildSyncApplyOperations(accepted, project);
    }

    const deleteOperations = operations.filter(operation => operation.type === 'delete');
    if (deleteOperations.length) {
      const approved = await showPluginConfirm({
        title: tr('deleteFilePromptTitle'),
        message: tr('deleteFilePromptMessage', { files: formatOperationFiles(deleteOperations) }),
        confirmLabel: tr('deleteFileConfirm'),
        cancelLabel: tr('deleteFileCancel'),
        destructive: true
      });
      if (!approved) {
        operations = operations.filter(operation => operation.type !== 'delete');
      }
    }

    appendOperationsPreview(operations, tx('Sync local Codex changes to Overleaf', '同步本地 Codex 改动到 Overleaf'));
    const reviewing = await ensureReviewingBeforeWrite(operations);
    if (!reviewing.ok) {
      const blocked = buildReviewingBlockedApplyResult(operations, reviewing);
      appendApplyResult(blocked);
      appendCompletionReport({
        conclusion: tx(
          'No files were written: Track is enabled, but Codex could not verify Overleaf Reviewing/Track Changes.',
          '这轮没有写入：已开启“留痕”要求，但 Codex 没能确认 Overleaf 正在用 Reviewing/Track Changes。'
        ),
        status: 'failed',
        operations,
        applyResults: [blocked],
        mode: state.mode,
        nextStep: tx(
          'Switch Overleaf to Reviewing/Track Changes manually and rerun, or turn off Track before writing.',
          '请在 Overleaf 手动切到 Reviewing/Track Changes 后重新运行，或关闭“留痕”再写入。'
        )
      });
      return {
        summaryLine: tx(
          'Write blocked: Overleaf Reviewing/Track Changes was not verified',
          '已阻止写入：未确认 Overleaf Reviewing/Track Changes'
        ),
        hasSkippedOperations: true
      };
    }
    const applied = operations.length
      ? await callPageBridge('applyOperations', {
        operations,
        baseFiles: project?.files || [],
        requireReviewing: state.requireReviewing === true
      })
      : { ok: true, applied: [], skipped: [] };
    await refreshProjectMirrorAfterWriteback(project, applied);
    if (state.mode === 'auto') {
      renderReadOnlyDiffReview(getAppliedSyncChanges(syncChanges, applied));
    }
    appendApplyResult(applied);
    recordUndoFromApply(project, applied);
    if (applied.skipped?.length) {
      appendPartialWritebackWarning(applied);
    }
    const appliedPaths = getAppliedOperationPaths(applied);
    if (appliedPaths.length) {
      await autoRecompileAfterWriteback(appliedPaths).catch(error => {
        appendRunEvent({
          title: tx(`Post-write compile failed: ${error.message}`, `写后编译出错：${error.message}`),
          status: 'failed'
        });
      });
    }
    const summaryLine = appendChangeSummary({
      notes: tx('Local Codex changes were synced back to Overleaf.', '本地 Codex 改动已同步回 Overleaf。'),
      operations,
      applyResults: [applied],
      status: 'synced from local Codex workspace'
    });
    const syncedConclusion = assistantMessage || tx('Local Codex changes were synced back to Overleaf.', '本地 Codex 改动已同步回 Overleaf。');
    const partialSyncConclusion = assistantMessage
      ? `${assistantMessage}\n\n${tx('Sync note: local Codex changes were sent to Overleaf, but some items were skipped.', '同步提示：本地 Codex 改动已尝试写回 Overleaf，但有部分项目被跳过。')}`
      : tx('Local Codex changes were sent to Overleaf, but some items were skipped.', '本地 Codex 改动已尝试同步回 Overleaf，但有部分项目被跳过。');
    appendCompletionReport({
      conclusion: applied.skipped?.length
        ? partialSyncConclusion
        : syncedConclusion,
      status: applied.skipped?.length ? 'failed' : 'completed',
      operations,
	      applyResults: [applied],
	      mode: state.mode,
	      nextStep: applied.skipped?.length
	        ? formatWritebackSkippedNextStep(applied)
	        : tx('Review the synced file in Overleaf.', '请在 Overleaf 中查看同步后的文件。')
	    });

    return {
      summaryLine,
      hasSkippedOperations: hasSkippedApplyOperations([applied])
    };
  }

  async function refreshProjectMirrorAfterWriteback(project = {}, applied = {}) {
    if (!applied?.applied?.length) {
      return;
    }

    appendRunEvent({
      title: tx('Checking latest Overleaf content and refreshing the local Codex workspace.', '正在确认 Overleaf 最新内容，并刷新本地 Codex workspace。'),
      status: 'running'
    });

    await callPageBridge('invalidateProjectSnapshot', {});
    const freshProject = await callPageBridge('getProjectSnapshot', {
      force: true,
      maxAgeMs: 0,
      preferLightweight: true,
      allowZipFallback: true,
      allowEditorNavigation: false,
      requireFullProject: true,
      includeBinaryFiles: true,
      zipOnly: true,
      zipTimeoutMs: RUN_SNAPSHOT_ZIP_TIMEOUT_MS,
      focusFiles: getAppliedOperationPaths(applied)
    });
    if (!freshProject?.files?.length || freshProject?.capabilities?.fullProjectSnapshot === false) {
      appendRunEvent({
        title: tx(
          'Overleaf was written, but the full project was not read. The local Codex workspace baseline was not refreshed; the next run will reread it.',
          'Overleaf 已写入，但没有读到完整项目；暂不刷新本地 Codex workspace baseline，下一轮会重新读取。'
        ),
        status: 'failed'
      });
      return;
    }

    const syncedProject = mergeVerifiedAppliedFiles(freshProject, project, applied);
    contextProject = null;
    const response = await sendBackgroundNative({
      method: 'mirror.sync',
      params: {
        projectId: getCurrentProjectId(),
        project: syncedProject
      }
    });
    if (response?.ok) {
      appendRunEvent({
        title: tx('Local Codex workspace refreshed. The next run will start from the latest Overleaf content.', '已刷新本地 Codex workspace，下一轮会从最新 Overleaf 内容开始。'),
        status: 'completed'
      });
      return;
    }

    const message = response?.error?.message || tx('native host did not respond', 'native host 没有响应');
    appendRunEvent({
      title: tx(
        `Overleaf was written, but refreshing the local workspace failed: ${message}`,
        `Overleaf 已写入，但刷新本地 workspace 失败：${message}`
      ),
      status: 'failed'
    });
  }

  function getAppliedOperationPaths(applied = {}) {
    return writebackController.getAppliedOperationPaths(applied);
  }

  function mergeVerifiedAppliedFiles(freshProject = {}, originalProject = {}, applied = {}) {
    return writebackController.mergeVerifiedAppliedFiles(freshProject, originalProject, applied);
  }

  function appendUnsupportedLocalChanges(changes = []) {
    if (!changes.length) {
      return;
    }
    appendRunEvent({
      title: formatUnsupportedLocalChangeSummary(changes),
      status: 'completed'
    });
  }

  function formatUnsupportedLocalChangeSummary(changes = []) {
    return writebackController.formatUnsupportedLocalChangeSummary(changes, getLocale());
  }

  async function autoRecompileAfterWriteback(writtenPaths = []) {
    if (state.autoRecompile === false) return;
    if (state.mode === 'ask') return;

    const CompileAdapter = window.CodexOverleafCompileAdapter;
    if (!CompileAdapter) return;

    const hasCompilableFile = writtenPaths.some(filePath => CompileAdapter.isCompilableFile(filePath));
    if (!hasCompilableFile) return;

    appendRunEvent({
      title: tx(
        'Post-write compile: LaTeX files were written, triggering Overleaf Recompile.',
        '正在写后编译：已写入 LaTeX 文件，正在触发 Overleaf Recompile。'
      ),
      status: 'running'
    });

    try {
      const result = await callPageBridge('triggerCompile', {
        preferUiClick: true,
        waitForSaveMs: 5000
      });
      if (result?.ok) {
        const compile = result.compile;
        if (compile?.status === 'success') {
          appendRunEvent({ title: tx('Compile succeeded.', '编译成功。'), status: 'completed' });
        } else if (compile?.status === 'triggered') {
          appendRunEvent({ title: tx('Overleaf compile was triggered. The page will continue showing progress.', '已触发 Overleaf 编译；页面会继续显示编译进度。'), status: 'completed' });
        } else {
          appendRunEvent({ title: tx(`Compile finished with status: ${compile?.status || 'unknown'}`, `编译完成，状态：${compile?.status || '未知'}`), status: 'completed' });
        }
      } else {
        const reason = result?.reason || tx('unknown reason', '未知原因');
        appendRunEvent({ title: tx(`Post-write compile did not succeed: ${reason}`, `写后编译未成功：${reason}`), status: 'failed' });
      }
    } catch (error) {
      appendRunEvent({ title: tx(`Post-write compile failed: ${error.message}`, `写后编译出错：${error.message}`), status: 'failed' });
    }
  }

  async function resolveCompileLogContext() {
    try {
      const result = await callPageBridge('getCompileLog', {
        triggerIfStale: true,
        maxAgeMs: 30000,
        waitForSaveMs: 5000
      });

      if (!result?.ok) {
        return { type: 'compile-log', available: false, reason: result?.reason || 'Could not get compile log' };
      }

      return {
        type: 'compile-log',
        available: true,
        log: result.log,
        errors: result.errors || [],
        warnings: result.warnings || [],
        compiledAt: result.compiledAt,
        fresh: result.fresh
      };
    } catch (error) {
      return { type: 'compile-log', available: false, reason: error.message };
    }
  }

  function buildSyncApplyOperations(syncChanges = [], project = {}) {
    return writebackController.buildSyncApplyOperations(syncChanges, project);
  }

  function getSyncChangePatches(change = {}) {
    return writebackController.getSyncChangePatches(change);
  }

  function normalizeTextPatches(patches) {
    return writebackController.normalizeTextPatches(patches);
  }

  function computeSingleTextPatch(oldText, newText) {
    return writebackController.computeSingleTextPatch(oldText, newText);
  }

  function getAppliedSyncChanges(syncChanges = [], applied = {}) {
    return writebackController.getAppliedSyncChanges(syncChanges, applied);
  }

  function getCurrentProjectId() {
    return window.location.pathname.match(/\/project\/([^/?#]+)/)?.[1] || window.location.href;
  }

  async function handleTaskResult(mode, result, project) {
    const notes = result.notes?.trim() || '';
    if (notes) {
      appendRunEvent({
        title: tx('Codex Summary', 'Codex 总结'),
        status: 'completed',
        detail: notes
      });
    }
    appendSummary(result.summary);

    if (mode === 'ask') {
      appendRunEvent({
        title: tr('undoNoWritesTitle'),
        status: 'completed'
      });
      const summaryLine = appendChangeSummary({
        notes,
        operations: [],
        status: tr('modeAsk')
      });
      appendCompletionReport({
        conclusion: notes || tx('This run only inspected and explained; no files were written.', '这轮只做了检查和说明，没有写入文件。'),
        status: tr('modeAsk'),
        notes,
        userReport: result.userReport,
        mode,
        operations: [],
        applyResults: [],
        nextStep: tx('Continue the conversation, or switch to Suggest/Auto to let Codex edit files.', '可以继续追问，或切换到建议修改/自动写入后让 Codex 修改文件。')
      });
      return { status: tr('modeAsk'), summaryLine };
    }

    if (result.status === 'requires_task_confirmation') {
      appendPlannedChangeSummary(result.summary, tx('Preparing changes', '准备修改'));
      const approved = await showPluginConfirm({
        title: tx('Apply these changes?', '应用这些修改？'),
        message: formatSummary(tx('Change Summary', '修改摘要'), result.summary),
        confirmLabel: tx('Apply changes', '应用修改'),
        cancelLabel: tr('confirmDefaultCancel')
      });
      if (!approved) {
        appendLog(tx('Cancelled: Codex did not write any files.', '已取消：Codex 没有写入任何文件。'));
        const summaryLine = appendChangeSummary({ notes, summary: result.summary, status: 'rejected' });
        appendCompletionReport({
          conclusion: tx('You cancelled this change. Codex did not write files.', '你取消了这轮修改，Codex 没有写入文件。'),
          status: 'rejected',
          notes,
          summary: result.summary,
          userReport: result.userReport,
          mode,
          operations: [],
          applyResults: [],
          nextStep: tx('Adjust the task and run again, or switch to Ask first so Codex can explain the plan.', '可以调整任务描述后重新运行，或切到只问不改先让 Codex 解释方案。')
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
          conclusion: tx('No writable changes were returned after confirmation.', '确认后没有拿到可写入的修改。'),
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
      appendOperationsPreview(operations, tx('Confirmed; preparing to write', '用户已确认，准备写入'));
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
        conclusion: notes || tx('Changes were written after your confirmation.', '已按你的确认写入修改。'),
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
      appendOperationsPreview(operations, tx('Preparing to write non-delete changes first', '准备先写入非删除修改'));
      const applied = await applyTaskOperations(project, operations);
      applyResults.push(applied);
      appendApplyResult(applied);
      recordUndoFromApply(project, applied);
      const approved = await showPluginConfirm({
        title: tx('Confirm delete plan?', '确认删除计划？'),
        message: formatDeletePlan(result.deletePlan || []),
        confirmLabel: tx('Confirm deletes', '确认删除'),
        cancelLabel: tx('Keep non-delete changes', '保留非删除修改'),
        destructive: true
      });
      if (approved) {
        const pendingOperations = result.pendingOperations || [];
        appendOperationsPreview(pendingOperations, tx('Deletes confirmed; preparing to write', '用户已确认删除，准备写入'));
        const deleteApplied = await applyTaskOperations(project, pendingOperations, { allowHighRisk: true });
        applyResults.push(deleteApplied);
        appendApplyResult(deleteApplied);
        recordUndoFromApply(project, deleteApplied);
        appendLog(tx('Deleted files after confirmation.', '已按确认删除文件。'));
        const summaryLine = appendChangeSummary({
          notes,
          operations: [...operations, ...pendingOperations],
          applyResults,
          status: 'applied with delete plan'
        });
        appendCompletionReport({
          conclusion: notes || tx('Changes were written, and delete items were handled after your confirmation.', '已写入修改，并按你的确认处理删除项。'),
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
      appendLog(tx('Deletes cancelled; non-delete changes were kept.', '已取消删除；非删除修改已保留。'));
      const summaryLine = appendChangeSummary({
        notes,
        operations,
        applyResults,
        status: 'applied without deletes',
        deletePlanRejected: true
      });
      appendCompletionReport({
        conclusion: tx('Non-delete changes were kept; delete items were not written.', '已保留非删除修改；删除项没有写入。'),
        status: 'applied without deletes',
        notes,
        userReport: result.userReport,
        mode,
        operations,
        applyResults,
        deletePlanRejected: true,
        nextStep: tx('If files still need to be deleted, rerun and confirm deletion separately.', '如果仍需要删除文件，请重新运行并单独确认删除。')
      });
      return {
        status: 'applied without deletes',
        summaryLine,
        hasSkippedOperations: hasSkippedApplyOperations(applyResults)
      };
    }

    const operations = result.operations || [];
    appendOperationsPreview(operations, tx('Preparing to write', '准备写入'));
    const applied = await applyTaskOperations(project, operations, { allowHighRisk: mode === 'confirm' });
    appendApplyResult(applied);
    recordUndoFromApply(project, applied);
    appendLog(mode === 'auto' ? tx('Auto write task completed.', '自动写入任务完成。') : tx('Task completed.', '任务完成。'));
    const summaryLine = appendChangeSummary({
      notes,
      operations,
      applyResults: [applied],
      status: result.status || 'completed'
    });
    appendCompletionReport({
      conclusion: notes || tx('This run is complete.', '这轮任务已完成。'),
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
        title: tr('undoNoWritesTitle'),
        status: 'completed'
      });
    } else {
      appendRunEvent({
        title: tx('Saved a recoverable version before this run writes.', '已保存本轮写入前的可恢复版本。'),
        status: 'completed',
        detail: {
          [tx('Files to write', '将写入的文件')]: formatOperationFiles(partitioned.safe)
        }
      });
    }
    const reviewing = await ensureReviewingBeforeWrite(partitioned.safe);
    if (!reviewing.ok) {
      return buildReviewingBlockedApplyResult(partitioned.safe, reviewing, partitioned.skipped);
    }
    const applied = partitioned.safe.length
      ? await callPageBridge('applyOperations', {
        operations: partitioned.safe,
        baseFiles: project?.files || [],
        requireReviewing: state.requireReviewing === true
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

  async function ensureReviewingBeforeWrite(operations = []) {
    if (!state?.requireReviewing || !operations.length) {
      return { ok: true, skipped: true };
    }

    appendRunEvent({
      title: tx('Verifying Overleaf Reviewing/Track Changes before writing.', '正在确认 Overleaf 已开启 Reviewing/Track Changes。'),
      status: 'running'
    });
    const result = await callPageBridge('ensureReviewing', { waitMs: 1800 });
    if (result?.ok) {
      appendRunEvent({
        title: result.activated
          ? tx('Switched to Overleaf Reviewing/Track Changes. Upcoming writes will be tracked.', '已切到 Overleaf Reviewing/Track Changes，接下来写入会留痕。')
          : tx('Overleaf Reviewing/Track Changes is on. Upcoming writes will be tracked.', '已确认 Overleaf Reviewing/Track Changes 正在开启，接下来写入会留痕。'),
        status: 'completed'
      });
      return result;
    }

    appendRunEvent({
      title: tx('Write blocked: Codex could not verify Overleaf Reviewing/Track Changes.', '已阻止写入：Codex 没能确认 Overleaf 正在用 Reviewing/Track Changes。'),
      status: 'failed',
      detail: {
          [tr('detailReason')]: localizeVisibleReason(result?.reason || tx('Overleaf did not return track changes status', 'Overleaf 没有返回留痕状态')),
        [tx('Status', '状态')]: result?.reviewing?.status || 'unknown'
      }
    });
    return {
      ok: false,
      reason: result?.reason || 'Reviewing/Track Changes was not enabled',
      reviewing: result?.reviewing || null
    };
  }

  function buildReviewingBlockedApplyResult(operations = [], reviewing = {}, extraSkipped = []) {
    return {
      ok: false,
      applied: [],
      skipped: [
        ...(operations || []).map(operation => ({
          operation,
          result: {
            ok: false,
            code: 'reviewing_not_enabled',
            reason: tx(
              'Track is enabled, but Overleaf Reviewing/Track Changes was not verified before writing. Codex did not write this file.',
              '已开启“留痕”要求，但写入前没有确认 Overleaf 正在用 Reviewing/Track Changes。Codex 没有写入这个文件。'
            )
          }
        })),
        ...(extraSkipped || [])
      ],
      reviewing
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
    const userInitiated = options.userInitiated === true;
    if (userInitiated) {
      setRefreshProbeLoading(true);
      const status = panel?.querySelector('[data-probe-status]');
      if (status) {
        status.textContent = tr('refreshProbeLoading');
        status.dataset.ok = 'false';
        status.dataset.refreshing = 'true';
      }
    }

    try {
      const probe = await callPageBridge('probe', {
        manualOverride: state?.requireReviewing === false
      });
      const status = panel?.querySelector('[data-probe-status]');
      if (status) {
        status.textContent = userInitiated
          ? tr('refreshProbeDone', { status: formatProbeStatusBar(probe) })
          : formatProbeStatusBar(probe);
        status.dataset.ok = isProbeReadyForCurrentMode(probe) ? 'true' : 'false';
        status.dataset.refreshing = 'false';
      }
      if (!options.quiet && !userInitiated) {
        appendProbeUserStatus(probe);
      } else {
        updateExistingProbeNotice(probe);
      }
      return probe;
    } catch (error) {
      if (!userInitiated) {
        throw error;
      }
      const status = panel?.querySelector('[data-probe-status]');
      if (status) {
        status.textContent = tr('refreshProbeFailed');
        status.dataset.ok = 'false';
        status.dataset.refreshing = 'false';
      }
      console.warn('[codex-overleaf] refresh probe failed', error);
      return null;
    } finally {
      if (userInitiated) {
        setRefreshProbeLoading(false);
      }
    }
  }

  function setRefreshProbeLoading(loading) {
    const button = panel?.querySelector('[data-refresh]');
    if (!button) {
      return;
    }
    button.dataset.loading = loading ? 'true' : 'false';
    button.disabled = Boolean(loading);
    button.setAttribute('aria-busy', loading ? 'true' : 'false');
  }

  function formatProbeStatusBar(probe) {
    const readiness = getProbeRunReadiness(probe);
    const reviewingOk = readiness.reviewingOk;
    const editorWritable = readiness.editorWritable;

    if (state?.mode === 'ask') {
      return `${formatModeLabel('ask')} · ${readiness.contextLabel}`;
    }
    if (reviewingOk) {
      return editorWritable
        ? `${tr('canRun')} · ${readiness.contextLabel}`
        : `${formatModeLabel(state?.mode)} · ${tr('validatingEditor')}`;
    }
    if (readiness.contextReady) {
      return tr('needsReviewing');
    }
    return tr('needsReviewingAndFile');
  }

  function isProbeReadyForCurrentMode(probe) {
    const readiness = getProbeRunReadiness(probe);
    return state?.mode === 'ask' || readiness.reviewingOk;
  }

  function getProbeRunReadiness(probe) {
    const editorOk = probe.editor?.ok === true;
    const focusFiles = getActiveFocusFiles();
    const hasFocus = focusFiles.length > 0;
    const hasTexFocus = focusFiles.some(file => /\.tex$/i.test(file));
    const contextLabel = editorOk
      ? tr('currentFileContext')
      : hasTexFocus
        ? tr('fileContext')
        : hasFocus
          ? tr('contextContext')
          : tr('wholeProjectContext');
    return {
      reviewingOk: probe.reviewing?.ok === true,
      editorOk,
      editorWritable: probe.capabilities?.editor?.write !== false,
      contextReady: true,
      contextLabel
    };
  }

  function formatModeLabel(mode) {
    if (mode === 'ask') {
      return tr('modeAsk');
    }
    if (mode === 'confirm') {
      return tr('modeConfirm');
    }
    if (mode === 'auto') {
      return tr('modeAuto');
    }
    return mode || tr('unknownMode');
  }

  function formatRunStatusText(status) {
    const value = String(status || '');
    const labels = {
      completed: tx('Completed', '已完成'),
      rejected: tx('Cancelled', '已取消'),
      'confirm failed': tx('Confirmation failed', '确认失败'),
      'confirmed and applied': tx('Suggested changes applied', '已应用建议修改'),
      'applied with delete plan': tx('Applied with confirmed deletes', '已应用并删除确认项'),
      'applied without deletes': tx('Applied without deletes', '已应用非删除修改'),
      '只问不改': tr('modeAsk')
    };
    return labels[value] || value || tx('Completed', '已完成');
  }

  function formatContextItems(focusFiles = []) {
    const fileItems = (focusFiles || []).map(path => `@file:${path}`);
    return fileItems.length
      ? fileItems.join(', ')
      : tx(
        '@whole-project (default); add @file, @compile-log, or @current-section',
        '@whole-project（默认）；可添加 @file、@compile-log、@current-section'
      );
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
    const readiness = getProbeRunReadiness(probe);
    const reviewingOk = readiness.reviewingOk;
    const editorOk = readiness.editorOk;
    const manualOverride = probe.reviewing?.status === 'manual-override';
    const editorWriteBlocked = probe.capabilities?.editor?.write === false;

    if (state?.mode === 'ask') {
      return {
        ready: true,
        message: tx(
          `Ready: current mode is Ask. Codex ${readiness.contextLabel} and will not write to Overleaf.`,
          `可以运行：当前是“只问不改”，Codex ${readiness.contextLabel}，不会写入 Overleaf。`
        )
      };
    }

    if (reviewingOk && editorOk && editorWriteBlocked) {
      return {
        ready: true,
        message: tx(
          `Ready: ${formatModeLabel(state?.mode)} is selected. This page has not exposed a writable editor yet; Codex will reopen and verify the target file when writing. If writeback fails, reload Overleaf and retry.`,
          `可以运行：已选择“${formatModeLabel(state?.mode)}”。当前页面暂时没有暴露可写编辑器，写入时会重新打开目标文件并验证；如果写回失败，再刷新 Overleaf 页面后重试。`
        )
      };
    }

    if (reviewingOk) {
      return {
        ready: true,
        message: manualOverride
          ? tx(
            `Ready: you confirmed Overleaf Track Changes is on. Codex ${readiness.contextLabel}.`,
            `可以运行：你已确认 Overleaf 已开启留痕，Codex ${readiness.contextLabel}。`
          )
          : tx(
            `Ready: Codex verified Overleaf Reviewing/Track Changes is on and ${readiness.contextLabel}.`,
            `可以运行：Codex 已确认 Overleaf Reviewing/Track Changes 已开启，并且${readiness.contextLabel}。`
          )
      };
    }

    if (readiness.contextReady) {
      return {
        ready: false,
        message: tx(
          `Not safe to write yet: Codex ${readiness.contextLabel}, but Overleaf Reviewing/Track Changes was not verified. Turn on Reviewing first, or disable Track below.`,
          `还不能安全写入：Codex ${readiness.contextLabel}，但没有确认 Overleaf 已开启 Reviewing/Track Changes。请先打开 Reviewing，或关闭下方的安全检查。`
        )
      };
    }

    return {
      ready: false,
      message: tx(
        'Not safe to write yet: turn on Overleaf Reviewing/Track Changes first. Codex will read the whole project at run time; you can also use @file to focus on specific files.',
        '还不能安全写入：请先在 Overleaf 打开 Reviewing/Track Changes；Codex 会在运行时读取整个项目，也可以用 @file 指定重点文件。'
      )
    };
  }

  async function getRunProjectSnapshot() {
    const project = await callPageBridge('getProjectSnapshot', {
      force: true,
      maxAgeMs: 0,
      preferLightweight: true,
      allowZipFallback: true,
      allowEditorNavigation: false,
        requireFullProject: true,
        includeBinaryFiles: true,
        zipOnly: true,
      zipTimeoutMs: RUN_SNAPSHOT_ZIP_TIMEOUT_MS,
      focusFiles: getActiveFocusFiles()
    });
    if (project?.capabilities?.fullProjectSnapshot) {
      return project;
    }
    const pageStateProject = await callPageBridge('getProjectSnapshot', {
      force: true,
      maxAgeMs: 0,
      preferLightweight: true,
      allowZipFallback: false,
      allowEditorNavigation: false,
      requireFullProject: true,
      includeBinaryFiles: false,
      focusFiles: getActiveFocusFiles()
    });
    if (pageStateProject?.capabilities?.fullProjectSnapshot) {
      return pageStateProject;
    }
    return project;
  }

  // --- Warm Mirror Controller ---

  async function getMirrorFreshness() {
    try {
      const response = await sendBackgroundNative({
        method: 'mirror.status',
        params: { projectId: getCurrentProjectId() }
      });
      if (response?.ok) {
        return response.result;
      }
    } catch (error) { /* fall through */ }
    return null;
  }

  async function resolveWarmMirrorReuse(project = {}, options = {}) {
    const snapshotWarnings = options.snapshotWarnings || { blocking: [] };
    const focusFiles = options.focusFiles || [];
    const partialSnapshot = Boolean(
      snapshotWarnings.blocking?.some(warning => /Full project snapshot was not captured/i.test(warning))
    );

    if (!partialSnapshot && (state.mode === 'ask' || !focusFiles.length)) {
      return { useExistingMirror: false };
    }

    const fileOverlays = buildSnapshotFileOverlays(project, focusFiles, { partialSnapshot });
    if (partialSnapshot && !fileOverlays.length) {
      return { useExistingMirror: false, reason: 'missing_overlay' };
    }
    if (focusFiles.length && !focusFiles.every(path => {
      const normalized = normalizeSnapshotPath(path);
      return fileOverlays.some(file => normalizeSnapshotPath(file.path) === normalized);
    })) {
      return { useExistingMirror: false, reason: 'missing_focus_overlay' };
    }

    const mirrorStatus = await getMirrorFreshness();
    if (!mirrorStatus?.exists || mirrorStatus.ageMs >= WARM_MIRROR_MAX_AGE_MS) {
      return { useExistingMirror: false, reason: 'mirror_not_fresh', mirrorStatus };
    }

    return {
      useExistingMirror: true,
      fileOverlays,
      mirrorStatus,
      partialSnapshot
    };
  }

  function buildSnapshotFileOverlays(project = {}, focusFiles = [], options = {}) {
    const textFiles = (project.files || []).filter(isTextSnapshotFile);
    const focusSet = new Set((focusFiles || []).map(normalizeSnapshotPath).filter(Boolean));
    const activePath = project.activePath || '';
    const candidates = focusFiles.length
      ? textFiles.filter(file => focusSet.has(normalizeSnapshotPath(file.path)))
      : textFiles.filter(file => file.path === activePath || file.active || options.partialSnapshot);
    const seen = new Set();
    return candidates
      .filter(file =>
        typeof file.content === 'string' &&
        window.CodexOverleafProjectFiles.isUsableProjectFileContent(file.content) &&
        file.path &&
        !seen.has(file.path) &&
        seen.add(file.path)
      )
      .map(file => ({
        path: file.path,
        content: file.content
      }));
  }

  function normalizeSnapshotPath(path) {
    return String(path || '')
      .replace(/^@file:/i, '')
      .replace(/\\/g, '/')
      .trim()
      .replace(/^\/+/, '');
  }

  function mergeProjectWithSyncChangeBaseFiles(project = {}, syncChanges = []) {
    const filesByPath = new Map((project.files || []).map(file => [file.path, { ...file }]));
    for (const change of syncChanges || []) {
      if (!change?.path || filesByPath.has(change.path) || typeof change.previousContent !== 'string') {
        continue;
      }
      filesByPath.set(change.path, {
        path: change.path,
        kind: 'text',
        content: change.previousContent,
        source: 'mirror-baseline'
      });
    }

    return {
      ...project,
      files: Array.from(filesByPath.values())
    };
  }

  // --- End Warm Mirror Controller ---

  function formatProjectSnapshotLog(project) {
    const files = project.files || [];
    const skipped = project.capabilities?.skipped || [];
    const mode = project.capabilities?.fullProjectSnapshot ? 'project' : 'active file';
    const fileNames = files.slice(0, 5)
      .map(file => `${file.path}:${formatProjectSnapshotFileSize(file)}/${file.source || 'unknown'}`)
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
      return tx(
        'No Overleaf project files were read yet. Make sure the project has loaded, or open a .tex file in Overleaf and retry.',
        '还没有读到 Overleaf 项目文件。请确认项目已加载完成，或在 Overleaf 点开一个 .tex 文件后重试。'
      );
    }

    const textCount = files.filter(isTextSnapshotFile).length;
    const binaryCount = files.length - textCount;
    const resourceText = binaryCount ? tx(`, ${binaryCount} asset file(s)`, `，${binaryCount} 个资源文件`) : '';
    const activePath = project.activePath ? tx(`, current file: ${project.activePath}`, `，当前文件：${project.activePath}`) : '';
    const focusFiles = getActiveFocusFiles();
    const focusText = focusFiles.length ? tx(`, focus: ${focusFiles.join(', ')}`, `，优先处理：${focusFiles.join(', ')}`) : '';
    return tx(
      `Read Overleaf project: ${textCount} text file(s)${resourceText}${activePath}${focusText}.`,
      `已读取 Overleaf 项目：${textCount} 个文本文件${resourceText}${activePath}${focusText}。`
    );
  }

  function formatProjectSnapshotFileSize(file) {
    if (isTextSnapshotFile(file)) {
      return `${String(file.content || '').length} chars`;
    }
    if (Number.isFinite(Number(file?.size))) {
      return `${Number(file.size)} bytes`;
    }
    return file?.contentBase64 ? `${String(file.contentBase64).length} base64` : 'binary';
  }

  function formatProjectSnapshotWarning(warning) {
    if (/No source files were captured/i.test(warning)) {
      return tx('No project source files were read. Make sure Overleaf has loaded, or open a .tex file and retry.', '没有读取到项目源文件。请确认 Overleaf 页面加载完成，或点开一个 .tex 文件后重试。');
    }
    if (/Full project snapshot was not captured/i.test(warning)) {
      return tx('The full Overleaf project was not read. To avoid refreshing the local workspace from an incomplete snapshot, reload Overleaf or retry later.', '没有读到完整的 Overleaf 项目。为了避免本地 workspace 用残缺快照覆盖项目，请刷新 Overleaf 或稍后重试。');
    }
    if (/empty or still loading/i.test(warning)) {
      return tx('Some file content is still loading. Wait for Overleaf to finish loading, then retry.', '读取到的文件内容还在加载中。请等 Overleaf 加载完成后重试。');
    }
    if (/suspiciously short|shorter than 80 characters/i.test(warning)) {
      return tx('Some file content is very short and may not have fully loaded. Results may be incomplete.', '部分文件内容很短，可能还没完全加载。结果可能不完整。');
    }
    if (/identical captured content/i.test(warning)) {
      return tx('Several files appear to have identical captured content, so Overleaf file switching may have failed. Reload and retry.', '多个文件内容看起来相同，Overleaf 文件切换可能没有成功。请刷新页面后重试。');
    }
    if (/were skipped/i.test(warning)) {
      return tx('Some project files were skipped, usually images, PDFs, or unreadable files.', '有些项目文件被跳过，通常是图片、PDF 或无法读取的文件。');
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
    const textFiles = files.filter(isTextSnapshotFile);
    const blocking = [];
    const nonBlocking = [];

    if (!files.length) {
      blocking.push('No source files were captured.');
      return { blocking, nonBlocking };
    }

    if (!textFiles.length) {
      blocking.push('No source files were captured.');
      return { blocking, nonBlocking };
    }

    if (project?.capabilities?.fullProjectSnapshot === false) {
      blocking.push('Full project snapshot was not captured.');
    }

    const unusable = textFiles.filter(file => !window.CodexOverleafProjectFiles.isUsableProjectFileContent(file.content));
    if (unusable.length === textFiles.length) {
      blocking.push('Captured file contents are empty or still loading.');
    } else if (unusable.length) {
      nonBlocking.push(`${unusable.length} file(s) have empty/loading content.`);
    }

    const shortFiles = textFiles.filter(file => String(file.content || '').trim().length < 80);
    if (shortFiles.length === textFiles.length) {
      blocking.push('Every captured file is suspiciously short; Overleaf editor content was not read correctly.');
    } else if (shortFiles.length) {
      nonBlocking.push(`${shortFiles.length} captured file(s) are shorter than 80 characters.`);
    }

    if (textFiles.length > 1 && uniqueContentSignatures(textFiles).length <= 1) {
      blocking.push('Multiple paths have identical captured content; file switching likely failed.');
    }

    if (skipped.length) {
      nonBlocking.push(`${skipped.length} project file(s) were skipped.`);
    }

    return { blocking, nonBlocking };
  }

  function isTextSnapshotFile(file) {
    return Boolean(file && file.kind !== 'binary' && typeof file.content === 'string');
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
    return nativeChannel.sendNative(payload);
  }

  function sendBackgroundNative(payload) {
    return nativeChannel.sendBackgroundNative(payload);
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
      const timeoutMs = getPageBridgeTimeoutMs(method);
      const timeout = window.setTimeout(() => {
        window.removeEventListener('message', onMessage);
        resolve({ ok: false, error: 'Page bridge timed out' });
      }, timeoutMs);

      function onMessage(event) {
        if (event.source !== window
          || event.origin !== window.location.origin
          || event.data?.source !== 'codex-overleaf/page'
          || event.data.id !== id) {
          return;
        }
        window.clearTimeout(timeout);
        window.removeEventListener('message', onMessage);
        resolve(event.data.result);
      }

      window.addEventListener('message', onMessage);
    });
  }

  function getPageBridgeTimeoutMs(method) {
    if (method === 'getProjectSnapshot') {
      return SNAPSHOT_PAGE_BRIDGE_TIMEOUT_MS;
    }
    if (method === 'getProjectFileList') {
      return CONTEXT_FILE_LIST_PAGE_BRIDGE_TIMEOUT_MS;
    }
    if (method === 'triggerCompile' || method === 'getCompileLog') {
      return 60000;
    }
    if (method === 'rejectTrackedChanges') {
      return 120000;
    }
    return 8000;
  }

  async function injectPageBridge() {
    await injectScriptOnce('src/shared/reviewing.js', 'codex-overleaf-reviewing-script');
    await injectScriptOnce('src/shared/projectFiles.js', 'codex-overleaf-project-files-script');
    await injectScriptOnce('src/shared/staleGuard.js', 'codex-overleaf-stale-guard-script');
    await injectScriptOnce('src/shared/compileAdapter.js', 'codex-overleaf-compile-adapter-script');
    await injectScriptOnce('src/page/overleafCapabilities.js', 'codex-overleaf-capabilities-script');
    await injectScriptOnce('src/page/compileBridge.js', 'codex-overleaf-compile-bridge-script');
    await injectScriptOnce('src/page/overleafEditor.js', 'codex-overleaf-editor-script');
    await injectScriptOnce('src/page/overleafProjectSnapshot.js', 'codex-overleaf-project-snapshot-script');
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
    try {
      const StorageDb = window.CodexOverleafStorageDb;
      const Migration = window.CodexOverleafStorageMigration;
      const projectId = getCurrentProjectId();
      const legacyKey = storageKey;

      const { prefs, sessions, activeSessionId } = await Migration.runMigrationIfNeeded(projectId, legacyKey);

      return {
        model: prefs.model || '',
        reasoningEffort: prefs.reasoningEffort || '',
        mode: prefs.mode || '',
        locale: prefs.locale || '',
        requireReviewing: prefs.requireReviewing !== false,
        autoRecompile: prefs.autoRecompile !== false,
        panelWidth: prefs.panelWidth || PANEL_DEFAULT_WIDTH,
        sessions: sessions.map(session => ({
          id: session.id,
          title: session.title || '',
          titleSource: session.titleSource || 'auto',
          focusFiles: session.focusFiles || [],
          codexThreadId: session.codexThreadId || '',
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          runs: Array.isArray(session.runs) ? session.runs : [],
          history: Array.isArray(session.history) ? session.history : [],
          task: typeof session.task === 'string' ? session.task : '',
          mode: session.mode || prefs.mode || 'confirm',
          model: session.model || prefs.model || 'gpt-5.4',
          reasoningEffort: session.reasoningEffort || prefs.reasoningEffort || 'high',
          requireReviewing: typeof session.requireReviewing === 'boolean'
            ? session.requireReviewing
            : prefs.requireReviewing !== false
        })),
        activeSessionId: activeSessionId,
        runs: []
      };
    } catch (error) {
      // Fallback to legacy loading if IndexedDB fails
      const keys = storageKey === LEGACY_STORAGE_KEY
        ? [LEGACY_STORAGE_KEY]
        : [storageKey, LEGACY_STORAGE_KEY];
      const stored = await chrome.storage.local.get(keys);
      return stored[storageKey] || stored[LEGACY_STORAGE_KEY] || {};
    }
  }

  async function saveState() {
    try {
      const StorageDb = window.CodexOverleafStorageDb;
      const Migration = window.CodexOverleafStorageMigration;
      const projectId = getCurrentProjectId();
      const compactState = prepareStateForStorage(state);

      // Save lightweight prefs to chrome.storage.local
      const prefs = StorageDb.extractLightweightPrefs(compactState, projectId);
      prefs.activeSessionByProject = StorageDb.buildActiveSessionByProject(
        prefs.activeSessionByProject || {},
        projectId,
        compactState.activeSessionId || state.activeSessionId || ''
      );
      await Migration.savePrefs(prefs);

      // Save all displayable session state to IndexedDB. The panel history lives here;
      // chrome.storage.local only keeps small pointers/preferences.
      const sessionRecords = (compactState.sessions || []).map(session => (
        StorageDb.buildSessionRecord({
          ...session,
          projectId,
          title: session.title || '',
          titleSource: session.titleSource || 'auto',
          codexThreadId: session.codexThreadId || '',
          status: 'active',
          focusFiles: Array.isArray(session.focusFiles) ? session.focusFiles : [],
          createdAt: session.createdAt,
          updatedAt: session.updatedAt
        })
      ));
      if (sessionRecords.length) {
        await StorageDb.putRecords('sessions', sessionRecords);
      }
      const keepSessionIds = new Set(sessionRecords.map(record => record.id));
      const existingSessions = await StorageDb.getAllByIndex('sessions', 'projectId', projectId);
      await Promise.all(existingSessions
        .filter(session => session?.id && !keepSessionIds.has(session.id))
        .map(session => StorageDb.deleteRecord('sessions', session.id)));
    } catch (error) {
      // Fallback: try legacy save
      try {
        await chrome.storage.local.set({ [storageKey]: prepareStateForStorage(state) });
      } catch (fallbackError) {
        appendStorageNoticeOnce('save-failed', tx(`Failed to save session state: ${error.message}`, `保存会话状态失败：${error.message}`));
      }
    }
  }

  function appendStorageNoticeOnce(key, text) {
    if (storageNoticeKeys.has(key)) {
      return;
    }
    storageNoticeKeys.add(key);
    showPluginToast(text, { status: 'warning', sticky: true });
  }

  function saveStateSoon(delayMs = 120) {
    if (saveStateTimer) {
      clearTimeout(saveStateTimer);
    }
    saveStateTimer = setTimeout(() => {
      saveStateTimer = null;
      saveState().catch(error => {
        appendPlainLog(tx(`Failed to save session state: ${formatStateSaveError(error)}`, `保存会话状态失败：${formatStateSaveError(error)}`));
      });
    }, delayMs);
  }

  function scheduleRunStateSave(kind) {
    saveStateSoon(kind === 'stream' ? STREAM_SAVE_DELAY_MS : 120);
  }

  function isStorageQuotaError(error) {
    return /quota|kQuotaBytes|QUOTA_BYTES/i.test(String(error?.message || error || ''));
  }

  function formatStateSaveError(error) {
    if (isStorageQuotaError(error)) {
      return tx('Local session history is too large. Delete some old tasks and retry.', '本地会话记录太大，请删除一些旧任务后重试。');
    }
    return error?.message || String(error);
  }

  async function persistPanelInputs() {
    readPanelInputs();
    updateModelDisplay();
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
    await refreshProbe({ quiet: true });
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
    state.autoRecompile = panel.querySelector('[data-auto-recompile]')?.checked !== false;
  }

  async function loadModelOptions() {
    const selectedModel = resolveSelectedModel();
    const fallbackModels = window.CodexOverleafModels.FALLBACK_MODELS;

    try {
      const response = await sendBackgroundNative({
        method: 'codex.models',
        params: {}
      });
      const hasDiscoveredModels = response?.ok
        && Array.isArray(response.result?.models)
        && response.result.models.length > 0;
      const sourceModels = hasDiscoveredModels ? response.result.models : fallbackModels;
      const normalized = window.CodexOverleafModels.normalizeDiscoveredModels({ models: sourceModels, selectedModel });
      renderModelOptions(normalized.models, selectedModel);
      modelDiscovery = {
        status: hasDiscoveredModels && !normalized.usedFallback ? 'discovered' : 'fallback',
        source: hasDiscoveredModels ? response.result?.source || 'unknown' : 'fallback',
        fetchedAt: hasDiscoveredModels ? response.result?.fetchedAt || '' : '',
        errorCode: hasDiscoveredModels ? '' : response?.error?.code || '',
        errorMessage: hasDiscoveredModels ? '' : response?.error?.message || ''
      };
      updateModelDisplay();
    } catch (error) {
      applyFallbackModelOptions(selectedModel, error);
    }
  }

  function applyFallbackModelOptions(selectedModel, error) {
    const fallbackModels = window.CodexOverleafModels.FALLBACK_MODELS;
    const sourceModels = fallbackModels;
    const normalized = window.CodexOverleafModels.normalizeDiscoveredModels({ models: sourceModels, selectedModel });
    renderModelOptions(normalized.models, selectedModel);
    modelDiscovery = {
      status: 'fallback',
      source: 'fallback',
      fetchedAt: '',
      errorCode: error?.code || '',
      errorMessage: error?.message || (error ? String(error) : '')
    };
    updateModelDisplay();
  }

  function renderModelOptions(models, selectedModel) {
    const modelSelect = panel?.querySelector('[data-model]');
    if (!modelSelect) {
      return;
    }

    const selectedId = normalizeModelOptionId(selectedModel);
    modelSelect.textContent = '';
    let renderedSelected = false;
    let firstModelId = '';

    for (const model of Array.isArray(models) ? models : []) {
      const id = normalizeModelOptionId(model?.id);
      if (!id) {
        continue;
      }
      if (!firstModelId) {
        firstModelId = id;
      }
      const option = document.createElement('option');
      option.value = id;
      option.textContent = model.label;
      if (model.unverified) {
        option.dataset.unverified = 'true';
      }
      modelSelect.append(option);
      if (id === selectedId) {
        renderedSelected = true;
      }
    }

    if (selectedId && !renderedSelected) {
      const option = document.createElement('option');
      option.value = selectedId;
      option.textContent = `${selectedId} (custom)`;
      option.dataset.unverified = 'true';
      modelSelect.append(option);
      renderedSelected = true;
    }

    if (selectedId && renderedSelected) {
      modelSelect.value = selectedId;
    } else if (firstModelId) {
      modelSelect.value = firstModelId;
    }
  }

  function resolveSelectedModel() {
    return state?.model || panel?.querySelector('[data-model]')?.value || '';
  }

  function normalizeModelOptionId(id) {
    return typeof id === 'string' ? id.trim() : '';
  }

  function getModelDiscoverySourceLabel() {
    if (modelDiscovery.errorCode || modelDiscovery.errorMessage) {
      return `${tr('modelSourceFailed')} (${tr('modelSourceFallback')})`;
    }
    if (modelDiscovery.source === 'fallback') {
      return tr('modelSourceFallback');
    }
    if (modelDiscovery.source) {
      return modelDiscovery.source;
    }
    return modelDiscovery.status === 'discovered' ? tr('modelSourceDiscovered') : tr('modelSourceFallback');
  }

  function updateModelDisplay() {
    const modelSelect = panel?.querySelector('[data-model]');
    const modelDisplay = panel?.querySelector('[data-model-display]');
    if (!modelSelect || !modelDisplay) {
      return;
    }
    const fullLabel = modelSelect.options[modelSelect.selectedIndex]?.textContent || modelSelect.value;
    modelDisplay.textContent = fullLabel;
    modelDisplay.title = tr('modelDisplayTitle', {
      label: fullLabel,
      source: getModelDiscoverySourceLabel()
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
    const recompileCheckbox = panel?.querySelector('[data-auto-recompile]');
    if (recompileCheckbox) {
      recompileCheckbox.checked = state.autoRecompile !== false;
    }
    applyPanelWidth(state.panelWidth || PANEL_DEFAULT_WIDTH, { persist: false });
    updateModelDisplay();
    syncModeControls();
    applySessionLabel();
    renderSessionList();
    renderRunHistory();
    renderContextSelection();
    renderContextSummary();
    applyLocaleToPanel();
    if (!panel.querySelector('[data-context-tray]')?.hidden) {
      renderContextFiles(contextProject);
    }
  }

  function applySessionLabel() {
    const label = panel.querySelector('[data-session-label]');
    const active = getActiveSession(state);
    label.textContent = active && isDisplayableSession(active) ? getSessionDisplayTitle(active) : '';
  }

  async function startNewSession() {
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
    readPanelInputs();
    state = setActiveSession(state, sessionId);
    await saveState();
    applyStateToPanel();
  }

  async function deleteSessionWithConfirm(sessionId) {
    const target = (state.sessions || []).find(session => session.id === sessionId);
    if (!target) {
      return;
    }
    if (isSessionRunning(target)) {
      showPluginToast(tr('deleteSessionRunningToast'), { status: 'warning' });
      return;
    }

    const approved = await showPluginConfirm({
      title: tr('deleteSessionTitle'),
      message: [
        getSessionDisplayTitle(target),
        '',
        tr('deleteSessionMessage')
      ].join('\n'),
      confirmLabel: tr('deleteSessionConfirm'),
      cancelLabel: tr('confirmDefaultCancel'),
      destructive: true
    });
    if (!approved) {
      return;
    }

    state = deleteSession(state, sessionId);
    await saveState();
    applyStateToPanel();

    try {
      const response = await sendBackgroundNative({
        method: 'codex.history.clearPlugin',
        params: {
          sessionId,
          threadId: target.codexThreadId || ''
        }
      });
      if (!response?.ok) {
        showPluginToast(tr('deleteSessionHistoryFailedToast', { message: response?.error?.message || 'native host did not return success' }), { status: 'warning', sticky: true });
      } else if (response.result?.skipped) {
        showPluginToast(tr('deleteSessionNoThreadToast'), { status: 'info' });
      } else {
        showPluginToast(tr('deleteSessionDoneToast'), { status: 'completed' });
      }
    } catch (error) {
      showPluginToast(tr('deleteSessionHistoryFailedToast', { message: error.message }), { status: 'warning', sticky: true });
    }
  }

  function setRunning(running) {
    const runButton = panel.querySelector('[data-run]');
    runButton.disabled = false;
    runButton.title = running ? tr('cancelRun') : tr('send');
    runButton.setAttribute('aria-label', running ? tr('cancelRun') : tr('send'));
    panel.querySelector('[data-new-session]').disabled = false;
    panel.querySelector('[data-diagnostics-snapshot]').disabled = running;
    if (running) {
      closeDiagnosticsMenu();
    }
    panel.dataset.running = running ? 'true' : 'false';
    panel.dataset.cancelling = running && runCancellationRequested ? 'true' : 'false';
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
      statusText: tr('processing', { elapsed: '' }).trim(),
      startedAt: new Date().toISOString(),
      finishedAt: '',
      events: [],
      undoOperations: [],
      undoTrackedChanges: [],
      undoExpectedFiles: [],
      undoStatus: ''
    };
    const active = getActiveSession(state);
    const titlePatch = active?.titleSource !== 'manual'
      ? {
        title: deriveSessionTitle([], task),
        titleSource: 'auto'
      }
      : {};
    state = updateActiveSession(state, {
      runs: [...(state.runs || []), record].slice(-20),
      ...titlePatch
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
      sessionId: state.activeSessionId,
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
    const record = findRunRecord(currentRunView.recordId, currentRunView.sessionId);
    flushPendingStreamRenders();
    const statusText = formatProcessedSummary(status, Date.now() - currentRunView.startedAt);
    if (record) {
      record.status = status;
      record.statusText = statusText;
      record.finishedAt = new Date().toISOString();
      saveStateSoon();
      renderSessionList();
    }
    const visibleView = getCurrentRunViewForRender();
    if (visibleView) {
      visibleView.root.dataset.status = status;
      visibleView.root.title = [
        text,
        record?.mode ? `${tr('mode')}: ${formatModeLabel(record.mode)}` : '',
        record?.model,
        record?.reasoningEffort
      ].filter(Boolean).join(' · ');
      collapseRunProcess(visibleView, statusText);
    }
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
      return tr('processedFailed', { elapsed });
    }
    if (status === 'running') {
      return tr('processing', { elapsed });
    }
    return tr('processed', { elapsed });
  }

  function appendNativeEvent(event) {
    if (!event) {
      return;
    }

    const activity = mapAgentEventToActivity(event, { locale: getLocale() });
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
    const record = findRunRecord(currentRunView.recordId, currentRunView.sessionId);
    let renderedEvent = event;
    if (record) {
      renderedEvent = event.kind === 'stream'
        ? upsertRunStreamRecordEvent(record, event)
        : event;
      if (event.kind !== 'stream') {
        record.events = [...(record.events || []), event].slice(-MAX_RUN_EVENTS);
      }
      scheduleRunStateSave(event.kind);
    }

    const visibleView = getCurrentRunViewForRender();
    if (visibleView) {
      if (event.kind === 'stream') {
        scheduleStreamEventRender(renderedEvent);
      } else {
        flushPendingStreamRenders();
        appendRunEventToView(visibleView, renderedEvent);
        scrollLogToBottom();
      }
    }
  }

  function scheduleStreamEventRender(event) {
    const streamKey = event.streamKey || event.streamRole || 'codex-stream';
    pendingStreamRenderEvents.set(streamKey, { ...event });
    if (streamRenderTimer) {
      return;
    }
    streamRenderTimer = setTimeout(flushPendingStreamRenders, STREAM_RENDER_FLUSH_MS);
  }

  function flushPendingStreamRenders() {
    if (streamRenderTimer) {
      clearTimeout(streamRenderTimer);
      streamRenderTimer = null;
    }
    if (!pendingStreamRenderEvents.size) {
      return;
    }
    const events = Array.from(pendingStreamRenderEvents.values());
    pendingStreamRenderEvents.clear();
    const visibleView = getCurrentRunViewForRender();
    if (!visibleView) {
      return;
    }
    for (const event of events) {
      appendRunEventToView(visibleView, event);
    }
    scrollLogToBottom();
  }

  function getCurrentRunViewForRender() {
    if (!currentRunView || currentRunView.sessionId !== state.activeSessionId) {
      return null;
    }
    if (currentRunView.root?.isConnected) {
      return currentRunView;
    }
    const root = panel?.querySelector(`[data-run-id="${cssEscape(currentRunView.recordId)}"]`);
    if (!root) {
      return null;
    }
    currentRunView.root = root;
    currentRunView.runProcess = root.querySelector('[data-run-process]');
    currentRunView.processLabel = root.querySelector('[data-run-process-summary]');
    currentRunView.events = root.querySelector('[data-run-events]');
    currentRunView.report = root.querySelector('[data-run-report]');
    currentRunView.status = root.querySelector('[data-run-status]');
    return currentRunView;
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

  function getAssistantAnswerForCurrentRun() {
    const record = currentRunView?.recordId ? findRunRecord(currentRunView.recordId, currentRunView.sessionId) : null;
    const events = Array.isArray(record?.events) ? record.events : [];
    const answers = events
      .filter(event =>
        event.kind === 'stream' &&
        event.streamRole === 'assistant' &&
        cleanFinalAnswer(event.title)
      )
      .map(event => cleanFinalAnswer(event.title))
      .filter(Boolean);
    return dedupeTextValues(answers).join('\n\n');
  }

  function cleanFinalAnswer(value) {
    return String(value || '').trim();
  }

  function dedupeTextValues(values = []) {
    return values.filter((value, index) => values.indexOf(value) === index);
  }

  function renderSessionList({ showAll = false } = {}) {
    const list = panel?.querySelector('[data-session-list]');
    if (!list) {
      return;
    }

    const sessions = (state.sessions || []).filter(isDisplayableSession);
    const visibleSessions = selectVisibleSessionsForList(state.sessions, state.activeSessionId, {
      showAll,
      maxVisible: 3,
      pinnedSessionIds: getRunningSessionIds()
    });
    const count = panel.querySelector('[data-session-count]');
    if (count) {
      count.textContent = sessions.length ? `${sessions.length}` : '';
    }

    list.replaceChildren();
    for (const session of visibleSessions) {
      const row = document.createElement('div');
      const isRunningSession = isSessionRunning(session);
      row.className = 'codex-session-row';
      row.dataset.active = session.id === state.activeSessionId ? 'true' : 'false';
      row.dataset.running = isRunningSession ? 'true' : 'false';
      const switchButton = document.createElement('button');
      switchButton.type = 'button';
      switchButton.className = 'codex-session-switch';
      const titleNode = document.createElement('span');
      titleNode.className = 'codex-session-row-title';
      const timeNode = document.createElement('time');
      switchButton.append(titleNode, timeNode);

      const titleInput = document.createElement('input');
      titleInput.type = 'text';
      titleInput.className = 'codex-session-title-input';
      titleInput.setAttribute('aria-label', tr('renameSession'));
      titleInput.maxLength = 80;
      titleInput.hidden = true;

      const renameButton = document.createElement('button');
      renameButton.type = 'button';
      renameButton.className = 'codex-session-rename';
      renameButton.title = tr('renameSession');
      renameButton.setAttribute('aria-label', tr('renameSession'));
      renameButton.textContent = '✎';

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'codex-session-delete';
      deleteButton.textContent = '×';

      row.append(switchButton, titleInput, renameButton, deleteButton);
      const displayTitle = getSessionDisplayTitle(session);
      switchButton.title = displayTitle;
      titleNode.textContent = displayTitle;
      timeNode.textContent = formatSessionTime(session.updatedAt || session.createdAt);
      switchButton.addEventListener('click', () => switchSession(session.id));
      renameButton.addEventListener('click', event => {
        event.stopPropagation();
        beginSessionRename(row, session.id);
      });
      deleteButton.disabled = isRunningSession;
      deleteButton.title = isRunningSession ? tr('deleteRunningSession') : tr('deleteSession');
      deleteButton.setAttribute('aria-label', isRunningSession ? tr('deleteRunningSession') : tr('deleteSession'));
      deleteButton.addEventListener('click', event => {
        event.stopPropagation();
        deleteSessionWithConfirm(session.id);
      });
      list.append(row);
    }

    const viewAll = panel.querySelector('[data-view-all]');
    if (viewAll) {
      viewAll.hidden = showAll || sessions.length <= 3;
      viewAll.textContent = tr('viewAllSessions', { count: sessions.length });
    }
  }

  function getSessionDisplayTitle(session) {
    const title = typeof session?.title === 'string' ? session.title.trim() : '';
    if (title && title !== 'New task') {
      return title;
    }
    return deriveSessionTitle(session?.runs, session?.task) || tr('newSessionFallback');
  }

  function beginSessionRename(row, sessionId) {
    const session = findSessionById(sessionId);
    const input = row?.querySelector('.codex-session-title-input');
    const switchButton = row?.querySelector('.codex-session-switch');
    if (!session || !input || !switchButton) {
      return;
    }

    let settled = false;
    row.dataset.editing = 'true';
    input.value = getSessionDisplayTitle(session);
    input.hidden = false;
    switchButton.hidden = true;
    input.focus();
    input.select();

    const cleanup = () => {
      input.removeEventListener('keydown', onKeydown);
      input.removeEventListener('blur', onBlur);
    };
    const finish = commit => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (!commit) {
        renderSessionList();
        return;
      }
      commitSessionRename(sessionId, input.value);
    };
    const onKeydown = event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    };
    const onBlur = () => finish(true);
    input.addEventListener('keydown', onKeydown);
    input.addEventListener('blur', onBlur);
  }

  async function commitSessionRename(sessionId, title) {
    const session = findSessionById(sessionId);
    if (!session) {
      return;
    }
    const cleanTitle = String(title || '').replace(/\s+/g, ' ').trim();
    const titleSource = cleanTitle ? 'manual' : 'auto';
    replaceSessionInState({
      ...session,
      title: cleanTitle || deriveSessionTitle(session.runs, session.task),
      titleSource,
      updatedAt: new Date().toISOString()
    });
    await saveState();
    applySessionLabel();
    renderSessionList();
  }

  function startPanelResize(event) {
    if (event.button !== undefined && event.button !== 0) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panel?.getBoundingClientRect?.().width || state.panelWidth || PANEL_DEFAULT_WIDTH;
    const handle = event.currentTarget;
    document.documentElement.classList.add('codex-overleaf-panel-resizing');
    handle?.setPointerCapture?.(event.pointerId);

    const onPointerMove = moveEvent => {
      const width = startWidth + (startX - moveEvent.clientX);
      applyPanelWidth(width, { persist: false });
    };
    const onPointerUp = () => {
      document.removeEventListener('pointermove', onPointerMove, true);
      document.removeEventListener('pointerup', onPointerUp, true);
      document.documentElement.classList.remove('codex-overleaf-panel-resizing');
      saveStateSoon();
    };
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerup', onPointerUp, true);
  }

  function resetPanelWidth(event) {
    event?.preventDefault?.();
    applyPanelWidth(PANEL_DEFAULT_WIDTH);
  }

  function applyPanelWidth(width, options = {}) {
    const nextWidth = clampPanelWidth(width);
    document.documentElement.style.setProperty('--codex-overleaf-panel-width', `${nextWidth}px`);
    if (state) {
      state.panelWidth = nextWidth;
    }
    if (options.persist !== false) {
      saveStateSoon();
    }
    return nextWidth;
  }

  function clampPanelWidth(width) {
    const viewportWidth = Number(window.innerWidth);
    const viewportMax = Number.isFinite(viewportWidth)
      ? Math.max(PANEL_MIN_WIDTH, viewportWidth - PAGE_MIN_WIDTH)
      : PANEL_MAX_WIDTH;
    const maxWidth = Math.min(PANEL_MAX_WIDTH, viewportMax);
    const numericWidth = Number(width);
    if (!Number.isFinite(numericWidth)) {
      return PANEL_DEFAULT_WIDTH;
    }
    return Math.round(Math.min(maxWidth, Math.max(PANEL_MIN_WIDTH, numericWidth)));
  }

  function getRunningSessionIds() {
    return (state.sessions || [])
      .filter(isSessionRunning)
      .map(session => session.id);
  }

  function isSessionRunning(session) {
    return Boolean((session?.runs || []).some(run => run.status === 'running'));
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
      label.textContent = tr('emptyRunLabel');
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
      `${tr('mode')}: ${formatModeLabel(run.mode)}`,
      run.model,
      run.reasoningEffort,
      run.startedAt ? formatEventTime(run.startedAt) : ''
    ].filter(Boolean).join(' · ');
    root.innerHTML = `
      <div class="transcript-turn-main">
        <div class="run-prompt" data-run-task></div>
        <div class="run-turn-meta">
          <button type="button" data-run-undo hidden title="Undo this run's writes to Overleaf">Undo</button>
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
      return tr('processing', { elapsed: '' }).trim();
    }
    if (run.startedAt && run.finishedAt) {
      return formatProcessedSummary(run.status || 'completed', new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime());
    }
    return run.status === 'failed' ? tx('Failed', '处理失败') : tx('Done', '已处理');
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
        renderMarkdownInlineText(text, event.title || '');
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
    renderMarkdownInlineText(text, event.title || '');

    row.append(text);
    return row;
  }

  function renderMarkdownInlineText(target, value) {
    target.replaceChildren(...buildMarkdownInlineNodes(value));
  }

  function buildMarkdownInlineNodes(value) {
    const source = String(value || '');
    const nodes = [];
    let index = 0;

    while (index < source.length) {
      const next = findNextInlineMarkdown(source, index);
      if (!next) {
        nodes.push(document.createTextNode(source.slice(index)));
        break;
      }

      if (next.start > index) {
        nodes.push(document.createTextNode(source.slice(index, next.start)));
      }

      if (next.type === 'strong') {
        const strong = document.createElement('strong');
        strong.append(...buildMarkdownInlineNodes(next.text));
        nodes.push(strong);
      } else if (next.type === 'code') {
        const code = document.createElement('code');
        code.textContent = next.text;
        nodes.push(code);
      } else if (next.type === 'link') {
        const link = document.createElement('a');
        link.href = formatMarkdownHref(next.href);
        link.textContent = formatMarkdownLinkLabel(next.text, next.href);
        link.title = next.href;
        link.target = '_blank';
        link.rel = 'noreferrer';
        nodes.push(link);
      }

      index = next.end;
    }

    return nodes;
  }

  function findNextInlineMarkdown(source, index) {
    const candidates = [
      findStrongMarkdown(source, index),
      findCodeMarkdown(source, index),
      findLinkMarkdown(source, index)
    ].filter(Boolean);
    candidates.sort((left, right) => left.start - right.start);
    return candidates[0] || null;
  }

  function findStrongMarkdown(source, index) {
    const start = source.indexOf('**', index);
    if (start === -1) {
      return null;
    }
    const end = source.indexOf('**', start + 2);
    if (end === -1) {
      return null;
    }
    return {
      type: 'strong',
      start,
      end: end + 2,
      text: source.slice(start + 2, end)
    };
  }

  function findCodeMarkdown(source, index) {
    const start = source.indexOf('`', index);
    if (start === -1) {
      return null;
    }
    const end = source.indexOf('`', start + 1);
    if (end === -1) {
      return null;
    }
    return {
      type: 'code',
      start,
      end: end + 1,
      text: source.slice(start + 1, end)
    };
  }

  function findLinkMarkdown(source, index) {
    const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
    linkPattern.lastIndex = index;
    const match = linkPattern.exec(source);
    if (!match) {
      return null;
    }
    return {
      type: 'link',
      start: match.index,
      end: match.index + match[0].length,
      text: match[1],
      href: match[2]
    };
  }

  function formatMarkdownLinkLabel(text, href) {
    const source = String(text || '');
    const target = String(href || '');
    const workspaceMatch = target.match(/\/workspace\/([^:)]+)(?::(\d+))?/);
    if (workspaceMatch) {
      const fileLabel = workspaceMatch[1];
      const line = workspaceMatch[2];
      return line ? `workspace/${fileLabel}:${line}` : `workspace/${fileLabel}`;
    }
    return source || target;
  }

  function formatMarkdownHref(href) {
    const target = String(href || '').trim();
    if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) {
      return '#';
    }
    try {
      const parsed = new URL(target);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.href;
      }
    } catch (_error) {
      // Fall through to inert link for malformed URLs.
    }
    return '#';
  }

  function renderMarkdownBlockText(target, value) {
    const source = normalizeInlineOrderedLists(String(value || '').trim());
    target.replaceChildren();
    if (!source) {
      return;
    }

    const lines = source.split(/\r?\n/);
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];
      if (!line.trim()) {
        index++;
        continue;
      }

      if (isMarkdownHeadingLine(line)) {
        const heading = document.createElement('p');
        heading.className = 'run-final-heading';
        heading.append(...buildMarkdownInlineNodes(line.replace(/^\s*#{1,6}\s+/, '').trim()));
        target.append(heading);
        index++;
        continue;
      }

      if (isMarkdownListLine(line)) {
        const ordered = isMarkdownOrderedListLine(line);
        const list = ordered ? document.createElement('ol') : document.createElement('ul');
        while (index < lines.length && isSameMarkdownListKind(lines[index], ordered)) {
          const item = document.createElement('li');
          item.append(...buildMarkdownInlineNodes(stripMarkdownListMarker(lines[index])));
          list.append(item);
          index++;
        }
        target.append(list);
        continue;
      }

      const paragraphLines = [];
      while (
        index < lines.length &&
        lines[index].trim() &&
        !isMarkdownListLine(lines[index]) &&
        !isMarkdownHeadingLine(lines[index])
      ) {
        paragraphLines.push(lines[index].trim());
        index++;
      }

      const paragraph = document.createElement('p');
      paragraph.append(...buildMarkdownInlineNodes(paragraphLines.join(' ')));
      target.append(paragraph);
    }
  }

  function isMarkdownListLine(line) {
    return isMarkdownUnorderedListLine(line) || isMarkdownOrderedListLine(line);
  }

  function isMarkdownUnorderedListLine(line) {
    return /^\s*-\s+/.test(line);
  }

  function isMarkdownOrderedListLine(line) {
    return /^\s*\d+\.\s+/.test(line);
  }

  function isSameMarkdownListKind(line, ordered) {
    return ordered ? isMarkdownOrderedListLine(line) : isMarkdownUnorderedListLine(line);
  }

  function stripMarkdownListMarker(line) {
    return String(line || '').replace(/^\s*(?:-\s+|\d+\.\s+)/, '');
  }

  function normalizeInlineOrderedLists(source) {
    return String(source || '').split(/\r?\n/).map(line => {
      if (isMarkdownListLine(line) || !/\s1\.\s+\S/.test(line) || !/\s2\.\s+\S/.test(line)) {
        return line;
      }

      const markers = [];
      const pattern = /(^|\s)(\d{1,2})\.\s+(?=\S)/g;
      let match;
      while ((match = pattern.exec(line)) !== null) {
        markers.push({
          number: Number(match[2]),
          start: match.index + match[1].length
        });
      }
      if (markers.length < 2 || markers[0].number !== 1) {
        return line;
      }
      for (let index = 1; index < markers.length; index++) {
        if (markers[index].number !== markers[index - 1].number + 1) {
          return line;
        }
      }

      const parts = [];
      const prefix = line.slice(0, markers[0].start).trim();
      if (prefix) {
        parts.push(prefix);
      }
      for (let index = 0; index < markers.length; index++) {
        const start = markers[index].start;
        const end = index + 1 < markers.length ? markers[index + 1].start : line.length;
        parts.push(line.slice(start, end).trim());
      }
      return parts.join('\n');
    }).join('\n');
  }

  function isMarkdownHeadingLine(line) {
    return /^\s*(#{1,6}\s+\S|\*\*[^*]+\*\*:?\s*)$/.test(line);
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
    title.textContent = event.title || tr('technicalDetails');

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
      [tx('Step', '步骤')]: event?.title || '',
      [tx('Status', '状态')]: event?.status || ''
    };
    if (event?.timestamp) {
      detail[tx('Time', '时间')] = formatEventTime(event.timestamp);
    }
    if (hasNonEmptyDetail(event?.detail)) {
      detail[tx('Content', '内容')] = event.detail;
    }
    if (hasNonEmptyDetail(event?.technicalDetail)) {
      detail[tx('Raw event', '原始事件')] = event.technicalDetail;
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
    renderMarkdownBlockText(body, formatEventDetail(event.detail || {}));
    report.append(body);
    return report;
  }

  function configureUndoButton(root, run) {
    const existing = root.querySelector('[data-run-undo]');
    const button = existing.cloneNode(true);
    existing.replaceWith(button);
    const undoCount = getRunUndoCount(run);
    if (!undoCount && run.undoStatus !== 'applied') {
      button.hidden = true;
      return;
    }

    button.hidden = false;
    button.disabled = run.undoStatus === 'running' || run.undoStatus === 'applied';
    button.textContent = run.undoStatus === 'applied'
      ? tr('undoApplied')
      : (run.partialWriteback ? tr('undoPartialRun') : tr('undoRun'));
    button.title = run.undoStatus === 'applied'
      ? tr('undoAppliedTitle')
      : (run.partialWriteback ? tr('undoPartialRunTitle') : tr('undoRunTitle'));
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
    if (!getRunUndoCount(run) || run.undoStatus === 'applied') {
      return;
    }

    if ((Array.isArray(run.undoTrackedChanges) && run.undoTrackedChanges.length) || hasTrackedEditorUndo(run)) {
      await undoRunTrackedChanges(runId, run);
      return;
    }

    const undoRestore = buildNoTraceUndoRestore(run);
    const undoOperations = undoRestore.operations;
    const unsafeFullFileUndo = findUnsafeFullFileUndoOperation(undoOperations, {
      allowSnapshotRestore: undoRestore.snapshotRestore
    });
    if (unsafeFullFileUndo) {
      appendRunRecordEvent(runId, {
        title: tr('undoUnsafeFullFileTitle'),
        status: 'failed',
        detail: {
          [tr('detailFile')]: unsafeFullFileUndo.path,
          [tr('detailReason')]: tr('undoUnsafeFullFileReason')
        }
      });
      return;
    }

    const approved = await showPluginConfirm({
      title: tr('undoNoTraceTitle'),
      message: [
        truncateRunTitle(run.task),
        '',
        tr('undoNoTraceMessage', { files: formatOperationFiles(undoOperations) })
      ].join('\n'),
      confirmLabel: tr('undoConfirm'),
      cancelLabel: tr('confirmDefaultCancel'),
      destructive: true
    });
    if (!approved) {
      return;
    }

    setRunUndoStatus(runId, 'running');
    appendRunRecordEvent(runId, {
      title: tr('undoNoTraceStarted'),
      status: 'running',
      detail: { [tr('detailWillUndo')]: formatOperationFiles(undoOperations) }
    });

    const result = await callPageBridge('applyOperations', {
      operations: undoOperations,
      baseFiles: run.undoBaseFiles || [],
      reviewingPolicy: 'no-trace-undo'
    });
    appendUndoReviewingPolicyEvent(runId, result.reviewingPolicy);
    appendRunRecordEvent(runId, {
      title: tr('undoResult', { applied: result.applied?.length || 0, skipped: result.skipped?.length || 0 }),
      status: result.skipped?.length ? 'failed' : 'completed',
      detail: {
        [tr('detailUndone')]: (result.applied || []).map(item => ({
          [tr('detailAction')]: formatOperationType(item.operation?.type),
          [tr('detailFile')]: item.operation?.path
        })),
        [tr('detailSkipped')]: (result.skipped || []).map(item => ({
          [tr('detailAction')]: formatOperationType(item.operation?.type),
          [tr('detailFile')]: item.operation?.path,
          [tr('detailReason')]: formatApplyResultReason(item)
        }))
      }
    });
    setRunUndoStatus(runId, result.skipped?.length ? 'partial' : 'applied');
  }

  async function undoRunTrackedChanges(runId, run) {
    const trackedUndo = Array.isArray(run.undoTrackedChanges) && run.undoTrackedChanges.length > 0;
    const approved = await showPluginConfirm({
      title: trackedUndo ? tr('undoTrackedTitle') : tr('undoNativeTitle'),
      message: [
        truncateRunTitle(run.task),
        '',
        trackedUndo
          ? tr('undoTrackedMessage', { files: formatTrackedChangeFiles(run.undoTrackedChanges) })
          : tr('undoNativeMessage', { files: formatTrackedUndoFiles(run) })
      ].join('\n'),
      confirmLabel: trackedUndo ? tr('undoTrackedConfirm') : tr('undoConfirm'),
      cancelLabel: tr('confirmDefaultCancel'),
      destructive: true
    });
    if (!approved) {
      return;
    }

    setRunUndoStatus(runId, 'running');
    appendRunRecordEvent(runId, {
      title: trackedUndo ? tr('undoTrackedStarted') : tr('undoNativeStarted'),
      status: 'running',
      detail: { [tr('detailWillUndo')]: trackedUndo ? formatTrackedChangeFiles(run.undoTrackedChanges) : formatTrackedUndoFiles(run) }
    });

    const result = await callPageBridge('rejectTrackedChanges', {
      trackedChanges: run.undoTrackedChanges || [],
      expectedFiles: run.undoExpectedFiles || [],
      postFiles: buildTrackedUndoPostFiles(run)
    });
    appendRunRecordEvent(runId, {
      title: trackedUndo
        ? tr('undoTrackedResult', { applied: result.applied?.length || 0, skipped: result.skipped?.length || 0 })
        : tr('undoNativeResult', { applied: result.applied?.length || 0, skipped: result.skipped?.length || 0 }),
      status: result.skipped?.length ? 'failed' : 'completed',
      detail: {
        [trackedUndo ? tr('detailRejected') : tr('detailUndone')]: (result.applied || []).map(item => ({
          [tr('detailFile')]: item.trackedChange?.path || tr('unknownFile'),
          [tr('detailRecord')]: item.trackedChange?.label || item.trackedChange?.id || item.trackedChange?.key
        })),
        [tr('detailSkipped')]: (result.skipped || []).map(item => ({
          [tr('detailFile')]: item.trackedChange?.path || tr('unknownFile'),
          [tr('detailRecord')]: item.trackedChange?.label || item.trackedChange?.id || item.trackedChange?.key || '',
          [tr('detailReason')]: formatBridgeResultReason(item.result, item.trackedChange?.path)
        }))
      }
    });
    setRunUndoStatus(runId, result.skipped?.length ? 'partial' : 'applied');
  }

  function getRunUndoCount(run) {
    if (!run) {
      return 0;
    }
    return (run.undoOperations?.length || 0)
      + (run.undoTrackedChanges?.length || 0)
      + (hasTrackedEditorUndo(run) ? 1 : 0);
  }

  function appendUndoReviewingPolicyEvent(runId, reviewingPolicy) {
    if (!reviewingPolicy || reviewingPolicy.policy !== 'no-trace-undo') {
      return;
    }
    if (reviewingPolicy.disabled && reviewingPolicy.leftEditing) {
      appendRunRecordEvent(runId, {
        title: tr('undoSwitchedEditing'),
        status: 'completed'
      });
      return;
    }
    if (reviewingPolicy.disabled && !reviewingPolicy.restored) {
      appendRunRecordEvent(runId, {
        title: tr('undoReviewingRestoreUnverified'),
        status: 'failed',
        detail: {
          [tr('detailNext')]: tr('undoReviewingRestoreNext')
        }
      });
    }
  }

  function buildNoTraceUndoRestoreOperations(run) {
    return buildNoTraceUndoRestore(run).operations;
  }

  function buildNoTraceUndoRestore(run) {
    return buildSnapshotRestoreUndo({
      undoOperations: Array.isArray(run?.undoOperations) ? run.undoOperations : [],
      undoBaseFiles: Array.isArray(run?.undoBaseFiles) ? run.undoBaseFiles : [],
      undoExpectedFiles: Array.isArray(run?.undoExpectedFiles) ? run.undoExpectedFiles : []
    });
  }

  function hasNoTraceSnapshotUndo(run) {
    return buildNoTraceUndoRestore(run).snapshotRestore;
  }

  function findUnsafeFullFileUndoOperation(operations = [], options = {}) {
    if (options.allowSnapshotRestore === true) {
      return null;
    }
    return (operations || []).find(operation => {
      if (!operation || operation.type !== 'edit') {
        return false;
      }
      if (Array.isArray(operation.patches) && operation.patches.length) {
        return false;
      }
      return typeof operation.replaceAll === 'string'
        && operation.replaceAll.length > MAX_SAFE_UNDO_REPLACEALL_CHARS;
    }) || null;
  }

  function recordUndoFromApply(project, applyResult) {
    if (!currentRunView?.recordId || !applyResult?.applied?.length) {
      return;
    }
    const appliedOperations = applyResult.applied
      .map(item => item.operation)
      .filter(Boolean);
    const trackedChanges = normalizeApplyTrackedChanges(applyResult?.trackedChanges || []);
    const record = findRunRecord(currentRunView.recordId, currentRunView.sessionId);
    if (!record) {
      return;
    }

    const combinedAppliedOperations = [
      ...(Array.isArray(record.appliedOperations) ? record.appliedOperations : []),
      ...appliedOperations
    ];
    record.appliedOperations = combinedAppliedOperations;

    if (state.requireReviewing === true) {
      const combinedTrackedChanges = mergeTrackedChanges([
        ...(Array.isArray(record.undoTrackedChanges) ? record.undoTrackedChanges : []),
        ...trackedChanges
      ]);
      record.undoOperations = [];
      record.undoBaseFiles = [];
      record.undoTrackedChanges = combinedTrackedChanges;
      record.undoExpectedFiles = selectExpectedFilesForTrackedUndo(project, combinedAppliedOperations, combinedTrackedChanges);
      record.undoStatus = '';
      record.partialWriteback = Boolean(applyResult.skipped?.length);
      refreshRunCardControls(record.id);
      if (combinedTrackedChanges.length) {
        appendRunEvent({
          title: tr('undoCheckpointTracked', { count: combinedTrackedChanges.length }),
          status: 'completed',
          detail: combinedTrackedChanges.map(change => ({
            [tr('detailFile')]: change.path,
            [tr('detailRecord')]: change.label || change.id || change.key
          }))
        });
      } else if (hasTrackedEditorUndo(record)) {
        appendRunEvent({
          title: tr('undoCheckpointNative', { files: formatTrackedUndoFiles(record) }),
          status: 'completed',
          detail: {
            [tr('detailMethod')]: tr('undoCheckpointNativeMethod')
          }
        });
      } else {
        appendRunEvent({
          title: tr('undoCheckpointMissing'),
          status: 'failed',
          detail: {
            [tr('detailReason')]: tr('undoCheckpointMissingReason'),
            [tr('detailNext')]: tr('undoCheckpointMissingNext')
          }
        });
      }
      return;
    }

    const checkpoint = buildUndoCheckpoint(project, combinedAppliedOperations);
    if (!checkpoint.undoOperations.length) {
      return;
    }

    record.undoOperations = checkpoint.undoOperations;
    record.undoBaseFiles = checkpoint.undoBaseFiles;
    record.undoTrackedChanges = [];
    record.undoExpectedFiles = selectExpectedFilesForTrackedUndo(project, combinedAppliedOperations, []);
    record.undoStatus = '';
    record.partialWriteback = Boolean(applyResult.skipped?.length);
    refreshRunCardControls(record.id);
    appendRunEvent({
      title: tr('undoCheckpointPlain', { count: record.undoOperations.length }),
      status: 'completed',
      detail: checkpoint.undoOperations.map(operation => ({
        [tr('detailAction')]: formatOperationType(operation.type),
        [tr('detailFile')]: operation.path,
        [tr('detailTarget')]: operation.to,
        [tr('detailReason')]: operation.reason
      }))
    });
  }

  function normalizeApplyTrackedChanges(changes = []) {
    const seen = new Set();
    const normalized = [];
    for (const change of changes || []) {
      const key = typeof change?.key === 'string' ? change.key : '';
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      normalized.push({
        key,
        id: typeof change.id === 'string' ? change.id : '',
        path: typeof change.path === 'string' ? change.path : '',
        label: typeof change.label === 'string' ? change.label : ''
      });
    }
    return normalized;
  }

  function mergeTrackedChanges(changes = []) {
    return normalizeApplyTrackedChanges(changes);
  }

  function selectExpectedFilesForTrackedUndo(project, operations = [], trackedChanges = []) {
    const paths = new Set();
    for (const change of trackedChanges || []) {
      if (change.path) {
        paths.add(change.path);
      }
    }
    for (const operation of operations || []) {
      if (operation?.path) {
        paths.add(operation.path);
      }
      if (operation?.to) {
        paths.add(operation.to);
      }
    }
    return (project?.files || [])
      .filter(file => paths.has(file.path) && typeof file.content === 'string')
      .map(file => ({
        path: file.path,
        content: file.content
      }));
  }

  function buildTrackedUndoPostFiles(run) {
    const expectedFiles = Array.isArray(run?.undoExpectedFiles) ? run.undoExpectedFiles : [];
    const appliedOperations = Array.isArray(run?.appliedOperations) ? run.appliedOperations : [];
    if (!expectedFiles.length || !appliedOperations.length) {
      return [];
    }

    const postFilesByPath = buildExpectedFilesAfterOperations(
      { files: expectedFiles },
      appliedOperations
    );
    const expectedPaths = new Set(expectedFiles.map(file => file?.path).filter(Boolean));
    return Array.from(postFilesByPath.entries())
      .filter(([path, content]) => expectedPaths.has(path) && typeof content === 'string')
      .map(([path, content]) => ({
        path,
        content
      }));
  }

  function hasTrackedEditorUndo(run) {
    return buildTrackedUndoPostFiles(run).length > 0;
  }

  function formatTrackedUndoFiles(run) {
    const files = buildTrackedUndoPostFiles(run).map(file => file.path).filter(Boolean);
    return files.join(', ') || formatTrackedChangeFiles(run?.undoTrackedChanges || []);
  }

  function formatTrackedChangeFiles(changes = []) {
    const files = [];
    const seen = new Set();
    for (const change of changes || []) {
      const path = change?.path || tr('unknownFile');
      if (!seen.has(path)) {
        seen.add(path);
        files.push(path);
      }
    }
    return files.join(', ') || tx('this run\'s tracked changes', '本轮留痕改动');
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

  function findRunRecord(runId, sessionId = '') {
    if (!runId) {
      return null;
    }
    if (sessionId) {
      const session = findSessionById(sessionId);
      return (session?.runs || []).find(run => run.id === runId) || null;
    }
    return (state.runs || []).find(run => run.id === runId)
      || (state.sessions || []).flatMap(session => session.runs || []).find(run => run.id === runId)
      || null;
  }

  function findSessionById(sessionId) {
    if (!sessionId) {
      return null;
    }
    return (state.sessions || []).find(session => session.id === sessionId)
      || (state.session?.id === sessionId ? state.session : null);
  }

  function replaceSessionInState(session) {
    if (!session?.id) {
      return;
    }
    state = normalizePanelState({
      ...state,
      sessions: (state.sessions || []).map(item => item.id === session.id ? session : item)
    });
  }

  function updateSessionById(sessionId, patch = {}) {
    const session = findSessionById(sessionId);
    if (!session) {
      return;
    }
    replaceSessionInState({
      ...session,
      ...patch
    });
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
        title: tx('No files were changed in this run.', '本轮未修改文件。'),
        status: 'completed'
      });
      return;
    }

    const total = Object.values(summary.counts || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
    if (!total) {
      appendRunEvent({
        title: tx('No files were changed in this run.', '本轮未修改文件。'),
        status: 'completed',
        detail: {
          [tx('Note', '说明')]: tx('Codex did not propose changes that need to be written to Overleaf.', 'Codex 没有提出需要写入 Overleaf 的修改。')
        }
      });
      return;
    }

    appendRunEvent({
      title: tx(`Preparing to modify ${summary.affectedFiles?.length || 0} file(s).`, `准备修改 ${summary.affectedFiles?.length || 0} 个文件。`),
      status: 'completed',
      detail: {
        [tx('Affected files', '会影响的文件')]: summary.affectedFiles?.length ? summary.affectedFiles : tr('noneValue'),
        [tr('operationEdit')]: summary.counts?.edit || 0,
        [tr('operationCreate')]: summary.counts?.create || 0,
        [tr('operationRename')]: summary.counts?.rename || 0,
        [tr('operationMove')]: summary.counts?.move || 0,
        [tr('operationDelete')]: summary.counts?.delete || 0,
        [tx('Deletes requiring separate confirmation', '需要单独确认的删除')]: summary.deletePlan?.length ? summary.deletePlan : tr('noneValue')
      }
    });
  }

  function appendPlannedChangeSummary(summary, title) {
    if (!summary) {
      appendRunEvent({
        title: tx(`${title}: no files need changes`, `${title}：没有文件需要修改`),
        status: 'completed'
      });
      return;
    }
    const files = summary.affectedFiles || [];
    appendRunEvent({
      title: files.length
        ? tx(`${title}: ${files.join(', ')}`, `${title}：${files.join(', ')}`)
        : tx(`${title}: no files need changes`, `${title}：没有文件需要修改`),
      status: 'completed',
      detail: {
        [tr('operationEdit')]: summary.counts?.edit || 0,
        [tr('operationCreate')]: summary.counts?.create || 0,
        [tr('operationDelete')]: summary.counts?.delete || 0
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
    const record = currentRunView?.recordId ? findRunRecord(currentRunView.recordId, currentRunView.sessionId) : null;
    const undoCount = getRunUndoCount(record);
    const report = buildHumanCompletionReport({
      ...input,
      locale: getLocale(),
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
      return tx('Non-delete changes were kept; delete items were cancelled.', '已保留非删除修改，删除项已取消。');
    }
    if (!operations?.length) {
      return tx('No files were changed in this run.', '本轮未修改文件。');
    }
    return groupOperationsByFile(operations)
      .map(group => `${group.path}: ${group.operations.map(operation => formatOperationType(operation.type)).join(listSeparator())}`)
      .join(getLocale() === 'zh' ? '；' : '; ');
  }

  function formatCompletionNextStep(input, skippedCount) {
    if (skippedCount) {
      return tx('Expand the write result, review the skipped reasons, then retry after fixing them.', '请展开写入结果查看跳过原因，处理后可以重试。');
    }
    if (input.status === 'rejected') {
      return tx('Adjust the task description and run again.', '可以调整任务描述后重新运行。');
    }
    if (input.status === 'blocked' || input.status === 'failed') {
      return tx('Fix the reason above, then retry.', '请处理上面的原因后重试。');
    }
    return tx('Continue the conversation or run the next task.', '可以继续追问，或运行下一项任务。');
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
        title: tx(`${title}: no files changed in this run`, `${title}：本轮未修改文件`),
        status: 'completed'
      });
      return;
    }

    const groups = groupOperationsByFile(operations);
    appendRunEvent({
      title: tx(`${title}: ${groups.length} file(s)`, `${title}：${groups.length} 个文件`),
      status: 'completed',
      detail: groups.map(group => ({
        [tr('detailFile')]: group.path,
        [tx('Changes', '修改')]: group.operations.map(formatFileChangePreview)
      }))
    });
  }

  function groupOperationsByFile(operations = []) {
    const groups = [];
    const byPath = new Map();
    for (const operation of operations || []) {
      const path = operation?.path || operation?.from || operation?.to || tr('unknownFile');
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
    const reason = formatOperationReason(operation);
    if (reason) {
      parts.push(tx(`reason: ${reason}`, `原因：${reason}`));
    }
    if (operation?.type === 'edit') {
      if (Array.isArray(operation.patches) && operation.patches.length) {
        parts.push(tx(`local edit in ${operation.patches.length} place(s)`, `局部修改 ${operation.patches.length} 处`));
      } else if (operation.find || operation.replace) {
        parts.push(tx(
          `replace "${truncateInline(operation.find || '')}" with "${truncateInline(operation.replace || '')}"`,
          `把「${truncateInline(operation.find || '')}」改为「${truncateInline(operation.replace || '')}」`
        ));
      } else if (operation.replaceAll) {
        parts.push(tx(`full-text replacement, ${String(operation.replaceAll).length} chars`, `全文替换为 ${String(operation.replaceAll).length} 字符`));
      }
    }
    if (operation?.to) {
      parts.push(tx(`target: ${operation.to}`, `目标：${operation.to}`));
    }
    return parts.join(getLocale() === 'zh' ? '；' : '; ');
  }

  function formatOperationReason(operation) {
    const key = operation?.reasonKey || '';
    const count = Number(operation?.reasonParams?.count || 0);
    if (key === 'localWorkspaceDelete') {
      return tx('Local Codex workspace deleted this file.', '本地 Codex workspace 删除了这个文件。');
    }
    if (key === 'localWorkspacePatch') {
      return tx(
        `Synced ${count || 0} local Codex workspace edit${Number(count) === 1 ? '' : 's'}.`,
        `同步本地 Codex workspace 中的局部文件改动（${count || 0} 处）。`
      );
    }
    if (key === 'localWorkspaceContent') {
      return tx('Synced file content from the local Codex workspace.', '同步本地 Codex workspace 中的文件内容。');
    }
    if (key === 'localWorkspaceCreate') {
      return tx('Synced a new file from the local Codex workspace.', '同步本地 Codex workspace 中的新文件。');
    }
    return localizeVisibleReason(operation?.reason || '');
  }

  function appendPartialWritebackWarning(result) {
    const applied = result?.applied || [];
    const skipped = result?.skipped || [];
    if (!applied.length && !skipped.length) {
      return;
    }
    const record = currentRunView?.recordId ? findRunRecord(currentRunView.recordId, currentRunView.sessionId) : null;
    const undoAvailable = getRunUndoCount(record) > 0;
    appendRunEvent({
      title: applied.length
        ? tx(
          `Partial writeback completed: ${applied.length} item(s) were written to Overleaf, ${skipped.length} item(s) were not written.`,
          `部分写入已完成：${applied.length} 项已经进入 Overleaf，${skipped.length} 项没有写入。`
        )
        : tx(
          `Writeback skipped: ${skipped.length} item(s) were not written to Overleaf.`,
          `写入被跳过：${skipped.length} 项没有写入 Overleaf。`
        ),
      status: 'failed',
      detail: {
        [tx('Recovery', '恢复操作')]: undoAvailable
          ? tx('Use this run\'s "Undo written parts" button to roll back the changes already written to Overleaf.', '点击本轮的“撤销已写入部分”按钮，可以先回退已经进入 Overleaf 的改动。')
          : tx('No automatic undo is available for this run. Review the file list below manually.', '本轮没有可自动撤销的写入；请按下面的文件列表手动检查。')
        ,
        [tx('Written; can be rolled back with Undo written parts', '已经写入，可点“撤销已写入部分”回退')]: applied.map(item => ({
          [tr('detailAction')]: formatOperationType(item.operation?.type),
          [tr('detailFile')]: item.operation?.path || item.operation?.to || tr('unknownFile')
        })),
        [tx('Not written; fix and retry', '没有写入，需要处理后重试')]: skipped.map(item => ({
          [tr('detailAction')]: formatOperationType(item.operation?.type),
          [tr('detailFile')]: item.operation?.path || item.operation?.to || tr('unknownFile'),
          [tr('detailReason')]: formatApplyResultReason(item)
        }))
      }
    });
  }

  function formatWritebackSkippedNextStep(result = {}) {
    const appliedCount = result.applied?.length || 0;
    if (appliedCount > 0) {
      return tx('Review the skipped reasons. You can use "Undo written parts" to roll back what already reached Overleaf, then fix conflicts and retry.', '请查看跳过原因。已写入的部分可以点击“撤销已写入部分”回退，处理冲突后再重试。');
    }
    return tx('Nothing was written in this run. Review the skipped reasons, fix them, and retry.', '这轮没有任何内容写入。请查看跳过原因，处理后重试。');
  }

  function appendApplyResult(result) {
    if (!result) {
      return;
    }
    const applied = result.applied?.length || 0;
    const skipped = result.skipped?.length || 0;
    appendRunEvent({
      title: tx(`Write result: wrote ${applied} item(s), skipped ${skipped}`, `写入结果：已写入 ${applied} 项，跳过 ${skipped} 项`),
      status: skipped ? 'failed' : 'completed',
      detail: {
        [tx('Written', '已写入')]: (result.applied || []).map(item => ({
          [tr('detailAction')]: formatOperationType(item.operation?.type),
          [tr('detailFile')]: item.operation?.path,
          [tx('Status', '状态')]: item.result?.status
        })),
        [tr('detailSkipped')]: (result.skipped || []).map(item => ({
          [tr('detailAction')]: formatOperationType(item.operation?.type),
          [tr('detailFile')]: item.operation?.path,
          [tr('detailReason')]: formatApplyResultReason(item)
        }))
      }
    });
  }

  function formatApplyResultReason(item = {}) {
    const result = item.result || {};
    const operation = item.operation || {};
    const key = result.reasonKey || '';
    const code = result.code || '';
    const filePath = result.reasonParams?.filePath || operation.path || operation.from || operation.to || '';
    if (key === 'missingBaseFile' || code === 'missing_base_file') {
      const target = filePath || tx('this file', '这个文件');
      return tx(
        `${target} was not read when the task started. Codex did not overwrite it; refresh the project content and retry.`,
        `${target} 在任务开始时没有被 Codex 读到。Codex 没有覆盖它；请刷新项目内容后重试。`
      );
    }
    if (key === 'staleSnapshot' || code === 'stale_snapshot') {
      const target = filePath || tx('this file', '这个文件');
      return tx(
        `${target} changed while Codex was working, so Codex did not overwrite it. Review the diff and retry.`,
        `${target} 在任务执行期间被你或协作者改过，Codex 没有覆盖它。请查看差异后重试。`
      );
    }
    if (key === 'stalePatchLocation') {
      return tx(
        'The edit location no longer matches the current Overleaf content, so nothing was written. Rerun the task.',
        'Codex 要修改的位置已经无法和当前 Overleaf 内容对齐，所以没有写入。请重新运行任务。'
      );
    }
    if (key === 'stalePatchConflict' || code === 'stale_patch_range') {
      return tx(
        'The exact edit location was changed by you or a collaborator, so Codex did not overwrite it. Review the diff and retry.',
        'Codex 要修改的具体位置已经被你或协作者改过，所以没有覆盖它。请查看差异后重试。'
      );
    }
    if (code === 'stale_patch') {
      return tx(
        'This exact text changed since Codex read it, so nothing was written. Rerun after Codex reads the latest Overleaf content.',
        '这处内容已经和 Codex 读取时不同，所以没有写入。请重新运行，让 Codex 先读取你的最新 Overleaf 内容。'
      );
    }
    if (code === 'invalid_patch') {
      return tx(
        'Codex produced an invalid local edit range, so nothing was written.',
        'Codex 生成的局部写入范围无效，所以没有写入。'
      );
    }
    if (code === 'write_verification_failed') {
      return tx(
        'After writing, the editor content did not match Codex\'s expected result, so the write was not marked successful. Reload Overleaf and retry.',
        '写入后读回内容和 Codex 预期不一致，已停止把这次操作标记为成功。请刷新 Overleaf 后重试。'
      );
    }
    if (code === 'file_tree_verification_failed') {
      return tx(
        'Overleaf did not confirm the file-tree operation, so Codex did not mark it successful.',
        'Overleaf 文件树操作没有被确认，Codex 已停止把这次操作标记为成功。'
      );
    }
    if (code === 'path_exists_in_snapshot') {
      const target = filePath || tx('this file', '这个文件');
      return tx(
        `${target} already existed when the task started. Codex did not overwrite it; edit the file instead or choose another filename.`,
        `${target} 在任务开始前已经存在。Codex 没有覆盖它；请改用修改文件或换一个文件名。`
      );
    }
    if (code === 'path_created_since_snapshot') {
      const target = filePath || tx('this file', '这个文件');
      return tx(
        `${target} was created by you or a collaborator while Codex was working, so Codex did not overwrite it. Review the diff and retry.`,
        `${target} 在任务执行期间被你或协作者新建了，Codex 没有覆盖它。请查看差异后重试。`
      );
    }
    return localizeVisibleReason(result.reason || result.error || result.code || tr('unknownReason'));
  }

  function formatBridgeResultReason(result = {}, fallbackPath = '') {
    const code = result.code || '';
    const path = result.path || fallbackPath || '';
    if (getLocale() !== 'en') {
      return localizeVisibleReason(result.reason || result.error || result.code || tr('unknownReason'));
    }
    if (code === 'missing_tracked_changes') {
      return 'No matching Overleaf tracked-change records were found for this run, so Codex did not undo with text patches.';
    }
    if (code === 'tracked_change_file_open_failed') {
      return path
        ? `Could not open ${path} to find this run's tracked changes. Handle them manually in the Overleaf review tools.`
        : 'Could not open the file to find this run\'s tracked changes. Handle them manually in the Overleaf review tools.';
    }
    if (code === 'tracked_change_not_found') {
      return 'No matching tracked changes were found on the Overleaf page for this run.';
    }
    if (code === 'tracked_change_reject_control_not_found') {
      return path
        ? `Some tracked changes in ${path} remain, but the matching Reject button was not found. Reject them manually in Overleaf.`
        : 'Some tracked changes remain, but the matching Reject button was not found. Reject them manually in Overleaf.';
    }
    if (code === 'tracked_change_reject_not_confirmed') {
      return 'Codex clicked Reject, but Overleaf still shows this tracked change. Reject it manually in the Overleaf review panel.';
    }
    if (code === 'tracked_change_editor_undo_open_failed') {
      return path ? `Could not open ${path} for Overleaf native undo.` : 'Could not open the file for Overleaf native undo.';
    }
    if (code === 'tracked_change_editor_undo_current_mismatch') {
      return path
        ? `${path} no longer matches this run's written content, so Codex did not use Overleaf native undo.`
        : 'The current content no longer matches this run\'s written content, so Codex did not use Overleaf native undo.';
    }
    if (code === 'editor_undo_control_not_found') {
      return path
        ? `Could not find Overleaf's editor Undo button to undo this run in ${path}.`
        : 'Could not find Overleaf\'s editor Undo button to undo this run.';
    }
    if (code === 'editor_undo_no_progress') {
      return path
        ? `Codex clicked Overleaf Undo, but ${path} did not change.`
        : 'Codex clicked Overleaf Undo, but the file did not change.';
    }
    if (code === 'editor_undo_max_iterations') {
      return path
        ? `${path} did not return to its pre-run content after repeated Overleaf native undo steps. Codex stopped to avoid undoing other edits.`
        : 'The file did not return to its pre-run content after repeated Overleaf native undo steps. Codex stopped to avoid undoing other edits.';
    }
    if (code === 'tracked_change_undo_max_iterations') {
      return path
        ? `${path} still has tracked changes left. Codex stopped to avoid rejecting unrelated edits.`
        : 'Tracked changes are still left. Codex stopped to avoid rejecting unrelated edits.';
    }
    if (code === 'tracked_change_undo_verify_open_failed') {
      return path
        ? `Could not open ${path} after undo to verify content. Reload Overleaf and check manually.`
        : 'Could not open the file after undo to verify content. Reload Overleaf and check manually.';
    }
    if (code === 'tracked_change_undo_verify_failed') {
      return path
        ? `${path} did not return to its pre-run content after rejecting tracked changes. Check this run's changes in the Overleaf review panel.`
        : 'The file did not return to its pre-run content after rejecting tracked changes. Check this run\'s changes in the Overleaf review panel.';
    }
    return localizeVisibleReason(result.reason || result.error || result.code || tr('unknownReason'));
  }

  function localizeVisibleReason(reason) {
    const text = String(reason || '').trim();
    if (!text || getLocale() !== 'en') {
      return text;
    }
    let match = text.match(/^(.+?) 在任务开始时没有被 Codex 读到。Codex 没有覆盖它；请刷新项目内容后重试。$/);
    if (match) {
      return `${match[1]} was not read when the task started. Codex did not overwrite it; refresh the project content and retry.`;
    }
    match = text.match(/^(.+?) 在任务执行期间被你或协作者改过，Codex 没有覆盖它。请查看差异后重试。$/);
    if (match) {
      return `${match[1]} changed while Codex was working, so Codex did not overwrite it. Review the diff and retry.`;
    }
    if (text.includes('Codex 要修改的位置已经无法和当前 Overleaf 内容对齐')) {
      return 'The edit location no longer matches the current Overleaf content, so nothing was written. Rerun the task.';
    }
    if (text.includes('Codex 要修改的具体位置已经被你或协作者改过')) {
      return 'The exact edit location was changed by you or a collaborator, so Codex did not overwrite it. Review the diff and retry.';
    }
    const patchMatch = text.match(/^同步本地 Codex workspace 中的局部文件改动（(\d+) 处）。$/);
    if (patchMatch) {
      const count = Number(patchMatch[1]) || 0;
      return `Synced ${count} local Codex workspace edit${count === 1 ? '' : 's'}.`;
    }
    if (text === '本地 Codex workspace 删除了这个文件。') {
      return 'Local Codex workspace deleted this file.';
    }
    if (text === '同步本地 Codex workspace 中的文件内容。') {
      return 'Synced file content from the local Codex workspace.';
    }
    if (text === '同步本地 Codex workspace 中的新文件。') {
      return 'Synced a new file from the local Codex workspace.';
    }
    return text;
  }

  function formatOperationType(type) {
    const labels = {
      edit: tr('operationEdit'),
      create: tr('operationCreate'),
      rename: tr('operationRename'),
      move: tr('operationMove'),
      delete: tr('operationDelete')
    };
    return labels[type] || type || tr('operationUnknown');
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
    return files.length ? files.join(', ') : tr('noneValue');
  }

  function appendLog(text) {
    if (currentRunView) {
      appendRunEvent({ title: text, status: 'info' });
      return;
    }
    appendPlainLog(text);
  }

  function appendPlainLog(text) {
    showPluginToast(text, { status: 'info' });
  }

  function showPluginToast(text, options = {}) {
    const region = panel?.querySelector('[data-toast-region]');
    if (!region) {
      return;
    }
    const value = String(text || '').trim();
    if (!value) {
      return;
    }

    const last = region.lastElementChild;
    if (last?.classList?.contains('codex-toast') && last.dataset.baseText === value) {
      const repeatCount = Number(last.dataset.repeatCount || '1') + 1;
      last.dataset.repeatCount = String(repeatCount);
      const textNode = last.querySelector('[data-toast-text]');
      if (textNode) {
        textNode.textContent = `${value}${tr('repeatCountSuffix', { count: repeatCount })}`;
      }
      return;
    }

    const item = document.createElement('div');
    item.className = 'codex-toast';
    item.dataset.baseText = value;
    item.dataset.repeatCount = '1';
    item.dataset.status = options.status || 'info';

    const body = document.createElement('div');
    body.className = 'codex-toast-body';
    body.dataset.toastText = 'true';
    body.textContent = value;
    item.append(body);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'codex-toast-close';
    close.setAttribute('aria-label', tr('dismissNotification'));
    close.textContent = '×';
    close.addEventListener('click', () => item.remove());
    item.append(close);

    region.append(item);
    while (region.children.length > 3) {
      region.firstElementChild?.remove();
    }

    if (!options.sticky) {
      setTimeout(() => {
        item.remove();
      }, 5200);
    }
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
      return tx('just now', '刚刚');
    }
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return tx(`${minutes} min`, `${minutes} 分钟`);
    }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return tx(`${hours}h`, `${hours} 小时`);
    }
    return tx(`${Math.floor(hours / 24)}d`, `${Math.floor(hours / 24)} 天`);
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
