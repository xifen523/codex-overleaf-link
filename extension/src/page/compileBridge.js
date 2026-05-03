(function initCompileBridge(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafCompileBridge = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function compileBridgeFactory() {
  'use strict';

  function create(deps = {}) {
    const pageWindow = deps.window || window;
    const pageDocument = deps.document || document;
    let installed = false;
    const state = {
      capturedRequestTemplate: null,
      lastCompileResponse: null,
      lastCompileAt: 0,
      lastCompileSourceChangeTimestamp: 0,
      lastKnownSourceEditTimestamp: 0
    };

    function install() {
      if (installed) {
        return;
      }
      installed = true;
      interceptCompileRequests();
      if (typeof pageDocument.addEventListener === 'function') {
        pageDocument.addEventListener('input', markSourceEditFromInput, true);
      }
    }

    function interceptCompileRequests() {
      const originalFetch = pageWindow.fetch;
      pageWindow.fetch = async function (...args) {
        const [resource, init] = args;
        const url = typeof resource === 'string' ? resource : (resource?.url || '');
        const method = (init?.method || 'GET').toUpperCase();
        const isCompileRequest = /\/project\/[^/]+\/compile\b/.test(url) && method === 'POST';
        const compileSourceChangeTimestamp = isCompileRequest ? state.lastKnownSourceEditTimestamp : 0;

        if (isCompileRequest) {
          state.capturedRequestTemplate = {
            url,
            method: 'POST',
            headers: init?.headers ? (
              init.headers instanceof Headers
                ? Object.fromEntries(init.headers.entries())
                : { ...init.headers }
            ) : {},
            body: init?.body || null
          };
        }

        const response = await originalFetch.apply(this, args);

        if (isCompileRequest && response.ok) {
          try {
            const clone = response.clone();
            const json = await clone.json();
            const CompileAdapter = pageWindow.CodexOverleafCompileAdapter;
            if (CompileAdapter) {
              state.lastCompileResponse = CompileAdapter.parseCompileResponse(json);
              state.lastCompileAt = Date.now();
              state.lastCompileSourceChangeTimestamp = compileSourceChangeTimestamp;
            }
          } catch (_e) { /* ignore parse errors */ }
        }

        return response;
      };
    }

    async function triggerCompile(params = {}) {
      const template = state.capturedRequestTemplate;
      if (!template) {
        return { ok: false, reason: 'No compile request template captured yet. Compile once manually in Overleaf first.' };
      }

      const saveResult = await deps.waitForSaveState({ deadlineMs: params.waitForSaveMs || 5000 });
      const sourceChangeTimestamp = state.lastKnownSourceEditTimestamp;

      try {
        const response = await pageWindow.fetch(template.url, {
          method: template.method,
          headers: template.headers,
          body: template.body,
          credentials: 'same-origin'
        });
        if (!response.ok) {
          return { ok: false, reason: `Compile request failed with status ${response.status}` };
        }
        const json = await response.json();
        const CompileAdapter = pageWindow.CodexOverleafCompileAdapter;
        const parsed = CompileAdapter
          ? CompileAdapter.parseCompileResponse(json)
          : { ok: false, reason: 'CompileAdapter not available' };
        state.lastCompileResponse = parsed;
        state.lastCompileAt = Date.now();
        state.lastCompileSourceChangeTimestamp = sourceChangeTimestamp;
        return {
          ok: true,
          compile: parsed,
          saveStateVerified: saveResult.ok
        };
      } catch (error) {
        return { ok: false, reason: `Compile request error: ${error.message}` };
      }
    }

    async function getCompileLog(params = {}) {
      const CompileAdapter = pageWindow.CodexOverleafCompileAdapter;
      if (!CompileAdapter) {
        return { ok: false, reason: 'CompileAdapter not loaded' };
      }

      const maxAgeMs = params.maxAgeMs || 30000;
      const compileLogFresh = CompileAdapter.isCompileLogFresh(
        { sourceChangeTimestamp: state.lastCompileSourceChangeTimestamp },
        state.lastKnownSourceEditTimestamp
      );
      const needsFreshCompile = !state.lastCompileResponse?.ok
        || (Date.now() - state.lastCompileAt > maxAgeMs)
        || !compileLogFresh;

      if (needsFreshCompile && params.triggerIfStale !== false) {
        const compileResult = await triggerCompile({ waitForSaveMs: params.waitForSaveMs || 5000 });
        if (!compileResult.ok) {
          return { ok: false, reason: `Could not get fresh compile: ${compileResult.reason}` };
        }
      }

      const compiled = state.lastCompileResponse;
      if (!compiled?.ok || !compiled.logUrl) {
        return { ok: false, reason: 'No compile log URL available' };
      }

      try {
        const logUrl = compiled.logUrl.startsWith('/')
          ? `${pageWindow.location.origin}${compiled.logUrl}`
          : compiled.logUrl;
        const response = await pageWindow.fetch(logUrl, { credentials: 'same-origin' });
        if (!response.ok) {
          return { ok: false, reason: `Failed to fetch compile log: ${response.status}` };
        }
        const logContent = await response.text();
        const truncated = CompileAdapter.truncateLogForContext(logContent);
        const parsed = CompileAdapter.parseLogErrors(logContent);
        return {
          ok: true,
          log: truncated,
          errors: parsed.errors,
          warnings: parsed.warnings,
          compiledAt: state.lastCompileAt,
          fresh: CompileAdapter.isCompileLogFresh(
            { sourceChangeTimestamp: state.lastCompileSourceChangeTimestamp },
            state.lastKnownSourceEditTimestamp
          )
        };
      } catch (error) {
        return { ok: false, reason: `Log fetch error: ${error.message}` };
      }
    }

    function getCompileState() {
      return {
        ok: true,
        hasCapturedTemplate: Boolean(state.capturedRequestTemplate),
        lastCompileAt: state.lastCompileAt,
        lastCompileOk: state.lastCompileResponse?.ok || false,
        lastCompileSourceChangeTimestamp: state.lastCompileSourceChangeTimestamp,
        lastKnownSourceEditTimestamp: state.lastKnownSourceEditTimestamp
      };
    }

    function markSourceEdited(timestamp = Date.now()) {
      state.lastKnownSourceEditTimestamp = timestamp;
    }

    function markSourceEditFromInput(event) {
      const target = event.target;
      if (!target || target.closest?.('#codex-overleaf-panel')) {
        return;
      }
      if (!isLikelyEditorInputTarget(target)) {
        return;
      }
      const CompileAdapter = pageWindow.CodexOverleafCompileAdapter;
      if (!CompileAdapter?.isCompilableFile(deps.getActiveFilePath?.())) {
        return;
      }
      markSourceEdited();
    }

    return {
      getCompileLog,
      getCompileState,
      install,
      markSourceEdited,
      state,
      triggerCompile
    };
  }

  function isLikelyEditorInputTarget(target) {
    return Boolean(target.matches?.('textarea, [contenteditable="true"], .cm-content, .CodeMirror-code')
      || target.closest?.('.cm-content, .CodeMirror-code, .cm-editor, .CodeMirror'));
  }

  return {
    create,
    isLikelyEditorInputTarget
  };
});
