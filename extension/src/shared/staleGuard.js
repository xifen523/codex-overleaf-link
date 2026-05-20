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
        reasonKey: 'missingBaseFile',
        reasonParams: { filePath },
        reason: `${filePath || '这个文件'} 在任务开始时没有被 Codex 读到。Codex 没有覆盖它；请刷新项目内容后重试。`
      };
    }

    const baseContent = baseFileLookup.get(filePath);
    if (!baseContent || baseContent.trim().length === 0) {
      if (typeof console !== 'undefined') {
        console.warn('[codex-overleaf] staleGuard: base empty for', filePath, '→ skipping check');
      }
      return { ok: true };
    }
    const current = normalizeText(currentContent);
    if (current !== baseContent) {
      if (typeof console !== 'undefined') {
        console.warn('[codex-overleaf] staleGuard: STALE', filePath,
          'base.length:', baseContent.length, 'current.length:', current.length,
          'base[0..80]:', JSON.stringify(baseContent.slice(0, 80)),
          'current[0..80]:', JSON.stringify(current.slice(0, 80)));
      }
      const patchRangeFreshness = checkPatchRangeFreshness(operation, current);
      if (patchRangeFreshness) {
        return patchRangeFreshness;
      }
      return {
        ok: false,
        code: 'stale_snapshot',
        reasonKey: 'staleSnapshot',
        reasonParams: { filePath },
        reason: `${filePath} 在任务执行期间被你或协作者改过，Codex 没有覆盖它。请查看差异后重试。`
      };
    }

    return { ok: true };
  }

  function checkPatchRangeFreshness(operation, currentContent) {
    const patches = Array.isArray(operation?.patches) ? operation.patches : [];
    if (!patches.length) {
      return null;
    }

    const current = normalizeText(currentContent);
    for (const rawPatch of patches) {
      const from = Number(rawPatch?.from);
      const to = Number(rawPatch?.to);
      const expected = String(rawPatch?.expected ?? '');
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > current.length) {
        return {
          ok: false,
          code: 'stale_patch_range',
          reasonKey: 'stalePatchLocation',
          reason: 'Codex 要修改的位置已经无法和当前 Overleaf 内容对齐，所以没有写入。请重新运行任务。'
        };
      }
      if (current.slice(from, to) !== expected) {
        return {
          ok: false,
          code: 'stale_patch_range',
          reasonKey: 'stalePatchConflict',
          reason: 'Codex 要修改的具体位置已经被你或协作者改过，所以没有覆盖它。请查看差异后重试。'
        };
      }
    }

    return {
      ok: true,
      reconciled: true,
      strategy: 'patch-range'
    };
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
    checkPatchRangeFreshness,
    normalizeText,
    normalizePath
  };
});
