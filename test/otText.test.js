const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const {
  applyTextOps,
  validateTextOp,
  diffToTextOps,
  normalizeObservedTextEvent,
  hashText
} = require('../extension/src/shared/otText');

test('applies insert and delete operations in order', () => {
  const result = applyTextOps('old text', [
    { p: 3, i: 'er' },
    { p: 6, d: 'text' },
    { p: 6, i: 'copy' }
  ]);

  assert.deepEqual(result, {
    ok: true,
    text: 'older copy'
  });
});

test('preserves exact text when applying no operations', () => {
  assert.deepEqual(applyTextOps('line one\r\nline two', []), {
    ok: true,
    text: 'line one\r\nline two'
  });
});

test('rejects delete operations when expected text does not match', () => {
  const result = applyTextOps('old text', [
    { p: 4, d: 'copy' }
  ]);

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'delete_mismatch');
  assert.match(result.message, /Delete text did not match/);
});

test('rejects invalid positions and unknown operation fields', () => {
  assert.deepEqual(validateTextOp({ p: -1, i: 'x' }, 'old'), {
    ok: false,
    reason: 'invalid_position'
  });
  assert.deepEqual(validateTextOp({ p: 1, i: 'x', extra: true }, 'old'), {
    ok: false,
    reason: 'unknown_field'
  });
  assert.deepEqual(validateTextOp({ p: 4, i: 'x' }, 'old'), {
    ok: false,
    reason: 'invalid_position'
  });
});

test('diffs old and new content into compact single-span operations', () => {
  const oldText = 'alpha beta gamma';
  const nextText = 'alpha delta gamma';

  const ops = diffToTextOps(oldText, nextText);
  const applied = applyTextOps(oldText, ops);

  assert.deepEqual(ops, [
    { p: 6, d: 'be' },
    { p: 6, i: 'del' }
  ]);
  assert.deepEqual(applied, {
    ok: true,
    text: nextText
  });
});

test('normalizes observed text events with hashes, fields, and operations', () => {
  const event = normalizeObservedTextEvent({
    path: ' /main.tex ',
    previousContent: 'old body',
    nextContent: 'old new body',
    observedAt: '2026-05-05T08:00:00.000Z',
    observedVersion: '42',
    source: {
      name: 'overleaf',
      content: 'sensitive source body'
    }
  });

  assert.equal(event.ok, true);
  assert.equal(event.path, 'main.tex');
  assert.equal(event.previousContent, 'old body');
  assert.equal(event.nextContent, 'old new body');
  assert.equal(event.observedAt, '2026-05-05T08:00:00.000Z');
  assert.equal(event.observedVersion, '42');
  assert.deepEqual(event.source, { name: 'overleaf' });
  assert.equal(event.baseHash, hashText('old body'));
  assert.equal(event.nextHash, hashText('old new body'));
  assert.deepEqual(event.ops, [
    { p: 4, i: 'new ' }
  ]);
});

test('normalizing invalid observed text events does not leak source content in errors', () => {
  const result = normalizeObservedTextEvent({
    path: '',
    previousContent: 'old',
    nextContent: 'new',
    source: 'secret source document'
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'missing_path');
  assert.doesNotMatch(JSON.stringify(result), /secret source document/);
});

test('hashes UTF-8 text with standard SHA-256 hex', () => {
  assert.equal(
    hashText('old'),
    'cba06b5736faf67e54b07b561eae94395e774c517a7d910a54369e1263ccfbd4'
  );
});

test('exposes a browser global with a standard SHA-256 fallback', () => {
  const source = fs.readFileSync(path.join(__dirname, '../extension/src/shared/otText.js'), 'utf8');
  const context = {};
  context.window = context;
  context.globalThis = context;

  vm.runInNewContext(source, context);

  assert.equal(typeof context.CodexOverleafOtText.applyTextOps, 'function');
  assert.equal(
    context.CodexOverleafOtText.hashText('old'),
    'cba06b5736faf67e54b07b561eae94395e774c517a7d910a54369e1263ccfbd4'
  );
});
