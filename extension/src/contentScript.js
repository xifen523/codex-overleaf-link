(function initContentScript() {
  'use strict';

  if (!window.CodexOverleafContentRuntime || typeof window.CodexOverleafContentRuntime.init !== 'function') {
    throw new Error('Codex Overleaf content runtime did not load.');
  }
  window.CodexOverleafContentRuntime.init();
})();
