(function initProjectFiles(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafProjectFiles = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function projectFilesFactory() {
  'use strict';

  const TEXT_EXTENSIONS = new Set([
    '.tex',
    '.bib',
    '.sty',
    '.cls',
    '.bst',
    '.bbx',
    '.cbx',
    '.lbx',
    '.cfg',
    '.def',
    '.clo',
    '.ist',
    '.txt',
    '.md',
    '.latex'
  ]);

  const BINARY_EXTENSIONS = new Set([
    '.pdf',
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.svg',
    '.eps',
    '.zip',
    '.gz',
    '.tar',
    '.doc',
    '.docx',
    '.ppt',
    '.pptx',
    '.xls',
    '.xlsx'
  ]);

  function isTextProjectPath(path) {
    const normalized = normalizePath(path);
    if (!normalized || /(^|\/)\.{1,2}(\/|$)/.test(normalized)) {
      return false;
    }

    const extension = getExtension(normalized);
    if (BINARY_EXTENSIONS.has(extension)) {
      return false;
    }
    return TEXT_EXTENSIONS.has(extension);
  }

  function collectUniqueTextPaths(paths, limit = 80) {
    const seen = new Set();
    const result = [];
    for (const path of paths || []) {
      const normalized = normalizePath(path);
      if (!isTextProjectPath(normalized) || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      result.push(normalized);
      if (result.length >= limit) {
        break;
      }
    }
    return result;
  }

  function normalizePath(path) {
    return String(path || '')
      .replace(/\s+/g, ' ')
      .replace(/\\/g, '/')
      .trim()
      .replace(/^\/+/, '');
  }

  function getExtension(path) {
    const fileName = path.split('/').pop() || '';
    const dotIndex = fileName.lastIndexOf('.');
    return dotIndex >= 0 ? fileName.slice(dotIndex).toLowerCase() : '';
  }

  function isUsableProjectFileContent(content) {
    const text = String(content || '').trim();
    if (!text) {
      return false;
    }
    return !/^(loading|loading\.{3}|loading…)$/i.test(text);
  }

  return {
    collectUniqueTextPaths,
    isUsableProjectFileContent,
    isTextProjectPath,
    normalizePath
  };
});
