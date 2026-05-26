// Writeback project-ID guard: page-side dispatch gate that runs BEFORE any
// other readiness / openFile / staleness check on every writeback.
//
// Three fail-closed abort branches:
//   • editorProjectId === null    → editor_project_id_unavailable
//   • runProjectId missing/empty  → editor_project_id_unavailable
//   • runProjectId !== editorPID  → aborted_project_changed
//
// Hydration tolerance: Overleaf's `window._ide.project._id` is observably null
// for ~200–1000 ms after page load / SPA route change while the editor module
// hydrates. The guard retries the page-side reader with a 100/300/700 ms
// backoff (~1100 ms ceiling) before the null abort. Mismatch (runId !==
// editorId) short-circuits without retry because that means hydration
// completed to a *different* project and waiting won't fix it.
//
// Extracted from pageBridge.js to keep that file under its 2200-line budget;
// this module is the single source of truth for the guard surface and the
// only place that constructs the abort dispatch result shape.
(function initCodexOverleafWriteGuard(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafWriteGuard = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function writeGuardFactory() {
  'use strict';

  const WRITE_GUARD_HYDRATION_RETRY_MS = [100, 300, 700];  // ~1100 ms ceiling

  const ABORT_USER_MESSAGES = {
    aborted_project_changed: 'Codex stopped a write because Overleaf switched to a different project mid-run.',
    editor_project_id_unavailable: 'Codex could not confirm which Overleaf project the editor is showing, so it did not write.'
  };

  const ABORT_NEXT_ACTIONS = {
    aborted_project_changed: 'Reopen the original project and rerun the task if you still want this change.',
    editor_project_id_unavailable: 'Refresh Overleaf and retry; if it persists, reload the extension.'
  };

  function create(deps = {}) {
    const win = deps.window || (typeof globalThis !== 'undefined' ? globalThis : {});
    const doc = deps.document || win.document || {};
    // treeOperations is optional — only needed for the URL fallback in
    // getEditorProjectIdPageSide. When omitted the URL source short-circuits
    // and the guard relies only on `_ide.project._id` and `[data-project-id]`.
    const treeOperations = deps.treeOperations || null;
    const sleep = deps.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));

    // The acceptable sources for the editor's currently-shown project id, in
    // order:
    //   1. `window._ide.project._id` — the in-page IDE module's authoritative
    //      project id once the SPA has bound the project.
    //   2. `[data-project-id]` on the CodeMirror root — best-effort second
    //      source for cases where `_ide.project` is still hydrating.
    //   3. URL project id, but ONLY when it exactly matches the immutable
    //      runProjectId captured at run start. This keeps SPA-navigation
    //      safety: a different URL project still fails closed, while current
    //      Overleaf builds that no longer expose `_ide.project._id` can still
    //      write on a stable same-project page.
    // When none of these sources can prove the same project, return null so
    // the guard fails closed.
    function getEditorProjectIdPageSide(expectedRunProjectId = '') {
      try {
        const ideId = win._ide && win._ide.project && win._ide.project._id;
        if (typeof ideId === 'string' && ideId) return ideId;
      } catch (_error) { /* swallow; fall through */ }
      try {
        const cmRoot = doc.querySelector && doc.querySelector('[data-project-id]');
        const attr = cmRoot && cmRoot.getAttribute && cmRoot.getAttribute('data-project-id');
        if (typeof attr === 'string' && attr) return attr;
      } catch (_error) { /* swallow */ }
      try {
        const urlProjectId = treeOperations && treeOperations.getProjectId
          ? (treeOperations.getProjectId() || null)
          : null;
        if (expectedRunProjectId && urlProjectId === expectedRunProjectId) {
          return urlProjectId;
        }
      } catch (_error) { /* swallow */ }
      return null;
    }

    async function runWriteGuard(params) {
      const runId = params && typeof params.runProjectId === 'string' ? params.runProjectId : '';
      let editorId = getEditorProjectIdPageSide(runId);
      for (let attempt = 0; attempt < WRITE_GUARD_HYDRATION_RETRY_MS.length; attempt++) {
        if (editorId) break;
        await sleep(WRITE_GUARD_HYDRATION_RETRY_MS[attempt]);
        editorId = getEditorProjectIdPageSide(runId);
      }
      if (!editorId) {
        return abortDispatchResult('editor_project_id_unavailable', runId || null, null);
      }
      if (!runId) {
        return abortDispatchResult('editor_project_id_unavailable', null, editorId);
      }
      if (runId !== editorId) {
        return abortDispatchResult('aborted_project_changed', runId, editorId);
      }
      return null;
    }

    // operation: {} (not null) — the guard fires before any per-op dispatch
    // so there's no specific operation to attribute the block to, but
    // downstream audit/transcript code traverses operation.path and the
    // like; an empty object lets defaults flow through cleanly.
    function abortDispatchResult(code, runProjectId, editorProjectId) {
      return {
        ok: false,
        applied: [],
        skipped: [{
          operation: {},
          result: {
            ok: false,
            code,
            reason: ABORT_USER_MESSAGES[code],
            failure: {
              code,
              stage: 'write',
              severity: 'blocked',
              userMessage: ABORT_USER_MESSAGES[code],
              nextAction: ABORT_NEXT_ACTIONS[code],
              retryable: true,
              terminalState: 'blocked',
              changedDocument: false,
              evidence: { runProjectId, editorProjectId }
            }
          }
        }]
      };
    }

    return {
      runWriteGuard,
      abortDispatchResult,
      getEditorProjectIdPageSide,
      WRITE_GUARD_HYDRATION_RETRY_MS
    };
  }

  return { create, WRITE_GUARD_HYDRATION_RETRY_MS };
});
