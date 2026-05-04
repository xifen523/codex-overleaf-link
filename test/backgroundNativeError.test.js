const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('background resolves active requests when native reports a framing error without an id', () => {
  const background = fs.readFileSync(
    path.join(__dirname, '../extension/src/background.js'),
    'utf8'
  );

  assert.match(background, /resolveUnmatchedNativeError/);
  assert.match(background, /message\?\.ok === false/);
  assert.match(background, /pending\.size === 1/);
  assert.match(background, /pendingRequest\.resolve\(\{\s*\.\.\.message,\s*id:\s*pendingId\s*\}\)/);
});

test('background validates Overleaf senders before forwarding native requests', () => {
  const background = fs.readFileSync(
    path.join(__dirname, '../extension/src/background.js'),
    'utf8'
  );

  assert.match(background, /function isAllowedOverleafSender\(/);
  assert.match(background, /chrome\.runtime\.getURL\(''\)/);
  assert.match(background, /sender\?\.id === chrome\.runtime\.id/);
  assert.match(background, /sender\.tab\?\.url/);
  assert.match(background, /www\.overleaf\.com/);
  assert.match(background, /forbidden_sender/);
});

test('background rejects ambiguous unmatched native errors without corrupting all pending requests', () => {
  const background = fs.readFileSync(
    path.join(__dirname, '../extension/src/background.js'),
    'utf8'
  );

  assert.match(background, /ambiguous_native_error/);
  assert.doesNotMatch(background, /for \(const \[pendingId, pendingRequest\] of pending\.entries\(\)\)/);
});
