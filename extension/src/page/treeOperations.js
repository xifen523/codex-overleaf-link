(function initCodexOverleafTreeOperations(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafTreeOperations = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function treeOperationsFactory() {
  'use strict';

  const TEXT_PATH_EXTENSION_PATTERN = '(?:tex|bib|sty|cls|bst|bbx|cbx|lbx|cfg|def|clo|ist|txt|md|latex)';

  function create(deps = {}) {
    const window = deps.window || (typeof globalThis !== 'undefined' ? globalThis : {});
    const document = deps.document || window.document || {};
    const normalizeSafeProjectPath = typeof deps.normalizePath === 'function'
      ? deps.normalizePath
      : fallbackNormalizeSafeProjectPath;
    const readActiveEditorText = typeof deps.readActiveEditorText === 'function'
      ? deps.readActiveEditorText
      : () => '';
    const NodeCtor = window.Node || (typeof Node !== 'undefined' ? Node : null);
    const EventTargetCtor = window.EventTarget || (typeof EventTarget !== 'undefined' ? EventTarget : null);
    let internalDocPathByIdCache = null;
    let internalDocPathByIdCacheTime = 0;
    let domProjectPathCache = null;
    let domProjectPathCacheTime = 0;

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

  async function openFileByPath(filePath, options = {}) {
    const normalizedPath = normalizeSafeProjectPath(filePath);
    if (!normalizedPath) {
      return {
        ok: false,
        reason: 'Invalid file path'
      };
    }

    if (options.force !== true && getActiveFilePath() === normalizedPath) {
      return {
        ok: true,
        method: 'already-active'
      };
    }

    const node = findFileTreeNode(normalizedPath);
    if (node) {
      dispatchFileTreeOpenClick(node);
      await delay(250);
      const active = await waitForActiveFile(normalizedPath, 2500);
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
        await method.call(manager, normalizedPath);
        const active = await waitForActiveFile(normalizedPath, 2500);
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
      reason: `Could not open ${normalizedPath}`
    };
  }

  function dispatchFileTreeOpenClick(node) {
    const target = findFileTreeOpenClickTarget(node) || node;
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  function findFileTreeOpenClickTarget(node) {
    const selectors = [
      '.file-tree-entity-details',
      '.item-name',
      '.entity-name',
      '.file-tree-entity-button',
      '[role="button"]',
      'button'
    ];
    for (const selector of selectors) {
      let candidates = [];
      try {
        candidates = Array.from(node.querySelectorAll?.(selector) || []);
      } catch (_error) {
        candidates = [];
      }
      const candidate = candidates.find(item => !isFileTreeMenuControl(item));
      if (candidate) {
        return candidate;
      }
    }
    return node;
  }

  function isFileTreeMenuControl(node) {
    const signal = [
      node?.id || '',
      node?.className || '',
      node?.getAttribute?.('aria-label') || '',
      node?.getAttribute?.('title') || '',
      node?.textContent || ''
    ].join(' ');
    return /menu|more_vert|action/i.test(signal);
  }

  function findFileTreeNode(filePath) {
    const normalizedPath = normalizeSafeProjectPath(filePath);
    if (!normalizedPath) {
      return null;
    }
    const fileName = normalizedPath.split('/').pop();
    const allowBasenameFallback = !normalizedPath.includes('/');
    const basenameMatches = [];
    const candidates = document.querySelectorAll('[role="treeitem"], [role="row"], .file-tree *, .project-tree *');
    for (const node of candidates) {
      const path = readProjectPathFromNode(node);
      const text = normalizeDomText(node.textContent || '');
      if (path === normalizedPath || text === normalizedPath) {
        return node;
      }
      if (allowBasenameFallback && (path === fileName || text === fileName)) {
        basenameMatches.push(node);
      }
    }
    return basenameMatches.length === 1 ? basenameMatches[0] : null;
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
      || (NodeCtor && value instanceof NodeCtor)
      || (EventTargetCtor && value instanceof EventTargetCtor && value.constructor?.name !== 'Object');
  }

  function joinPath(folderPath, name) {
    const cleanName = normalizeSafeProjectPath(name);
    const cleanFolder = normalizeSafeProjectPath(folderPath);
    if (!cleanName) {
      return cleanFolder;
    }
    return cleanFolder ? `${cleanFolder}/${cleanName}` : cleanName;
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
    const explicitAttrPath = [
      node.getAttribute('data-path'),
      node.getAttribute('data-file-path')
    ].map(normalizeProjectPathCandidate).find(Boolean);
    if (explicitAttrPath) {
      if (explicitAttrPath.includes('/')) {
        return explicitAttrPath;
      }
      return resolveProjectPathFromDomDocId(node, explicitAttrPath)
        || inferPathFromTreeAncestors(node, explicitAttrPath)
        || (node.parentElement ? resolveProjectPathFromDomTree(node, explicitAttrPath) : '')
        || explicitAttrPath;
    }

    const attrPath = normalizeProjectPathCandidate(node.getAttribute('data-name'));
    if (attrPath) {
      if (!attrPath.includes('/')) {
        return inferPathFromTreeAncestors(node, attrPath)
          || resolveProjectPathFromDomDocId(node, attrPath)
          || resolveProjectPathFromDomTree(node, attrPath)
          || attrPath;
      }
      return attrPath;
    }

    const labelPath = [
      node.getAttribute('aria-label'),
      node.getAttribute('title')
    ].map(normalizeProjectPathCandidate).find(Boolean);
    if (labelPath) {
      if (!labelPath.includes('/')) {
        return inferPathFromTreeAncestors(node, labelPath)
          || resolveProjectPathFromDomDocId(node, labelPath)
          || resolveProjectPathFromDomTree(node, labelPath)
          || labelPath;
      }
      return labelPath;
    }

    const textPath = normalizeProjectPathCandidate(node.textContent || '');
    if (!textPath) {
      const docIdPath = resolveProjectPathFromDomDocId(node);
      const domTreePath = resolveProjectPathFromDomTree(node);
      return docIdPath || domTreePath;
    }
    if (!textPath.includes('/')) {
      return inferPathFromTreeAncestors(node, textPath)
        || resolveProjectPathFromDomDocId(node, textPath)
        || resolveProjectPathFromDomTree(node, textPath)
        || textPath;
    }
    return textPath;
  }

  function resolveProjectPathFromDomTree(node, pathHint = '') {
    const cache = getDomProjectPathCache();
    const normalizedHint = normalizeSafeProjectPath(pathHint);
    let current = node || null;
    for (let depth = 0; current && depth < 8; depth += 1) {
      const resolvedPath = cache.get(current) || '';
      if (resolvedPath && pathMatchesHint(resolvedPath, normalizedHint)) {
        return resolvedPath;
      }
      current = current.parentElement;
    }
    return '';
  }

  function pathMatchesHint(path, hint) {
    if (!hint) {
      return true;
    }
    if (hint.includes('/')) {
      return path === hint;
    }
    return (path.split('/').pop() || '') === hint;
  }

  function getDomProjectPathCache() {
    const now = Date.now();
    if (domProjectPathCache && now - domProjectPathCacheTime < 1000) {
      return domProjectPathCache;
    }

    const pathByNode = new WeakMap();
    const visited = new WeakSet();
    const roots = uniqueNodes([
      ...collectElements('.file-tree', 20),
      ...collectElements('.project-tree', 20),
      ...collectElements('.file-tree-inner', 20),
      ...collectElements('[role="tree"]', 40)
    ]);
    for (const root of roots) {
      walkDomProjectTree(root, '', 0, pathByNode, visited);
    }

    domProjectPathCache = pathByNode;
    domProjectPathCacheTime = now;
    return domProjectPathCache;
  }

  function walkDomProjectTree(node, folderPath, depth, pathByNode, visited) {
    if (!node || depth > 60 || visited.has(node)) {
      return;
    }
    visited.add(node);

    const filePath = readFilePathFromTreeNodeSelf(node, folderPath);
    const folderName = filePath ? '' : readFolderNameFromNode(node);
    const nextFolderPath = folderName ? joinPath(folderPath, folderName) : folderPath;
    if (filePath) {
      pathByNode.set(node, filePath);
    }

    const children = Array.from(node.children || []);
    let pendingSiblingFolderPath = '';
    for (const child of children) {
      const childFilePath = readFilePathFromTreeNodeSelf(child, nextFolderPath);
      const childFolderName = childFilePath ? '' : readFolderNameFromNode(child);
      const childIsNestedList = isNestedFolderListNode(child);
      const childFolderPath = childIsNestedList && pendingSiblingFolderPath
        ? pendingSiblingFolderPath
        : nextFolderPath;
      walkDomProjectTree(child, childFolderPath, depth + 1, pathByNode, visited);

      if (childFolderName) {
        pendingSiblingFolderPath = joinPath(nextFolderPath, childFolderName);
      } else if (!childIsNestedList && childFilePath) {
        pendingSiblingFolderPath = '';
      } else if (childIsNestedList && pendingSiblingFolderPath) {
        pendingSiblingFolderPath = '';
      }
    }
  }

  function isNestedFolderListNode(node) {
    const className = String(node?.className || '');
    const role = node?.getAttribute?.('role') || '';
    return /file-tree-folder-list/i.test(className)
      || (role === 'tree' && !/file-tree-list/i.test(className));
  }

  function readFilePathFromTreeNodeSelf(node, folderPath) {
    const candidates = [
      node.getAttribute?.('data-path'),
      node.getAttribute?.('data-file-path'),
      node.getAttribute?.('data-name'),
      node.getAttribute?.('aria-label'),
      node.getAttribute?.('title'),
      node.textContent || ''
    ];
    for (const value of candidates) {
      const path = normalizeProjectPathCandidate(value);
      if (!path) {
        continue;
      }
      const resolvedPath = path.includes('/') ? path : joinPath(folderPath, path);
      if (window.CodexOverleafProjectFiles.isTextProjectPath(resolvedPath)) {
        return resolvedPath;
      }
    }
    return '';
  }

  function resolveProjectPathFromDomDocId(node, pathHint = '') {
    const id = readDomDocId(node);
    if (!id) {
      return '';
    }
    const resolvedPath = getInternalDocPathByIdMap().get(id) || '';
    if (!resolvedPath) {
      return '';
    }
    const normalizedHint = normalizeSafeProjectPath(pathHint);
    if (!normalizedHint) {
      return resolvedPath;
    }
    if (normalizedHint.includes('/')) {
      return resolvedPath === normalizedHint ? resolvedPath : '';
    }
    const resolvedName = resolvedPath.split('/').pop() || '';
    return resolvedName === normalizedHint ? resolvedPath : '';
  }

  function getInternalDocPathByIdMap() {
    const now = Date.now();
    if (internalDocPathByIdCache && now - internalDocPathByIdCacheTime < 1000) {
      return internalDocPathByIdCache;
    }

    const byId = new Map();
    const ambiguousIds = new Set();
    for (const record of collectInternalDocRecords({ includeWindowGlobals: false })) {
      if (!record?.id || !window.CodexOverleafProjectFiles.isTextProjectPath(record.path)) {
        continue;
      }
      const existingPath = byId.get(record.id);
      if (existingPath && existingPath !== record.path) {
        ambiguousIds.add(record.id);
        continue;
      }
      byId.set(record.id, record.path);
    }
    for (const id of ambiguousIds) {
      byId.delete(id);
    }
    internalDocPathByIdCache = byId;
    internalDocPathByIdCacheTime = now;
    return internalDocPathByIdCache;
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

    async function navigateToFile(filePath, options = {}) {
      const normalizedPath = normalizeSafeProjectPath(filePath);
      if (!normalizedPath) {
        return {
          loaded: false,
          editorReady: false,
          reason: 'Invalid file path'
        };
      }
      const opened = await openFileByPath(normalizedPath);
      if (!opened.ok) {
        return {
          loaded: false,
          editorReady: false,
          reason: opened.reason || 'Could not open file'
        };
      }
      const ready = await waitForActiveEditorText(normalizedPath, resolveTimeoutMs(options, 2500));
      return {
        loaded: true,
        editorReady: ready.ok === true,
        method: opened.method,
        reason: ready.ok ? '' : ready.reason
      };
    }

    async function createFile(filePath, content, options = {}) {
      return callFileTreeMutation({
        type: 'create',
        path: filePath,
        content
      }, options);
    }

    async function renameFile(fromPath, toPath, options = {}) {
      return callFileTreeMutation({
        type: 'rename',
        path: fromPath,
        to: toPath
      }, options);
    }

    async function deleteFile(filePath, options = {}) {
      return callFileTreeMutation({
        type: 'delete',
        path: filePath
      }, options);
    }

    async function callFileTreeMutation(rawOperation, options = {}) {
      const operation = {
        ...rawOperation,
        path: normalizeSafeProjectPath(rawOperation.path),
        to: rawOperation.to ? normalizeSafeProjectPath(rawOperation.to) : rawOperation.to
      };
      if (!operation.path || ((operation.type === 'rename' || operation.type === 'move') && !operation.to)) {
        return buildTreeContractResult(operation, false, 'Invalid file-tree path');
      }

      const manager = findFileTreeManager();
      for (const methodName of fileTreeMethodNames(operation.type)) {
        const method = manager?.[methodName];
        if (typeof method !== 'function') {
          continue;
        }
        try {
          if (operation.type === 'create') {
            await method.call(manager, operation.path, normalizeCreateFileContent(operation.path, operation.content));
          } else if (operation.type === 'rename' || operation.type === 'move') {
            await method.call(manager, operation.path, operation.to);
          } else if (operation.type === 'delete') {
            await method.call(manager, operation.path);
          }
          await delay(120);
          return buildTreeContractResult(operation, verifyTreeMutation(operation), '', 'fileTreeManager.' + methodName);
        } catch (_error) {
          // Try the next known Overleaf file-tree method.
        }
      }
      return buildTreeContractResult(operation, false, 'No supported Overleaf file-tree method was detected');
    }

    function normalizeCreateFileContent(filePath, content) {
      if (content instanceof Uint8Array) {
        const fileName = String(filePath || '').split('/').filter(Boolean).pop() || 'asset';
        if (typeof File === 'function') {
          return new File([content], fileName);
        }
        return new Blob([content]);
      }
      return String(content || '');
    }

    function verifyTreeMutation(operation) {
      if (operation.type === 'delete') {
        return !projectPathExists(operation.path);
      }
      if (operation.type === 'rename' || operation.type === 'move') {
        return Boolean(operation.to && projectPathExists(operation.to) && !projectPathExists(operation.path));
      }
      return projectPathExists(operation.path);
    }

    function buildTreeContractResult(operation, ok, reason = '', method = '') {
      if (operation.type === 'delete') {
        return {
          deleted: ok,
          reason: ok ? '' : reason,
          method
        };
      }
      if (operation.type === 'rename' || operation.type === 'move') {
        return {
          renamed: ok,
          reason: ok ? '' : reason,
          method
        };
      }
      return {
        created: ok,
        reason: ok ? '' : reason,
        method
      };
    }

    function fileTreeMethodNames(type) {
      return {
        create: ['createDoc', 'createFile', 'addDoc', 'addFile'],
        rename: ['renameEntity', 'renameFile', 'renameDoc'],
        move: ['moveEntity', 'moveFile', 'moveDoc'],
        delete: ['deleteEntity', 'deleteFile', 'deleteDoc', 'removeEntity']
      }[type] || [];
    }

    function resolveTimeoutMs(options = {}, fallback) {
      const value = Number(options.timeoutMs);
      return Number.isFinite(value) && value >= 0 ? value : fallback;
    }

    return {
      collectDocRecords,
      collectDomProjectPaths,
      collectInternalRootKeys,
      collectProjectTextPaths,
      contentSignature,
      createFile,
      deleteFile,
      fileTreeMethodNames,
      findFileTreeManager,
      findFileTreeNode,
      findHistoryObject,
      getActiveFilePath,
      getProjectId,
      navigateToFile,
      openFileByPath,
      projectPathExists,
      readProjectPathFromNode,
      renameFile,
      waitForActiveEditorText,
      waitForActiveFile
    };
  }

  function fallbackNormalizeSafeProjectPath(value) {
    const text = String(value || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '').trim();
    if (!text || text.split('/').some(part => !part || part === '.' || part === '..')) {
      return '';
    }
    return text;
  }

  return { create };
});
