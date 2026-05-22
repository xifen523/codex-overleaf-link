const assert = require('node:assert/strict');
const test = require('node:test');

const projectFiles = require('../extension/src/shared/projectFiles');
const writebackRouter = require('../extension/src/page/writebackRouter');

// --- Accept All — editor-undo + non-tracked replay -------------------------
//
// The reworked acceptTrackedChanges no longer hunts Overleaf's per-change
// Accept controls. It instead:
//   1. editor-undoes the run's tracked writeback back to its pre-write content
//      (so all the run's tracked changes vanish), then
//   2. switches to Editing mode (Track Changes OFF) and re-applies the run's
//      post-write content as a plain, untracked edit, then
//   3. restores the prior Reviewing mode.
// If the editor-undo cannot reach the pre-write state (content drifted), it
// bails WITHOUT re-writing and returns a not-ok result.
//
// The fake below models a single-document Overleaf editor: editor text is a
// mutable string, the editor undo control pops a history stack back toward the
// pre-write content, and replaceActiveEditorText overwrites the live text.

function createAcceptHarness(spec = {}) {
  const path = spec.path || 'main.tex';
  const preContent = spec.preContent ?? 'before\n';
  const postContent = spec.postContent ?? 'before edited\n';

  // The editor-undo history: each entry is the editor text after an undo step.
  // Driving the writeback in Reviewing mode produced postContent from
  // preContent; one undo step returns to preContent.
  const undoHistory = spec.undoHistory || [preContent];

  const state = {
    activePath: spec.activePath ?? path,
    editorText: spec.startContent ?? postContent,
    reviewing: spec.startReviewing !== false, // run wrote in Reviewing mode
    undoClicks: 0,
    editingActivations: 0,
    reviewingRestores: 0,
    writes: [],
    patchWrites: [],
    opened: []
  };

  const undoControl = {
    tagName: 'BUTTON',
    disabled: false,
    _label: 'Undo',
    getAttribute(name) {
      return name === 'aria-label' ? this._label : null;
    }
  };

  function ensureEditing() {
    // The Accept replay no longer routes through ensureEditing — it forces the
    // toggle via setReviewingEnabled(false) — but keep a faithful stub so any
    // accidental call is still observable.
    if (!state.reviewing) {
      return Promise.resolve({ ok: true, activated: false });
    }
    state.reviewing = false;
    state.editingActivations += 1;
    return Promise.resolve({ ok: true, activated: true });
  }

  function setReviewingEnabled(enabled) {
    if (enabled && spec.reviewingRestoreFails) {
      return Promise.resolve({
        ok: false,
        code: 'reviewing_enable_failed',
        reason: 'Reviewing could not be restored.'
      });
    }
    if (!enabled && spec.editingFails) {
      // Models Overleaf failing to confirm Track Changes OFF.
      return Promise.resolve({
        ok: false,
        code: 'editing_not_confirmed',
        reason: 'Editing mode could not be confirmed.'
      });
    }
    state.reviewing = enabled;
    if (enabled) {
      state.reviewingRestores += 1;
    } else {
      state.editingActivations += 1;
    }
    return Promise.resolve({ ok: true, changed: true, enabled });
  }

  const router = writebackRouter.create({
    compileBridge: { markSourceEdited() { state.markedSourceEdited = true; } },
    normalizeSafeProjectPath: projectFiles.normalizeSafeProjectPath,
    ensureEditing,
    ensureReviewing: () => Promise.resolve({ ok: true, activated: false }),
    setReviewingEnabled,
    getReviewingState: () => ({ reviewing: { ok: state.reviewing }, signals: {} }),
    // The page bridge wires these aria-aware detectors; the fake mirrors them
    // faithfully off the harness's reviewing flag.
    isReviewingConfirmedForWrite: reviewState => reviewState?.reviewing?.ok === true,
    isEditingConfirmedForNoTraceUndo: reviewState => reviewState?.reviewing?.ok === false,
    collectElements(selector) {
      // The editor-undo control is the only DOM control the new mechanism uses.
      if (/button/i.test(selector || '')) {
        return spec.noUndoControl ? [] : [undoControl];
      }
      return [];
    },
    readNodeSignalText: node => node?._label || '',
    isInsideCodexPanel: () => false,
    clickNode(node) {
      if (node === undoControl) {
        state.undoClicks += 1;
        const next = undoHistory[Math.min(state.undoClicks - 1, undoHistory.length - 1)];
        if (typeof next === 'string') {
          state.editorText = next;
        }
      }
    },
    readActiveEditorText: () => state.editorText,
    replaceActiveEditorText(text) {
      state.editorText = String(text);
      state.writes.push({ kind: 'replaceAll', text: String(text) });
      return { ok: true };
    },
    replaceActiveEditorPatches(patches, nextContent) {
      // Models Overleaf's patch-apply path: only the targeted ranges change.
      state.editorText = String(nextContent);
      state.patchWrites.push((patches || []).map(patch => ({
        from: patch.from,
        to: patch.to,
        insert: patch.insert
      })));
      state.writes.push({ kind: 'patches', text: String(nextContent), patches: patches || [] });
      return { ok: true };
    },
    delay: () => Promise.resolve(),
    treeOperations: {
      getActiveFilePath: () => state.activePath,
      openFileByPath(target) {
        state.opened.push(target);
        state.activePath = target;
        return Promise.resolve({ ok: true, method: 'dom-click' });
      }
    },
    window: { setTimeout, clearTimeout },
    ...spec.depOverrides
  });

  return { router, state, path, preContent, postContent };
}

