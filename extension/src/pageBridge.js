(function initCodexOverleafPageBridge() {
  'use strict';

  if (window.__codexOverleafPageBridgeInstalled) {
    return;
  }
  window.__codexOverleafPageBridgeInstalled = true;

  const ZIP_FETCH_TIMEOUT_MS = 30000;
  const TEXT_PATH_EXTENSION_PATTERN = '(?:tex|bib|sty|cls|bst|bbx|cbx|lbx|cfg|def|clo|ist|txt|md|latex)';
  const MAX_BINARY_FILE_BYTES = 10 * 1024 * 1024;
  const MAX_BINARY_TOTAL_BYTES = 80 * 1024 * 1024;
  const PAGE_BRIDGE_CAPABILITY_METHOD = 'initializeCapability';
  // The page bridge runs in Overleaf's page world so it can reach editor state.
  // The capability reduces unauthenticated postMessage calls, but same-page
  // Overleaf code remains inside the trusted page boundary.
  let pageBridgeCapability = '';
  const compileBridge = window.CodexOverleafCompileBridge.create({
    document,
    getActiveFilePath,
    waitForSaveState,
    window
  });
  compileBridge.install();
  const editorAdapter = window.CodexOverleafEditorAdapter.create({
    document,
    Event,
    findEditorContentNode,
    findEditorTextArea,
    getCodeMirrorDocLength,
    getCodeMirrorDocText,
    getCodeMirrorEditorView,
    getDeepActiveElement,
    InputEvent,
    isInsideCodexPanel,
    normalizeTextPatches
  });
  const projectSnapshotBridge = window.CodexOverleafProjectSnapshot.create({
    buildProjectFileList,
    buildProjectSnapshot,
    getProjectId,
    normalizePath: normalizeSafeProjectPath,
    window
  });
  const otObserver = createOtObserver();

  function createOtObserver() {
    if (!window.CodexOverleafRealtimeObserver || typeof window.CodexOverleafRealtimeObserver.create !== 'function') {
      return createUnavailableOtObserver();
    }
    try {
      return window.CodexOverleafRealtimeObserver.create({
        document,
        window,
        otText: window.CodexOverleafOtText,
        getActiveFilePath,
        readActiveEditorText,
        getCodeMirrorEditorView,
        collectDocRecords,
        now: () => Date.now()
      });
    } catch (_error) {
      return createUnavailableOtObserver('ot_observer_create_failed');
    }
  }

  window.addEventListener('message', async event => {
    if (event.source !== window
      || event.origin !== window.location.origin
      || event.data?.source !== 'codex-overleaf/content') {
      return;
    }

    const { id, method, params, capability } = event.data;
    let result;
    try {
      if (method === PAGE_BRIDGE_CAPABILITY_METHOD) {
        result = initializePageBridgeCapability(capability);
      } else if (!hasValidPageBridgeCapability(capability)) {
        result = buildUnauthorizedBridgeResult();
      } else {
        result = await dispatch(method, params || {});
      }
    } catch (error) {
      result = {
        ok: false,
        error: error.message
      };
    }

    window.postMessage({
      source: 'codex-overleaf/page',
      id,
      result
    }, window.location.origin);
  });

  function initializePageBridgeCapability(capability) {
    if (!isValidPageBridgeCapability(capability)) {
      return {
        ok: false,
        code: 'invalid_page_bridge_capability',
        error: 'Invalid page bridge capability'
      };
    }
    if (!pageBridgeCapability) {
      pageBridgeCapability = capability;
      return { ok: true };
    }
    if (capability === pageBridgeCapability) {
      return { ok: true, alreadyInitialized: true };
    }
    return {
      ok: false,
      code: 'page_bridge_capability_already_initialized',
      error: 'Page bridge capability is already initialized'
    };
  }

  function hasValidPageBridgeCapability(capability) {
    return Boolean(pageBridgeCapability && capability === pageBridgeCapability);
  }

  function isValidPageBridgeCapability(capability) {
    return typeof capability === 'string'
      && capability.length >= 16
      && capability.length <= 256
      && !/[\u0000-\u001f\u007f]/.test(capability);
  }

  function buildUnauthorizedBridgeResult() {
    return {
      ok: false,
      code: 'page_bridge_unauthorized',
      error: 'Page bridge request is not authorized'
    };
  }

  async function dispatch(method, params) {
    if (method === 'probe') {
      return probe(params);
    }
    if (method === 'getProjectSnapshot') {
      return projectSnapshotBridge.getProjectSnapshot(withSnapshotCacheIdentity(params));
    }
    if (method === 'getProjectFileList') {
      return projectSnapshotBridge.getProjectFileList(params);
    }
    if (method === 'invalidateProjectSnapshot') {
      projectSnapshotBridge.invalidateProjectSnapshot();
      return { ok: true };
    }
    if (method === 'createCheckpoint') {
      return createCheckpoint(params.label);
    }
    if (method === 'ensureReviewing') {
      return ensureReviewing(params);
    }
    if (method === 'ensureEditing') {
      return ensureEditing(params);
    }
    if (method === 'applyOperations') {
      return applyOperations(params.operations || [], {
        baseFiles: params.baseFiles || null,
        reviewingPolicy: params.reviewingPolicy || '',
        requireReviewing: params.requireReviewing === true,
        requireEditing: params.requireEditing === true
      });
    }
    if (method === 'jumpToPosition') {
      return jumpToPosition(params);
    }
    if (method === 'rejectTrackedChanges') {
      return rejectTrackedChanges(params);
    }
    if (method === 'triggerCompile') {
      return compileBridge.triggerCompile(params);
    }
    if (method === 'getCompileLog') {
      return compileBridge.getCompileLog(params);
    }
    if (method === 'getCompileState') {
      return compileBridge.getCompileState();
    }
    if (method === 'waitForSaveState') {
      return waitForSaveState(params);
    }
    if (method === 'startOtObserver') {
      return otObserver.start(params);
    }
    if (method === 'stopOtObserver') {
      return otObserver.stop();
    }
    if (method === 'getOtStatus') {
      return otObserver.getStatus();
    }
    if (method === 'drainOtEvents') {
      return {
        ok: true,
        events: otObserver.drainEvents().map(sanitizeOtEventForContent)
      };
    }
    return {
      ok: false,
      error: `Unknown page bridge method: ${method}`
    };
  }

  function sanitizeOtEventForContent(event = {}) {
    const sanitized = {};
    copyOtEventField(sanitized, event, 'path');
    copyOtEventField(sanitized, event, 'baseHash');
    copyOtEventField(sanitized, event, 'nextHash');
    copyOtEventField(sanitized, event, 'nextContent');
    copyOtEventField(sanitized, event, 'observedAt');
    copyOtEventField(sanitized, event, 'observedVersion');
    const source = sanitizeOtEventSource(readOtEventField(event, 'source'));
    if (source !== undefined) {
      sanitized.source = source;
    }
    return sanitized;
  }

  function copyOtEventField(target, event, field) {
    const value = readOtEventField(event, field);
    if (value !== undefined) {
      target[field] = value;
    }
  }

  function readOtEventField(event, field) {
    try {
      return event && typeof event === 'object' ? event[field] : undefined;
    } catch (_error) {
      return undefined;
    }
  }

  function sanitizeOtEventSource(source) {
    if (source === null || typeof source === 'string' || typeof source === 'number' || typeof source === 'boolean') {
      return source;
    }
    return undefined;
  }

  function createUnavailableOtObserver(reason = 'missing_realtime_observer') {
    const status = {
      status: 'unavailable',
      state: 'unavailable',
      running: false,
      strategy: 'active-editor',
      activePath: '',
      queuedEventCount: 0,
      lastEventAt: null,
      lastErrorCode: reason,
      reason,
      channelCandidates: []
    };
    return {
      start() {
        return { ...status };
      },
      stop() {
        return {
          ...status,
          status: 'off',
          state: 'off',
          lastErrorCode: '',
          reason: ''
        };
      },
      getStatus() {
        return { ...status };
      },
      drainEvents() {
        return [];
      }
    };
  }

  function normalizeSafeProjectPath(value) {
    if (typeof window.CodexOverleafProjectFiles?.normalizeSafeProjectPath === 'function') {
      return window.CodexOverleafProjectFiles.normalizeSafeProjectPath(value);
    }
    return window.CodexOverleafProjectFiles.normalizePath(value);
  }

  function invalidProjectPathResult(label = 'path') {
    return {
      ok: false,
      code: 'invalid_project_path',
      reason: `Invalid ${label}.`
    };
  }

  function withSnapshotCacheIdentity(params = {}) {
    if (params.restrictToRequestedPathsOnly !== true) {
      return params;
    }
    const activePath = getActiveFilePath();
    return {
      ...params,
      requestedPathsCacheKey: getRequestedSnapshotPaths(params, activePath).join(',')
    };
  }

  function probe(params = {}) {
    const reviewingSignals = collectReviewingSignals(params);
    const editor = detectEditor();
    const docRecords = collectDocRecords();
    return {
      ok: true,
      projectId: getProjectId(),
      reviewing: window.CodexOverleafReviewing.detectReviewingFromSignals(reviewingSignals),
      reviewingDiagnostics: reviewingSignals.diagnostics,
      editor,
      capabilities: collectPageCapabilities(editor),
      editorDiagnostics: buildEditorDiagnostics(editor),
      projectDiagnostics: {
        internalRootKeys: collectInternalRootKeys(),
        docRecordCount: docRecords.length,
        docRecords: docRecords.slice(0, 8)
      }
    };
  }

  function collectPageCapabilities(editor = detectEditor()) {
    return window.CodexOverleafPageCapabilities.collectPageCapabilities({
      editor,
      compileState: compileBridge.state,
      detectEditor,
      fileTreeMethodNames,
      findEditorContentNode,
      findEditorTextArea,
      findFileTreeManager,
      findHistoryObject,
      findReviewingActivationControl,
      getCodeMirrorEditorView,
      getDeepActiveElement,
      isInsideCodexPanel,
      window
    });
  }

  async function ensureReviewing(params = {}) {
    const initial = getReviewingState(params);
    if (isReviewingConfirmedForWrite(initial)) {
      return {
        ok: true,
        activated: false,
        reviewing: initial.reviewing
      };
    }

    const switched = await toggleReviewingMode(true, params);
    if (switched.ok) {
      return {
        ok: true,
        activated: true,
        reviewing: switched.reviewing
      };
    }

    return {
      ok: false,
      code: 'reviewing_not_enabled',
      reason: switched.attempted
        ? 'Codex clicked the Overleaf mode control, but Overleaf still did not report Reviewing/Track Changes as enabled.'
        : 'Overleaf Reviewing/Track Changes is not enabled, and Codex could not find a Reviewing control to activate.',
      reviewing: switched.reviewing || initial.reviewing
    };
  }

  async function ensureEditing(params = {}) {
    const initial = getReviewingState(params);
    if (isEditingConfirmedForNoTraceUndo(initial)) {
      return {
        ok: true,
        activated: false,
        changed: false,
        enabled: false,
        reviewing: initial.reviewing
      };
    }

    const switched = await toggleReviewingMode(false, params);
    if (switched.ok) {
      return {
        ok: true,
        activated: true,
        changed: true,
        enabled: false,
        reviewing: switched.reviewing
      };
    }

    return {
      ok: false,
      code: 'editing_not_confirmed',
      reason: switched.attempted
        ? 'Codex clicked the Overleaf mode control, but Overleaf still did not clearly report Editing mode.'
        : 'Overleaf Editing mode was not clearly confirmed, and Codex could not find a mode control to switch to Editing.',
      reviewing: switched.reviewing || initial.reviewing
    };
  }

  async function jumpToPosition(params = {}) {
    const filePath = normalizeSafeProjectPath(params.path);
    if (!filePath) {
      return {
        ok: false,
        code: 'invalid_path',
        reason: 'jumpToPosition requires a non-empty file path'
      };
    }
    if (!projectPathExists(filePath)) {
      return {
        ok: false,
        code: 'path_not_found',
        reason: `Could not find ${filePath} in the Overleaf project`,
        path: filePath
      };
    }

    const navigating = getActiveFilePath() !== filePath;
    const previousEditorIdentity = navigating ? getActiveEditorIdentity() : null;

    if (navigating) {
      const opened = await openFileByPath(filePath);
      if (!opened.ok) {
        return {
          ok: false,
          code: 'file_open_failed',
          reason: opened.reason || `Could not open ${filePath}`,
          path: filePath
        };
      }
    }

    const ready = navigating
      ? await waitForActiveEditorAfterNavigation(filePath, previousEditorIdentity, 7000)
      : await waitForActiveEditorText(filePath, 7000);
    if (!ready.ok) {
      return {
        ok: false,
        code: 'editor_not_ready',
        reason: ready.reason || `Editor content was not ready for ${filePath}`,
        path: filePath
      };
    }

    const focused = editorAdapter.focusActiveEditorRange(params.from, params.to);
    if (!focused.ok) {
      return {
        ...focused,
        path: filePath
      };
    }

    return {
      ok: true,
      method: focused.method,
      path: filePath,
      from: params.from,
      to: params.to
    };
  }

  async function waitForActiveEditorAfterNavigation(filePath, previousEditorIdentity, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let lastText = '';
    while (Date.now() < deadline) {
      const activeFileMatches = getActiveFilePath() === filePath;
      const text = readActiveEditorText();
      lastText = text;
      if (activeFileMatches
        && window.CodexOverleafProjectFiles.isUsableProjectFileContent(text)
        && activeEditorIdentityChanged(previousEditorIdentity)) {
        return {
          ok: true,
          text
        };
      }
      await delay(150);
    }
    return {
      ok: false,
      text: lastText,
      reason: `Editor content was not ready for ${filePath || 'active file'}; last length ${String(lastText || '').length}`
    };
  }

  function getActiveEditorIdentity() {
    const editorView = getCodeMirrorEditorView();
    if (editorView) {
      return {
        type: 'codemirror-view',
        view: editorView,
        state: editorView.state || null,
        doc: editorView.state?.doc || null
      };
    }

    const active = getDeepActiveElement();
    if (active && active.tagName === 'TEXTAREA' && !isInsideCodexPanel(active)) {
      return {
        type: 'textarea',
        node: active
      };
    }

    const textarea = findEditorTextArea();
    if (textarea) {
      return {
        type: 'textarea',
        node: textarea
      };
    }

    const editable = findEditorContentNode('.cm-content') || findEditorContentNode('[contenteditable="true"]');
    if (editable) {
      return {
        type: 'contenteditable',
        node: editable
      };
    }

    return null;
  }

  function activeEditorIdentityChanged(previous) {
    if (!previous) {
      return true;
    }
    const current = getActiveEditorIdentity();
    if (!current || current.type !== previous.type) {
      return true;
    }
    if (current.type === 'codemirror-view') {
      return current.view !== previous.view
        || current.state !== previous.state
        || current.doc !== previous.doc;
    }
    return current.node !== previous.node;
  }

  function getReviewingState(params = {}) {
    const signals = collectReviewingSignals({ ...params, manualOverride: false });
    return {
      signals,
      reviewing: window.CodexOverleafReviewing.detectReviewingFromSignals(signals)
    };
  }

  async function waitForReviewingState(params = {}) {
    const waitMs = Number.isFinite(Number(params.waitMs)) ? Number(params.waitMs) : 1600;
    const deadline = Date.now() + Math.max(0, waitMs);
    let current = getReviewingState(params);
    while (!isReviewingConfirmedForWrite(current) && Date.now() < deadline) {
      await delay(120);
      current = getReviewingState(params);
    }
    return current;
  }

  async function setReviewingEnabled(enabled, params = {}) {
    const initial = getReviewingState(params);
    const initiallyReviewing = isReviewingConfirmedForWrite(initial);
    if (isReviewingTargetStateConfirmed(enabled, initial)) {
      return {
        ok: true,
        changed: false,
        enabled,
        reviewing: initial.reviewing
      };
    }

    const switched = await toggleReviewingMode(enabled, params);
    if (switched.ok) {
      return {
        ok: true,
        changed: true,
        enabled,
        reviewing: switched.reviewing
      };
    }

    return {
      ok: false,
      code: enabled
        ? 'reviewing_enable_failed'
        : initiallyReviewing
          ? 'reviewing_disable_failed'
          : 'editing_not_confirmed',
      reason: enabled
        ? (switched.attempted
          ? 'Codex clicked the Reviewing control after undo, but Overleaf still did not report Reviewing/Track Changes as enabled.'
          : 'Codex could not find an Overleaf Reviewing/Track Changes control to restore after undo.')
        : initiallyReviewing
          ? (switched.attempted
            ? 'Codex clicked the Reviewing control before undo, but Overleaf still did not report Reviewing/Track Changes as disabled.'
            : 'Codex could not find an Overleaf Reviewing/Track Changes control to disable before undo.')
          : (switched.attempted
            ? 'Codex clicked the Overleaf mode control before undo, but Overleaf still did not clearly report Editing mode. To avoid tracked undo changes, Codex did not undo.'
            : 'Codex could not clearly confirm Overleaf Editing mode before undo. To avoid tracked undo changes, Codex did not undo.'),
      reviewing: switched.reviewing || initial.reviewing
    };
  }

  async function toggleReviewingMode(enabled, params = {}) {
    const attemptedNodes = uniqueNodes([
      findReviewingActivationControl(),
      findReviewingModeMenuControl()
    ].filter(Boolean));

    for (const control of attemptedNodes) {
      clickNode(control);
      let after = await waitForReviewingEnabled(enabled, {
        ...params,
        waitMs: Math.min(resolveWaitMs(params), 180)
      });
      if (isReviewingTargetStateConfirmed(enabled, after)) {
        return {
          ok: true,
          attempted: true,
          reviewing: after.reviewing
        };
      }

      const modeOption = findReviewingModeOption(enabled, { requireMenuOption: true });
      if (modeOption) {
        clickNode(modeOption);
        after = await waitForReviewingEnabled(enabled, params);
        if (isReviewingTargetStateConfirmed(enabled, after)) {
          return {
            ok: true,
            attempted: true,
            reviewing: after.reviewing
          };
        }
      }
    }

    const visibleModeOption = findReviewingModeOption(enabled, { requireMenuOption: true });
    if (visibleModeOption) {
      clickNode(visibleModeOption);
      const after = await waitForReviewingEnabled(enabled, params);
      return {
        ok: isReviewingTargetStateConfirmed(enabled, after),
        attempted: true,
        reviewing: after.reviewing
      };
    }

    const after = getReviewingState(params);
    return {
      ok: false,
      attempted: attemptedNodes.length > 0,
      reviewing: after.reviewing
    };
  }

  async function waitForReviewingEnabled(enabled, params = {}) {
    const waitMs = resolveWaitMs(params);
    const deadline = Date.now() + Math.max(0, waitMs);
    let current = getReviewingState(params);
    while (!isReviewingTargetStateConfirmed(enabled, current) && Date.now() < deadline) {
      await delay(120);
      current = getReviewingState(params);
    }
    return current;
  }

  function resolveWaitMs(params = {}) {
    return Number.isFinite(Number(params.waitMs)) ? Number(params.waitMs) : 1600;
  }

  function summarizeReviewingToggleResult(result = {}) {
    return {
      ok: result.ok === true,
      changed: result.changed === true,
      enabled: result.enabled === true,
      code: result.code || '',
      reason: result.reason || ''
    };
  }

  function isReviewingConfirmedForWrite(state = {}) {
    const reviewing = state.reviewing || {};
    if (!reviewing.ok || reviewing.status === 'manual-override') {
      return false;
    }
    if (reviewing.source !== 'control-text') {
      return true;
    }
    return (state.signals?.controls || []).some(control => {
      const text = [
        control.text,
        control.innerText,
        control.ariaLabel,
        control.title,
        control.id,
        control.className
      ].filter(Boolean).join(' ');
      const active = ['ariaPressed', 'ariaSelected', 'ariaCurrent']
        .some(key => /^(true|page|step|location)$/i.test(control[key] || ''));
      return active && /\breviewing\b|\btrack(?:ed)? changes?\b|\bsuggest(?:ing|ions?)\b/i.test(text);
    });
  }

  function isReviewingTargetStateConfirmed(enabled, state = {}) {
    return enabled
      ? isReviewingConfirmedForWrite(state)
      : isEditingConfirmedForNoTraceUndo(state);
  }

  function isEditingConfirmedForNoTraceUndo(state = {}) {
    if (isReviewingConfirmedForWrite(state)) {
      return false;
    }
    if (isEditingConfirmedFromControls(state.signals?.controls || [])) {
      return true;
    }
    return (state.signals?.internalStates || []).some(value => {
      const text = normalizeReviewingSignalText(value);
      return /\b(?:mode|editingMode|reviewMode)\s*:\s*(?:editing|source editing|source mode)\b/i.test(text);
    });
  }

  function isEditingConfirmedFromControls(controls = []) {
    return controls.some(control => {
      const text = normalizeReviewingSignalText([
        control.text,
        control.innerText,
        control.ariaLabel,
        control.title,
        control.value,
        control.role,
        control.id,
        control.className,
        control.dataTestId,
        control.dataQa,
        control.dataOlName,
        control.ariaSelected,
        control.ariaCurrent,
        control.htmlSnippet
      ].filter(Boolean).join(' '));
      const active = ['ariaPressed', 'ariaSelected', 'ariaCurrent']
        .some(key => /^(true|page|step|location)$/i.test(control[key] || ''));
      const inactive = ['ariaPressed', 'ariaSelected', 'ariaCurrent']
        .some(key => /^false$/i.test(control[key] || ''));
      const menuOption = /\b(menuitem|option|dropdown-item|menu-item)\b/i.test(text);

      if (isEditingModeText(text)) {
        return active || isCurrentEditingModeControl(control, text, { menuOption });
      }
      if ((/\breviewing\b|\btrack(?:ed)? changes?\b|\bsuggest(?:ing|ions?)\b/i.test(text)) && inactive) {
        return true;
      }
      return false;
    });
  }

  function isCurrentEditingModeControl(control = {}, text = '', options = {}) {
    if (options.menuOption) {
      return false;
    }
    const visibleLabel = normalizeReviewingSignalText([
      control.innerText,
      control.text,
      control.ariaLabel,
      control.title,
      control.value
    ].filter(Boolean).join(' '));
    const controlIdentity = normalizeReviewingSignalText([
      control.role,
      control.id,
      control.className,
      control.dataTestId,
      control.dataQa,
      control.dataOlName
    ].filter(Boolean).join(' '));

    return isRepeatedEditingModeLabel(visibleLabel)
      && /\b(editor-mode|mode|source|dropdown|switcher|toggle)\b/i.test(controlIdentity)
      && !/\breviewing\b|\btrack(?:ed)? changes?\b|\bsuggest(?:ing|ions?)\b/i.test(text);
  }

  function isRepeatedEditingModeLabel(value) {
    const labels = normalizeReviewingSignalText(value)
      .split(/\s+(?=editing\b|source editing\b|source mode\b)/i)
      .map(label => normalizeReviewingSignalText(label))
      .filter(Boolean);
    return labels.length > 0 && labels.every(label => /^(editing|source editing|source mode)$/i.test(label));
  }

  function normalizeReviewingSignalText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function findReviewingModeOption(enabled, options = {}) {
    const candidates = collectReviewingModeOptionNodes()
      .filter(node => isReviewingModeOptionCandidate(node, enabled, options))
      .sort((left, right) => scoreReviewingModeOption(right, enabled) - scoreReviewingModeOption(left, enabled));
    return candidates[0] || null;
  }

  function findReviewingModeMenuControl() {
    const candidates = collectReviewingModeMenuControlNodes()
      .filter(node => isReviewingModeMenuControlCandidate(node))
      .sort((left, right) => scoreReviewingModeMenuControl(right) - scoreReviewingModeMenuControl(left));
    return candidates[0] || null;
  }

  function collectReviewingModeMenuControlNodes() {
    const selector = [
      'button',
      '[role="button"]',
      '[aria-haspopup]',
      '[aria-expanded]',
      '[aria-label]',
      '[title]',
      '[id*="mode" i]',
      '[class*="mode" i]',
      '[id*="edit" i]',
      '[class*="edit" i]',
      '[id*="source" i]',
      '[class*="source" i]'
    ].join(',');
    return uniqueNodes([
      ...collectElements(selector, 1500),
      ...collectElements('*', 3500).filter(node => /editing|source mode|source editing/i.test(readNodeSignalText(node)))
    ]).slice(0, 1500);
  }

  function isReviewingModeMenuControlCandidate(node) {
    if (!node || node.disabled || node.getAttribute?.('aria-disabled') === 'true') {
      return false;
    }
    const text = readNodeSignalText(node);
    if (/\breview panel\b|\bsyntax highlighting\b/i.test(text)) {
      return false;
    }
    if (isReviewingModeText(text) && !isEditingModeText(text) && !node.getAttribute?.('aria-haspopup') && !node.getAttribute?.('aria-expanded')) {
      return false;
    }
    return isEditingModeText(text)
      || /\bmode\b/i.test(text)
      || /\bsource\b/i.test(text)
      || node.getAttribute?.('aria-haspopup')
      || node.getAttribute?.('aria-expanded');
  }

  function scoreReviewingModeMenuControl(node) {
    const text = readNodeSignalText(node);
    let score = 0;
    if (node.tagName === 'BUTTON') score += 4;
    if (isEditingModeText(text)) score += 8;
    if (/\bmode\b/i.test(text)) score += 4;
    if (/\bsource\b/i.test(text)) score += 3;
    if (node.getAttribute?.('aria-haspopup')) score += 3;
    if (node.getAttribute?.('aria-expanded')) score += 2;
    return score;
  }

  function collectReviewingModeOptionNodes() {
    const selector = [
      'button',
      '[role="button"]',
      '[role="menuitem"]',
      '[role="option"]',
      '[aria-label]',
      '[title]',
      '[id*="mode" i]',
      '[class*="mode" i]',
      '[id*="edit" i]',
      '[class*="edit" i]',
      '[id*="review" i]',
      '[class*="review" i]',
      '[id*="track" i]',
      '[class*="track" i]'
    ].join(',');
    return uniqueNodes([
      ...collectElements(selector, 1500),
      ...collectElements('*', 3500).filter(node => /editing|reviewing|track changes|suggesting/i.test(readNodeSignalText(node)))
    ]).slice(0, 1500);
  }

  function isReviewingModeOptionCandidate(node, enabled, options = {}) {
    if (!node || node.disabled || node.getAttribute?.('aria-disabled') === 'true') {
      return false;
    }
    if (options.requireMenuOption && !isMenuLikeModeOption(node)) {
      return false;
    }
    const text = readNodeSignalText(node);
    return enabled ? isReviewingModeText(text) : isEditingModeText(text);
  }

  function isMenuLikeModeOption(node) {
    const role = node.getAttribute?.('role') || '';
    const text = readNodeSignalText(node);
    return /menuitem|option/i.test(role)
      || /\bdropdown-item\b|\bmenu-item\b|\bmenuitem\b|\boption\b/i.test(text);
  }

  function scoreReviewingModeOption(node, enabled) {
    const text = readNodeSignalText(node);
    let score = 0;
    const role = node.getAttribute?.('role') || '';
    if (/menuitem|option/i.test(role)) score += 8;
    if (node.tagName === 'BUTTON') score += 2;
    if (enabled) {
      if (/^\s*reviewing\s*$/i.test(node.innerText || node.textContent || '')) score += 8;
      if (/\breviewing\b/i.test(text)) score += 6;
      if (/\btrack(?:ed)? changes?\b/i.test(text)) score += 4;
      if (/\bsuggest(?:ing|ions?)\b/i.test(text)) score += 3;
    } else {
      if (/^\s*editing\s*$/i.test(node.innerText || node.textContent || '')) score += 8;
      if (/\bediting\b/i.test(text)) score += 6;
      if (/\bsource\b/i.test(text)) score += 3;
    }
    return score;
  }

  function isReviewingModeText(text) {
    return /\breviewing\b|\btrack(?:ed)? changes?\b|\bsuggest(?:ing|ions?)\b/i.test(text)
      && !/\breview panel\b/i.test(text);
  }

  function isEditingModeText(text) {
    return /\bediting\b|\bsource editing\b|\bsource mode\b/i.test(text)
      && !/\bsyntax highlighting\b/i.test(text);
  }

  function findReviewingActivationControl() {
    const nodes = collectReviewingControlNodes();
    const candidates = nodes
      .filter(node => isReviewingActivationCandidate(node))
      .sort((left, right) => scoreReviewingControl(right) - scoreReviewingControl(left));
    return candidates[0] || null;
  }

  function collectReviewingControlNodes() {
    const selector = [
      'button',
      '[role="button"]',
      '[role="menuitem"]',
      '[role="option"]',
      '[aria-label]',
      '[title]',
      '[id*="review" i]',
      '[class*="review" i]',
      '[id*="track" i]',
      '[class*="track" i]'
    ].join(',');
    return uniqueNodes([
      ...collectElements(selector, 1200),
      ...collectElements('*', 3500).filter(node => /reviewing|track changes|suggesting/i.test(readNodeSignalText(node)))
    ]).slice(0, 1500);
  }

  function isReviewingActivationCandidate(node) {
    if (!node || node.disabled || node.getAttribute?.('aria-disabled') === 'true') {
      return false;
    }
    const text = readNodeSignalText(node);
    return /\breviewing\b|\btrack(?:ed)? changes?\b|\bsuggest(?:ing|ions?)\b/i.test(text)
      && !/\breview panel\b/i.test(text);
  }

  function scoreReviewingControl(node) {
    const text = readNodeSignalText(node);
    let score = 0;
    if (/^\s*reviewing\s*$/i.test(node.innerText || node.textContent || '')) score += 5;
    if (/\breviewing\b/i.test(text)) score += 4;
    if (/\btrack(?:ed)? changes?\b/i.test(text)) score += 3;
    if (/\bsuggest(?:ing|ions?)\b/i.test(text)) score += 2;
    if (node.tagName === 'BUTTON') score += 1;
    return score;
  }

  function clickNode(node) {
    if (typeof node.click === 'function') {
      node.click();
      return;
    }
    node.dispatchEvent?.(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function waitForSaveState(params = {}) {
    const deadlineMs = Number.isFinite(Number(params.deadlineMs)) ? Number(params.deadlineMs) : 5000;
    const pollInterval = Number.isFinite(Number(params.pollIntervalMs)) ? Number(params.pollIntervalMs) : 100;
    const deadline = Date.now() + Math.max(0, deadlineMs);
    let lastState = { state: 'unknown', reason: 'Overleaf save state has not been checked yet.' };

    do {
      let current;
      try {
        current = getOverleafSaveState();
      } catch (error) {
        return {
          ok: false,
          state: 'unavailable',
          reason: `Could not check Overleaf save state: ${error.message}`
        };
      }
      if (current.state === 'verified_saved') {
        return { ok: true, state: 'verified_saved' };
      }
      if (current.state === 'unavailable') {
        return {
          ok: false,
          state: 'unavailable',
          reason: current.reason || 'Overleaf save state is unavailable.'
        };
      }
      lastState = current;
      if (Date.now() >= deadline) {
        break;
      }
      await delay(Math.min(Math.max(1, pollInterval), Math.max(1, deadline - Date.now())));
    } while (Date.now() < deadline);

    return {
      ok: false,
      state: 'unknown_timeout',
      reason: buildSaveStateTimeoutReason(lastState)
    };
  }

  function getOverleafSaveState() {
    if (!document || typeof document.querySelectorAll !== 'function') {
      return {
        state: 'unavailable',
        reason: 'Overleaf document is unavailable for save-state detection.'
      };
    }
    const selectors = [
      '.toolbar-header [class*="save" i]',
      '[class*="saving-status" i]',
      '[class*="save-status" i]',
      '[data-testid*="save" i]',
      '[aria-label*="save" i]'
    ];
    let sawSaveCandidate = false;
    let sawVerifiedSaved = false;
    let sawNegativeState = false;
    let sawSavingState = false;
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        if (isHiddenSaveIndicatorNode(el)) {
          continue;
        }
        const texts = readSaveIndicatorTexts(el);
        if (!texts.length) {
          continue;
        }
        const combinedText = texts.join(' ');
        if (isAnySaveIndicatorText(texts, combinedText, isNegativeSaveStateText)) {
          sawNegativeState = true;
          sawSaveCandidate = true;
          continue;
        }
        if (isAnySaveIndicatorText(texts, combinedText, isSavingStateText)) {
          sawSavingState = true;
          sawSaveCandidate = true;
          continue;
        }
        if (texts.some(isVerifiedSavedText)) {
          sawVerifiedSaved = true;
          continue;
        }
        if (isAnySaveIndicatorText(texts, combinedText, isSaveIndicatorCandidateText)) {
          sawSaveCandidate = true;
        }
      }
    }
    if (sawNegativeState) {
      return {
        state: 'unknown',
        reason: 'Overleaf save indicator reports changes are not saved.'
      };
    }
    if (sawSavingState) {
      return {
        state: 'saving',
        reason: 'Overleaf is still saving or syncing changes.'
      };
    }
    if (sawVerifiedSaved) {
      return { state: 'verified_saved' };
    }
    return {
      state: 'unknown',
      reason: sawSaveCandidate
        ? 'Overleaf save indicator was present, but did not verify that all changes are saved.'
        : 'Overleaf save indicator was not found.'
    };
  }

  function isHiddenSaveIndicatorNode(node) {
    if (!node) {
      return true;
    }
    if (node.hidden === true || node.inert === true) {
      return true;
    }
    if (hasSaveIndicatorAttribute(node, 'hidden') || hasSaveIndicatorAttribute(node, 'inert')) {
      return true;
    }
    if (/^true$/i.test(String(node.getAttribute?.('aria-hidden') || ''))) {
      return true;
    }
    if (hasHiddenSaveIndicatorAncestor(node)) {
      return true;
    }
    if (isHiddenStyle(node.style)) {
      return true;
    }
    if (isHiddenStyle(getComputedStyleForSaveIndicator(node))) {
      return true;
    }
    return hasZeroSaveIndicatorLayout(node);
  }

  function hasHiddenSaveIndicatorAncestor(node) {
    if (typeof node.closest === 'function') {
      try {
        if (node.closest('[hidden],[inert],[aria-hidden="true"]')) {
          return true;
        }
      } catch (_error) {
        // Fall back to walking parentElement below.
      }
    }
    let current = node.parentElement;
    while (current) {
      if (current.hidden === true || current.inert === true) {
        return true;
      }
      if (hasSaveIndicatorAttribute(current, 'hidden') || hasSaveIndicatorAttribute(current, 'inert')) {
        return true;
      }
      if (/^true$/i.test(String(current.getAttribute?.('aria-hidden') || ''))) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }

  function hasSaveIndicatorAttribute(node, attribute) {
    if (typeof node.hasAttribute === 'function') {
      try {
        return node.hasAttribute(attribute);
      } catch (_error) {
        return false;
      }
    }
    const value = node.getAttribute?.(attribute);
    return value != null && value !== '';
  }

  function isHiddenStyle(style) {
    if (!style) {
      return false;
    }
    return /^none$/i.test(String(style.display || ''))
      || /^(hidden|collapse)$/i.test(String(style.visibility || ''));
  }

  function getComputedStyleForSaveIndicator(node) {
    try {
      const ownerWindow = node.ownerDocument?.defaultView || null;
      const fallbackWindow = typeof window !== 'undefined' ? window : null;
      const styleWindow = ownerWindow || fallbackWindow;
      return styleWindow?.getComputedStyle?.(node) || null;
    } catch (_error) {
      return null;
    }
  }

  function hasZeroSaveIndicatorLayout(node) {
    if (typeof node.getClientRects !== 'function') {
      return false;
    }
    try {
      const rects = node.getClientRects();
      if (rects && rects.length > 0) {
        return false;
      }
      return node.offsetWidth === 0 && node.offsetHeight === 0;
    } catch (_error) {
      return false;
    }
  }

  function readSaveIndicatorTexts(node) {
    const parts = [
      node.textContent,
      node.innerText,
      node.getAttribute?.('aria-label'),
      node.getAttribute?.('title'),
      node.getAttribute?.('value')
    ].map(value => String(value || '').replace(/\s+/g, ' ').trim()).filter(Boolean);
    return Array.from(new Set(parts));
  }

  function isAnySaveIndicatorText(texts, combinedText, predicate) {
    return predicate(combinedText) || texts.some(predicate);
  }

  function isNegativeSaveStateText(text) {
    return /\bnot\b[\s\S]{0,40}\bsaved\b|\b(?:unsaved|save failed|failed to save|could not save|unable to save)\b|未保存|保存失败/i.test(text);
  }

  function isSavingStateText(text) {
    return /\b(saving|syncing|compiling)\b|保存中|正在保存|同步中/i.test(text);
  }

  function isVerifiedSavedText(text) {
    if (isNegativeSaveStateText(text)) {
      return false;
    }
    return /^\s*(?:all changes saved|changes saved|saved)[\s.!]*$/i.test(text)
      || /已保存/i.test(text);
  }

  function isSaveIndicatorCandidateText(text) {
    return /\bsave\b|\bsaved\b|\bsaving\b|保存/i.test(text);
  }

  function buildSaveStateTimeoutReason(lastState = {}) {
    if (lastState.state === 'saving') {
      return `Timed out waiting for Overleaf to finish saving changes. ${lastState.reason || ''}`.trim();
    }
    return `Timed out waiting for a verified Overleaf save state. ${lastState.reason || ''}`.trim();
  }

  async function buildProjectFileList(params = {}) {
    const activePath = getActiveFilePath();
    const internalDocRecords = collectDocRecords({ includeWindowGlobals: false });
    const docRecordByPath = new Map(internalDocRecords.map(record => [record.path, record]));
    if (params.preferExact !== false) {
      const zipSnapshot = await fetchProjectZipSnapshot({
        ...params,
        includeBinaryFiles: true,
        includeContent: false
      });
      if (zipSnapshot.ok && zipSnapshot.files.length) {
        const paths = collectUniqueProjectPaths(zipSnapshot.files.map(file => file.path), 1000);
        const zipFileByPath = buildProjectFileEntryLookup(zipSnapshot.files);
        return {
          ok: true,
          id: getProjectId(),
          url: window.location.href,
          activePath,
          files: paths.map(path => {
            const isText = window.CodexOverleafProjectFiles.isTextProjectPath(path);
            return {
              path,
              active: path === activePath,
              source: 'overleaf-zip',
              kind: isText ? 'text' : 'binary',
              selectable: isText,
              ...buildFileSizeMetadata(zipFileByPath.get(path))
            };
          }),
          capabilities: {
            fullProjectSnapshot: true,
            method: 'overleaf-zip-file-list',
            skipped: [],
            diagnostics: {
              zipEndpoint: zipSnapshot.endpoint,
              docRecordCount: internalDocRecords.length,
              docRecords: internalDocRecords.slice(0, 8)
            },
            note: 'Listed Overleaf project files from the exact source ZIP file tree.'
          }
        };
      }
      if (params.exactOnly === true || params.requireExact === true) {
        return {
          ok: false,
          id: getProjectId(),
          url: window.location.href,
          activePath,
          files: [],
          reason: zipSnapshot.reason || 'Overleaf source ZIP was unavailable',
          capabilities: {
            fullProjectSnapshot: false,
            method: 'overleaf-zip-file-list-unavailable',
            skipped: [{
              path: 'project.zip',
              reason: zipSnapshot.reason || 'Overleaf source ZIP was unavailable'
            }],
            diagnostics: {
              docRecordCount: internalDocRecords.length,
              docRecords: internalDocRecords.slice(0, 8)
            },
            note: 'The exact Overleaf source ZIP file tree was required, so the page file tree fallback was not used.'
          }
        };
      }
    }

    const paths = collectProjectFileListPaths(activePath, internalDocRecords);
    return {
      ok: true,
      id: getProjectId(),
      url: window.location.href,
      activePath,
      files: paths.map(path => ({
        path,
        active: path === activePath,
        source: docRecordByPath.has(path) ? 'overleaf-doc-record' : path === activePath ? 'active-file' : 'page-file-list'
      })),
      capabilities: {
        fullProjectSnapshot: false,
        method: 'overleaf-file-tree',
        skipped: [],
        diagnostics: {
          docRecordCount: internalDocRecords.length,
          docRecords: internalDocRecords.slice(0, 8)
        },
        note: 'Listed Overleaf project text files from page state without downloading the source ZIP.'
      }
    };
  }

  function collectProjectFileListPaths(activePath, docRecords = []) {
    const domPaths = collectDomProjectPaths();
    const domPathSet = new Set(domPaths);
    const docPaths = docRecords
      .map(record => record.path)
      .filter(path => window.CodexOverleafProjectFiles.isTextProjectPath(path));
    const activePaths = domPathSet.has(activePath) ? [activePath] : [];
    return window.CodexOverleafProjectFiles.collectUniqueTextPaths([
      ...activePaths,
      ...domPaths,
      ...docPaths
    ], 160);
  }

  function collectUniqueProjectPaths(paths, limit = 1000) {
    const seen = new Set();
    const result = [];
    for (const rawPath of paths || []) {
      const path = normalizeSafeProjectPath(rawPath);
      if (!isSafeProjectPath(path) || seen.has(path)) {
        continue;
      }
      seen.add(path);
      result.push(path);
      if (result.length >= limit) {
        break;
      }
    }
    return result;
  }

  function buildProjectFileEntryLookup(files = []) {
    const entries = new Map();
    for (const file of files || []) {
      const path = normalizeSafeProjectPath(file?.path);
      if (!isSafeProjectPath(path) || entries.has(path)) {
        continue;
      }
      entries.set(path, file);
    }
    return entries;
  }

  function buildFileSizeMetadata(file = {}) {
    const size = Number(file?.size ?? file?.byteLength);
    return Number.isFinite(size) && size >= 0 ? { size } : {};
  }

  function isSafeProjectPath(path) {
    return Boolean(path && normalizeSafeProjectPath(path) === path && !path.endsWith('/'));
  }

  async function buildProjectSnapshot(params = {}) {
    if (params.zipOnly) {
      return buildZipOnlyProjectSnapshot(params);
    }

    const activePath = getActiveFilePath();
    const internalDocRecords = collectDocRecords();
    const docRecordByPath = new Map(internalDocRecords.map(record => [record.path, record]));
    let lightweightSnapshot = null;

    if (params.preferLightweight) {
      lightweightSnapshot = await buildPageProjectSnapshot({
        params,
        activePath,
        internalDocRecords,
        docRecordByPath,
        zipSnapshot: null,
        lightweightOnly: true
      });
      if (
        params.allowZipFallback === false
        || lightweightSnapshot.files.length && (!params.requireFullProject || lightweightSnapshot.capabilities.fullProjectSnapshot)
      ) {
        return lightweightSnapshot;
      }
    }

    const zipSnapshot = await fetchProjectZipSnapshot(params);
    if (zipSnapshot.ok && zipSnapshot.files.length) {
      const mergedFiles = mergeSnapshotFiles(
        zipSnapshot.files,
        filterZipSnapshotOverlayFiles(zipSnapshot.files, lightweightSnapshot?.files || [])
      );
      const files = filterRequestedSnapshotFiles(mergedFiles, params, activePath);
      const requestedPathsComplete = params.restrictToRequestedPathsOnly === true
        ? isCompleteProjectSnapshot(files, getRequestedSnapshotPaths(params, activePath))
        : true;
      return {
        id: getProjectId(),
        url: window.location.href,
        activePath,
        files,
        capabilities: {
          fullProjectSnapshot: params.restrictToRequestedPathsOnly === true ? false : true,
          requestedPathsComplete,
          method: 'overleaf-zip',
          skipped: zipSnapshot.skipped || [],
          diagnostics: {
            zipEndpoint: zipSnapshot.endpoint,
            docRecordCount: internalDocRecords.length,
            docRecords: internalDocRecords.slice(0, 8)
          },
          note: 'Captured project text files from Overleaf source ZIP using the current browser session.'
        }
      };
    }

    if (params.allowEditorNavigation === false) {
      return buildPageProjectSnapshot({
        params,
        activePath,
        internalDocRecords,
        docRecordByPath,
        zipSnapshot,
        lightweightOnly: true
      });
    }

    return buildPageProjectSnapshot({
      params,
      activePath,
      internalDocRecords,
      docRecordByPath,
      zipSnapshot,
      lightweightOnly: false
    });
  }

  async function buildPageProjectSnapshot({
    params = {},
    activePath,
    internalDocRecords,
    docRecordByPath,
    zipSnapshot,
    lightweightOnly
  }) {
    const snapshotActivePath = params.allowEditorNavigation === false
      ? getActiveFilePath()
      : activePath;
    const requestedPaths = [
      snapshotActivePath,
      ...(Array.isArray(params.focusFiles) ? params.focusFiles : [])
    ];
    const projectPaths = window.CodexOverleafProjectFiles.collectUniqueTextPaths(
      params.restrictToRequestedPathsOnly === true
        ? requestedPaths
        : [
          ...requestedPaths,
          ...collectProjectTextPaths(snapshotActivePath)
        ],
      80
    );
    const files = [];
    const skipped = [];
    if (zipSnapshot && !zipSnapshot.ok) {
      skipped.push({
        path: 'project.zip',
        reason: zipSnapshot.reason
      });
    }
    let previousSignature = '';

    for (const filePath of projectPaths) {
      if (filePath === snapshotActivePath) {
        const ready = await waitForActiveEditorText(filePath, 5000);
        if (!ready.ok) {
          skipped.push({
            path: filePath,
            reason: ready.reason
          });
          continue;
        }
        files.push({
          path: filePath,
          content: ready.text,
          source: 'active-editor'
        });
        previousSignature = contentSignature(ready.text);
        continue;
      }

      const docRecord = docRecordByPath.get(filePath);
      if (docRecord) {
        const fetched = await fetchOverleafDocContent(docRecord);
        if (fetched.ok) {
          files.push({
            path: filePath,
            content: fetched.content,
            source: fetched.method
          });
          previousSignature = contentSignature(fetched.content);
          continue;
        }
        skipped.push({
          path: filePath,
          reason: fetched.reason
        });
      }

      if (!canOpenInactiveFileForSnapshot(filePath, params, lightweightOnly, docRecord)) {
        skipped.push({
          path: filePath,
          reason: 'Lightweight snapshot skipped opening inactive files'
        });
        continue;
      }

      const opened = await openFileByPath(filePath);
      if (!opened.ok) {
        skipped.push({
          path: filePath,
          reason: opened.reason || 'open failed'
        });
        continue;
      }

      await waitForActiveFile(filePath, 5000);
      const ready = await waitForActiveEditorText(filePath, 7000, {
        notSignature: previousSignature
      });
      if (!ready.ok) {
        skipped.push({
          path: filePath,
          reason: ready.reason
        });
        continue;
      }
      files.push({
        path: filePath,
        content: ready.text,
        source: opened.method || 'file-tree-open'
      });
      previousSignature = contentSignature(ready.text);
    }

    if (params.allowEditorNavigation !== false && activePath && getActiveFilePath() !== activePath) {
      await openFileByPath(activePath);
      await waitForActiveFile(activePath, 5000);
      await waitForActiveEditorText(activePath, 5000);
    }

    if (snapshotActivePath && !files.length && (!lightweightOnly || params.allowZipFallback === false)) {
      files.push({
        path: snapshotActivePath,
        content: readActiveEditorText(),
        source: 'active-editor'
      });
    }

    const requestedPathsComplete = isCompleteProjectSnapshot(files, projectPaths);
    return {
      id: getProjectId(),
      url: window.location.href,
      activePath: snapshotActivePath,
      files,
      capabilities: {
        fullProjectSnapshot: params.restrictToRequestedPathsOnly === true ? false : requestedPathsComplete,
        requestedPathsComplete,
        method: resolvePageSnapshotMethod(files, lightweightOnly),
        skipped,
        diagnostics: {
          docRecordCount: internalDocRecords.length,
          docRecords: internalDocRecords.slice(0, 8)
        },
        note: lightweightOnly
          ? 'Captured current Overleaf text from page/editor state without downloading the source ZIP.'
          : (files.length > 1
            ? 'Captured text project files from Overleaf document data, with editor fallback when needed.'
            : 'Only the active editor was captured; no additional visible text files were detected.')
      }
    };
  }

  async function buildZipOnlyProjectSnapshot(params = {}) {
    const activePath = getActiveFilePath();
    const activeText = readActiveEditorText();

    const zipSnapshot = await fetchProjectZipSnapshot(params);
    if (zipSnapshot.ok && zipSnapshot.files.length) {
      const activeOverlay = buildActiveEditorOverlay(activePath, activeText, {
        allowedPaths: zipSnapshot.files.map(file => file.path)
      });
      const files = filterRequestedSnapshotFiles(
        mergeSnapshotFiles(zipSnapshot.files, activeOverlay),
        params,
        activePath
      );
      const requestedPathsComplete = params.restrictToRequestedPathsOnly === true
        ? isCompleteProjectSnapshot(files, getRequestedSnapshotPaths(params, activePath))
        : true;
      return {
        id: getProjectId(),
        url: window.location.href,
        activePath,
        files,
        capabilities: {
          fullProjectSnapshot: params.restrictToRequestedPathsOnly === true ? false : true,
          requestedPathsComplete,
          method: 'overleaf-zip',
          skipped: zipSnapshot.skipped || [],
          diagnostics: {
            zipEndpoint: zipSnapshot.endpoint,
            docRecordCount: 0,
            docRecords: []
          },
          note: 'Captured project files from Overleaf source ZIP without inspecting or opening the file tree.'
        }
      };
    }

    return {
      id: getProjectId(),
      url: window.location.href,
      activePath,
      files: buildActiveEditorOverlay(activePath, activeText),
      capabilities: {
        fullProjectSnapshot: false,
        method: activePath && window.CodexOverleafProjectFiles.isUsableProjectFileContent(activeText)
          ? 'active-editor-zip-only-fallback'
          : 'zip-only-fallback-empty',
        skipped: [{
          path: 'project.zip',
          reason: zipSnapshot.reason
        }],
        diagnostics: {
          docRecordCount: 0,
          docRecords: []
        },
        note: 'Only the current editor was read because the Overleaf source ZIP was unavailable; no file tree navigation was attempted.'
      }
    };
  }

  function filterZipSnapshotOverlayFiles(zipFiles = [], overlayFiles = []) {
    const zipPaths = new Set((zipFiles || []).map(file => file.path).filter(Boolean));
    return (overlayFiles || []).filter(file => file?.source !== 'active-editor' || zipPaths.has(file.path));
  }

  function getRequestedSnapshotPaths(params = {}, activePath = '') {
    return window.CodexOverleafProjectFiles.collectUniqueTextPaths([
      activePath,
      ...(Array.isArray(params.focusFiles) ? params.focusFiles : [])
    ], 80);
  }

  function filterRequestedSnapshotFiles(files = [], params = {}, activePath = '') {
    if (params.restrictToRequestedPathsOnly !== true) {
      return files;
    }
    const requestedSet = new Set(getRequestedSnapshotPaths(params, activePath));
    return (files || []).filter(file => requestedSet.has(file?.path));
  }

  function buildActiveEditorOverlay(activePath, activeText, options = {}) {
    if (!activePath || !window.CodexOverleafProjectFiles.isUsableProjectFileContent(activeText)) {
      return [];
    }
    if (Array.isArray(options.allowedPaths) && !options.allowedPaths.includes(activePath)) {
      return [];
    }
    return [{
      path: activePath,
      content: activeText,
      source: 'active-editor',
      kind: 'text'
    }];
  }

  function mergeSnapshotFiles(primaryFiles = [], overrideFiles = []) {
    const filesByPath = new Map((primaryFiles || []).map(file => [file.path, { ...file }]));
    for (const file of overrideFiles || []) {
      if (!file?.path || file.kind === 'binary' || typeof file.content !== 'string') {
        continue;
      }
      if (!window.CodexOverleafProjectFiles.isUsableProjectFileContent(file.content)) {
        continue;
      }
      filesByPath.set(file.path, {
        ...(filesByPath.get(file.path) || {}),
        ...file,
        kind: 'text'
      });
    }
    return Array.from(filesByPath.values());
  }

  function resolvePageSnapshotMethod(files, lightweightOnly) {
    if (files.some(file => /^overleaf-doc-fetch/.test(file.source))) {
      return lightweightOnly ? 'overleaf-doc-fetch-lightweight' : 'overleaf-doc-fetch';
    }
    if (files.length > 1) {
      return lightweightOnly ? 'page-text-files-lightweight' : 'open-file-tree-text-files';
    }
    return lightweightOnly ? 'active-editor-lightweight' : 'active-editor';
  }

  function isFocusSnapshotPath(filePath, params = {}) {
    return Array.isArray(params.focusFiles) && params.focusFiles.includes(filePath);
  }

  function canOpenInactiveFileForSnapshot(filePath, params = {}, lightweightOnly, docRecord) {
    if (!lightweightOnly) {
      return true;
    }
    if (docRecord) {
      return true;
    }
    return params.allowEditorNavigation === true && isFocusSnapshotPath(filePath, params);
  }

  function isCompleteProjectSnapshot(files, projectPaths) {
    if (!Array.isArray(projectPaths) || !projectPaths.length) {
      return false;
    }
    const capturedPaths = new Set((files || []).map(file => file.path));
    return projectPaths.every(filePath => capturedPaths.has(filePath));
  }

  async function createCheckpoint(label) {
    const history = findHistoryObject();
    const candidates = [
      history?.labelCurrentVersion,
      history?.createLabel,
      history?.addLabel,
      window._ide?.projectHistoryManager?.labelCurrentVersion,
      window._ide?.historyManager?.labelCurrentVersion,
      window.Overleaf?.history?.labelCurrentVersion
    ].filter(fn => typeof fn === 'function');

    for (const candidate of candidates) {
      try {
        await candidate.call(history || window._ide || window.Overleaf, label);
        return {
          ok: true,
          label,
          method: 'internal-history-function'
        };
      } catch (_error) {
        // Try the next candidate; Overleaf internals vary by deployment.
      }
    }

    return {
      ok: false,
      reason: 'No supported Overleaf checkpoint function was detected'
    };
  }

  async function applyOperations(operations, options = {}) {
    if (options.reviewingPolicy === 'no-trace-undo') {
      return applyOperationsWithNoTraceUndo(operations, options);
    }
    const hasOperations = (operations || []).length > 0;
    const trackReviewingChanges = options.requireReviewing === true && hasOperations;
    let reviewingPolicy = null;
    if (options.requireReviewing === true && hasOperations) {
      const reviewing = await ensureReviewing({ waitMs: 1800 });
      if (!reviewing.ok) {
        return buildReviewingRequiredBlockedResult(operations, reviewing);
      }
    } else if (options.requireEditing === true && hasOperations) {
      const editing = await ensureEditing({ waitMs: 1800 });
      if (!editing.ok) {
        return buildEditingRequiredBlockedResult(operations, editing);
      }
      reviewingPolicy = {
        policy: 'editing-write',
        disabled: editing.activated === true,
        leftEditing: true,
        reason: editing.activated ? 'switched_to_editing_before_write' : 'editing_already_confirmed',
        disable: summarizeReviewingToggleResult({
          ok: true,
          changed: editing.activated === true,
          enabled: false,
          reason: editing.activated ? 'Switched to Editing before untracked write.' : 'Editing already confirmed before untracked write.'
        })
      };
    }
    const result = await applyOperationsCore(operations, {
      ...options,
      trackReviewingChanges
    });
    return reviewingPolicy
      ? {
        ...result,
        reviewingPolicy
      }
      : result;
  }

  async function applyOperationsWithNoTraceUndo(operations, options = {}) {
    const initial = getReviewingState({});
    if (isEditingConfirmedForNoTraceUndo(initial)) {
      const result = await applyOperationsCore(operations, options);
      return {
        ...result,
        reviewingPolicy: {
          policy: 'no-trace-undo',
          disabled: false,
          restored: false,
          reason: 'editing_already_confirmed'
        }
      };
    }

    const disabled = await setReviewingEnabled(false, { waitMs: 1800 });
    if (!disabled.ok) {
      return buildNoTraceUndoBlockedResult(operations, disabled);
    }

    let result;
    let applyError = null;
    try {
      result = await applyOperationsCore(operations, options);
    } catch (error) {
      applyError = error;
    }
    if (applyError) {
      throw applyError;
    }

    return {
      ...result,
      reviewingPolicy: {
        policy: 'no-trace-undo',
        disabled: true,
        restored: false,
        leftEditing: true,
        reason: 'left_editing_after_undo',
        disable: summarizeReviewingToggleResult(disabled)
      }
    };
  }

  async function applyOperationsCore(operations, options = {}) {
    const applied = [];
    const skipped = [];
    const trackedChanges = [];
    const safeBaseFiles = normalizeBaseFilesForSafety(options.baseFiles);
    const baseFileLookup = window.CodexOverleafStaleGuard?.buildBaseFileLookup(safeBaseFiles);
    const baseBinaryFileLookup = buildBaseBinaryFileLookup(safeBaseFiles);

    for (const rawOperation of operations) {
      const operation = normalizeOperationPaths(rawOperation);
      const pathSafety = validateOperationProjectPaths(operation);
      if (!pathSafety.ok) {
        skipped.push({ operation, result: pathSafety });
        continue;
      }
      if (operation.type === 'edit') {
        const result = await applyEditOperation(operation, {
          baseFileLookup,
          trackReviewingChanges: options.trackReviewingChanges === true
        });
        if (result.ok && Array.isArray(result.trackedChanges)) {
          trackedChanges.push(...result.trackedChanges);
        }
        (result.ok ? applied : skipped).push({ operation, result });
      } else if (['binary-create', 'overwrite-binary'].includes(operation.type)) {
        const result = await applyBinaryAssetOperation(operation, { baseFileLookup, baseBinaryFileLookup });
        (result.ok ? applied : skipped).push({ operation, result });
      } else if (['create', 'rename', 'move', 'delete'].includes(operation.type)) {
        const result = await applyFileTreeOperation(operation, { baseFileLookup });
        (result.ok ? applied : skipped).push({ operation, result });
      } else {
        skipped.push({
          operation,
          result: {
            ok: false,
            reason: `Unsupported operation type: ${operation.type}`
          }
        });
      }
    }

    if (applied.length > 0) {
      compileBridge.markSourceEdited();
    }

    return {
      ok: skipped.length === 0,
      applied,
      skipped,
      trackedChanges: mergeTrackedChangeRefs(trackedChanges)
    };
  }

  async function rejectTrackedChanges(params = {}) {
    const trackedChanges = normalizeTrackedChangeRefs(params.trackedChanges || []);
    const expectedFiles = Array.isArray(params.expectedFiles) ? params.expectedFiles : [];
    const postFiles = Array.isArray(params.postFiles) ? params.postFiles : [];
    const applied = [];
    const skipped = [];
    const appliedPaths = new Set();
    const invalidTrackedChange = trackedChanges.find(trackedChange => trackedChange.invalidProjectPath);
    if (invalidTrackedChange) {
      return {
        ok: false,
        applied,
        skipped: [{
          trackedChange: invalidTrackedChange,
          result: invalidProjectPathResult('tracked-change path')
        }]
      };
    }

    const editorUndo = await rejectTrackedChangesViaEditorUndo(expectedFiles, postFiles, applied);
    if (editorUndo.ok) {
      if (applied.length > 0) {
        compileBridge.markSourceEdited();
      }
      return {
        ok: true,
        applied,
        skipped
      };
    }
    if (editorUndo.attempted) {
      skipped.push({
        trackedChange: null,
        result: editorUndo
      });
      if (applied.length > 0) {
        compileBridge.markSourceEdited();
      }
      return {
        ok: false,
        applied,
        skipped
      };
    }

    if (!trackedChanges.length) {
      return {
        ok: false,
        applied,
        skipped: [{
          trackedChange: null,
          result: {
            ok: false,
            code: 'missing_tracked_changes',
            reason: '这轮写入没有可识别的 Overleaf 留痕记录；为避免制造新的红线，Codex 没有执行文本补丁撤销。'
          }
        }]
      };
    }

    for (const trackedChange of orderTrackedChangesForReject(trackedChanges)) {
      if (trackedChange.path && getActiveFilePath() !== trackedChange.path) {
        const opened = await openFileByPath(trackedChange.path);
        if (!opened.ok) {
          if (expectedFiles.length || trackedChange.path) {
            continue;
          }
          skipped.push({
            trackedChange,
            result: {
              ok: false,
              code: 'tracked_change_file_open_failed',
              reason: `无法打开 ${trackedChange.path} 来查找这轮写入的留痕记录；Codex 没有用文本补丁伪撤销。`
            }
          });
          continue;
        }
      }

      let node = findTrackedChangeNode(trackedChange);
      let actualTrackedChange = trackedChange;
      if (!node && trackedChange.path && appliedPaths.has(trackedChange.path)) {
        node = findNextTrackedChangeNodeForPath(trackedChange.path);
        if (node) {
          actualTrackedChange = trackedChangeRefFromNode(node, trackedChange.path);
        }
      }
      if (!node) {
        if (expectedFiles.length || trackedChange.path) {
          continue;
        }
        skipped.push({
          trackedChange,
          result: {
            ok: false,
            code: 'tracked_change_not_found',
            reason: '没有在 Overleaf 页面里找到这轮写入对应的留痕记录；Codex 没有用文本补丁伪撤销。'
          }
        });
        continue;
      }

      const rejectControl = findRejectControlForTrackedChangeNode(node);
      if (!rejectControl) {
        if (expectedFiles.length || trackedChange.path) {
          continue;
        }
        skipped.push({
          trackedChange,
          result: {
            ok: false,
            code: 'tracked_change_reject_control_not_found',
            reason: '找到了这轮写入的留痕记录，但没有找到对应的 Reject/拒绝按钮；Codex 没有用文本补丁伪撤销。'
          }
        });
        continue;
      }

      clickNode(rejectControl);
      await delay(180);

      if (findTrackedChangeNode(trackedChange)) {
        if (expectedFiles.length || trackedChange.path) {
          continue;
        }
        skipped.push({
          trackedChange,
          result: {
            ok: false,
            code: 'tracked_change_reject_not_confirmed',
            reason: 'Codex 点击了 Reject/拒绝，但 Overleaf 页面仍显示这条留痕记录；请在 Overleaf 审阅面板手动拒绝。'
          }
        });
        continue;
      }

      applied.push({
        trackedChange: actualTrackedChange,
        result: {
          ok: true,
          method: 'overleaf-review-reject'
        }
      });
      if (actualTrackedChange.path) {
        appliedPaths.add(actualTrackedChange.path);
      }
    }

    if (expectedFiles.length) {
      const completion = await rejectRemainingTrackedChangesForExpectedFiles(expectedFiles, applied);
      if (!completion.ok) {
        skipped.push({
          trackedChange: null,
          result: completion
        });
      }
    } else {
      const completion = await rejectRemainingTrackedChangesForTrackedPaths(trackedChanges, applied);
      if (!completion.ok) {
        skipped.push({
          trackedChange: null,
          result: completion
        });
      }
    }

    if (applied.length > 0) {
      compileBridge.markSourceEdited();
    }

    return {
      ok: skipped.length === 0,
      applied,
      skipped
    };
  }

  async function rejectTrackedChangesViaEditorUndo(expectedFiles, postFiles, applied) {
    const expectedByPath = new Map((expectedFiles || [])
      .filter(file => file?.path && typeof file.content === 'string')
      .map(file => [normalizeSafeProjectPath(file.path), file.content])
      .filter(([path]) => path));
    const postByPath = new Map((postFiles || [])
      .filter(file => file?.path && typeof file.content === 'string')
      .map(file => [normalizeSafeProjectPath(file.path), file.content])
      .filter(([path]) => path));
    const paths = Array.from(expectedByPath.keys()).filter(path => postByPath.has(path));
    if (!paths.length) {
      return { ok: false, attempted: false };
    }

    for (const path of paths) {
      if (path && getActiveFilePath() !== path) {
        const opened = await openFileByPath(path);
        if (!opened.ok) {
          return {
            ok: false,
            attempted: false,
            code: 'tracked_change_editor_undo_open_failed',
            reason: `无法打开 ${path} 来执行 Overleaf 原生撤销。`
          };
        }
      }

      const current = readActiveEditorText();
      const postContent = postByPath.get(path);
      if (current !== postContent) {
        return {
          ok: false,
          attempted: false,
          code: 'tracked_change_editor_undo_current_mismatch',
          reason: `${path} 当前内容已经不是本轮写入后的内容；为避免撤掉你的后续修改，Codex 不使用 Overleaf 原生撤销。`
        };
      }

      const result = await undoEditorHistoryUntilContent(expectedByPath.get(path), path);
      if (!result.ok) {
        return result;
      }
      applied.push({
        trackedChange: {
          path,
          key: `editor-undo:${path}`,
          id: '',
          label: `Overleaf editor undo (${result.clicks} step${result.clicks === 1 ? '' : 's'})`
        },
        result: {
          ok: true,
          method: 'overleaf-editor-undo',
          undoClicks: result.clicks
        }
      });
    }

    return { ok: true, attempted: true };
  }

  async function undoEditorHistoryUntilContent(expectedContent, path) {
    const maxClicks = 200;
    for (let clicks = 0; clicks <= maxClicks; clicks += 1) {
      if (readActiveEditorText() === expectedContent) {
        return {
          ok: true,
          attempted: clicks > 0,
          clicks
        };
      }
      if (clicks === maxClicks) {
        break;
      }

      const undoControl = findEditorUndoControl();
      if (!undoControl) {
        return {
          ok: false,
          attempted: clicks > 0,
          code: 'editor_undo_control_not_found',
          reason: `没有找到 Overleaf 编辑器自己的 Undo/撤销按钮，无法一次性撤销 ${path} 的本轮留痕。`
        };
      }

      const beforeText = readActiveEditorText();
      clickNode(undoControl);
      await waitForEditorTextProgress(beforeText, expectedContent, 1000);
      if (readActiveEditorText() === beforeText) {
        return {
          ok: false,
          attempted: clicks > 0,
          code: 'editor_undo_no_progress',
          reason: `Codex 点击了 Overleaf Undo/撤销，但 ${path} 内容没有变化。`
        };
      }
    }

    return {
      ok: false,
      attempted: true,
      code: 'editor_undo_max_iterations',
      reason: `${path} 经过多次 Overleaf 原生撤销后仍未回到本轮写入前内容，已停止以避免撤销其它修改。`
    };
  }

  async function waitForEditorTextProgress(beforeText, expectedContent, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const current = readActiveEditorText();
      if (current !== beforeText || current === expectedContent) {
        return true;
      }
      await delay(60);
    }
    return false;
  }

  async function rejectRemainingTrackedChangesForExpectedFiles(expectedFiles, applied) {
    for (const file of expectedFiles || []) {
      if (!file?.path || typeof file.content !== 'string') {
        continue;
      }
      const result = await rejectRemainingTrackedChangesForExpectedFile(file, applied);
      if (!result.ok) {
        return result;
      }
    }
    return { ok: true };
  }

  async function rejectRemainingTrackedChangesForTrackedPaths(trackedChanges, applied) {
    const paths = Array.from(new Set((trackedChanges || [])
      .map(change => normalizeSafeProjectPath(change?.path || ''))
      .filter(Boolean)));
    if (!paths.length) {
      const activePath = normalizeSafeProjectPath(getActiveFilePath());
      if (!activePath || !applied.length) {
        return { ok: true };
      }
      paths.push(activePath);
    }

    for (const path of paths) {
      const result = await rejectRemainingTrackedChangesForPath(path, applied);
      if (!result.ok) {
        return result;
      }
    }
    return { ok: true };
  }

  async function rejectRemainingTrackedChangesForPath(path, applied) {
    if (path && getActiveFilePath() !== path) {
      const opened = await openFileByPath(path);
      if (!opened.ok) {
        return {
          ok: false,
          code: 'tracked_change_file_open_failed',
          reason: `无法打开 ${path} 来继续拒绝这轮留痕记录；请在 Overleaf 审阅面板手动处理。`
        };
      }
    }

    const appliedCountBefore = applied.length;
    const maxAttempts = 200;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const node = findLastTrackedChangeNodeForPath(path);
      if (!node) {
        if (applied.length > appliedCountBefore) {
          return { ok: true };
        }
        return {
          ok: false,
          code: 'tracked_change_not_found',
          reason: '没有在 Overleaf 页面里找到这轮写入对应的留痕记录；Codex 没有用文本补丁伪撤销。'
        };
      }

      const rejectControl = findRejectControlForTrackedChangeNode(node);
      if (!rejectControl) {
        return {
          ok: false,
          code: 'tracked_change_reject_control_not_found',
          reason: `还有 ${path || '当前文件'} 的留痕记录未处理，但没有找到对应的 Reject/拒绝按钮；请在 Overleaf 审阅面板手动拒绝。`
        };
      }

      const trackedChange = trackedChangeRefFromNode(node, path);
      const beforeText = readActiveEditorText();
      clickNode(rejectControl);
      await waitForTrackedChangeRejectProgress(trackedChange, path, beforeText, 1200);
      applied.push({
        trackedChange,
        result: {
          ok: true,
          method: 'overleaf-review-reject-sweep'
        }
      });
    }

    return {
      ok: false,
      code: 'tracked_change_undo_max_iterations',
      reason: `${path || '当前文件'} 仍有未完成的留痕记录；Codex 已停止以避免误拒绝其它改动。`
    };
  }

  async function rejectRemainingTrackedChangesForExpectedFile(file, applied) {
    const opened = await openFileByPath(file.path);
    if (!opened.ok) {
      return {
        ok: false,
        code: 'tracked_change_undo_verify_open_failed',
        reason: `撤销后无法打开 ${file.path} 验证内容；请刷新 Overleaf 后检查。`
      };
    }

    const appliedCountBefore = applied.length;
    const maxAttempts = 200;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const node = findLastTrackedChangeNodeForPath(file.path);
      if (!node) {
        const verified = await verifyActiveEditorText(file.content, file.path, 800);
        if (verified.ok) {
          return { ok: true };
        }
        const rejectedAnyForFile = applied.length > appliedCountBefore;
        return {
          ...verified,
          code: rejectedAnyForFile ? 'tracked_change_undo_verify_failed' : 'tracked_change_not_found',
          reason: rejectedAnyForFile
            ? `${file.path} 拒绝留痕后内容没有回到写入前状态；请在 Overleaf 审阅面板检查这轮修改。`
            : '没有在 Overleaf 页面里找到这轮写入对应的留痕记录；Codex 没有用文本补丁伪撤销。'
        };
      }

      const rejectControl = findRejectControlForTrackedChangeNode(node);
      if (!rejectControl) {
        return {
          ok: false,
          code: 'tracked_change_reject_control_not_found',
          reason: `还有 ${file.path} 的留痕记录未处理，但没有找到对应的 Reject/拒绝按钮；请在 Overleaf 审阅面板手动拒绝。`
        };
      }

      const trackedChange = trackedChangeRefFromNode(node, file.path);
      const beforeText = readActiveEditorText();
      clickNode(rejectControl);
      await waitForTrackedChangeRejectProgress(trackedChange, file.path, beforeText, 1200);
      applied.push({
        trackedChange,
        result: {
          ok: true,
          method: 'overleaf-review-reject-sweep'
        }
      });
    }

    return {
      ok: false,
      code: 'tracked_change_undo_max_iterations',
      reason: `${file.path} 仍有未完成的留痕记录；Codex 已停止以避免误拒绝其它改动。`
    };
  }

  async function waitForTrackedChangeRejectProgress(trackedChange, path, beforeText, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const currentText = readActiveEditorText();
      if (currentText !== beforeText) {
        return true;
      }
      if (trackedChange?.key && !findTrackedChangeNode({ ...trackedChange, path })) {
        return true;
      }
      await delay(80);
    }
    return false;
  }

  function buildNoTraceUndoBlockedResult(operations, disabled) {
    return {
      ok: false,
      applied: [],
      skipped: (operations || []).map(rawOperation => ({
        operation: normalizeOperationPaths(rawOperation),
        result: {
          ok: false,
          code: disabled?.code || 'reviewing_disable_failed',
          reason: disabled?.reason || '无法确认 Overleaf Reviewing/Track Changes 已关闭；为避免撤销也留下新的留痕，Codex 没有执行撤销。'
        }
      })),
      reviewingPolicy: {
        policy: 'no-trace-undo',
        disabled: false,
        restored: false,
        disable: summarizeReviewingToggleResult(disabled)
      }
    };
  }

  function buildReviewingRequiredBlockedResult(operations, reviewing) {
    return {
      ok: false,
      applied: [],
      skipped: (operations || []).map(rawOperation => ({
        operation: normalizeOperationPaths(rawOperation),
        result: {
          ok: false,
          code: reviewing?.code || 'reviewing_not_enabled',
          reason: reviewing?.reason || 'Overleaf Reviewing/Track Changes was not confirmed before writing. Codex did not change this file.',
          reviewing: reviewing?.reviewing || null
        }
      })),
      reviewing
    };
  }

  function buildEditingRequiredBlockedResult(operations, editing) {
    return {
      ok: false,
      applied: [],
      skipped: (operations || []).map(rawOperation => ({
        operation: normalizeOperationPaths(rawOperation),
        result: {
          ok: false,
          code: editing?.code || 'editing_not_confirmed',
          reason: editing?.reason || 'Overleaf Editing mode was not confirmed before writing. Codex did not change this file.',
          reviewing: editing?.reviewing || null
        }
      })),
      reviewing: editing
    };
  }

  async function applyEditOperation(operation, options = {}) {
    const currentPath = getActiveFilePath();
    let openedEditorText = null;
    if (operation.path && currentPath && operation.path !== currentPath) {
      const previousEditorSignature = contentSignature(readActiveEditorText());
      const opened = await openFileByPath(operation.path);
      if (!opened.ok) {
        return {
          ok: false,
          reason: `Cannot edit ${operation.path}; active file is ${currentPath}; ${opened.reason}`
        };
      }
      const ready = await waitForActiveEditorText(operation.path, 2500, {
        notSignature: previousEditorSignature
      });
      if (!ready.ok) {
        return {
          ok: false,
          code: 'editor_content_not_ready',
          reason: `Cannot edit ${operation.path}; Overleaf selected the file but the editor content did not finish loading. Please retry after the file finishes opening.`
        };
      }
      openedEditorText = ready.text;
    }

    const trackReviewingChanges = options.trackReviewingChanges === true;
    const trackedBefore = trackReviewingChanges
      ? collectTrackedChangeRefsForPaths(collectOperationPaths([operation]))
      : [];
    const current = openedEditorText ?? readActiveEditorText();
    const freshness = window.CodexOverleafStaleGuard?.checkOperationFreshness(
      operation,
      current,
      options.baseFileLookup
    ) || { ok: true };
    if (!freshness.ok) {
      return freshness;
    }

    let nextContent = null;
    if (Array.isArray(operation.patches) && operation.patches.length) {
      const patched = applyTextPatches(current, operation.patches);
      if (!patched.ok) {
        return patched;
      }
      nextContent = patched.text;
    } else if (typeof operation.replaceAll === 'string') {
      nextContent = operation.replaceAll;
    } else if (typeof operation.find === 'string' && typeof operation.replace === 'string') {
      if (!current.includes(operation.find)) {
        return {
          ok: false,
          reason: 'Find text was not present in the active editor'
        };
      }
      nextContent = current.split(operation.find).join(operation.replace);
    } else {
      return {
        ok: false,
        reason: 'Edit operation must provide patches, replaceAll, or find/replace fields'
      };
    }

    const result = Array.isArray(operation.patches) && operation.patches.length
      ? replaceActiveEditorPatches(operation.patches, nextContent)
      : replaceActiveEditorText(nextContent);
    if (!result.ok) {
      return result;
    }

    const verified = await verifyActiveEditorText(nextContent, operation.path);
    if (!verified.ok) {
      return verified;
    }
    const trackedChanges = [];
    if (trackReviewingChanges) {
      await delay(120);
      const trackedAfter = collectTrackedChangeRefsForPaths(collectOperationPaths([operation]));
      trackedChanges.push(...diffTrackedChangeRefs(trackedBefore, trackedAfter));
    }
    window.CodexOverleafStaleGuard?.updateExpectedFileContent(
      options.baseFileLookup,
      operation.path,
      nextContent
    );
    return {
      ...result,
      verified: true,
      verifiedContent: nextContent,
      trackedChanges: mergeTrackedChangeRefs(trackedChanges)
    };
  }

  async function verifyActiveEditorText(expected, filePath, waitMs = 1000) {
    const deadline = Date.now() + waitMs;
    let actual = readActiveEditorText();
    while (actual !== expected && Date.now() < deadline) {
      await delay(50);
      actual = readActiveEditorText();
    }
    if (actual === expected) {
      return {
        ok: true
      };
    }
    return {
      ok: false,
      code: 'write_verification_failed',
      reason: `${filePath || '当前文件'} 写入后读回内容和 Codex 预期不一致，已停止把这次操作标记为成功。请刷新 Overleaf 后重试。`,
      expectedLength: String(expected || '').length,
      actualLength: String(actual || '').length
    };
  }

  function applyTextPatches(text, patches) {
    const normalized = normalizeTextPatches(patches, text.length);
    if (!normalized.ok) {
      return normalized;
    }

    let next = text;
    for (const patch of normalized.patches.slice().sort((left, right) => right.from - left.from)) {
      if (next.slice(patch.from, patch.to) !== patch.expected) {
        return {
          ok: false,
          code: 'stale_patch',
          reason: '这处内容已经和 Codex 读取时不同，所以没有写入。请重新运行，让 Codex 先读取你的最新 Overleaf 内容。'
        };
      }
      next = next.slice(0, patch.from) + patch.insert + next.slice(patch.to);
    }
    return {
      ok: true,
      text: next,
      patches: normalized.patches
    };
  }

  function normalizeTextPatches(patches, length) {
    const normalized = [];
    let previousTo = 0;
    for (const rawPatch of patches || []) {
      const from = Number(rawPatch?.from);
      const to = Number(rawPatch?.to);
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > length) {
        return {
          ok: false,
          code: 'invalid_patch',
          reason: 'Codex 生成的局部写入范围无效。'
        };
      }
      if (from < previousTo) {
        return {
          ok: false,
          code: 'invalid_patch',
          reason: 'Codex 生成的局部写入范围有重叠。'
        };
      }
      previousTo = to;
      normalized.push({
        from,
        to,
        expected: String(rawPatch.expected ?? ''),
        insert: String(rawPatch.insert ?? '')
      });
    }
    return {
      ok: true,
      patches: normalized
    };
  }

  async function applyBinaryAssetOperation(operation, options = {}) {
    const freshness = await checkBinaryAssetFreshness(operation, options);
    if (!freshness.ok) {
      return freshness;
    }

    const bytes = decodeBase64Bytes(operation.contentBase64);
    if (!bytes.ok) {
      return bytes;
    }

    const manager = findFileTreeManager();
    const file = createAssetFile(operation.path, bytes.bytes);
    const methodNames = ['uploadFile', 'uploadAsset', 'createBinaryFile', 'createFile', 'addFile'];
    for (const methodName of methodNames) {
      const method = manager?.[methodName];
      if (typeof method !== 'function') {
        continue;
      }
      try {
        if (operation.type === 'overwrite-binary' && projectPathExists(operation.path)) {
          await method.call(manager, operation.path, file, { overwrite: true });
        } else {
          await method.call(manager, operation.path, file);
        }
        await delay(120);
        if (!projectPathExists(operation.path)) {
          return {
            ok: false,
            code: 'binary_asset_verification_failed',
            reason: `${operation.path} did not appear in the Overleaf file tree after binary asset upload.`
          };
        }
        return {
          ok: true,
          method: `fileTreeManager.${methodName}`,
          verified: true,
          binaryAsset: true
        };
      } catch (_error) {
        // Try the next known Overleaf file upload method.
      }
    }

    return {
      ok: false,
      code: 'binary_asset_write_unsupported',
      reason: 'No supported Overleaf binary asset upload method was detected. The asset was not written.'
    };
  }

  async function checkBinaryAssetFreshness(operation, options = {}) {
    const baseFileLookup = options.baseFileLookup;
    const baseBinaryFileLookup = options.baseBinaryFileLookup;
    if (!operation?.path) {
      return {
        ok: false,
        code: 'missing_operation_path',
        reason: 'Cannot safely write a binary asset without a target path.'
      };
    }
    if (operation.type === 'binary-create' && projectPathExists(operation.path)) {
      return {
        ok: false,
        code: 'path_created_since_snapshot',
        reason: `${operation.path} already exists in Overleaf. Codex did not overwrite it as a new asset.`
      };
    }
    if (operation.type === 'overwrite-binary' && baseFileLookup && !baseFileLookup.has(operation.path)) {
      return {
        ok: false,
        code: 'missing_base_file',
        reason: `${operation.path} was not present in the run baseline. Codex did not overwrite it.`
      };
    }
    if (operation.type === 'overwrite-binary' && !projectPathExists(operation.path)) {
      return {
        ok: false,
        code: 'missing_current_binary_asset',
        reason: `${operation.path} no longer exists in Overleaf. Codex did not overwrite it.`
      };
    }
    if (operation.type === 'overwrite-binary') {
      const baseBinaryFile = baseBinaryFileLookup?.get(operation.path);
      if (!baseBinaryFile) {
        return {
          ok: false,
          code: 'missing_binary_base_content',
          reason: `${operation.path} did not have binary baseline content. Codex did not overwrite it.`
        };
      }
      const currentBinaryFile = await getCurrentBinaryAssetFile(operation.path);
      if (!currentBinaryFile.ok) {
        return currentBinaryFile;
      }
      if (!binaryAssetMatchesBaseline(baseBinaryFile, currentBinaryFile.file)) {
        return {
          ok: false,
          code: 'stale_binary_asset',
          reason: `${operation.path} changed in Overleaf after the baseline. Codex did not overwrite it.`
        };
      }
    }
    return { ok: true };
  }

  function buildBaseBinaryFileLookup(files) {
    if (!Array.isArray(files) || !files.length) {
      return null;
    }
    const lookup = new Map();
    for (const file of files) {
      if (!file?.path || typeof file.contentBase64 !== 'string') {
        continue;
      }
      const filePath = normalizeSafeProjectPath(file.path);
      if (!filePath) {
        continue;
      }
      lookup.set(filePath, {
        contentBase64: normalizeBase64(file.contentBase64),
        size: Number.isFinite(Number(file.size)) ? Number(file.size) : null
      });
    }
    return lookup.size ? lookup : null;
  }

  async function getCurrentBinaryAssetFile(filePath) {
    try {
      const project = await projectSnapshotBridge.getProjectSnapshot({
        zipOnly: true,
        includeBinaryFiles: true,
        force: true,
        maxAgeMs: 0
      });
      const normalizedPath = normalizeSafeProjectPath(filePath);
      const file = (project?.files || []).find(item =>
        normalizeSafeProjectPath(item?.path) === normalizedPath
      );
      if (!file || typeof file.contentBase64 !== 'string') {
        return {
          ok: false,
          code: 'current_binary_asset_unavailable',
          reason: `${filePath} could not be verified from a fresh Overleaf ZIP snapshot. Codex did not overwrite it.`
        };
      }
      return { ok: true, file };
    } catch (error) {
      return {
        ok: false,
        code: 'current_binary_asset_unavailable',
        reason: `${filePath} could not be verified before overwrite: ${error.message}`
      };
    }
  }

  function binaryAssetMatchesBaseline(baseFile, currentFile) {
    if (!baseFile || !currentFile) {
      return false;
    }
    const baseContent = normalizeBase64(baseFile.contentBase64);
    const currentContent = normalizeBase64(currentFile.contentBase64);
    if (!baseContent || baseContent !== currentContent) {
      return false;
    }
    const currentSize = Number.isFinite(Number(currentFile.size)) ? Number(currentFile.size) : null;
    return baseFile.size == null || currentSize == null || baseFile.size === currentSize;
  }

  function normalizeBase64(value) {
    return String(value || '').replace(/\s+/g, '');
  }

  function decodeBase64Bytes(contentBase64) {
    try {
      const binary = window.atob(String(contentBase64 || ''));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return { ok: true, bytes };
    } catch (_error) {
      return {
        ok: false,
        code: 'invalid_binary_asset_content',
        reason: 'Binary asset content was not valid base64.'
      };
    }
  }

  function createAssetFile(filePath, bytes) {
    const name = String(filePath || '').split('/').filter(Boolean).pop() || 'asset';
    const type = inferAssetMimeType(filePath);
    if (typeof File === 'function') {
      return new File([bytes], name, { type });
    }
    return new Blob([bytes], { type });
  }

  function inferAssetMimeType(filePath) {
    const normalized = String(filePath || '').toLowerCase();
    if (normalized.endsWith('.pdf')) {
      return 'application/pdf';
    }
    if (normalized.endsWith('.png')) {
      return 'image/png';
    }
    if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) {
      return 'image/jpeg';
    }
    if (normalized.endsWith('.svg')) {
      return 'image/svg+xml';
    }
    return 'application/octet-stream';
  }

  async function applyFileTreeOperation(operation, options = {}) {
    const freshness = await checkFileTreeOperationFreshness(operation, options.baseFileLookup);
    if (!freshness.ok) {
      return freshness;
    }

    const manager = findFileTreeManager();
    const methodNames = fileTreeMethodNames(operation.type);

    for (const methodName of methodNames) {
      const method = manager?.[methodName];
      if (typeof method !== 'function') {
        continue;
      }

      try {
        if (operation.type === 'create') {
          await method.call(manager, operation.path, operation.content || '');
        } else if (operation.type === 'rename' || operation.type === 'move') {
          await method.call(manager, operation.path, operation.to);
        } else if (operation.type === 'delete') {
          await method.call(manager, operation.path);
        }
        const verified = await verifyFileTreeOperation(operation);
        if (!verified.ok) {
          return verified;
        }
        recordFileTreeOperationSuccess(operation, options.baseFileLookup);
        return {
          ok: true,
          method: `fileTreeManager.${methodName}`,
          verified: true
        };
      } catch (_error) {
        // Try the next known method name.
      }
    }

    return {
      ok: false,
      reason: 'No supported Overleaf file-tree method was detected'
    };
  }

  async function verifyFileTreeOperation(operation) {
    await delay(120);
    const sourcePath = operation.path;
    const targetPath = operation.to;

    if (operation.type === 'create') {
      if (!projectPathExists(sourcePath)) {
        return fileTreeVerificationFailed(operation, `${sourcePath} 没有出现在 Overleaf 文件树中。`);
      }
      if (typeof operation.content === 'string' && window.CodexOverleafProjectFiles.isTextProjectPath(sourcePath)) {
        const opened = await openFileByPath(sourcePath);
        if (!opened.ok) {
          return fileTreeVerificationFailed(operation, `${sourcePath} 创建后无法打开验证内容。`);
        }
        const verified = await verifyActiveEditorText(operation.content, sourcePath, 600);
        if (!verified.ok) {
          return fileTreeVerificationFailed(operation, `${sourcePath} 创建后内容没有和 Codex 预期一致。`);
        }
      }
      return { ok: true };
    }

    if (operation.type === 'delete') {
      return projectPathExists(sourcePath)
        ? fileTreeVerificationFailed(operation, `${sourcePath} 仍然存在。`)
        : { ok: true };
    }

    if (operation.type === 'rename' || operation.type === 'move') {
      if (!targetPath || !projectPathExists(targetPath)) {
        return fileTreeVerificationFailed(operation, `${targetPath || '目标路径'} 没有出现在 Overleaf 文件树中。`);
      }
      if (projectPathExists(sourcePath)) {
        return fileTreeVerificationFailed(operation, `${sourcePath} 仍然存在。`);
      }
      return { ok: true };
    }

    return { ok: true };
  }

  function fileTreeVerificationFailed(operation, reason) {
    return {
      ok: false,
      code: 'file_tree_verification_failed',
      reason: `Overleaf 文件树操作没有被确认：${reason} Codex 已停止把这次操作标记为成功。`,
      operationType: operation?.type || '',
      path: operation?.path || '',
      to: operation?.to || ''
    };
  }

  async function checkFileTreeOperationFreshness(operation, baseFileLookup) {
    if (!baseFileLookup) {
      return { ok: true };
    }

    if (!operation.path) {
      return {
        ok: false,
        code: 'missing_operation_path',
        reason: `Cannot safely ${operation.type || 'modify'} a file without a target path.`
      };
    }

    if (operation.type === 'create') {
      if (baseFileLookup.has(operation.path)) {
        return {
          ok: false,
          code: 'path_exists_in_snapshot',
          reason: `${operation.path} 在任务开始前已经存在。Codex 没有覆盖它；请改用修改文件或换一个文件名。`
        };
      }
      if (projectPathExists(operation.path)) {
        return {
          ok: false,
          code: 'path_created_since_snapshot',
          reason: `${operation.path} 在任务执行期间被你或协作者新建了，Codex 没有覆盖它。请查看差异后重试。`
        };
      }
      return { ok: true };
    }

    if (!baseFileLookup.has(operation.path)) {
      return {
        ok: false,
        code: 'missing_base_file',
        reason: `${operation.path} 在任务开始时没有被 Codex 读到。Codex 没有覆盖它；请刷新项目内容后重试。`
      };
    }

    const current = await readCurrentTextFileForFreshness(operation.path);
    if (!current.ok) {
      return current;
    }

    const freshness = window.CodexOverleafStaleGuard?.checkOperationFreshness(
      { type: 'edit', path: operation.path },
      current.text,
      baseFileLookup
    ) || { ok: true };
    if (!freshness.ok) {
      return freshness;
    }

    if ((operation.type === 'rename' || operation.type === 'move') && operation.to) {
      if (baseFileLookup.has(operation.to) || projectPathExists(operation.to)) {
        return {
          ok: false,
          code: 'destination_exists',
          reason: `Cannot safely ${operation.type} ${operation.path} to ${operation.to} because the destination already exists.`
        };
      }
    }

    return { ok: true };
  }

  async function readCurrentTextFileForFreshness(filePath) {
    const currentPath = getActiveFilePath();
    if (filePath && currentPath && filePath !== currentPath) {
      const opened = await openFileByPath(filePath);
      if (!opened.ok) {
        return {
          ok: false,
          code: 'cannot_verify_current_file',
          reason: `Cannot safely verify ${filePath}; ${opened.reason || 'open failed'}. Re-run Codex on a fresh snapshot.`
        };
      }
    }

    return {
      ok: true,
      text: readActiveEditorText()
    };
  }

  function recordFileTreeOperationSuccess(operation, baseFileLookup) {
    if (!baseFileLookup) {
      return;
    }

    if (operation.type === 'create') {
      window.CodexOverleafStaleGuard?.updateExpectedFileContent(
        baseFileLookup,
        operation.path,
        operation.content || ''
      );
    } else if (operation.type === 'delete') {
      window.CodexOverleafStaleGuard?.removeExpectedFile(baseFileLookup, operation.path);
    } else if (operation.type === 'rename' || operation.type === 'move') {
      window.CodexOverleafStaleGuard?.moveExpectedFile(baseFileLookup, operation.path, operation.to);
    }
  }

  function fileTreeMethodNames(type) {
    return {
      create: ['createDoc', 'createFile', 'addDoc', 'addFile'],
      rename: ['renameEntity', 'renameFile', 'renameDoc'],
      move: ['moveEntity', 'moveFile', 'moveDoc'],
      delete: ['deleteEntity', 'deleteFile', 'deleteDoc', 'removeEntity']
    }[type] || [];
  }

  function normalizeOperationPaths(operation) {
    if (!operation || typeof operation !== 'object') {
      return operation;
    }
    const normalized = {
      ...operation,
      path: typeof operation.path === 'string'
        ? normalizeSafeProjectPath(operation.path)
        : operation.path,
      to: typeof operation.to === 'string'
        ? normalizeSafeProjectPath(operation.to)
        : operation.to
    };
    if (typeof operation.path === 'string' && !normalized.path) {
      normalized.invalidProjectPath = true;
    }
    if (typeof operation.to === 'string' && !normalized.to) {
      normalized.invalidProjectDestinationPath = true;
    }
    return normalized;
  }

  function validateOperationProjectPaths(operation) {
    if (!operation || typeof operation !== 'object') {
      return { ok: true };
    }
    if (operation.invalidProjectPath || (requiresOperationPath(operation) && !operation.path)) {
      return invalidProjectPathResult('operation path');
    }
    if (operation.invalidProjectDestinationPath || (requiresOperationDestinationPath(operation) && !operation.to)) {
      return invalidProjectPathResult('operation destination path');
    }
    return { ok: true };
  }

  function requiresOperationPath(operation) {
    return ['edit', 'create', 'delete', 'rename', 'move', 'binary-create', 'overwrite-binary'].includes(operation.type);
  }

  function requiresOperationDestinationPath(operation) {
    return operation.type === 'rename' || operation.type === 'move';
  }

  function normalizeBaseFilesForSafety(files) {
    if (!Array.isArray(files)) {
      return files;
    }
    return files
      .map(file => {
        if (!file || typeof file.path !== 'string') {
          return null;
        }
        const filePath = normalizeSafeProjectPath(file.path);
        return filePath ? { ...file, path: filePath } : null;
      })
      .filter(Boolean);
  }

  function collectOperationPaths(operations = []) {
    const paths = new Set();
    for (const rawOperation of operations || []) {
      const operation = normalizeOperationPaths(rawOperation);
      for (const value of [operation?.path, operation?.to]) {
        if (typeof value === 'string' && value) {
          paths.add(value);
        }
      }
    }
    return Array.from(paths);
  }

  function collectTrackedChangeRefsForPaths(paths = []) {
    const pathSet = new Set((paths || []).filter(Boolean));
    const activePath = getActiveFilePath();
    return collectTrackedChangeNodes()
      .map(node => trackedChangeRefFromNode(node, activePath))
      .filter(ref => ref.key)
      .filter(ref => !pathSet.size || !ref.path || pathSet.has(ref.path));
  }

  function collectTrackedChangeNodes() {
    const selector = [
      '[data-change-id]',
      '[data-review-id]',
      '[data-track-change-id]',
      '[data-ol-change-id]',
      '[data-path][class*="change" i]',
      '[class*="track-change" i]',
      '[class*="review-change" i]',
      '[class*="suggest" i]',
      '[aria-label*="change" i]',
      '[title*="change" i]'
    ].join(',');
    return uniqueNodes([
      ...collectElements(selector, 1200),
      ...collectElements('*', 3500).filter(isTrackedChangeNode)
    ]).filter(isTrackedChangeNode);
  }

  function isTrackedChangeNode(node) {
    if (!node || isInsideCodexPanel(node)) {
      return false;
    }
    const signal = normalizeReviewingSignalText(readNodeSignalText(node));
    const tag = (node.tagName || '').toLowerCase();
    if (tag === 'button' && /\b(?:accept|reject|decline|discard|批准|接受|拒绝|丢弃)\b/i.test(signal)) {
      return false;
    }
    if (readTrackedChangeId(node)) {
      return true;
    }
    return /\b(?:tracked change|track change|review change|suggestion|insert(?:ion)?|delet(?:e|ion)|change)\b/i.test(signal)
      || /留痕|建议|插入|删除|更改|修改/.test(signal);
  }

  function trackedChangeRefFromNode(node, fallbackPath = '') {
    const id = readTrackedChangeId(node);
    const key = id ? `id:${id}` : `sig:${compact(readNodeSignalText(node), 180)}`;
    const path = normalizeSafeProjectPath(
      node.getAttribute?.('data-path')
      || node.getAttribute?.('data-file-path')
      || node.getAttribute?.('data-doc-path')
      || fallbackPath
      || ''
    );
    return {
      key,
      id,
      path,
      label: compact(readNodeSignalText(node), 180)
    };
  }

  function readTrackedChangeId(node) {
    for (const attribute of [
      'data-change-id',
      'data-review-id',
      'data-track-change-id',
      'data-ol-change-id',
      'data-id',
      'id'
    ]) {
      const value = node.getAttribute?.(attribute) || '';
      if (value && /\b(?:change|review|track|suggest)|\d|[a-f0-9-]{8,}/i.test(value)) {
        return String(value);
      }
    }
    return '';
  }

  function normalizeTrackedChangeRefs(refs = []) {
    const seen = new Set();
    const normalized = [];
    for (const ref of refs || []) {
      if (!ref || typeof ref !== 'object') {
        continue;
      }
      const key = typeof ref.key === 'string' ? ref.key : '';
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      const hasPath = typeof ref.path === 'string';
      const hasExplicitPath = hasPath && ref.path.trim() !== '';
      const path = hasPath ? normalizeSafeProjectPath(ref.path) : '';
      normalized.push({
        key,
        id: typeof ref.id === 'string' ? ref.id : '',
        path,
        invalidProjectPath: hasExplicitPath && !path,
        label: compact(String(ref.label || ''), 180)
      });
    }
    return normalized;
  }

  function orderTrackedChangesForReject(refs = []) {
    return (refs || []).slice().reverse();
  }

  function diffTrackedChangeRefs(before = [], after = []) {
    const beforeKeys = new Set((before || []).map(ref => ref.key).filter(Boolean));
    const seen = new Set();
    const added = [];
    for (const ref of after || []) {
      if (!ref?.key || beforeKeys.has(ref.key) || seen.has(ref.key)) {
        continue;
      }
      seen.add(ref.key);
      added.push(ref);
    }
    return added;
  }

  function mergeTrackedChangeRefs(refs = []) {
    return normalizeTrackedChangeRefs(refs);
  }

  function findTrackedChangeNode(ref = {}) {
    const targetKey = ref.key || '';
    if (!targetKey || ref.invalidProjectPath) {
      return null;
    }
    return collectTrackedChangeNodes()
      .find(node => trackedChangeRefFromNode(node, ref.path || getActiveFilePath()).key === targetKey)
      || null;
  }

  function findNextTrackedChangeNodeForPath(path) {
    const nodes = findTrackedChangeNodesForPath(path);
    return nodes[0] || null;
  }

  function findLastTrackedChangeNodeForPath(path) {
    const nodes = findTrackedChangeNodesForPath(path);
    return nodes[nodes.length - 1] || null;
  }

  function findTrackedChangeNodesForPath(path) {
    const targetPath = normalizeSafeProjectPath(path || getActiveFilePath());
    return collectTrackedChangeNodes()
      .filter(node => {
        const ref = trackedChangeRefFromNode(node, targetPath);
        return !targetPath || !ref.path || ref.path === targetPath;
      })
  }

  function findRejectControlForTrackedChangeNode(node) {
    const scopes = [];
    let current = node;
    for (let index = 0; current && index < 6; index += 1) {
      scopes.push(current);
      current = current.parentElement;
    }

    for (const scope of scopes) {
      const candidates = typeof scope.querySelectorAll === 'function'
        ? Array.from(scope.querySelectorAll('button,[role="button"],[aria-label],[title]'))
        : [];
      const reject = candidates.find(isRejectTrackedChangeControl);
      if (reject) {
        return reject;
      }
    }
    return isRejectTrackedChangeControl(node) ? node : null;
  }

  function findEditorUndoControl() {
    return collectElements('button,[role="button"],[aria-label],[title]', 1200)
      .find(isEditorUndoControl)
      || null;
  }

  function isEditorUndoControl(node) {
    if (!node || isInsideCodexPanel(node) || node.disabled) {
      return false;
    }
    if (/^(true|disabled)$/i.test(node.getAttribute?.('aria-disabled') || '')) {
      return false;
    }
    const signal = normalizeReviewingSignalText(readNodeSignalText(node));
    if (/\b(?:redo|重做)\b/i.test(signal)) {
      return false;
    }
    return /\bundo\b|撤销/i.test(signal);
  }

  function isRejectTrackedChangeControl(node) {
    if (!node || node.disabled) {
      return false;
    }
    if (/^(true|disabled)$/i.test(node.getAttribute?.('aria-disabled') || '')) {
      return false;
    }
    const signal = normalizeReviewingSignalText(readNodeSignalText(node));
    if (/\b(?:accept|approve|apply|resolve|接受|批准|应用)\b/i.test(signal)) {
      return false;
    }
    return /\b(?:reject|decline|discard|revert|拒绝|丢弃|还原)\b/i.test(signal);
  }

  function collectReviewingSignals(params = {}) {
    const bodyText = document.body?.innerText || '';
    const bodyTextContent = document.body?.textContent || '';
    const controls = collectReviewingControls();
    const internalStates = collectReviewingInternalStates();

    const signals = {
      manualOverride: params.manualOverride === true,
      bodyText: `${bodyText}\n${bodyTextContent}`,
      controls,
      internalStates
    };
    signals.diagnostics = buildReviewingDiagnostics({
      bodyText,
      bodyTextContent,
      controls,
      internalStates
    });
    return signals;
  }

  function collectReviewingControls() {
    const selector = [
      'button',
      '[role="button"]',
      '[aria-label]',
      '[title]',
      '[aria-pressed]',
      '[aria-selected]',
      '[data-testid]',
      '[data-test-id]',
      '[data-qa]',
      '[data-ol-name]',
      '[id*="review" i]',
      '[class*="review" i]',
      '[id*="track" i]',
      '[class*="track" i]'
    ].join(',');
    const selected = collectElements(selector, 1200);
    const reviewLike = collectElements('*', 3500)
      .filter(node => /review|track|suggest/i.test(readNodeSignalText(node)));
    const nodes = uniqueNodes([...selected, ...reviewLike]).slice(0, 1500);
    return nodes.map(toControlSignal);
  }

  function collectElements(selector, limit) {
    const result = [];
    const roots = collectSearchRoots();
    for (let rootIndex = 0; rootIndex < roots.length && result.length < limit; rootIndex += 1) {
      let nodes = [];
      try {
        nodes = Array.from(roots[rootIndex].querySelectorAll(selector));
      } catch (_error) {
        nodes = [];
      }
      for (const node of nodes) {
        result.push(node);
        if (result.length >= limit) {
          break;
        }
      }
    }
    return result;
  }

  function collectSearchRoots() {
    const roots = [];
    const seenRoots = new Set();
    const queue = [document];

    for (let index = 0; index < queue.length && roots.length < 80; index += 1) {
      const root = queue[index];
      if (!root || seenRoots.has(root)) {
        continue;
      }
      seenRoots.add(root);
      roots.push(root);

      let allNodes = [];
      try {
        allNodes = Array.from(root.querySelectorAll('*')).slice(0, 4000);
      } catch (_error) {
        allNodes = [];
      }

      for (const node of allNodes) {
        if (node.shadowRoot && !seenRoots.has(node.shadowRoot)) {
          queue.push(node.shadowRoot);
        }
        if (node.tagName === 'IFRAME') {
          try {
            if (node.contentDocument && !seenRoots.has(node.contentDocument)) {
              queue.push(node.contentDocument);
            }
          } catch (_error) {
            // Cross-origin frames cannot be inspected from the page context.
          }
        }
      }
    }

    return roots;
  }

  function uniqueNodes(nodes) {
    return Array.from(new Set(nodes));
  }

  function toControlSignal(node) {
    return {
      tag: node.tagName?.toLowerCase() || '',
      text: node.textContent || '',
      innerText: node.innerText || '',
      ariaLabel: node.getAttribute('aria-label') || '',
      title: node.getAttribute('title') || '',
      value: node.getAttribute('value') || '',
      role: node.getAttribute('role') || '',
      id: node.id || '',
      className: typeof node.className === 'string' ? node.className : '',
      dataTestId: node.getAttribute('data-testid') || node.getAttribute('data-test-id') || '',
      dataQa: node.getAttribute('data-qa') || '',
      dataOlName: node.getAttribute('data-ol-name') || '',
      ariaPressed: node.getAttribute('aria-pressed') || '',
      ariaSelected: node.getAttribute('aria-selected') || '',
      ariaCurrent: node.getAttribute('aria-current') || '',
      htmlSnippet: compact(node.outerHTML || '', 220)
    };
  }

  function readNodeSignalText(node) {
    return [
      node.innerText,
      node.textContent,
      node.getAttribute?.('aria-label'),
      node.getAttribute?.('title'),
      node.getAttribute?.('id'),
      typeof node.className === 'string' ? node.className : '',
      node.getAttribute?.('data-testid'),
      node.getAttribute?.('data-test-id'),
      node.getAttribute?.('data-qa'),
      node.getAttribute?.('data-ol-name')
    ].filter(Boolean).join(' ');
  }

  function buildReviewingDiagnostics({ bodyText, bodyTextContent, controls, internalStates }) {
    const reviewLikeControls = controls
      .filter(control => /review|track|suggest/i.test(Object.values(control).filter(Boolean).join(' ')))
      .slice(0, 12)
      .map(control => ({
        tag: control.tag,
        text: compact(control.innerText || control.text, 120),
        ariaLabel: compact(control.ariaLabel, 80),
        title: compact(control.title, 80),
        role: control.role,
        id: compact(control.id, 80),
        className: compact(control.className, 120),
        dataTestId: compact(control.dataTestId, 80),
        ariaPressed: control.ariaPressed,
        ariaSelected: control.ariaSelected,
        htmlSnippet: compact(control.htmlSnippet, 160)
      }));

    return {
      controlCount: controls.length,
      bodyTextHasReviewing: /\breviewing\b/i.test(bodyText),
      textContentHasReviewing: /\breviewing\b/i.test(bodyTextContent),
      bodyTextHasTrack: /\btrack(?:ed)? changes?\b/i.test(bodyText),
      textContentHasTrack: /\btrack(?:ed)? changes?\b/i.test(bodyTextContent),
      reviewLikeControls,
      internalStateCount: internalStates.length,
      reviewLikeStates: internalStates
        .filter(value => /review|track|suggest/i.test(value))
        .slice(0, 8)
        .map(value => compact(value, 140))
    };
  }

  function collectReviewingInternalStates() {
    const states = [];
    const roots = [window._ide, window.Overleaf, window.overleaf, window.OL].filter(Boolean);
    for (const root of roots) {
      collectMatchingValues(root, /review|track/i, states, 0);
    }
    return states.slice(0, 80);
  }

  function collectMatchingValues(value, keyPattern, states, depth) {
    if (!value || depth > 2 || states.length > 80) {
      return;
    }

    if (typeof value === 'string' || typeof value === 'boolean') {
      states.push(String(value));
      return;
    }

    if (typeof value !== 'object') {
      return;
    }

    for (const key of Object.keys(value).slice(0, 80)) {
      if (keyPattern.test(key)) {
        states.push(`${key}:${String(value[key])}`);
      }
      const child = value[key];
      if (child && typeof child === 'object' && keyPattern.test(key)) {
        collectMatchingValues(child, keyPattern, states, depth + 1);
      }
    }
  }

  function detectEditor() {
    return editorAdapter.detectEditor();
  }

  function buildEditorDiagnostics(editor) {
    const active = getDeepActiveElement();
    const editorViewMatch = findCodeMirrorEditorView();
    const editorView = editorViewMatch?.view || null;
    const textareas = collectElements('textarea', 30).filter(node => !isInsideCodexPanel(node));
    const editableNodes = collectElements('[contenteditable="true"], .cm-content, .CodeMirror-code', 50)
      .filter(node => !isInsideCodexPanel(node));
    const frames = Array.from(document.querySelectorAll('iframe')).map(frame => {
      try {
        return {
          title: frame.getAttribute('title') || '',
          src: frame.getAttribute('src') || '',
          sameOrigin: Boolean(frame.contentDocument)
        };
      } catch (_error) {
        return {
          title: frame.getAttribute('title') || '',
          src: frame.getAttribute('src') || '',
          sameOrigin: false
        };
      }
    });

    return {
      ok: Boolean(editor?.ok),
      globals: describeGlobals(),
      documentStats: describeDocumentStats(),
      unstableStore: describeUnstableStore(),
      codeMirrorView: editorView
        ? {
            docLength: getCodeMirrorDocLength(editorView),
            hasDispatch: typeof editorView.dispatch === 'function',
            source: editorViewMatch.source
          }
        : null,
      active: describeEditorNode(active),
      textareaCount: textareas.length,
      textareas: textareas.slice(0, 5).map(describeEditorNode),
      editableCount: editableNodes.length,
      editables: editableNodes.slice(0, 5).map(describeEditorNode),
      iframeCount: frames.length,
      iframes: frames.slice(0, 5)
    };
  }

  function describeEditorNode(node) {
    if (!node) {
      return null;
    }
    const value = node.value || node.innerText || node.textContent || '';
    return {
      tag: node.tagName?.toLowerCase() || '',
      role: node.getAttribute?.('role') || '',
      ariaLabel: compact(node.getAttribute?.('aria-label') || '', 80),
      title: compact(node.getAttribute?.('title') || '', 80),
      id: compact(node.id || '', 80),
      className: compact(typeof node.className === 'string' ? node.className : '', 120),
      valueLength: String(value || '').length,
      likelySource: isLikelySourceEditorNode(node)
    };
  }

  function readActiveEditorText() {
    return editorAdapter.readActiveEditorText();
  }

  function replaceActiveEditorText(text) {
    return editorAdapter.replaceActiveEditorText(text);
  }

  function replaceActiveEditorPatches(patches, nextContent) {
    return editorAdapter.replaceActiveEditorPatches(patches, nextContent);
  }

  function getCodeMirrorEditorView() {
    return findCodeMirrorEditorView()?.view || null;
  }

  function findCodeMirrorEditorView() {
    const store = getOverleafUnstableStore();
    const candidates = [
      ['store:editor.view', readStoreValue(store, 'editor.view')],
      ['store:editor.view.camel', readStoreValue(store, 'editor.view.camel')],
      ['store:editor', readStoreValue(store, 'editor').view],
      ['window.overleaf.unstable.editorView', window.overleaf?.unstable?.editorView],
      ['window.Overleaf.editorView', window.Overleaf?.editorView],
      ['window._ide.editorView', window._ide?.editorView]
    ];

    for (const [source, candidate] of candidates) {
      if (isCodeMirrorEditorView(candidate)) {
        return {
          view: candidate,
          source
        };
      }
    }

    return null;
  }

  function getOverleafUnstableStore() {
    return window.overleaf?.unstable?.store || window.Overleaf?.unstable?.store || null;
  }

  function readStoreValue(store, path) {
    if (!store || typeof store.get !== 'function') {
      return {};
    }
    try {
      return store.get(path) || {};
    } catch (_error) {
      return {};
    }
  }

  function isCodeMirrorEditorView(value) {
    return Boolean(
      value
      && typeof value === 'object'
      && typeof value.dispatch === 'function'
      && value.state
      && value.state.doc
      && typeof value.state.doc.toString === 'function'
    );
  }

  function getCodeMirrorDocText(editorView) {
    return editorView.state.doc.toString();
  }

  function getCodeMirrorDocLength(editorView) {
    const doc = editorView.state.doc;
    return Number.isInteger(doc.length) ? doc.length : getCodeMirrorDocText(editorView).length;
  }

  function describeUnstableStore() {
    const store = getOverleafUnstableStore();
    if (!store) {
      return {
        present: false
      };
    }

    const paths = ['editor.view', 'editor.open_doc_id', 'editor.open_doc_name', 'settings'];
    const readable = [];
    for (const path of paths) {
      try {
        const value = store.get(path);
        readable.push({
          path,
          type: value === null ? 'null' : typeof value,
          present: value !== undefined
        });
      } catch (error) {
        readable.push({
          path,
          type: 'error',
          present: false,
          reason: error.message
        });
      }
    }

    return {
      present: true,
      readable
    };
  }

  function describeGlobals() {
    return {
      overleaf: describeGlobalObject(window.overleaf),
      Overleaf: describeGlobalObject(window.Overleaf),
      _ide: describeGlobalObject(window._ide),
      OL: describeGlobalObject(window.OL)
    };
  }

  function describeGlobalObject(value) {
    if (!value) {
      return 'missing';
    }
    if (typeof value !== 'object' && typeof value !== 'function') {
      return typeof value;
    }
    let keys = [];
    try {
      keys = Object.keys(value).slice(0, 8);
    } catch (_error) {
      keys = [];
    }
    return keys.length ? keys.join('|') : 'present';
  }

  function describeDocumentStats() {
    return {
      elementCount: document.querySelectorAll('*').length,
      textareaCount: document.querySelectorAll('textarea').length,
      cmCount: document.querySelectorAll('.cm-content,.cm-editor,.cm-line,.CodeMirror,.CodeMirror-code').length,
      roleTextboxCount: document.querySelectorAll('[role="textbox"]').length
    };
  }

  function findEditorTextArea() {
    const candidates = collectElements('textarea', 120)
      .filter(node => !isInsideCodexPanel(node));
    return candidates.find(isLikelySourceEditorNode)
      || candidates.find(node => window.CodexOverleafProjectFiles.isUsableProjectFileContent(node.value))
      || candidates[0]
      || null;
  }

  function findEditorContentNode(selector) {
    return collectElements(selector, 120)
      .find(node => !isInsideCodexPanel(node)) || null;
  }

  function getDeepActiveElement() {
    let active = document.activeElement;
    const seen = new Set();

    while (active && !seen.has(active)) {
      seen.add(active);

      if (active.shadowRoot?.activeElement) {
        active = active.shadowRoot.activeElement;
        continue;
      }

      if (active.tagName === 'IFRAME') {
        try {
          if (active.contentDocument?.activeElement) {
            active = active.contentDocument.activeElement;
            continue;
          }
        } catch (_error) {
          // Cross-origin frames cannot be inspected.
        }
      }

      break;
    }

    return active;
  }

  function isInsideCodexPanel(node) {
    return Boolean(node?.closest?.('#codex-overleaf-panel'));
  }

  function isLikelySourceEditorNode(node) {
    const signal = [
      node.getAttribute('aria-label'),
      node.getAttribute('aria-describedby'),
      node.getAttribute('placeholder'),
      node.getAttribute('role'),
      node.id,
      typeof node.className === 'string' ? node.className : '',
      nearestClassSignal(node)
    ].filter(Boolean).join(' ');
    return /source|editor|code|latex|codemirror|cm-/i.test(signal);
  }

  function nearestClassSignal(node) {
    const parts = [];
    let current = node;
    for (let index = 0; current && index < 5; index += 1) {
      if (typeof current.className === 'string') {
        parts.push(current.className);
      }
      current = current.parentElement;
    }
    return parts.join(' ');
  }

  function getProjectId() {
    const match = window.location.pathname.match(/\/project\/([^/]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function getActiveFilePath() {
    const selectors = [
      '[aria-selected="true"][role="treeitem"]',
      '[aria-selected="true"][role="row"]',
      '.selected[role="treeitem"]',
      '.selected[role="row"]',
      '.file-tree .selected',
      '.project-tree .selected'
    ];

    for (const selector of selectors) {
      const node = document.querySelector(selector);
      const path = node ? readProjectPathFromNode(node) : '';
      if (path) {
        return path;
      }
    }

    return '';
  }

  async function openFileByPath(filePath) {
    if (getActiveFilePath() === filePath) {
      return {
        ok: true,
        method: 'already-active'
      };
    }

    const node = findFileTreeNode(filePath);
    if (node) {
      node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await delay(250);
      const active = await waitForActiveFile(filePath, 2500);
      if (active) {
        return {
          ok: true,
          method: 'dom-click'
        };
      }
    }

    const manager = findFileTreeManager();
    const openMethods = ['openDoc', 'openFile', 'selectFile', 'selectEntity'];

    for (const methodName of openMethods) {
      const method = manager?.[methodName];
      if (typeof method !== 'function') {
        continue;
      }

      try {
        await method.call(manager, filePath);
        const active = await waitForActiveFile(filePath, 2500);
        if (active) {
          return {
            ok: true,
            method: `fileTreeManager.${methodName}`
          };
        }
      } catch (_error) {
        // Try DOM fallback next.
      }
    }

    return {
      ok: false,
      reason: `Could not open ${filePath}`
    };
  }

  function findFileTreeNode(filePath) {
    const fileName = filePath.split('/').pop();
    const candidates = document.querySelectorAll('[role="treeitem"], [role="row"], .file-tree *, .project-tree *');
    for (const node of candidates) {
      const path = readProjectPathFromNode(node);
      const text = node.textContent?.trim();
      if (path === filePath || path === fileName || text === filePath || text === fileName) {
        return node;
      }
    }
    return null;
  }

  function projectPathExists(filePath) {
    if (!filePath) {
      return false;
    }
    const normalizedPath = normalizeSafeProjectPath(filePath);
    if (!normalizedPath) {
      return false;
    }
    if (getActiveFilePath() === normalizedPath) {
      return true;
    }
    if (findFileTreeNode(normalizedPath)) {
      return true;
    }
    return collectDocRecords().some(record => record.path === normalizedPath);
  }

  function collectProjectTextPaths(activePath) {
    const rawPaths = [
      activePath,
      ...collectDocRecords().map(record => record.path),
      ...collectInternalProjectPaths(),
      ...collectDomProjectPaths()
    ];
    return window.CodexOverleafProjectFiles.collectUniqueTextPaths(rawPaths, 80);
  }

  function collectDocRecords(options = {}) {
    const seen = new Set();
    const records = [];
    for (const record of [...collectInternalDocRecords(options), ...collectDomDocRecords()]) {
      if (!record?.id || !window.CodexOverleafProjectFiles.isTextProjectPath(record.path)) {
        continue;
      }
      const key = `${record.path}:${record.id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      records.push(record);
      if (records.length >= 120) {
        break;
      }
    }
    return records;
  }

  function collectInternalDocRecords(options = {}) {
    const records = [];
    const seenObjects = new WeakSet();
    const seenRecords = new Set();
    const roots = collectInternalRoots(options);

    for (const root of roots) {
      walkInternalDocTree(root, '', 0);
      if (records.length >= 120) {
        break;
      }
    }

    return records;

    function walkInternalDocTree(value, folderPath, depth) {
      if (!value || depth > 7 || records.length >= 120 || typeof value !== 'object') {
        return;
      }
      if (isDomLikeObject(value) || seenObjects.has(value)) {
        return;
      }
      seenObjects.add(value);

      if (Array.isArray(value)) {
        for (const item of value.slice(0, 250)) {
          walkInternalDocTree(item, folderPath, depth + 1);
        }
        return;
      }

      const ownName = readObjectPathName(value);
      const ownId = readObjectDocId(value);
      const normalizedOwnName = normalizeSafeProjectPath(ownName);
      const ownPath = normalizedOwnName && normalizedOwnName.includes('/')
        ? normalizedOwnName
        : joinPath(folderPath, normalizedOwnName);

      if (ownId && window.CodexOverleafProjectFiles.isTextProjectPath(ownPath)) {
        const key = `${ownPath}:${ownId}`;
        if (!seenRecords.has(key)) {
          seenRecords.add(key);
          records.push({
            path: ownPath,
            id: ownId
          });
        }
      }

      const nextFolderPath = normalizedOwnName && !window.CodexOverleafProjectFiles.isTextProjectPath(normalizedOwnName)
        ? joinPath(folderPath, normalizedOwnName)
        : folderPath;

      for (const key of Object.keys(value).slice(0, 220)) {
        if (!/project|root|folder|folders|children|entities|entity|docs|doc|file|files|tree|scope|state|data|metadata|meta/i.test(key)) {
          continue;
        }
        let child;
        try {
          child = value[key];
        } catch (_error) {
          continue;
        }
        walkInternalDocTree(child, nextFolderPath, depth + 1);
      }
    }
  }

  function collectInternalRoots(options = {}) {
    const roots = [window._ide, window.Overleaf, window.overleaf, window.OL].filter(Boolean);
    if (options.includeWindowGlobals === false) {
      return uniqueNodes(roots);
    }
    for (const key of Object.keys(window).slice(0, 2500)) {
      if (!/ide|overleaf|sharelatex|project|root|folder|doc|file|entity|state|meta|bootstrap|ol/i.test(key)) {
        continue;
      }
      try {
        const value = window[key];
        if (value && typeof value === 'object') {
          roots.push(value);
        }
      } catch (_error) {
        // Ignore guarded globals.
      }
    }
    return uniqueNodes(roots);
  }

  function collectInternalRootKeys() {
    return Object.keys(window)
      .filter(key => /ide|overleaf|sharelatex|project|root|folder|doc|file|entity|state|meta|bootstrap|ol/i.test(key))
      .slice(0, 40);
  }

  function collectDomDocRecords() {
    const selectors = [
      '[role="treeitem"]',
      '[role="row"]',
      '.file-tree *',
      '.project-tree *',
      '[data-entity-id]',
      '[data-doc-id]',
      '[data-id]',
      '[data-file-id]'
    ];
    const nodes = uniqueNodes(selectors.flatMap(selector => Array.from(document.querySelectorAll(selector)).slice(0, 600)));
    const records = [];
    const seen = new Set();

    for (const node of nodes) {
      const path = readProjectPathFromNode(node);
      const id = readDomDocId(node);
      if (!path || !id) {
        continue;
      }
      const key = `${path}:${id}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      records.push({
        path,
        id,
        source: 'dom'
      });
    }

    return records;
  }

  function readDomDocId(node) {
    let current = node;
    for (let depth = 0; current && depth < 5; depth += 1) {
      for (const attr of ['data-entity-id', 'data-doc-id', 'data-id', 'data-file-id', 'data-ol-id', 'id']) {
        const value = current.getAttribute?.(attr) || '';
        const match = value.match(/[a-f0-9]{24}/i);
        if (match) {
          return match[0];
        }
      }
      current = current.parentElement;
    }
    return '';
  }

  function readObjectPathName(value) {
    for (const key of ['path', 'pathname', 'filePath', 'name', 'fileName', 'displayName']) {
      const candidate = value?.[key];
      if (typeof candidate === 'string' && candidate.trim()) {
        return candidate;
      }
    }
    return '';
  }

  function readObjectDocId(value) {
    for (const key of ['_id', 'id', 'docId', 'doc_id', 'entityId']) {
      const candidate = value?.[key];
      if (typeof candidate === 'string' && /^[a-f0-9]{24}$/i.test(candidate)) {
        return candidate;
      }
    }
    return '';
  }

  function isDomLikeObject(value) {
    return value === window
      || value === document
      || value instanceof Node
      || value instanceof EventTarget && value.constructor?.name !== 'Object';
  }

  function joinPath(folderPath, name) {
    const cleanName = normalizeSafeProjectPath(name);
    const cleanFolder = normalizeSafeProjectPath(folderPath);
    if (!cleanName) {
      return cleanFolder;
    }
    return cleanFolder ? `${cleanFolder}/${cleanName}` : cleanName;
  }

  async function fetchOverleafDocContent(record) {
    if (!record?.id || !record.path) {
      return {
        ok: false,
        reason: 'Missing Overleaf doc id'
      };
    }

    const projectId = getProjectId();
    if (!projectId) {
      return {
        ok: false,
        reason: 'Missing Overleaf project id'
      };
    }

    try {
      const response = await fetch(`${window.location.origin}/project/${encodeURIComponent(projectId)}/doc/${encodeURIComponent(record.id)}`, {
        credentials: 'include',
        headers: {
          accept: 'application/json'
        }
      });
      if (!response.ok) {
        return {
          ok: false,
          reason: `Overleaf doc fetch returned ${response.status}`
        };
      }
      const payload = await response.json();
      const content = readDocPayloadContent(payload);
      if (!window.CodexOverleafProjectFiles.isUsableProjectFileContent(content)) {
        return {
          ok: false,
          reason: 'Overleaf doc fetch returned empty/loading content'
        };
      }
      return {
        ok: true,
        content,
        method: 'overleaf-doc-fetch'
      };
    } catch (error) {
      return {
        ok: false,
        reason: `Overleaf doc fetch failed: ${error.message}`
      };
    }
  }

  async function fetchProjectZipSnapshot(params = {}) {
    const projectId = getProjectId();
    if (!projectId) {
      return {
        ok: false,
        reason: 'Missing Overleaf project id'
      };
    }
    const timeoutMs = normalizeZipFetchTimeout(params.zipTimeoutMs);

    const endpoints = [
      `${window.location.origin}/project/${encodeURIComponent(projectId)}/download/zip`,
      `${window.location.origin}/download/project/${encodeURIComponent(projectId)}`
    ];

    const errors = [];
    for (const endpoint of endpoints) {
      try {
        const { response, contentType, buffer } = await fetchZipEndpoint(endpoint, timeoutMs);
        if (!response.ok) {
          errors.push(`${endpoint} returned ${response.status}`);
          continue;
        }
        const extracted = await extractFilesFromZip(buffer, {
          includeBinaryFiles: Boolean(params.includeBinaryFiles),
          includeContent: params.includeContent !== false
        });
        const files = extracted.files || [];
        if (!files.length) {
          errors.push(`${endpoint} returned no text files (${contentType || 'unknown content type'})`);
          continue;
        }
        return {
          ok: true,
          endpoint,
          skipped: extracted.skipped || [],
          files: files.map(file => ({
            ...file,
            source: 'overleaf-zip'
          }))
        };
      } catch (error) {
        errors.push(`${endpoint} failed: ${error.message}`);
      }
    }

    return {
      ok: false,
      reason: errors.join('; ') || 'Overleaf source ZIP was unavailable'
    };
  }

  function fetchZipEndpoint(endpoint, timeoutMs) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const request = (async () => {
      const response = await fetch(endpoint, {
        credentials: 'include',
        headers: {
          accept: 'application/zip,application/octet-stream,*/*'
        },
        ...(controller ? { signal: controller.signal } : {})
      });
      const contentType = response.headers.get('content-type') || '';
      const buffer = response.ok ? await response.arrayBuffer() : null;
      return {
        response,
        contentType,
        buffer
      };
    })();

    return withTimeout(request, timeoutMs, () => {
      controller?.abort();
    }, `Overleaf ZIP download timed out after ${timeoutMs}ms`);
  }

  function withTimeout(promise, timeoutMs, onTimeout, message) {
    let timeoutId = null;
    const timeout = new Promise((_resolve, reject) => {
      timeoutId = window.setTimeout(() => {
        try {
          onTimeout?.();
        } finally {
          reject(new Error(message));
        }
      }, timeoutMs);
    });

    return Promise.race([promise, timeout])
      .finally(() => {
        if (timeoutId) {
          window.clearTimeout(timeoutId);
        }
      });
  }

  function normalizeZipFetchTimeout(value) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 100) {
      return Math.min(parsed, 30000);
    }
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
    return ZIP_FETCH_TIMEOUT_MS;
  }

  async function extractFilesFromZip(buffer, options = {}) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    const eocdOffset = findEndOfCentralDirectory(view);
    if (eocdOffset < 0) {
      throw new Error('ZIP end-of-central-directory record was not found');
    }

    const entryCount = view.getUint16(eocdOffset + 10, true);
    const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
    const decoder = new TextDecoder('utf-8');
    const files = [];
    const skipped = [];
    let binaryBytes = 0;
    let offset = centralDirectoryOffset;

    for (let index = 0; index < entryCount; index += 1) {
      if (view.getUint32(offset, true) !== 0x02014b50) {
        throw new Error('Invalid ZIP central-directory header');
      }

      const compressionMethod = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const uncompressedSize = view.getUint32(offset + 24, true);
      const fileNameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localHeaderOffset = view.getUint32(offset + 42, true);
      const rawName = bytes.slice(offset + 46, offset + 46 + fileNameLength);
      const path = normalizeSafeProjectPath(decoder.decode(rawName));
      const isText = window.CodexOverleafProjectFiles.isTextProjectPath(path);
      const shouldInclude = path && !path.endsWith('/') && (isText || options.includeBinaryFiles);

      if (shouldInclude) {
        const file = { path, size: uncompressedSize };
        if (options.includeContent !== false && (isText || options.includeBinaryFiles)) {
          if (!isText) {
            if (uncompressedSize > MAX_BINARY_FILE_BYTES) {
              skipped.push({
                path,
                reason: 'binary_file_too_large',
                size: uncompressedSize
              });
              offset += 46 + fileNameLength + extraLength + commentLength;
              continue;
            }
            if (binaryBytes + uncompressedSize > MAX_BINARY_TOTAL_BYTES) {
              skipped.push({
                path,
                reason: 'binary_project_too_large',
                size: uncompressedSize
              });
              offset += 46 + fileNameLength + extraLength + commentLength;
              continue;
            }
            binaryBytes += uncompressedSize;
          }
          const contentBytes = await readZipEntryBytes(view, bytes, localHeaderOffset, compressedSize, compressionMethod);
          if (isText) {
            file.content = decoder.decode(contentBytes);
          } else {
            file.contentBase64 = uint8ArrayToBase64(contentBytes);
            file.size = contentBytes.byteLength;
          }
        }
        files.push({
          ...file,
          kind: isText ? 'text' : 'binary'
        });
      }

      offset += 46 + fileNameLength + extraLength + commentLength;
    }

    return { files, skipped };
  }

  function uint8ArrayToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return window.btoa(binary);
  }

  function findEndOfCentralDirectory(view) {
    const minOffset = Math.max(0, view.byteLength - 0xffff - 22);
    for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
      if (view.getUint32(offset, true) === 0x06054b50) {
        return offset;
      }
    }
    return -1;
  }

  async function readZipEntryBytes(view, bytes, localHeaderOffset, compressedSize, compressionMethod) {
    if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
      throw new Error('Invalid ZIP local-file header');
    }
    const localFileNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataOffset = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const compressed = bytes.slice(dataOffset, dataOffset + compressedSize);

    if (compressionMethod === 0) {
      return compressed;
    }
    if (compressionMethod === 8) {
      return inflateRaw(compressed);
    }
    throw new Error(`Unsupported ZIP compression method ${compressionMethod}`);
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('Browser does not support DecompressionStream');
    }

    const errors = [];
    for (const format of ['deflate-raw', 'deflate']) {
      try {
        const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
        const response = new Response(stream);
        return new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        errors.push(`${format}: ${error.message}`);
      }
    }
    throw new Error(`Could not inflate ZIP entry (${errors.join('; ')})`);
  }

  function readDocPayloadContent(payload) {
    const candidates = [
      payload?.lines,
      payload?.doc?.lines,
      payload?.document?.lines,
      payload?.content,
      payload?.doc?.content,
      payload?.document?.content
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate) && candidate.every(line => typeof line === 'string')) {
        return candidate.join('\n');
      }
      if (typeof candidate === 'string') {
        return candidate;
      }
    }

    return '';
  }

  function collectInternalProjectPaths() {
    const paths = [];
    const roots = [window._ide, window.Overleaf, window.overleaf, window.OL].filter(Boolean);
    for (const root of roots) {
      collectPathLikeValues(root, paths, 0);
      if (paths.length >= 200) {
        break;
      }
    }
    return paths;
  }

  function collectPathLikeValues(value, paths, depth) {
    if (!value || depth > 3 || paths.length >= 200) {
      return;
    }

    if (typeof value === 'string') {
      if (window.CodexOverleafProjectFiles.isTextProjectPath(value)) {
        paths.push(value);
      }
      return;
    }

    if (typeof value !== 'object') {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value.slice(0, 80)) {
        collectPathLikeValues(item, paths, depth + 1);
      }
      return;
    }

    for (const key of Object.keys(value).slice(0, 100)) {
      const child = value[key];
      if (/path|name|file|doc/i.test(key)) {
        collectPathLikeValues(child, paths, depth + 1);
      } else if (child && typeof child === 'object' && /project|file|doc|root|entities|tree/i.test(key)) {
        collectPathLikeValues(child, paths, depth + 1);
      }
    }
  }

  function collectDomProjectPaths() {
    const selectors = [
      '[role="treeitem"]',
      '[role="row"]',
      '.file-tree li',
      '.file-tree [data-entity-id]',
      '.file-tree [data-testid]',
      '.project-tree li',
      '.project-tree [data-entity-id]'
    ];
    const candidates = [];
    for (const selector of selectors) {
      candidates.push(...Array.from(document.querySelectorAll(selector)).slice(0, 500));
    }

    return Array.from(new Set(candidates.map(node => readProjectPathFromNode(node)).filter(Boolean)));
  }

  function readProjectPathFromNode(node) {
    const attrPath = [
      node.getAttribute('data-path'),
      node.getAttribute('data-file-path'),
      node.getAttribute('data-name')
    ].map(normalizeProjectPathCandidate).find(Boolean);
    if (attrPath) {
      if (!attrPath.includes('/')) {
        return inferPathFromTreeAncestors(node, attrPath) || attrPath;
      }
      return attrPath;
    }

    const labelPath = [
      node.getAttribute('aria-label'),
      node.getAttribute('title')
    ].map(normalizeProjectPathCandidate).find(Boolean);
    if (labelPath) {
      if (!labelPath.includes('/')) {
        return inferPathFromTreeAncestors(node, labelPath) || labelPath;
      }
      return labelPath;
    }

    const textPath = normalizeProjectPathCandidate(node.textContent || '');
    if (!textPath) {
      return '';
    }
    if (!textPath.includes('/')) {
      return inferPathFromTreeAncestors(node, textPath) || textPath;
    }
    return textPath;
  }

  function normalizeProjectPathCandidate(value) {
    const text = normalizeDomText(value);
    if (!text || hasMultipleTextPathExtensions(text)) {
      return '';
    }
    const candidates = [
      stripOverleafIconAffixes(text),
      text
    ];
    for (const candidate of candidates) {
      const normalized = normalizeSafeProjectPath(candidate);
      if (normalized && window.CodexOverleafProjectFiles.isTextProjectPath(normalized)) {
        return normalized;
      }
    }
    return '';
  }

  function normalizeDomText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function hasMultipleTextPathExtensions(value) {
    const matches = normalizeDomText(value).match(new RegExp(`\\.${TEXT_PATH_EXTENSION_PATTERN}\\b`, 'gi')) || [];
    return matches.length > 1;
  }

  function stripOverleafIconAffixes(value) {
    let text = normalizeDomText(value);
    for (let index = 0; index < 4; index += 1) {
      const next = text
        .replace(/^(?:description|article|book_5|insert_drive_file|draft|text_snippet|note|chevron_right|expand_more|folder_open|folder)+/i, '')
        .replace(/(?:more_vert\s*Menu|more_vert|Menu)$/i, '')
        .trim();
      if (next === text) {
        break;
      }
      text = next;
    }
    return text;
  }

  function inferPathFromTreeAncestors(node, fileName) {
    const folders = [];
    let current = node?.parentElement || null;
    for (let depth = 0; current && depth < 8; depth += 1) {
      const folderName = readFolderNameFromNode(current);
      if (folderName) {
        folders.unshift(folderName);
      }
      current = current.parentElement;
    }
    if (!folders.length) {
      return '';
    }
    const path = normalizeSafeProjectPath([...folders, fileName].join('/'));
    return window.CodexOverleafProjectFiles.isTextProjectPath(path) ? path : '';
  }

  function readFolderNameFromNode(node) {
    const candidates = [
      node.getAttribute?.('data-name'),
      node.getAttribute?.('aria-label'),
      node.getAttribute?.('title')
    ];
    for (const value of candidates) {
      const folderName = normalizeFolderName(value);
      if (folderName) {
        return folderName;
      }
    }
    return '';
  }

  function normalizeFolderName(value) {
    const text = normalizeDomText(value);
    if (!text || /[\\/]/.test(text) || window.CodexOverleafProjectFiles.isTextProjectPath(text)) {
      return '';
    }
    if (new RegExp(`\\.${TEXT_PATH_EXTENSION_PATTERN}\\b`, 'i').test(text)) {
      return '';
    }
    if (/^(?:description|article|book_5|insert_drive_file|draft|text_snippet|note|chevron_right|expand_more|folder_open|folder|expand|collapse|open|close|menu)\b/i.test(text)) {
      return '';
    }
    if (/(?:more_vert|action menu|Menu)$/i.test(text)) {
      return '';
    }
    if (!/^[\w .@+-]+$/.test(text) || text.length > 80) {
      return '';
    }
    return text;
  }

  async function waitForActiveFile(filePath, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (getActiveFilePath() === filePath) {
        return true;
      }
      await delay(100);
    }
    return getActiveFilePath() === filePath;
  }

  async function waitForActiveEditorText(filePath, timeoutMs, options = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastText = '';
    while (Date.now() < deadline) {
      const activeFileMatches = !filePath || getActiveFilePath() === filePath;
      const text = readActiveEditorText();
      lastText = text;
      const textReady = window.CodexOverleafProjectFiles.isUsableProjectFileContent(text);
      const signatureChanged = !options.notSignature || contentSignature(text) !== options.notSignature;
      if (activeFileMatches && textReady && signatureChanged) {
        return {
          ok: true,
          text
        };
      }
      await delay(150);
    }
    return {
      ok: false,
      text: lastText,
      reason: `Editor content was not ready for ${filePath || 'active file'}; last length ${String(lastText || '').length}`
    };
  }

  function contentSignature(content) {
    const text = String(content || '');
    return `${text.length}:${text.slice(0, 120)}:${text.slice(-120)}`;
  }

  function findFileTreeManager() {
    const roots = [window._ide, window.Overleaf, window.overleaf, window.OL].filter(Boolean);
    for (const root of roots) {
      for (const key of Object.keys(root)) {
        if (/file.*tree|tree.*file|file.*manager|entity.*manager/i.test(key) && root[key] && typeof root[key] === 'object') {
          return root[key];
        }
      }
    }
    return window._ide?.fileTreeManager || window._ide?.fileTree || null;
  }

  function findHistoryObject() {
    const roots = [window._ide, window.Overleaf, window.overleaf, window.OL].filter(Boolean);
    for (const root of roots) {
      for (const key of Object.keys(root)) {
        if (/history/i.test(key) && root[key] && typeof root[key] === 'object') {
          return root[key];
        }
      }
    }
    return null;
  }

  function delay(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }

  function compact(value, limit) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
  }
})();
