(function initCodexOverleafPageBridge() {
  'use strict';

  if (window.__codexOverleafPageBridgeInstalled) {
    return;
  }
  window.__codexOverleafPageBridgeInstalled = true;
  const SNAPSHOT_DEFAULT_MAX_AGE_MS = 2500;
  const SNAPSHOT_MAX_CACHE_MS = 15000;
  const ZIP_FETCH_TIMEOUT_MS = 10000;
  const snapshotCache = {
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
      return getProjectFileList();
    }
    if (method === 'createCheckpoint') {
      return createCheckpoint(params.label);
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

  async function getProjectSnapshot(params = {}) {
    const cacheKey = getSnapshotCacheKey();
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

  function getProjectFileList() {
    const activePath = getActiveFilePath();
    const internalDocRecords = collectDocRecords();
    const docRecordByPath = new Map(internalDocRecords.map(record => [record.path, record]));
    const paths = collectProjectTextPaths(activePath);
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
        method: 'overleaf-file-list',
        skipped: [],
        diagnostics: {
          docRecordCount: internalDocRecords.length,
          docRecords: internalDocRecords.slice(0, 8)
        },
        note: 'Listed Overleaf project text files from page state without downloading the source ZIP.'
      }
    };
  }

  async function buildProjectSnapshot(params = {}) {
    const activePath = getActiveFilePath();
    const internalDocRecords = collectDocRecords();
    const docRecordByPath = new Map(internalDocRecords.map(record => [record.path, record]));
    const zipSnapshot = await fetchProjectZipSnapshot(params);
    if (zipSnapshot.ok && zipSnapshot.files.length) {
      return {
        id: getProjectId(),
        url: window.location.href,
        activePath,
        files: zipSnapshot.files,
        capabilities: {
          fullProjectSnapshot: zipSnapshot.files.length > 1,
          method: 'overleaf-zip',
          skipped: [],
          diagnostics: {
            zipEndpoint: zipSnapshot.endpoint,
            docRecordCount: internalDocRecords.length,
            docRecords: internalDocRecords.slice(0, 8)
          },
          note: 'Captured project text files from Overleaf source ZIP using the current browser session.'
        }
      };
    }

    const projectPaths = collectProjectTextPaths(activePath);
    const files = [];
    const skipped = [];
    if (!zipSnapshot.ok) {
      skipped.push({
        path: 'project.zip',
        reason: zipSnapshot.reason
      });
    }
    let previousSignature = '';

    for (const filePath of projectPaths) {
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

    if (!files.length) {
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
        fullProjectSnapshot: files.length > 1,
        method: files.some(file => /^overleaf-doc-fetch/.test(file.source))
          ? 'overleaf-doc-fetch'
          : (files.length > 1 ? 'open-file-tree-text-files' : 'active-editor'),
        skipped,
        diagnostics: {
          docRecordCount: internalDocRecords.length,
          docRecords: internalDocRecords.slice(0, 8)
        },
        note: files.length > 1
          ? 'Captured text project files from Overleaf document data, with editor fallback when needed.'
          : 'Only the active editor was captured; no additional visible text files were detected.'
      }
    };
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

  function getSnapshotCacheKey() {
    return [
      window.location.origin,
      getProjectId() || window.location.pathname || window.location.href
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
    if (typeof operation.replaceAll === 'string') {
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
        reason: 'Edit operation must provide replaceAll or find/replace fields'
      };
    }

    const result = replaceActiveEditorText(nextContent);
    if (result.ok) {
      window.CodexOverleafStaleGuard?.updateExpectedFileContent(
        options.baseFileLookup,
        operation.path,
        nextContent
      );
    }
    return result;
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
        recordFileTreeOperationSuccess(operation, options.baseFileLookup);
        return {
          ok: true,
          method: `fileTreeManager.${methodName}`
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

  function collectDocRecords() {
    const seen = new Set();
    const records = [];
    for (const record of [...collectInternalDocRecords(), ...collectDomDocRecords()]) {
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

  function collectInternalDocRecords() {
    const records = [];
    const seenObjects = new WeakSet();
    const seenRecords = new Set();
    const roots = collectInternalRoots();

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

  function collectInternalRoots() {
    const roots = [window._ide, window.Overleaf, window.overleaf, window.OL].filter(Boolean);
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
        const files = await extractTextFilesFromZip(buffer);
        if (!files.length) {
          errors.push(`${endpoint} returned no text files (${contentType || 'unknown content type'})`);
          continue;
        }
        return {
          ok: true,
          endpoint,
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

  async function extractTextFilesFromZip(buffer) {
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
    let offset = centralDirectoryOffset;

    for (let index = 0; index < entryCount; index += 1) {
      if (view.getUint32(offset, true) !== 0x02014b50) {
        throw new Error('Invalid ZIP central-directory header');
      }

      const compressionMethod = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const fileNameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localHeaderOffset = view.getUint32(offset + 42, true);
      const rawName = bytes.slice(offset + 46, offset + 46 + fileNameLength);
      const path = window.CodexOverleafProjectFiles.normalizePath(decoder.decode(rawName));

      if (path && !path.endsWith('/') && window.CodexOverleafProjectFiles.isTextProjectPath(path)) {
        const contentBytes = await readZipEntryBytes(view, bytes, localHeaderOffset, compressedSize, compressionMethod);
        files.push({
          path,
          content: decoder.decode(contentBytes)
        });
      }

      offset += 46 + fileNameLength + extraLength + commentLength;
    }

    return files;
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
      return window.CodexOverleafProjectFiles.normalizePath(attrPath);
    }

    const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
    const matches = text.match(/[^\s]+?\.(?:tex|bib|sty|cls|bst|bbx|cbx|lbx|cfg|def|clo|ist|txt|md|latex)\b/gi);
    const match = matches?.find(value => window.CodexOverleafProjectFiles.isTextProjectPath(value));
    return match ? window.CodexOverleafProjectFiles.normalizePath(match) : '';
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
