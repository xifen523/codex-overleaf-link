const assert = require('node:assert/strict');
const test = require('node:test');

const { computeLineDiff } = require('../native-host/src/diffEngine');

test('returns empty hunks for identical content', () => {
  const hunks = computeLineDiff('hello\nworld\n', 'hello\nworld\n');
  assert.deepEqual(hunks, []);
});

test('detects single line addition', () => {
  const hunks = computeLineDiff('a\nb\n', 'a\nb\nc\n');
  assert.equal(hunks.length, 1);
  const lines = hunks[0].lines;
  assert.ok(lines.some(l => l.type === 'add' && l.text === 'c'));
  assert.ok(lines.some(l => l.type === 'context' && l.text === 'b'));
});

test('detects single line removal', () => {
  const hunks = computeLineDiff('a\nb\nc\n', 'a\nc\n');
  assert.equal(hunks.length, 1);
  const lines = hunks[0].lines;
  assert.ok(lines.some(l => l.type === 'remove' && l.text === 'b'));
});

test('detects replacement (remove + add)', () => {
  const hunks = computeLineDiff('old title\nbody\n', 'new title\nbody\n');
  assert.equal(hunks.length, 1);
  const lines = hunks[0].lines;
  assert.ok(lines.some(l => l.type === 'remove' && l.text === 'old title'));
  assert.ok(lines.some(l => l.type === 'add' && l.text === 'new title'));
});

test('provides context lines around changes', () => {
  const old = 'a\nb\nc\nd\ne\nf\ng\n';
  const next = 'a\nb\nc\nD\ne\nf\ng\n';
  const hunks = computeLineDiff(old, next, 2);
  assert.equal(hunks.length, 1);
  const contextLines = hunks[0].lines.filter(l => l.type === 'context');
  assert.ok(contextLines.some(l => l.text === 'b'));
  assert.ok(contextLines.some(l => l.text === 'c'));
  assert.ok(contextLines.some(l => l.text === 'e'));
  assert.ok(contextLines.some(l => l.text === 'f'));
});

test('handles multiple separate hunks', () => {
  const old = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n';
  const next = 'a\nB\nc\nd\ne\nf\ng\nH\ni\nj\n';
  const hunks = computeLineDiff(old, next, 1);
  assert.equal(hunks.length, 2);
});

test('handles empty old content (all additions)', () => {
  const hunks = computeLineDiff('', 'new\ncontent\n');
  assert.equal(hunks.length, 1);
  assert.ok(hunks[0].lines.every(l => l.type === 'add'));
});

test('handles empty new content (all removals)', () => {
  const hunks = computeLineDiff('old\ncontent\n', '');
  assert.equal(hunks.length, 1);
  assert.ok(hunks[0].lines.every(l => l.type === 'remove'));
});
