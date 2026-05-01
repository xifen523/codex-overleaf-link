(function initStaleGuard(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafStaleGuard = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function staleGuardFactory() {
  'use strict';

  function buildBaseFileLookup(files) {
    if (!Array.isArray(files) || files.length === 0) {
      return null;
    }

    const lookup = new Map();
    for (const file of files) {
      if (typeof file?.path === 'string') {
        const path = normalizePath(file.path);
        if (path) {
          lookup.set(path, normalizeText(file.content));
        }
      }
    }
    return lookup.size ? lookup : null;
  }

  function checkOperationFreshness(operation, currentContent, baseFileLookup) {
    if (!baseFileLookup || operation?.type !== 'edit') {
      return { ok: true };
    }

    const filePath = normalizePath(operation.path);
    if (!filePath || !baseFileLookup.has(filePath)) {
      return {
        ok: false,
        code: 'missing_base_file',
        reason: `${filePath || '这个文件'} 在任务开始时没有被 Codex 读到。Codex 没有覆盖它；请刷新项目内容后重试。`
      };
    }

    const baseContent = baseFileLookup.get(filePath);
    const current = normalizeText(currentContent);
    if (current !== baseContent) {
      return {
        ok: false,
        code: 'stale_snapshot',
        reason: `${filePath} 在任务执行期间被你或协作者改过，Codex 没有覆盖它。请查看差异后重试。`
      };
    }

    return { ok: true };
  }

  function updateExpectedFileContent(baseFileLookup, filePath, content) {
    const path = normalizePath(filePath);
    if (!baseFileLookup || !path) {
      return;
    }
    baseFileLookup.set(path, normalizeText(content));
  }

  function removeExpectedFile(baseFileLookup, filePath) {
    const path = normalizePath(filePath);
    if (!baseFileLookup || !path) {
      return;
    }
    baseFileLookup.delete(path);
  }

  function moveExpectedFile(baseFileLookup, fromPath, toPath) {
    const from = normalizePath(fromPath);
    const to = normalizePath(toPath);
    if (!baseFileLookup || !from || !to) {
      return;
    }
    if (!baseFileLookup.has(from)) {
      return;
    }
    const content = baseFileLookup.get(from);
    baseFileLookup.delete(from);
    baseFileLookup.set(to, content);
  }

  function normalizeText(value) {
    return String(value ?? '').replace(/\r\n/g, '\n');
  }

  function normalizePath(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/\\/g, '/')
      .trim()
      .replace(/^\/+/, '');
  }

  return {
    buildBaseFileLookup,
    checkOperationFreshness,
    updateExpectedFileContent,
    removeExpectedFile,
    moveExpectedFile,
    normalizeText,
    normalizePath
  };
});
