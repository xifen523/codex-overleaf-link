const assert = require('node:assert/strict');
const test = require('node:test');

const { extractFunction } = require('./_helpers/extractFunction');

test('extracts a plain sync function body in its entirety', () => {
  const src = `
    function plain(input) {
      const x = 1;
      return x + input;
    }
  `;
  const extracted = extractFunction(src, 'plain');
  assert.match(extracted, /^function plain\(input\)/);
  assert.match(extracted, /return x \+ input;\s*}$/);
});

test('extracts an async function', () => {
  const src = `
    async function asyncFn(a, b) {
      await Promise.resolve();
      return a + b;
    }
  `;
  const extracted = extractFunction(src, 'asyncFn');
  assert.match(extracted, /^async function asyncFn\(a, b\)/);
  assert.match(extracted, /return a \+ b;\s*}$/);
});

test('default-value brace in signature does NOT prematurely terminate extraction (regression for the v1.3.8 bug)', () => {
  // This is the exact shape that bit us three times before consolidating
  // the helper. The default-value `{}` MUST NOT be mistaken for the body
  // opening brace.
  const src = `
    function withDefaults(input = {}, options = {}) {
      const path = input.path || '';
      const type = input.type || '';
      return { path, type };
    }
  `;
  const extracted = extractFunction(src, 'withDefaults');
  assert.match(extracted, /^function withDefaults\(input = \{\}, options = \{\}\)/);
  // Must include the real body — not just the signature.
  assert.match(extracted, /const path = input\.path/);
  assert.match(extracted, /return \{ path, type \};/);
});

test('nested parens in signature (function-type annotations) are walked correctly', () => {
  // Defensive: paren-depth tracking must handle nested parens in the signature.
  const src = `
    function nested(callback = (x => x), other = {}) {
      return callback(other);
    }
  `;
  const extracted = extractFunction(src, 'nested');
  assert.match(extracted, /^function nested\(callback = \(x => x\), other = \{\}\)/);
  assert.match(extracted, /return callback\(other\);/);
});

test('nested braces in body do not terminate early', () => {
  const src = `
    function nestedBody() {
      const obj = { nested: { deep: true } };
      if (obj.nested) {
        return obj.nested.deep;
      }
      return false;
    }
  `;
  const extracted = extractFunction(src, 'nestedBody');
  assert.match(extracted, /return false;\s*}$/);
  // The whole body, including the deep object literal.
  assert.match(extracted, /\{ nested: \{ deep: true \} \}/);
});

test('throws when the named function does not exist', () => {
  const src = 'function other() { return 1; }';
  assert.throws(() => extractFunction(src, 'missing'), /missing should exist/);
});

test('picks the earliest match when both sync and async variants exist for the same name', () => {
  // Pathological case but the helper's sort-by-index is defensive.
  const src = `
    async function dup() { return 'async'; }
    function dup() { return 'sync'; }
  `;
  const extracted = extractFunction(src, 'dup');
  assert.match(extracted, /^async function dup/);
});