test('acceptTrackedChanges editor-undoes to pre-write content then replays post-write content untracked', async () => {
  // The pre/post content shares a common prefix and suffix so the minimal-diff
  // fallback has something meaningful to trim.
  const preContent = 'Intro paragraph.\nThe quick fox.\nClosing line.\n';
  const postContent = 'Intro paragraph.\nThe quick brown fox.\nClosing line.\n';
  const harness = createAcceptHarness({ preContent, postContent });

  const result = await harness.router.acceptTrackedChanges({
    expectedFiles: [{ path: harness.path, content: harness.preContent }],
    postFiles: [{ path: harness.path, content: harness.postContent }]
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  // The editor-undo ran (the writeback was reverted before the replay).
  assert.ok(harness.state.undoClicks >= 1, 'the run writeback was editor-undone');
  // The post-write content was re-applied via a TARGETED patch — never a
  // whole-file replaceAll.
  assert.equal(harness.state.writes.length, 1);
  assert.equal(harness.state.writes[0].kind, 'patches', 'replay must go through the patches path, not replaceAll');
  assert.equal(harness.state.editorText, postContent);
  // The targeted patch trims the common prefix AND suffix: it does NOT span the
  // whole pre-write document.
  const replayPatch = harness.state.patchWrites[0][0];
  assert.ok(replayPatch.from > 0, 'patch starts after the trimmed common prefix');
  assert.ok(replayPatch.to < harness.preContent.length, 'patch ends before the trimmed common suffix');
  // The replayed span is strictly smaller than the whole file.
  assert.ok(
    (replayPatch.to - replayPatch.from) < harness.preContent.length,
    'the replay patch is a targeted fragment, not the whole file'
  );
  // Sanity: applying the patch reproduces the post-write content.
  assert.equal(
    preContent.slice(0, replayPatch.from) + replayPatch.insert + preContent.slice(replayPatch.to),
    postContent
  );
  // applied carries the replay entry, not per-change DOM clicks.
  assert.ok(result.applied.length >= 1);
  assert.equal(result.applied.some(item => item.result.method === 'overleaf-accept-untracked-replay'), true);
  assert.equal(result.skipped.length, 0);
  assert.equal(harness.state.markedSourceEdited, true);
});

test('acceptTrackedChanges switches to Editing mode before the replay and restores Reviewing after', async () => {
  const harness = createAcceptHarness({
    preContent: 'before\n',
    postContent: 'after\n'
  });

  const result = await harness.router.acceptTrackedChanges({
    expectedFiles: [{ path: harness.path, content: harness.preContent }],
    postFiles: [{ path: harness.path, content: harness.postContent }]
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  // Editing mode was activated for the untracked replay.
  assert.equal(harness.state.editingActivations, 1);
  // The prior Reviewing mode was restored afterwards.
  assert.equal(harness.state.reviewingRestores, 1);
  assert.equal(harness.state.reviewing, true, 'the run is left in Reviewing mode');
});

test('acceptTrackedChanges bails without re-writing when the editor-undo cannot reach pre-write content', async () => {
  // The undo history never reaches the pre-write content (content drifted —
  // e.g. the user manually edited after the run). The mechanism must bail and
  // NOT re-write, so it never makes the document worse.
  const harness = createAcceptHarness({
    preContent: 'before\n',
    postContent: 'after\n',
    // Undo steps land on a drifted state, never on 'before\n'.
    undoHistory: ['drifted content\n', 'drifted content\n']
  });

  const result = await harness.router.acceptTrackedChanges({
    expectedFiles: [{ path: harness.path, content: harness.preContent }],
    postFiles: [{ path: harness.path, content: harness.postContent }]
  });

  assert.equal(result.ok, false, JSON.stringify(result));
  // It must NOT re-apply the post-write content after a failed undo.
  assert.deepEqual(harness.state.writes, [], 'no re-write after a drift bail');
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 1);
  // It never even switches to Editing mode on a drift bail.
  assert.equal(harness.state.editingActivations, 0);
});

test('acceptTrackedChanges bails when no editor-undo control is available', async () => {
  const harness = createAcceptHarness({
    preContent: 'before\n',
    postContent: 'after\n',
    startContent: 'after\n',
    noUndoControl: true
  });

  const result = await harness.router.acceptTrackedChanges({
    expectedFiles: [{ path: harness.path, content: harness.preContent }],
    postFiles: [{ path: harness.path, content: harness.postContent }]
  });

  assert.equal(result.ok, false);
  assert.deepEqual(harness.state.writes, []);
  assert.equal(result.skipped.length, 1);
});

test('acceptTrackedChanges bails without re-writing when Editing mode cannot be confirmed', async () => {
  const harness = createAcceptHarness({
    preContent: 'before\n',
    postContent: 'after\n',
    editingFails: true
  });

  const result = await harness.router.acceptTrackedChanges({
    expectedFiles: [{ path: harness.path, content: harness.preContent }],
    postFiles: [{ path: harness.path, content: harness.postContent }]
  });

  assert.equal(result.ok, false, JSON.stringify(result));
  // The editor-undo ran, but without Editing mode the replay would be tracked,
  // so it bails rather than re-introduce tracked changes.
  assert.deepEqual(harness.state.writes, []);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].result.code, 'editing_not_confirmed');
});

test('acceptTrackedChanges surfaces a Reviewing-restore failure as a skipped entry', async () => {
  const harness = createAcceptHarness({
    preContent: 'before\n',
    postContent: 'after\n',
    reviewingRestoreFails: true
  });

  const result = await harness.router.acceptTrackedChanges({
    expectedFiles: [{ path: harness.path, content: harness.preContent }],
    postFiles: [{ path: harness.path, content: harness.postContent }]
  });

  // The replay still happened (the document content is correct); only the mode
  // restore failed, so it is reported as a skipped entry.
  assert.equal(result.ok, false);
  assert.equal(harness.state.writes.length, 1);
  assert.equal(harness.state.writes[0].kind, 'patches', 'replay must go through the patches path');
  assert.equal(harness.state.editorText, 'after\n');
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].result.code, 'reviewing_enable_failed');
});

