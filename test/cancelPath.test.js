const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('background sends codex.cancel without waiting for a native response', () => {
  const background = fs.readFileSync(
    path.join(__dirname, '../extension/src/background.js'),
    'utf8'
  );

  assert.match(background, /payload\?\.method === 'codex\.cancel'/);
  assert.match(background, /sendNativeCancel\(message\.payload\)/);
  assert.match(background, /sent:\s*true/);
  assert.doesNotMatch(background, /pending\.set\(id,[\s\S]*?codex\.cancel/);
});

test('native host processes decoded messages concurrently so cancel is not queued behind codex.run', () => {
  const index = fs.readFileSync(
    path.join(__dirname, '../native-host/src/index.js'),
    'utf8'
  );
  const dataHandler = index.match(/process\.stdin\.on\('data'[\s\S]*?\n\}\);/)?.[0] || '';

  assert.match(index, /function handleDecodedMessage\(/);
  assert.match(dataHandler, /handleDecodedMessage\(message\)/);
  assert.doesNotMatch(dataHandler, /await handleRequest/);
});
