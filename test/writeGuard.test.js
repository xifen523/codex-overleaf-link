const assert = require('node:assert/strict');
const test = require('node:test');

const writeGuard = require('../extension/src/page/writeGuard');

// ---------------------------------------------------------------------------
// Direct unit tests for the page-side write-guard module that was extracted
// from pageBridge.js for the v1.3.9 budget refactor. The integration paths
// (page-bridge dispatch wiring + harness-driven happy/abort branches) stay
// covered by test/pageBridgeStaleGuard.test.js; these tests pin the module
// surface so future refactors of the guard can rely on the contract.
// ---------------------------------------------------------------------------

function buildEnv({ ideProjectId, dataProjectId, urlProjectId } = {}) {
  const win = {
    _ide: ideProjectId === undefined
      ? undefined
      : { project: ideProjectId === null ? null : { _id: ideProjectId } }
  };
  const doc = {
    querySelector(selector) {
      if (selector === '[data-project-id]' && dataProjectId) {
        return { getAttribute: name => (name === 'data-project-id' ? dataProjectId : null) };
      }
      return null;
    }
  };
  const treeOperations = {
    getProjectId() { return urlProjectId || null; }
  };
  return { window: win, document: doc, treeOperations };
}

test('writeGuard.create returns the documented surface', () => {
  const guard = writeGuard.create({});
  assert.equal(typeof guard.runWriteGuard, 'function');
  assert.equal(typeof guard.abortDispatchResult, 'function');
  assert.equal(typeof guard.getEditorProjectIdPageSide, 'function');
  assert.deepEqual(guard.WRITE_GUARD_HYDRATION_RETRY_MS, [100, 300, 700]);
});

test('getEditorProjectIdPageSide prefers _ide.project._id when available', () => {
  const guard = writeGuard.create(buildEnv({ ideProjectId: 'projA' }));
  assert.equal(guard.getEditorProjectIdPageSide(), 'projA');
});

test('getEditorProjectIdPageSide falls back to [data-project-id] when _ide is unhydrated', () => {
  const guard = writeGuard.create(buildEnv({ dataProjectId: 'projB' }));
  assert.equal(guard.getEditorProjectIdPageSide(), 'projB');
});

test('getEditorProjectIdPageSide only accepts the URL fallback when it matches the expected run id', () => {
  const guard = writeGuard.create(buildEnv({ urlProjectId: 'projC' }));
  // Matching expectation → URL is accepted.
  assert.equal(guard.getEditorProjectIdPageSide('projC'), 'projC');
  // Mismatching expectation → URL is rejected; guard fails closed.
  assert.equal(guard.getEditorProjectIdPageSide('different'), null);
  // No expectation → URL is rejected (SPA-navigation safety per the comment
  // block in the source).
  assert.equal(guard.getEditorProjectIdPageSide(''), null);
});

test('runWriteGuard returns null (pass) when editorId matches runProjectId', async () => {
  const guard = writeGuard.create(buildEnv({ ideProjectId: 'projA' }));
  const result = await guard.runWriteGuard({ runProjectId: 'projA' });
  assert.equal(result, null);
});

test('runWriteGuard aborts with aborted_project_changed when editorId differs from runProjectId', async () => {
  const guard = writeGuard.create(buildEnv({ ideProjectId: 'editorPID' }));
  const result = await guard.runWriteGuard({ runProjectId: 'differentPID' });
  assert.equal(result.ok, false);
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 1);
  const skip = result.skipped[0];
  assert.deepEqual(skip.operation, {});  // not null — empty object placeholder
  assert.equal(skip.result.failure.code, 'aborted_project_changed');
  assert.equal(skip.result.failure.stage, 'write');
  assert.equal(skip.result.failure.severity, 'blocked');
  assert.equal(skip.result.failure.terminalState, 'blocked');
  assert.deepEqual(skip.result.failure.evidence, { runProjectId: 'differentPID', editorProjectId: 'editorPID' });
});

test('runWriteGuard aborts with editor_project_id_unavailable when no source can prove the project', async () => {
  // No _ide.project, no [data-project-id], no URL — guard exhausts retries
  // (using a fast sleep stub) and fails closed.
  const env = buildEnv({});
  let sleepCount = 0;
  const guard = writeGuard.create({
    ...env,
    sleep: () => { sleepCount++; return Promise.resolve(); }
  });
  const result = await guard.runWriteGuard({ runProjectId: 'projA' });
  assert.equal(result.ok, false);
  assert.equal(result.skipped[0].result.failure.code, 'editor_project_id_unavailable');
  // Retry budget is 3 sleeps (100/300/700 ms).
  assert.equal(sleepCount, 3);
});

test('runWriteGuard hydration retry: editorId arrives mid-retry → guard passes', async () => {
  let callCount = 0;
  const win = {
    get _ide() {
      callCount++;
      // First 2 reads return undefined (unhydrated); third+ returns the id.
      if (callCount >= 3) return { project: { _id: 'hydratedPID' } };
      return undefined;
    }
  };
  const guard = writeGuard.create({
    window: win,
    document: { querySelector: () => null },
    sleep: () => Promise.resolve()  // fast retry for the test
  });
  const result = await guard.runWriteGuard({ runProjectId: 'hydratedPID' });
  assert.equal(result, null, 'guard must pass once hydration arrives');
});

test('runWriteGuard mismatch short-circuits without retry (editor already hydrated to a different project)', async () => {
  let sleepCount = 0;
  const guard = writeGuard.create({
    ...buildEnv({ ideProjectId: 'differentPID' }),
    sleep: () => { sleepCount++; return Promise.resolve(); }
  });
  const result = await guard.runWriteGuard({ runProjectId: 'runPID' });
  assert.equal(result.skipped[0].result.failure.code, 'aborted_project_changed');
  // No retry — mismatch is not a hydration race.
  assert.equal(sleepCount, 0);
});

test('abortDispatchResult shape: structured FailureReason with userMessage + nextAction', () => {
  const guard = writeGuard.create({});
  const result = guard.abortDispatchResult('editor_project_id_unavailable', 'runPID', null);
  assert.equal(result.ok, false);
  assert.deepEqual(result.applied, []);
  assert.equal(result.skipped.length, 1);
  const failure = result.skipped[0].result.failure;
  assert.equal(failure.code, 'editor_project_id_unavailable');
  assert.equal(failure.stage, 'write');
  assert.equal(failure.severity, 'blocked');
  assert.equal(failure.terminalState, 'blocked');
  assert.equal(failure.retryable, true);
  assert.equal(failure.changedDocument, false);
  assert.match(failure.userMessage, /could not confirm which Overleaf project/);
  assert.match(failure.nextAction, /Refresh Overleaf and retry/);
});
