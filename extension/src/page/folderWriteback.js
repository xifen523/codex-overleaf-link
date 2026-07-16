(function initCodexOverleafFolderWriteback(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafFolderWriteback = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function folderWritebackFactory() {
  'use strict';

  function create(deps = {}) {
    const window = deps.window || (typeof globalThis !== 'undefined' ? globalThis : {});
    const document = deps.document || window.document || {};
    const treeOperations = deps.treeOperations || {};
    const normalizeSafeProjectPath = deps.normalizePath || fallbackNormalizePath;
    const delay = deps.delay || (ms => new Promise(resolve => window.setTimeout(resolve, ms)));
    const fetchImpl = deps.fetch || window.fetch?.bind(window);
    const readActiveEditorText = deps.readActiveEditorText || (() => '');
    const replaceActiveEditorText = deps.replaceActiveEditorText || (() => ({ ok: false }));
    const createRequestAttempts = 3;
    const writebackVisibilityTimeoutMs = 12000;
    const ambiguousCreateObservationMs = 5000;
    const rejectedCreateObservationMs = 720;

    async function ensureParentFolders(filePath) {
      const normalizedPath = normalizeSafeProjectPath(filePath);
      const parts = String(normalizedPath || '').split('/').filter(Boolean);
      if (!normalizedPath || !parts.length) {
        return folderFailure('The new file path is invalid.', { filePath });
      }

      const rootFolder = getRootFolder();
      const rootFolderId = readEntityId(rootFolder);
      if (!rootFolderId) {
        return folderFailure('Overleaf root folder metadata was unavailable.', { filePath: normalizedPath });
      }
      if (parts.length === 1) {
        return { ok: true, parentFolderId: rootFolderId, createdFolders: [] };
      }

      let parentFolder = rootFolder;
      let parentFolderId = rootFolderId;
      let folderPath = '';
      const createdFolders = [];
      for (const folderName of parts.slice(0, -1)) {
        folderPath = folderPath ? `${folderPath}/${folderName}` : folderName;
        const existing = findChildFolder(parentFolder, folderName);
        if (existing) {
          const existingId = readEntityId(existing);
          if (!existingId) {
            return folderFailure(`Overleaf did not expose an id for ${folderPath}.`, { filePath: normalizedPath, folderPath });
          }
          parentFolder = existing;
          parentFolderId = existingId;
          continue;
        }

        const created = await createFolder(parentFolderId, folderName, folderPath);
        if (!created.ok) return created;
        parentFolder = created.folder;
        parentFolderId = created.folderId;
        createdFolders.push(folderPath);
      }

      if (createdFolders.length && !await waitForFolderPath(folderPath, writebackVisibilityTimeoutMs)) {
        return folderFailure(`${folderPath} was created by Overleaf but did not appear in the project tree before timeout.`, {
          filePath: normalizedPath,
          folderPath,
          createdFolders
        });
      }
      return { ok: true, parentFolderId, createdFolders };
    }

    async function createTextFile(filePath, content, parentReady = null) {
      const normalizedPath = normalizeSafeProjectPath(filePath);
      const ready = parentReady?.ok ? parentReady : await ensureParentFolders(normalizedPath);
      if (!ready.ok) return ready;
      const projectId = treeOperations.getProjectId?.() || readProjectId();
      const csrfToken = readCsrfToken();
      const name = String(normalizedPath || '').split('/').pop() || '';
      if (!projectId || !csrfToken || !name || typeof fetchImpl !== 'function') {
        return fileFailure(`Cannot create ${normalizedPath}; Overleaf request metadata is unavailable.`, false);
      }

      const creation = await createDocumentRecord({
        normalizedPath,
        projectId,
        csrfToken,
        parentFolderId: ready.parentFolderId,
        name
      });
      if (!creation.ok) return creation;

      if (!await waitForProjectPath(normalizedPath, writebackVisibilityTimeoutMs)) {
        return fileFailure(`${normalizedPath} was created but did not appear in the Overleaf file tree.`, true);
      }
      const opened = await treeOperations.openFileByPath?.(normalizedPath, { force: true });
      if (!opened?.ok) {
        return fileFailure(`${normalizedPath} was created but could not be opened for content writeback.`, true, { opened });
      }

      const expected = String(content || '');
      if (expected) {
        let written = false;
        for (let attempt = 0; attempt < 20; attempt += 1) {
          const result = replaceActiveEditorText(expected);
          if (result?.ok) {
            written = true;
            break;
          }
          await delay(100);
        }
        if (!written || !await waitForEditorText(expected, 2000)) {
          return fileFailure(`${normalizedPath} was created but its content could not be verified.`, true);
        }
      }
      return {
        ok: true,
        method: 'overleaf-rest.create-doc',
        verified: true,
        verifiedContent: expected,
        createdFolders: ready.createdFolders || []
      };
    }

    async function createDocumentRecord({ normalizedPath, projectId, csrfToken, parentFolderId, name }) {
      let lastFailure = null;
      for (let attempt = 1; attempt <= createRequestAttempts; attempt += 1) {
        try {
          const response = await fetchImpl(`${window.location.origin}/project/${encodeURIComponent(projectId)}/doc`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'X-Csrf-Token': csrfToken
            },
            body: JSON.stringify({ parent_folder_id: parentFolderId, name })
          });
          const data = await parseResponseBody(response);
          if (response?.ok) return { ok: true };
          if (await observeProjectPath(normalizedPath, rejectedCreateObservationMs)) return { ok: true, recovered: true };
          const status = response?.status || 0;
          lastFailure = fileFailure(`Overleaf rejected creation of ${normalizedPath} (HTTP ${status || 'unknown'}).`, false, {
            status,
            serverMessage: readServerMessage(data),
            attempts: attempt
          });
          if (!isTransientCreateStatus(status)) return lastFailure;
        } catch (error) {
          if (await observeProjectPath(normalizedPath, ambiguousCreateObservationMs)) return { ok: true, recovered: true };
          lastFailure = fileFailure(`Creating ${normalizedPath} failed: ${error?.message || String(error || '')}`, false, {
            attempts: attempt
          });
        }
        if (attempt < createRequestAttempts) await delay(150 * attempt);
      }
      return lastFailure || fileFailure(`Creating ${normalizedPath} failed after retries.`, false);
    }

    async function waitForProjectPath(filePath, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() <= deadline) {
        if (treeOperations.projectPathExists?.(filePath) === true) return true;
        await delay(120);
      }
      return false;
    }

    async function waitForEditorText(expected, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() <= deadline) {
        if (readActiveEditorText() === expected) return true;
        await delay(80);
      }
      return false;
    }

    async function createFolder(parentFolderId, name, folderPath) {
      const projectId = treeOperations.getProjectId?.() || readProjectId();
      const csrfToken = readCsrfToken();
      if (!projectId || !csrfToken || typeof fetchImpl !== 'function') {
        return folderFailure(`Cannot create ${folderPath}; Overleaf request metadata is unavailable.`, {
          projectId: projectId || '',
          csrfTokenAvailable: Boolean(csrfToken),
          folderPath
        });
      }

      let lastFailure = null;
      for (let attempt = 1; attempt <= createRequestAttempts; attempt += 1) {
        try {
          const response = await fetchImpl(`${window.location.origin}/project/${encodeURIComponent(projectId)}/folder`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              'X-Csrf-Token': csrfToken
            },
            body: JSON.stringify({ parent_folder_id: parentFolderId, name })
          });
          const data = await parseResponseBody(response);
          if (response?.ok) {
            const folder = data?.folder || data;
            const folderId = readEntityId(folder);
            if (folderId) return { ok: true, folder, folderId };
          }
          const observed = await observeFolderEntity(
            folderPath,
            response?.ok ? ambiguousCreateObservationMs : rejectedCreateObservationMs
          );
          if (observed) return { ok: true, folder: observed, folderId: readEntityId(observed), recovered: true };
          const status = response?.status || 0;
          lastFailure = folderFailure(
            response?.ok
              ? `Overleaf created ${folderPath} without returning its folder id.`
              : `Overleaf rejected creation of ${folderPath} (HTTP ${status || 'unknown'}).`,
            { folderPath, status, serverMessage: readServerMessage(data), attempts: attempt }
          );
          if (response?.ok || !isTransientCreateStatus(status)) return lastFailure;
        } catch (error) {
          const observed = await observeFolderEntity(folderPath, ambiguousCreateObservationMs);
          if (observed) return { ok: true, folder: observed, folderId: readEntityId(observed), recovered: true };
          lastFailure = folderFailure(`Creating ${folderPath} failed: ${error?.message || String(error || '')}`, {
            folderPath,
            attempts: attempt
          });
        }
        if (attempt < createRequestAttempts) await delay(150 * attempt);
      }
      return lastFailure || folderFailure(`Creating ${folderPath} failed after retries.`, { folderPath });
    }

    async function observeFolderEntity(folderPath, timeoutMs) {
      const attempts = Math.max(1, Math.ceil(timeoutMs / 120));
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const folder = findFolderByPath(getRootFolder(), folderPath);
        if (folder && readEntityId(folder)) return folder;
        if (attempt + 1 < attempts) await delay(120);
      }
      return null;
    }

    async function observeProjectPath(filePath, timeoutMs) {
      const attempts = Math.max(1, Math.ceil(timeoutMs / 120));
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (treeOperations.projectPathExists?.(filePath) === true) return true;
        if (attempt + 1 < attempts) await delay(120);
      }
      return false;
    }

    function isTransientCreateStatus(status) {
      return status === 408 || status === 425 || status === 429 || status >= 500;
    }

    async function waitForFolderPath(folderPath, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() <= deadline) {
        if (treeOperations.folderPathExists?.(folderPath) === true || findFolderByPath(getRootFolder(), folderPath)) {
          return true;
        }
        await delay(120);
      }
      return false;
    }

    function getRootFolder() {
      const project = readMetaProject();
      const candidates = [
        window._ide?.project?.rootFolder,
        window._ide?.rootFolder,
        window.Overleaf?.project?.rootFolder,
        window.overleaf?.project?.rootFolder,
        project?.rootFolder
      ];
      for (const candidate of candidates) {
        const folder = Array.isArray(candidate) ? candidate[0] : candidate;
        if (folder && typeof folder === 'object' && readEntityId(folder)) return folder;
      }
      return null;
    }

    function findFolderByPath(rootFolder, folderPath) {
      let current = rootFolder;
      for (const part of String(folderPath || '').split('/').filter(Boolean)) {
        current = findChildFolder(current, part);
        if (!current) return null;
      }
      return current;
    }

    function findChildFolder(folder, name) {
      return (Array.isArray(folder?.folders) ? folder.folders : []).find(item => item?.name === name) || null;
    }

    function readEntityId(entity) {
      return String(entity?._id || entity?.id || '').trim();
    }

    function readProjectId() {
      const match = String(window.location?.pathname || '').match(/\/project\/([^/]+)/);
      return match ? decodeURIComponent(match[1]) : '';
    }

    function readCsrfToken() {
      const cached = window.metaAttributesCache?.get?.('ol-csrfToken');
      if (typeof cached === 'string' && cached) return cached;
      return String(document.head?.querySelector?.('meta[name="ol-csrfToken"]')?.content || '');
    }

    function readMetaProject() {
      const cached = window.metaAttributesCache?.get?.('ol-project');
      if (cached && typeof cached === 'object') return cached;
      const element = document.head?.querySelector?.('meta[name="ol-project"]');
      if (!element?.content) return null;
      try {
        return element.dataset?.type === 'json' ? JSON.parse(element.content) : null;
      } catch (_error) {
        return null;
      }
    }

    async function parseResponseBody(response) {
      try {
        const contentType = response?.headers?.get?.('content-type') || '';
        if (/application\/json/i.test(contentType)) return await response.json();
        const text = await response?.text?.();
        return text ? { message: text } : {};
      } catch (_error) {
        return {};
      }
    }

    function readServerMessage(data) {
      const message = data?.message?.text || data?.message || '';
      return typeof message === 'string' ? message : '';
    }

    function fileFailure(reason, changedDocument, evidence = {}) {
      return {
        ok: false,
        code: 'file_tree_verification_failed',
        reason,
        failure: {
          code: 'file_tree_verification_failed',
          stage: 'verify',
          severity: 'error',
          userMessage: reason,
          technicalMessage: reason,
          retryable: true,
          nextAction: 'Inspect the created file in Overleaf, then retry.',
          terminalState: 'failed',
          changedDocument,
          evidence
        }
      };
    }

    function folderFailure(reason, evidence = {}) {
      return {
        ok: false,
        code: 'parent_folder_create_failed',
        reason,
        failure: {
          code: 'parent_folder_create_failed',
          stage: 'write',
          severity: 'error',
          userMessage: reason,
          technicalMessage: reason,
          retryable: true,
          nextAction: 'Check the Overleaf folder path and write permission, then retry.',
          terminalState: 'failed',
          changedDocument: false,
          evidence
        }
      };
    }

    return { createTextFile, ensureParentFolders };
  }

  function fallbackNormalizePath(value) {
    const path = String(value || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    return path && !path.split('/').some(part => !part || part === '.' || part === '..') ? path : '';
  }

  return { create };
});
