(function initCodexOverleafContentRuntime(root) {
  'use strict';

  function init() {
  'use strict';

  const RUNTIME_INSTALLED_FLAG = '__codexOverleafContentRuntimeInstalled';
  const RUNTIME_STATE_KEY = '__codexOverleafContentRuntimeState';
  if (root[RUNTIME_INSTALLED_FLAG]) {
    return root[RUNTIME_STATE_KEY] || { ok: true, alreadyInstalled: true };
  }
  if (root.document?.getElementById?.('codex-overleaf-panel')) {
    const result = {
      ok: false,
      initFailed: true,
      alreadyInstalled: true,
      errorCode: 'stale-panel-before-runtime-init'
    };
    root[RUNTIME_INSTALLED_FLAG] = true;
    root[RUNTIME_STATE_KEY] = result;
    return result;
  }

  const PANEL_ID = 'codex-overleaf-panel';
  const LEGACY_STORAGE_KEY = 'codexOverleafPanelState';
  const RUN_PROJECT_SYNC_MAX_AGE_MS = 30000;
  const RUN_SNAPSHOT_ZIP_TIMEOUT_MS = 30000;
  const SNAPSHOT_PAGE_BRIDGE_TIMEOUT_MS = 70000;
  const COMPILE_PAGE_BRIDGE_TIMEOUT_MS = 75000;
  const CONTEXT_FILE_LIST_PAGE_BRIDGE_TIMEOUT_MS = 35000;
  const STREAM_RENDER_FLUSH_MS = 80;
  const STREAM_SAVE_DELAY_MS = 1000;
  const MAX_RUN_EVENTS = 300;
  const MAX_SAFE_UNDO_REPLACEALL_CHARS = 2000;
  const ONBOARDING_TIP_STORAGE_KEY = 'codexOverleafOnboardingTipShown';
  const NATIVE_COMPATIBILITY_GATED_METHODS = new Set([
    'mirror.status',
    'codex.models',
    'codex.cancel',
    'codex.run',
    'task.run',
    'task.confirm',
    'mirror.sync',
    'mirror.patchFiles',
    'mirror.scanSensitive',
    'codex.history.clearPlugin',
    'skills.list',
    'skills.install',
    'skills.remove'
  ]);
  const PANEL_DEFAULT_WIDTH = 380;
  const PANEL_MIN_WIDTH = 340;
  const PANEL_MAX_WIDTH = 760;
  const PAGE_MIN_WIDTH = 520;
  const CodexOverleafCompatibility = window.CodexOverleafCompatibility;
  const INSTALL_COMMAND = CodexOverleafCompatibility?.buildInstallCommand?.(
    undefined,
    undefined,
    getCurrentExtensionId()
  ) || 'curl -fsSL https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/main/install.sh | bash -s -- --extension-id <chrome-extension-id>';
  const PAGE_BRIDGE_SCRIPT_REVISION = '2026-05-21-editor-readiness-v10';
  const PAGE_BRIDGE_CAPABILITY = createPageBridgeCapability();
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
  const LineReferences = window.CodexOverleafLineReferences;
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
  const ReviewHunks = window.CodexOverleafReviewHunks;
  const DiffReviewPanel = window.CodexOverleafDiffReviewPanel;
  const ContextTray = window.CodexOverleafContextTray;
  const LocalSkillsPanel = window.CodexOverleafLocalSkillsPanel;
  const runController = window.CodexOverleafRunController;
  const mirrorHealth = window.CodexOverleafMirrorHealth;
  const otWarmMirrorController = window.CodexOverleafOtWarmMirrorController;
  const PanelRenderer = window.CodexOverleafPanelRenderer;
  const SessionPanel = window.CodexOverleafSessionPanel;
  const SettingsPanel = window.CodexOverleafSettingsPanel;
  const DiagnosticsPanel = window.CodexOverleafDiagnosticsPanel;
  const ComposerPanel = window.CodexOverleafComposerPanel;
  const GovernanceRules = window.CodexOverleafGovernanceRules;
  const SensitiveScan = window.CodexOverleafSensitiveScan;
  const AuditRecords = window.CodexOverleafAuditRecords;
  const MAX_COMPOSER_ATTACHMENT_BYTES = 12 * 1024 * 1024;
  const MAX_COMPOSER_ATTACHMENT_TOTAL_BYTES = 32 * 1024 * 1024;
  const MAX_COMPOSER_ATTACHMENTS = 8;
  const MAX_ATTACHMENT_PREVIEW_DATA_URL_CHARS = 768 * 1024;
  const composerAttachmentController = window.CodexOverleafComposerAttachments.createComposerAttachmentController({
    getPanel: () => panel,
    tr,
    tx,
    appendPlainLog,
    limits: {
      maxAttachmentBytes: MAX_COMPOSER_ATTACHMENT_BYTES,
      maxAttachmentTotalBytes: MAX_COMPOSER_ATTACHMENT_TOTAL_BYTES,
      maxAttachments: MAX_COMPOSER_ATTACHMENTS,
      maxPreviewDataUrlChars: MAX_ATTACHMENT_PREVIEW_DATA_URL_CHARS
    }
  });
  const diffReviewPanel = DiffReviewPanel.createDiffReviewPanelController({
    root: window,
    document,
    reviewHunks: ReviewHunks,
    tr,
    callPageBridge,
    getRunEvents: () => currentRunView?.events,
    appendRunEvent,
    scrollLogToBottom
  });
  const contextTrayController = ContextTray.createContextTrayController({
    root: window,
    document,
    getPanel: () => panel,
    getState: () => state,
    setState: nextState => {
      state = nextState;
    },
    saveState,
    saveStateSoon,
    updateActiveSession,
    callPageBridge,
    getCurrentProjectId,
    tr,
    tx,
    closeModelConfigPopover,
    closeDiagnosticsMenu,
    closeCustomInstructionsSettings,
    closeSlashMenu,
    projectFiles: window.CodexOverleafProjectFiles
  });
  const localSkillsPanel = LocalSkillsPanel.createLocalSkillsPanelController({
    root: window,
    document,
    getPanel: () => panel,
    getState: () => state,
    setState: nextState => {
      state = nextState;
    },
    saveState,
    sendBackgroundNative,
    getCurrentProjectId,
    getSkillLoadingSettings,
    setProjectSettingsStatus,
    tr,
    tx,
    getComposerSkillInvocation: () => composerSkillInvocation,
    normalizeComposerSkillInvocation,
    clearComposerSkillInvocation,
    setSlashCodexOverleafSkills: skills => {
      slashCodexOverleafSkills = Array.isArray(skills) ? skills : [];
      slashCodexOverleafSkillsLoaded = true;
    },
    clearSlashCodexOverleafSkills: () => {
      slashCodexOverleafSkills = [];
      slashCodexOverleafSkillsLoaded = false;
    }
  });

  let panel = null;
  let panelRendererInstance = null;
  let sessionPanelInstance = null;
  let settingsPanelInstance = null;
  let diagnosticsPanelInstance = null;
  let composerPanelInstance = null;
  let state = null;
  let storageKey = LEGACY_STORAGE_KEY;
  let currentRunView = null;
  let saveStateTimer = null;
  let streamRenderTimer = null;
  let pendingStreamRenderEvents = new Map();
  let storageNoticeKeys = new Set();
  let composerSkillInvocation = null;
  let slashCodexOverleafSkills = [];
  let slashCodexOverleafSkillsLoaded = false;
  let slashCodexOverleafSkillsLoading = false;
  let renderedSlashCommands = new Map();
  let customInstructionsEditorProjectId = '';
  let customInstructionsEditorValue = '';
  let logAutoFollow = true;
  let userScrollIntentUntil = 0;
  let runCancellationRequested = false;
  let activePluginConfirmResolve = null;
  let modelDiscovery = { status: 'fallback', source: 'fallback', fetchedAt: '' };
  let currentOtStatus = 'off';
  let otSyncRequestId = 0;
  let otWarmMirrorProjectId = '';
  let lastExperimentalOtProjectId = '';
  let otWarmMirrorState = {
    projectId: '',
    pollTimer: null,
    flushTimer: null,
    flushing: false,
    patchQueue: [],
    lastStatus: 'off',
    lastPatchAt: 0,
    lastErrorCode: ''
  };
  let mirrorPrefetchState = {
    inFlight: null,
    lastSuccessAt: 0,
    lastErrorAt: 0,
    lastError: null,
    timer: null,
    projectId: ''
  };

  root[RUNTIME_INSTALLED_FLAG] = true;
  root[RUNTIME_STATE_KEY] = { ok: true, alreadyInstalled: false };

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'codex-overleaf/open-panel') {
      ensurePanelOpen();
      sendResponse?.(getPanelStateResponse());
      return;
    }
    if (message?.type === 'codex-overleaf/get-panel-state') {
      sendResponse?.(getPanelStateResponse());
      return;
    }
    if (message?.type === 'codex-overleaf/toggle-panel') {
      if (isPanelOpen()) {
        closePanel();
      } else {
        ensurePanelOpen();
      }
      sendResponse?.(getPanelStateResponse());
      return;
    }
    if (nativeChannel.shouldHandleNativeEvent(message)) {
      appendNativeEvent(message.event);
    }
  });

  exposeSmokeHelper();
  init().catch(error => {
    root[RUNTIME_STATE_KEY] = {
      ok: false,
      initFailed: true,
      alreadyInstalled: true,
      errorCode: 'async-init-failed',
      message: error?.message || String(error)
    };
    throw error;
  });

  async function init() {
    storageKey = getProjectStorageKey(LEGACY_STORAGE_KEY, window.location.href);
    state = normalizePanelState(await loadStoredState(), { restoreRunningRuns: true });
    ensurePanelOpen();
    applyStateToPanel();
    loadModelOptions().catch(error => {
      applyFallbackModelOptions(resolveSelectedModel(), error);
    });
    syncOtWarmMirrorController().catch(error => {
      updateOtStatusDisplay('unavailable');
      appendPlainLog(tx(`Failed to sync experimental OT warm mirror: ${error.message}`, `同步实验性 OT 预热镜像失败：${error.message}`));
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

  function getExtensionCompatibilityMetadata() {
    return {
      version: CodexOverleafCompatibility?.BUILD_TARGET_VERSION ||
        chrome.runtime.getManifest?.().version ||
        '',
      extensionId: getCurrentExtensionId()
    };
  }

  function getCurrentExtensionId() {
    return typeof chrome === 'object' && chrome?.runtime?.id
      ? chrome.runtime.id
      : '';
  }

  function exposeSmokeHelper() {
    const helper = Object.freeze({
      probeNative: smokeProbeNative,
      probeProject: smokeProbeProject,
      getProjectSnapshotMetrics: smokeProbeProject
    });
    try {
      Object.defineProperty(globalThis, 'CodexOverleafSmoke', {
        configurable: true,
        enumerable: false,
        value: helper
      });
    } catch (_error) {
      globalThis.CodexOverleafSmoke = helper;
    }
  }

  async function smokeProbeNative() {
    try {
      const params = CodexOverleafCompatibility?.buildBridgePingParams
        ? CodexOverleafCompatibility.buildBridgePingParams(getExtensionCompatibilityMetadata())
        : {};
      const response = await sendBackgroundNative({ method: 'bridge.ping', params });
      const compatibility = CodexOverleafCompatibility?.evaluateNativeCompatibility
        ? CodexOverleafCompatibility.evaluateNativeCompatibility(response, getExtensionCompatibilityMetadata())
        : fallbackNativeCompatibility(response);
      return {
        supported: true,
        ok: response?.ok === true && isNativeCompatibilityCompatible(compatibility),
        status: compatibility?.status || (response?.ok ? 'ok' : 'native_missing'),
        classification: getNativeCompatibilityClassification(compatibility),
        errorCode: response?.error?.code || compatibility?.status || '',
        nativeCompatibility: summarizeSmokeNativeCompatibility(compatibility, response)
      };
    } catch (_error) {
      return {
        supported: true,
        ok: false,
        status: 'native_probe_failed',
        errorCode: 'native_probe_failed'
      };
    }
  }

  async function smokeProbeProject(options = {}) {
    try {
      const project = await callPageBridge('getProjectSnapshot', {
        force: Boolean(options.force),
        preferLightweight: true,
        allowZipFallback: true,
        allowEditorNavigation: false,
        requireFullProject: false,
        includeBinaryFiles: true,
        includeContent: false,
        zipTimeoutMs: RUN_SNAPSHOT_ZIP_TIMEOUT_MS
      });
      const files = Array.isArray(project?.files) ? project.files : [];
      const skipped = Array.isArray(project?.capabilities?.skipped) ? project.capabilities.skipped : [];
      const bytes = summarizeSmokeProjectBytes(files);
      const ok = project?.ok !== false && files.length > 0;
      return {
        supported: true,
        ok,
        status: ok ? 'ok' : 'project_snapshot_unavailable',
        errorCode: ok ? '' : project?.code || 'project_snapshot_unavailable',
        counts: {
          files: files.length,
          skipped: skipped.length
        },
        bytes,
        method: project?.capabilities?.method || ''
      };
    } catch (_error) {
      return {
        supported: true,
        ok: false,
        status: 'project_probe_failed',
        errorCode: 'project_probe_failed',
        counts: {
          files: 0,
          skipped: 0
        },
        bytes: {
          text: 0,
          binary: 0
        }
      };
    }
  }

  function summarizeSmokeNativeCompatibility(compatibility = {}, response = {}) {
    const native = compatibility?.native || response?.result || {};
    return {
      status: compatibility?.status || (response?.ok ? 'ok' : 'native_missing'),
      classification: getNativeCompatibilityClassification(compatibility),
      nativeVersion: compatibility?.nativeVersion || native.version || '',
      version: compatibility?.version || native.version || '',
      minimumNativeVersion: compatibility?.minimumNativeVersion || compatibility?.minNativeVersion || '',
      protocolVersion: compatibility?.protocolVersion || native.protocolVersion || '',
      supportedProtocol: compatibility?.supportedProtocol || native.supportedProtocol || ''
    };
  }

  function summarizeSmokeProjectBytes(files = []) {
    return files.reduce((bytes, file) => {
      let size = Number(file?.size || file?.byteLength || 0);
      if ((!Number.isFinite(size) || size <= 0) && typeof file?.content === 'string') {
        size = new TextEncoder().encode(file.content).byteLength;
      }
      if (!Number.isFinite(size) || size <= 0) {
        return bytes;
      }
      if (file?.kind === 'binary') {
        bytes.binary += size;
      } else {
        bytes.text += size;
      }
      return bytes;
    }, {
      text: 0,
      binary: 0
    });
  }

  function listSeparator() {
    return getLocale() === 'zh' ? '、' : ', ';
  }

  function ensurePanelOpen() {
    if (!panel) {
      panelRendererInstance = PanelRenderer.create({
        container: document.documentElement,
        defaultWidth: PANEL_DEFAULT_WIDTH,
        minWidth: PANEL_MIN_WIDTH,
        maxWidth: PANEL_MAX_WIDTH,
        pageMinWidth: PAGE_MIN_WIDTH,
        initialWidth: state?.panelWidth || PANEL_DEFAULT_WIDTH,
        callbacks: {
          onRefresh: () => refreshProbe({ userInitiated: true }),
          onNewSession: () => startNewSession(),
          onSettingsClick: () => toggleCustomInstructionsSettings(),
          onWidthChange: (width, options = {}) => {
            if (state) {
              state.panelWidth = width;
            }
            if (options.persist !== false) {
              saveStateSoon();
            }
          }
        }
      });
      panel = panelRendererInstance.panelEl;
      refreshNativeCompatibilityBadge();
      scheduleFirstUseOnboardingTip();

      diagnosticsPanelInstance = DiagnosticsPanel.create({
        container: panelRendererInstance.diagnosticsSlot,
        i18n: { tr },
        callbacks: {
          onBeforeOpen: () => {
            closeModelConfigPopover();
            closeContextTray();
            closeCustomInstructionsSettings();
          },
          onNativeEnvironment: () => {
            closeDiagnosticsMenu();
            inspectNativeEnvironment();
          },
          onPageState: () => {
            closeDiagnosticsMenu();
            inspectPageStateDiagnostics();
          },
          onSnapshot: () => {
            closeDiagnosticsMenu();
            inspectProjectSnapshot();
          },
          onOtDiagnostics: () => {
            closeDiagnosticsMenu();
            inspectOtWarmMirrorDiagnostics();
          },
          onExport: () => {
            closeDiagnosticsMenu();
            exportDiagnosticsBundle().catch(error => showPluginToast(tx(`Diagnostics export failed: ${error.message}`, `导出诊断信息失败：${error.message}`), { status: 'failed' }));
          },
          onLanguageToggle: () => toggleLanguage(),
          onOtToggleClick: handleExperimentalOtToggleClick,
          onOtToggleKeydown: handleExperimentalOtToggleKeydown,
          onOtCheckboxChange: handleExperimentalOtToggleChange
        }
      });

      settingsPanelInstance = SettingsPanel.create({
        container: panelRendererInstance.settingsSlot,
        projectId: getCurrentProjectId(),
        i18n: { tr },
        button: panel.querySelector('[data-custom-instructions-settings]'),
        callbacks: {
          onBack: () => closeCustomInstructionsSettings(),
          onSave: () => {
            saveCustomInstructionsSettings().catch(error => {
              appendStorageNoticeOnce('custom-instructions-save-failed', tx(`Failed to save custom instructions: ${error.message}`, `保存自定义指令失败：${error.message}`));
            });
          },
          onInputChange: () => persistPanelInputs()
        }
      });

      sessionPanelInstance = SessionPanel.create({
        container: panelRendererInstance.sessionSlot,
        sessions: state?.sessions || [],
        activeSessionId: state?.activeSessionId || null,
        i18n: { tr },
        callbacks: {
          onSelect: sessionId => switchSession(sessionId),
          onRename: (sessionId, title) => commitSessionRename(sessionId, title),
          onDelete: sessionId => deleteSessionWithConfirm(sessionId)
        },
        deriveSessionTitle,
        isDisplayableSession,
        selectVisibleSessionsForList,
        isSessionRunning,
        formatSessionTime,
        maxVisible: 3,
        pinnedSessionIds: getRunningSessionIds()
      });

      composerPanelInstance = ComposerPanel.create({
        container: panelRendererInstance.composerSlot,
        i18n: { tr },
        attachmentController: composerAttachmentController,
        callbacks: {
          onSubmit: () => safeRunTask(),
          isRunning: () => Boolean(currentRunView),
          onCancel: () => cancelActiveRun(),
          onPaste: handleComposerPaste,
          onDragOver: handleComposerDragOver,
          onDragLeave: handleComposerDragLeave,
          onDrop: handleComposerDrop,
          onTaskKeydown: handleTaskInputKeydown,
          onTaskInput: handleTaskInput,
          onSlashMenuClick: handleSlashMenuClick,
          onClearSkillInvocation: clearComposerSkillInvocation,
          onAddContext: toggleContextTray,
          onContextRefresh: () => loadContextFiles({ force: true }),
          onModelConfigToggle: () => toggleModelConfigPopover(),
          onModelConfigChoiceClick: event => {
            handleModelConfigChoiceClick(event).catch(error => {
              appendPlainLog(tx(`Failed to update model settings: ${error.message}`, `更新模型设置失败：${error.message}`));
            });
          },
          onModeChoice: mode => {
            selectMode(mode).catch(error => appendPlainLog(tr('modeSwitchFailedToast', { message: error.message })));
          },
          onInputChange: () => persistPanelInputs()
        }
      });

      installContextDismiss();
      installModelConfigDismiss();
      bindLogAutoFollow();
      renderSessionList();
      renderRunHistory();
      renderContextSelection();
      scheduleMirrorPrefetch({ reason: 'cold-start', delayMs: 2500 });
    }

    PanelRenderer.setVisible(panel, true);
  }

  function closePanel() {
    PanelRenderer.setVisible(panel, false);
  }

  function isPanelOpen() {
    return panel?.classList.contains('is-open') === true;
  }

  function getPanelStateResponse() {
    return {
      ok: true,
      open: isPanelOpen()
    };
  }

  function toggleDiagnosticsMenu() {
    DiagnosticsPanel.toggleMenu(diagnosticsPanelInstance);
  }

  function closeDiagnosticsMenu() {
    DiagnosticsPanel.closeMenu(diagnosticsPanelInstance);
  }

  function normalizeCustomInstructionsByProject(value) {
    const result = {};
    const textMaxChars = 12000;
    const keyMaxChars = 160;
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return result;
    }
    for (const rawKey of Object.keys(value)) {
      const key = typeof rawKey === 'string' ? rawKey.trim() : '';
      if (!key) {
        continue;
      }
      const normalizedKey = key.length <= keyMaxChars ? key : key.slice(0, keyMaxChars - 1) + '…';
      const rawText = typeof value[rawKey] === 'string' ? value[rawKey] : '';
      result[normalizedKey] = rawText.length <= textMaxChars
        ? rawText
        : rawText.slice(0, textMaxChars - 1) + '…';
    }
    return result;
  }

  function getCustomInstructionsForCurrentProject() {
    const projectId = getCurrentProjectId();
    const normalizedProject = normalizeCustomInstructionsByProject({ [projectId]: '' });
    const normalizedProjectId = Object.keys(normalizedProject)[0] || '';
    if (!normalizedProjectId) {
      return '';
    }
    return normalizeCustomInstructionsByProject(state?.customInstructionsByProject)[normalizedProjectId] || '';
  }

  function setCustomInstructionsForProject(projectId, value) {
    const normalizedProject = normalizeCustomInstructionsByProject({ [projectId]: value });
    const normalizedProjectId = Object.keys(normalizedProject)[0] || '';
    if (!normalizedProjectId) {
      return;
    }
    state = {
      ...state,
      customInstructionsByProject: {
        ...normalizeCustomInstructionsByProject(state?.customInstructionsByProject),
        [normalizedProjectId]: normalizedProject[normalizedProjectId]
      }
    };
  }

  function openCustomInstructionsSettings() {
    if (!settingsPanelInstance) {
      return;
    }
    closeDiagnosticsMenu();
    closeDiagnosticsResult();
    closeModelConfigPopover();
    closeContextTray();
    if (typeof closeSlashMenu === 'function') {
      closeSlashMenu();
    }
    clearProjectSettingsStatus();
    syncCustomInstructionsEditorForProject(getCurrentProjectId(), { force: true });
    syncProjectSettingsEditorForProject();
    panelRendererInstance?.setView?.('settings');
    SettingsPanel.show(settingsPanelInstance);
    if (typeof refreshLocalSkills === 'function') {
      refreshLocalSkills().catch(error => setProjectSettingsStatus(tx(`Could not list local skills: ${error.message}`, `无法列出本地技能：${error.message}`), 'failed'));
    }
  }

  function toggleCustomInstructionsSettings() {
    if (SettingsPanel.isVisible(settingsPanelInstance)) {
      closeCustomInstructionsSettings();
      return;
    }
    openCustomInstructionsSettings();
  }

  function closeCustomInstructionsSettings() {
    panelRendererInstance?.setView?.('session');
    SettingsPanel.hide(settingsPanelInstance);
  }

  async function saveCustomInstructionsSettings() {
    const input = panel?.querySelector('[data-custom-instructions-input]');
    if (!input) {
      return;
    }
    setCustomInstructionsForProject(getCurrentProjectId(), input.value);
    if (typeof setGovernanceRulesForCurrentProject === 'function' && typeof readGovernanceRulesFromSettings === 'function') {
      setGovernanceRulesForCurrentProject(readGovernanceRulesFromSettings());
    }
    if (typeof setSkillLoadingSettings === 'function' && typeof readSkillLoadingSettingsFromSettings === 'function') {
      setSkillLoadingSettings(readSkillLoadingSettingsFromSettings());
    }
    syncCustomInstructionsEditorForProject(getCurrentProjectId(), { force: true });
    if (typeof syncProjectSettingsEditorForProject === 'function') {
      syncProjectSettingsEditorForProject(getCurrentProjectId());
    }
    await saveState();
    showPluginToast(tr('projectSettingsSavedToast'), { status: 'completed' });
    closeCustomInstructionsSettings();
  }

  function syncCustomInstructionsEditorForProject(projectId = getCurrentProjectId(), options) {
    const syncOptions = options || {};
    const input = panel?.querySelector('[data-custom-instructions-input]');
    if (!input) {
      return;
    }
    const normalizedProject = normalizeCustomInstructionsByProject({ [projectId]: '' });
    const normalizedProjectId = Object.keys(normalizedProject)[0] || '';
    const storedValue = normalizedProjectId
      ? normalizeCustomInstructionsByProject(state?.customInstructionsByProject)[normalizedProjectId] || ''
      : '';
    input.placeholder = tr('customInstructionsPlaceholder');
    const settingsPanel = panel?.querySelector('[data-custom-instructions-panel]');
    const editorIsOpen = settingsPanel?.hidden === false;
    const editorIsDirty = normalizedProjectId
      && customInstructionsEditorProjectId === normalizedProjectId
      && input.value !== customInstructionsEditorValue;
    if (!syncOptions.force && editorIsOpen && editorIsDirty) {
      return;
    }
    input.value = storedValue;
    customInstructionsEditorProjectId = normalizedProjectId;
    customInstructionsEditorValue = storedValue;
  }

  function normalizeGovernanceRulesByProject(value) {
    const result = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return result;
    }
    for (const rawKey of Object.keys(value)) {
      const key = normalizeProjectPreferenceKey(rawKey);
      if (!key) {
        continue;
      }
      result[key] = normalizeGovernanceRules(value[rawKey]);
    }
    return result;
  }

  function normalizeSelectedLocalSkillIdsByProject(value) {
    const result = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return result;
    }
    for (const rawKey of Object.keys(value)) {
      const key = normalizeProjectPreferenceKey(rawKey);
      if (!key) {
        continue;
      }
      result[key] = normalizeSelectedLocalSkillIds(value[rawKey]);
    }
    return result;
  }

  function normalizeProjectPreferenceKey(value) {
    const text = String(value || '').trim();
    return text.length <= 160 ? text : text.slice(0, 159) + '…';
  }

  function normalizeGovernanceRules(value = {}) {
    if (GovernanceRules?.normalizeGovernanceRules) {
      return GovernanceRules.normalizeGovernanceRules(value);
    }
    return {
      readonlyPatterns: normalizePatternTextList(value.readonlyPatterns),
      writablePatterns: normalizePatternTextList(value.writablePatterns),
      sensitiveCheckEnabled: value.sensitiveCheckEnabled !== false,
      sensitiveConfirmAllowed: value.sensitiveConfirmAllowed === true
    };
  }

  function normalizePatternTextList(value) {
    if (Array.isArray(value)) {
      return value.map(item => String(item || '').trim()).filter(Boolean);
    }
    return String(value || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
  }

  function getGovernanceRulesForCurrentProject() {
    const projectId = normalizeProjectPreferenceKey(getCurrentProjectId());
    return normalizeGovernanceRulesByProject(state?.governanceRulesByProject)[projectId] || normalizeGovernanceRules({});
  }

  function setGovernanceRulesForCurrentProject(rules) {
    const projectId = normalizeProjectPreferenceKey(getCurrentProjectId());
    if (!projectId) {
      return;
    }
    state = {
      ...state,
      governanceRulesByProject: {
        ...normalizeGovernanceRulesByProject(state?.governanceRulesByProject),
        [projectId]: normalizeGovernanceRules(rules)
      }
    };
  }

  function getSkillLoadingSettings() {
    return {
      loadCodexLocalSkills: state?.loadCodexLocalSkills !== false,
      loadCodexOverleafSkills: state?.loadCodexOverleafSkills !== false
    };
  }

  function setSkillLoadingSettings(settings = {}) {
    state = {
      ...state,
      loadCodexLocalSkills: settings.loadCodexLocalSkills !== false,
      loadCodexOverleafSkills: settings.loadCodexOverleafSkills !== false
    };
  }

  function readSkillLoadingSettingsFromSettings() {
    return SettingsPanel.readState(settingsPanelInstance).skillToggles;
  }

  function readGovernanceRulesFromSettings() {
    return normalizeGovernanceRules(SettingsPanel.readState(settingsPanelInstance).governanceRules);
  }

  function syncProjectSettingsEditorForProject() {
    SettingsPanel.loadState(settingsPanelInstance, {
      governanceRules: getGovernanceRulesForCurrentProject(),
      skillToggles: getSkillLoadingSettings()
    });
    renderLocalSkillList();
  }

  function setProjectSettingsStatus(text, status = 'info') {
    SettingsPanel.setStatus(settingsPanelInstance, text, status);
  }

  function clearProjectSettingsStatus() {
    SettingsPanel.clearStatus(settingsPanelInstance);
  }

  async function refreshLocalSkills() {
    return localSkillsPanel.refreshLocalSkills();
  }

  function renderLocalSkillList() {
    localSkillsPanel.renderLocalSkillList();
  }

  function handleComposerPaste(event) {
    composerAttachmentController.handlePaste(event);
  }

  function handleComposerDragOver(event) {
    composerAttachmentController.handleDragOver(event);
  }

  function handleComposerDragLeave(event) {
    composerAttachmentController.handleDragLeave(event);
  }

  function handleComposerDrop(event) {
    composerAttachmentController.handleDrop(event);
  }

  async function addComposerAttachmentFiles(files) {
    return composerAttachmentController.addFiles(files);
  }

  function getComposerAttachmentsForRun() {
    return composerAttachmentController.getAttachmentsForRun();
  }

  function createRunAttachmentSnapshots(attachments = []) {
    return composerAttachmentController.createRunAttachmentSnapshots(attachments);
  }

  function renderComposerAttachments() {
    composerAttachmentController.renderComposerAttachments();
  }

  function renderAttachmentPreviewList(attachments = [], container, options = {}) {
    return composerAttachmentController.renderAttachmentPreviewList(attachments, container, options);
  }

  function toggleModelConfigPopover() {
    const popover = panel?.querySelector('[data-model-config-popover]');
    const button = panel?.querySelector('[data-model-config-toggle]');
    if (!popover || !button) {
      return;
    }

    const open = popover.hidden;
    if (open) {
      closeDiagnosticsMenu();
      closeContextTray();
      closeCustomInstructionsSettings();
      if (typeof closeSlashMenu === 'function') {
        closeSlashMenu();
      }
      renderModelConfigChoices();
    }
    popover.hidden = !open;
    button.dataset.active = open ? 'true' : 'false';
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function closeModelConfigPopover() {
    const popover = panel?.querySelector('[data-model-config-popover]');
    const button = panel?.querySelector('[data-model-config-toggle]');
    if (!popover || !button) {
      return;
    }
    popover.hidden = true;
    button.dataset.active = 'false';
    button.setAttribute('aria-expanded', 'false');
  }

  async function handleModelConfigChoiceClick(event) {
    const choice = event.target?.closest?.('[data-reasoning-choice], [data-model-choice], [data-speed-choice]');
    if (!choice || choice.disabled) {
      return;
    }
    event.preventDefault();

    const modelSelect = panel?.querySelector('[data-model]');
    const reasoningSelect = panel?.querySelector('[data-reasoning]');
    const speedSelect = panel?.querySelector('[data-speed]');

    if (choice.dataset.reasoningChoice && reasoningSelect) {
      reasoningSelect.value = choice.dataset.reasoningChoice;
    } else if (choice.dataset.modelChoice && modelSelect) {
      modelSelect.value = choice.dataset.modelChoice;
      renderSpeedOptions(getRenderedModelEntries());
    } else if (choice.dataset.speedChoice && speedSelect) {
      speedSelect.value = choice.dataset.speedChoice;
    }

    renderModelConfigChoices();
    updateModelDisplay();
    await persistPanelInputs();
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
    setElementTitleAndAria('[data-custom-instructions-settings]', tr('customInstructionsSettings'), tr('customInstructionsSettings'));
    setElementTitleAndAria('[data-settings-back]', tr('settingsBack'), tr('settingsBack'));
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
    const customInstructionsInput = panel.querySelector('[data-custom-instructions-input]');
    if (customInstructionsInput) {
      customInstructionsInput.placeholder = tr('customInstructionsPlaceholder');
      customInstructionsInput.setAttribute('aria-label', tr('personalizationConfig'));
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
    const otToggle = panel.querySelector('[data-experimental-ot-toggle]');
    if (otToggle) {
      otToggle.title = tr('experimentalOtWarmMirrorTitle');
    }
    const otCheckbox = panel.querySelector('[data-experimental-ot]');
    if (otCheckbox) {
      otCheckbox.setAttribute('aria-label', tr('experimentalOtWarmMirror'));
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
    updateOtStatusDisplay();
    updateExperimentalOtMenuStatus();
    renderModelConfigChoices();
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
    // DiagnosticsPanel installs its outside-click dismiss listener during create().
  }

  function closeDiagnosticsResult() {
    DiagnosticsPanel.closeResult(diagnosticsPanelInstance);
  }

  function showDiagnosticsLoading(title, subtitle = tr('diagnosticsLoading')) {
    DiagnosticsPanel.showLoading(diagnosticsPanelInstance, title, subtitle);
  }

  function showDiagnosticsResult(result = {}) {
    DiagnosticsPanel.showResult(diagnosticsPanelInstance, result);
  }





  function installContextDismiss() {
    return contextTrayController.installContextDismiss();
  }

  function installModelConfigDismiss() {
    document.addEventListener('click', event => {
      const config = panel?.querySelector('[data-model-config]');
      if (!config || config.contains(event.target)) {
        return;
      }
      closeModelConfigPopover();
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

  async function exportDiagnosticsBundle() {
    if (!AuditRecords?.buildDiagnosticBundle) {
      throw new Error('Audit diagnostics helper is unavailable');
    }
    const [auditLogs, mirror, nativeDiagnostics] = await Promise.all([
      getRecentAuditLogsForCurrentProject(),
      getMirrorFreshness().catch(error => ({ status: 'unavailable', errorCode: error.message })),
      getNativeDiagnosticsSummaryForBundle()
    ]);
    const bundle = AuditRecords.buildDiagnosticBundle({
      excludeContent: true,
      compatibility: {
        extension: getExtensionCompatibilityMetadata(),
        modelDiscovery
      },
      platform: nativeDiagnostics.platform,
      nativeEnvironment: nativeDiagnostics.nativeEnvironment,
      mirror,
      auditLogs,
      run: currentRunView ? {
        id: currentRunView.recordId || '',
        status: 'running'
      } : {},
      governance: getGovernanceRulesForCurrentProject(),
      projectId: getCurrentProjectId()
    });
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `codex-overleaf-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showPluginToast(tr('diagnosticsExportDone'), { status: 'completed' });
  }

  async function getNativeDiagnosticsSummaryForBundle() {
    try {
      const params = CodexOverleafCompatibility?.buildBridgePingParams
        ? CodexOverleafCompatibility.buildBridgePingParams(getExtensionCompatibilityMetadata())
        : {};
      const response = await sendBackgroundNative({ method: 'bridge.ping', params });
      if (!response?.ok) {
        const errorCode = response?.error?.code || 'native_unavailable';
        return {
          platform: { status: 'unavailable', errorCode },
          nativeEnvironment: { status: 'unavailable', errorCode }
        };
      }
      return {
        platform: {
          host: response.result?.host || '',
          platform: response.result?.platform || '',
          version: response.result?.version || '',
          protocolVersion: response.result?.protocolVersion || ''
        },
        nativeEnvironment: response.result?.environment || {}
      };
    } catch (error) {
      const errorCode = error?.message || 'native_unavailable';
      return {
        platform: { status: 'unavailable', errorCode },
        nativeEnvironment: { status: 'unavailable', errorCode }
      };
    }
  }

  async function getRecentAuditLogsForCurrentProject(limit = 12) {
    const StorageDb = window.CodexOverleafStorageDb;
    if (!StorageDb?.getAllByIndex) {
      return [];
    }
    const records = await StorageDb.getAllByIndex('auditLogs', 'projectId', getCurrentProjectId());
    return (records || [])
      .slice()
      .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
      .slice(0, limit);
  }

  function setLogScrollPosition(scroller) {
    scroller.scrollTop = scroller.scrollHeight;
  }

  function isContextTrayClickTarget(target) {
    return contextTrayController.isContextTrayClickTarget(target);
  }

  function toggleContextTray() {
    return contextTrayController.toggleContextTray();
  }

  function closeContextTray() {
    return contextTrayController.closeContextTray();
  }

  async function loadContextFiles(options = {}) {
    return contextTrayController.loadContextFiles(options);
  }

  async function requestExactContextFiles({ force = false } = {}) {
    return contextTrayController.requestExactContextFiles({ force });
  }

  function isExactContextFileListProject(project) {
    return contextTrayController.isExactContextFileListProject(project);
  }

  function isContextFileListProject(project) {
    return contextTrayController.isContextFileListProject(project);
  }

  function normalizeContextFileListFromZipSnapshot(project) {
    return contextTrayController.normalizeContextFileListFromZipSnapshot(project);
  }

  function normalizeContextFileFromZipSnapshot(file, activePath) {
    return contextTrayController.normalizeContextFileFromZipSnapshot(file, activePath);
  }

  function getZipSnapshotFailureReason(project) {
    return contextTrayController.getZipSnapshotFailureReason(project);
  }

  function renderContextFiles(project) {
    return contextTrayController.renderContextFiles(project);
  }

  function getContextProjectFiles(files = []) {
    return contextTrayController.getContextProjectFiles(files);
  }

  function buildContextTree(files = []) {
    return contextTrayController.buildContextTree(files);
  }

  function sortContextTree(node) {
    return contextTrayController.sortContextTree(node);
  }

  function renderContextTreeNode(node, container, selected, depth) {
    return contextTrayController.renderContextTreeNode(node, container, selected, depth);
  }

  function renderContextSelection() {
    return contextTrayController.renderContextSelection();
  }

  function renderContextSummary() {
    return contextTrayController.renderContextSummary();
  }

  async function selectFocusFile(path) {
    return contextTrayController.selectFocusFile(path);
  }

  async function clearFocusFile() {
    return contextTrayController.clearFocusFile();
  }

  function getActiveFocusFiles() {
    return contextTrayController.getActiveFocusFiles();
  }

  function sortContextFiles(files, activePath) {
    return contextTrayController.sortContextFiles(files, activePath);
  }

  function getContextFileRank(path) {
    return contextTrayController.getContextFileRank(path);
  }

  function setContextStatus(text) {
    return contextTrayController.setContextStatus(text);
  }

  function resetContextProject() {
    return contextTrayController.resetContextProject();
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
    const params = CodexOverleafCompatibility?.buildBridgePingParams
      ? CodexOverleafCompatibility.buildBridgePingParams(getExtensionCompatibilityMetadata())
      : {};
    const response = await sendBackgroundNative({ method: 'bridge.ping', params });
    showDiagnosticsResult(formatNativeEnvironmentResult(response));
  }

  function formatNativeEnvironmentResult(response) {
    const compatibility = CodexOverleafCompatibility?.evaluateNativeCompatibility
      ? CodexOverleafCompatibility.evaluateNativeCompatibility(response, getExtensionCompatibilityMetadata())
      : fallbackNativeCompatibility(response);
    if (compatibility.status !== 'ok' && compatibility.status !== 'native_unhealthy') {
      return formatNativeCompatibilityResult(compatibility, response);
    }

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

  function fallbackNativeCompatibility(response) {
    return response?.ok
      ? { status: 'ok', classification: 'compatible', native: response.result, installCommand: INSTALL_COMMAND }
      : { status: 'native_missing', classification: 'incompatible', native: response, installCommand: INSTALL_COMMAND };
  }

  function getNativeCompatibilityClassification(compatibility = {}) {
    if (compatibility.classification) {
      return compatibility.classification;
    }
    return compatibility.status === 'ok' ? 'compatible' : 'incompatible';
  }

  function isNativeCompatibilityCompatible(compatibility = {}) {
    return getNativeCompatibilityClassification(compatibility) === 'compatible';
  }

  function formatNativeCompatibilityResult(compatibility = {}, response = {}) {
    const statusValue = compatibility.status || 'unknown_native';
    if (statusValue === 'native_missing') {
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

    const messages = getNativeCompatibilityMessages(statusValue);
    return {
      title: messages.title,
      subtitle: messages.subtitle,
      status: 'failed',
      summary: messages.summary,
      bullets: formatNativeCompatibilityBullets(compatibility),
      nextStep: messages.nextStep,
      installCommand: compatibility.installCommand,
      technical: formatNativeCompatibilityTechnicalDetails(compatibility, response)
    };
  }

  function getNativeCompatibilityMessages(statusValue) {
    switch (statusValue) {
      case 'native_too_old':
        return {
          title: tx('Native Host Update Required', '需要更新 Native Host'),
          subtitle: tx('The local native host is too old for this extension.', '本机 native host 版本太旧。'),
          summary: tx('The extension reached the native host, but its version or capabilities do not match this extension. Update the native host before running Codex.', '插件已经连上 native host，但版本或能力与当前扩展不匹配。请先更新 native host 再运行 Codex。'),
          nextStep: tx('Run the installer command below, reload the Chrome extension, then check again.', '运行下面的安装命令，重新加载 Chrome 扩展后再检查。')
        };
      case 'protocol_unsupported':
        return {
          title: tx('Protocol Mismatch', '协议不匹配'),
          subtitle: tx('The extension and native host do not support the same bridge protocol.', '扩展和 native host 支持的桥接协议不一致。'),
          summary: tx('The native host responded, but its protocol range is not compatible with this extension. Update the extension and native host together.', 'Native host 已响应，但协议范围与当前扩展不兼容。请同时更新扩展和 native host。'),
          nextStep: tx('Run the installer command below and make sure the Chrome extension is the matching release.', '运行下面的安装命令，并确认 Chrome 扩展是匹配的版本。')
        };
      case 'extension_too_old':
        return {
          title: tx('Extension Update Required', '需要更新扩展'),
          subtitle: tx('The native host requires a newer Chrome extension.', 'Native host 需要更新的 Chrome 扩展。'),
          summary: tx('The installed native host is newer than this extension can safely use.', '已安装的 native host 比当前扩展更新，当前扩展不能安全使用。'),
          nextStep: tx('Update the Chrome extension, reload Overleaf, then check the local connection again.', '更新 Chrome 扩展，重新加载 Overleaf 后再检查本机连接。')
        };
      default:
        return {
          title: tx('Native Host Not Compatible', 'Native Host 不兼容'),
          subtitle: tx('The local bridge did not match this extension.', '本机桥接服务与当前扩展不匹配。'),
          summary: tx('The native host response could not be accepted by this extension.', '当前扩展不能接受 native host 的响应。'),
          nextStep: tx('Update the native host and Chrome extension, then check again.', '更新 native host 和 Chrome 扩展后再检查。')
        };
    }
  }

  function formatNativeCompatibilityBullets(compatibility = {}) {
    const native = compatibility.native || {};
    return [
      tx(`Status: ${compatibility.status || 'unknown'}`, `状态：${compatibility.status || 'unknown'}`),
      tx(`Classification: ${getNativeCompatibilityClassification(compatibility)}`, `兼容分类：${getNativeCompatibilityClassification(compatibility)}`),
      tx(`Extension version: ${compatibility.extensionVersion || 'unknown'}`, `扩展版本：${compatibility.extensionVersion || 'unknown'}`),
      tx(`Native version: ${native.version || 'unknown'}`, `Native 版本：${native.version || 'unknown'}`),
      tx(`Native protocol: ${formatNativeProtocolVersion(native)}`, `Native 协议：${formatNativeProtocolVersion(native)}`)
    ];
  }

  function formatNativeProtocolVersion(native = {}) {
    const protocolVersion = native.protocolVersion ?? 'unknown';
    const range = native.supportedProtocol;
    if (range && Number.isInteger(range.min) && Number.isInteger(range.max)) {
      return `${protocolVersion} (${range.min}-${range.max})`;
    }
    return String(protocolVersion);
  }

  function formatNativeCompatibilityTechnicalDetails(compatibility = {}, response = {}) {
    const native = compatibility.native || {};
    const capabilities = native.capabilities && typeof native.capabilities === 'object'
      ? Object.keys(native.capabilities).sort()
      : [];
    return JSON.stringify({
      status: compatibility.status || 'unknown',
      classification: getNativeCompatibilityClassification(compatibility),
      extensionVersion: compatibility.extensionVersion || '',
      nativeVersion: native.version || '',
      protocolVersion: native.protocolVersion ?? null,
      supportedProtocol: native.supportedProtocol || null,
      capabilityKeys: capabilities,
      errorCode: response?.error?.code || '',
      errorMessage: response?.error?.message || ''
    }, null, 2);
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

  async function inspectOtWarmMirrorDiagnostics() {
    showDiagnosticsLoading(tr('diagnosticsOtTitle'), tr('diagnosticsLoading'));
    const projectId = getCurrentProjectId();
    let otStatus = null;
    let mirrorStatus = null;
    let metadataWarning = false;

    try {
      otStatus = await callPageBridge('getOtStatus', { projectId });
      if (otStatus?.ok === false) {
        metadataWarning = true;
        otStatus = {
          ...otStatus,
          lastErrorCode: 'get_ot_status_failed'
        };
      }
    } catch (error) {
      metadataWarning = true;
      otStatus = {
        ok: false,
        status: 'unavailable',
        lastErrorCode: 'get_ot_status_failed'
      };
    }

    try {
      mirrorStatus = await getMirrorFreshness();
      if (!mirrorStatus) {
        metadataWarning = true;
        mirrorStatus = { lastOtErrorCode: 'mirror_status_unavailable' };
      }
    } catch (error) {
      metadataWarning = true;
      mirrorStatus = { lastOtErrorCode: 'mirror_status_failed' };
    }

    if (!metadataWarning) {
      showDiagnosticsResult(formatOtDiagnosticsResult({ otStatus, mirrorStatus }));
      return;
    }

    const result = formatOtDiagnosticsResult({ otStatus, mirrorStatus });
    showDiagnosticsResult({
      ...result,
      status: 'warning',
      summary: `${result.summary} ${tx('Some OT diagnostic metadata is unavailable.', '部分 OT 诊断元数据暂时不可用。')}`
    });
  }

  function formatOtDiagnosticsResult({ otStatus, mirrorStatus }) {
    const enabled = isExperimentalOtEnabled();
    const statusValue = normalizeOtStatus(otStatus ? readOtBridgeStatus(otStatus) : currentOtStatus);
    const queuedEventCount = normalizeOtDiagnosticsCount(otStatus?.queuedEventCount);
    const lastEventAt = formatOtDiagnosticValue(otStatus?.lastEventAt, tr('noneValue'));
    const lastOtPatchAt = formatOtDiagnosticValue(mirrorStatus?.lastOtPatchAt || otWarmMirrorState.lastPatchAt, tr('noneValue'));
    const lastOtErrorCode = formatOtDiagnosticValue(mirrorStatus?.lastOtErrorCode || otWarmMirrorState.lastErrorCode, tr('noneValue'));
    const lastErrorCode = formatOtDiagnosticValue(otStatus?.lastErrorCode || otStatus?.reason || otStatus?.error, tr('noneValue'));
    const channelCandidates = formatOtChannelCandidates(otStatus?.channelCandidates);
    const otFreshFileCount = normalizeOtDiagnosticsCount(
      mirrorStatus?.otFreshFileCount,
      Array.isArray(mirrorStatus?.otFreshFiles) ? mirrorStatus.otFreshFiles.length : 0
    );
    const bridgeFailed = otStatus?.ok === false;
    const focusFiles = getActiveFocusFiles();
    const otWarmStart = otWarmMirrorController?.canUseOtWarmStart?.({ enabled, focusFiles, mirrorStatus }) || { ok: false };
    const fallback = !enabled || statusValue !== 'observing' || bridgeFailed || otWarmStart?.ok !== true;

    return {
      title: tr('diagnosticsOtTitle'),
      subtitle: tr('diagnosticsOtSubtitle'),
      status: enabled && !fallback && !bridgeFailed ? 'completed' : (enabled || bridgeFailed ? 'warning' : 'completed'),
      summary: tr(enabled ? 'diagnosticsOtSummaryEnabled' : 'diagnosticsOtSummaryDisabled'),
      bullets: [
        `${tr('otStatus')}: ${formatOtStatusLabel(statusValue)}`,
        `${tr('otFreshFiles')}: ${otFreshFileCount}`,
        `${tr('otFallback')}: ${fallback ? tr('yes') : tr('no')}`
      ],
      nextStep: fallback ? tr('diagnosticsOtNextStep') : '',
      technical: formatOtDiagnosticsTechnicalDetails({
        strategy: formatOtDiagnosticValue(otStatus?.strategy, 'unknown'),
        queuedEventCount,
        lastEventAt,
        lastOtPatchAt,
        lastOtErrorCode,
        lastErrorCode,
        channelCandidates
      })
    };
  }

  function formatOtDiagnosticsTechnicalDetails(metadata = {}) {
    const lines = [
      `strategy: ${metadata.strategy || 'unknown'}`,
      `queuedEventCount: ${metadata.queuedEventCount}`,
      `lastEventAt: ${metadata.lastEventAt || tr('noneValue')}`,
      `lastOtPatchAt: ${metadata.lastOtPatchAt || tr('noneValue')}`,
      `lastOtErrorCode: ${metadata.lastOtErrorCode || tr('noneValue')}`,
      `lastErrorCode: ${metadata.lastErrorCode || tr('noneValue')}`
    ];
    const candidates = Array.isArray(metadata.channelCandidates) ? metadata.channelCandidates : [];
    lines.push(`channelCandidates: ${candidates.length ? '' : tr('noneValue')}`);
    for (const candidate of candidates) {
      lines.push(`- ${candidate}`);
    }
    return lines.join('\n');
  }

  function formatOtChannelCandidates(candidates) {
    return (Array.isArray(candidates) ? candidates : [])
      .slice(0, 4)
      .map(candidate => {
        const root = formatOtDiagnosticValue(candidate?.root, 'unknown');
        const keyPaths = (Array.isArray(candidate?.keyPaths) ? candidate.keyPaths : [])
          .map(value => formatOtDiagnosticValue(value, ''))
          .filter(Boolean)
          .slice(0, 6);
        return keyPaths.length ? `${root}: ${keyPaths.join(', ')}` : root;
      })
      .filter(Boolean);
  }

  function normalizeOtDiagnosticsCount(value, fallback = 0) {
    const count = Number(value);
    return Number.isFinite(count) && count >= 0 ? Math.floor(count) : fallback;
  }

  function formatOtDiagnosticValue(value, fallback = '') {
    let text = '';
    if (typeof value === 'string') {
      text = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      text = String(value);
    } else if (value?.code || value?.message) {
      text = String(value.code || value.message);
    }
    if (!text) {
      return fallback;
    }
    return text.length > 160 ? `${text.slice(0, 157)}...` : text;
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
    // Freeze submitted run identity before the panel can change during the run.
    const submittedMode = state.mode;
    const submittedRequireReviewing = state.requireReviewing === true;
    const submittedCustomInstructions = getCustomInstructionsForCurrentProject();
    const submittedSkillLoadingSettings = getSkillLoadingSettings();
    const submittedAttachments = getComposerAttachmentsForRun();
    const submittedSkillInvocation = getComposerSkillInvocationForRun();

    const task = state.task.trim();
    if (!task) {
      appendLog('Enter a task first.');
      return;
    }

    runCancellationRequested = false;
    setRunning(true);
    currentRunView = startRunView({
      task,
      mode: submittedMode,
      model: state.model,
      reasoningEffort: state.reasoningEffort,
      speedTier: state.speedTier,
      attachments: submittedAttachments,
      skillInvocation: submittedSkillInvocation
    });
    const runSessionId = currentRunView.sessionId;
    let runAuditDraft = await createAuditDraftForRun({
      task,
      sessionId: runSessionId,
      mode: submittedMode,
      focusFiles: getActiveFocusFiles()
    });
    clearTaskComposer();
    appendRunEvent({
      title: submittedSkillInvocation?.id === 'skill-installer'
        ? tx('I will use the Codex skill installer for this request.', '我会用 Codex skill installer 处理这个请求。')
        : tx('I will first understand your request, then inspect the relevant Overleaf files.', '我会先理解你的请求，再检查相关 Overleaf 文件。'),
      status: 'running',
      detail: {
        [tr('mode')]: formatModeLabel(submittedMode),
        [tx('Model', '模型')]: state.model,
        [tx('Reasoning effort', '推理强度')]: state.reasoningEffort,
        [tx('Speed', '速度')]: state.speedTier,
        [tx('Track required', '要求留痕')]: submittedRequireReviewing ? tx('yes', '是') : tx('no', '否'),
        [tx('Skill', '技能')]: submittedSkillInvocation?.title || tr('noneValue'),
        [tx('Attachments', '附件')]: submittedAttachments.map(attachment => attachment.name).join(listSeparator()) || tr('noneValue'),
        '@context': formatContextItems(getActiveFocusFiles())
      }
    });
    try {
      if (submittedSkillInvocation?.id === 'skill-installer') {
        await runSkillInstallerTask({
          task,
          runSessionId,
          runAuditDraft,
          submittedMode,
          submittedCustomInstructions,
          submittedSkillLoadingSettings,
          submittedAttachments,
          submittedSkillInvocation
        });
        return;
      }
      appendRunEvent({
        title: tx(
          `This run will prioritize: ${formatContextItems(getActiveFocusFiles())}`,
          `这轮会优先参考：${formatContextItems(getActiveFocusFiles())}`
        ),
        status: 'completed'
      });

      await pauseOtWarmMirror('run-start');
      const writeSafety = await preflightWriteSafety({
        mode: submittedMode,
        requireReviewing: submittedRequireReviewing
      });
      if (!writeSafety.ok) {
        await finalizeAuditRecord(runAuditDraft, {
          resultStatus: 'blocked',
          blockedFiles: [{ path: 'write-preflight', reason: writeSafety.reason || 'write_safety' }]
        });
        return;
      }

      let focusFiles = getActiveFocusFiles();
      const warmStart = await resolveWarmRunStart({ focusFiles, mode: submittedMode });
      let project = warmStart.project || null;
      let useExistingMirror = warmStart.useExistingMirror;
      let fileOverlays = warmStart.fileOverlays || null;
      let otWarmStart = warmStart.otWarmStart === true;
      if (!useExistingMirror) {
        appendRunEvent({
          title: tx('Syncing the Overleaf project to the local Codex workspace.', '正在同步 Overleaf 项目到本地 Codex workspace。'),
          status: 'running'
        });
        project = await getRunProjectSnapshot();
      }
      throwIfRunCancellationRequested();
      if (!useExistingMirror) {
        appendLog(formatProjectSnapshotUserLog(project));
      }
      currentRunView.projectFiles = captureProjectReferenceFiles(project);
      const snapshotWarnings = useExistingMirror
        ? { blocking: [], nonBlocking: [] }
        : getProjectSnapshotWarnings(project);
      const warmMirrorReuse = useExistingMirror
        ? warmStart
        : await resolveWarmMirrorReuse(project, {
          snapshotWarnings,
          focusFiles,
          mode: submittedMode
        });
      const focusedPartialSnapshot = runController.canUseFocusedPartialSnapshot({
        project,
        snapshotWarnings,
        focusFiles,
        isUsableProjectFileContent: window.CodexOverleafProjectFiles.isUsableProjectFileContent
      });
      let restrictToFocusFiles = runController.shouldRestrictWritebackToFocus({ focusFiles });
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
        await finalizeAuditRecord(runAuditDraft, {
          resultStatus: 'blocked',
          skippedFiles: [],
          blockedFiles: snapshotWarnings.blocking.map(reason => ({ path: 'project', reason }))
        });
        finishRunView(tx('Blocked: full project was not read', '已阻止：没有读到完整项目'), 'failed');
        return;
      }

      if (warmMirrorReuse.useExistingMirror) {
        useExistingMirror = true;
        fileOverlays = warmMirrorReuse.fileOverlays;
        otWarmStart = warmMirrorReuse.otWarmStart === true;
        if (warmMirrorReuse.otWarmStart) {
          if (Array.isArray(warmMirrorReuse.focusFiles) && warmMirrorReuse.focusFiles.length) {
            focusFiles = warmMirrorReuse.focusFiles;
          }
          restrictToFocusFiles = true;
        }
        appendRunEvent({
          title: warmMirrorReuse.warmStart
            ? tr('warmMirrorReuseTitle')
            : warmMirrorReuse.partialSnapshot
            ? tr('warmMirrorPartialOverlayTitle')
            : tr('warmMirrorFocusOverlayTitle'),
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

      const sensitiveFindings = await runSensitivePreflight({
        task,
        project,
        rules: getGovernanceRulesForCurrentProject(),
        useExistingMirror
      });
      if (sensitiveFindings.blocked) {
        await finalizeAuditRecord(runAuditDraft, {
          resultStatus: 'blocked_sensitive',
          sensitiveFindings: sensitiveFindings.findings,
          blockedFiles: sensitiveFindings.findings.map(finding => ({
            path: finding.path || finding.source || 'task',
            reason: finding.detectorId || 'sensitive'
          }))
        });
        finishRunView(tx('Blocked: sensitive content review required', '已阻止：需要处理敏感内容'), 'failed');
        return;
      }
      if (sensitiveFindings.findings.length) {
        runAuditDraft = await updateAuditSensitiveFindings(runAuditDraft, sensitiveFindings.findings);
      }

      await settleMirrorPrefetchBeforeRun();
      appendRunEvent({ title: tx('Local Codex session is starting.', '本地 Codex session 开始运行。'), status: 'running' });
      let response = await sendNative({
        method: 'codex.run',
        params: buildCodexRunParams({
          task,
          project,
          useExistingMirror,
          fileOverlays,
          focusFiles,
          otWarmStart,
          restrictToFocusFiles,
          codexThreadId,
          compileLogContext,
          customInstructions: submittedCustomInstructions,
          skillLoadingSettings: submittedSkillLoadingSettings,
          attachments: submittedAttachments,
          skillInvocation: submittedSkillInvocation,
          submittedMode
        })
      });

      // Handle mirror_stale error by retrying with full sync
      if (!response.ok && response.error?.code === 'mirror_stale' && useExistingMirror) {
        appendRunEvent({ title: tr('warmMirrorStaleRetryTitle'), status: 'running' });
        const staleRetry = await prepareMirrorStaleRetry({
          project: await getRunProjectSnapshot(),
          focusFiles
        });
        if (!staleRetry.ok) {
          return;
        }
        project = staleRetry.project;
        currentRunView.projectFiles = captureProjectReferenceFiles(project);
        useExistingMirror = false;
        fileOverlays = null;
        otWarmStart = false;
        restrictToFocusFiles = staleRetry.restrictToFocusFiles;
        response = await sendNative({
          method: 'codex.run',
          params: buildCodexRunParams({
            task,
            project,
            useExistingMirror: false,
            fileOverlays: null,
            focusFiles,
            otWarmStart,
            restrictToFocusFiles,
            codexThreadId,
            compileLogContext,
            customInstructions: submittedCustomInstructions,
            skillLoadingSettings: submittedSkillLoadingSettings,
            attachments: submittedAttachments,
            skillInvocation: submittedSkillInvocation,
            submittedMode
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
              otWarmStart,
              restrictToFocusFiles,
              codexThreadId: '',
              compileLogContext,
              customInstructions: submittedCustomInstructions,
              skillLoadingSettings: submittedSkillLoadingSettings,
              attachments: submittedAttachments,
              skillInvocation: submittedSkillInvocation,
              submittedMode
            })
          });
        } else {
          appendRunEvent({ title: tx('Cancelled: user chose not to create a new thread.', '已取消：用户选择不新建线程。'), status: 'rejected' });
          await finalizeAuditRecord(runAuditDraft, { resultStatus: 'rejected' });
          finishRunView(tx('Cancelled', '已取消'), 'rejected');
          return;
        }
      }

      if (!response.ok) {
        if (runCancellationRequested || isRunCancellationError(response.error)) {
          appendRunCancelledReport();
          await finalizeAuditRecord(runAuditDraft, { resultStatus: 'cancelled' });
          finishRunView(tx('Cancelled', '已中断'), 'rejected');
          return;
        }
        const translated = translateRawError(response.error.message, { mode: submittedMode, locale: getLocale() });
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
          mode: submittedMode
        });
        await finalizeAuditRecord(runAuditDraft, {
          resultStatus: 'failed',
          sensitiveFindings: sensitiveFindings.findings,
          blockedFiles: [{ path: 'codex.run', reason: response.error?.code || response.error?.message || 'native_error' }]
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
        unsupportedChanges: response.result.unsupportedChanges || [],
        mode: submittedMode,
        requireReviewing: submittedRequireReviewing
      });
      await finalizeAuditRecord(runAuditDraft, {
        ...(syncOutcome.audit || {}),
        sensitiveFindings: sensitiveFindings.findings,
        resultStatus: syncOutcome.hasSkippedOperations ? 'completed_with_skips' : 'completed'
      });

      finishRunView(
        syncOutcome.hasSkippedOperations ? tx('Sync completed with skipped items', '同步完成但有跳过项') : tx('Sync completed', '同步完成'),
        syncOutcome.hasSkippedOperations ? 'failed' : 'completed'
      );
      try {
        const runSessionForHistory = findSessionById(runSessionId) || getActiveSession(state);
        const rawAssistantMessage = assistantMessage;
        const rawSyncOutcome = syncOutcome;
        const rawSyncChanges = syncChanges;
        {
          const assistantMessage = sanitizeAssistantVisibleText(rawAssistantMessage);
          const syncOutcome = sanitizeAssistantVisibleValue(rawSyncOutcome);
          const syncChanges = sanitizeAssistantVisibleValue(rawSyncChanges);
          const updatedSession = recordSessionResult(runSessionForHistory, {
            task: sanitizeAssistantVisibleText(task),
            result: buildSessionHistoryResult({
              assistantMessage,
              syncOutcome,
              syncChanges
            })
          });
          replaceSessionInState(updatedSession);
        }

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
        await finalizeAuditRecord(runAuditDraft, { resultStatus: 'cancelled' });
        finishRunView(tx('Cancelled', '已中断'), 'rejected');
        return;
      }
      const translated = translateRawError(error.message, { mode: submittedMode, locale: getLocale() });
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
        mode: submittedMode
      });
      await finalizeAuditRecord(runAuditDraft, {
        resultStatus: 'failed',
        blockedFiles: [{ path: 'task', reason: error.message }]
      });
      finishRunView(tx('Task failed', '任务失败'), 'failed');
    } finally {
      setRunning(false);
      nativeChannel.clearActiveRequest();
      currentRunView = null;
      runCancellationRequested = false;
      if (isExperimentalOtEnabled()) {
        await resumeOtWarmMirror('run-settled');
      }
      saveStateSoon();
    }
  }

  async function runSkillInstallerTask({
    task,
    runSessionId,
    runAuditDraft,
    submittedMode,
    submittedCustomInstructions,
    submittedSkillLoadingSettings,
    submittedAttachments,
    submittedSkillInvocation
  }) {
    appendRunEvent({
      title: tx('Starting the Codex skill installer.', '正在启动 Codex skill installer。'),
      status: 'running'
    });
    const activeSession = findSessionById(runSessionId) || getActiveSession(state);
    const codexThreadId = activeSession?.codexThreadId || '';
    const params = {
      projectId: getCurrentProjectId(),
      mode: submittedMode,
      task,
      model: state.model,
      reasoningEffort: state.reasoningEffort,
      speedTier: state.speedTier,
      session: state.session,
      threadId: codexThreadId || undefined,
      customInstructions: submittedCustomInstructions || undefined,
      loadCodexLocalSkills: submittedSkillLoadingSettings?.loadCodexLocalSkills !== false,
      loadCodexOverleafSkills: submittedSkillLoadingSettings?.loadCodexOverleafSkills !== false,
      attachments: submittedAttachments.length ? submittedAttachments : undefined,
      skillInvocation: submittedSkillInvocation,
      focusFiles: [],
      skipMirrorSync: true
    };

    const response = await sendNative({
      method: 'codex.run',
      params
    });

    if (!response.ok) {
      if (runCancellationRequested || isRunCancellationError(response.error)) {
        appendRunCancelledReport();
        await finalizeAuditRecord(runAuditDraft, { resultStatus: 'cancelled' });
        finishRunView(tx('Cancelled', '已中断'), 'rejected');
        return;
      }
      const translated = translateRawError(response.error.message, { mode: submittedMode, locale: getLocale() });
      appendRunEvent({
        title: translated.conclusion,
        status: 'failed',
        technicalDetail: response.error
      });
      appendCompletionReport({
        conclusion: translated.conclusion,
        status: 'failed',
        operations: [],
        applyResults: [],
        nextStep: translated.nextStep,
        errorMessage: response.error.message,
        mode: submittedMode
      });
      await finalizeAuditRecord(runAuditDraft, {
        resultStatus: 'failed',
        blockedFiles: [{ path: 'skill-installer', reason: response.error?.code || response.error?.message || 'native_error' }]
      });
      finishRunView(tx('Skill installer failed', 'Skill installer 失败'), 'failed');
      return;
    }

    const assistantMessage = response.result?.assistantMessage || getAssistantAnswerForCurrentRun();
    appendCompletionReport({
      conclusion: assistantMessage || tx('Skill installer completed.', 'Skill installer 已完成。'),
      status: 'completed',
      operations: [],
      applyResults: [],
      nextStep: tx('Restart Codex Overleaf or start a new run if the installed skill is not visible immediately.', '如果新安装的 skill 没有立刻出现，请重启 Codex Overleaf 或开始新一轮运行。'),
      mode: submittedMode
    });
    await finalizeAuditRecord(runAuditDraft, { resultStatus: 'completed' });
    finishRunView(tx('Skill installer completed', 'Skill installer 已完成'), 'completed');

    const runSessionForHistory = findSessionById(runSessionId) || getActiveSession(state);
    const rawAssistantMessage = assistantMessage;
    const rawSyncOutcome = { summaryLine: 'skill installer completed' };
    const rawSyncChanges = [];
    {
      const assistantMessage = sanitizeAssistantVisibleText(rawAssistantMessage);
      const syncOutcome = sanitizeAssistantVisibleValue(rawSyncOutcome);
      const syncChanges = sanitizeAssistantVisibleValue(rawSyncChanges);
      const updatedSession = recordSessionResult(runSessionForHistory, {
        task: sanitizeAssistantVisibleText(task),
        result: buildSessionHistoryResult({
          assistantMessage,
          syncOutcome,
          syncChanges
        })
      });
      replaceSessionInState(updatedSession);
    }

    const returnedThreadId = response.result?.threadId || '';
    if (returnedThreadId && returnedThreadId !== codexThreadId) {
      updateSessionById(runSessionId, { codexThreadId: returnedThreadId });
      const StorageDb = window.CodexOverleafStorageDb;
      if (StorageDb) {
        const record = await StorageDb.getRecord('sessions', runSessionId);
        if (record) {
          record.codexThreadId = returnedThreadId;
          await StorageDb.putRecord('sessions', record);
        }
      }
    }
  }

  async function preflightWriteSafety(options = {}) {
    const mode = options.mode || state.mode;
    const requireReviewing = typeof options.requireReviewing === 'boolean'
      ? options.requireReviewing
      : state?.requireReviewing === true;
    if (mode === 'ask') {
      return { ok: true, skipped: true };
    }
    const method = requireReviewing ? 'ensureReviewing' : 'ensureEditing';

    appendRunEvent({
      title: requireReviewing
        ? tx('Checking Overleaf Reviewing/Track Changes before starting.', '正在确认 Overleaf 留痕状态。')
        : tx('Checking Overleaf Editing mode before starting.', '正在确认 Overleaf Editing 模式。'),
      status: 'running'
    });

    let result = null;
    try {
      result = await callPageBridge(method, { waitMs: 1800 });
    } catch (error) {
      result = {
        ok: false,
        reason: error?.message || (requireReviewing
          ? tx('Overleaf did not return track changes status', 'Overleaf 没有返回留痕状态')
          : tx('Overleaf did not return Editing mode status', 'Overleaf 没有返回 Editing 模式状态')),
        reviewing: null
      };
    }

    if (result?.ok) {
      appendRunEvent({
        title: requireReviewing
          ? (result.activated
            ? tx('Overleaf Reviewing/Track Changes is now on. Starting the task.', '已开启 Overleaf 留痕，开始处理任务。')
            : tx('Overleaf Reviewing/Track Changes is already on. Starting the task.', 'Overleaf 留痕已经开启，开始处理任务。'))
          : (result.activated
            ? tx('Switched to Overleaf Editing. Starting the task.', '已切到 Overleaf Editing，开始处理任务。')
            : tx('Overleaf is already in Editing mode. Starting the task.', 'Overleaf 已在 Editing 模式，开始处理任务。')),
        status: 'completed'
      });
      return result;
    }

    const reason = localizeVisibleReason(result?.reason || (requireReviewing
      ? tx('Overleaf did not return track changes status', 'Overleaf 没有返回留痕状态')
      : tx('Overleaf did not return Editing mode status', 'Overleaf 没有返回 Editing 模式状态')));
    const nextStep = requireReviewing
      ? tx(
        'You may not have permission, or this Overleaf page did not expose the Reviewing switch. Switch to Reviewing manually and retry, or turn off Track before writing.',
        '你可能没有权限，或 Overleaf 当前页面没有暴露切换入口。可以手动切到 Reviewing 后重试，或关闭“留痕”再运行。'
      )
      : tx(
        'You may not have permission, or this Overleaf page did not expose the Editing switch. Switch to Editing manually and retry.',
        '你可能没有权限，或 Overleaf 当前页面没有暴露切换入口。请在 Overleaf 手动切到 Editing 后重试。'
      );
    appendRunEvent({
      title: requireReviewing
        ? tx('Task not started: could not enable Overleaf Reviewing/Track Changes.', '任务未开始：无法开启 Overleaf 留痕。')
        : tx('Task not started: could not switch to Overleaf Editing.', '任务未开始：无法切换到 Overleaf Editing。'),
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
    const finishTitle = requireReviewing
      ? tx('Not started: could not enable Track Changes', '未开始：无法开启留痕')
      : tx('Not started: could not switch to Editing', '未开始：无法切换到 Editing');
    finishRunView(finishTitle, 'failed');
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
    otWarmStart,
    restrictToFocusFiles,
    codexThreadId,
    compileLogContext,
    customInstructions,
    skillLoadingSettings,
    attachments,
    skillInvocation,
    submittedMode
  } = {}) {
    return runController.buildCodexRunParams({
      currentProjectId: getCurrentProjectId(),
      state,
      task,
      project,
      useExistingMirror,
      fileOverlays,
      focusFiles,
      otWarmStart,
      restrictToFocusFiles,
      codexThreadId,
      customInstructions: customInstructions === undefined
        ? getCustomInstructionsForCurrentProject()
        : customInstructions,
      skillLoadingSettings: skillLoadingSettings === undefined
        ? (typeof getSkillLoadingSettings === 'function'
          ? getSkillLoadingSettings()
          : { loadCodexLocalSkills: true, loadCodexOverleafSkills: true })
        : skillLoadingSettings,
      attachments,
      skillInvocation,
      compileLogContext,
      submittedMode
    });
  }

  async function createAuditDraftForRun(input = {}) {
    const StorageDb = window.CodexOverleafStorageDb;
    if (!StorageDb || !AuditRecords) {
      return null;
    }
    const draft = AuditRecords.buildAuditDraftRecord({
      projectId: getCurrentProjectId(),
      sessionId: input.sessionId || '',
      turnId: currentRunView?.recordId || '',
      mode: input.mode || state?.mode || '',
      model: state?.model || '',
      reasoningEffort: state?.reasoningEffort || '',
      speedTier: state?.speedTier || '',
      task: input.task || '',
      focusFiles: input.focusFiles || [],
      selectedSkillIds: input.selectedSkillIds || []
    });
    const record = StorageDb.buildAuditLogRecord
      ? StorageDb.buildAuditLogRecord(draft)
      : draft;
    return StorageDb.putRecord('auditLogs', record).then(() => record).catch(() => null);
  }

  async function updateAuditSensitiveFindings(draft, findings = []) {
    if (!draft) {
      return draft;
    }
    return finalizeAuditDraftPartial(draft, {
      sensitiveFindings: findings,
      resultStatus: draft.resultStatus || 'draft'
    });
  }

  async function finalizeAuditDraftPartial(draft, updates = {}) {
    const StorageDb = window.CodexOverleafStorageDb;
    if (!StorageDb || !draft) {
      return draft;
    }
    const record = StorageDb.buildAuditLogRecord
      ? StorageDb.buildAuditLogRecord({ ...draft, ...updates, id: draft.id, completedAt: updates.completedAt || draft.completedAt || '' })
      : { ...draft, ...updates };
    return StorageDb.putRecord('auditLogs', record).then(() => record).catch(() => draft);
  }

  async function finalizeAuditRecord(draft, updates = {}) {
    const StorageDb = window.CodexOverleafStorageDb;
    if (!StorageDb || !AuditRecords || !draft) {
      return null;
    }
    const final = AuditRecords.buildAuditFinalRecord({
      draft: {
        ...draft,
        selectedSkillIds: updates.selectedSkillIds || draft.selectedSkillIds || [],
        sensitiveFindings: updates.sensitiveFindings || draft.sensitiveFindings || []
      },
      changedFiles: updates.changedFiles || [],
      ['diffSummary']: updates['diffSummary'] || {},
      blockedFiles: updates.blockedFiles || [],
      appliedFiles: updates.appliedFiles || [],
      skippedFiles: updates.skippedFiles || [],
      resultStatus: updates.resultStatus || 'completed',
      saveVerification: updates.saveVerification || null
    });
    const record = StorageDb.buildAuditLogRecord
      ? StorageDb.buildAuditLogRecord(final)
      : final;
    return StorageDb.putRecord('auditLogs', record).catch(() => null);
  }

  async function runSensitivePreflight(options) {
    options = options || {};
    const { task, project, rules, useExistingMirror = false } = options;
    const normalizedRules = normalizeGovernanceRules(rules);
    if (normalizedRules.sensitiveCheckEnabled === false) {
      return { blocked: false, findings: [] };
    }
    if (!SensitiveScan?.scanSensitiveInputs && !useExistingMirror) {
      return { blocked: false, findings: [] };
    }
    let findings = SensitiveScan?.scanSensitiveInputs
      ? SensitiveScan.scanSensitiveInputs({
        task,
        files: (project?.files || []).filter(isTextSnapshotFile)
      })
      : [];
    if (useExistingMirror) {
      findings = dedupeSensitiveFindings([
        ...findings,
        ...await scanNativeMirrorSensitiveFindings()
      ]);
    }
    if (!findings.length) {
      return { blocked: false, findings: [] };
    }
    appendRunEvent({
      title: tx(
        `Sensitive content check found ${findings.length} item(s).`,
        `敏感内容检查发现 ${findings.length} 项。`
      ),
      status: 'failed',
      detail: findings.slice(0, 8).map(finding => ({
        [tr('detailFile')]: finding.path || finding.source || 'task',
        [tr('detailReason')]: finding.detectorId,
        [tx('Preview', '预览')]: finding.preview || '[REDACTED]'
      }))
    });
    if (normalizedRules.sensitiveConfirmAllowed === true) {
      const approved = await showPluginConfirm({
        title: tr('sensitiveConfirmTitle'),
        message: formatSensitiveConfirmMessage(findings),
        confirmLabel: tr('sensitiveConfirmRun'),
        cancelLabel: tr('confirmDefaultCancel'),
        destructive: true
      });
      return { blocked: !approved, findings };
    }
    appendCompletionReport({
      conclusion: tx(
        'This run was blocked before Codex received project context because sensitive content was detected.',
        '检测到敏感内容，本轮已在向 Codex 发送项目上下文前阻止。'
      ),
      status: 'blocked',
      operations: [],
      applyResults: [],
      nextStep: tx(
        'Remove the sensitive content, narrow @context, or enable explicit sensitive confirmation in Project Settings.',
        '请移除敏感内容、缩小 @context，或在项目设置里允许敏感内容显式确认。'
      )
    });
    return { blocked: true, findings };
  }

  function formatSensitiveConfirmMessage(findings = []) {
    const visible = findings.slice(0, 8).map(finding => {
      const path = finding.path || finding.source || 'task';
      return `${path}: ${finding.detectorId || 'sensitive'} (${finding.preview || '[REDACTED]'})`;
    });
    return [
      tr('sensitiveConfirmMessage'),
      '',
      ...visible,
      findings.length > visible.length ? tx(`${findings.length - visible.length} more finding(s).`, `另有 ${findings.length - visible.length} 项。`) : ''
    ].filter(Boolean).join('\n');
  }

  async function scanNativeMirrorSensitiveFindings() {
    try {
      const response = await sendBackgroundNative({
        method: 'mirror.scanSensitive',
        params: { projectId: getCurrentProjectId() }
      });
      if (response?.ok) {
        return Array.isArray(response.result?.findings) ? response.result.findings : [];
      }
      return [{
        detectorId: 'mirror-sensitive-scan-unavailable',
        source: 'local-mirror',
        preview: response?.error?.message || 'Could not scan the local mirror before Codex runs.'
      }];
    } catch (error) {
      return [{
        detectorId: 'mirror-sensitive-scan-unavailable',
        source: 'local-mirror',
        preview: error?.message || 'Could not scan the local mirror before Codex runs.'
      }];
    }
  }

  function dedupeSensitiveFindings(findings = []) {
    const seen = new Set();
    const deduped = [];
    for (const finding of findings || []) {
      const key = [
        finding?.detectorId || '',
        finding?.source || '',
        finding?.path || '',
        finding?.preview || ''
      ].join('\u0000');
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(finding);
    }
    return deduped;
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
    if (handleSlashMenuKeydown(event)) {
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) {
      return;
    }
    event.preventDefault();
    panel.querySelector('[data-composer-form]')?.requestSubmit();
  }

  function handleTaskInput() {
    scheduleMirrorPrefetch({
      reason: 'composer-input',
      delayMs: mirrorHealth?.PREFETCH_DEBOUNCE_MS || 1200
    });
    updateSlashMenuForTaskInput();
    refreshCodexOverleafSkillsForSlashMenu().catch(() => {
      // The slash menu still works with the built-in install command when native skill listing fails.
    });
  }

  function getSlashCommands() {
    const commands = [
      {
        id: 'install-skill',
        kind: 'installer',
        title: tr('slashInstallSkillTitle'),
        subtitle: tr('slashInstallSkillSubtitle')
      }
    ];
    if (getSkillLoadingSettings().loadCodexOverleafSkills === false) {
      return commands;
    }
    for (const skill of slashCodexOverleafSkills) {
      const id = String(skill?.id || '').trim();
      if (!isSafeSkillId(id)) {
        continue;
      }
      const title = String(skill?.title || skill?.name || id).trim().slice(0, 80) || id;
      commands.push({
        id: `skill:${id}`,
        kind: 'codex-overleaf-skill',
        scope: 'codex-overleaf',
        skillId: id,
        title,
        subtitle: tr('slashUseSkillSubtitle')
      });
    }
    return commands;
  }

  async function refreshCodexOverleafSkillsForSlashMenu() {
    if (slashCodexOverleafSkillsLoaded || slashCodexOverleafSkillsLoading) {
      return;
    }
    if (!getSlashTrigger() || getSkillLoadingSettings().loadCodexOverleafSkills === false) {
      return;
    }
    slashCodexOverleafSkillsLoading = true;
    try {
      const response = await sendBackgroundNative({
        method: 'skills.list',
        params: { scope: 'codex-overleaf' }
      });
      if (response?.ok) {
        slashCodexOverleafSkills = Array.isArray(response.result?.skills) ? response.result.skills : [];
        slashCodexOverleafSkillsLoaded = true;
        updateSlashMenuForTaskInput();
      }
    } finally {
      slashCodexOverleafSkillsLoading = false;
    }
  }

  function updateSlashMenuForTaskInput() {
    const trigger = getSlashTrigger();
    const menu = panel?.querySelector('[data-slash-menu]');
    if (!menu) {
      return;
    }
    if (!trigger) {
      closeSlashMenu();
      return;
    }
    const query = trigger.query.toLowerCase();
    const commands = getSlashCommands().filter(command => {
      return !query
        || command.title.toLowerCase().includes(query)
        || command.id.toLowerCase().includes(query);
    });
    renderSlashMenu(commands);
  }

  function getSlashTrigger() {
    const input = panel?.querySelector('[data-task]');
    if (!input || currentRunView) {
      return null;
    }
    const cursor = typeof input.selectionStart === 'number' ? input.selectionStart : input.value.length;
    const before = input.value.slice(0, cursor);
    const after = input.value.slice(cursor);
    const match = /^\/([^\s/]*)$/.exec(before);
    if (!match || after.trim()) {
      return null;
    }
    return {
      query: match[1] || '',
      start: 0,
      end: cursor
    };
  }

  function renderSlashMenu(commands = []) {
    const menu = panel?.querySelector('[data-slash-menu]');
    if (!menu) {
      return;
    }
    menu.textContent = '';
    if (!commands.length) {
      menu.hidden = true;
      return;
    }
    commands.forEach((command, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.slashCommand = command.id;
      button.dataset.slashCommandKind = command.kind || '';
      if (command.skillId) {
        button.dataset.slashSkillId = command.skillId;
      }
      if (command.scope) {
        button.dataset.slashSkillScope = command.scope;
      }
      button.dataset.active = index === 0 ? 'true' : 'false';
      const title = document.createElement('span');
      title.textContent = command.title;
      const subtitle = document.createElement('small');
      subtitle.textContent = command.subtitle;
      button.append(title, subtitle);
      menu.append(button);
    });
    renderedSlashCommands = new Map(commands.map(command => [command.id, command]));
    menu.dataset.activeIndex = '0';
    menu.hidden = false;
  }

  function handleSlashMenuClick(event) {
    const button = event.target?.closest?.('[data-slash-command]');
    if (!button) {
      return;
    }
    event.preventDefault();
    selectSlashCommand(button.dataset.slashCommand);
  }

  function handleSlashMenuKeydown(event) {
    const menu = panel?.querySelector('[data-slash-menu]');
    if (!menu || menu.hidden) {
      return false;
    }
    const buttons = Array.from(menu.querySelectorAll('[data-slash-command]'));
    if (!buttons.length) {
      closeSlashMenu();
      return false;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSlashMenu();
      return true;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const current = Number(menu.dataset.activeIndex || 0);
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const next = (current + delta + buttons.length) % buttons.length;
      setSlashMenuActiveIndex(next);
      return true;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const active = buttons[Number(menu.dataset.activeIndex || 0)] || buttons[0];
      selectSlashCommand(active.dataset.slashCommand);
      return true;
    }
    return false;
  }

  function setSlashMenuActiveIndex(index) {
    const menu = panel?.querySelector('[data-slash-menu]');
    if (!menu) {
      return;
    }
    const buttons = Array.from(menu.querySelectorAll('[data-slash-command]'));
    menu.dataset.activeIndex = String(index);
    buttons.forEach((button, buttonIndex) => {
      button.dataset.active = buttonIndex === index ? 'true' : 'false';
    });
  }

  function selectSlashCommand(commandId) {
    const command = renderedSlashCommands.get(commandId);
    if (!command) {
      closeSlashMenu();
      return;
    }
    clearSlashTriggerFromTaskInput();
    closeSlashMenu();
    if (command.kind === 'installer') {
      activateSkillInstallerComposerContext();
      return;
    }
    if (command.kind === 'codex-overleaf-skill') {
      activateCodexOverleafSkillComposerContext(command);
    }
  }

  function clearSlashTriggerFromTaskInput() {
    const input = panel?.querySelector('[data-task]');
    const trigger = getSlashTrigger();
    if (!input || !trigger) {
      return;
    }
    input.value = `${input.value.slice(0, trigger.start)}${input.value.slice(trigger.end)}`;
    state = { ...state, task: input.value };
  }

  function closeSlashMenu() {
    const menu = panel?.querySelector('[data-slash-menu]');
    if (!menu) {
      return;
    }
    menu.hidden = true;
    menu.dataset.activeIndex = '0';
  }

  function activateSkillInstallerComposerContext() {
    composerSkillInvocation = {
      id: 'skill-installer',
      title: tr('skillInstallerComposerLabel')
    };
    renderComposerSkillInvocation();
    const input = panel?.querySelector('[data-task]');
    input?.focus?.();
  }

  function activateCodexOverleafSkillComposerContext(command) {
    const id = String(command?.skillId || '').trim();
    if (!isSafeSkillId(id)) {
      return;
    }
    composerSkillInvocation = {
      id,
      title: String(command?.title || id).trim().slice(0, 80) || id,
      scope: 'codex-overleaf'
    };
    renderComposerSkillInvocation();
    const input = panel?.querySelector('[data-task]');
    input?.focus?.();
  }

  function clearComposerSkillInvocation() {
    composerSkillInvocation = null;
    renderComposerSkillInvocation();
    panel?.querySelector('[data-task]')?.focus?.();
  }

  function getComposerSkillInvocationForRun() {
    const normalized = normalizeComposerSkillInvocation(composerSkillInvocation);
    if (!normalized) {
      return null;
    }
    if (normalized.id === 'skill-installer') {
      return {
        id: 'skill-installer',
        title: tr('skillInstallerComposerLabel')
      };
    }
    return normalized;
  }

  function normalizeComposerSkillInvocation(value) {
    const id = String(value?.id || '').trim();
    if (!isSafeSkillId(id)) {
      return null;
    }
    const title = String(value?.title || id).trim().slice(0, 80) || id;
    if (id === 'skill-installer') {
      return { id, title };
    }
    if (value?.scope !== 'codex-overleaf') {
      return null;
    }
    return { id, title, scope: 'codex-overleaf' };
  }

  function isSafeSkillId(id) {
    return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(String(id || ''))
      && !String(id || '').includes('..');
  }

  function renderComposerSkillInvocation() {
    const context = panel?.querySelector('[data-composer-skill-context]');
    if (!context) {
      return;
    }
    const active = getComposerSkillInvocationForRun();
    context.hidden = !active;
    const label = context.querySelector('[data-composer-skill-label]');
    if (label) {
      label.textContent = active?.title || '';
    }
    const clear = context.querySelector('[data-composer-skill-clear]');
    if (clear) {
      const clearLabel = active?.id === 'skill-installer'
        ? tr('skillInstallerComposerClear')
        : tr('composerSkillClear');
      clear.title = clearLabel;
      clear.setAttribute('aria-label', clearLabel);
    }
  }

  function createDiffReviewElement(syncChanges, options = {}) {
    return diffReviewPanel.createDiffReviewElement(syncChanges, options);
  }

  function renderDiffReview(syncChanges) {
    return diffReviewPanel.renderDiffReview(syncChanges);
  }

  function renderReadOnlyDiffReview(syncChanges, title = tr('diffWrittenChangesTitle')) {
    return diffReviewPanel.renderReadOnlyDiffReview(syncChanges, title);
  }

  async function applySyncChangesToOverleaf(syncChanges = [], project = {}, options = {}) {
    const runMode = options.mode || state.mode;
    const runRequireReviewing = typeof options.requireReviewing === 'boolean'
      ? options.requireReviewing
      : state.requireReviewing === true;
    const assistantMessage = cleanFinalAnswer(options.assistantMessage || getAssistantAnswerForCurrentRun());
    const unsupportedChanges = Array.isArray(options.unsupportedChanges) ? options.unsupportedChanges : [];
    appendUnsupportedLocalChanges(unsupportedChanges);
    // Guard on the immutable submitted mode, not the mutable panel state.
    if (options.mode === 'ask' && ((syncChanges || []).length || unsupportedChanges.length)) {
      appendRunEvent({
        title: tx(
          'Ask mode ignored local file changes. Overleaf was not modified.',
          'Ask 模式已忽略本地文件改动；Overleaf 未被修改。'
        ),
        status: 'warning'
      });
      appendCompletionReport({
        conclusion: assistantMessage || tx(
          'Codex finished in Ask mode. Any local file changes were ignored and were not synced to Overleaf.',
          'Codex 已在 Ask 模式完成；本地文件改动已忽略，未同步到 Overleaf。'
        ),
        status: tr('modeAsk'),
        operations: [],
        applyResults: [],
        mode: runMode,
        nextStep: tx(
          'Switch to Suggest or Auto only when you want Codex to edit files.',
          '只有希望 Codex 修改文件时，才需要切换到建议修改或自动写入。'
        )
      });
      return {
        summaryLine: assistantMessage || tx('Ask mode completed without Overleaf changes', 'Ask 模式已完成，未修改 Overleaf'),
        hasSkippedOperations: false,
        audit: buildAuditSummaryFromApply({
          operations: [],
          resultStatus: 'ask_ignored_local_changes',
          blockedFiles: [
            ...(syncChanges || []).map(change => ({ path: change.path, type: change.type, reason: 'ask_mode' })),
            ...unsupportedChanges.map(change => ({ path: change.path, type: change.type || 'unsupported', reason: change.reason || 'ask_mode' }))
          ]
        })
      };
    }
    let operations = buildSyncApplyOperations(syncChanges, project);
    let visibleSyncChanges = syncChanges || [];
    let additionalSkippedEntries = [];
    let skippedFilesForAudit = additionalSkippedEntries;
    let appliedFilesForAudit = [];
    const pathSafety = partitionUnsafeProjectPathOperations(operations);
    if (pathSafety.skipped.length) {
      additionalSkippedEntries.push(...pathSafety.skipped);
      operations = pathSafety.safe;
      visibleSyncChanges = filterSyncChangesByOperations(syncChanges, operations);
    }
    const governed = evaluateGovernedOperations(operations);
    if (governed.blocked.length) {
      const governanceSkipped = buildGovernanceSkippedApplyResult(governed.blocked);
      additionalSkippedEntries.push(...getSkippedEntries(governanceSkipped));
      appendApplyResult(governanceSkipped);
      appendRunEvent({
        title: tx(
          `Project governance blocked ${governed.blocked.length} write(s) before review.`,
          `项目治理规则在审核前阻止了 ${governed.blocked.length} 项写入。`
        ),
        status: 'failed'
      });
      operations = governed.allowed;
      visibleSyncChanges = filterSyncChangesByOperations(syncChanges, operations);
    }
    if (!operations.length) {
      appendRunEvent({
        title: tx('Codex did not produce file changes that need to sync back to Overleaf.', 'Codex 没有产生需要同步回 Overleaf 的文件改动。'),
        status: 'completed'
      });
      appendCompletionReport({
        conclusion: assistantMessage || tx('Codex finished locally. There are no changes to sync back to Overleaf.', 'Codex 已完成本地处理，没有需要同步回 Overleaf 的改动。'),
        status: runMode === 'ask' ? tr('modeAsk') : 'completed',
        operations: [],
        applyResults: [],
        unchangedReason: assistantMessage
          ? tx('No file changes need to sync back to Overleaf.', '没有产生需要同步回 Overleaf 的文件改动。')
          : formatUnsupportedLocalChangeSummary(unsupportedChanges),
        mode: runMode,
        nextStep: tx('You can continue the conversation, or adjust @context and run again.', '可以继续追问，或调整 @context 后重新运行。')
      });
      return {
        summaryLine: assistantMessage || tx('No changes to sync', '没有需要同步的改动'),
        hasSkippedOperations: additionalSkippedEntries.length > 0,
        audit: buildAuditSummaryFromApply({
          operations: buildSyncApplyOperations(syncChanges, project),
          applyResults: additionalSkippedEntries.length ? [{ ok: false, applied: [], skipped: additionalSkippedEntries }] : [],
          blockedFiles: additionalSkippedEntries.map(item => summarizeOperationForAudit(item.operation, item.result, 'blocked')),
          resultStatus: additionalSkippedEntries.length ? 'blocked' : 'completed'
        })
      };
    }

    if (runMode === 'confirm') {
      appendRunEvent({
        title: tx(
          `Local Codex produced ${operations.length} change(s). Review the diff before applying.`,
          `本地 Codex 产生了 ${operations.length} 项改动，请查看差异后确认。`
        ),
        status: 'running'
      });
      const accepted = await renderDiffReview(visibleSyncChanges);
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
          mode: runMode,
          nextStep: tx('Run the task again, or switch to Auto if you want changes synced directly.', '可以重新运行任务，或切换到自动写入后再同步。')
        });
        return {
          summaryLine: tx('Sync cancelled', '已取消同步'),
          hasSkippedOperations: additionalSkippedEntries.length > 0,
          audit: buildAuditSummaryFromApply({
            operations,
            applyResults: additionalSkippedEntries.length ? [{ ok: false, applied: [], skipped: additionalSkippedEntries }] : [],
            blockedFiles: additionalSkippedEntries.map(item => summarizeOperationForAudit(item.operation, item.result, 'blocked')),
            resultStatus: 'rejected'
          })
        };
      }
      operations = buildSyncApplyOperations(accepted, project);
      const acceptedPathSafety = partitionUnsafeProjectPathOperations(operations);
      if (acceptedPathSafety.skipped.length) {
        additionalSkippedEntries.push(...acceptedPathSafety.skipped);
        operations = acceptedPathSafety.safe;
      }
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
        additionalSkippedEntries.push(...deleteOperations.map(operation => ({
          operation,
          result: {
            ok: false,
            code: 'delete_confirmation_rejected',
            reason: tx('Delete requires explicit confirmation and was skipped.', '删除需要显式确认，已跳过。')
          }
        })));
        operations = operations.filter(operation => operation.type !== 'delete');
      }
    }

    if (operations.some(operation => operation.type === 'binary-create' || operation.type === 'overwrite-binary')) {
      appendRunEvent({
        title: tx('Generated binary asset writeback requires explicit confirmation.', '生成的二进制资源写回需要显式确认。'),
        status: 'running'
      });
    }
    const binaryDecision = await confirmBinaryOperations(operations);
    operations = binaryDecision.operations;
    additionalSkippedEntries.push(...binaryDecision.skipped);

    if (!operations.length) {
      appendRunEvent({
        title: tx('No approved file changes remain to sync back to Overleaf.', '没有剩余已确认的文件改动需要同步回 Overleaf。'),
        status: 'completed'
      });
      appendCompletionReport({
        conclusion: assistantMessage || tx('No approved changes were written back to Overleaf.', '没有已确认的改动写回 Overleaf。'),
        status: runMode === 'ask' ? tr('modeAsk') : 'completed',
        operations: [],
        applyResults: [],
        unchangedReason: tx('No approved file changes remain to sync back to Overleaf.', '没有剩余已确认的文件改动需要同步回 Overleaf。'),
        mode: runMode,
        nextStep: tx('You can continue the conversation, or adjust @context and run again.', '可以继续追问，或调整 @context 后重新运行。')
      });
      return {
        summaryLine: tx('No changes applied', '没有应用改动'),
        hasSkippedOperations: additionalSkippedEntries.length > 0,
        audit: buildAuditSummaryFromApply({
          operations: buildSyncApplyOperations(syncChanges, project),
          applyResults: additionalSkippedEntries.length ? [{ ok: false, applied: [], skipped: additionalSkippedEntries }] : [],
          blockedFiles: additionalSkippedEntries
            .filter(item => item.result?.code === 'governance_blocked')
            .map(item => summarizeOperationForAudit(item.operation, item.result, 'blocked')),
          resultStatus: additionalSkippedEntries.length ? 'completed_with_skips' : 'completed'
        })
      };
    }

    appendOperationsPreview(operations, tx('Sync local Codex changes to Overleaf', '同步本地 Codex 改动到 Overleaf'));
    const reviewing = await ensureReviewingBeforeWrite(operations, { requireReviewing: runRequireReviewing });
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
        mode: runMode,
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
        hasSkippedOperations: true,
        audit: buildAuditSummaryFromApply({
          operations,
          applyResults: [blocked],
          blockedFiles: additionalSkippedEntries
            .filter(item => item.result?.code === 'governance_blocked')
            .map(item => summarizeOperationForAudit(item.operation, item.result, 'blocked')),
          resultStatus: 'blocked'
        })
      };
    }
    const applied = operations.length
      ? mergeApplyResultSkipped(await callPageBridge('applyOperations', {
        operations,
        baseFiles: project?.files || [],
        requireReviewing: runRequireReviewing,
        requireEditing: !runRequireReviewing
      }), additionalSkippedEntries)
      : mergeApplyResultSkipped({ ok: true, applied: [], skipped: [] }, additionalSkippedEntries);
    const hasConfirmedApplyResult = hasApplyResultEntries(applied);
    const saveVerification = hasConfirmedApplyResult
      ? await verifyPostWriteSaveState()
      : {
        ok: false,
        state: 'not_checked',
        reason: 'No applied or skipped writeback entries were returned.'
      };
    if (hasConfirmedApplyResult) {
      appendPostWriteSaveVerificationWarning(saveVerification);
    }
    await refreshProjectMirrorAfterWriteback(project, applied, saveVerification);
    if (runMode === 'auto') {
      renderReadOnlyDiffReview(getAppliedSyncChanges(syncChanges, applied));
    }
    appendApplyResult(applied);
    recordUndoFromApply(project, applied);
    const skippedEntries = getSkippedEntries(applied);
    if (skippedEntries.length) {
      appendPartialWritebackWarning(applied);
    }
    const appliedPaths = getAppliedOperationPaths(applied);
    const compileSummary = appliedPaths.length
      ? await autoRecompileAfterWriteback(appliedPaths, saveVerification).catch(error => {
        appendRunEvent({
          title: tx(`Post-write compile failed: ${error.message}`, `写后编译出错：${error.message}`),
          status: 'failed'
        });
        return buildPostWriteCompileSummary({ error });
      })
      : null;
    const hasSkippedApplyResult = skippedEntries.length > 0;
    const writebackIncomplete = !hasConfirmedApplyResult || hasSkippedApplyResult;
    const summaryLine = appendChangeSummary({
      notes: hasConfirmedApplyResult
        ? tx('Local Codex changes were synced back to Overleaf.', '本地 Codex 改动已同步回 Overleaf。')
        : tx('Local Codex changes were sent to Overleaf, but Codex could not confirm the write result.', '本地 Codex 改动已发送到 Overleaf，但 Codex 没能确认写入结果。'),
      operations,
      applyResults: [applied],
      status: writebackIncomplete ? 'writeback incomplete' : 'synced from local Codex workspace'
    });
    const syncedConclusion = assistantMessage || tx('Local Codex changes were synced back to Overleaf.', '本地 Codex 改动已同步回 Overleaf。');
    const partialSyncConclusion = assistantMessage
      ? `${assistantMessage}\n\n${tx('Sync note: local Codex changes were sent to Overleaf, but some items were skipped.', '同步提示：本地 Codex 改动已尝试写回 Overleaf，但有部分项目被跳过。')}`
      : tx('Local Codex changes were sent to Overleaf, but some items were skipped.', '本地 Codex 改动已尝试同步回 Overleaf，但有部分项目被跳过。');
    const unconfirmedSyncConclusion = assistantMessage
      ? `${assistantMessage}\n\n${tx('Writeback note: Codex could not confirm any Overleaf write result entries, so local mirror refresh and auto compile were skipped.', '写入提示：Codex 没能确认任何 Overleaf 写入结果条目，因此已跳过本地 mirror 刷新和自动编译。')}`
      : tx('Codex tried to write local changes to Overleaf, but the write result did not confirm any applied or skipped entries.', 'Codex 已尝试把本地改动写入 Overleaf，但写入结果没有确认任何已写入或已跳过条目。');
    const writebackConclusion = !hasConfirmedApplyResult
      ? unconfirmedSyncConclusion
      : hasSkippedApplyResult
        ? partialSyncConclusion
        : syncedConclusion;
    const writebackNextStep = !hasConfirmedApplyResult
      ? tx('Check Overleaf manually before running again. Local mirror refresh and auto compile were skipped.', '再次运行前请先手动检查 Overleaf。本地 mirror 刷新和自动编译已跳过。')
      : hasSkippedApplyResult
        ? formatWritebackSkippedNextStep(applied)
        : tx('Review the synced file in Overleaf.', '请在 Overleaf 中查看同步后的文件。');
    appendCompletionReport({
      conclusion: appendCompileSummaryToConclusion(writebackConclusion, compileSummary),
      status: writebackIncomplete ? 'failed' : 'completed',
      operations,
      applyResults: [applied],
      mode: runMode,
      nextStep: writebackNextStep
    });

    return {
      summaryLine,
      hasSkippedOperations: writebackIncomplete || hasSkippedApplyOperations([applied]),
      audit: buildAuditSummaryFromApply({
        operations,
        applyResults: [applied],
        blockedFiles: additionalSkippedEntries
          .filter(item => item.result?.code === 'governance_blocked')
          .map(item => summarizeOperationForAudit(item.operation, item.result, 'blocked')),
        resultStatus: writebackIncomplete ? 'completed_with_skips' : 'completed',
        saveVerification
      })
    };
  }

  async function verifyPostWriteSaveState() {
    try {
      const result = await callPageBridge('waitForSaveState', {
        deadlineMs: 5000,
        requirePositiveSignal: true
      });
      if (result?.state === 'verified_saved') {
        return {
          ...result,
          ok: true,
          state: 'verified_saved'
        };
      }
      if (result?.ok === true && !result?.state) {
        return {
          ...result,
          ok: true,
          state: 'verified_saved'
        };
      }
      if (result?.state === 'unknown_timeout' || result?.state === 'unavailable') {
        return {
          ...result,
          ok: false
        };
      }
      return {
        ...result,
        ok: false,
        state: 'unknown_timeout'
      };
    } catch (error) {
      return {
        ok: false,
        state: 'unavailable',
        reason: error.message
      };
    }
  }

  function appendPostWriteSaveVerificationWarning(saveVerification = {}) {
    if (saveVerification?.state === 'verified_saved') {
      return;
    }
    appendRunEvent({
      title: tx(
        'Files were written or attempted in Overleaf, but Codex could not verify that Overleaf saved them. Local mirror refresh was skipped.',
        '文件已写入或尝试写入 Overleaf，但 Codex 未能确认 Overleaf 已保存；已跳过本地 mirror 刷新。'
      ),
      status: 'warning'
    });
  }

  async function refreshProjectMirrorAfterWriteback(project = {}, applied = {}, saveVerification = {}) {
    if (saveVerification?.state !== 'verified_saved') {
      return;
    }
    if (!Array.isArray(applied?.applied) || !applied.applied.length) {
      return;
    }

    appendRunEvent({
      title: tx('Checking latest Overleaf content and refreshing the local Codex workspace.', '正在确认 Overleaf 最新内容，并刷新本地 Codex workspace。'),
      status: 'running'
    });

    await callPageBridge('invalidateProjectSnapshot', {});
    const freshProject = sanitizeRunProjectSnapshot(await callPageBridge('getProjectSnapshot', {
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
    }));
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
    resetContextProject();
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
    if (!Array.isArray(applied?.applied)) {
      return [];
    }
    return writebackController.getAppliedOperationPaths(applied || {});
  }

  function hasApplyResultEntries(applied = {}) {
    const appliedEntries = getAppliedEntries(applied);
    const skippedEntries = getSkippedEntries(applied);
    return Boolean(appliedEntries.length || skippedEntries.length);
  }

  function getAppliedEntries(applied = {}) {
    return Array.isArray(applied?.applied) ? applied.applied : [];
  }

  function getSkippedEntries(applied = {}) {
    return Array.isArray(applied?.skipped) ? applied.skipped : [];
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

  async function autoRecompileAfterWriteback(writtenPaths = [], saveVerification = {}) {
    if (state.autoRecompile === false) return null;
    if (state.mode === 'ask') return null;

    const CompileAdapter = window.CodexOverleafCompileAdapter;
    if (!CompileAdapter) return null;

    const hasCompilableFile = writtenPaths.some(filePath => CompileAdapter.isCompilableFile(filePath));
    if (!hasCompilableFile) return null;

    appendRunEvent({
      title: saveVerification?.state !== 'verified_saved'
        ? tx(
          'Post-write compile: Overleaf save was not verified, but Auto Compile is on. Triggering Overleaf Recompile and letting Overleaf wait for the latest save.',
          '正在写后编译：尚未确认 Overleaf 已保存，但已开启自动编译；将触发 Overleaf Recompile，并由 Overleaf 等待最新保存。'
        )
        : tx(
          'Post-write compile: LaTeX files were written, triggering Overleaf Recompile.',
          '正在写后编译：已写入 LaTeX 文件，正在触发 Overleaf Recompile。'
        ),
      status: 'running'
    });

    try {
      const result = await callPageBridge('triggerCompile', {
        preferUiClick: true,
        waitForSaveMs: 5000,
        requireVerifiedSave: saveVerification?.state === 'verified_saved'
      });
      if (result?.ok) {
        let logResult = null;
        try {
          logResult = await callPageBridge('getCompileLog', {
            triggerIfStale: false,
            maxAgeMs: 30000,
            waitForSaveMs: 0
          });
        } catch (_error) {
          logResult = null;
        }
        const compile = result.compile;
        if (compile?.status === 'success') {
          appendRunEvent({ title: tx('Compile succeeded.', '编译成功。'), status: 'completed' });
        } else if (compile?.status === 'triggered') {
          appendRunEvent({ title: tx('Overleaf compile was triggered. The page will continue showing progress.', '已触发 Overleaf 编译；页面会继续显示编译进度。'), status: 'completed' });
        } else {
          appendRunEvent({ title: tx(`Compile finished with status: ${compile?.status || 'unknown'}`, `编译完成，状态：${compile?.status || '未知'}`), status: 'completed' });
        }
        return buildPostWriteCompileSummary({ result, logResult });
      } else {
        const reason = result?.reason || tx('unknown reason', '未知原因');
        appendRunEvent({ title: tx(`Post-write compile did not succeed: ${reason}`, `写后编译未成功：${reason}`), status: 'failed' });
        return buildPostWriteCompileSummary({ result });
      }
    } catch (error) {
      appendRunEvent({ title: tx(`Post-write compile failed: ${error.message}`, `写后编译出错：${error.message}`), status: 'failed' });
      return buildPostWriteCompileSummary({ error });
    }
  }

  function buildPostWriteCompileSummary({ result = null, logResult = null, error = null } = {}) {
    const logAvailable = logResult?.ok === true;
    const errors = logAvailable && Array.isArray(logResult.errors)
      ? logResult.errors.slice(0, 5).map(formatCompileDiagnosticForSummary)
      : [];
    const warnings = logAvailable && Array.isArray(logResult.warnings)
      ? logResult.warnings.slice(0, 5).map(formatCompileDiagnosticForSummary)
      : [];
    if (error) {
      return {
        status: 'failed',
        reason: error?.message || 'Post-write compile failed.',
        errors,
        warnings,
        logAvailable
      };
    }
    if (!result?.ok) {
      return {
        status: 'failed',
        reason: result?.reason || 'Post-write compile did not succeed.',
        errors,
        warnings,
        logAvailable
      };
    }
    return {
      status: result.compile?.status || 'triggered',
      reason: result.reason || '',
      errors,
      warnings,
      logAvailable
    };
  }

  function appendCompileSummaryToConclusion(conclusion, compileSummary) {
    if (!compileSummary) {
      return conclusion;
    }
    const errors = compileSummary.errors || [];
    const warnings = compileSummary.warnings || [];
    let summary;
    if (errors.length) {
      summary = tx(
        `Post-write compile check: ${errors.length} remaining error(s): ${errors.slice(0, 3).join('; ')}`,
        `写后编译检查：仍有 ${errors.length} 个错误：${errors.slice(0, 3).join('；')}`
      );
    } else if (compileSummary.status === 'success') {
      summary = warnings.length
        ? tx(
          `Post-write compile check succeeded with ${warnings.length} warning(s).`,
          `写后编译检查已通过，但仍有 ${warnings.length} 个警告。`
        )
        : tx('Post-write compile check succeeded with no reported errors.', '写后编译检查已通过，未发现错误。');
    } else if (compileSummary.status === 'triggered') {
      summary = warnings.length
        ? tx(
          `Post-write compile was triggered; latest log shows ${warnings.length} warning(s).`,
          `已触发写后编译；最新日志显示 ${warnings.length} 个警告。`
        )
        : tx('Post-write compile was triggered; Overleaf may still be updating the result.', '已触发写后编译；Overleaf 可能仍在更新结果。');
    } else if (compileSummary.status === 'failed') {
      summary = tx(
        `Post-write compile check failed: ${compileSummary.reason || 'unknown reason'}`,
        `写后编译检查失败：${compileSummary.reason || '未知原因'}`
      );
    } else {
      summary = tx(
        `Post-write compile finished with status: ${compileSummary.status || 'unknown'}.`,
        `写后编译完成，状态：${compileSummary.status || '未知'}。`
      );
    }
    return [conclusion, '', summary].filter(Boolean).join('\n');
  }

  function formatCompileDiagnosticForSummary(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > 180 ? `${text.slice(0, 179)}...` : text;
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

  function partitionUnsafeProjectPathOperations(operations = []) {
    const safe = [];
    const skipped = [];
    for (const operation of operations || []) {
      const normalized = normalizeOperationProjectPaths(operation);
      const invalid = getInvalidOperationProjectPath(normalized);
      if (invalid) {
        skipped.push({
          operation: normalized,
          result: {
            ok: false,
            code: 'invalid_project_path',
            reason: tx(`Invalid ${invalid}. Codex did not write this file.`, `路径无效：${invalid}。Codex 没有写入这个文件。`)
          }
        });
        continue;
      }
      safe.push(normalized);
    }
    return { safe, skipped };
  }

  function normalizeOperationProjectPaths(operation = {}) {
    if (!operation || typeof operation !== 'object') {
      return operation;
    }
    const normalized = { ...operation };
    if (typeof operation.path === 'string') {
      normalized.path = normalizeSafeProjectPath(operation.path);
      if (!normalized.path) {
        normalized.invalidProjectPath = true;
      }
    }
    if (typeof operation.to === 'string') {
      normalized.to = normalizeSafeProjectPath(operation.to);
      if (!normalized.to) {
        normalized.invalidProjectDestinationPath = true;
      }
    }
    if (typeof operation.destinationPath === 'string') {
      normalized.destinationPath = normalizeSafeProjectPath(operation.destinationPath);
      if (!normalized.destinationPath) {
        normalized.invalidProjectDestinationPath = true;
      }
    }
    return normalized;
  }

  function getInvalidOperationProjectPath(operation = {}) {
    if (operation.invalidProjectPath || (requiresOperationPath(operation) && !operation.path)) {
      return 'operation path';
    }
    if (operation.invalidProjectDestinationPath || (requiresOperationDestinationPath(operation) && !(operation.to || operation.destinationPath))) {
      return 'operation destination path';
    }
    return '';
  }

  function requiresOperationPath(operation = {}) {
    return ['edit', 'create', 'delete', 'rename', 'move', 'binary-create', 'overwrite-binary'].includes(operation.type);
  }

  function requiresOperationDestinationPath(operation = {}) {
    return operation.type === 'rename' || operation.type === 'move';
  }

  function normalizeSafeProjectPath(value) {
    if (window.CodexOverleafProjectFiles?.normalizeSafeProjectPath) {
      return window.CodexOverleafProjectFiles.normalizeSafeProjectPath(value);
    }
    return String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/\\/g, '/')
      .trim()
      .replace(/^\/+/, '');
  }

  function evaluateGovernedOperations(operations = []) {
    if (!GovernanceRules?.evaluateGovernedOperations) {
      return { allowed: operations || [], blocked: [], rules: getGovernanceRulesForCurrentProject() };
    }
    return GovernanceRules.evaluateGovernedOperations(operations, getGovernanceRulesForCurrentProject());
  }

  function buildGovernanceSkippedApplyResult(blockedItems = []) {
    return {
      ok: blockedItems.length === 0,
      applied: [],
      skipped: (blockedItems || []).map(item => ({
        operation: item.operation,
        result: {
          ok: false,
          code: 'governance_blocked',
          reason: formatGovernanceBlockedReason(item),
          reasonKey: item.reason || 'governance_blocked'
        }
      }))
    };
  }

  function formatGovernanceBlockedReason(item = {}) {
    if (item.reason === 'readonly') {
      return tx(
        'Project governance marked this path read-only, so Codex did not write it.',
        '项目治理规则将此路径标记为只读，因此 Codex 没有写入。'
      );
    }
    if (item.reason === 'writable_allowlist') {
      return tx(
        'Project governance allows writes only to configured writable patterns, and this path is outside that allowlist.',
        '项目治理规则只允许写入配置的可写路径，此路径不在允许范围内。'
      );
    }
    return tx('Project governance blocked this write.', '项目治理规则阻止了此写入。');
  }

  function filterSyncChangesByOperations(syncChanges = [], operations = []) {
    const allowedPaths = new Set((operations || []).map(operation => operation.path).filter(Boolean));
    return (syncChanges || []).filter(change => allowedPaths.has(change?.path));
  }

  function mergeApplyResultSkipped(result = {}, skipped = []) {
    if (!skipped.length) {
      return result;
    }
    return {
      ...(result || {}),
      ok: false,
      applied: Array.isArray(result?.applied) ? result.applied : [],
      skipped: [
        ...getSkippedEntries(result),
        ...skipped
      ]
    };
  }

  async function confirmBinaryOperations(operations = []) {
    const binaryOperations = (operations || []).filter(operation => operation.type === 'binary-create' || operation.type === 'overwrite-binary');
    if (!binaryOperations.length) {
      return { operations, skipped: [] };
    }
    const approved = await showPluginConfirm({
      title: tr('binaryAssetConfirmTitle'),
      message: tr('binaryAssetConfirmMessage', { files: formatOperationFiles(binaryOperations) }),
      confirmLabel: tr('binaryAssetConfirm'),
      cancelLabel: tr('binaryAssetCancel'),
      destructive: true
    });
    if (approved) {
      return { operations, skipped: [] };
    }
    return {
      operations: operations.filter(operation => operation.type !== 'binary-create' && operation.type !== 'overwrite-binary'),
      skipped: binaryOperations.map(operation => ({
        operation,
        result: {
          ok: false,
          code: 'binary_confirmation_rejected',
          reason: tx('Binary asset writeback requires explicit confirmation and was skipped.', '二进制资源写回需要显式确认，已跳过。')
        }
      }))
    };
  }

  function buildAuditDiffSummary(operations = []) {
    const changedFiles = new Set();
    let binaryFilesChanged = 0;
    for (const operation of operations || []) {
      if (operation?.path) {
        changedFiles.add(operation.path);
      }
      if (operation?.type === 'binary-create' || operation?.type === 'overwrite-binary') {
        binaryFilesChanged++;
      }
    }
    return {
      filesChanged: changedFiles.size,
      additions: 0,
      deletions: 0,
      binaryFilesChanged
    };
  }

  function buildAuditSummaryFromApply({ operations = [], applyResults = [], blockedFiles = [], resultStatus = 'completed', saveVerification = null } = {}) {
    const appliedFiles = [];
    const skippedFiles = [];
    for (const result of applyResults || []) {
      for (const item of getAppliedEntries(result)) {
        appliedFiles.push(summarizeOperationForAudit(item.operation, item.result, 'applied'));
      }
      for (const item of getSkippedEntries(result)) {
        skippedFiles.push(summarizeOperationForAudit(item.operation, item.result, 'skipped'));
      }
    }
    return {
      changedFiles: (operations || []).map(operation => summarizeOperationForAudit(operation, {}, 'changed')),
      ['diffSummary']: buildAuditDiffSummary(operations),
      blockedFiles,
      appliedFiles,
      skippedFiles,
      resultStatus,
      saveVerification
    };
  }

  function summarizeOperationForAudit(operation = {}, result = {}, status = '') {
    return {
      path: operation.path || operation.from || operation.to || '',
      destinationPath: operation.destinationPath || operation.to || '',
      type: operation.type || '',
      reason: result.reasonKey || result.code || result.reason || operation.reasonKey || operation.reason || '',
      status,
      size: operation.size
    };
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

  function isExperimentalOtEnabled() {
    const projectId = getCurrentProjectId();
    return isExperimentalOtEnabledForProject(projectId);
  }

  function isExperimentalOtEnabledForProject(projectId) {
    return state?.experimentalOtByProject?.[projectId] === true;
  }

  function setExperimentalOtEnabled(enabled) {
    const projectId = getCurrentProjectId();
    setExperimentalOtEnabledForProject(projectId, enabled);
  }

  function setExperimentalOtEnabledForProject(projectId, enabled) {
    if (!projectId) {
      return;
    }
    state = {
      ...state,
      experimentalOtByProject: {
        ...normalizeExperimentalOtByProject(state?.experimentalOtByProject),
        [projectId]: enabled === true
      }
    };
  }

  function normalizeExperimentalOtByProject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    const normalized = {};
    for (const key of Object.keys(value)) {
      if (key) {
        normalized[key] = value[key] === true;
      }
    }
    return normalized;
  }

  function syncExperimentalOtToggleForProject(projectId = getCurrentProjectId()) {
    lastExperimentalOtProjectId = projectId;
    const enabled = isExperimentalOtEnabledForProject(projectId);
    const experimentalOtCheckbox = panel?.querySelector('[data-experimental-ot]');
    if (experimentalOtCheckbox) {
      experimentalOtCheckbox.checked = enabled;
    }
    updateExperimentalOtToggleControl(enabled);
    updateOtStatusDisplay(enabled
      ? (currentOtStatus === 'off' ? 'starting' : currentOtStatus)
      : 'off');
    return enabled;
  }

  async function handleExperimentalOtToggleClick(event) {
    event.preventDefault();
    await toggleExperimentalOtCheckbox();
  }

  async function handleExperimentalOtToggleKeydown(event) {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }
    event.preventDefault();
    await toggleExperimentalOtCheckbox();
  }

  async function toggleExperimentalOtCheckbox() {
    const checkbox = panel?.querySelector('[data-experimental-ot]');
    if (!checkbox) {
      return;
    }
    const nextEnabled = !checkbox.checked;
    if (nextEnabled) {
      closeDiagnosticsMenu();
      const approved = await showPluginConfirm({
        title: tr('experimentalOtConfirmTitle'),
        message: tr('experimentalOtConfirmMessage'),
        confirmLabel: tr('experimentalOtConfirmEnable'),
        cancelLabel: tr('confirmDefaultCancel')
      });
      if (!approved) {
        return;
      }
    } else {
      closeDiagnosticsMenu();
    }
    checkbox.checked = nextEnabled;
    handleExperimentalOtToggleChange({ currentTarget: checkbox });
    if (nextEnabled) {
      showPluginToast(tr('experimentalOtEnabledToast'), { status: 'info' });
    }
  }

  function handleExperimentalOtToggleChange(event) {
    const checkbox = event?.currentTarget || panel?.querySelector('[data-experimental-ot]');
    if (!checkbox) {
      return;
    }
    const projectId = getCurrentProjectId();
    lastExperimentalOtProjectId = projectId;
    setExperimentalOtEnabledForProject(projectId, checkbox.checked);
    updateExperimentalOtToggleControl(checkbox.checked);
    updateOtStatusDisplay(checkbox.checked ? (currentOtStatus === 'off' ? 'starting' : currentOtStatus) : 'off');
    syncOtWarmMirrorController().catch(error => {
      updateOtStatusDisplay('unavailable');
      appendPlainLog(tx(`Experimental OT warm mirror unavailable: ${error.message}`, `实验性 OT 预热镜像不可用：${error.message}`));
    });
    saveStateSoon();
  }

  function updateExperimentalOtToggleControl(enabled) {
    const toggle = panel?.querySelector('[data-experimental-ot-toggle]');
    if (!toggle) {
      return;
    }
    const checked = enabled === true;
    toggle.dataset.checked = checked ? 'true' : 'false';
    toggle.setAttribute('aria-checked', checked ? 'true' : 'false');
    updateExperimentalOtMenuStatus();
  }

  async function syncOtWarmMirrorController() {
    const projectId = getCurrentProjectId();
    const requestId = ++otSyncRequestId;
    const enabled = isExperimentalOtEnabledForProject(projectId);
    otWarmMirrorProjectId = projectId;
    ensureOtWarmMirrorStateProject(projectId);
    if (enabled) {
      const pause = otWarmMirrorController?.shouldPauseOtWarmMirror?.({ running: Boolean(currentRunView) }) || { pause: false };
      if (pause.pause) {
        clearOtEventPolling({ clearPatchQueue: true });
        otWarmMirrorState.lastErrorCode = pause.reason || 'paused';
        updateOtStatusDisplay('stale');
        return { ok: true, skipped: true, reason: pause.reason || 'paused' };
      }
      updateOtStatusDisplay('starting');
    } else {
      clearOtEventPolling({ clearPatchQueue: true });
    }
    const response = enabled
      ? await callPageBridge('startOtObserver', { projectId })
      : await callPageBridge('stopOtObserver', {});
    if (!isCurrentOtSync(requestId, projectId) || getCurrentProjectId() !== projectId) {
      if (enabled) {
        await handleStaleOtStartResponse(projectId, requestId);
      }
      return response;
    }
    if (!enabled) {
      if (!isSuccessfulOtBridgeResponse(response)) {
        updateOtStatusDisplay('unavailable');
        return response;
      }
      updateOtStatusDisplay('off');
      return response;
    }
    const status = readOtBridgeStatus(response);
    if (!isSuccessfulOtBridgeResponse(response) || status === 'unavailable') {
      handleFailedOtStart(projectId, requestId);
      return response;
    }
    const pauseAfterStart = otWarmMirrorController?.shouldPauseOtWarmMirror?.({ running: Boolean(currentRunView) }) || { pause: false };
    if (pauseAfterStart.pause) {
      await pauseOtWarmMirror(pauseAfterStart.reason || 'paused');
      return response;
    }
    updateOtStatusDisplay(status);
    scheduleOtEventPolling(projectId, { immediate: true });
    return response;
  }

  function isCurrentOtSync(requestId, projectId) {
    return requestId === otSyncRequestId && projectId === otWarmMirrorProjectId;
  }

  function isSuccessfulOtBridgeResponse(response) {
    return Boolean(response) && response.ok !== false;
  }

  async function handleStaleOtStartResponse(projectId, requestId) {
    if (isCurrentOtSync(requestId, projectId) && getCurrentProjectId() === projectId) {
      return;
    }
    clearOtEventPolling({ clearPatchQueue: true });
    await callPageBridge('stopOtObserver', {});
    if (isExperimentalOtEnabled()) {
      await syncOtWarmMirrorController();
    }
  }

  function handleFailedOtStart(projectId, requestId) {
    if (!isCurrentOtSync(requestId, projectId) || getCurrentProjectId() !== projectId) {
      return;
    }
    clearOtEventPolling({ clearPatchQueue: true });
    setExperimentalOtEnabledForProject(projectId, false);
    const experimentalOtCheckbox = panel?.querySelector('[data-experimental-ot]');
    if (experimentalOtCheckbox) {
      experimentalOtCheckbox.checked = false;
    }
    updateOtStatusDisplay('unavailable');
    saveStateSoon();
  }

  function readOtBridgeStatus(response) {
    if (!response || response.ok === false) {
      return 'unavailable';
    }
    return response.state || response.status || response.result?.state || response.result?.status || 'unavailable';
  }

  function ensureOtWarmMirrorStateProject(projectId) {
    if (!projectId || otWarmMirrorState.projectId === projectId) {
      return;
    }
    clearOtEventPolling({ clearPatchQueue: true });
    otWarmMirrorState.projectId = projectId;
    otWarmMirrorState.lastPatchAt = 0;
    otWarmMirrorState.lastErrorCode = '';
    otWarmMirrorState.lastStatus = currentOtStatus;
  }

  function clearOtEventPolling(options = {}) {
    if (otWarmMirrorState.pollTimer) {
      window.clearTimeout(otWarmMirrorState.pollTimer);
      otWarmMirrorState.pollTimer = null;
    }
    if (otWarmMirrorState.flushTimer) {
      window.clearTimeout(otWarmMirrorState.flushTimer);
      otWarmMirrorState.flushTimer = null;
    }
    if (options.clearPatchQueue !== false) {
      otWarmMirrorState.patchQueue = [];
    }
  }

  function scheduleOtEventPolling(projectId = getCurrentProjectId(), options = {}) {
    if (!canPollOtWarmMirror(projectId)) {
      return;
    }
    ensureOtWarmMirrorStateProject(projectId);
    if (otWarmMirrorState.pollTimer) {
      window.clearTimeout(otWarmMirrorState.pollTimer);
    }
    const delayMs = options.immediate
      ? 0
      : Math.max(0, Number(otWarmMirrorController?.OT_POLL_INTERVAL_MS) || 1000);
    otWarmMirrorState.pollTimer = window.setTimeout(() => {
      otWarmMirrorState.pollTimer = null;
      pollOtEvents(projectId).catch(error => {
        otWarmMirrorState.lastErrorCode = error?.code || error?.message || 'ot_poll_failed';
        updateOtStatusDisplay('unavailable');
      });
    }, delayMs);
  }

  function canPollOtWarmMirror(projectId) {
    return Boolean(projectId
      && otWarmMirrorController?.shouldPauseOtWarmMirror
      && otWarmMirrorController?.buildPatchFilesRequest
      && isExperimentalOtEnabledForProject(projectId)
      && otWarmMirrorProjectId === projectId
      && getCurrentProjectId() === projectId);
  }

  async function pollOtEvents(projectId = otWarmMirrorState.projectId || getCurrentProjectId()) {
    if (!canPollOtWarmMirror(projectId)) {
      clearOtEventPolling({ clearPatchQueue: true });
      return { ok: false, skipped: true, reason: 'not_current_project' };
    }

    const pause = otWarmMirrorController.shouldPauseOtWarmMirror({ running: Boolean(currentRunView) });
    if (pause.pause) {
      otWarmMirrorState.lastErrorCode = pause.reason || 'paused';
      updateOtStatusDisplay('stale');
      clearOtEventPolling({ clearPatchQueue: false });
      return { ok: false, skipped: true, reason: pause.reason || 'paused' };
    }

    try {
      const statusResponse = await callPageBridge('getOtStatus', { projectId });
      if (!canPollOtWarmMirror(projectId)) {
        return { ok: false, skipped: true, reason: 'project_changed' };
      }
      if (!isSuccessfulOtBridgeResponse(statusResponse)) {
        otWarmMirrorState.lastErrorCode = readOtBridgeErrorCode(statusResponse, 'get_ot_status_failed');
        updateOtStatusDisplay('unavailable');
        return statusResponse;
      }
      const status = readOtBridgeStatus(statusResponse);
      if (status) {
        updateOtStatusDisplay(status);
      }

      const drainResponse = await callPageBridge('drainOtEvents', { projectId });
      if (!canPollOtWarmMirror(projectId)) {
        return { ok: false, skipped: true, reason: 'project_changed' };
      }
      if (!isSuccessfulOtBridgeResponse(drainResponse)) {
        otWarmMirrorState.lastErrorCode = readOtBridgeErrorCode(drainResponse, 'drain_ot_events_failed');
        updateOtStatusDisplay('unavailable');
        return drainResponse;
      }
      const events = readOtBridgeEvents(drainResponse);
      if (events.length) {
        queueOtPatchEvents(events, projectId);
      }
      return drainResponse;
    } catch (error) {
      otWarmMirrorState.lastErrorCode = error?.code || error?.message || 'ot_poll_failed';
      updateOtStatusDisplay('unavailable');
      return { ok: false, error };
    } finally {
      if (canPollOtWarmMirror(projectId) && !currentRunView) {
        scheduleOtEventPolling(projectId);
      }
    }
  }

  function readOtBridgeEvents(response) {
    if (Array.isArray(response)) {
      return response;
    }
    if (Array.isArray(response?.events)) {
      return response.events;
    }
    if (Array.isArray(response?.result?.events)) {
      return response.result.events;
    }
    return [];
  }

  function readOtBridgeErrorCode(response, fallback) {
    const value = response?.lastErrorCode
      || response?.reason
      || response?.error?.code
      || response?.error
      || fallback;
    return typeof value === 'string' ? value : fallback;
  }

  function queueOtPatchEvents(events, projectId = getCurrentProjectId()) {
    if (!Array.isArray(events) || !events.length || !canPollOtWarmMirror(projectId)) {
      return;
    }
    ensureOtWarmMirrorStateProject(projectId);
    otWarmMirrorState.patchQueue.push(...events);
    scheduleOtPatchFlush(projectId);
  }

  function scheduleOtPatchFlush(projectId = otWarmMirrorState.projectId || getCurrentProjectId(), options = {}) {
    if (!canPollOtWarmMirror(projectId) || !otWarmMirrorState.patchQueue.length) {
      return;
    }
    if (otWarmMirrorState.flushTimer) {
      window.clearTimeout(otWarmMirrorState.flushTimer);
    }
    const delayMs = options.immediate
      ? 0
      : Math.max(0, Number(otWarmMirrorController?.OT_PATCH_DEBOUNCE_MS) || 500);
    otWarmMirrorState.flushTimer = window.setTimeout(() => {
      otWarmMirrorState.flushTimer = null;
      flushOtPatchBatch(projectId).catch(error => {
        otWarmMirrorState.lastErrorCode = error?.code || error?.message || 'ot_patch_failed';
        updateOtStatusDisplay('inconsistent');
      });
    }, delayMs);
  }

  async function flushOtPatchBatch(projectId = otWarmMirrorState.projectId || getCurrentProjectId()) {
    if (otWarmMirrorState.flushing) {
      return { ok: false, skipped: true, reason: 'ot_patch_in_flight' };
    }
    if (!canPollOtWarmMirror(projectId)) {
      clearOtEventPolling({ clearPatchQueue: true });
      return { ok: false, skipped: true, reason: 'not_current_project' };
    }

    const pause = otWarmMirrorController.shouldPauseOtWarmMirror({ running: Boolean(currentRunView) });
    if (pause.pause) {
      otWarmMirrorState.lastErrorCode = pause.reason || 'paused';
      updateOtStatusDisplay('stale');
      clearOtEventPolling({ clearPatchQueue: false });
      return { ok: false, skipped: true, reason: pause.reason || 'paused' };
    }

    const maxBatch = Math.max(1, Number(otWarmMirrorController?.OT_MAX_PATCH_BATCH) || 25);
    const batch = otWarmMirrorState.patchQueue.splice(0, maxBatch);
    if (!batch.length) {
      return { ok: true, skipped: true, reason: 'empty_batch' };
    }

    otWarmMirrorState.flushing = true;
    try {
      const request = {
        ...otWarmMirrorController.buildPatchFilesRequest({ projectId, events: batch }),
        method: 'mirror.patchFiles'
      };
      if (!Array.isArray(request.params?.files) || request.params.files.length === 0) {
        return { ok: true, skipped: true, reason: 'empty_filtered_batch' };
      }
      if (!canPollOtWarmMirror(projectId)) {
        return { ok: false, skipped: true, reason: 'project_changed' };
      }

      const response = await sendBackgroundNative(request);
      if (!response?.ok) {
        otWarmMirrorState.lastErrorCode = response?.error?.code || response?.error?.message || 'mirror_patch_failed';
        updateOtStatusDisplay('inconsistent');
        return response;
      }

      const result = response.result || {};
      const skippedFiles = Array.isArray(result?.skippedFiles) ? result.skippedFiles : [];
      const skippedCount = Number.isFinite(Number(result?.skippedCount))
        ? Number(result.skippedCount)
        : skippedFiles.length;
      if (skippedFiles.length || skippedCount > 0) {
        otWarmMirrorState.lastErrorCode = 'mirror_patch_skipped';
        updateOtStatusDisplay('inconsistent');
        return response;
      }
      const appliedFiles = Array.isArray(result?.appliedFiles) ? result.appliedFiles : null;
      const appliedCount = Number.isFinite(Number(result?.appliedCount))
        ? Number(result.appliedCount)
        : NaN;
      if (!appliedFiles || !Number.isFinite(appliedCount) || appliedCount <= 0 || appliedFiles.length !== appliedCount) {
        otWarmMirrorState.lastErrorCode = 'mirror_patch_invalid_result';
        updateOtStatusDisplay('inconsistent');
        return response;
      }

      otWarmMirrorState.lastPatchAt = Date.now();
      otWarmMirrorState.lastErrorCode = '';
      if (canPollOtWarmMirror(projectId)) {
        updateOtStatusDisplay('observing');
      }
      return response;
    } catch (error) {
      otWarmMirrorState.lastErrorCode = error?.code || error?.message || 'mirror_patch_failed';
      updateOtStatusDisplay('inconsistent');
      return { ok: false, error };
    } finally {
      otWarmMirrorState.flushing = false;
      if (otWarmMirrorState.patchQueue.length && canPollOtWarmMirror(projectId) && !currentRunView) {
        scheduleOtPatchFlush(projectId, { immediate: true });
      }
    }
  }

  async function pauseOtWarmMirror(reason = 'pause') {
    const projectId = getCurrentProjectId();
    clearOtEventPolling({ clearPatchQueue: true });
    if (!isExperimentalOtEnabledForProject(projectId)) {
      return { ok: true, skipped: true, reason: 'disabled' };
    }
    ensureOtWarmMirrorStateProject(projectId);
    otWarmMirrorState.lastErrorCode = reason;
    updateOtStatusDisplay('stale');
    try {
      const response = await callPageBridge('stopOtObserver', { projectId, reason });
      if (!isSuccessfulOtBridgeResponse(response)) {
        otWarmMirrorState.lastErrorCode = readOtBridgeErrorCode(response, 'pause_ot_observer_failed');
        updateOtStatusDisplay('unavailable');
      }
      return response;
    } catch (error) {
      otWarmMirrorState.lastErrorCode = error?.code || error?.message || 'pause_ot_observer_failed';
      updateOtStatusDisplay('unavailable');
      return { ok: false, error };
    }
  }

  async function resumeOtWarmMirror(reason = 'resume') {
    const projectId = getCurrentProjectId();
    if (!isExperimentalOtEnabledForProject(projectId)) {
      return { ok: true, skipped: true, reason: 'disabled' };
    }
    try {
      return await syncOtWarmMirrorController({ reason });
    } catch (error) {
      otWarmMirrorState.lastErrorCode = error?.code || error?.message || 'resume_ot_observer_failed';
      updateOtStatusDisplay('unavailable');
      return { ok: false, error };
    }
  }

  function updateOtStatusDisplay(status = currentOtStatus) {
    const normalized = normalizeOtStatus(status);
    currentOtStatus = normalized;
    otWarmMirrorState.lastStatus = normalized;
    const statusElement = panel?.querySelector('[data-ot-status]');
    if (statusElement) {
      const label = formatOtStatusLabel(normalized);
      statusElement.textContent = formatOtToggleStatusText(label);
      statusElement.dataset.otStatus = normalized;
      statusElement.title = formatOtToggleStatusText(label);
    }
    updateExperimentalOtMenuStatus();
    updateProbeStatusOtSuffix();
  }

  function formatOtStatusLabel(status) {
    const labels = {
      off: 'otStatusOff',
      starting: 'otStatusStarting',
      observing: 'otStatusObserving',
      unavailable: 'otStatusUnavailable',
      stale: 'otStatusStale',
      inconsistent: 'otStatusInconsistent'
    };
    return tr(labels[normalizeOtStatus(status)] || 'otStatusUnavailable');
  }

  function formatOtToggleStatusText(label) {
    return `OT: ${label}`;
  }

  function updateExperimentalOtMenuStatus() {
    const statusElement = panel?.querySelector('[data-experimental-ot-menu-status]');
    if (!statusElement) {
      return;
    }
    statusElement.textContent = `${formatOtToggleStatusText(formatOtStatusLabel(currentOtStatus))} · ${tr('experimentalOtMenuSubtitle')}`;
  }

  function normalizeOtStatus(status) {
    const value = typeof status === 'string' ? status : '';
    return ['off', 'starting', 'observing', 'unavailable', 'stale', 'inconsistent'].includes(value)
      ? value
      : 'unavailable';
  }

  function scheduleMirrorPrefetch(options = {}) {
    syncMirrorPrefetchStateForProject();
    if (!mirrorHealth?.shouldStartPrefetch) {
      return;
    }
    const delayMs = Math.max(0, Number(options.delayMs) || 0);
    if (mirrorPrefetchState.timer) {
      window.clearTimeout(mirrorPrefetchState.timer);
      mirrorPrefetchState.timer = null;
    }
    mirrorPrefetchState.timer = window.setTimeout(() => {
      mirrorPrefetchState.timer = null;
      syncMirrorPrefetch({ reason: options.reason || 'deferred' }).catch(error => {
        mirrorPrefetchState.lastErrorAt = Date.now();
        mirrorPrefetchState.lastError = error?.message || String(error);
      });
    }, delayMs);
  }

  function isExpectedPrefetchSkip(errorOrResponse) {
    const code = errorOrResponse?.error?.code || errorOrResponse?.code || '';
    const message = errorOrResponse?.error?.message || errorOrResponse?.message || String(errorOrResponse || '');
    return code === 'project_locked'
      || code === 'project_changed'
      || /project_locked|project changed|project_changed|navigation/i.test(message);
  }

  async function syncMirrorPrefetch(options = {}) {
    syncMirrorPrefetchStateForProject();
    const projectId = getCurrentProjectId();
    const now = Date.now();
    const readiness = mirrorHealth?.shouldStartPrefetch?.({
      ...mirrorPrefetchState,
      busy: Boolean(currentRunView),
      now
    }) || { ok: false, reason: 'unavailable' };
    if (!readiness.ok) {
      return { ok: false, skipped: true, reason: readiness.reason };
    }

    mirrorPrefetchState.projectId = projectId;
    mirrorPrefetchState.lastAttemptAt = now;
    const inFlight = (async () => {
      const project = sanitizeRunProjectSnapshot(await callPageBridge('getProjectSnapshot', {
        force: false,
        maxAgeMs: 30000,
        preferLightweight: false,
        allowZipFallback: true,
        allowEditorNavigation: false,
        requireFullProject: true,
        includeBinaryFiles: true,
        zipOnly: true,
        zipTimeoutMs: RUN_SNAPSHOT_ZIP_TIMEOUT_MS
      }));
      if (getCurrentProjectId() !== projectId) {
        return { ok: false, skipped: true, reason: 'project_changed' };
      }
      if (project?.capabilities?.fullProjectSnapshot !== true) {
        return { ok: false, skipped: true, reason: 'not_full_project' };
      }
      const response = await sendBackgroundNative({
        method: 'mirror.sync',
        params: {
          projectId,
          project,
          reason: options.reason || 'prefetch'
        }
      });
      if (!response?.ok) {
        if (isExpectedPrefetchSkip(response)) {
          return { ok: false, skipped: true, reason: response?.error?.code || 'expected_busy' };
        }
        throw new Error(response?.error?.message || 'mirror.sync failed');
      }
      if (getCurrentProjectId() !== projectId) {
        return { ok: false, skipped: true, reason: 'project_changed' };
      }
      mirrorPrefetchState.lastSuccessAt = Date.now();
      mirrorPrefetchState.lastError = null;
      return { ok: true };
    })();

    mirrorPrefetchState.inFlight = inFlight;
    try {
      return await inFlight;
    } catch (error) {
      if (isExpectedPrefetchSkip(error)) {
        return { ok: false, skipped: true, reason: error?.code || error?.message || 'expected_busy' };
      }
      mirrorPrefetchState.lastErrorAt = Date.now();
      mirrorPrefetchState.lastError = error?.message || String(error);
      return { ok: false, error };
    } finally {
      if (mirrorPrefetchState.inFlight === inFlight) {
        mirrorPrefetchState.inFlight = null;
      }
    }
  }

  async function settleMirrorPrefetchBeforeRun() {
    syncMirrorPrefetchStateForProject();
    if (mirrorPrefetchState.timer) {
      window.clearTimeout(mirrorPrefetchState.timer);
      mirrorPrefetchState.timer = null;
    }
    if (!mirrorPrefetchState.inFlight) {
      return;
    }
    try {
      await mirrorPrefetchState.inFlight;
    } catch (error) {
      if (!isExpectedPrefetchSkip(error)) {
        mirrorPrefetchState.lastErrorAt = Date.now();
        mirrorPrefetchState.lastError = error?.message || String(error);
      }
    }
  }

  function isMirrorReusable(mirrorStatus) {
    const health = mirrorHealth?.classifyMirrorHealth?.(mirrorStatus) || { reusable: false };
    return health.reusable === true;
  }

  async function resolveWarmRunStart(taskContext = {}) {
    const focusFiles = taskContext.focusFiles || [];
    const mode = taskContext.mode || state?.mode;
    const mirrorStatus = await getMirrorFreshness();
    const otWarmStart = otWarmMirrorController.canUseOtWarmStart({
      enabled: isExperimentalOtEnabled(),
      focusFiles,
      mirrorStatus
    });
    if (otWarmStart.ok) {
      return {
        useExistingMirror: true,
        warmStart: true,
        otWarmStart: true,
        reason: 'ot_focus_fresh',
        mirrorStatus,
        focusFiles: otWarmStart.focusFiles,
        project: {
          capabilities: {
            fullProjectSnapshot: false,
            method: 'ot-warm-mirror'
          },
          files: []
        }
      };
    }
    if (!mirrorStatus?.exists || !isMirrorReusable(mirrorStatus)) {
      return { useExistingMirror: false, reason: 'mirror_not_fresh', mirrorStatus };
    }

    let overlayProject = null;
    try {
      overlayProject = await callPageBridge('getProjectSnapshot', {
        force: true,
        maxAgeMs: 0,
        preferLightweight: true,
        allowZipFallback: false,
        allowEditorNavigation: false,
        restrictToRequestedPathsOnly: true,
        requireFullProject: false,
        includeBinaryFiles: false,
        focusFiles
      });
    } catch (error) {
      return { useExistingMirror: false, reason: 'overlay_probe_failed', mirrorStatus };
    }
    const fileOverlays = buildSnapshotFileOverlays(overlayProject, focusFiles);
    if (!fileOverlays.length) {
      return { useExistingMirror: false, reason: 'missing_current_overlay', mirrorStatus };
    }
    if (focusFiles.length && !focusFiles.every(path => {
      const normalized = normalizeSnapshotPath(path);
      return fileOverlays.some(file => normalizeSnapshotPath(file.path) === normalized);
    })) {
      return { useExistingMirror: false, reason: 'missing_focus_overlay', mirrorStatus };
    }

    return {
      useExistingMirror: true,
      warmStart: true,
      reason: mode === 'ask' ? 'warm_whole_project_ask' : 'warm_whole_project',
      mirrorStatus,
      fileOverlays,
      project: overlayProject
    };
  }

  async function prepareMirrorStaleRetry({ project = {}, focusFiles = [] } = {}) {
    throwIfRunCancellationRequested();
    appendLog(formatProjectSnapshotUserLog(project));
    const snapshotWarnings = getProjectSnapshotWarnings(project);
    const focusedPartialSnapshot = runController.canUseFocusedPartialSnapshot({
      project,
      snapshotWarnings,
      focusFiles,
      isUsableProjectFileContent: window.CodexOverleafProjectFiles.isUsableProjectFileContent
    });
    if (snapshotWarnings.blocking.length && !focusedPartialSnapshot) {
      for (const warning of snapshotWarnings.blocking) {
        appendLog(tx(`Cannot continue: ${formatProjectSnapshotWarning(warning)}`, `无法继续：${formatProjectSnapshotWarning(warning)}`));
      }
      appendCompletionReport({
        conclusion: tr('warmMirrorStaleBlockedConclusion'),
        status: 'blocked',
        operations: [],
        applyResults: [],
        nextStep: tr('warmMirrorStaleBlockedNextStep')
      });
      finishRunView(tr('warmMirrorStaleBlockedTitle'), 'failed');
      return { ok: false };
    }
    if (focusedPartialSnapshot) {
      appendRunEvent({
        title: tx(
          `Only selected context files were read: ${focusFiles.join(', ')}. This retry will read and write only these files.`,
          `只读到你选择的上下文文件：${focusFiles.join(', ')}；本次重试将只基于这些文件运行和写回。`
        ),
        status: 'completed'
      });
    }
    return {
      ok: true,
      project,
      restrictToFocusFiles: runController.shouldRestrictWritebackToFocus({ focusFiles })
    };
  }

  function syncMirrorPrefetchStateForProject() {
    const projectId = getCurrentProjectId();
    const projectChanged = Boolean(mirrorPrefetchState.projectId && mirrorPrefetchState.projectId !== projectId);
    syncCustomInstructionsEditorForProject(projectId, { force: projectChanged });
    syncOtWarmMirrorStateForProject();
    if (!mirrorPrefetchState.projectId || !projectChanged) {
      return;
    }
    if (mirrorPrefetchState.timer) {
      window.clearTimeout(mirrorPrefetchState.timer);
    }
    mirrorPrefetchState = {
      inFlight: mirrorPrefetchState.inFlight,
      lastSuccessAt: 0,
      lastErrorAt: 0,
      lastError: null,
      timer: null,
      projectId
    };
  }

  function syncOtWarmMirrorStateForProject() {
    const projectId = getCurrentProjectId();
    syncExperimentalOtToggleForProject(projectId);
    if (!otWarmMirrorProjectId) {
      otWarmMirrorProjectId = projectId;
      return;
    }
    if (otWarmMirrorProjectId === projectId) {
      return;
    }
    clearOtEventPolling({ clearPatchQueue: true });
    otWarmMirrorProjectId = projectId;
    otSyncRequestId++;
    callPageBridge('stopOtObserver', {}).then(response => {
      if (!isSuccessfulOtBridgeResponse(response)) {
        updateOtStatusDisplay('unavailable');
      }
      return syncOtWarmMirrorController();
    }).catch(error => {
      updateOtStatusDisplay('unavailable');
      appendPlainLog(tx(`Experimental OT warm mirror unavailable: ${error.message}`, `实验性 OT 预热镜像不可用：${error.message}`));
    });
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
    const runRequireReviewing = typeof options.requireReviewing === 'boolean'
      ? options.requireReviewing
      : state.requireReviewing === true;
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
    const reviewing = await ensureReviewingBeforeWrite(partitioned.safe, { requireReviewing: runRequireReviewing });
    if (!reviewing.ok) {
      return buildReviewingBlockedApplyResult(partitioned.safe, reviewing, partitioned.skipped);
    }
    const applied = partitioned.safe.length
      ? await callPageBridge('applyOperations', {
        operations: partitioned.safe,
        baseFiles: project?.files || [],
        requireReviewing: runRequireReviewing,
        requireEditing: !runRequireReviewing
      })
      : { ok: true, applied: [], skipped: [] };

    return {
      ...applied,
      ok: applied.ok && partitioned.skipped.length === 0,
      skipped: [
        ...getSkippedEntries(applied),
        ...partitioned.skipped
      ]
    };
  }

  async function ensureReviewingBeforeWrite(operations = [], options = {}) {
    const requireReviewing = typeof options.requireReviewing === 'boolean'
      ? options.requireReviewing
      : state?.requireReviewing === true;
    if (!operations.length) {
      return { ok: true, skipped: true };
    }
    const method = requireReviewing ? 'ensureReviewing' : 'ensureEditing';

    appendRunEvent({
      title: requireReviewing
        ? tx('Verifying Overleaf Reviewing/Track Changes before writing.', '正在确认 Overleaf 已开启 Reviewing/Track Changes。')
        : tx('Verifying Overleaf Editing mode before writing.', '正在确认 Overleaf 已切到 Editing 模式。'),
      status: 'running'
    });
    const result = await callPageBridge(method, { waitMs: 1800 });
    if (result?.ok) {
      appendRunEvent({
        title: requireReviewing
          ? (result.activated
            ? tx('Switched to Overleaf Reviewing/Track Changes. Upcoming writes will be tracked.', '已切到 Overleaf Reviewing/Track Changes，接下来写入会留痕。')
            : tx('Overleaf Reviewing/Track Changes is on. Upcoming writes will be tracked.', '已确认 Overleaf Reviewing/Track Changes 正在开启，接下来写入会留痕。'))
          : (result.activated
            ? tx('Switched to Overleaf Editing mode. Upcoming writes will not use Track Changes.', '已切到 Overleaf Editing 模式，接下来写入不会使用 Track Changes。')
            : tx('Overleaf Editing mode is on. Upcoming writes will not use Track Changes.', '已确认 Overleaf Editing 模式开启，接下来写入不会使用 Track Changes。')),
        status: 'completed'
      });
      return result;
    }

    appendRunEvent({
      title: requireReviewing
        ? tx('Write blocked: Codex could not verify Overleaf Reviewing/Track Changes.', '已阻止写入：Codex 没能确认 Overleaf 正在用 Reviewing/Track Changes。')
        : tx('Write blocked: Codex could not verify Overleaf Editing mode.', '已阻止写入：Codex 没能确认 Overleaf 正在用 Editing 模式。'),
      status: 'failed',
      detail: {
        [tr('detailReason')]: localizeVisibleReason(result?.reason || (requireReviewing
          ? tx('Overleaf did not return track changes status', 'Overleaf 没有返回留痕状态')
          : tx('Overleaf did not return Editing mode status', 'Overleaf 没有返回 Editing 模式状态'))),
        [tx('Status', '状态')]: result?.reviewing?.status || 'unknown'
      }
    });
    return {
      ok: false,
      code: result?.code || (requireReviewing ? 'reviewing_not_enabled' : 'editing_not_confirmed'),
      reason: result?.reason || (requireReviewing ? 'Reviewing/Track Changes was not enabled' : 'Editing mode was not confirmed'),
      reviewing: result?.reviewing || null,
      requireReviewing
    };
  }

  function buildReviewingBlockedApplyResult(operations = [], reviewing = {}, extraSkipped = []) {
    const blockedByEditing = reviewing?.code === 'editing_not_confirmed' || reviewing?.requireReviewing === false;
    return {
      ok: false,
      applied: [],
      skipped: [
        ...(operations || []).map(operation => ({
          operation,
          result: {
            ok: false,
            code: blockedByEditing ? 'editing_not_confirmed' : 'reviewing_not_enabled',
            reason: blockedByEditing
              ? tx(
                'Track is off, but Overleaf Editing mode was not verified before writing. Codex did not write this file.',
                '已关闭“留痕”，但写入前没有确认 Overleaf 正在用 Editing 模式。Codex 没有写入这个文件。'
              )
              : tx(
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
      return partitionUnsafeProjectPathOperations(operations || []);
    }

    const safe = [];
    const skipped = [];
    for (const operation of operations || []) {
      const normalized = normalizeOperationProjectPaths(operation);
      const invalidPath = getInvalidOperationProjectPath(normalized);
      if (invalidPath) {
        skipped.push({
          operation: normalized,
          result: {
            ok: false,
            code: 'invalid_project_path',
            reason: tx(`Invalid ${invalidPath}. Codex did not write this file.`, `路径无效：${invalidPath}。Codex 没有写入这个文件。`)
          }
        });
      } else if (HIGH_RISK_TYPES.includes(normalized?.type)) {
        skipped.push({
          operation: normalized,
          result: {
            ok: false,
            reason: 'High-risk operation requires explicit approval before application'
          }
        });
      } else {
        safe.push(normalized);
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
      return appendOtStatusToProbeStatus(`${formatModeLabel('ask')} · ${readiness.contextLabel}`);
    }
    if (reviewingOk) {
      const status = editorWritable
        ? `${tr('canRun')} · ${readiness.contextLabel}`
        : `${formatModeLabel(state?.mode)} · ${tr('validatingEditor')}`;
      return appendOtStatusToProbeStatus(status);
    }
    if (readiness.contextReady) {
      return appendOtStatusToProbeStatus(tr('needsReviewing'));
    }
    return appendOtStatusToProbeStatus(tr('needsReviewingAndFile'));
  }

  function appendOtStatusToProbeStatus(status) {
    const base = String(status || '');
    if (!isExperimentalOtEnabled()) {
      return base;
    }
    return `${base} · OT ${formatOtStatusLabel(currentOtStatus)}`;
  }

  function updateProbeStatusOtSuffix() {
    const status = panel?.querySelector('[data-probe-status]');
    if (!status || status.dataset.refreshing === 'true') {
      return;
    }
    const text = String(status.textContent || '');
    if (!text) {
      return;
    }
    const base = text.split(' · OT ')[0];
    status.textContent = appendOtStatusToProbeStatus(base);
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
    const sanitizedProject = sanitizeRunProjectSnapshot(project);
    if (sanitizedProject?.capabilities?.fullProjectSnapshot) {
      return sanitizedProject;
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
    const sanitizedPageStateProject = sanitizeRunProjectSnapshot(pageStateProject);
    if (sanitizedPageStateProject?.capabilities?.fullProjectSnapshot) {
      return sanitizedPageStateProject;
    }
    return sanitizedProject;
  }

  function sanitizeRunProjectSnapshot(project) {
    if (!project || typeof project !== 'object') {
      return project;
    }
    const activePath = normalizeSnapshotPath(project.activePath || '');
    const files = Array.isArray(project.files) ? project.files : [];
    const filePathSet = new Set(files.map(file => normalizeSnapshotPath(file?.path || '')).filter(Boolean));
    const activePathKnown = activePath && filePathSet.has(activePath);
    if (!activePath || activePathKnown) {
      return project;
    }
    return {
      ...project,
      activePath: '',
      files: files.map(file => file?.active ? { ...file, active: false } : file),
      capabilities: {
        ...(project.capabilities || {}),
        diagnostics: {
          ...(project.capabilities?.diagnostics || {}),
          rejectedActivePath: project.activePath
        }
      }
    };
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
    const mode = options.mode || state.mode;
    const partialSnapshot = Boolean(
      snapshotWarnings.blocking?.some(warning => /Full project snapshot was not captured/i.test(warning))
    );

    if (!partialSnapshot && (mode === 'ask' || !focusFiles.length)) {
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
    const mirrorHealth = window.CodexOverleafMirrorHealth.classifyMirrorHealth(mirrorStatus);
    if (!mirrorStatus?.exists || !mirrorHealth.reusable) {
      return { useExistingMirror: false, reason: 'mirror_not_fresh', mirrorStatus };
    }

    return {
      useExistingMirror: true,
      fileOverlays,
      mirrorStatus,
      mirrorHealth,
      partialSnapshot
    };
  }

  function buildSnapshotFileOverlays(project = {}, focusFiles = [], options = {}) {
    const textFiles = (project.files || []).filter(isTextSnapshotFile);
    const focusSet = new Set((focusFiles || []).map(normalizeSnapshotPath).filter(Boolean));
    const activePath = normalizeSnapshotPath(project.activePath || '');
    const candidates = textFiles.filter(file => {
      const normalizedPath = normalizeSnapshotPath(file.path);
      if (focusFiles.length) {
        return focusSet.has(normalizedPath) || normalizedPath === activePath || file.active;
      }
      return normalizedPath === activePath || file.active || options.partialSnapshot;
    });
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
      if (!change?.path || filesByPath.has(change.path) || !syncChangeHasPreviousFile(change)) {
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

  function syncChangeHasPreviousFile(change = {}) {
    if (change.previousExists === true || change.baselineExists === true) {
      return true;
    }
    if (change.previousExists === false || change.baselineExists === false) {
      return false;
    }
    return typeof change.previousContent === 'string' && change.previousContent.length > 0;
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
    return (async () => {
      const compatibilityGate = await ensureNativeCompatibilityForMethod(payload?.method);
      if (!compatibilityGate.ok) {
        return compatibilityGate.response;
      }
      throwIfCancelledBeforeNativeDispatch(payload?.method);
      return nativeChannel.sendNative(attachNativeCompatibilityEvidence(payload, compatibilityGate.compatibility));
    })();
  }

  function sendBackgroundNative(payload) {
    return (async () => {
      const compatibilityGate = await ensureNativeCompatibilityForMethod(payload?.method);
      if (!compatibilityGate.ok) {
        return compatibilityGate.response;
      }
      throwIfCancelledBeforeNativeDispatch(payload?.method);
      return nativeChannel.sendBackgroundNative(attachNativeCompatibilityEvidence(payload, compatibilityGate.compatibility));
    })();
  }

  function throwIfCancelledBeforeNativeDispatch(method) {
    if (NATIVE_COMPATIBILITY_GATED_METHODS.has(method)) {
      throwIfRunCancellationRequested();
    }
  }

  async function ensureNativeCompatibilityForMethod(method) {
    const params = CodexOverleafCompatibility?.buildBridgePingParams
      ? CodexOverleafCompatibility.buildBridgePingParams(getExtensionCompatibilityMetadata())
      : {};
    const response = await nativeChannel.sendBackgroundNative({
      method: 'bridge.ping',
      params
    });
    const compatibility = CodexOverleafCompatibility?.evaluateNativeCompatibility
      ? CodexOverleafCompatibility.evaluateNativeCompatibility(response, getExtensionCompatibilityMetadata())
      : fallbackNativeCompatibility(response);
    const allowed = !NATIVE_COMPATIBILITY_GATED_METHODS.has(method) ||
      (CodexOverleafCompatibility?.isNativeMethodAllowed
        ? CodexOverleafCompatibility.isNativeMethodAllowed(method, compatibility)
        : compatibility.status === 'ok');
    if (allowed) {
      return { ok: true, compatibility };
    }

    const message = formatNativeCompatibilityBlockedMessage(method, compatibility);
    const error = {
      code: 'native_update_required',
      message,
      status: compatibility.status || 'unknown_native',
      classification: getNativeCompatibilityClassification(compatibility),
      installCommand: compatibility.installCommand || INSTALL_COMMAND,
      updateCommand: compatibility.updateCommand || compatibility.installCommand || INSTALL_COMMAND,
      currentNativeVersion: compatibility.currentNativeVersion || compatibility.nativeVersion || compatibility.native?.version || '',
      requiredVersion: compatibility.requiredVersion || CodexOverleafCompatibility?.BUILD_TARGET_VERSION || '',
      releaseUrl: compatibility.releaseUrl || ''
    };
    notifyNativeCompatibilityBlocked(error, compatibility);
    return {
      ok: false,
      compatibility,
      response: {
        ok: false,
        error
      }
    };
  }

  function attachNativeCompatibilityEvidence(payload = {}, compatibility) {
    if (!compatibility || !NATIVE_COMPATIBILITY_GATED_METHODS.has(payload?.method)) {
      return payload;
    }
    return {
      ...payload,
      params: {
        ...(payload.params || {}),
        nativeCompatibility: compatibility
      }
    };
  }

  function notifyNativeCompatibilityBlocked(error, compatibility = {}) {
    const message = error?.message || String(error || '');
    if (currentRunView) {
      appendRunEvent({
        title: message,
        status: 'failed'
      });
      showNativeUpdateGuidanceModal(compatibility);
    } else {
      showNativeUpdateGuidanceModal(compatibility);
      showPluginToast(message, { status: 'failed', sticky: true });
    }
  }

  async function refreshNativeCompatibilityBadge() {
    if (!panelRendererInstance?.headerEl || !CodexOverleafCompatibility?.evaluateNativeCompatibility) {
      return;
    }
    try {
      const params = CodexOverleafCompatibility.buildBridgePingParams
        ? CodexOverleafCompatibility.buildBridgePingParams(getExtensionCompatibilityMetadata())
        : {};
      const response = await sendBackgroundNative({ method: 'bridge.ping', params });
      const compatibility = CodexOverleafCompatibility.evaluateNativeCompatibility(response, getExtensionCompatibilityMetadata());
      const classification = getNativeCompatibilityClassification(compatibility);
      if (classification === 'compatible') {
        PanelRenderer.setBadge(panelRendererInstance.headerEl, { type: 'none' });
        return;
      }
      PanelRenderer.setBadge(panelRendererInstance.headerEl, {
        type: 'update',
        tooltip: tx('Native host update available', 'Native host 可更新'),
        onClick: () => showNativeUpdateGuidanceModal(compatibility)
      });
    } catch (_error) {
      PanelRenderer.setBadge(panelRendererInstance.headerEl, {
        type: 'update',
        tooltip: tx('Native host update available', 'Native host 可更新'),
        onClick: () => showNativeUpdateGuidanceModal(fallbackNativeCompatibility({ ok: false }))
      });
    }
  }

  function showNativeUpdateGuidanceModal(compatibility = {}) {
    if (!panel) {
      ensurePanelOpen();
    }
    const existing = panel.querySelector('[data-native-update-guidance]');
    existing?.remove();

    const native = compatibility.native || {};
    const extensionVersion = compatibility.extensionVersion || CodexOverleafCompatibility?.BUILD_TARGET_VERSION || '';
    const nativeVersion = compatibility.currentNativeVersion || compatibility.nativeVersion || native.version || tx('missing', '未安装');
    const command = compatibility.updateCommand || compatibility.installCommand || INSTALL_COMMAND;
    const releaseUrl = compatibility.releaseUrl || '';

    const overlay = document.createElement('div');
    overlay.className = 'codex-plugin-confirm';
    overlay.dataset.nativeUpdateGuidance = 'true';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', tx('Native host update available', 'Native host 可更新'));

    const card = document.createElement('section');
    card.className = 'codex-plugin-confirm-card';

    const title = document.createElement('div');
    title.className = 'codex-plugin-confirm-title';
    title.textContent = tx('Native host update available', 'Native host 可更新');

    const body = document.createElement('div');
    body.className = 'codex-plugin-confirm-body';
    body.textContent = [
      tx(`Extension v${extensionVersion} / Native v${nativeVersion}`, `扩展 v${extensionVersion} / Native v${nativeVersion}`),
      tx('Run the platform-specific command below, reload the extension, then refresh Overleaf.', '运行下面的平台命令，重新加载扩展，然后刷新 Overleaf。')
    ].join('\n\n');

    const commandCode = document.createElement('code');
    commandCode.textContent = command;
    commandCode.style.display = 'block';
    commandCode.style.whiteSpace = 'pre-wrap';
    commandCode.style.marginTop = '0.75rem';
    body.append(commandCode);

    if (releaseUrl) {
      const link = document.createElement('a');
      link.href = releaseUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = tx('Open GitHub Release', '打开 GitHub Release');
      link.style.display = 'block';
      link.style.marginTop = '0.75rem';
      body.append(link);
    }

    const actions = document.createElement('div');
    actions.className = 'codex-plugin-confirm-actions';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'codex-plugin-confirm-confirm';
    copy.textContent = tx('Copy command', '复制命令');
    copy.addEventListener('click', async () => {
      await navigator.clipboard.writeText(command);
      copy.textContent = tx('Copied', '已复制');
    });
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'codex-plugin-confirm-cancel';
    close.textContent = tx('Close', '关闭');
    close.addEventListener('click', () => overlay.remove());
    actions.append(close, copy);

    card.append(title, body, actions);
    overlay.append(card);
    overlay.addEventListener('click', event => {
      if (event.target === overlay) {
        overlay.remove();
      }
    });
    panel.append(overlay);
    copy.focus();
  }

  function scheduleFirstUseOnboardingTip() {
    setTimeout(() => {
      maybeShowFirstUseOnboardingTip().catch(() => {});
    }, 250);
  }

  async function maybeShowFirstUseOnboardingTip() {
    if (!panel || (state?.sessions || []).length > 0) {
      return;
    }
    const stored = await chrome.storage.local.get([ONBOARDING_TIP_STORAGE_KEY]);
    if (stored?.[ONBOARDING_TIP_STORAGE_KEY]) {
      return;
    }
    const modeSelect = panel.querySelector('[data-mode]');
    if (!modeSelect) {
      return;
    }
    const tip = document.createElement('div');
    tip.className = 'codex-onboarding-tip';
    tip.dataset.onboardingTip = 'true';
    tip.setAttribute('role', 'status');
    tip.textContent = tx(
      'Tip: Start with Ask mode to explore safely. Switch to Suggest to review edits before applying.',
      '提示：先用 Ask 模式安全探索；需要修改时切到 Suggest，应用前可先审阅。'
    );
    Object.assign(tip.style, {
      position: 'absolute',
      zIndex: '2147483647',
      maxWidth: '280px'
    });
    panel.append(tip);
    const panelRect = panel.getBoundingClientRect();
    const modeRect = modeSelect.getBoundingClientRect();
    tip.style.left = `${Math.max(12, modeRect.left - panelRect.left)}px`;
    tip.style.bottom = `${Math.max(72, panelRect.bottom - modeRect.top + 8)}px`;

    const dismiss = () => {
      tip.remove();
      chrome.storage.local.set({ [ONBOARDING_TIP_STORAGE_KEY]: true }).catch?.(() => {});
      panel.removeEventListener('click', dismiss, true);
      panel.removeEventListener('keydown', dismiss, true);
    };
    panel.addEventListener('click', dismiss, true);
    panel.addEventListener('keydown', dismiss, true);
    setTimeout(dismiss, 8000);
  }

  function formatNativeCompatibilityBlockedMessage(method, compatibility = {}) {
    const statusValue = compatibility.status || 'unknown_native';
    const params = { method: method || 'native request' };
    switch (statusValue) {
      case 'native_too_old':
        return tr('nativeCompatibilityBlockedNativeTooOld', params);
      case 'extension_too_old':
        return tr('nativeCompatibilityBlockedExtensionTooOld', params);
      case 'protocol_unsupported':
        return tr('nativeCompatibilityBlockedProtocol', params);
      case 'native_unhealthy':
        return tr('nativeCompatibilityBlockedUnhealthy', params);
      case 'native_missing':
        return tr('nativeCompatibilityBlockedMissing', params);
      default:
        return tr('nativeCompatibilityBlockedGeneric', params);
    }
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
    const timeoutMs = getPageBridgeTimeoutMs(method);
    return sendPageBridgeRequest(method, params, {
      timeoutMs
    });
  }

  function sendPageBridgeRequest(method, params, options = {}) {
    const id = crypto.randomUUID();
    return new Promise(resolve => {
      const timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : 8000;
      const timeout = window.setTimeout(() => {
        window.removeEventListener('message', onMessage);
        resolve({ ok: false, error: 'Page bridge timed out' });
      }, timeoutMs);

      function onMessage(event) {
        if (event.source !== window
          || event.origin !== window.location.origin
          || event.data?.source !== 'codex-overleaf/page'
          || event.data?.pageBridgeVersion !== CodexOverleafCompatibility?.BUILD_TARGET_VERSION
          || event.data?.pageBridgeRevision !== PAGE_BRIDGE_SCRIPT_REVISION
          || event.data.id !== id) {
          return;
        }
        window.clearTimeout(timeout);
        window.removeEventListener('message', onMessage);
        resolve(event.data.result);
      }

      window.addEventListener('message', onMessage);
      // This capability narrows accidental/spoofed page-bridge calls. It is not
      // a secret from malicious same-page Overleaf scripts because postMessage
      // traffic is page-visible.
      window.postMessage({
        source: 'codex-overleaf/content',
        id,
        method,
        params,
        capability: PAGE_BRIDGE_CAPABILITY
      }, window.location.origin);
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
      return COMPILE_PAGE_BRIDGE_TIMEOUT_MS;
    }
    if (method === 'rejectTrackedChanges') {
      return 120000;
    }
    return 8000;
  }

  async function injectPageBridge() {
    await injectScriptOnce('src/shared/reviewing.js', 'codex-overleaf-reviewing-script');
    await injectScriptOnce('src/shared/projectFiles.js', 'codex-overleaf-project-files-script');
    await injectScriptOnce('src/shared/compatibility.js', 'codex-overleaf-compatibility-page-script');
    await injectScriptOnce('src/shared/staleGuard.js', 'codex-overleaf-stale-guard-script');
    await injectScriptOnce('src/shared/compileAdapter.js', 'codex-overleaf-compile-adapter-script');
    await injectScriptOnce('src/shared/governanceRules.js', 'codex-overleaf-governance-rules-script');
    await injectScriptOnce('src/shared/sensitiveScan.js', 'codex-overleaf-sensitive-scan-script');
    await injectScriptOnce('src/shared/auditRecords.js', 'codex-overleaf-audit-records-script');
    await injectScriptOnce('src/page/overleafCapabilities.js', 'codex-overleaf-capabilities-script');
    await injectScriptOnce('src/page/compileBridge.js', 'codex-overleaf-compile-bridge-script');
    await injectScriptOnce('src/page/overleafEditor.js', 'codex-overleaf-editor-script');
    await injectScriptOnce('src/page/overleafProjectSnapshot.js', 'codex-overleaf-project-snapshot-script');
    await injectOptionalOtDependencies();
    await injectScriptOnce('src/page/pageBridgeCapability.js', 'codex-overleaf-page-bridge-capability-script');
    await injectScriptOnce('src/page/treeOperations.js', 'codex-overleaf-tree-operations-script', { force: true });
    await injectScriptOnce('src/page/snapshotRouter.js', 'codex-overleaf-snapshot-router-script');
    await injectScriptOnce('src/page/writebackRouter.js', 'codex-overleaf-writeback-router-script', { force: true });
    await injectScriptOnce('src/pageBridge.js', 'codex-overleaf-page-bridge-script', { force: true });
    await initializePageBridgeCapability();
  }

  async function injectOptionalOtDependencies() {
    try {
      await injectScriptOnce('src/shared/otText.js', 'codex-overleaf-ot-text-script');
      await injectScriptOnce('src/page/overleafRealtimeObserver.js', 'codex-overleaf-realtime-observer-script');
    } catch (_error) {
      // The page bridge has a read-only unavailable fallback for these optional OT helpers.
    }
  }

  function injectScriptOnce(src, id, options = {}) {
    return new Promise((resolve, reject) => {
      const existing = document.getElementById(id);
      if (existing && options.force !== true) {
        resolve();
        return;
      }
      existing?.remove?.();
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

  async function initializePageBridgeCapability() {
    const result = await sendPageBridgeRequest('initializeCapability', {}, {
      timeoutMs: 8000
    });
    if (!result?.ok) {
      throw new Error(result?.error || result?.reason || 'Page bridge capability initialization failed');
    }
  }

  function createPageBridgeCapability() {
    if (crypto?.randomUUID) {
      return crypto.randomUUID();
    }
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
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
        speedTier: prefs.speedTier || '',
        mode: prefs.mode || '',
        locale: prefs.locale || '',
        requireReviewing: prefs.requireReviewing !== false,
        autoRecompile: prefs.autoRecompile !== false,
        loadCodexLocalSkills: prefs.loadCodexLocalSkills !== false,
        loadCodexOverleafSkills: prefs.loadCodexOverleafSkills !== false,
        experimentalOtByProject: prefs.experimentalOtByProject || {},
        customInstructionsByProject: prefs.customInstructionsByProject || {},
        governanceRulesByProject: normalizeGovernanceRulesByProject(prefs.governanceRulesByProject),
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
          speedTier: session.speedTier || prefs.speedTier || 'standard',
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
      compactState.autoRecompile = state.autoRecompile;
      compactState.loadCodexLocalSkills = state.loadCodexLocalSkills !== false;
      compactState.loadCodexOverleafSkills = state.loadCodexOverleafSkills !== false;
      compactState.experimentalOtByProject = state.experimentalOtByProject;
      compactState.customInstructionsByProject = state.customInstructionsByProject;
      compactState.governanceRulesByProject = state.governanceRulesByProject;

      // Save lightweight prefs to chrome.storage.local
      const latestPrefs = typeof Migration.loadPrefs === 'function'
        ? await Migration.loadPrefs()
        : {};
      const prefsFromState = StorageDb.extractLightweightPrefs(compactState, projectId);
      const prefs = {
        ...(latestPrefs && typeof latestPrefs === 'object' ? latestPrefs : {}),
        ...prefsFromState
      };
      prefs.activeSessionByProject = StorageDb.buildActiveSessionByProject(
        latestPrefs?.activeSessionByProject || {},
        projectId,
        compactState.activeSessionId || state.activeSessionId || ''
      );
      prefs.experimentalOtByProject = {
        ...(latestPrefs?.experimentalOtByProject || {}),
        [projectId]: normalizeExperimentalOtByProject(state?.experimentalOtByProject)[projectId] === true
      };
      const normalizedGovernanceByProject = typeof normalizeGovernanceRulesByProject === 'function'
        ? normalizeGovernanceRulesByProject(state?.governanceRulesByProject)
        : (state?.governanceRulesByProject || {});
      prefs.governanceRulesByProject = {
        ...(latestPrefs?.governanceRulesByProject || {}),
        ...normalizedGovernanceByProject
      };
      const normalizedCustomProject = normalizeCustomInstructionsByProject({ [projectId]: '' });
      const normalizedCustomProjectId = Object.keys(normalizedCustomProject)[0] || '';
      const currentCustomInstructions = normalizeCustomInstructionsByProject(state?.customInstructionsByProject);
      prefs.customInstructionsByProject = {
        ...(latestPrefs?.customInstructionsByProject || {})
      };
      if (normalizedCustomProjectId) {
        prefs.customInstructionsByProject[normalizedCustomProjectId] =
          Object.prototype.hasOwnProperty.call(currentCustomInstructions, normalizedCustomProjectId)
            ? currentCustomInstructions[normalizedCustomProjectId]
            : '';
      }
      await Migration.savePrefs(prefs);

      // Save all displayable session state to IndexedDB. The panel history lives here;
      // chrome.storage.local only keeps small pointers/preferences.
      const sessionRecords = (state.sessions || []).map(session => (
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
        if (typeof appendStorageNoticeOnce === 'function') {
          appendStorageNoticeOnce('save-failed', tx(`Failed to save session state: ${error.message}`, `保存会话状态失败：${error.message}`));
        } else {
          throw fallbackError;
        }
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
    renderSpeedOptions(getRenderedModelEntries());
    renderModelConfigChoices();
    updateModelDisplay();
    await saveState();
    syncModeControls();
    applySessionLabel();
    renderSessionList();
  }

  function getRenderedModelEntries() {
    return Array.from(panel?.querySelector('[data-model]')?.options || []).map(option => ({
      id: option.value,
      label: option.textContent,
      speedTiers: (option.dataset.speedTiers || 'standard').split(',').filter(Boolean),
      defaultSpeedTier: option.dataset.defaultSpeedTier || 'standard'
    }));
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
    const projectId = getCurrentProjectId();
    if (lastExperimentalOtProjectId !== projectId) {
      syncExperimentalOtToggleForProject(projectId);
    }
    state = updateActiveSession(state, {
      model: readSelectedModelInput(),
      reasoningEffort: panel.querySelector('[data-reasoning]').value,
      speedTier: readSelectedSpeedInput(),
      mode: panel.querySelector('[data-mode]').value,
      task: panel.querySelector('[data-task]').value,
      requireReviewing: panel.querySelector('[data-require-reviewing]').checked
    });
    state.autoRecompile = panel.querySelector('[data-auto-recompile]')?.checked !== false;
    const experimentalOtCheckbox = panel.querySelector('[data-experimental-ot]');
    if (experimentalOtCheckbox) {
      setExperimentalOtEnabledForProject(projectId, experimentalOtCheckbox.checked);
    }
    if (panel?.querySelector('[data-project-settings-panel]')?.hidden === false) {
      setGovernanceRulesForCurrentProject(readGovernanceRulesFromSettings());
      setSkillLoadingSettings(readSkillLoadingSettingsFromSettings());
    }
  }

  function readSelectedModelInput() {
    const modelSelect = panel?.querySelector('[data-model]');
    return modelSelect?.value || state?.model || '';
  }

  function readSelectedSpeedInput() {
    const speedSelect = panel?.querySelector('[data-speed]');
    return speedSelect?.value || state?.speedTier || 'standard';
  }

  async function loadModelOptions() {
    const selectedModel = resolveSelectedModel();
    const modelCatalog = getModelCatalog();
    const fallbackModels = modelCatalog.FALLBACK_MODELS;

    try {
      const response = await sendBackgroundNative({
        method: 'codex.models',
        params: {}
      });
      const currentSelectedModel = resolveSelectedModel() || selectedModel;
      const hasDiscoveredModels = response?.ok
        && Array.isArray(response.result?.models)
        && response.result.models.length > 0;
      const sourceModels = hasDiscoveredModels ? response.result.models : fallbackModels;
      const normalized = modelCatalog.normalizeDiscoveredModels({ models: sourceModels, selectedModel: currentSelectedModel });
      renderModelOptions(normalized.models, currentSelectedModel);
      modelDiscovery = {
        status: hasDiscoveredModels && !normalized.usedFallback ? 'discovered' : 'fallback',
        source: hasDiscoveredModels ? response.result?.source || 'unknown' : 'fallback',
        fetchedAt: hasDiscoveredModels ? response.result?.fetchedAt || '' : '',
        errorCode: hasDiscoveredModels ? '' : response?.error?.code || '',
        errorMessage: hasDiscoveredModels ? '' : response?.error?.message || ''
      };
      updateModelDisplay();
    } catch (error) {
      applyFallbackModelOptions(resolveSelectedModel() || selectedModel, error);
    }
  }

  function applyFallbackModelOptions(selectedModel, error) {
    const modelCatalog = getModelCatalog();
    const fallbackModels = modelCatalog.FALLBACK_MODELS;
    const sourceModels = fallbackModels;
    const normalized = modelCatalog.normalizeDiscoveredModels({ models: sourceModels, selectedModel });
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

  function getModelCatalog() {
    const shared = window.CodexOverleafModels;
    if (Array.isArray(shared?.FALLBACK_MODELS) && typeof shared?.normalizeDiscoveredModels === 'function') {
      return shared;
    }

    return {
      FALLBACK_MODELS: buildDomModelCatalogFallback(),
      normalizeDiscoveredModels: normalizeDiscoveredModelsFallback
    };
  }

  function buildDomModelCatalogFallback() {
    const modelSelect = panel?.querySelector('[data-model]');
    const domModels = Array.from(modelSelect?.options || [])
      .map(option => ({
        id: normalizeModelOptionId(option.value),
        label: option.textContent || option.value
      }))
      .filter(model => model.id);

    return domModels.length ? domModels : [
      { id: 'gpt-5.5', label: 'GPT-5.5' },
      { id: 'gpt-5.4', label: 'GPT-5.4' },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' },
      { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
      { id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark' },
      { id: 'gpt-5.2', label: 'GPT-5.2' }
    ];
  }

  function normalizeDiscoveredModelsFallback({ models, selectedModel } = {}) {
    const normalized = normalizeModelCatalogEntries(models);
    const usedFallback = normalized.length === 0;
    const resultModels = usedFallback ? buildDomModelCatalogFallback().map(model => ({ ...model })) : normalized;
    const selectedId = normalizeModelOptionId(selectedModel);

    if (selectedId && !resultModels.some(model => model.id === selectedId)) {
      resultModels.push({
        id: selectedId,
        label: `${selectedId} (custom)`,
        unverified: true
      });
    }

    return {
      models: resultModels,
      usedFallback
    };
  }

  function normalizeModelCatalogEntries(models) {
    if (!Array.isArray(models)) {
      return [];
    }

    const seen = new Set();
    const result = [];

    for (const model of models) {
      const id = normalizeModelOptionId(typeof model === 'string' ? model : model?.id);
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      const normalized = {
        id,
        label: typeof model?.label === 'string' && model.label.length > 0 ? model.label : id,
        reasoningEfforts: Array.isArray(model?.reasoningEfforts) ? model.reasoningEfforts.slice() : [],
        speedTiers: normalizeSpeedTiersForSelect(model?.speedTiers)
      };
      if (Object.prototype.hasOwnProperty.call(Object(model), 'defaultReasoningEffort')) {
        normalized.defaultReasoningEffort = model.defaultReasoningEffort;
      }
      if (Object.prototype.hasOwnProperty.call(Object(model), 'defaultSpeedTier')) {
        normalized.defaultSpeedTier = model.defaultSpeedTier;
      }
      result.push(normalized);
    }

    return result;
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
      option.dataset.speedTiers = normalizeSpeedTiersForSelect(model.speedTiers).join(',');
      option.dataset.defaultSpeedTier = model.defaultSpeedTier || 'standard';
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
      option.dataset.speedTiers = 'standard';
      option.dataset.defaultSpeedTier = 'standard';
      option.dataset.unverified = 'true';
      modelSelect.append(option);
      renderedSelected = true;
    }

    if (selectedId && renderedSelected) {
      modelSelect.value = selectedId;
    } else if (firstModelId) {
      modelSelect.value = firstModelId;
    }
    renderSpeedOptions(models);
    renderModelConfigChoices();
    updateModelDisplay();
  }

  function renderSpeedOptions(models) {
    const speedSelect = panel?.querySelector('[data-speed]');
    const modelSelect = panel?.querySelector('[data-model]');
    if (!speedSelect || !modelSelect) {
      return;
    }

    const selectedModel = normalizeModelOptionId(modelSelect.value);
    const model = (Array.isArray(models) ? models : []).find(item => normalizeModelOptionId(item?.id) === selectedModel);
    const speedTiers = normalizeSpeedTiersForSelect(model?.speedTiers);
    const selectedSpeed = speedTiers.includes(state?.speedTier) ? state.speedTier : (model?.defaultSpeedTier || 'standard');
    speedSelect.textContent = '';
    for (const tier of speedTiers) {
      const option = document.createElement('option');
      option.value = tier;
      option.textContent = formatSpeedTierLabel(tier);
      speedSelect.append(option);
    }
    speedSelect.value = speedTiers.includes(selectedSpeed) ? selectedSpeed : 'standard';
    speedSelect.disabled = speedTiers.length <= 1;
    speedSelect.title = speedSelect.disabled
      ? tx('Fast mode is not available for this model.', '当前模型不支持 Fast 模式。')
      : tx('Codex speed tier. Fast mode uses extra credits.', 'Codex 速度档；Fast 会消耗额外 credits。');
    renderModelConfigChoices();
  }

  function renderModelConfigChoices() {
    renderReasoningChoices();
    renderModelChoices();
    renderSpeedChoices();
    syncModelConfigChoices();
  }

  function renderReasoningChoices() {
    const list = panel?.querySelector('[data-reasoning-choice-list]');
    const reasoningSelect = panel?.querySelector('[data-reasoning]');
    if (!list || !reasoningSelect) {
      return;
    }
    list.textContent = '';
    for (const option of Array.from(reasoningSelect.options || [])) {
      list.append(createModelConfigChoice({
        value: option.value,
        label: formatReasoningEffortLabel(option.value),
        datasetName: 'reasoningChoice'
      }));
    }
  }

  function renderModelChoices() {
    const list = panel?.querySelector('[data-model-choice-list]');
    const modelSelect = panel?.querySelector('[data-model]');
    if (!list || !modelSelect) {
      return;
    }
    list.textContent = '';
    for (const option of Array.from(modelSelect.options || [])) {
      const choice = createModelConfigChoice({
        value: option.value,
        label: option.textContent || option.value,
        datasetName: 'modelChoice'
      });
      choice.title = option.textContent || option.value;
      list.append(choice);
    }
  }

  function renderSpeedChoices() {
    const list = panel?.querySelector('[data-speed-choice-list]');
    const speedSelect = panel?.querySelector('[data-speed]');
    if (!list || !speedSelect) {
      return;
    }
    list.textContent = '';
    for (const option of Array.from(speedSelect.options || [])) {
      const choice = createModelConfigChoice({
        value: option.value,
        label: formatSpeedTierLabel(option.value),
        datasetName: 'speedChoice'
      });
      choice.disabled = speedSelect.disabled && speedSelect.options.length <= 1;
      list.append(choice);
    }
  }

  function createModelConfigChoice({ value, label, datasetName }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'codex-model-config-choice';
    button.dataset[datasetName] = value;
    button.setAttribute('role', 'menuitemradio');
    button.setAttribute('aria-checked', 'false');

    const text = document.createElement('span');
    text.className = 'codex-model-config-choice-label';
    text.textContent = label;
    button.append(text);

    const check = document.createElement('span');
    check.className = 'codex-model-config-check';
    check.textContent = '✓';
    check.setAttribute('aria-hidden', 'true');
    button.append(check);
    return button;
  }

  function syncModelConfigChoices() {
    const selectedModel = panel?.querySelector('[data-model]')?.value || '';
    const selectedReasoning = panel?.querySelector('[data-reasoning]')?.value || '';
    const selectedSpeed = panel?.querySelector('[data-speed]')?.value || 'standard';
    syncChoiceGroup('[data-model-choice]', selectedModel);
    syncChoiceGroup('[data-reasoning-choice]', selectedReasoning);
    syncChoiceGroup('[data-speed-choice]', selectedSpeed);
  }

  function syncChoiceGroup(selector, selectedValue) {
    for (const button of panel?.querySelectorAll(selector) || []) {
      const value = button.dataset.modelChoice || button.dataset.reasoningChoice || button.dataset.speedChoice || '';
      const active = value === selectedValue;
      button.dataset.active = active ? 'true' : 'false';
      button.setAttribute('aria-checked', active ? 'true' : 'false');
    }
  }

  function normalizeSpeedTiersForSelect(speedTiers) {
    const tiers = Array.isArray(speedTiers)
      ? speedTiers.map(tier => normalizeModelOptionId(tier)).filter(Boolean)
      : ['standard'];
    return tiers.includes('standard') ? tiers : ['standard', ...tiers];
  }

  function formatSpeedTierLabel(tier) {
    return tier === 'fast' ? tx('Fast', '快速') : tx('Standard', '标准');
  }

  function formatReasoningEffortLabel(effort) {
    const labels = getLocale() === 'zh'
      ? { low: '低', medium: '中', high: '高', xhigh: '超高' }
      : { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh' };
    return labels[effort] || effort || '';
  }

  function formatCompactModelLabel(label) {
    return String(label || '').replace(/^gpt[-\s]*/i, '');
  }

  function resolveSelectedModel() {
    return panel?.querySelector('[data-model]')?.value || state?.model || '';
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
    const reasoningDisplay = panel?.querySelector('[data-reasoning-display]');
    const speedIndicator = panel?.querySelector('[data-speed-indicator]');
    const configButton = panel?.querySelector('[data-model-config-toggle]');
    if (!modelSelect || !modelDisplay) {
      return;
    }
    const fullLabel = modelSelect.options[modelSelect.selectedIndex]?.textContent || modelSelect.value;
    modelDisplay.textContent = formatCompactModelLabel(fullLabel);
    const sourceTitle = tr('modelDisplayTitle', {
      label: fullLabel,
      source: getModelDiscoverySourceLabel()
    });
    modelDisplay.title = sourceTitle;
    if (reasoningDisplay) {
      reasoningDisplay.textContent = formatReasoningEffortLabel(panel?.querySelector('[data-reasoning]')?.value || state?.reasoningEffort || '');
    }
    if (speedIndicator) {
      speedIndicator.hidden = readSelectedSpeedInput() !== 'fast';
    }
    if (configButton) {
      configButton.title = [
        sourceTitle,
        reasoningDisplay?.textContent ? `${tx('Reasoning', '推理')}: ${reasoningDisplay.textContent}` : '',
        readSelectedSpeedInput() === 'fast' ? tx('Fast mode', '快速模式') : tx('Standard speed', '标准速度')
      ].filter(Boolean).join(' · ');
    }
  }

  function clearTaskComposer() {
    const taskInput = panel?.querySelector('[data-task]');
    if (taskInput) {
      taskInput.value = '';
    }
    composerAttachmentController.clear();
    composerSkillInvocation = null;
    renderComposerSkillInvocation();
    state = updateActiveSession(state, { task: '' });
    saveStateSoon();
  }

  function applyStateToPanel() {
    if (!modelSelectHasOption(state.model)) {
      renderModelOptions(getModelCatalog().FALLBACK_MODELS, state.model);
    }
    panel.querySelector('[data-model]').value = state.model;
    panel.querySelector('[data-reasoning]').value = state.reasoningEffort;
    renderSpeedOptions(Array.from(panel.querySelector('[data-model]')?.options || []).map(option => ({
      id: option.value,
      label: option.textContent,
      speedTiers: (option.dataset.speedTiers || 'standard').split(',').filter(Boolean),
      defaultSpeedTier: option.dataset.defaultSpeedTier || 'standard'
    })));
    panel.querySelector('[data-speed]').value = state.speedTier;
    panel.querySelector('[data-mode]').value = state.mode;
    panel.querySelector('[data-task]').value = state.task;
    panel.querySelector('[data-require-reviewing]').checked = state.requireReviewing;
    const recompileCheckbox = panel?.querySelector('[data-auto-recompile]');
    if (recompileCheckbox) {
      recompileCheckbox.checked = state.autoRecompile !== false;
    }
    syncExperimentalOtToggleForProject();
    syncCustomInstructionsEditorForProject();
    if (typeof syncProjectSettingsEditorForProject === 'function') {
      syncProjectSettingsEditorForProject();
    }
    applyPanelWidth(state.panelWidth || PANEL_DEFAULT_WIDTH, { persist: false });
    renderModelConfigChoices();
    updateModelDisplay();
    syncModeControls();
    applySessionLabel();
    renderSessionList();
    renderRunHistory();
    renderContextSelection();
    renderContextSummary();
    renderComposerAttachments();
    renderComposerSkillInvocation();
    applyLocaleToPanel();
    if (!panel.querySelector('[data-context-tray]')?.hidden) {
      renderContextFiles();
    }
  }

  function modelSelectHasOption(modelId) {
    const selectedId = normalizeModelOptionId(modelId);
    if (!selectedId) {
      return true;
    }
    const modelSelect = panel?.querySelector('[data-model]');
    return Array.from(modelSelect?.options || []).some(option => option.value === selectedId);
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
      speedTier: state.speedTier,
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

  function startRunView({ task, mode, model, reasoningEffort, speedTier }) {
    let attachments = [];
    if (Array.isArray(arguments[0]?.attachments)) {
      attachments = arguments[0].attachments;
    }
    logAutoFollow = true;
    userScrollIntentUntil = 0;
    const record = {
      id: createRunId(),
      task,
      mode,
      model,
      reasoningEffort,
      speedTier,
      status: 'running',
      statusText: tr('processing', { elapsed: '' }).trim(),
      startedAt: new Date().toISOString(),
      finishedAt: '',
      attachments: createRunAttachmentSnapshots(attachments),
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
      projectFiles: captureProjectReferenceFiles(arguments[0]?.project),
      startedAt: Date.now()
    };
  }

  function finishRunView(text, status) {
    if (!currentRunView) {
      return;
    }
    const safeText = sanitizeAssistantVisibleText(text);
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
        safeText,
        record?.mode ? `${tr('mode')}: ${formatModeLabel(record.mode)}` : '',
        record?.model,
        record?.reasoningEffort,
        record?.speedTier
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
    const safeTitle = sanitizeAssistantVisibleText(title) || 'Event';
    if (!currentRunView?.events) {
      appendPlainLog(safeTitle);
      return;
    }

    const event = {
      title: safeTitle,
      status: sanitizeAssistantVisibleText(status) || 'info',
      detail: sanitizeAssistantVisibleValue(detail),
      timestamp: timestamp || new Date().toISOString(),
      kind: input.kind || 'activity',
      technicalDetail: sanitizeAssistantVisibleValue(input.technicalDetail),
      streamKey: sanitizeAssistantVisibleText(input.streamKey),
      streamRole: sanitizeAssistantVisibleText(input.streamRole),
      appendText: typeof input.appendText === 'string' ? sanitizeAssistantVisibleText(input.appendText) : input.appendText,
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
      const nextTitle = sanitizeAssistantVisibleText(event.title);
      existing.title = event.replaceText
        ? nextTitle
        : sanitizeAssistantVisibleText(appendStreamText(existing.title, nextTitle));
      existing.status = sanitizeAssistantVisibleText(event.status) || existing.status || 'running';
      existing.timestamp = event.timestamp || existing.timestamp;
      existing.streamRole = sanitizeAssistantVisibleText(event.streamRole) || existing.streamRole;
      return existing;
    }

    const next = {
      ...event,
      streamKey,
      title: sanitizeAssistantVisibleText(event.title)
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
    SessionPanel.update(sessionPanelInstance, state?.sessions || [], state?.activeSessionId || null, {
      showAll,
      pinnedSessionIds: getRunningSessionIds()
    });
  }

  function getSessionDisplayTitle(session) {
    return SessionPanel.getDisplayTitle(sessionPanelInstance, session);
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





  function applyPanelWidth(width, options = {}) {
    const nextWidth = PanelRenderer.setWidth(panelRendererInstance, width, { notify: false });
    if (state) {
      state.panelWidth = nextWidth;
    }
    if (options.persist !== false) {
      saveStateSoon();
    }
    return nextWidth;
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
      run.speedTier,
      run.startedAt ? formatEventTime(run.startedAt) : ''
    ].filter(Boolean).join(' · ');
    root.innerHTML = `
      <div class="transcript-turn-main">
        <div class="run-attachments codex-attachment-preview-list" data-run-attachments hidden></div>
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

    renderAttachmentPreviewList(run.attachments, root.querySelector('[data-run-attachments]'), { readonly: true });
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
    return renderActivityLine(sanitizeRunEventForRender(event));
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

  function renderStreamEvent(input) {
    const event = sanitizeRunEventForRender(input);
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

  function sanitizeRunEventForRender(event = {}) {
    return {
      ...event,
      title: sanitizeAssistantVisibleText(event.title),
      status: sanitizeAssistantVisibleText(event.status),
      detail: sanitizeAssistantVisibleValue(event.detail),
      technicalDetail: sanitizeAssistantVisibleValue(event.technicalDetail),
      streamKey: sanitizeAssistantVisibleText(event.streamKey),
      streamRole: sanitizeAssistantVisibleText(event.streamRole)
    };
  }

  function getCurrentProjectReferenceFiles() {
    const files = [];
    const seen = new Set();
    const addFile = (item, textPathOnly = false) => {
      if (typeof item === 'string') {
        addReferenceFile({ path: item, kind: 'text' });
        return;
      }
      if (!item || typeof item !== 'object') {
        return;
      }
      const path = typeof item.path === 'string'
        ? item.path
        : (typeof item.filePath === 'string' ? item.filePath : '');
      if (!path) {
        return;
      }
      const isBinary = item.kind === 'binary'
        || item.type === 'binary'
        || item.binary === true
        || item.isBinary === true;
      const kind = isBinary
        ? 'binary'
        : (item.kind === 'text' || textPathOnly || typeof item.content === 'string' || !Object.prototype.hasOwnProperty.call(item, 'content')
          ? 'text'
          : 'binary');
      addReferenceFile({ path, kind });
    };
    const addReferenceFile = file => {
      const normalizedPath = normalizeReferencePathForRuntime(file.path);
      if (!normalizedPath || seen.has(normalizedPath) || hasUnsafeRuntimePathSegments(normalizedPath)) {
        return;
      }
      seen.add(normalizedPath);
      files.push({
        path: normalizedPath,
        kind: file.kind === 'binary' ? 'binary' : 'text'
      });
    };
    const addFiles = value => {
      if (Array.isArray(value)) {
        value.forEach(item => addFile(item));
      }
    };
    const addTextPaths = value => {
      if (Array.isArray(value)) {
        value.forEach(item => addFile(item, true));
      }
    };

    addFiles(currentRunView?.projectFiles);
    addFiles(currentRunView?.files);
    addFiles(currentRunView?.project?.files);
    addFiles(currentRunView?.snapshot?.files);
    addFiles(currentRunView?.projectSnapshot?.files);
    addFiles(currentRunView?.contextFiles);
    addFiles(state?.projectFiles);
    addFiles(state?.files);
    addFiles(state?.project?.files);
    addFiles(state?.snapshot?.files);
    addFiles(state?.projectSnapshot?.files);
    addFiles(state?.contextFiles);
    addTextPaths(state?.focusFiles);
    addTextPaths(state?.session?.focusFiles);
    const activeSession = typeof getActiveSession === 'function' ? getActiveSession(state) : null;
    addTextPaths(activeSession?.focusFiles);
    for (const session of Array.isArray(state?.sessions) ? state.sessions : []) {
      addTextPaths(session?.focusFiles);
    }
    return files;
  }

  function captureProjectReferenceFiles(project) {
    const result = [];
    const seen = new Set();
    const files = Array.isArray(project?.files) ? project.files : [];
    for (const file of files) {
      const path = normalizeReferencePathForRuntime(file?.path);
      if (!path || seen.has(path) || hasUnsafeRuntimePathSegments(path)) {
        continue;
      }
      seen.add(path);
      const isBinary = file?.kind === 'binary'
        || file?.type === 'binary'
        || file?.binary === true
        || file?.isBinary === true;
      result.push({
        path,
        kind: isBinary ? 'binary' : 'text'
      });
    }
    return result;
  }

  function renderMarkdownInlineText(target, value) {
    target.replaceChildren(...buildMarkdownInlineNodes(value));
  }

  function sanitizeAssistantVisibleText(value) {
    if (typeof value !== 'string' || !value) {
      return '';
    }
    if (LineReferences?.sanitizeLocalReferences) {
      try {
        return LineReferences.sanitizeLocalReferences(value, {
          projectFiles: getCurrentProjectReferenceFiles(),
          context: 'render'
        });
      } catch (_error) {
        return fallbackSanitizeLocalReferences(value);
      }
    }
    return fallbackSanitizeLocalReferences(value);
  }

  function sanitizeAssistantVisibleValue(value, depth = 0) {
    if (typeof value === 'string') {
      return sanitizeAssistantVisibleText(value);
    }
    if (value === undefined || value === null || typeof value === 'number' || typeof value === 'boolean') {
      return value;
    }
    if (depth > 12) {
      return '[redacted nested value]';
    }
    if (Array.isArray(value)) {
      return value.map(item => sanitizeAssistantVisibleValue(item, depth + 1));
    }
    if (typeof value === 'object') {
      const result = {};
      for (const key of Object.keys(value)) {
        const safeKey = sanitizeAssistantVisibleText(key) || key;
        result[safeKey] = sanitizeAssistantVisibleValue(value[key], depth + 1);
      }
      return result;
    }
    return value;
  }

  function buildMarkdownInlineNodes(value) {
    const source = String(value || '');
    const nodes = [];
    let index = 0;

    while (index < source.length) {
      const next = findNextInlineMarkdown(source, index);
      if (!next) {
        nodes.push(...buildLineReferenceInlineNodes(source.slice(index)));
        break;
      }

      if (next.start > index) {
        nodes.push(...buildLineReferenceInlineNodes(source.slice(index, next.start)));
      }

      if (next.type === 'strong') {
        const strong = document.createElement('strong');
        strong.append(...buildMarkdownInlineNodes(next.text));
        nodes.push(strong);
      } else if (next.type === 'code') {
        nodes.push(...buildInlineCodeNodes(next.text));
      } else if (next.type === 'link') {
        nodes.push(...buildMarkdownLinkNodes(next.text, next.href));
      }

      index = next.end;
    }

    return nodes;
  }

  function buildInlineCodeNodes(value) {
    const source = String(value || '');
    const trimmed = source.trim();
    const refs = trimmed ? parseRuntimeLineReferences(trimmed, 'plain-text-token') : [];
    const ref = refs.length === 1 && refs[0]?.rawText === trimmed ? refs[0] : null;
    if (ref && !isRuntimeLocalPathLike(ref.rawPath)) {
      const resolved = resolveRuntimeLineReference(ref);
      if (resolved) {
        return [createLineReferenceButton(resolved)];
      }
    }
    const code = document.createElement('code');
    code.textContent = sanitizeAssistantVisibleText(source);
    return [code];
  }

  function buildLineReferenceInlineNodes(value) {
    const source = String(value || '');
    if (!source) {
      return [];
    }
    const refs = parseRuntimeLineReferences(source, 'plain-text-token');
    if (!refs.length) {
      return [document.createTextNode(sanitizeAssistantVisibleText(source))];
    }
    const nodes = [];
    let cursor = 0;
    for (const ref of refs) {
      const rawText = String(ref.rawText || '');
      if (!rawText) {
        continue;
      }
      const start = source.indexOf(rawText, cursor);
      if (start < cursor) {
        continue;
      }
      appendSanitizedTextNode(nodes, source.slice(cursor, start));
      const resolved = resolveRuntimeLineReference(ref);
      if (resolved) {
        nodes.push(createLineReferenceButton(resolved));
      } else {
        appendSanitizedTextNode(nodes, rawText);
      }
      cursor = start + rawText.length;
    }
    appendSanitizedTextNode(nodes, source.slice(cursor));
    return nodes;
  }

  function buildMarkdownLinkNodes(text, href) {
    const target = String(href || '').trim();
    if (isHttpMarkdownHref(target)) {
      const link = document.createElement('a');
      link.href = formatMarkdownHref(target);
      link.textContent = formatHttpMarkdownLinkLabel(text);
      link.title = link.href;
      link.target = '_blank';
      link.rel = 'noreferrer';
      return [link];
    }

    const resolved = resolveMarkdownLineReference(text, target);
    if (resolved) {
      return [createLineReferenceButton(resolved)];
    }

    return [document.createTextNode(sanitizeAssistantVisibleText(text))];
  }

  function formatHttpMarkdownLinkLabel(text) {
    const label = sanitizeAssistantVisibleText(text).trim();
    return label || 'link';
  }

  function appendSanitizedTextNode(nodes, value) {
    const text = sanitizeAssistantVisibleText(value);
    if (text) {
      nodes.push(document.createTextNode(text));
    }
  }

  function resolveMarkdownLineReference(text, href) {
    const candidates = [
      { value: href, mode: 'markdown-link-target' },
      { value: text, mode: 'markdown-link-label' }
    ];
    for (const candidate of candidates) {
      for (const ref of parseRuntimeLineReferences(candidate.value, candidate.mode)) {
        const resolved = resolveRuntimeLineReference(ref);
        if (resolved) {
          return resolved;
        }
      }
    }
    return null;
  }

  function isRuntimeLocalPathLike(value) {
    if (LineReferences?.isLocalPathLike) {
      try {
        return LineReferences.isLocalPathLike(value);
      } catch (_error) {
        return true;
      }
    }
    return fallbackLooksLikeLocalPath(value);
  }

  function parseRuntimeLineReferences(text, mode) {
    if (!LineReferences?.parseLineReferencesFromText) {
      return [];
    }
    try {
      return LineReferences.parseLineReferencesFromText({ text: String(text || ''), mode }) || [];
    } catch (_error) {
      return [];
    }
  }

  function resolveRuntimeLineReference(ref) {
    if (!LineReferences?.resolveProjectReference) {
      return null;
    }
    const line = Number(ref?.line);
    const column = ref?.column === null || ref?.column === undefined || ref?.column === ''
      ? null
      : Number(ref.column);
    if (!Number.isSafeInteger(line) || line < 1 || (column !== null && (!Number.isSafeInteger(column) || column < 1))) {
      return null;
    }
    let resolved;
    try {
      resolved = LineReferences.resolveProjectReference({
        rawPath: ref.rawPath,
        projectFiles: getCurrentProjectReferenceFiles()
      });
    } catch (_error) {
      return null;
    }
    if (!resolved?.path || resolved.file?.kind === 'binary') {
      return null;
    }
    return {
      path: resolved.path,
      line,
      column
    };
  }

  function createLineReferenceButton(reference) {
    const button = document.createElement('button');
    button.className = 'codex-line-reference';
    button.type = 'button';
    button.textContent = formatLineReferenceText(reference);
    button.dataset.path = reference.path;
    button.dataset.line = String(reference.line);
    if (reference.column) {
      button.dataset.column = String(reference.column);
    }
    const ariaLabel = reference.column
      ? `Open ${reference.path} line ${reference.line} column ${reference.column}`
      : `Open ${reference.path} line ${reference.line}`;
    button.setAttribute('aria-label', ariaLabel);
    button.title = ariaLabel;
    button.addEventListener('click', async event => {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      const params = {
        path: reference.path,
        line: reference.line,
        selectLine: !reference.column
      };
      if (reference.column) {
        params.column = reference.column;
        params.selectLine = false;
      }
      button.disabled = true;
      button.dataset.status = 'pending';
      try {
        const result = await callPageBridge('jumpToPosition', params);
        if (result?.ok === false) {
          button.dataset.status = 'failed';
          button.title = tx('Could not open that referenced line.', '无法打开引用的行。');
          showPluginToast?.(tx('Could not open that referenced line.', '无法打开引用的行。'), {
            status: 'warning'
          });
          return;
        }
        delete button.dataset.status;
        button.title = ariaLabel;
      } catch (_error) {
        button.dataset.status = 'failed';
        button.title = tx('Could not open that referenced line.', '无法打开引用的行。');
        showPluginToast?.(tx('Could not open that referenced line.', '无法打开引用的行。'), {
          status: 'warning'
        });
      } finally {
        button.disabled = false;
      }
    });
    return button;
  }

  function formatLineReferenceText(reference) {
    return `${reference.path}:${reference.line}${reference.column ? `:${reference.column}` : ''}`;
  }

  function normalizeReferencePathForRuntime(value) {
    if (LineReferences?.normalizeReferencePath) {
      return LineReferences.normalizeReferencePath(value);
    }
    return String(value || '')
      .replace(/\\/g, '/')
      .replace(/\/+/g, '/')
      .replace(/^\/+/, '')
      .replace(/^\.\//, '')
      .trim();
  }

  function hasUnsafeRuntimePathSegments(path) {
    return normalizeReferencePathForRuntime(path)
      .split('/')
      .some(segment => segment === '.' || segment === '..');
  }

  function isHttpMarkdownHref(href) {
    try {
      const parsed = new URL(String(href || '').trim());
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (_error) {
      return false;
    }
  }

  function containsLocalPathText(value) {
    return /(?:file:\/\/\/?|[A-Za-z]:[\\/]|\/(?:Users|home|private|var|tmp)\/|[\\/]\.codex-overleaf[\\/]projects[\\/])/i.test(String(value || ''));
  }

  function fallbackSanitizeLocalReferences(value) {
    return String(value || '')
      .replace(/\[([^\]]*)\]\(([^)]*)\)/g, (_raw, label, target) => {
        const safeLabel = fallbackSanitizeBareLocalPaths(label);
        return /^https?:\/\//i.test(String(target || '').trim())
          ? `[${safeLabel}](${target})`
          : `[${safeLabel}]`;
      })
      .replace(/(?:file:\/\/\/?[^\s)\]]+|[A-Za-z]:[\\/][^\s)\]]+|\/(?:Users|home|private|var|tmp)\/[^\s)\]]+|[^\s)\]]*[\\/]\.codex-overleaf[\\/]projects[\\/][^\s)\]]+)/gi, rawPath => {
        const line = String(rawPath || '').match(/:(\d+)(?::\d+)?(?:[.,;!?])?$/)?.[1];
        return line ? `[local path:${line}]` : '[local path]';
      });
  }

  function fallbackSanitizeBareLocalPaths(value) {
    return String(value || '').replace(/(?:file:\/\/\/?[^\s)\]]+|[A-Za-z]:[\\/][^\s)\]]+|\/(?:Users|home|private|var|tmp)\/[^\s)\]]+|[^\s)\]]*[\\/]\.codex-overleaf[\\/]projects[\\/][^\s)\]]+)/gi, rawPath => {
      const line = String(rawPath || '').match(/:(\d+)(?::\d+)?(?:[.,;!?])?$/)?.[1];
      return line ? `[local path:${line}]` : '[local path]';
    });
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
    const resolved = resolveMarkdownLineReference(source, target);
    if (resolved) {
      return formatLineReferenceText(resolved);
    }
    const workspaceMatch = target.match(/\/workspace\/([^:)]+)(?::(\d+))?/);
    if (workspaceMatch) {
      const fileLabel = sanitizeAssistantVisibleText(workspaceMatch[1]);
      const line = workspaceMatch[2];
      return line ? `workspace/${fileLabel}:${line}` : `workspace/${fileLabel}`;
    }
    return sanitizeAssistantVisibleText(source || target);
  }

  function formatMarkdownHref(href) {
    const target = String(href || '').trim();
    if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) {
      return '#';
    }
    try {
      const parsed = new URL(target);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        if (containsLocalPathText(parsed.href)) {
          parsed.search = '';
          parsed.hash = '';
        }
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

      if (isMarkdownFenceLine(line)) {
        const codeLines = [];
        index++;
        while (index < lines.length && !isMarkdownFenceLine(lines[index])) {
          codeLines.push(lines[index]);
          index++;
        }
        if (index < lines.length && isMarkdownFenceLine(lines[index])) {
          index++;
        }
        const pre = document.createElement('pre');
        pre.className = 'run-code-block';
        const code = document.createElement('code');
        code.textContent = sanitizeAssistantVisibleText(codeLines.join('\n'));
        pre.append(code);
        target.append(pre);
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
        !isMarkdownHeadingLine(lines[index]) &&
        !isMarkdownFenceLine(lines[index])
      ) {
        paragraphLines.push(lines[index].trim());
        index++;
      }

      const paragraph = document.createElement('p');
      paragraph.append(...buildMarkdownInlineNodes(paragraphLines.join(' ')));
      target.append(paragraph);
    }
  }

  function isMarkdownFenceLine(line) {
    return /^\s*```/.test(String(line || ''));
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

  function renderActivityLine(input) {
    const event = sanitizeRunEventForRender(input);
    const row = document.createElement('div');
    row.className = 'run-activity';
    row.dataset.status = event.status || 'info';
    row.dataset.kind = event.kind || 'activity';
    row.title = sanitizeAssistantVisibleText(buildActivityTooltip(event));

    const marker = document.createElement('span');
    marker.className = 'run-activity-dot';
    marker.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'run-activity-title';
    label.append(...buildMarkdownInlineNodes(event.title || 'Event'));

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

  function renderCompletionReport(input) {
    const event = sanitizeRunEventForRender(input);
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

  function isUndoResultEffectivelyApplied(run, result) {
    if (!result?.skipped?.length) {
      return true;
    }
    const expectedByPath = new Map((run?.undoExpectedFiles || [])
      .filter(file => file?.path && typeof file.content === 'string')
      .map(file => [file.path, file.content]));
    if (!expectedByPath.size) {
      return false;
    }
    const undoRestore = buildNoTraceUndoRestore(run);
    const editPaths = Array.from(new Set((undoRestore.operations || [])
      .filter(operation => (
        operation?.type === 'edit'
        && operation.path
        && expectedByPath.has(operation.path)
      ))
      .map(operation => operation.path)));
    if (!editPaths.length) {
      return false;
    }
    return editPaths.every(path => (result.applied || []).some(item => (
      item?.operation?.type === 'edit'
      && item.operation.path === path
      && item?.result?.verifiedContent === expectedByPath.get(path)
    )));
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
      const undoApplied = isUndoResultEffectivelyApplied(run, result);
      appendUndoReviewingPolicyEvent(runId, result.reviewingPolicy);
      appendRunRecordEvent(runId, {
        title: tr('undoResult', { applied: result.applied?.length || 0, skipped: result.skipped?.length || 0 }),
        status: undoApplied ? 'completed' : result.skipped?.length ? 'failed' : 'completed',
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
      setRunUndoStatus(runId, undoApplied ? 'applied' : 'partial');
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
    const trackedEditorUndoCount = hasTrackedEditorUndo(run) ? 1 : 0;
    if (trackedEditorUndoCount) {
      return trackedEditorUndoCount;
    }
    return (run.undoOperations?.length || 0)
      + (run.undoTrackedChanges?.length || 0);
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
    const appliedEntries = getAppliedEntries(applyResult);
    if (!currentRunView?.recordId || !appliedEntries.length) {
      return;
    }
    const appliedOperations = appliedEntries
      .map(item => item.operation)
      .filter(Boolean);
    const skippedEntries = getSkippedEntries(applyResult);
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
      record.partialWriteback = skippedEntries.length > 0;
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
    record.partialWriteback = skippedEntries.length > 0;
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
      for (const item of [...getAppliedEntries(result), ...getSkippedEntries(result)]) {
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
    const applied = getAppliedEntries(result);
    const skipped = getSkippedEntries(result);
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
    const appliedCount = getAppliedEntries(result).length;
    if (appliedCount > 0) {
      return tx('Review the skipped reasons. You can use "Undo written parts" to roll back what already reached Overleaf, then fix conflicts and retry.', '请查看跳过原因。已写入的部分可以点击“撤销已写入部分”回退，处理冲突后再重试。');
    }
    return tx('Nothing was written in this run. Review the skipped reasons, fix them, and retry.', '这轮没有任何内容写入。请查看跳过原因，处理后重试。');
  }

  function appendApplyResult(result) {
    if (!result) {
      return;
    }
    const appliedEntries = getAppliedEntries(result);
    const skippedEntries = getSkippedEntries(result);
    const applied = appliedEntries.length;
    const skipped = skippedEntries.length;
    appendRunEvent({
      title: tx(`Write result: wrote ${applied} item(s), skipped ${skipped}`, `写入结果：已写入 ${applied} 项，跳过 ${skipped} 项`),
      status: skipped ? 'failed' : 'completed',
      detail: {
        [tx('Written', '已写入')]: appliedEntries.map(item => ({
          [tr('detailAction')]: formatOperationType(item.operation?.type),
          [tr('detailFile')]: item.operation?.path,
          [tx('Status', '状态')]: item.result?.status
        })),
        [tr('detailSkipped')]: skippedEntries.map(item => ({
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
    const withDebug = reason => appendApplyResultDebug(reason, result);
    if (key === 'missingBaseFile' || code === 'missing_base_file') {
      const target = filePath || tx('this file', '这个文件');
      return withDebug(tx(
        `${target} was not read when the task started. Codex did not overwrite it; refresh the project content and retry.`,
        `${target} 在任务开始时没有被 Codex 读到。Codex 没有覆盖它；请刷新项目内容后重试。`
      ));
    }
    if (key === 'staleSnapshot' || code === 'stale_snapshot') {
      const target = filePath || tx('this file', '这个文件');
      return withDebug(tx(
        `${target} changed while Codex was working, so Codex did not overwrite it. Review the diff and retry.`,
        `${target} 在任务执行期间被你或协作者改过，Codex 没有覆盖它。请查看差异后重试。`
      ));
    }
    if (key === 'stalePatchLocation') {
      return withDebug(tx(
        'The edit location no longer matches the current Overleaf content, so nothing was written. Rerun the task.',
        'Codex 要修改的位置已经无法和当前 Overleaf 内容对齐，所以没有写入。请重新运行任务。'
      ));
    }
    if (key === 'stalePatchConflict' || code === 'stale_patch_range') {
      return withDebug(tx(
        'The exact edit location was changed by you or a collaborator, so Codex did not overwrite it. Review the diff and retry.',
        'Codex 要修改的具体位置已经被你或协作者改过，所以没有覆盖它。请查看差异后重试。'
      ));
    }
    if (code === 'stale_patch') {
      return withDebug(tx(
        'This exact text changed since Codex read it, so nothing was written. Rerun after Codex reads the latest Overleaf content.',
        '这处内容已经和 Codex 读取时不同，所以没有写入。请重新运行，让 Codex 先读取你的最新 Overleaf 内容。'
      ));
    }
    if (code === 'invalid_patch') {
      return withDebug(tx(
        'Codex produced an invalid local edit range, so nothing was written.',
        'Codex 生成的局部写入范围无效，所以没有写入。'
      ));
    }
    if (code === 'write_verification_failed') {
      return withDebug(tx(
        'After writing, the editor content did not match Codex\'s expected result, so the write was not marked successful. Reload Overleaf and retry.',
        '写入后读回内容和 Codex 预期不一致，已停止把这次操作标记为成功。请刷新 Overleaf 后重试。'
      ));
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
    return withDebug(localizeVisibleReason(result.reason || result.error || result.code || tr('unknownReason')));
  }

  function appendApplyResultDebug(reason, result = {}) {
    const debug = result.debug || result.diagnostics;
    const text = formatApplyResultDebug(debug);
    return text ? `${reason} [debug: ${text}]` : reason;
  }

  function formatApplyResultDebug(debug) {
    if (!debug || typeof debug !== 'object') {
      return '';
    }
    const parts = [];
    const add = (key, value) => {
      if (value === undefined || value === null || value === '') {
        return;
      }
      parts.push(`${key}=${String(value)}`);
    };
    add('stage', debug.stage);
    add('rev', debug.revision);
    add('op', debug.operationPath);
    add('active', debug.activePath);
    add('initial', debug.initialActivePath);
    add('last', debug.lastActivePath);
    add('currentLen', debug.current?.length);
    add('currentNorm', debug.current?.normalizedLength);
    add('currentHash', debug.current?.hash);
    add('baseKnown', debug.baseKnown);
    add('baseLen', debug.base?.length);
    add('baseNorm', debug.base?.normalizedLength);
    add('baseHash', debug.base?.hash);
    add('elapsed', debug.elapsedMs);
    add('opened', debug.openedMethod);
    return parts.join(', ');
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
    const safeDetail = sanitizeAssistantVisibleValue(detail);
    if (typeof safeDetail === 'string') {
      return safeDetail;
    }
    if (Array.isArray(safeDetail)) {
      return safeDetail.map(item => typeof item === 'string' ? item : JSON.stringify(item, null, 2)).join('\n');
    }
    if (typeof safeDetail === 'object') {
      return Object.entries(safeDetail)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${key}: ${formatDetailValue(value)}`)
        .join('\n') || JSON.stringify(safeDetail, null, 2);
    }
    return String(safeDetail);
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

  }

  root.CodexOverleafContentRuntime = { init };
})(typeof window !== 'undefined' ? window : globalThis);
