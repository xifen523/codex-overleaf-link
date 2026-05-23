(function initCodexOverleafWritebackRouter(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafWritebackRouter = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function writebackRouterFactory() {
  'use strict';

  function create(deps = {}) {
    const window = deps.window || (typeof globalThis !== 'undefined' ? globalThis : {});
    const treeOperations = deps.treeOperations || {};
    const compileBridge = deps.compileBridge || { markSourceEdited() {} };
    const projectSnapshotBridge = deps.projectSnapshotBridge || {};
    const normalizeSafeProjectPath = typeof deps.normalizeSafeProjectPath === 'function'
      ? deps.normalizeSafeProjectPath
      : fallbackNormalizeSafeProjectPath;
    const writebackOpenSettleMs = Number.isFinite(Number(deps.writebackOpenSettleMs))
      ? Math.max(0, Number(deps.writebackOpenSettleMs))
      : 1200;
    const diagnosticsRevision = String(deps.diagnosticsRevision || '');

    function invalidProjectPathResult(label = 'path') {
      return typeof deps.invalidProjectPathResult === 'function'
        ? deps.invalidProjectPathResult(label)
        : {
          ok: false,
          code: 'invalid_project_path',
          reason: 'Invalid ' + label + '.'
        };
    }

    function ensureReviewing(params = {}) {
      return deps.ensureReviewing?.(params) || Promise.resolve({ ok: false, reason: 'Reviewing controls are unavailable.' });
    }

    function ensureEditing(params = {}) {
      return deps.ensureEditing?.(params) || Promise.resolve({ ok: false, reason: 'Editing controls are unavailable.' });
    }

    function getReviewingState(params = {}) {
      return deps.getReviewingState?.(params) || { reviewing: { ok: false }, signals: {} };
    }

    function isEditingConfirmedForNoTraceUndo(state = {}) {
      return deps.isEditingConfirmedForNoTraceUndo?.(state) === true;
    }

    // Authoritative "is Reviewing / Track Changes positively ON" check, wired to
    // the page bridge's aria-aware isReviewingConfirmedForWrite. Unlike a bare
    // reviewing.ok read this does not treat a control merely *labelled*
    // "Reviewing" (with no active aria) as proof that Track Changes is on, so it
    // is the correct strict gate for the Accept replay's Editing-mode switch.
    function isReviewingConfirmedForWrite(state = {}) {
      return deps.isReviewingConfirmedForWrite?.(state) === true;
    }

    function setReviewingEnabled(enabled, params = {}) {
      return deps.setReviewingEnabled?.(enabled, params) || Promise.resolve({ ok: false, enabled });
    }

    function summarizeReviewingToggleResult(result = {}) {
      return deps.summarizeReviewingToggleResult?.(result) || {
        ok: result.ok === true,
        changed: result.changed === true,
        enabled: result.enabled === true,
        code: result.code || '',
        reason: result.reason || ''
      };
    }

    function getActiveFilePath() {
      return treeOperations.getActiveFilePath?.() || '';
    }

    function getActiveEditorIdentity() {
      return typeof deps.getActiveEditorIdentity === 'function'
        ? deps.getActiveEditorIdentity()
        : null;
    }

    function activeEditorIdentityChanged(previous) {
      return typeof deps.activeEditorIdentityChanged === 'function'
        ? deps.activeEditorIdentityChanged(previous)
        : true;
    }

    function openFileByPath(filePath, options = {}) {
      return treeOperations.openFileByPath?.(filePath, options) || Promise.resolve({ ok: false, reason: 'Tree operations are unavailable' });
    }

    function projectPathExists(filePath) {
      return treeOperations.projectPathExists?.(filePath) === true;
    }

    function findFileTreeManager() {
      return treeOperations.findFileTreeManager?.() || null;
    }

    function readActiveEditorText() {
      return deps.readActiveEditorText?.() || '';
    }

    function waitForActiveEditorText(filePath, timeoutMs, options = {}) {
      if (typeof treeOperations.waitForActiveEditorText === 'function') {
        return treeOperations.waitForActiveEditorText(filePath, timeoutMs, options);
      }
      return Promise.resolve({
        ok: true,
        path: filePath || getActiveFilePath(),
        text: readActiveEditorText()
      });
    }

    function contentSignature(content) {
      if (typeof treeOperations.contentSignature === 'function') {
        return treeOperations.contentSignature(content);
      }
      const text = String(content ?? '');
      return `${text.length}:${text.slice(0, 80)}:${text.slice(-80)}`;
    }

    function contentFingerprint(content) {
      const text = String(content ?? '');
      let hash = 2166136261;
      for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619) >>> 0;
      }
      return {
        length: text.length,
        normalizedLength: normalizeEditorTextForComparison(text).length,
        hash: hash.toString(16).padStart(8, '0'),
        blank: text.trim().length === 0
      };
    }

    function replaceActiveEditorText(text) {
      return deps.replaceActiveEditorText?.(text) || { ok: false, reason: 'Editor adapter is unavailable' };
    }

    function replaceActiveEditorPatches(patches, nextContent) {
      return deps.replaceActiveEditorPatches?.(patches, nextContent) || { ok: false, reason: 'Editor adapter is unavailable' };
    }

    function collectElements(selector, limit) {
      return deps.collectElements?.(selector, limit) || [];
    }

    function uniqueNodes(nodes) {
      return deps.uniqueNodes?.(nodes) || Array.from(new Set(nodes || []));
    }

    function readNodeSignalText(node) {
      return deps.readNodeSignalText?.(node) || '';
    }

    function isInsideCodexPanel(node) {
      return deps.isInsideCodexPanel?.(node) === true;
    }

    function normalizeReviewingSignalText(value) {
      return deps.normalizeReviewingSignalText?.(value) || String(value || '').replace(/\s+/g, ' ').trim();
    }

    function clickNode(node) {
      if (typeof deps.clickNode === 'function') {
        deps.clickNode(node);
        return;
      }
      if (typeof node?.click === 'function') {
        node.click();
        return;
      }
      node?.dispatchEvent?.(new MouseEvent('click', { bubbles: true, cancelable: true }));
    }

    function delay(ms) {
      if (typeof deps.delay === 'function') {
        return deps.delay(ms);
      }
      return new Promise(resolve => window.setTimeout(resolve, ms));
    }

    function compact(value, limit) {
      if (typeof deps.compact === 'function') {
        return deps.compact(value, limit);
      }
      const text = String(value || '').replace(/\s+/g, ' ').trim();
      return text.length > limit ? text.slice(0, limit - 3) + '...' : text;
    }

    function buildWritebackDebug(stage, operation, baseFileLookup, currentText, extra = {}) {
      const filePath = normalizeSafeProjectPath(operation?.path || '');
      const baseKnown = Boolean(baseFileLookup && filePath && baseFileLookup.has(filePath));
      const baseContent = baseKnown ? baseFileLookup.get(filePath) : '';
      return {
        stage,
        revision: diagnosticsRevision,
        operationPath: filePath,
        operationType: operation?.type || '',
        activePath: getActiveFilePath(),
        current: contentFingerprint(currentText),
        baseKnown,
        base: baseKnown ? contentFingerprint(baseContent) : null,
        ...extra
      };
    }

    function attachWritebackDebug(result, stage, operation, baseFileLookup, currentText, extra = {}) {
      if (!result || typeof result !== 'object') {
        return result;
      }
      return {
        ...result,
        debug: buildWritebackDebug(stage, operation, baseFileLookup, currentText, extra)
      };
    }

    function normalizeTextPatches(patches, length) {
      if (typeof deps.normalizeTextPatches === 'function') {
        return deps.normalizeTextPatches(patches, length);
      }
      const normalized = [];
      let previousTo = 0;
      for (const rawPatch of patches || []) {
        const from = Number(rawPatch?.from);
        const to = Number(rawPatch?.to);
        if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > length) {
          return {
            ok: false,
            code: 'invalid_patch',
            reason: 'Codex generated an invalid patch range.'
          };
        }
        if (from < previousTo) {
          return {
            ok: false,
            code: 'invalid_patch',
            reason: 'Codex generated overlapping patch ranges.'
          };
        }
        previousTo = to;
        normalized.push({
          from,
          to,
          expected: String(rawPatch.expected ?? ''),
          insert: String(rawPatch.insert ?? '')
        });
      }
      return {
        ok: true,
        patches: normalized
      };
    }

  async function applyOperations(operations, options = {}) {
    if (options.reviewingPolicy === 'no-trace-undo') {
      return applyOperationsWithNoTraceUndo(operations, options);
    }
    const hasOperations = (operations || []).length > 0;
    const trackReviewingChanges = options.requireReviewing === true && hasOperations;
    let reviewingPolicy = null;
    if (options.requireReviewing === true && hasOperations) {
      const reviewing = await ensureReviewing({ waitMs: 1800 });
      if (!reviewing.ok) {
        return buildReviewingRequiredBlockedResult(operations, reviewing);
      }
    } else if (options.requireEditing === true && hasOperations) {
      const editing = await ensureEditing({ waitMs: 1800 });
      if (!editing.ok) {
        return buildEditingRequiredBlockedResult(operations, editing);
      }
      reviewingPolicy = {
        policy: 'editing-write',
        disabled: editing.activated === true,
        leftEditing: true,
        reason: editing.activated ? 'switched_to_editing_before_write' : 'editing_already_confirmed',
        disable: summarizeReviewingToggleResult({
          ok: true,
          changed: editing.activated === true,
          enabled: false,
          reason: editing.activated ? 'Switched to Editing before untracked write.' : 'Editing already confirmed before untracked write.'
        })
      };
    }
    const result = await applyOperationsCore(operations, {
      ...options,
      trackReviewingChanges
    });
    return reviewingPolicy
      ? {
        ...result,
        reviewingPolicy
      }
      : result;
  }

  async function applyOperationsWithNoTraceUndo(operations, options = {}) {
    const initial = getReviewingState({});
    if (isEditingConfirmedForNoTraceUndo(initial)) {
      const result = await applyOperationsCore(operations, options);
      return {
        ...result,
        reviewingPolicy: {
          policy: 'no-trace-undo',
          disabled: false,
          restored: false,
          reason: 'editing_already_confirmed'
        }
      };
    }

    const disabled = await setReviewingEnabled(false, { waitMs: 1800 });
    if (!disabled.ok) {
      return buildNoTraceUndoBlockedResult(operations, disabled);
    }

    let result;
    let applyError = null;
    try {
      result = await applyOperationsCore(operations, options);
    } catch (error) {
      applyError = error;
    }
    if (applyError) {
      throw applyError;
    }

    return {
      ...result,
      reviewingPolicy: {
        policy: 'no-trace-undo',
        disabled: true,
        restored: false,
        leftEditing: true,
        reason: 'left_editing_after_undo',
        disable: summarizeReviewingToggleResult(disabled)
      }
    };
  }

  async function applyOperationsCore(operations, options = {}) {
    const applied = [];
    const skipped = [];
    const trackedChanges = [];
    const safeBaseFiles = normalizeBaseFilesForSafety(options.baseFiles);
    const baseFileLookup = window.CodexOverleafStaleGuard?.buildBaseFileLookup(safeBaseFiles);
    const baseBinaryFileLookup = buildBaseBinaryFileLookup(safeBaseFiles);

    for (const rawOperation of operations) {
      const operation = normalizeOperationPaths(rawOperation);
      const pathSafety = validateOperationProjectPaths(operation);
      if (!pathSafety.ok) {
        skipped.push({ operation, result: pathSafety });
        continue;
      }
      if (operation.type === 'edit') {
        const result = await applyEditOperation(operation, {
          baseFileLookup,
          trackReviewingChanges: options.trackReviewingChanges === true
        });
        if (result.ok && Array.isArray(result.trackedChanges)) {
          trackedChanges.push(...result.trackedChanges);
        }
        (result.ok ? applied : skipped).push({ operation, result });
      } else if (['binary-create', 'overwrite-binary'].includes(operation.type)) {
        const result = await applyBinaryAssetOperation(operation, { baseFileLookup, baseBinaryFileLookup });
        (result.ok ? applied : skipped).push({ operation, result });
      } else if (['create', 'rename', 'move', 'delete'].includes(operation.type)) {
        const result = await applyFileTreeOperation(operation, { baseFileLookup });
        (result.ok ? applied : skipped).push({ operation, result });
      } else {
        skipped.push({
          operation,
          result: {
            ok: false,
            reason: `Unsupported operation type: ${operation.type}`
          }
        });
      }
    }

    if (applied.length > 0) {
      compileBridge.markSourceEdited();
    }

    return {
      ok: skipped.length === 0,
      applied,
      skipped,
      trackedChanges: mergeTrackedChangeRefs(trackedChanges)
    };
  }

  async function rejectTrackedChanges(params = {}) {
    const trackedChanges = normalizeTrackedChangeRefs(params.trackedChanges || []);
    const expectedFiles = Array.isArray(params.expectedFiles) ? params.expectedFiles : [];
    const postFiles = Array.isArray(params.postFiles) ? params.postFiles : [];
    const applied = [];
    const skipped = [];
    const appliedPaths = new Set();
    const invalidTrackedChange = trackedChanges.find(trackedChange => trackedChange.invalidProjectPath);
    if (invalidTrackedChange) {
      return {
        ok: false,
        applied,
        skipped: [{
          trackedChange: invalidTrackedChange,
          result: invalidProjectPathResult('tracked-change path')
        }]
      };
    }

    const editorUndo = await rejectTrackedChangesViaEditorUndo(expectedFiles, postFiles, applied);
    if (editorUndo.ok) {
      if (applied.length > 0) {
        compileBridge.markSourceEdited();
      }
      return {
        ok: true,
        applied,
        skipped
      };
    }
    const snapshotUndo = await restoreExpectedFilesWithNoTraceUndo(expectedFiles, postFiles);
    if (snapshotUndo.attempted) {
      applied.push(...snapshotUndo.applied);
      skipped.push(...snapshotUndo.skipped);
      if (applied.length > 0) {
        compileBridge.markSourceEdited();
      }
      return {
        ok: skipped.length === 0,
        applied,
        skipped
      };
    }
    if (editorUndo.attempted) {
      skipped.push({
        trackedChange: null,
        result: editorUndo
      });
      if (applied.length > 0) {
        compileBridge.markSourceEdited();
      }
      return {
        ok: false,
        applied,
        skipped
      };
    }

    if (!trackedChanges.length) {
      return {
        ok: false,
        applied,
        skipped: [{
          trackedChange: null,
          result: {
            ok: false,
            code: 'missing_tracked_changes',
            reason: '这轮写入没有可识别的 Overleaf 留痕记录；为避免制造新的红线，Codex 没有执行文本补丁撤销。'
          }
        }]
      };
    }

    for (const trackedChange of orderTrackedChangesForReviewAction(trackedChanges)) {
      if (trackedChange.path && getActiveFilePath() !== trackedChange.path) {
        const opened = await openFileByPath(trackedChange.path);
        if (!opened.ok) {
          if (expectedFiles.length || trackedChange.path) {
            continue;
          }
          skipped.push({
            trackedChange,
            result: {
              ok: false,
              code: 'tracked_change_file_open_failed',
              reason: `无法打开 ${trackedChange.path} 来查找这轮写入的留痕记录；Codex 没有用文本补丁伪撤销。`
            }
          });
          continue;
        }
      }

      let node = findTrackedChangeNode(trackedChange);
      let actualTrackedChange = trackedChange;
      if (!node && trackedChange.path && appliedPaths.has(trackedChange.path)) {
        node = findNextTrackedChangeNodeForPath(trackedChange.path);
        if (node) {
          actualTrackedChange = trackedChangeRefFromNode(node, trackedChange.path);
        }
      }
      if (!node) {
        if (expectedFiles.length || trackedChange.path) {
          continue;
        }
        skipped.push({
          trackedChange,
          result: {
            ok: false,
            code: 'tracked_change_not_found',
            reason: '没有在 Overleaf 页面里找到这轮写入对应的留痕记录；Codex 没有用文本补丁伪撤销。'
          }
        });
        continue;
      }

      const rejectControl = findRejectControlForTrackedChangeNode(node);
      if (!rejectControl) {
        if (expectedFiles.length || trackedChange.path) {
          continue;
        }
        skipped.push({
          trackedChange,
          result: {
            ok: false,
            code: 'tracked_change_reject_control_not_found',
            reason: '找到了这轮写入的留痕记录，但没有找到对应的 Reject/拒绝按钮；Codex 没有用文本补丁伪撤销。'
          }
        });
        continue;
      }

      clickNode(rejectControl);
      await delay(180);

      if (findTrackedChangeNode(trackedChange)) {
        if (expectedFiles.length || trackedChange.path) {
          continue;
        }
        skipped.push({
          trackedChange,
          result: {
            ok: false,
            code: 'tracked_change_reject_not_confirmed',
            reason: 'Codex 点击了 Reject/拒绝，但 Overleaf 页面仍显示这条留痕记录；请在 Overleaf 审阅面板手动拒绝。'
          }
        });
        continue;
      }

      applied.push({
        trackedChange: actualTrackedChange,
        result: {
          ok: true,
          method: 'overleaf-review-reject'
        }
      });
      if (actualTrackedChange.path) {
        appliedPaths.add(actualTrackedChange.path);
      }
    }

    if (expectedFiles.length) {
      const completion = await rejectRemainingTrackedChangesForExpectedFiles(expectedFiles, applied);
      if (!completion.ok) {
        skipped.push({
          trackedChange: null,
          result: completion
        });
      }
    } else {
      const completion = await rejectRemainingTrackedChangesForTrackedPaths(trackedChanges, applied);
      if (!completion.ok) {
        skipped.push({
          trackedChange: null,
          result: completion
        });
      }
    }

    if (applied.length > 0) {
      compileBridge.markSourceEdited();
    }

    return {
      ok: skipped.length === 0,
      applied,
      skipped
    };
  }

  // Accept All — instead of hunting Overleaf's per-change Accept controls (which
  // is unreliable in real browser use), reuse two proven-reliable mechanisms:
  //
  //   1. Editor-undo the run's tracked writeback back to its pre-write content
  //      (the reject path's primary mechanism), which makes every one of the
  //      run's tracked changes vanish.
  //   2. Switch Overleaf to Editing mode (Track Changes OFF) and re-apply the
  //      run's post-write content as a plain, untracked edit.
  //
  // Net result: the run's new content lands as permanent, untracked text — the
  // run is decisively accepted, with no DOM-control hunting.
  //
  // If the editor-undo cannot reach the pre-write state (content drifted — e.g.
  // the user edited after the run), this bails WITHOUT re-writing so it never
  // makes the document worse, mirroring Undo's safety stance.
  async function acceptTrackedChanges(params = {}) {
    const expectedFiles = Array.isArray(params.expectedFiles) ? params.expectedFiles : [];
    const postFiles = Array.isArray(params.postFiles) ? params.postFiles : [];
    const applied = [];
    const skipped = [];
    // diagnostics: a per-step trace returned to the caller so the run card can
    // surface exactly what happened on each Accept All step. Each entry is
    // `{ step, info }`; the content runtime translates `step` via i18n.
    const diagnostics = [];
    const pushDiagnostic = (step, info) => {
      diagnostics.push({ step, info: info || {} });
    };

    const expectedByPath = new Map(expectedFiles
      .filter(file => file?.path && typeof file.content === 'string')
      .map(file => [normalizeSafeProjectPath(file.path), file.content])
      .filter(([path]) => path));
    const postByPath = new Map(postFiles
      .filter(file => file?.path && typeof file.content === 'string')
      .map(file => [normalizeSafeProjectPath(file.path), file.content])
      .filter(([path]) => path));
    const paths = Array.from(expectedByPath.keys()).filter(path => postByPath.has(path));
    if (!paths.length) {
      return {
        ok: false,
        applied,
        skipped: [{
          trackedChange: null,
          result: {
            ok: false,
            code: 'accept_missing_run_content',
            reason: '这轮写入没有可识别的写入前/写入后内容；Codex 没有把留痕改动接受为永久文本。'
          }
        }],
        diagnostics
      };
    }

    // Step 1: editor-undo the run's tracked writeback back to its pre-write
    // content, removing every tracked change. This reuses the exact mechanism
    // the reject path relies on (its primary path).
    const appliedBeforeUndo = applied.length;
    const editorUndo = await rejectTrackedChangesViaEditorUndo(expectedFiles, postFiles, applied);
    pushDiagnostic('editorUndo', {
      ok: editorUndo.ok === true,
      attempted: editorUndo.attempted === true,
      code: editorUndo.code || '',
      reason: editorUndo.reason || '',
      pathsProcessed: applied.length - appliedBeforeUndo
    });
    if (!editorUndo.ok) {
      // Drift bail: the editor-undo could not reach the pre-write state. Do NOT
      // re-write — that would only make the document worse. Return not-ok so the
      // run stays pending and the user can retry, same as Undo.
      return {
        ok: false,
        applied: [],
        skipped: [{
          trackedChange: null,
          result: editorUndo.attempted || editorUndo.code
            ? editorUndo
            : {
              ok: false,
              code: 'accept_editor_undo_unavailable',
              reason: '没有可执行的 Overleaf 原生撤销来清掉本轮留痕；Codex 没有接受这轮改动。'
            }
        }],
        diagnostics
      };
    }

    // Step 2: switch to Editing mode (Track Changes OFF) so the replay lands as
    // plain, untracked text.
    //
    // ensureEditing() short-circuits on isEditingConfirmedForNoTraceUndo, whose
    // "already Editing" detection is negation-based and false-positives while
    // Track Changes is actually ON (e.g. the Reviewing mode shows only as a
    // dropdown-trigger label with no active aria attribute, so reviewing is not
    // positively confirmed and a stray "Editing" menu option is read as the
    // current mode). Trusting that short-circuit replays the run while tracked.
    //
    // So do not trust the short-circuit here: read the reviewing state
    // explicitly, and if Reviewing/Track Changes is on — or Editing is not
    // positively confirmed OFF — force the toggle via setReviewingEnabled(false)
    // rather than ensureEditing's lenient path.
    const modeBefore = getReviewingState({});
    pushDiagnostic('modeBefore', summarizeReviewingStateForDiagnostics(modeBefore));
    const editingSwitch = await forceEditingForAcceptReplay();
    pushDiagnostic('forceEditing', {
      ok: editingSwitch.ok === true,
      activated: editingSwitch.activated === true,
      code: editingSwitch.code || '',
      reason: editingSwitch.reason || ''
    });
    if (!editingSwitch.ok) {
      // The undo already reverted the writeback; without a *confirmed* Editing
      // mode the replay would itself be tracked. Bail rather than re-introduce
      // tracked changes.
      return {
        ok: false,
        applied: [],
        skipped: [{
          trackedChange: null,
          result: {
            ok: false,
            code: editingSwitch.code || 'accept_editing_not_confirmed',
            reason: editingSwitch.reason || '无法确认 Overleaf 已切换到 Editing 模式；Codex 没有把本轮改动重写为永久文本。'
          }
        }],
        diagnostics
      };
    }
    // Tracks whether THIS flow toggled Reviewing off (either initially via
    // forceEditingForAcceptReplay, or later inside the per-op re-confirm loop).
    // The final restore only fires if this flow owned the toggle.
    let weToggledOff = editingSwitch.activated === true;
    const stableAfterSwitch = await waitForStableEditingForAcceptReplay({
      waitMs: 2400,
      intervalMs: 160
    });
    if (!stableAfterSwitch.ok) {
      return {
        ok: false,
        applied: [],
        skipped: [{
          trackedChange: null,
          result: stableAfterSwitch
        }],
        diagnostics
      };
    }

    // Step 3: re-apply each file's changed fragments as a plain edit. With
    // tracking off these land as permanent, untracked text. The replay must
    // write only the minimal changed fragments via the `patches` path of
    // applyOperationsCore — never a whole-file replaceAll, which would clobber
    // any unrelated content and produce one giant tracked change if anything
    // about the mode switch were imperfect.
    const operationsResult = buildAcceptReplayOperations(paths, expectedByPath, postByPath, params.appliedOperations);
    if (!operationsResult.ok) {
      if (weToggledOff) {
        await setReviewingEnabled(true, { waitMs: 1800 });
      }
      return {
        ok: false,
        applied: [],
        skipped: [{
          trackedChange: null,
          result: operationsResult
        }],
        diagnostics
      };
    }
    const operations = operationsResult.operations;
    // Per-op replay loop with sticky-Editing re-confirm and a short stable
    // window before every actual CodeMirror write.
    //
    // Bug C: even after forceEditingForAcceptReplay confirmed Editing once,
    // Overleaf has been observed flipping back to Reviewing between the
    // confirm and the next CodeMirror write (Overleaf-side override, per-user
    // "Track Changes for me" setting, or a positive-confirm false-positive
    // window). The fix: re-verify Editing immediately BEFORE every single
    // operation, and if Reviewing has slipped back on, force the toggle off
    // again and positively re-confirm before writing. If Editing still cannot
    // be positively confirmed after the re-toggle, bail the rest of the loop
    // so we never land a tracked write.
    let bailedReason = null;
    for (const operation of operations) {
      const opPath = operation?.path || '';
      const preState = getReviewingState({});
      const reviewingOnBefore = isReviewingConfirmedForWrite(preState);
      const editingConfirmedBefore = isEditingPositivelyConfirmed(preState);
      let reToggled = false;
      let reToggleResult = null;

      if (reviewingOnBefore || !editingConfirmedBefore) {
        reToggled = true;
        reToggleResult = await setReviewingEnabled(false, { waitMs: 1800 });
        if (reToggleResult.ok) {
          weToggledOff = true;
        }
      }

      const postToggleState = reToggled ? getReviewingState({}) : preState;
      const editingConfirmedAfter = reToggled
        ? isEditingPositivelyConfirmed(postToggleState)
        : editingConfirmedBefore;

      pushDiagnostic('replayStart', {
        path: opPath,
        isReviewingPositivelyOn: reviewingOnBefore,
        isEditingPositivelyConfirmed: editingConfirmedBefore,
        reToggled,
        reToggleOk: reToggleResult ? reToggleResult.ok === true : null,
        reToggleCode: reToggleResult?.code || '',
        editingConfirmedAfterReToggle: editingConfirmedAfter
      });

      if (!editingConfirmedAfter) {
        // Bail the rest of the loop with the existing bail semantics — never
        // land a tracked write because Editing slipped.
        const bailResult = {
          ok: false,
          code: reToggleResult?.code || 'accept_editing_not_confirmed',
          reason: reToggleResult?.reason
            || '本次操作前未能确认 Overleaf 处于 Editing 模式；为避免重写又留下留痕，Codex 没有继续重放本轮剩余改动。'
        };
        skipped.push({
          trackedChange: {
            key: `accept-replay:${opPath}`,
            id: '',
            path: opPath,
            label: 'Accept All (untracked replay)'
          },
          result: bailResult
        });
        pushDiagnostic('replayDone', {
          path: opPath,
          ok: false,
          bailed: true,
          code: bailResult.code,
          reason: bailResult.reason
        });
        bailedReason = bailResult;
        break;
      }

      const stableBeforeReplay = await waitForStableEditingForAcceptReplay({
        waitMs: reToggled ? 2400 : 1400,
        intervalMs: 160
      });
      if (!stableBeforeReplay.ok) {
        skipped.push({
          trackedChange: {
            key: `accept-replay:${opPath}`,
            id: '',
            path: opPath,
            label: 'Accept All (untracked replay)'
          },
          result: stableBeforeReplay
        });
        pushDiagnostic('replayDone', {
          path: opPath,
          ok: false,
          bailed: true,
          code: stableBeforeReplay.code,
          reason: stableBeforeReplay.reason
        });
        bailedReason = stableBeforeReplay;
        break;
      }

      const opReplay = await applyOperationsCore([operation], {
        baseFiles: [{
          path: opPath,
          content: expectedByPath.get(normalizeSafeProjectPath(opPath))
        }],
        forbidTrackedChanges: true
      });
      for (const item of opReplay.applied || []) {
        applied.push({
          trackedChange: {
            key: `accept-replay:${item.operation?.path || ''}`,
            id: '',
            path: item.operation?.path || '',
            label: 'Accept All (untracked replay)'
          },
          result: {
            ...item.result,
            method: 'overleaf-accept-untracked-replay'
          }
        });
      }
      for (const item of opReplay.skipped || []) {
        skipped.push({
          trackedChange: {
            key: `accept-replay:${item.operation?.path || ''}`,
            id: '',
            path: item.operation?.path || '',
            label: 'Accept All (untracked replay)'
          },
          result: item.result
        });
      }
      const opAppliedEntry = (opReplay.applied || [])[0];
      const opSkippedEntry = (opReplay.skipped || [])[0];
      const opResult = opAppliedEntry?.result || opSkippedEntry?.result || {};
      if (opResult.code === 'accept_replay_created_tracked_changes') {
        opResult.rollback = await rollbackAcceptReplayTrackedWrite(opPath, expectedByPath, postByPath);
      }
      pushDiagnostic('replayDone', {
        path: opPath,
        ok: opAppliedEntry ? true : false,
        verified: opResult.verified === true,
        verifiedContentLength: typeof opResult.verifiedContent === 'string'
          ? opResult.verifiedContent.length
          : null,
        trackedChangesDetected: Array.isArray(opResult.trackedChanges) ? opResult.trackedChanges.length : 0,
        rollbackOk: opResult.rollback ? opResult.rollback.ok === true : null,
        code: opResult.code || '',
        reason: opResult.reason || ''
      });
      if (!opReplay.ok) {
        bailedReason = opResult;
        break;
      }
    }

    // Step 4 intentionally does NOT restore Reviewing. Accept replay is a
    // no-trace write transaction: restoring Track Changes immediately after the
    // CodeMirror dispatch can race with Overleaf's collaboration/reviewing
    // settlement and cause the replay itself to land as fresh tracked changes.
    // Leave the editor in Editing after a successful replay; the user can turn
    // Reviewing back on manually after Overleaf has saved the accepted text.
    if (weToggledOff) {
      pushDiagnostic('restoreReviewing', {
        ok: true,
        skipped: true,
        enabled: false,
        reason: 'Accept All left Overleaf in Editing mode to avoid re-tracking the accepted replay.'
      });
    }

    if (applied.length > 0) {
      compileBridge.markSourceEdited();
    }

    return {
      ok: skipped.length === 0 && !bailedReason,
      applied,
      skipped,
      diagnostics
    };
  }

  // Summarizes a reviewing state for the per-step diagnostics. Surfaces
  // exactly the bits the user needs to diagnose a sticky-Editing slip: the
  // reviewing detector's verdict (ok/status/source), a compact controls
  // summary, and the two strict gates (isReviewingPositivelyOn /
  // isEditingPositivelyConfirmed). Self-contained — the run card can render
  // this verbatim without re-reading any page state.
  function summarizeReviewingStateForDiagnostics(state = {}) {
    const reviewing = state.reviewing || {};
    const controls = (state.signals?.controls || []).slice(0, 6).map(control => {
      const text = [control?.text, control?.innerText, control?.ariaLabel, control?.title]
        .map(value => String(value || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join(' | ');
      return {
        text: text.length > 80 ? text.slice(0, 77) + '...' : text,
        ariaPressed: control?.ariaPressed || '',
        ariaSelected: control?.ariaSelected || '',
        ariaCurrent: control?.ariaCurrent || ''
      };
    });
    return {
      reviewingOk: reviewing.ok === true,
      reviewingStatus: reviewing.status || '',
      reviewingSource: reviewing.source || '',
      controlsCount: (state.signals?.controls || []).length,
      controls,
      isReviewingPositivelyOn: isReviewingConfirmedForWrite(state),
      isEditingPositivelyConfirmed: isEditingPositivelyConfirmed(state)
    };
  }

  // Track Changes is positively confirmed OFF only when Editing is positively
  // detected AND Reviewing is NOT positively confirmed on. This is the strict
  // gate the Accept replay needs: it must never replay while tracked, so
  // anything short of a positive "Editing on / Reviewing off" is rejected.
  function isEditingPositivelyConfirmed(state = {}) {
    return isEditingConfirmedForNoTraceUndo(state) && !isReviewingConfirmedForWrite(state);
  }

  async function waitForStableEditingForAcceptReplay(options = {}) {
    const waitMs = Number.isFinite(Number(options.waitMs)) ? Number(options.waitMs) : 2000;
    const intervalMs = Number.isFinite(Number(options.intervalMs)) ? Number(options.intervalMs) : 160;
    const deadline = Date.now() + Math.max(0, waitMs);
    let samples = 0;
    let lastState = getReviewingState({});
    while (Date.now() <= deadline) {
      lastState = getReviewingState({});
      samples += 1;
      if (!isEditingPositivelyConfirmed(lastState)) {
        return {
          ok: false,
          code: 'accept_editing_not_stable',
          reason: 'Overleaf Editing mode did not remain stable long enough for an untracked Accept All replay; Codex did not replay this write.',
          samples,
          waitMs,
          reviewing: summarizeReviewingStateForDiagnostics(lastState)
        };
      }
      await delay(intervalMs);
    }
    return {
      ok: true,
      samples,
      waitMs
    };
  }

  async function rollbackAcceptReplayTrackedWrite(path, expectedByPath, postByPath) {
    const normalizedPath = normalizeSafeProjectPath(path);
    const expectedContent = expectedByPath.get(normalizedPath);
    const postContent = postByPath.get(normalizedPath);
    if (!normalizedPath || typeof expectedContent !== 'string' || typeof postContent !== 'string') {
      return {
        ok: false,
        code: 'accept_replay_rollback_missing_content',
        reason: 'Accept All detected fresh tracked changes, but could not roll back because the pre/post content was unavailable.'
      };
    }
    const rollbackApplied = [];
    const rollback = await rejectTrackedChangesViaEditorUndo(
      [{ path: normalizedPath, content: expectedContent }],
      [{ path: normalizedPath, content: postContent }],
      rollbackApplied
    );
    return {
      ok: rollback.ok === true,
      attempted: rollback.attempted === true,
      code: rollback.code || '',
      reason: rollback.reason || '',
      applied: rollbackApplied.length
    };
  }

  // Robustly switch Overleaf to Editing (Track Changes OFF) for the Accept
  // replay.
  //
  // Bug B root cause: the accept flow used ensureEditing, which short-circuits
  // on isEditingConfirmedForNoTraceUndo. That detector is negation-based — it
  // returns true whenever Reviewing is not *positively* confirmed-for-write
  // (which requires an active aria attribute the real Overleaf reviewing
  // control does not always carry) AND a control loosely matches an Editing
  // pattern. So while Track Changes was actually ON, it false-positived
  // "already Editing", ensureEditing returned activated:false without toggling,
  // and the replay landed as tracked changes.
  //
  // The fix here does NOT trust that lenient short-circuit: it reads the
  // reviewing state explicitly and treats Editing as confirmed only when it is
  // *positively* confirmed (Editing detected AND Reviewing not confirmed on).
  // Whenever that strict gate is not met it forces setReviewingEnabled(false),
  // then positively re-confirms Editing before returning ok; if it still cannot
  // confirm Editing it returns not-ok so the caller bails instead of replaying
  // while tracked.
  async function forceEditingForAcceptReplay() {
    const initial = getReviewingState({});
    if (isEditingPositivelyConfirmed(initial)) {
      // Positively confirmed already in Editing — no toggle needed.
      return { ok: true, activated: false };
    }

    // Reviewing is on, or Editing is not positively confirmed off. Force the
    // toggle rather than trusting ensureEditing's lenient detection.
    const switched = await setReviewingEnabled(false, { waitMs: 1800 });
    if (!switched.ok) {
      return {
        ok: false,
        code: switched.code || 'accept_editing_not_confirmed',
        reason: switched.reason || '无法确认 Overleaf 已切换到 Editing 模式；Codex 没有把本轮改动重写为永久文本。'
      };
    }

    // Positively confirm Track Changes is now off before replaying. If the
    // post-toggle state does not positively confirm Editing, bail — do not
    // replay while potentially still tracked.
    const after = getReviewingState({});
    if (!isEditingPositivelyConfirmed(after)) {
      return {
        ok: false,
        code: 'accept_editing_not_confirmed',
        reason: '切换后仍未能确认 Overleaf 处于 Editing 模式；为避免重写又留下留痕，Codex 没有重放本轮改动。'
      };
    }

    return { ok: true, activated: true };
  }

  // Builds the minimal replay operations for Accept All. The replay must write
  // only the changed fragments, never a whole-file replaceAll.
  //
  // Preferred source: the run's own original forward writeback operations
  // (carrying their `patches`). After the editor-undo the document is back at
  // the pre-write content, so those patches' `expected` slices match and
  // re-apply cleanly.
  //
  // Fallback: when a path has no usable original patch operation, compute a
  // minimal pre->post diff (trim the common prefix/suffix to a single targeted
  // {from,to,insert} patch).
  function buildAcceptReplayOperations(paths, expectedByPath, postByPath, appliedOperations) {
    const patchesByPath = collectAppliedEditPatchesByPath(appliedOperations);
    const operations = [];
    for (const path of paths) {
      const preContent = expectedByPath.get(path);
      const postContent = postByPath.get(path);
      if (typeof preContent !== 'string' || typeof postContent !== 'string') {
        return {
          ok: false,
          code: 'accept_missing_run_content',
          reason: `${path} 缺少写入前/写入后内容；Codex 没有重放本轮改动。`
        };
      }

      // Preferred: re-apply the run's original forward patches verbatim.
      const originalPatches = patchesByPath.get(path);
      if (originalPatches && originalPatches.length && patchesApplyCleanly(preContent, originalPatches)) {
        operations.push({
          type: 'edit',
          path,
          patches: originalPatches,
          reason: 'Accept tracked edit (replay untracked)'
        });
        continue;
      }

      // Fallback: minimal pre->post diff trimmed to a single targeted patch.
      const diffPatch = buildMinimalDiffPatch(preContent, postContent);
      if (!diffPatch) {
        // pre === post: nothing to replay for this file.
        continue;
      }
      operations.push({
        type: 'edit',
        path,
        patches: [diffPatch],
        reason: 'Accept tracked edit (replay untracked)'
      });
    }
    return { ok: true, operations };
  }

  // Collects the per-path `patches` arrays from the run's applied edit
  // operations. Only edit operations that actually carried `patches` are
  // usable; whole-file replaceAll / verifiedContent operations are skipped so
  // the replay never falls back to a whole-file write.
  function collectAppliedEditPatchesByPath(appliedOperations) {
    const patchesByPath = new Map();
    for (const rawOperation of Array.isArray(appliedOperations) ? appliedOperations : []) {
      if (!rawOperation || rawOperation.type !== 'edit') {
        continue;
      }
      const path = typeof rawOperation.path === 'string'
        ? normalizeSafeProjectPath(rawOperation.path)
        : '';
      if (!path || !Array.isArray(rawOperation.patches) || !rawOperation.patches.length) {
        continue;
      }
      const normalized = rawOperation.patches.map(patch => ({
        from: Number(patch?.from),
        to: Number(patch?.to),
        expected: String(patch?.expected ?? ''),
        insert: String(patch?.insert ?? '')
      }));
      const existing = patchesByPath.get(path) || [];
      patchesByPath.set(path, existing.concat(normalized));
    }
    return patchesByPath;
  }

  // Confirms a patch set re-applies cleanly against the given (pre-write) text:
  // every patch range is valid and its `expected` slice matches.
  function patchesApplyCleanly(text, patches) {
    const applied = applyTextPatches(text, patches);
    return applied.ok === true;
  }

  // Computes a single targeted {from,to,insert} patch describing the pre->post
  // change by trimming the common prefix and suffix. Returns null when the two
  // strings are identical.
  function buildMinimalDiffPatch(preContent, postContent) {
    if (preContent === postContent) {
      return null;
    }
    const preLen = preContent.length;
    const postLen = postContent.length;
    let prefix = 0;
    const maxPrefix = Math.min(preLen, postLen);
    while (prefix < maxPrefix && preContent[prefix] === postContent[prefix]) {
      prefix += 1;
    }
    let suffix = 0;
    const maxSuffix = Math.min(preLen, postLen) - prefix;
    while (
      suffix < maxSuffix
      && preContent[preLen - 1 - suffix] === postContent[postLen - 1 - suffix]
    ) {
      suffix += 1;
    }
    const from = prefix;
    const to = preLen - suffix;
    return {
      from,
      to,
      expected: preContent.slice(from, to),
      insert: postContent.slice(from, postLen - suffix)
    };
  }

  async function rejectTrackedChangesViaEditorUndo(expectedFiles, postFiles, applied) {
    const expectedByPath = new Map((expectedFiles || [])
      .filter(file => file?.path && typeof file.content === 'string')
      .map(file => [normalizeSafeProjectPath(file.path), file.content])
      .filter(([path]) => path));
    const postByPath = new Map((postFiles || [])
      .filter(file => file?.path && typeof file.content === 'string')
      .map(file => [normalizeSafeProjectPath(file.path), file.content])
      .filter(([path]) => path));
    const paths = Array.from(expectedByPath.keys()).filter(path => postByPath.has(path));
    if (!paths.length) {
      return { ok: false, attempted: false };
    }

    for (const path of paths) {
      if (path && getActiveFilePath() !== path) {
        const opened = await openFileByPath(path);
        if (!opened.ok) {
          return {
            ok: false,
            attempted: false,
            code: 'tracked_change_editor_undo_open_failed',
            reason: `无法打开 ${path} 来执行 Overleaf 原生撤销。`
          };
        }
      }

      const postContent = postByPath.get(path);
      const postReady = await waitForActiveEditorExpectedText(path, postContent, 2500);
      if (!postReady.ok) {
        return {
          ok: false,
          attempted: false,
          code: 'tracked_change_editor_undo_current_mismatch',
          reason: `${path} 当前内容已经不是本轮写入后的内容；为避免撤掉你的后续修改，Codex 不使用 Overleaf 原生撤销。`
        };
      }

      const result = await undoEditorHistoryUntilContent(expectedByPath.get(path), path);
      if (!result.ok) {
        return result;
      }
      applied.push({
        trackedChange: {
          path,
          key: `editor-undo:${path}`,
          id: '',
          label: `Overleaf editor undo (${result.clicks} step${result.clicks === 1 ? '' : 's'})`
        },
        result: {
          ok: true,
          method: 'overleaf-editor-undo',
          undoClicks: result.clicks
        }
      });
    }

    return { ok: true, attempted: true };
  }

  async function restoreExpectedFilesWithNoTraceUndo(expectedFiles, postFiles) {
    const expectedByPath = new Map((expectedFiles || [])
      .filter(file => file?.path && typeof file.content === 'string')
      .map(file => [normalizeSafeProjectPath(file.path), file.content])
      .filter(([path]) => path));
    const postByPath = new Map((postFiles || [])
      .filter(file => file?.path && typeof file.content === 'string')
      .map(file => [normalizeSafeProjectPath(file.path), file.content])
      .filter(([path]) => path));
    const paths = Array.from(expectedByPath.keys()).filter(path => postByPath.has(path));
    if (!paths.length) {
      return {
        ok: false,
        attempted: false,
        applied: [],
        skipped: []
      };
    }

    for (const path of paths) {
      if (path && getActiveFilePath() !== path) {
        const opened = await openFileByPath(path);
        if (!opened.ok) {
          return {
            ok: false,
            attempted: false,
            applied: [],
            skipped: [],
            code: 'snapshot_undo_open_failed',
            reason: `无法打开 ${path} 来执行快照撤销。`
          };
        }
      }
      const ready = await waitForActiveEditorExpectedText(path, postByPath.get(path), 1500);
      if (!ready.ok) {
        return {
          ok: false,
          attempted: false,
          applied: [],
          skipped: [],
          code: 'snapshot_undo_current_mismatch',
          reason: `${path} 当前内容已经不是本轮写入后的内容；为避免覆盖你的后续修改，Codex 不执行快照撤销。`
        };
      }
    }

    const operations = paths.map(path => ({
      type: 'edit',
      path,
      replaceAll: expectedByPath.get(path),
      reason: 'Undo tracked edit'
    }));
    const result = await applyOperationsWithNoTraceUndo(operations, {
      baseFiles: paths.map(path => ({
        path,
        content: postByPath.get(path)
      }))
    });
    const toTrackedResult = item => ({
      trackedChange: {
        key: `snapshot-undo:${item.operation?.path || ''}`,
        id: '',
        path: item.operation?.path || '',
        label: 'No-trace snapshot undo'
      },
      result: item.result
    });
    return {
      ok: !(result.skipped || []).length,
      attempted: true,
      applied: (result.applied || []).map(toTrackedResult),
      skipped: (result.skipped || []).map(toTrackedResult)
    };
  }

  async function waitForActiveEditorExpectedText(filePath, expectedContent, timeoutMs) {
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    let actual = readActiveEditorText();
    while (Date.now() < deadline) {
      const activeFileMatches = !filePath || getActiveFilePath() === filePath;
      actual = readActiveEditorText();
      if (activeFileMatches && actual === expectedContent) {
        return {
          ok: true,
          text: actual
        };
      }
      await delay(60);
    }
    actual = readActiveEditorText();
    return {
      ok: false,
      text: actual,
      activePath: getActiveFilePath()
    };
  }

  async function undoEditorHistoryUntilContent(expectedContent, path) {
    const maxClicks = 200;
    for (let clicks = 0; clicks <= maxClicks; clicks += 1) {
      if (readActiveEditorText() === expectedContent) {
        return {
          ok: true,
          attempted: clicks > 0,
          clicks
        };
      }
      if (clicks === maxClicks) {
        break;
      }

      const undoControl = findEditorUndoControl();
      if (!undoControl) {
        return {
          ok: false,
          attempted: clicks > 0,
          code: 'editor_undo_control_not_found',
          reason: `没有找到 Overleaf 编辑器自己的 Undo/撤销按钮，无法一次性撤销 ${path} 的本轮留痕。`
        };
      }

      const beforeText = readActiveEditorText();
      clickNode(undoControl);
      await waitForEditorTextProgress(beforeText, expectedContent, 1000);
      if (readActiveEditorText() === beforeText) {
        return {
          ok: false,
          attempted: clicks > 0,
          code: 'editor_undo_no_progress',
          reason: `Codex 点击了 Overleaf Undo/撤销，但 ${path} 内容没有变化。`
        };
      }
    }

    return {
      ok: false,
      attempted: true,
      code: 'editor_undo_max_iterations',
      reason: `${path} 经过多次 Overleaf 原生撤销后仍未回到本轮写入前内容，已停止以避免撤销其它修改。`
    };
  }

  async function waitForEditorTextProgress(beforeText, expectedContent, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const current = readActiveEditorText();
      if (current !== beforeText || current === expectedContent) {
        return true;
      }
      await delay(60);
    }
    return false;
  }

  async function rejectRemainingTrackedChangesForExpectedFiles(expectedFiles, applied) {
    for (const file of expectedFiles || []) {
      if (!file?.path || typeof file.content !== 'string') {
        continue;
      }
      const result = await rejectRemainingTrackedChangesForExpectedFile(file, applied);
      if (!result.ok) {
        return result;
      }
    }
    return { ok: true };
  }

  async function rejectRemainingTrackedChangesForTrackedPaths(trackedChanges, applied) {
    const paths = Array.from(new Set((trackedChanges || [])
      .map(change => normalizeSafeProjectPath(change?.path || ''))
      .filter(Boolean)));
    if (!paths.length) {
      const activePath = normalizeSafeProjectPath(getActiveFilePath());
      if (!activePath || !applied.length) {
        return { ok: true };
      }
      paths.push(activePath);
    }

    for (const path of paths) {
      const result = await rejectRemainingTrackedChangesForPath(path, applied);
      if (!result.ok) {
        return result;
      }
    }
    return { ok: true };
  }

  async function rejectRemainingTrackedChangesForPath(path, applied) {
    if (path && getActiveFilePath() !== path) {
      const opened = await openFileByPath(path);
      if (!opened.ok) {
        return {
          ok: false,
          code: 'tracked_change_file_open_failed',
          reason: `无法打开 ${path} 来继续拒绝这轮留痕记录；请在 Overleaf 审阅面板手动处理。`
        };
      }
    }

    const appliedCountBefore = applied.length;
    const maxAttempts = 200;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const node = findLastTrackedChangeNodeForPath(path);
      if (!node) {
        if (applied.length > appliedCountBefore) {
          return { ok: true };
        }
        return {
          ok: false,
          code: 'tracked_change_not_found',
          reason: '没有在 Overleaf 页面里找到这轮写入对应的留痕记录；Codex 没有用文本补丁伪撤销。'
        };
      }

      const rejectControl = findRejectControlForTrackedChangeNode(node);
      if (!rejectControl) {
        return {
          ok: false,
          code: 'tracked_change_reject_control_not_found',
          reason: `还有 ${path || '当前文件'} 的留痕记录未处理，但没有找到对应的 Reject/拒绝按钮；请在 Overleaf 审阅面板手动拒绝。`
        };
      }

      const trackedChange = trackedChangeRefFromNode(node, path);
      const beforeText = readActiveEditorText();
      clickNode(rejectControl);
      await waitForTrackedChangeRejectProgress(trackedChange, path, beforeText, 1200);
      applied.push({
        trackedChange,
        result: {
          ok: true,
          method: 'overleaf-review-reject-sweep'
        }
      });
    }

    return {
      ok: false,
      code: 'tracked_change_undo_max_iterations',
      reason: `${path || '当前文件'} 仍有未完成的留痕记录；Codex 已停止以避免误拒绝其它改动。`
    };
  }

  async function rejectRemainingTrackedChangesForExpectedFile(file, applied) {
    const opened = await openFileByPath(file.path);
    if (!opened.ok) {
      return {
        ok: false,
        code: 'tracked_change_undo_verify_open_failed',
        reason: `撤销后无法打开 ${file.path} 验证内容；请刷新 Overleaf 后检查。`
      };
    }

    const appliedCountBefore = applied.length;
    const maxAttempts = 200;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const node = findLastTrackedChangeNodeForPath(file.path);
      if (!node) {
        const verified = await verifyActiveEditorText(file.content, file.path, 800);
        if (verified.ok) {
          return { ok: true };
        }
        const rejectedAnyForFile = applied.length > appliedCountBefore;
        return {
          ...verified,
          code: rejectedAnyForFile ? 'tracked_change_undo_verify_failed' : 'tracked_change_not_found',
          reason: rejectedAnyForFile
            ? `${file.path} 拒绝留痕后内容没有回到写入前状态；请在 Overleaf 审阅面板检查这轮修改。`
            : '没有在 Overleaf 页面里找到这轮写入对应的留痕记录；Codex 没有用文本补丁伪撤销。'
        };
      }

      const rejectControl = findRejectControlForTrackedChangeNode(node);
      if (!rejectControl) {
        return {
          ok: false,
          code: 'tracked_change_reject_control_not_found',
          reason: `还有 ${file.path} 的留痕记录未处理，但没有找到对应的 Reject/拒绝按钮；请在 Overleaf 审阅面板手动拒绝。`
        };
      }

      const trackedChange = trackedChangeRefFromNode(node, file.path);
      const beforeText = readActiveEditorText();
      clickNode(rejectControl);
      await waitForTrackedChangeRejectProgress(trackedChange, file.path, beforeText, 1200);
      applied.push({
        trackedChange,
        result: {
          ok: true,
          method: 'overleaf-review-reject-sweep'
        }
      });
    }

    return {
      ok: false,
      code: 'tracked_change_undo_max_iterations',
      reason: `${file.path} 仍有未完成的留痕记录；Codex 已停止以避免误拒绝其它改动。`
    };
  }

  async function waitForTrackedChangeRejectProgress(trackedChange, path, beforeText, timeoutMs) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const currentText = readActiveEditorText();
      if (currentText !== beforeText) {
        return true;
      }
      if (trackedChange?.key && !findTrackedChangeNode({ ...trackedChange, path })) {
        return true;
      }
      await delay(80);
    }
    return false;
  }

  function buildNoTraceUndoBlockedResult(operations, disabled) {
    return {
      ok: false,
      applied: [],
      skipped: (operations || []).map(rawOperation => ({
        operation: normalizeOperationPaths(rawOperation),
        result: {
          ok: false,
          code: disabled?.code || 'reviewing_disable_failed',
          reason: disabled?.reason || '无法确认 Overleaf Reviewing/Track Changes 已关闭；为避免撤销也留下新的留痕，Codex 没有执行撤销。'
        }
      })),
      reviewingPolicy: {
        policy: 'no-trace-undo',
        disabled: false,
        restored: false,
        disable: summarizeReviewingToggleResult(disabled)
      }
    };
  }

  function buildReviewingRequiredBlockedResult(operations, reviewing) {
    return {
      ok: false,
      applied: [],
      skipped: (operations || []).map(rawOperation => ({
        operation: normalizeOperationPaths(rawOperation),
        result: {
          ok: false,
          code: reviewing?.code || 'reviewing_not_enabled',
          reason: reviewing?.reason || 'Overleaf Reviewing/Track Changes was not confirmed before writing. Codex did not change this file.',
          reviewing: reviewing?.reviewing || null
        }
      })),
      reviewing
    };
  }

  function buildEditingRequiredBlockedResult(operations, editing) {
    return {
      ok: false,
      applied: [],
      skipped: (operations || []).map(rawOperation => ({
        operation: normalizeOperationPaths(rawOperation),
        result: {
          ok: false,
          code: editing?.code || 'editing_not_confirmed',
          reason: editing?.reason || 'Overleaf Editing mode was not confirmed before writing. Codex did not change this file.',
          reviewing: editing?.reviewing || null
        }
      })),
      reviewing: editing
    };
  }

  async function applyEditOperation(operation, options = {}) {
    const currentPath = getActiveFilePath();
    const editorReady = await ensureEditorReadyForOperation(operation, options.baseFileLookup, currentPath);
    if (!editorReady.ok) {
      return editorReady;
    }

    const trackReviewingChanges = options.trackReviewingChanges === true;
    const forbidTrackedChanges = options.forbidTrackedChanges === true;
    const observeTrackedChanges = trackReviewingChanges || forbidTrackedChanges;
    const operationPaths = collectOperationPaths([operation]);
    const trackedBefore = observeTrackedChanges
      ? collectTrackedChangeRefsForPaths(operationPaths)
      : [];
    let current = editorReady.text;
    let freshness = window.CodexOverleafStaleGuard?.checkOperationFreshness(
      operation,
      current,
      options.baseFileLookup
    ) || { ok: true };
    if (!freshness.ok) {
      const ready = await waitForFreshEditorTextForOperation(operation, options.baseFileLookup, 1500);
      if (!ready.ok) {
        return attachWritebackDebug(freshness, 'stale_guard', operation, options.baseFileLookup, current, {
          initialActivePath: currentPath,
          editorReadyDebug: editorReady.debug || null,
          waitFresh: ready
        });
      }
      current = ready.text;
      freshness = { ok: true };
    }

    let nextContent = null;
    if (Array.isArray(operation.patches) && operation.patches.length) {
      const patched = applyTextPatches(current, operation.patches);
      if (!patched.ok) {
        return attachWritebackDebug(patched, 'apply_text_patches', operation, options.baseFileLookup, current, {
          initialActivePath: currentPath,
          editorReadyDebug: editorReady.debug || null
        });
      }
      nextContent = patched.text;
    } else if (typeof operation.replaceAll === 'string') {
      nextContent = operation.replaceAll;
    } else if (typeof operation.find === 'string' && typeof operation.replace === 'string') {
      if (!current.includes(operation.find)) {
        return {
          ok: false,
          reason: 'Find text was not present in the active editor'
        };
      }
      nextContent = current.split(operation.find).join(operation.replace);
    } else {
      return {
        ok: false,
        reason: 'Edit operation must provide patches, replaceAll, or find/replace fields'
      };
    }

    const result = Array.isArray(operation.patches) && operation.patches.length
      ? replaceActiveEditorPatches(operation.patches, nextContent)
      : replaceActiveEditorText(nextContent);
    if (!result.ok) {
      return result;
    }

    const verified = await verifyActiveEditorText(nextContent, operation.path);
    if (!verified.ok) {
      return attachWritebackDebug(verified, 'write_verification', operation, options.baseFileLookup, readActiveEditorText(), {
        initialActivePath: currentPath,
        editorReadyDebug: editorReady.debug || null
      });
    }
    const trackedChanges = [];
    if (observeTrackedChanges) {
      const trackedDiff = forbidTrackedChanges
        ? await waitForTrackedChangeDiff(trackedBefore, operationPaths, {
          waitMs: 3600,
          intervalMs: 180
        })
        : (() => null)();
      if (trackedDiff) {
        trackedChanges.push(...trackedDiff.trackedChanges);
      } else {
        await delay(120);
        const trackedAfter = collectTrackedChangeRefsForPaths(operationPaths);
        trackedChanges.push(...diffTrackedChangeRefs(trackedBefore, trackedAfter));
      }
      if (forbidTrackedChanges && trackedChanges.length > 0) {
        return {
          ok: false,
          code: 'accept_replay_created_tracked_changes',
          reason: 'Accept All replay wrote the expected text, but Overleaf created fresh tracked changes during the replay. Codex tried to roll back this replay and left the run pending instead of marking it accepted.',
          verified: true,
          verifiedContent: nextContent,
          trackedChanges: mergeTrackedChangeRefs(trackedChanges)
        };
      }
    }
    window.CodexOverleafStaleGuard?.updateExpectedFileContent(
      options.baseFileLookup,
      operation.path,
      nextContent
    );
    return {
      ...result,
      verified: true,
      verifiedContent: nextContent,
      trackedChanges: mergeTrackedChangeRefs(trackedChanges)
    };
  }

  async function waitForTrackedChangeDiff(trackedBefore, paths, options = {}) {
    const waitMs = Number.isFinite(Number(options.waitMs)) ? Number(options.waitMs) : 3000;
    const intervalMs = Number.isFinite(Number(options.intervalMs)) ? Number(options.intervalMs) : 180;
    const deadline = Date.now() + Math.max(0, waitMs);
    let latest = [];
    while (Date.now() <= deadline) {
      const trackedAfter = collectTrackedChangeRefsForPaths(paths);
      latest = diffTrackedChangeRefs(trackedBefore, trackedAfter);
      if (latest.length > 0) {
        return {
          ok: true,
          trackedChanges: latest,
          waitMs
        };
      }
      await delay(intervalMs);
    }
    return {
      ok: true,
      trackedChanges: latest,
      waitMs
    };
  }

  async function verifyActiveEditorText(expected, filePath, waitMs = 1000) {
    const deadline = Date.now() + waitMs;
    let actual = readActiveEditorText();
    while (actual !== expected && Date.now() < deadline) {
      await delay(50);
      actual = readActiveEditorText();
    }
    if (actual === expected) {
      return {
        ok: true
      };
    }
    return {
      ok: false,
      code: 'write_verification_failed',
      reason: `${filePath || '当前文件'} 写入后读回内容和 Codex 预期不一致，已停止把这次操作标记为成功。请刷新 Overleaf 后重试。`,
      expectedLength: String(expected || '').length,
      actualLength: String(actual || '').length
    };
  }

  async function ensureEditorReadyForOperation(operation, baseFileLookup, initialActivePath) {
    if (!operation?.path) {
      return {
        ok: true,
        text: readActiveEditorText()
      };
    }
    const filePath = normalizeSafeProjectPath(operation.path);
    if (!filePath) {
      return invalidProjectPathResult('operation path');
    }

    const currentText = readActiveEditorText();
    const previousEditorIdentity = getActiveEditorIdentity();
    const previousSignature = contentSignature(currentText);
    const opened = await openFileByPath(filePath, { force: initialActivePath === filePath });
    if (!opened.ok) {
      return {
        ok: false,
        code: 'file_open_failed',
        debug: buildWritebackDebug('open_file_failed', operation, baseFileLookup, currentText, {
          initialActivePath,
          opened
        }),
        reason: `Cannot edit ${filePath}; active file is ${initialActivePath || 'unknown'}; ${opened.reason}`
      };
    }

    return waitForEditorContentForPath(filePath, previousEditorIdentity, baseFileLookup, 9000, {
      initialActivePath,
      previousSignature,
      forceSettledOpen: true,
      openedMethod: opened.method || ''
    });
  }

  async function waitForEditorContentForPath(filePath, previousEditorIdentity, baseFileLookup, timeoutMs, options = {}) {
    const deadline = Date.now() + timeoutMs;
    const startedAt = Date.now();
    const minSettleMs = options.forceSettledOpen ? writebackOpenSettleMs : 0;
    let lastText = readActiveEditorText();
    let lastActivePath = getActiveFilePath();
    while (Date.now() < deadline) {
      lastActivePath = getActiveFilePath();
      lastText = readActiveEditorText();
      const activeFileMatches = lastActivePath === filePath;
      const identityChanged = Boolean(previousEditorIdentity) && activeEditorIdentityChanged(previousEditorIdentity);
      const baseComparison = compareEditorTextToBase(filePath, lastText, baseFileLookup);
      const baseMatches = baseComparison.matches;
      const settledLongEnough = Date.now() - startedAt >= minSettleMs;
      const switchConfirmed = identityChanged
        || (options.initialActivePath === filePath
          && options.previousSignature
          && contentSignature(lastText) === options.previousSignature
          && settledLongEnough);
      const contentNoLongerLooksLikePreviousDocument = !options.previousSignature
        || contentSignature(lastText) !== options.previousSignature
        || baseMatches
        || options.initialActivePath === filePath;
      if (activeFileMatches && switchConfirmed && settledLongEnough && contentNoLongerLooksLikePreviousDocument) {
        return {
          ok: true,
          text: lastText
        };
      }
      await delay(100);
    }
    return {
      ok: false,
      code: 'editor_document_not_switched',
      reason: `Cannot edit ${filePath}; Overleaf selected ${lastActivePath || 'unknown file'} but the editor document did not load the target file. Codex did not write to avoid editing the wrong file.`,
      lastActivePath,
      lastLength: String(lastText || '').length,
      debug: buildWritebackDebug('editor_document_not_switched', { type: 'edit', path: filePath }, baseFileLookup, lastText, {
        initialActivePath: options.initialActivePath || '',
        lastActivePath,
        previous: options.previousSignature || '',
        currentSignature: contentSignature(lastText),
        openedMethod: options.openedMethod || '',
        elapsedMs: Date.now() - startedAt
      })
    };
  }

  async function waitForEditorDocumentForPath(filePath, previousEditorIdentity, timeoutMs, options = {}) {
    const deadline = Date.now() + timeoutMs;
    const startedAt = Date.now();
    const minSettleMs = options.forceSettledOpen ? writebackOpenSettleMs : 0;
    let lastText = readActiveEditorText();
    let lastActivePath = getActiveFilePath();
    while (Date.now() < deadline) {
      lastActivePath = getActiveFilePath();
      lastText = readActiveEditorText();
      const activeFileMatches = lastActivePath === filePath;
      const identityChanged = Boolean(previousEditorIdentity) && activeEditorIdentityChanged(previousEditorIdentity);
      const settledLongEnough = Date.now() - startedAt >= minSettleMs;
      const sameFileReopenSettled = options.initialActivePath === filePath && settledLongEnough;
      if (activeFileMatches && settledLongEnough && (identityChanged || sameFileReopenSettled)) {
        return {
          ok: true,
          text: lastText
        };
      }
      await delay(100);
    }
    return {
      ok: false,
      code: 'editor_document_not_switched',
      reason: `Cannot verify ${filePath}; Overleaf selected ${lastActivePath || 'unknown file'} but the editor document did not confirm the target file.`,
      lastActivePath,
      lastLength: String(lastText || '').length
    };
  }

  function editorContentMatchesBase(filePath, content, baseFileLookup) {
    return compareEditorTextToBase(filePath, content, baseFileLookup).matches;
  }

  function compareEditorTextToBase(filePath, content, baseFileLookup) {
    const normalizedPath = normalizeSafeProjectPath(filePath);
    const current = normalizeEditorTextForComparison(content);
    if (!baseFileLookup || !normalizedPath || !baseFileLookup.has(normalizedPath)) {
      return {
        known: false,
        hasContent: false,
        matches: false,
        baseLength: null,
        currentLength: current.length
      };
    }
    const base = normalizeEditorTextForComparison(baseFileLookup.get(normalizedPath));
    const matches = current === base;
    if (!matches && base.trim().length > 0) {
      console.warn('[codex-overleaf] editorContentMatchesBase MISMATCH', filePath,
        'base.length:', base.length, 'current.length:', current.length,
        'base[0..80]:', JSON.stringify(base.slice(0, 80)),
        'current[0..80]:', JSON.stringify(current.slice(0, 80)));
    }
    return {
      known: true,
      hasContent: base.trim().length > 0,
      matches,
      baseLength: base.length,
      currentLength: current.length
    };
  }

  function hasBaseFileContent(filePath, baseFileLookup) {
    if (!baseFileLookup || !filePath || !baseFileLookup.has(filePath)) {
      return false;
    }
    const content = baseFileLookup.get(filePath);
    return typeof content === 'string' && content.trim().length > 0;
  }

  function normalizeEditorTextForComparison(value) {
    const normalized = String(value ?? '').replace(/\r\n/g, '\n');
    return normalized.trim().length === 0 ? '' : normalized;
  }

  async function waitForFreshEditorTextForOperation(operation, baseFileLookup, waitMs = 1500) {
    const deadline = Date.now() + Math.max(0, Number(waitMs) || 0);
    while (Date.now() < deadline) {
      if (operation?.path && getActiveFilePath() !== operation.path) {
        await delay(60);
        continue;
      }
      const text = readActiveEditorText();
      const freshness = window.CodexOverleafStaleGuard?.checkOperationFreshness(
        operation,
        text,
        baseFileLookup
      ) || { ok: true };
      if (freshness.ok) {
        return {
          ok: true,
          text
        };
      }
      await delay(60);
    }
    return {
      ok: false
    };
  }

  function applyTextPatches(text, patches) {
    const normalized = normalizeTextPatches(patches, text.length);
    if (!normalized.ok) {
      return normalized;
    }

    let next = text;
    for (const patch of normalized.patches.slice().sort((left, right) => right.from - left.from)) {
      if (next.slice(patch.from, patch.to) !== patch.expected) {
        return {
          ok: false,
          code: 'stale_patch',
          reason: '这处内容已经和 Codex 读取时不同，所以没有写入。请重新运行，让 Codex 先读取你的最新 Overleaf 内容。'
        };
      }
      next = next.slice(0, patch.from) + patch.insert + next.slice(patch.to);
    }
    return {
      ok: true,
      text: next,
      patches: normalized.patches
    };
  }


  async function applyBinaryAssetOperation(operation, options = {}) {
    const freshness = await checkBinaryAssetFreshness(operation, options);
    if (!freshness.ok) {
      return freshness;
    }

    const bytes = decodeBase64Bytes(operation.contentBase64);
    if (!bytes.ok) {
      return bytes;
    }

    const manager = findFileTreeManager();
    const file = createAssetFile(operation.path, bytes.bytes);
    const methodNames = ['uploadFile', 'uploadAsset', 'createBinaryFile', 'createFile', 'addFile'];
    for (const methodName of methodNames) {
      const method = manager?.[methodName];
      if (typeof method !== 'function') {
        continue;
      }
      try {
        if (operation.type === 'overwrite-binary' && projectPathExists(operation.path)) {
          await method.call(manager, operation.path, file, { overwrite: true });
        } else {
          await method.call(manager, operation.path, file);
        }
        await delay(120);
        if (!projectPathExists(operation.path)) {
          return {
            ok: false,
            code: 'binary_asset_verification_failed',
            reason: `${operation.path} did not appear in the Overleaf file tree after binary asset upload.`
          };
        }
        return {
          ok: true,
          method: `fileTreeManager.${methodName}`,
          verified: true,
          binaryAsset: true
        };
      } catch (_error) {
        // Try the next known Overleaf file upload method.
      }
    }

    return {
      ok: false,
      code: 'binary_asset_write_unsupported',
      reason: 'No supported Overleaf binary asset upload method was detected. The asset was not written.'
    };
  }

  async function checkBinaryAssetFreshness(operation, options = {}) {
    const baseFileLookup = options.baseFileLookup;
    const baseBinaryFileLookup = options.baseBinaryFileLookup;
    if (!operation?.path) {
      return {
        ok: false,
        code: 'missing_operation_path',
        reason: 'Cannot safely write a binary asset without a target path.'
      };
    }
    if (operation.type === 'binary-create' && projectPathExists(operation.path)) {
      return {
        ok: false,
        code: 'path_created_since_snapshot',
        reason: `${operation.path} already exists in Overleaf. Codex did not overwrite it as a new asset.`
      };
    }
    if (operation.type === 'overwrite-binary' && baseFileLookup && !baseFileLookup.has(operation.path)) {
      return {
        ok: false,
        code: 'missing_base_file',
        reason: `${operation.path} was not present in the run baseline. Codex did not overwrite it.`
      };
    }
    if (operation.type === 'overwrite-binary' && !projectPathExists(operation.path)) {
      return {
        ok: false,
        code: 'missing_current_binary_asset',
        reason: `${operation.path} no longer exists in Overleaf. Codex did not overwrite it.`
      };
    }
    if (operation.type === 'overwrite-binary') {
      const baseBinaryFile = baseBinaryFileLookup?.get(operation.path);
      if (!baseBinaryFile) {
        return {
          ok: false,
          code: 'missing_binary_base_content',
          reason: `${operation.path} did not have binary baseline content. Codex did not overwrite it.`
        };
      }
      const currentBinaryFile = await getCurrentBinaryAssetFile(operation.path);
      if (!currentBinaryFile.ok) {
        return currentBinaryFile;
      }
      if (!binaryAssetMatchesBaseline(baseBinaryFile, currentBinaryFile.file)) {
        return {
          ok: false,
          code: 'stale_binary_asset',
          reason: `${operation.path} changed in Overleaf after the baseline. Codex did not overwrite it.`
        };
      }
    }
    return { ok: true };
  }

  function buildBaseBinaryFileLookup(files) {
    if (!Array.isArray(files) || !files.length) {
      return null;
    }
    const lookup = new Map();
    for (const file of files) {
      if (!file?.path || typeof file.contentBase64 !== 'string') {
        continue;
      }
      const filePath = normalizeSafeProjectPath(file.path);
      if (!filePath) {
        continue;
      }
      lookup.set(filePath, {
        contentBase64: normalizeBase64(file.contentBase64),
        size: Number.isFinite(Number(file.size)) ? Number(file.size) : null
      });
    }
    return lookup.size ? lookup : null;
  }

  async function getCurrentBinaryAssetFile(filePath) {
    try {
      const project = await projectSnapshotBridge.getProjectSnapshot({
        zipOnly: true,
        includeBinaryFiles: true,
        force: true,
        maxAgeMs: 0
      });
      const normalizedPath = normalizeSafeProjectPath(filePath);
      const file = (project?.files || []).find(item =>
        normalizeSafeProjectPath(item?.path) === normalizedPath
      );
      if (!file || typeof file.contentBase64 !== 'string') {
        return {
          ok: false,
          code: 'current_binary_asset_unavailable',
          reason: `${filePath} could not be verified from a fresh Overleaf ZIP snapshot. Codex did not overwrite it.`
        };
      }
      return { ok: true, file };
    } catch (error) {
      return {
        ok: false,
        code: 'current_binary_asset_unavailable',
        reason: `${filePath} could not be verified before overwrite: ${error.message}`
      };
    }
  }

  function binaryAssetMatchesBaseline(baseFile, currentFile) {
    if (!baseFile || !currentFile) {
      return false;
    }
    const baseContent = normalizeBase64(baseFile.contentBase64);
    const currentContent = normalizeBase64(currentFile.contentBase64);
    if (!baseContent || baseContent !== currentContent) {
      return false;
    }
    const currentSize = Number.isFinite(Number(currentFile.size)) ? Number(currentFile.size) : null;
    return baseFile.size == null || currentSize == null || baseFile.size === currentSize;
  }

  function normalizeBase64(value) {
    return String(value || '').replace(/\s+/g, '');
  }

  function decodeBase64Bytes(contentBase64) {
    try {
      const binary = window.atob(String(contentBase64 || ''));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return { ok: true, bytes };
    } catch (_error) {
      return {
        ok: false,
        code: 'invalid_binary_asset_content',
        reason: 'Binary asset content was not valid base64.'
      };
    }
  }

  function createAssetFile(filePath, bytes) {
    const name = String(filePath || '').split('/').filter(Boolean).pop() || 'asset';
    const type = inferAssetMimeType(filePath);
    if (typeof File === 'function') {
      return new File([bytes], name, { type });
    }
    return new Blob([bytes], { type });
  }

  function inferAssetMimeType(filePath) {
    const normalized = String(filePath || '').toLowerCase();
    if (normalized.endsWith('.pdf')) {
      return 'application/pdf';
    }
    if (normalized.endsWith('.png')) {
      return 'image/png';
    }
    if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) {
      return 'image/jpeg';
    }
    if (normalized.endsWith('.svg')) {
      return 'image/svg+xml';
    }
    return 'application/octet-stream';
  }

  async function applyFileTreeOperation(operation, options = {}) {
    const freshness = await checkFileTreeOperationFreshness(operation, options.baseFileLookup);
    if (!freshness.ok) {
      return freshness;
    }

    const manager = findFileTreeManager();
    const methodNames = fileTreeMethodNames(operation.type);

    for (const methodName of methodNames) {
      const method = manager?.[methodName];
      if (typeof method !== 'function') {
        continue;
      }

      try {
        if (operation.type === 'create') {
          await method.call(manager, operation.path, operation.content || '');
        } else if (operation.type === 'rename' || operation.type === 'move') {
          await method.call(manager, operation.path, operation.to);
        } else if (operation.type === 'delete') {
          await method.call(manager, operation.path);
        }
        const verified = await verifyFileTreeOperation(operation);
        if (!verified.ok) {
          return verified;
        }
        recordFileTreeOperationSuccess(operation, options.baseFileLookup);
        return {
          ok: true,
          method: `fileTreeManager.${methodName}`,
          verified: true
        };
      } catch (_error) {
        // Try the next known method name.
      }
    }

    return {
      ok: false,
      reason: 'No supported Overleaf file-tree method was detected'
    };
  }

  async function verifyFileTreeOperation(operation) {
    await delay(120);
    const sourcePath = operation.path;
    const targetPath = operation.to;

    if (operation.type === 'create') {
      if (!projectPathExists(sourcePath)) {
        return fileTreeVerificationFailed(operation, `${sourcePath} 没有出现在 Overleaf 文件树中。`);
      }
      if (typeof operation.content === 'string' && window.CodexOverleafProjectFiles.isTextProjectPath(sourcePath)) {
        const opened = await openFileByPath(sourcePath);
        if (!opened.ok) {
          return fileTreeVerificationFailed(operation, `${sourcePath} 创建后无法打开验证内容。`);
        }
        const verified = await verifyActiveEditorText(operation.content, sourcePath, 600);
        if (!verified.ok) {
          return fileTreeVerificationFailed(operation, `${sourcePath} 创建后内容没有和 Codex 预期一致。`);
        }
      }
      return { ok: true };
    }

    if (operation.type === 'delete') {
      return projectPathExists(sourcePath)
        ? fileTreeVerificationFailed(operation, `${sourcePath} 仍然存在。`)
        : { ok: true };
    }

    if (operation.type === 'rename' || operation.type === 'move') {
      if (!targetPath || !projectPathExists(targetPath)) {
        return fileTreeVerificationFailed(operation, `${targetPath || '目标路径'} 没有出现在 Overleaf 文件树中。`);
      }
      if (projectPathExists(sourcePath)) {
        return fileTreeVerificationFailed(operation, `${sourcePath} 仍然存在。`);
      }
      return { ok: true };
    }

    return { ok: true };
  }

  function fileTreeVerificationFailed(operation, reason) {
    return {
      ok: false,
      code: 'file_tree_verification_failed',
      reason: `Overleaf 文件树操作没有被确认：${reason} Codex 已停止把这次操作标记为成功。`,
      operationType: operation?.type || '',
      path: operation?.path || '',
      to: operation?.to || ''
    };
  }

  async function checkFileTreeOperationFreshness(operation, baseFileLookup) {
    if (!baseFileLookup) {
      return { ok: true };
    }

    if (!operation.path) {
      return {
        ok: false,
        code: 'missing_operation_path',
        reason: `Cannot safely ${operation.type || 'modify'} a file without a target path.`
      };
    }

    if (operation.type === 'create') {
      if (baseFileLookup.has(operation.path)) {
        return {
          ok: false,
          code: 'path_exists_in_snapshot',
          reason: `${operation.path} 在任务开始前已经存在。Codex 没有覆盖它；请改用修改文件或换一个文件名。`
        };
      }
      if (projectPathExists(operation.path)) {
        return {
          ok: false,
          code: 'path_created_since_snapshot',
          reason: `${operation.path} 在任务执行期间被你或协作者新建了，Codex 没有覆盖它。请查看差异后重试。`
        };
      }
      return { ok: true };
    }

    if (!baseFileLookup.has(operation.path)) {
      return {
        ok: false,
        code: 'missing_base_file',
        reason: `${operation.path} 在任务开始时没有被 Codex 读到。Codex 没有覆盖它；请刷新项目内容后重试。`
      };
    }

    const current = await readCurrentTextFileForFreshness(operation.path);
    if (!current.ok) {
      return current;
    }

    const freshness = window.CodexOverleafStaleGuard?.checkOperationFreshness(
      { type: 'edit', path: operation.path },
      current.text,
      baseFileLookup
    ) || { ok: true };
    if (!freshness.ok) {
      return freshness;
    }

    if ((operation.type === 'rename' || operation.type === 'move') && operation.to) {
      if (baseFileLookup.has(operation.to) || projectPathExists(operation.to)) {
        return {
          ok: false,
          code: 'destination_exists',
          reason: `Cannot safely ${operation.type} ${operation.path} to ${operation.to} because the destination already exists.`
        };
      }
    }

    return { ok: true };
  }

  async function readCurrentTextFileForFreshness(filePath) {
    const normalizedPath = normalizeSafeProjectPath(filePath);
    if (!normalizedPath) {
      return invalidProjectPathResult('freshness path');
    }
    const currentPath = getActiveFilePath();
    const previousEditorIdentity = getActiveEditorIdentity();
    const opened = await openFileByPath(normalizedPath, { force: true });
    if (!opened.ok) {
      return {
        ok: false,
        code: 'cannot_verify_current_file',
        reason: `Cannot safely verify ${normalizedPath}; ${opened.reason || 'open failed'}. Re-run Codex on a fresh snapshot.`
      };
    }
    const ready = await waitForEditorDocumentForPath(normalizedPath, previousEditorIdentity, 9000, {
      initialActivePath: currentPath,
      forceSettledOpen: true
    });
    if (!ready.ok) {
      return {
        ...ready,
        code: 'cannot_verify_current_file'
      };
    }

    return {
      ok: true,
      text: ready.text
    };
  }

  function recordFileTreeOperationSuccess(operation, baseFileLookup) {
    if (!baseFileLookup) {
      return;
    }

    if (operation.type === 'create') {
      window.CodexOverleafStaleGuard?.updateExpectedFileContent(
        baseFileLookup,
        operation.path,
        operation.content || ''
      );
    } else if (operation.type === 'delete') {
      window.CodexOverleafStaleGuard?.removeExpectedFile(baseFileLookup, operation.path);
    } else if (operation.type === 'rename' || operation.type === 'move') {
      window.CodexOverleafStaleGuard?.moveExpectedFile(baseFileLookup, operation.path, operation.to);
    }
  }

  function fileTreeMethodNames(type) {
    return {
      create: ['createDoc', 'createFile', 'addDoc', 'addFile'],
      rename: ['renameEntity', 'renameFile', 'renameDoc'],
      move: ['moveEntity', 'moveFile', 'moveDoc'],
      delete: ['deleteEntity', 'deleteFile', 'deleteDoc', 'removeEntity']
    }[type] || [];
  }

  function normalizeOperationPaths(operation) {
    if (!operation || typeof operation !== 'object') {
      return operation;
    }
    const normalized = {
      ...operation,
      path: typeof operation.path === 'string'
        ? normalizeSafeProjectPath(operation.path)
        : operation.path,
      to: typeof operation.to === 'string'
        ? normalizeSafeProjectPath(operation.to)
        : operation.to
    };
    if (typeof operation.path === 'string' && !normalized.path) {
      normalized.invalidProjectPath = true;
    }
    if (typeof operation.to === 'string' && !normalized.to) {
      normalized.invalidProjectDestinationPath = true;
    }
    return normalized;
  }

  function validateOperationProjectPaths(operation) {
    if (!operation || typeof operation !== 'object') {
      return { ok: true };
    }
    if (operation.invalidProjectPath || (requiresOperationPath(operation) && !operation.path)) {
      return invalidProjectPathResult('operation path');
    }
    if (operation.invalidProjectDestinationPath || (requiresOperationDestinationPath(operation) && !operation.to)) {
      return invalidProjectPathResult('operation destination path');
    }
    return { ok: true };
  }

  function requiresOperationPath(operation) {
    return ['edit', 'create', 'delete', 'rename', 'move', 'binary-create', 'overwrite-binary'].includes(operation.type);
  }

  function requiresOperationDestinationPath(operation) {
    return operation.type === 'rename' || operation.type === 'move';
  }

  function normalizeBaseFilesForSafety(files) {
    if (!Array.isArray(files)) {
      return files;
    }
    return files
      .map(file => {
        if (!file || typeof file.path !== 'string') {
          return null;
        }
        const filePath = normalizeSafeProjectPath(file.path);
        return filePath ? { ...file, path: filePath } : null;
      })
      .filter(Boolean);
  }

  function collectOperationPaths(operations = []) {
    const paths = new Set();
    for (const rawOperation of operations || []) {
      const operation = normalizeOperationPaths(rawOperation);
      for (const value of [operation?.path, operation?.to]) {
        if (typeof value === 'string' && value) {
          paths.add(value);
        }
      }
    }
    return Array.from(paths);
  }

  function collectTrackedChangeRefsForPaths(paths = []) {
    const pathSet = new Set((paths || []).filter(Boolean));
    const activePath = getActiveFilePath();
    return collectTrackedChangeNodes()
      .map(node => trackedChangeRefFromNode(node, activePath))
      .filter(ref => ref.key)
      .filter(ref => !pathSet.size || !ref.path || pathSet.has(ref.path));
  }

  function collectTrackedChangeNodes() {
    const selector = [
      '[data-change-id]',
      '[data-review-id]',
      '[data-track-change-id]',
      '[data-ol-change-id]',
      '[data-path][class*="change" i]',
      '[class*="track-change" i]',
      '[class*="review-change" i]',
      '[class*="suggest" i]',
      '[aria-label*="change" i]',
      '[title*="change" i]'
    ].join(',');
    return uniqueNodes([
      ...collectElements(selector, 1200),
      ...collectElements('*', 3500).filter(isTrackedChangeNode)
    ]).filter(isTrackedChangeNode);
  }

  function isTrackedChangeNode(node) {
    if (!node || isInsideCodexPanel(node)) {
      return false;
    }
    const signal = normalizeReviewingSignalText(readNodeSignalText(node));
    const tag = (node.tagName || '').toLowerCase();
    if (tag === 'button' && /\b(?:accept|reject|decline|discard|批准|接受|拒绝|丢弃)\b/i.test(signal)) {
      return false;
    }
    if (readTrackedChangeId(node)) {
      return true;
    }
    return /\b(?:tracked change|track change|review change|suggestion|insert(?:ion)?|delet(?:e|ion)|change)\b/i.test(signal)
      || /留痕|建议|插入|删除|更改|修改/.test(signal);
  }

  function trackedChangeRefFromNode(node, fallbackPath = '') {
    const id = readTrackedChangeId(node);
    const key = id ? `id:${id}` : `sig:${compact(readNodeSignalText(node), 180)}`;
    const path = normalizeSafeProjectPath(
      node.getAttribute?.('data-path')
      || node.getAttribute?.('data-file-path')
      || node.getAttribute?.('data-doc-path')
      || fallbackPath
      || ''
    );
    return {
      key,
      id,
      path,
      label: compact(readNodeSignalText(node), 180)
    };
  }

  function readTrackedChangeId(node) {
    for (const attribute of [
      'data-change-id',
      'data-review-id',
      'data-track-change-id',
      'data-ol-change-id',
      'data-id',
      'id'
    ]) {
      const value = node.getAttribute?.(attribute) || '';
      if (value && /\b(?:change|review|track|suggest)|\d|[a-f0-9-]{8,}/i.test(value)) {
        return String(value);
      }
    }
    return '';
  }

  function normalizeTrackedChangeRefs(refs = []) {
    const seen = new Set();
    const normalized = [];
    for (const ref of refs || []) {
      if (!ref || typeof ref !== 'object') {
        continue;
      }
      const key = typeof ref.key === 'string' ? ref.key : '';
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      const hasPath = typeof ref.path === 'string';
      const hasExplicitPath = hasPath && ref.path.trim() !== '';
      const path = hasPath ? normalizeSafeProjectPath(ref.path) : '';
      normalized.push({
        key,
        id: typeof ref.id === 'string' ? ref.id : '',
        path,
        invalidProjectPath: hasExplicitPath && !path,
        label: compact(String(ref.label || ''), 180)
      });
    }
    return normalized;
  }

  function orderTrackedChangesForReviewAction(refs = []) {
    return (refs || []).slice().reverse();
  }

  function diffTrackedChangeRefs(before = [], after = []) {
    const beforeKeys = new Set((before || []).map(ref => ref.key).filter(Boolean));
    const seen = new Set();
    const added = [];
    for (const ref of after || []) {
      if (!ref?.key || beforeKeys.has(ref.key) || seen.has(ref.key)) {
        continue;
      }
      seen.add(ref.key);
      added.push(ref);
    }
    return added;
  }

  function mergeTrackedChangeRefs(refs = []) {
    return normalizeTrackedChangeRefs(refs);
  }

  function findTrackedChangeNode(ref = {}) {
    const targetKey = ref.key || '';
    if (!targetKey || ref.invalidProjectPath) {
      return null;
    }
    return collectTrackedChangeNodes()
      .find(node => trackedChangeRefFromNode(node, ref.path || getActiveFilePath()).key === targetKey)
      || null;
  }

  function findNextTrackedChangeNodeForPath(path) {
    const nodes = findTrackedChangeNodesForPath(path);
    return nodes[0] || null;
  }

  function findLastTrackedChangeNodeForPath(path) {
    const nodes = findTrackedChangeNodesForPath(path);
    return nodes[nodes.length - 1] || null;
  }

  function findTrackedChangeNodesForPath(path) {
    const targetPath = normalizeSafeProjectPath(path || getActiveFilePath());
    return collectTrackedChangeNodes()
      .filter(node => {
        const ref = trackedChangeRefFromNode(node, targetPath);
        return !targetPath || !ref.path || ref.path === targetPath;
      })
  }

  function findRejectControlForTrackedChangeNode(node) {
    const scopes = [];
    let current = node;
    for (let index = 0; current && index < 6; index += 1) {
      scopes.push(current);
      current = current.parentElement;
    }

    for (const scope of scopes) {
      const candidates = typeof scope.querySelectorAll === 'function'
        ? Array.from(scope.querySelectorAll('button,[role="button"],[aria-label],[title]'))
        : [];
      const reject = candidates.find(isRejectTrackedChangeControl);
      if (reject) {
        return reject;
      }
    }
    return isRejectTrackedChangeControl(node) ? node : null;
  }

  function findEditorUndoControl() {
    return collectElements('button,[role="button"],[aria-label],[title]', 1200)
      .find(isEditorUndoControl)
      || null;
  }

  function isEditorUndoControl(node) {
    if (!node || isInsideCodexPanel(node) || node.disabled) {
      return false;
    }
    if (/^(true|disabled)$/i.test(node.getAttribute?.('aria-disabled') || '')) {
      return false;
    }
    const signal = normalizeReviewingSignalText(readNodeSignalText(node));
    if (/\b(?:redo|重做)\b/i.test(signal)) {
      return false;
    }
    return /\bundo\b|撤销/i.test(signal);
  }

  function isRejectTrackedChangeControl(node) {
    if (!node || node.disabled) {
      return false;
    }
    if (/^(true|disabled)$/i.test(node.getAttribute?.('aria-disabled') || '')) {
      return false;
    }
    const signal = normalizeReviewingSignalText(readNodeSignalText(node));
    if (/\b(?:accept|approve|apply|resolve|接受|批准|应用)\b/i.test(signal)) {
      return false;
    }
    return /\b(?:reject|decline|discard|revert|拒绝|丢弃|还原)\b/i.test(signal);
  }

    async function applyOperationsForBridge(operationsOrOptions, options = {}) {
      if (Array.isArray(operationsOrOptions)) {
        return applyOperations(operationsOrOptions, options);
      }
      const payload = operationsOrOptions || {};
      return applyOperations(payload.operations || [], payload);
    }

    async function verifySaveState(paths = [], timeoutMs = 5000) {
      const result = typeof deps.waitForSaveState === 'function'
        ? await deps.waitForSaveState({ deadlineMs: timeoutMs })
        : { ok: false, state: 'unavailable' };
      const verified = result.ok === true && result.state === 'verified_saved';
      return {
        verified,
        unverifiedPaths: verified ? [] : (paths || [])
      };
    }

    return {
      applyOperations: applyOperationsForBridge,
      rejectTrackedChanges,
      acceptTrackedChanges,
      verifySaveState
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
