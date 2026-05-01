const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('content run flow calls codex.run and treats Overleaf writes as final sync changes', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const runTaskBody = contentScript.match(/async function runTask\(\) \{[\s\S]*?\n  async function handleTaskResult/)?.[0] || '';

  assert.match(runTaskBody, /method:\s*'codex\.run'/);
  assert.match(runTaskBody, /getRunProjectSnapshot\(\)/);
  assert.doesNotMatch(runTaskBody, /getProjectSnapshot', \{ force: true \}/);
  assert.match(contentScript, /function applySyncChangesToOverleaf\(/);
  assert.match(contentScript, /syncChanges/);
  assert.doesNotMatch(runTaskBody, /method:\s*'task\.run'/);
  assert.doesNotMatch(runTaskBody, /outputSchema|userReport|operations JSON/);
});

test('native host exposes codex.run as the primary glue-layer method', () => {
  const taskRunner = fs.readFileSync(
    path.join(__dirname, '../native-host/src/taskRunner.js'),
    'utf8'
  );

  assert.match(taskRunner, /request\.method === 'codex\.run'/);
  assert.match(taskRunner, /runCodexSession/);
  assert.match(taskRunner, /syncChanges/);
});
