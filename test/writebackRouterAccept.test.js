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
    if (!state.reviewing) {
      return Promise.resolve({ ok: true, activated: false });
    }
    if (spec.editingFails) {
      return Promise.resolve({
        ok: false,
        code: 'editing_not_confirmed',
        reason: 'Editing mode could not be confirmed.'
      });
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
    state.reviewing = enabled;
    if (enabled) {
      state.reviewingRestores += 1;
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
      state.writes.push(String(text));
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
  const harness = createAcceptHarness({
    preContent: 'before\n',
    postContent: 'after the edit\n'
  });

  const result = await harness.router.acceptTrackedChanges({
    expectedFiles: [{ path: harness.path, content: harness.preContent }],
    postFiles: [{ path: harness.path, content: harness.postContent }]
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  // The editor-undo ran (the writeback was reverted before the replay).
  assert.ok(harness.state.undoClicks >= 1, 'the run writeback was editor-undone');
  // The post-write content was re-applied as a plain edit.
  assert.deepEqual(harness.state.writes, ['after the edit\n']);
  assert.equal(harness.state.editorText, 'after the edit\n');
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
  assert.deepEqual(harness.state.writes, ['after\n']);
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
      state.writes.push({ path: state.activePath, text: String(text) });
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
  // Each file was replayed as a plain edit.
  assert.equal(state.writes.length, 2);
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
