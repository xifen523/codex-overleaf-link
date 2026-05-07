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
  const MAX_SAFE_PROJECT_PATH_LENGTH = 2048;

  function isTextProjectPath(path) {
    const normalized = normalizeSafeProjectPath(path);
    if (!normalized) {
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
      const normalized = normalizeSafeProjectPath(path);
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

  function normalizeSafeProjectPath(value) {
    if (typeof value !== 'string') {
      return '';
    }
    if (hasControlCharacter(value)) {
      return '';
    }
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > MAX_SAFE_PROJECT_PATH_LENGTH) {
      return '';
    }
    if (trimmed.startsWith('/') || trimmed.includes('\\') || hasWindowsDrivePrefix(trimmed)) {
      return '';
    }

    let decoded = trimmed;
    for (let index = 0; index < 3; index += 1) {
      if (hasEncodedSeparator(decoded)) {
        return '';
      }
      let next;
      try {
        next = decodeURIComponent(decoded);
      } catch (_error) {
        return '';
      }
      if (next === decoded) {
        break;
      }
      decoded = next;
    }

    if (hasControlCharacter(decoded)
      || decoded.startsWith('/')
      || decoded.includes('\\')
      || hasWindowsDrivePrefix(decoded)
      || decoded.length > MAX_SAFE_PROJECT_PATH_LENGTH) {
      return '';
    }

    const normalized = decoded.replace(/\/+/g, '/').trim();
    if (!normalized || normalized.length > MAX_SAFE_PROJECT_PATH_LENGTH) {
      return '';
    }
    const segments = normalized.split('/');
    if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
      return '';
    }
    return normalized;
  }

  function assertSafeProjectPath(value, label = 'path') {
    const normalized = normalizeSafeProjectPath(value);
    if (!normalized) {
      throw new Error(`Invalid ${label}`);
    }
    return normalized;
  }

  function hasControlCharacter(value) {
    return /[\u0000-\u001f\u007f]/.test(String(value || ''));
  }

  function hasEncodedSeparator(value) {
    return /%(?:2f|5c)/i.test(String(value || ''));
  }

  function hasWindowsDrivePrefix(value) {
    return /^[A-Za-z]:/.test(String(value || ''));
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
    MAX_SAFE_PROJECT_PATH_LENGTH,
    assertSafeProjectPath,
    collectUniqueTextPaths,
    isUsableProjectFileContent,
    isTextProjectPath,
    normalizePath,
    normalizeSafeProjectPath
  };
});
