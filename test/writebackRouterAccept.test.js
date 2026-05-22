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
  for (const spec of specs) {
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
    rows.push(row);
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

test('acceptTrackedChanges skips a missing node with the node-not-found reason code', async () => {
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

  assert.equal(result.ok, false);
  assert.equal(result.applied.length, 1);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].result.code, 'tracked_change_not_found');
  assert.equal(result.skipped[0].trackedChange.key, 'id:change-missing');
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

test('acceptTrackedChanges skips when the change does not resolve after clicking Accept', async () => {
  const world = buildReviewWorld([
    { id: 'change-1', path: 'main.tex' }
  ]);
  // Override clickNode so the click does not resolve the change.
  const { router, clicks } = createRouter(world, {
    activePath: 'main.tex',
    depOverrides: {
      clickNode(node) {
        // Intentionally do nothing — the change stays live.
        clicks.push?.(node);
      }
    }
  });

  const result = await router.acceptTrackedChanges({
    trackedChanges: [
      { key: 'id:change-1', id: 'change-1', path: 'main.tex' }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].result.code, 'tracked_change_accept_not_confirmed');
});

test('acceptTrackedChanges touches only the explicit refs and never sweeps other changes', async () => {
  const world = buildReviewWorld([
    { id: 'change-1', path: 'main.tex' },
    { id: 'change-2', path: 'main.tex' },
    { id: 'change-3-other', path: 'main.tex' }
  ]);
  const { router, clicks } = createRouter(world, { activePath: 'main.tex' });

  const result = await router.acceptTrackedChanges({
    trackedChanges: [
      { key: 'id:change-1', id: 'change-1', path: 'main.tex' },
      { key: 'id:change-2', id: 'change-2', path: 'main.tex' }
    ]
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.applied.length, 2);
  assert.equal(clicks.length, 2, 'only the two explicit refs are clicked');
  // The unrelated change-3-other is still live (never accepted).
  assert.ok(world.rowFor('change-3-other'));
  const stillThere = world.collectElements('*', 100)
    .some(node => node._id === 'change-3-other');
  assert.equal(stillThere, true, 'a non-ref tracked change is left untouched');
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
  assert.deepEqual(opened, ['other.tex']);
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
