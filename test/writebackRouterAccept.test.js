const assert = require('node:assert/strict');
const test = require('node:test');

const projectFiles = require('../extension/src/shared/projectFiles');
const writebackRouter = require('../extension/src/page/writebackRouter');

// --- Minimal fake Overleaf review DOM -------------------------------------
//
// A review entry is a "row" element that contains the tracked-change node and
// its Accept / Reject control buttons. The tracked-change node carries a
// data-change-id (so readTrackedChangeId returns truthy) and a data-path.
// Control buttons are <button> elements whose signal text is "Accept" /
// "Reject" so isTrackedChangeNode excludes them but the control predicates
// match them.

function makeButton(label) {
  return {
    tagName: 'BUTTON',
    disabled: false,
    _label: label,
    getAttribute(name) {
      if (name === 'aria-label') return this._label;
      return null;
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

// Build a review world: one row per change, each row holding the change node
// plus (optionally) Accept and Reject control buttons. resolveChange() removes
// a change from the live world to simulate Overleaf resolving the entry.
function buildReviewWorld(specs) {
  const rows = [];
  let live = [];
  function buildRow(spec) {
    const node = makeChangeNode(spec.id, spec.path, spec.signal);
    const controls = [];
    if (spec.accept !== false) controls.push(makeButton('Accept change'));
    if (spec.reject !== false) controls.push(makeButton('Reject change'));
    const row = {
      node,
      controls,
      querySelectorAll() {
        return controls.slice();
      }
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
    collectElements(selector, _limit) {
      // Return every node in the live world (both change nodes and controls);
      // the router filters by isTrackedChangeNode itself.
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
    },
    appendChange(spec) {
      const row = buildRow(spec);
      rows.push(row);
      live.push(row);
      return row;
    },
    rowFor(id) {
      return rows.find(row => row.node._id === id) || null;
    }
  };
}

function readNodeSignalText(node) {
  if (!node) return '';
  if (node.tagName === 'BUTTON') return node._label || '';
  return node._signal || '';
}

function createRouter(world, extra = {}) {
  const clicks = [];
  const router = writebackRouter.create({
    compileBridge: { markSourceEdited() { extra.onMarkSourceEdited?.(); } },
    normalizeSafeProjectPath: projectFiles.normalizeSafeProjectPath,
    collectElements: world.collectElements,
    readNodeSignalText,
    isInsideCodexPanel: () => false,
    clickNode(node) {
      clicks.push(node);
      // Clicking an Accept/Reject control resolves that row's change.
      const row = node?.parentElement;
      if (row && row.node) {
        world.resolveChange(row.node._id);
      }
    },
    delay: () => Promise.resolve(),
    treeOperations: {
      getActiveFilePath: () => extra.activePath || '',
      openFileByPath(path) {
        extra.onOpen?.(path);
        return Promise.resolve({ ok: true, method: 'dom-click' });
      }
    },
    window: { setTimeout, clearTimeout },
    ...extra.depOverrides
  });
  return { router, clicks };
}

// --- acceptTrackedChanges --------------------------------------------------

test('acceptTrackedChanges finds each ref, clicks Accept, verifies, returns applied', async () => {
  const world = buildReviewWorld([
    { id: 'change-1', path: 'main.tex' },
    { id: 'change-2', path: 'main.tex' }
  ]);
  let marked = false;
  const { router, clicks } = createRouter(world, {
    activePath: 'main.tex',
    onMarkSourceEdited: () => { marked = true; }
  });

  const result = await router.acceptTrackedChanges({
    trackedChanges: [
      { key: 'id:change-1', id: 'change-1', path: 'main.tex' },
      { key: 'id:change-2', id: 'change-2', path: 'main.tex' }
    ]
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.applied.length, 2);
  assert.equal(result.skipped.length, 0);
  assert.equal(clicks.length, 2);
  for (const click of clicks) {
    assert.equal(click.tagName, 'BUTTON');
    assert.match(click._label, /accept/i);
  }
  assert.equal(result.applied[0].result.ok, true);
  assert.equal(result.applied[0].result.method, 'overleaf-review-accept');
  assert.equal(marked, true);
});

test('acceptTrackedChanges does not error on a missing path-bearing ref; the per-file sweep completes the run', async () => {
  // Mirroring the reject path: a ref that names a file path but is not found in
  // the DOM is silently skipped in the per-node loop (Overleaf may have already
  // re-rendered or coalesced it). The per-file sweep then accepts whatever the
  // run file actually still has, so the run completes without a spurious skip.
  const world = buildReviewWorld([
    { id: 'change-1', path: 'main.tex' }
  ]);
  const { router } = createRouter(world, { activePath: 'main.tex' });

  const result = await router.acceptTrackedChanges({
    trackedChanges: [
      { key: 'id:change-1', id: 'change-1', path: 'main.tex' },
      { key: 'id:change-missing', id: 'change-missing', path: 'main.tex' }
    ]
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].trackedChange.key, 'id:change-1');
  assert.equal(result.skipped.length, 0, 'a missing path-bearing ref is skipped silently, not as an error');
  const leftover = world.collectElements('*', 100).some(node => node._id);
  assert.equal(leftover, false, 'nothing is left live in the run file');
});

test('acceptTrackedChanges skips a node with no accept control with the distinct control reason code', async () => {
  const world = buildReviewWorld([
    { id: 'change-1', path: 'main.tex', accept: false }
  ]);
  const { router, clicks } = createRouter(world, { activePath: 'main.tex' });

  const result = await router.acceptTrackedChanges({
    trackedChanges: [
      { key: 'id:change-1', id: 'change-1', path: 'main.tex' }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].result.code, 'tracked_change_accept_control_not_found');
  assert.notEqual(result.skipped[0].result.code, 'tracked_change_not_found');
  assert.equal(clicks.length, 0);
});

test('acceptTrackedChanges stops with a max-iterations safety code when a change never resolves', async () => {
  // Mirroring the reject sweep's bounded loop: if a tracked-change node keeps
  // re-appearing after its Accept control is clicked (it never resolves), the
  // per-file sweep must not spin forever — it stops at maxAttempts and reports
  // a clear safety code rather than silently leaving the run half-applied.
  let editorText = 0;
  const world = buildReviewWorld([
    { id: 'change-1', path: 'main.tex' }
  ]);
  const { router } = createRouter(world, {
    activePath: 'main.tex',
    depOverrides: {
      // The click never removes the change from the live world, so the sweep
      // keeps finding it. A fresh editor-text reading each call lets the
      // progress wait return immediately, keeping the bounded loop fast.
      clickNode() {},
      readActiveEditorText() {
        editorText += 1;
        return `editor-${editorText}`;
      }
    }
  });

  const result = await router.acceptTrackedChanges({
    trackedChanges: [
      { key: 'id:change-1', id: 'change-1', path: 'main.tex' }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].trackedChange, null, 'the sweep failure carries no single ref');
  assert.equal(result.skipped[0].result.code, 'tracked_change_undo_max_iterations');
});

test('acceptTrackedChanges sweeps remaining tracked changes in the run files after the per-node loop', async () => {
  // change-3-extra lives in main.tex (a run file) but is NOT an explicit ref.
  // Mirroring the reject sweep, the per-file sweep after the per-node loop must
  // accept it too, so one click decisively accepts everything in the run files.
  const world = buildReviewWorld([
    { id: 'change-1', path: 'main.tex' },
    { id: 'change-2', path: 'main.tex' },
    { id: 'change-3-extra', path: 'main.tex' }
  ]);
  const { router, clicks } = createRouter(world, { activePath: 'main.tex' });

  const result = await router.acceptTrackedChanges({
    trackedChanges: [
      { key: 'id:change-1', id: 'change-1', path: 'main.tex' },
      { key: 'id:change-2', id: 'change-2', path: 'main.tex' }
    ]
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  // 2 explicit refs + 1 swept = 3 accepted, all clicks are Accept controls.
  assert.equal(clicks.length, 3);
  for (const click of clicks) {
    assert.match(click._label, /accept/i);
  }
  assert.equal(result.applied.length, 3);
  assert.equal(result.skipped.length, 0);
  // No tracked-change node is left live in the run file.
  const leftover = world.collectElements('*', 100).some(node => node._id);
  assert.equal(leftover, false, 'the sweep accepts every remaining tracked change');
  const sweptKeys = result.applied.map(entry => entry.trackedChange.key);
  assert.ok(sweptKeys.includes('id:change-3-extra'), 'the non-ref change was swept');
});

test('acceptTrackedChanges only sweeps within the run files, not unrelated files', async () => {
  const world = buildReviewWorld([
    { id: 'change-1', path: 'main.tex' },
    { id: 'change-2-other-file', path: 'appendix.tex' }
  ]);
  const { router, clicks } = createRouter(world, { activePath: 'main.tex' });

  const result = await router.acceptTrackedChanges({
    trackedChanges: [
      { key: 'id:change-1', id: 'change-1', path: 'main.tex' }
    ]
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(clicks.length, 1, 'only main.tex is swept');
  // The change in appendix.tex (not a run file) is untouched.
  const stillThere = world.collectElements('*', 100)
    .some(node => node._id === 'change-2-other-file');
  assert.equal(stillThere, true, 'a tracked change in a non-run file is left untouched');
});

test('acceptTrackedChanges fully accepts a run whose nodes shift/re-render between clicks', async () => {
  // Simulate Overleaf re-rendering the review panel: after the per-node loop
  // resolves the explicit refs, a fresh tracked-change node appears in the run
  // file (a node that re-rendered with a new id). The per-file sweep, which
  // re-queries the DOM each iteration, must still accept it so nothing leaks.
  const world = buildReviewWorld([
    { id: 'change-1', path: 'main.tex' },
    { id: 'change-2', path: 'main.tex' }
  ]);
  const { router, clicks } = createRouter(world, {
    activePath: 'main.tex',
    depOverrides: {
      clickNode(node) {
        clicks.push(node);
        const row = node?.parentElement;
        if (!row || !row.node) {
          return;
        }
        const resolvedId = row.node._id;
        world.resolveChange(resolvedId);
        // After the last explicit ref resolves, the panel re-renders a leftover
        // tracked change under a brand-new id the run never explicitly listed.
        if (resolvedId === 'change-2') {
          world.appendChange({ id: 'change-rerendered', path: 'main.tex' });
        }
      }
    }
  });

  const result = await router.acceptTrackedChanges({
    trackedChanges: [
      { key: 'id:change-1', id: 'change-1', path: 'main.tex' },
      { key: 'id:change-2', id: 'change-2', path: 'main.tex' }
    ]
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  const leftover = world.collectElements('*', 100).some(node => node._id);
  assert.equal(leftover, false, 'no tracked change leaks after a re-render');
  assert.equal(clicks.length, 3, 'two refs plus the re-rendered node');
});

test('acceptTrackedChanges opens the ref file when it is not active', async () => {
  const world = buildReviewWorld([
    { id: 'change-1', path: 'other.tex' }
  ]);
  const opened = [];
  const { router } = createRouter(world, {
    activePath: 'main.tex',
    onOpen: path => opened.push(path)
  });

  const result = await router.acceptTrackedChanges({
    trackedChanges: [
      { key: 'id:change-1', id: 'change-1', path: 'other.tex' }
    ]
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  // The per-node loop opens the ref file; the per-file sweep (mirroring reject)
  // re-opens it as well since the test's active path stays static. Either way,
  // only the run's file is ever opened — never an unrelated file.
  assert.ok(opened.length >= 1, 'the ref file is opened at least once');
  assert.ok(opened.every(path => path === 'other.tex'), 'only the run file is opened');
});

test('acceptTrackedChanges rejects an invalid tracked-change path', async () => {
  const world = buildReviewWorld([]);
  const { router } = createRouter(world, { activePath: 'main.tex' });

  const result = await router.acceptTrackedChanges({
    trackedChanges: [
      { key: 'id:change-1', id: 'change-1', path: '../escape.tex' }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].result.code, 'invalid_project_path');
});

// --- reject regression -----------------------------------------------------
//
// Generalizing orderTrackedChangesForReject -> orderTrackedChangesForReviewAction
// must leave rejectTrackedChanges' ordering and behavior unchanged. The reject
// node loop processes refs in reversed order; assert that order is preserved.

test('rejectTrackedChanges still processes refs in reverse order after the helper rename', async () => {
  const world = buildReviewWorld([
    { id: 'change-1', path: 'main.tex' },
    { id: 'change-2', path: 'main.tex' },
    { id: 'change-3', path: 'main.tex' }
  ]);
  const { router, clicks } = createRouter(world, { activePath: 'main.tex' });

  const result = await router.rejectTrackedChanges({
    trackedChanges: [
      { key: 'id:change-1', id: 'change-1', path: 'main.tex' },
      { key: 'id:change-2', id: 'change-2', path: 'main.tex' },
      { key: 'id:change-3', id: 'change-3', path: 'main.tex' }
    ]
  });

  // The per-node loop accepts/rejects each explicit ref; the trailing path
  // sweep is pre-existing reject-only behavior. The rename of
  // orderTrackedChangesForReject -> orderTrackedChangesForReviewAction must
  // leave the per-node loop's clicked order and applied entries unchanged.
  assert.equal(result.applied.length, 3);
  // Reject control buttons clicked, in reversed ref order: change-3, 2, 1.
  const clickedRowIds = clicks.map(node => node.parentElement.node._id);
  assert.deepEqual(clickedRowIds, ['change-3', 'change-2', 'change-1']);
  for (const click of clicks) {
    assert.match(click._label, /reject/i);
  }
  assert.equal(result.applied[0].result.method, 'overleaf-review-reject');
  assert.equal(result.applied[0].trackedChange.key, 'id:change-3');
  assert.equal(result.applied[2].trackedChange.key, 'id:change-1');
});
