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
