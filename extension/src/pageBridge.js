(function initCodexOverleafPageBridge() {
  'use strict';

  if (window.__codexOverleafPageBridgeInstalled) {
    return;
  }
  window.__codexOverleafPageBridgeInstalled = true;

  const PAGE_BRIDGE_CAPABILITY_METHOD = 'initializeCapability';
  const pageBridgeCapabilityGuard = window.CodexOverleafPageBridgeCapability.create();
  let treeOperations = null;
  let snapshotRouter = null;
  let projectSnapshotBridge = null;
  let writebackRouter = null;
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
  treeOperations = requirePageModule('CodexOverleafTreeOperations').create({
    document,
    normalizePath: normalizeSafeProjectPath,
    readActiveEditorText,
    window
  });
  snapshotRouter = requirePageModule('CodexOverleafSnapshotRouter').create({
    normalizePath: normalizeSafeProjectPath,
    readActiveEditorText,
    treeOperations,
    window
  });
  projectSnapshotBridge = window.CodexOverleafProjectSnapshot.create({
    buildProjectFileList: snapshotRouter.buildProjectFileList,
    buildProjectSnapshot: snapshotRouter.buildProjectSnapshot,
    getProjectId,
    normalizePath: normalizeSafeProjectPath,
    window
  });
  writebackRouter = requirePageModule('CodexOverleafWritebackRouter').create({
    activeEditorIdentityChanged,
    clickNode,
    collectElements,
    compact,
    compileBridge,
    delay,
    ensureEditing,
    ensureReviewing,
    getActiveEditorIdentity,
    getReviewingState,
    invalidProjectPathResult,
    isEditingConfirmedForNoTraceUndo,
    isInsideCodexPanel,
    normalizeReviewingSignalText,
    normalizeSafeProjectPath,
    normalizeTextPatches,
    projectSnapshotBridge,
    readActiveEditorText,
    readNodeSignalText,
    replaceActiveEditorPatches,
    replaceActiveEditorText,
    setReviewingEnabled,
    summarizeReviewingToggleResult,
    treeOperations,
    uniqueNodes,
    waitForSaveState,
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
        result = pageBridgeCapabilityGuard.initializePageBridgeCapability(capability);
      } else if (!pageBridgeCapabilityGuard.hasValidPageBridgeCapability(capability)) {
        result = window.CodexOverleafPageBridgeCapability.buildUnauthorizedBridgeResult();
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

    const range = resolveJumpToPositionRange(params, readActiveEditorText(), filePath);
    if (!range.ok) {
      return range;
    }

    const focused = editorAdapter.focusActiveEditorRange(range.from, range.to);
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
      from: range.from,
      to: range.to
    };
  }

  function resolveJumpToPositionRange(params, text, filePath) {
    if (params.line === undefined && params.column === undefined) {
      return {
        ok: true,
        from: params.from,
        to: params.to
      };
    }

    const lines = collectTextLineRanges(String(text || ''));
    const lineCount = lines.length;
    const lineNumber = Number(params.line);
    const lineMetadata = { lineCount };
    if (params.line !== undefined) {
      lineMetadata.line = Number.isInteger(lineNumber) ? lineNumber : params.line;
    }
    if (!Number.isInteger(lineNumber) || lineNumber < 1) {
      return jumpPositionOutOfRange('line_out_of_range', filePath, lineMetadata);
    }

    const line = lines[lineNumber - 1];
    if (!line) {
      return jumpPositionOutOfRange('line_out_of_range', filePath, {
        line: lineNumber,
        lineCount
      });
    }

    const lineLength = line.end - line.start;
    if (params.selectLine === true) {
      return {
        ok: true,
        from: line.start,
        to: line.end
      };
    }

    if (params.column !== undefined) {
      const columnNumber = Number(params.column);
      const maxColumn = lineLength + 1;
      if (!Number.isInteger(columnNumber) || columnNumber < 1 || columnNumber > maxColumn) {
        return jumpPositionOutOfRange('column_out_of_range', filePath, {
          line: lineNumber,
          column: Number.isInteger(columnNumber) ? columnNumber : params.column,
          lineLength
        });
      }
      const offset = line.start + columnNumber - 1;
      return {
        ok: true,
        from: offset,
        to: offset
      };
    }

    return {
      ok: true,
      from: line.start,
      to: line.start
    };
  }

  function jumpPositionOutOfRange(code, filePath, metadata = {}) {
    return {
      ok: false,
      code,
      reason: 'Requested jumpToPosition location is out of range',
      path: filePath,
      ...metadata
    };
  }

  function collectTextLineRanges(text) {
    const lines = [];
    let start = 0;

    for (let index = 0; index < text.length; index += 1) {
      if (text[index] === '\r') {
        lines.push({ start, end: index });
        if (text[index + 1] === '\n') {
          index += 1;
        }
        start = index + 1;
      } else if (text[index] === '\n') {
        lines.push({ start, end: index });
        start = index + 1;
      }
    }

    lines.push({ start, end: text.length });
    return lines;
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

  function getRequestedSnapshotPaths(params = {}, activePath = '') {
    return snapshotRouter.getRequestedSnapshotPaths(params, activePath);
  }

  async function applyOperations(operations, options = {}) {
    return writebackRouter.applyOperations(operations, options);
  }

  async function rejectTrackedChanges(params = {}) {
    return writebackRouter.rejectTrackedChanges(params);
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

  function requirePageModule(globalName) {
    const moduleApi = window[globalName];
    if (!moduleApi || typeof moduleApi.create !== 'function') {
      throw new Error(globalName + ' is not installed in the Overleaf page world');
    }
    return moduleApi;
  }

  function getProjectId() {
    return treeOperations?.getProjectId?.() || null;
  }

  function getActiveFilePath() {
    return treeOperations?.getActiveFilePath?.() || '';
  }

  function openFileByPath(filePath) {
    return treeOperations.openFileByPath(filePath);
  }

  function findFileTreeNode(filePath) {
    return treeOperations.findFileTreeNode(filePath);
  }

  function projectPathExists(filePath) {
    return treeOperations.projectPathExists(filePath);
  }

  function collectProjectTextPaths(activePath) {
    return treeOperations.collectProjectTextPaths(activePath);
  }

  function collectDocRecords(options = {}) {
    return treeOperations.collectDocRecords(options);
  }

  function collectInternalRootKeys() {
    return treeOperations.collectInternalRootKeys();
  }

  function findFileTreeManager() {
    return treeOperations.findFileTreeManager();
  }

  function findHistoryObject() {
    return treeOperations.findHistoryObject();
  }

  function waitForActiveFile(filePath, timeoutMs) {
    return treeOperations.waitForActiveFile(filePath, timeoutMs);
  }

  function waitForActiveEditorText(filePath, timeoutMs, options = {}) {
    return treeOperations.waitForActiveEditorText(filePath, timeoutMs, options);
  }

  function contentSignature(content) {
    return treeOperations.contentSignature(content);
  }

  function fileTreeMethodNames(type) {
    return treeOperations.fileTreeMethodNames(type);
  }

  function compact(value, limit) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > limit ? text.slice(0, limit - 3) + '...' : text;
  }
})();
