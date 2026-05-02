(function initCodexOverleafPageBridge() {
  'use strict';

  if (window.__codexOverleafPageBridgeInstalled) {
    return;
  }
  window.__codexOverleafPageBridgeInstalled = true;
  const SNAPSHOT_DEFAULT_MAX_AGE_MS = 2500;
  const SNAPSHOT_MAX_CACHE_MS = 15000;
  const FILE_LIST_DEFAULT_MAX_AGE_MS = 300000;
  const ZIP_FETCH_TIMEOUT_MS = 10000;
  const MAX_BINARY_FILE_BYTES = 10 * 1024 * 1024;
  const MAX_BINARY_TOTAL_BYTES = 80 * 1024 * 1024;
  const snapshotCache = {
    key: '',
    capturedAt: 0,
    value: null,
    pending: null
  };
  const fileListCache = {
    key: '',
    capturedAt: 0,
    value: null,
    pending: null
  };

  window.addEventListener('message', async event => {
    if (event.source !== window || event.data?.source !== 'codex-overleaf/content') {
      return;
    }

    const { id, method, params } = event.data;
    let result;
    try {
      result = await dispatch(method, params || {});
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
      return getProjectSnapshot(params);
    }
    if (method === 'getProjectFileList') {
      return getProjectFileList(params);
    }
    if (method === 'invalidateProjectSnapshot') {
      invalidateProjectSnapshot();
      return { ok: true };
    }
    if (method === 'createCheckpoint') {
      return createCheckpoint(params.label);
    }
    if (method === 'ensureReviewing') {
      return ensureReviewing(params);
    }
    if (method === 'applyOperations') {
      return applyOperations(params.operations || [], {
        baseFiles: params.baseFiles || null
      });
    }
    return {
      ok: false,
      error: `Unknown page bridge method: ${method}`
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
      editorDiagnostics: buildEditorDiagnostics(editor),
      projectDiagnostics: {
        internalRootKeys: collectInternalRootKeys(),
        docRecordCount: docRecords.length,
        docRecords: docRecords.slice(0, 8)
      }
    };
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

    const control = findReviewingActivationControl();
    if (!control) {
      return {
        ok: false,
        code: 'reviewing_not_enabled',
        reason: 'Overleaf Reviewing/Track Changes is not enabled, and Codex could not find a Reviewing control to activate.',
        reviewing: initial.reviewing
      };
    }

    clickNode(control);
    const after = await waitForReviewingState(params);
    if (isReviewingConfirmedForWrite(after)) {
      return {
        ok: true,
        activated: true,
        reviewing: after.reviewing
      };
    }

    return {
      ok: false,
      code: 'reviewing_not_enabled',
      reason: 'Codex clicked the Reviewing control, but Overleaf still did not report Reviewing/Track Changes as enabled.',
      reviewing: after.reviewing
    };
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

  async function getProjectSnapshot(params = {}) {
    const cacheKey = getSnapshotCacheKey(params);
    const maxAgeMs = normalizeSnapshotMaxAge(params.maxAgeMs);
    const now = Date.now();

    if (snapshotCache.key === cacheKey && snapshotCache.pending) {
      return snapshotCache.pending;
    }

    if (!params.force && snapshotCache.key === cacheKey && snapshotCache.value && now - snapshotCache.capturedAt <= maxAgeMs) {
      return withSnapshotCacheMetadata(snapshotCache.value, 'memory', snapshotCache.capturedAt);
    }

    const pending = buildProjectSnapshot(params)
      .then(snapshot => {
        const capturedAt = Date.now();
        snapshotCache.key = cacheKey;
        snapshotCache.value = snapshot;
        snapshotCache.capturedAt = capturedAt;
        return withSnapshotCacheMetadata(snapshot, 'fresh', capturedAt);
      })
      .finally(() => {
        if (snapshotCache.pending === pending) {
          snapshotCache.pending = null;
        }
      });

    snapshotCache.key = cacheKey;
    snapshotCache.pending = pending;
    return pending;
  }

  async function getProjectFileList(params = {}) {
    const cacheKey = getProjectFileListCacheKey(params);
    const maxAgeMs = normalizeFileListMaxAge(params.maxAgeMs);
    const now = Date.now();

    if (fileListCache.key === cacheKey && fileListCache.pending) {
      return fileListCache.pending;
    }

    if (!params.force && fileListCache.key === cacheKey && fileListCache.value && now - fileListCache.capturedAt <= maxAgeMs) {
      return withFileListCacheMetadata(fileListCache.value, 'memory', fileListCache.capturedAt);
    }

    const pending = buildProjectFileList(params)
      .then(fileList => {
        const capturedAt = Date.now();
        fileListCache.key = cacheKey;
        fileListCache.value = fileList;
        fileListCache.capturedAt = capturedAt;
        return withFileListCacheMetadata(fileList, 'fresh', capturedAt);
      })
      .finally(() => {
        if (fileListCache.pending === pending) {
          fileListCache.pending = null;
        }
      });

    fileListCache.key = cacheKey;
    fileListCache.pending = pending;
    return pending;
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
              selectable: isText
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
      const path = window.CodexOverleafProjectFiles.normalizePath(rawPath);
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

  function isSafeProjectPath(path) {
    return Boolean(path && !path.endsWith('/') && !/(^|\/)\.{1,2}(\/|$)/.test(path));
  }

  async function buildProjectSnapshot(params = {}) {
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
      const files = mergeSnapshotFiles(zipSnapshot.files, lightweightSnapshot?.files || []);
      return {
        id: getProjectId(),
        url: window.location.href,
        activePath,
        files,
        capabilities: {
          fullProjectSnapshot: true,
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
    const projectPaths = window.CodexOverleafProjectFiles.collectUniqueTextPaths([
      activePath,
      ...(Array.isArray(params.focusFiles) ? params.focusFiles : []),
      ...collectProjectTextPaths(activePath)
    ], 80);
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
      if (filePath === activePath) {
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

    if (activePath && getActiveFilePath() !== activePath) {
      await openFileByPath(activePath);
      await waitForActiveFile(activePath, 5000);
      await waitForActiveEditorText(activePath, 5000);
    }

    if (!files.length && (!lightweightOnly || params.allowZipFallback === false)) {
      files.push({
        path: activePath,
        content: readActiveEditorText(),
        source: 'active-editor'
      });
    }

    return {
      id: getProjectId(),
      url: window.location.href,
      activePath,
      files,
      capabilities: {
        fullProjectSnapshot: isCompleteProjectSnapshot(files, projectPaths),
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

  function getSnapshotCacheKey(params = {}) {
    const focusKey = Array.isArray(params.focusFiles)
      ? params.focusFiles.map(path => window.CodexOverleafProjectFiles.normalizePath(path)).filter(Boolean).sort().join(',')
      : '';
    return [
      window.location.origin,
      getProjectId() || window.location.pathname || window.location.href,
      params.preferLightweight ? 'lightweight' : 'full',
      params.includeBinaryFiles ? 'binary' : 'text',
      params.includeContent === false ? 'list' : 'content',
      focusKey
    ].join(':');
  }

  function invalidateProjectSnapshot() {
    snapshotCache.key = '';
    snapshotCache.capturedAt = 0;
    snapshotCache.value = null;
    snapshotCache.pending = null;
  }

  function getProjectFileListCacheKey(params = {}) {
    return [
      window.location.origin,
      getProjectId() || window.location.pathname || window.location.href,
      params.preferExact === false ? 'tree' : 'exact'
    ].join(':');
  }

  function normalizeSnapshotMaxAge(value) {
    if (value === 0) {
      return 0;
    }
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return SNAPSHOT_DEFAULT_MAX_AGE_MS;
    }
    return Math.max(0, Math.min(number, SNAPSHOT_MAX_CACHE_MS));
  }

  function normalizeFileListMaxAge(value) {
    if (value === 0) {
      return 0;
    }
    const number = Number(value);
    if (!Number.isFinite(number)) {
      return FILE_LIST_DEFAULT_MAX_AGE_MS;
    }
    return Math.max(0, Math.min(number, FILE_LIST_DEFAULT_MAX_AGE_MS));
  }

  function withSnapshotCacheMetadata(snapshot, cacheState, capturedAt) {
    const capabilities = snapshot?.capabilities || {};
    return {
      ...snapshot,
      capabilities: {
        ...capabilities,
        diagnostics: {
          ...(capabilities.diagnostics || {}),
          snapshotCache: cacheState,
          snapshotCapturedAt: new Date(capturedAt).toISOString()
        }
      }
    };
  }

  function withFileListCacheMetadata(fileList, cacheState, capturedAt) {
    const capabilities = fileList?.capabilities || {};
    return {
      ...fileList,
      capabilities: {
        ...capabilities,
        diagnostics: {
          ...(capabilities.diagnostics || {}),
          fileListCache: cacheState,
          fileListCapturedAt: new Date(capturedAt).toISOString()
        }
      }
    };
  }

  async function applyOperations(operations, options = {}) {
    const applied = [];
    const skipped = [];
    const baseFileLookup = window.CodexOverleafStaleGuard?.buildBaseFileLookup(options.baseFiles);

    for (const rawOperation of operations) {
      const operation = normalizeOperationPaths(rawOperation);
      if (operation.type === 'edit') {
        const result = await applyEditOperation(operation, { baseFileLookup });
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

    return {
      ok: skipped.length === 0,
      applied,
      skipped
    };
  }

  async function applyEditOperation(operation, options = {}) {
    const currentPath = getActiveFilePath();
    if (operation.path && currentPath && operation.path !== currentPath) {
      const opened = await openFileByPath(operation.path);
      if (!opened.ok) {
        return {
          ok: false,
          reason: `Cannot edit ${operation.path}; active file is ${currentPath}; ${opened.reason}`
        };
      }
    }

    const current = readActiveEditorText();
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
    window.CodexOverleafStaleGuard?.updateExpectedFileContent(
      options.baseFileLookup,
      operation.path,
      nextContent
    );
    return {
      ...result,
      verified: true,
      verifiedContent: nextContent
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
    return {
      ...operation,
      path: typeof operation.path === 'string'
        ? window.CodexOverleafProjectFiles.normalizePath(operation.path)
        : operation.path,
      to: typeof operation.to === 'string'
        ? window.CodexOverleafProjectFiles.normalizePath(operation.to)
        : operation.to
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
    if (getCodeMirrorEditorView()) {
      return {
        ok: true,
        type: 'codemirror-view'
      };
    }
    if (findEditorTextArea()) {
      return {
        ok: true,
        type: 'textarea'
      };
    }
    if (findEditorContentNode('.cm-content')) {
      return {
        ok: true,
        type: 'codemirror'
      };
    }
    if (findEditorContentNode('[contenteditable="true"]')) {
      return {
        ok: true,
        type: 'contenteditable'
      };
    }
    return {
      ok: false,
      type: 'unknown'
    };
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
    const editorView = getCodeMirrorEditorView();
    if (editorView) {
      return getCodeMirrorDocText(editorView);
    }

    const active = getDeepActiveElement();
    if (active && active.tagName === 'TEXTAREA' && !isInsideCodexPanel(active)) {
      return active.value;
    }

    const textarea = findEditorTextArea();
    if (textarea) {
      return textarea.value;
    }

    const cm = findEditorContentNode('.cm-content');
    if (cm) {
      return cm.innerText || cm.textContent || '';
    }

    const editable = findEditorContentNode('[contenteditable="true"]');
    if (editable) {
      return editable.innerText || editable.textContent || '';
    }

    return '';
  }

  function replaceActiveEditorText(text) {
    const editorView = getCodeMirrorEditorView();
    if (editorView) {
      const from = 0;
      const to = getCodeMirrorDocLength(editorView);
      editorView.dispatch({
        changes: {
          from,
          to,
          insert: text
        }
      });
      return {
        ok: true,
        method: 'codemirror-view'
      };
    }

    const active = getDeepActiveElement();
    const textarea = active?.tagName === 'TEXTAREA' && !isInsideCodexPanel(active)
      ? active
      : findEditorTextArea();

    if (textarea) {
      textarea.focus();
      textarea.value = text;
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: text }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        ok: true,
        method: 'textarea'
      };
    }

    const editable = findEditorContentNode('.cm-content') || findEditorContentNode('[contenteditable="true"]');
    if (editable) {
      editable.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
      editable.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: text }));
      return {
        ok: true,
        method: 'contenteditable'
      };
    }

    return {
      ok: false,
      reason: 'No editable surface was detected'
    };
  }

  function replaceActiveEditorPatches(patches, nextContent) {
    const normalized = normalizeTextPatches(patches, readActiveEditorText().length);
    if (!normalized.ok) {
      return normalized;
    }

    const editorView = getCodeMirrorEditorView();
    if (editorView) {
      editorView.dispatch({
        changes: normalized.patches.map(patch => ({
          from: patch.from,
          to: patch.to,
          insert: patch.insert
        }))
      });
      return {
        ok: true,
        method: 'codemirror-view-patch'
      };
    }

    const active = getDeepActiveElement();
    const textarea = active?.tagName === 'TEXTAREA' && !isInsideCodexPanel(active)
      ? active
      : findEditorTextArea();

    if (textarea && typeof textarea.setRangeText === 'function') {
      textarea.focus();
      for (const patch of normalized.patches.slice().sort((left, right) => right.from - left.from)) {
        textarea.setRangeText(patch.insert, patch.from, patch.to, 'end');
      }
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: '' }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        ok: true,
        method: 'textarea-patch'
      };
    }

    const result = replaceActiveEditorText(nextContent);
    return result.ok
      ? {
        ...result,
        method: `${result.method}-patch-fallback`
      }
      : result;
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

    return 'active.tex';
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
    const normalizedPath = window.CodexOverleafProjectFiles.normalizePath(filePath);
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
      const normalizedOwnName = window.CodexOverleafProjectFiles.normalizePath(ownName);
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
    const cleanName = window.CodexOverleafProjectFiles.normalizePath(name);
    const cleanFolder = window.CodexOverleafProjectFiles.normalizePath(folderPath);
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
      const path = window.CodexOverleafProjectFiles.normalizePath(decoder.decode(rawName));
      const isText = window.CodexOverleafProjectFiles.isTextProjectPath(path);
      const shouldInclude = path && !path.endsWith('/') && (isText || options.includeBinaryFiles);

      if (shouldInclude) {
        const file = { path };
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
      node.getAttribute('data-name'),
      node.getAttribute('aria-label'),
      node.getAttribute('title')
    ].find(value => window.CodexOverleafProjectFiles.isTextProjectPath(value));
    if (attrPath) {
      const normalizedAttrPath = window.CodexOverleafProjectFiles.normalizePath(attrPath);
      if (normalizedAttrPath && !normalizedAttrPath.includes('/')) {
        return inferPathFromTreeAncestors(node, normalizedAttrPath) || normalizedAttrPath;
      }
      return normalizedAttrPath;
    }

    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    const matches = text.match(/[^\s]+?\.(?:tex|bib|sty|cls|bst|bbx|cbx|lbx|cfg|def|clo|ist|txt|md|latex)\b/gi);
    const match = matches?.find(value => window.CodexOverleafProjectFiles.isTextProjectPath(value));
    if (!match) {
      return '';
    }
    const normalizedMatch = window.CodexOverleafProjectFiles.normalizePath(match);
    if (normalizedMatch && !normalizedMatch.includes('/')) {
      return inferPathFromTreeAncestors(node, normalizedMatch) || normalizedMatch;
    }
    return normalizedMatch;
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
    const path = window.CodexOverleafProjectFiles.normalizePath([...folders, fileName].join('/'));
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
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    if (!text || /[\\/]/.test(text) || window.CodexOverleafProjectFiles.isTextProjectPath(text)) {
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