test('acceptTrackedChanges returns not-ok when the run has no pre-write/post-write content', async () => {
  const harness = createAcceptHarness();

  const result = await harness.router.acceptTrackedChanges({
    expectedFiles: [],
    postFiles: []
  });

  assert.equal(result.ok, false);
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].result.code, 'accept_missing_run_content');
  assert.deepEqual(harness.state.writes, []);
});

test('acceptTrackedChanges accepts a multi-file run, replaying each file untracked', async () => {
  // A run that touched two files: editor-undo each back to pre-write, replay
  // each post-write content as a plain edit.
  const editors = {
    'main.tex': { text: 'main after\n' },
    'intro.tex': { text: 'intro after\n' }
  };
  const state = {
    activePath: 'main.tex',
    reviewing: true,
    writes: []
  };
  const undoControl = {
    tagName: 'BUTTON',
    disabled: false,
    getAttribute: name => (name === 'aria-label' ? 'Undo' : null)
  };
  const preByPath = { 'main.tex': 'main before\n', 'intro.tex': 'intro before\n' };

  const router = writebackRouter.create({
    compileBridge: { markSourceEdited() {} },
    normalizeSafeProjectPath: projectFiles.normalizeSafeProjectPath,
    writebackOpenSettleMs: 0,
    ensureEditing: () => { state.reviewing = false; return Promise.resolve({ ok: true, activated: true }); },
    ensureReviewing: () => Promise.resolve({ ok: true, activated: false }),
    setReviewingEnabled: enabled => { state.reviewing = enabled; return Promise.resolve({ ok: true, changed: true, enabled }); },
    getReviewingState: () => ({ reviewing: { ok: state.reviewing }, signals: {} }),
    isReviewingConfirmedForWrite: reviewState => reviewState?.reviewing?.ok === true,
    isEditingConfirmedForNoTraceUndo: reviewState => reviewState?.reviewing?.ok === false,
    collectElements: selector => (/button/i.test(selector || '') ? [undoControl] : []),
    readNodeSignalText: () => 'Undo',
    isInsideCodexPanel: () => false,
    // Editor identity changes whenever Overleaf switches the active document, so
    // the writeback machinery can confirm a document switch before re-applying.
    getActiveEditorIdentity: () => ({ path: state.activePath }),
    activeEditorIdentityChanged: previous => previous?.path !== state.activePath,
    clickNode(node) {
      if (node === undoControl) {
        // One undo step on the active file returns it to its pre-write content.
        editors[state.activePath].text = preByPath[state.activePath];
      }
    },
    readActiveEditorText: () => editors[state.activePath].text,
    replaceActiveEditorText(text) {
      editors[state.activePath].text = String(text);
      state.writes.push({ path: state.activePath, kind: 'replaceAll', text: String(text) });
      return { ok: true };
    },
    replaceActiveEditorPatches(patches, nextContent) {
      editors[state.activePath].text = String(nextContent);
      state.writes.push({ path: state.activePath, kind: 'patches', text: String(nextContent) });
      return { ok: true };
    },
    delay: () => Promise.resolve(),
    treeOperations: {
      getActiveFilePath: () => state.activePath,
      openFileByPath(target) { state.activePath = target; return Promise.resolve({ ok: true }); }
    },
    window: { setTimeout, clearTimeout }
  });

  const result = await router.acceptTrackedChanges({
    expectedFiles: [
      { path: 'main.tex', content: 'main before\n' },
      { path: 'intro.tex', content: 'intro before\n' }
    ],
    postFiles: [
      { path: 'main.tex', content: 'main after\n' },
      { path: 'intro.tex', content: 'intro after\n' }
    ]
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(editors['main.tex'].text, 'main after\n');
  assert.equal(editors['intro.tex'].text, 'intro after\n');
  // Each file was replayed via the targeted patches path — never replaceAll.
  assert.equal(state.writes.length, 2);
  assert.equal(state.writes.every(write => write.kind === 'patches'), true,
    'every file replay goes through the patches path, not replaceAll');
});

test('acceptTrackedChanges forces the Editing toggle even when isEditingConfirmedForNoTraceUndo false-positives "already Editing"', async () => {
  // Bug B regression: the lenient isEditingConfirmedForNoTraceUndo reports
  // "already Editing" while Track Changes is actually ON (reviewing.ok === true).
  // The accept flow must NOT trust that short-circuit: it reads the reviewing
  // state, sees Reviewing positively active, and forces setReviewingEnabled(false).
  const harness = createAcceptHarness({
    preContent: 'before\n',
    postContent: 'after\n',
    depOverrides: {
      // The lenient detector lies: it claims Editing is confirmed.
      isEditingConfirmedForNoTraceUndo: () => true
    }
  });
  // The run wrote in Reviewing mode; getReviewingState() positively reports it.
  // (createAcceptHarness defaults startReviewing to true.)

  const result = await harness.router.acceptTrackedChanges({
    expectedFiles: [{ path: harness.path, content: harness.preContent }],
    postFiles: [{ path: harness.path, content: harness.postContent }]
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  // Despite the lenient detector claiming "already Editing", the flow forced
  // the toggle to OFF.
  assert.equal(harness.state.editingActivations, 1, 'the Editing toggle was forced, not skipped');
  // The replay landed and the prior Reviewing mode was restored afterwards.
  assert.equal(harness.state.writes.length, 1);
  assert.equal(harness.state.writes[0].kind, 'patches');
  assert.equal(harness.state.reviewingRestores, 1);
  assert.equal(harness.state.reviewing, true);
});

test('acceptTrackedChanges bails when Editing cannot be positively confirmed after the toggle', async () => {
  // setReviewingEnabled reports ok, but the post-toggle reviewing state still
  // says Reviewing is active. The flow must positively confirm Editing OFF and
  // bail rather than replay while tracked.
  const state = { reviewing: true };
  const undoControl = {
    tagName: 'BUTTON', disabled: false,
    getAttribute: name => (name === 'aria-label' ? 'Undo' : null)
  };
  let editorText = 'after\n';
  const writes = [];
  const router = writebackRouter.create({
    compileBridge: { markSourceEdited() {} },
    normalizeSafeProjectPath: projectFiles.normalizeSafeProjectPath,
    ensureEditing: () => Promise.resolve({ ok: true, activated: true }),
    ensureReviewing: () => Promise.resolve({ ok: true, activated: false }),
    // The toggle "succeeds" but never actually leaves Reviewing.
    setReviewingEnabled: enabled => Promise.resolve({ ok: true, changed: true, enabled }),
    // ...so getReviewingState keeps reporting Reviewing as positively active.
    getReviewingState: () => ({ reviewing: { ok: state.reviewing }, signals: {} }),
    isReviewingConfirmedForWrite: reviewState => reviewState?.reviewing?.ok === true,
    isEditingConfirmedForNoTraceUndo: reviewState => reviewState?.reviewing?.ok === false,
    collectElements: selector => (/button/i.test(selector || '') ? [undoControl] : []),
    readNodeSignalText: () => 'Undo',
    isInsideCodexPanel: () => false,
    clickNode(node) { if (node === undoControl) { editorText = 'before\n'; } },
    readActiveEditorText: () => editorText,
    replaceActiveEditorText(text) { editorText = String(text); writes.push(text); return { ok: true }; },
    replaceActiveEditorPatches(_patches, nextContent) { editorText = String(nextContent); writes.push(nextContent); return { ok: true }; },
    delay: () => Promise.resolve(),
    treeOperations: {
      getActiveFilePath: () => 'main.tex',
      openFileByPath: () => Promise.resolve({ ok: true })
    },
    window: { setTimeout, clearTimeout }
  });

  const result = await router.acceptTrackedChanges({
    expectedFiles: [{ path: 'main.tex', content: 'before\n' }],
    postFiles: [{ path: 'main.tex', content: 'after\n' }]
  });

  assert.equal(result.ok, false, JSON.stringify(result));
  // It must NOT replay while Reviewing is still active.
  assert.deepEqual(writes, [], 'no replay while Track Changes could not be confirmed off');
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].result.code, 'accept_editing_not_confirmed');
});

test('acceptTrackedChanges re-applies the run\'s original forward patches verbatim when appliedOperations are provided', async () => {
  // The run's forward writeback applied two separate targeted patches. After the
  // editor-undo the document is back at the pre-write content, so those exact
  // patches re-apply cleanly. Accept All must re-use them — not a whole-file
  // replaceAll and not a re-derived diff.
  const preContent = 'alpha\nbeta\ngamma\n';
  // patch 1: 'alpha' -> 'ALPHA'  (from 0, to 5)
  // patch 2: 'gamma' -> 'GAMMA'  (from 11, to 16)
  const postContent = 'ALPHA\nbeta\nGAMMA\n';
  const originalPatches = [
    { from: 0, to: 5, expected: 'alpha', insert: 'ALPHA' },
    { from: 11, to: 16, expected: 'gamma', insert: 'GAMMA' }
  ];
  const harness = createAcceptHarness({ preContent, postContent });

  const result = await harness.router.acceptTrackedChanges({
    expectedFiles: [{ path: harness.path, content: preContent }],
    postFiles: [{ path: harness.path, content: postContent }],
    appliedOperations: [
      { type: 'edit', path: harness.path, patches: originalPatches }
    ]
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(harness.state.writes.length, 1);
  assert.equal(harness.state.writes[0].kind, 'patches', 'replay went through the patches path');
  assert.equal(harness.state.editorText, postContent);
  // The run's original two patches were replayed verbatim — not collapsed into
  // a single whole-span diff.
  const replayed = harness.state.patchWrites[0];
  assert.equal(replayed.length, 2, 'both original forward patches were re-applied');
  assert.deepEqual(
    replayed.map(patch => ({ from: patch.from, to: patch.to, insert: patch.insert })),
    originalPatches.map(patch => ({ from: patch.from, to: patch.to, insert: patch.insert }))
  );
});

test('acceptTrackedChanges falls back to a minimal diff when appliedOperations carry no usable patches', async () => {
  // The run's recorded operation is a whole-file replaceAll (no patches). The
  // replay must NOT reuse the replaceAll — it computes a minimal diff instead.
  const preContent = 'shared head\nold middle\nshared tail\n';
  const postContent = 'shared head\nnew middle\nshared tail\n';
  const harness = createAcceptHarness({ preContent, postContent });

  const result = await harness.router.acceptTrackedChanges({
    expectedFiles: [{ path: harness.path, content: preContent }],
    postFiles: [{ path: harness.path, content: postContent }],
    appliedOperations: [
      { type: 'edit', path: harness.path, replaceAll: postContent }
    ]
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(harness.state.writes.length, 1);
  assert.equal(harness.state.writes[0].kind, 'patches', 'replay still goes through the patches path');
  assert.equal(harness.state.editorText, postContent);
  const replayPatch = harness.state.patchWrites[0][0];
  assert.equal(harness.state.patchWrites[0].length, 1, 'a single targeted diff patch');
  assert.ok(replayPatch.from > 0 && replayPatch.to < preContent.length,
    'the diff patch is targeted, not a whole-file range');
});

// --- reject regression -----------------------------------------------------
//
// The reject path still uses orderTrackedChangesForReviewAction (kept) and the
// per-change DOM loop. Reworking acceptTrackedChanges must leave it unchanged.

function makeButton(label) {
  return {
    tagName: 'BUTTON',
    disabled: false,
    _label: label,
    getAttribute(name) {
      return name === 'aria-label' ? this._label : null;
    }
  };
}

function makeChangeNode(id, path, signal) {
  return {
    tagName: 'SPAN',
    _id: id,
    _path: path,
    _signal: signal || 'tracked change insertion',
    getAttribute(name) {
      if (name === 'data-change-id') return this._id;
      if (name === 'data-path') return this._path;
      return null;
    }
  };
}

function buildRejectWorld(specs) {
  const rows = [];
  let live = [];
  function buildRow(spec) {
    const node = makeChangeNode(spec.id, spec.path, spec.signal);
    const controls = [makeButton('Accept change'), makeButton('Reject change')];
    const row = {
      node,
      controls,
      querySelectorAll() { return controls.slice(); }
    };
    node.parentElement = row;
    for (const control of controls) {
      control.parentElement = row;
    }
    return row;
  }
  for (const spec of specs) {
    rows.push(buildRow(spec));
  }
  live = rows.slice();
  return {
    collectElements() {
      const nodes = [];
      for (const row of live) {
        nodes.push(row.node);
        for (const control of row.controls) {
          nodes.push(control);
        }
      }
      return nodes;
    },
    resolveChange(id) {
      live = live.filter(row => row.node._id !== id);
    }
  };
}

test('rejectTrackedChanges still processes refs in reverse order (orderTrackedChangesForReviewAction kept)', async () => {
  const world = buildRejectWorld([
    { id: 'change-1', path: 'main.tex' },
    { id: 'change-2', path: 'main.tex' },
    { id: 'change-3', path: 'main.tex' }
  ]);
  const clicks = [];
  const router = writebackRouter.create({
    compileBridge: { markSourceEdited() {} },
    normalizeSafeProjectPath: projectFiles.normalizeSafeProjectPath,
    collectElements: world.collectElements,
    readNodeSignalText: node => (node?.tagName === 'BUTTON' ? node._label : node._signal) || '',
    isInsideCodexPanel: () => false,
    clickNode(node) {
      clicks.push(node);
      const row = node?.parentElement;
      if (row && row.node) {
        world.resolveChange(row.node._id);
      }
    },
    delay: () => Promise.resolve(),
    treeOperations: {
      getActiveFilePath: () => 'main.tex',
      openFileByPath: () => Promise.resolve({ ok: true })
    },
    window: { setTimeout, clearTimeout }
  });

  const result = await router.rejectTrackedChanges({
    trackedChanges: [
      { key: 'id:change-1', id: 'change-1', path: 'main.tex' },
      { key: 'id:change-2', id: 'change-2', path: 'main.tex' },
      { key: 'id:change-3', id: 'change-3', path: 'main.tex' }
    ]
  });

  assert.equal(result.applied.length, 3);
  const clickedRowIds = clicks.map(node => node.parentElement.node._id);
  assert.deepEqual(clickedRowIds, ['change-3', 'change-2', 'change-1']);
  for (const click of clicks) {
    assert.match(click._label, /reject/i);
  }
  assert.equal(result.applied[0].result.method, 'overleaf-review-reject');
  assert.equal(result.applied[0].trackedChange.key, 'id:change-3');
  assert.equal(result.applied[2].trackedChange.key, 'id:change-1');
});
