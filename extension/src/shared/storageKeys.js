(function initStorageKeys(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafStorageKeys = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function storageKeysFactory() {
  'use strict';

  function getOverleafProjectId(urlLike) {
    try {
      const url = new URL(String(urlLike || ''));
      const match = url.pathname.match(/^\/project\/([^/?#]+)/);
      return match ? decodeURIComponent(match[1]) : '';
    } catch {
      return '';
    }
  }

  function getProjectStorageKey(baseKey, urlLike) {
    const projectId = getOverleafProjectId(urlLike);
    return projectId ? `${baseKey}:project:${projectId}` : baseKey;
  }

  return {
    getOverleafProjectId,
    getProjectStorageKey
  };
});
