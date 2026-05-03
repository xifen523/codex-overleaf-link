const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildBaseFileLookup,
  checkOperationFreshness
} = require('../extension/src/shared/staleGuard');

test('allows edits when current content matches the task-start snapshot', () => {
  const baseFiles = buildBaseFileLookup([
    { path: 'main.tex', content: 'alpha\nbeta' }
  ]);

  const result = checkOperationFreshness(
    { type: 'edit', path: 'main.tex', find: 'beta', replace: 'gamma' },
    'alpha\nbeta',
    baseFiles
  );

  assert.deepEqual(result, { ok: true });
});

test('blocks edits when the Overleaf file changed after the snapshot', () => {
  const baseFiles = buildBaseFileLookup([
    { path: 'main.tex', content: 'alpha\nbeta' }
  ]);

  const result = checkOperationFreshness(
    { type: 'edit', path: 'main.tex', replaceAll: 'alpha\ngamma' },
    'alpha\nuser change',
    baseFiles
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'stale_snapshot');
  assert.match(result.reason, /main\.tex 在任务执行期间被你或协作者改过/);
  assert.match(result.reason, /Codex 没有覆盖它/);
});

test('allows patch edits when collaborator changes are outside the patch range', () => {
  const baseFiles = buildBaseFileLookup([
    { path: 'main.tex', content: 'title\nbody old\nfooter\n' }
  ]);

  const result = checkOperationFreshness(
    {
      type: 'edit',
      path: 'main.tex',
      patches: [
        { from: 11, to: 14, expected: 'old', insert: 'new' }
      ]
    },
    'title\nbody old\nfooter updated by user\n',
    baseFiles
  );

  assert.deepEqual(result, {
    ok: true,
    reconciled: true,
    strategy: 'patch-range'
  });
});

test('blocks patch edits when collaborator changes overlap the patch range', () => {
  const baseFiles = buildBaseFileLookup([
    { path: 'main.tex', content: 'title\nbody old\nfooter\n' }
  ]);

  const result = checkOperationFreshness(
    {
      type: 'edit',
      path: 'main.tex',
      patches: [
        { from: 11, to: 14, expected: 'old', insert: 'new' }
      ]
    },
    'title\nbody user-edited\nfooter\n',
    baseFiles
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'stale_patch_range');
});

test('blocks edits when the base snapshot lacks the target file', () => {
  const baseFiles = buildBaseFileLookup([
    { path: 'main.tex', content: 'alpha' }
  ]);

  const result = checkOperationFreshness(
    { type: 'edit', path: 'appendix.tex', find: 'old', replace: 'new' },
    'old',
    baseFiles
  );

  assert.deepEqual(result, {
    ok: false,
    code: 'missing_base_file',
    reasonKey: 'missingBaseFile',
    reasonParams: { filePath: 'appendix.tex' },
    reason: 'appendix.tex 在任务开始时没有被 Codex 读到。Codex 没有覆盖它；请刷新项目内容后重试。'
  });
});

test('normalizes base and operation paths before freshness checks', () => {
  const baseFiles = buildBaseFileLookup([
    { path: '/sections\\main.tex', content: 'alpha' }
  ]);

  const result = checkOperationFreshness(
    { type: 'edit', path: 'sections/main.tex', replaceAll: 'beta' },
    'alpha',
    baseFiles
  );

  assert.deepEqual(result, { ok: true });
});

test('does not require a base snapshot for unguarded internal applies', () => {
  const result = checkOperationFreshness(
    { type: 'edit', path: 'main.tex', replaceAll: 'restored' },
    'current',
    null
  );

  assert.deepEqual(result, { ok: true });
});

test('does not guard create operations against existing file content', () => {
  const baseFiles = buildBaseFileLookup([
    { path: 'main.tex', content: 'alpha' }
  ]);

  const result = checkOperationFreshness(
    { type: 'create', path: 'new.tex', content: 'hello' },
    '',
    baseFiles
  );

  assert.deepEqual(result, { ok: true });
});
