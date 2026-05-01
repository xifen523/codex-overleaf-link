const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('normal state refresh writes user-facing status instead of raw probe diagnostics', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const refreshProbeBody = contentScript.match(/async function refreshProbe\(options = \{\}\) \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.match(refreshProbeBody, /appendProbeUserStatus\(probe\)/);
  assert.doesNotMatch(refreshProbeBody, /appendEditorDiagnostics/);
  assert.doesNotMatch(refreshProbeBody, /appendReviewingDiagnostics/);
  assert.doesNotMatch(refreshProbeBody, /State:/);
  assert.match(contentScript, /function formatProbeStatusBar\(/);
  assert.match(contentScript, /function appendProbeUserStatus\(/);
  assert.match(contentScript, /还不能安全写入/);
});

test('probe status copy describes the next user action without internal editor wording', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );

  assert.match(contentScript, /Codex 没读到当前文件/);
  assert.match(contentScript, /左侧文件列表点开要处理的 \.tex 文件/);
  assert.doesNotMatch(contentScript, /状态部分可用/);
  assert.doesNotMatch(contentScript, /识别当前编辑器/);
  assert.doesNotMatch(contentScript, /已连接编辑器/);
  assert.doesNotMatch(contentScript, /未识别编辑器/);
});

test('probe notice is replaced instead of leaving stale readiness messages in the task log', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );

  assert.match(contentScript, /function updateProbeNotice\(/);
  assert.match(contentScript, /querySelector\('\[data-probe-notice\]'\)/);
  assert.match(contentScript, /item\.dataset\.probeNotice = 'true'/);
  assert.match(contentScript, /updateProbeNotice\(ready \? '' : message\)/);
});

test('quiet probe refresh updates an existing notice so the main task area cannot contradict the footer', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const refreshProbeBody = contentScript.match(/async function refreshProbe\(options = \{\}\) \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.match(refreshProbeBody, /updateExistingProbeNotice\(probe\)/);
  assert.match(contentScript, /function updateExistingProbeNotice\(probe\)/);
});

test('normal task flow logs a user-facing project read summary', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const runTaskBody = contentScript.match(/async function runTask\(\) \{[\s\S]*?\n  async function handleTaskResult/)?.[0] || '';

  assert.match(runTaskBody, /appendLog\(formatProjectSnapshotUserLog\(project\)\)/);
  assert.match(contentScript, /function formatProjectSnapshotUserLog\(/);
  assert.match(contentScript, /已读取 Overleaf 项目/);
});
