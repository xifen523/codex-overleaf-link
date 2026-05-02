const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('composer keeps the send button in a fixed visible toolbar column', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );

  assert.match(contentScript, /data-run title="发送" aria-label="发送"/);
  assert.match(css, /\.codex-composer-toolbar\s*\{[\s\S]*display: grid/);
  assert.match(css, /\.codex-composer-toolbar\s*\{[\s\S]*grid-template-columns:/);
  assert.match(css, /\.codex-composer-toolbar \[data-run\]\s*\{[\s\S]*grid-column: 5/);
  assert.match(css, /\.codex-composer-toolbar \[data-run\]\s*\{[\s\S]*width: 28px/);
  assert.match(css, /\.codex-composer-toolbar select\s*\{[\s\S]*min-width: 0/);
});

test('composer sends through a form submit path with a guarded run handler', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );

  assert.match(contentScript, /<form class="codex-composer" data-composer-form>/);
  assert.match(contentScript, /<button type="submit" data-run title="发送" aria-label="发送">↑<\/button>/);
  assert.match(contentScript, /\[data-composer-form\]'\)\.addEventListener\('submit'/);
  assert.match(contentScript, /event\.preventDefault\(\);\s*safeRunTask\(\);/);
  assert.match(contentScript, /requestSubmit\(\)/);
  assert.match(contentScript, /function safeRunTask\(\)/);
  assert.match(contentScript, /runTask\(\)\.catch/);
});

test('composer textarea sends on Enter while preserving Shift Enter and IME composition', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );

  assert.match(contentScript, /\[data-task\]'\)\.addEventListener\('keydown', handleTaskInputKeydown\)/);
  assert.match(contentScript, /function handleTaskInputKeydown\(event\)/);
  assert.match(contentScript, /event\.key !== 'Enter'/);
  assert.match(contentScript, /event\.shiftKey/);
  assert.match(contentScript, /event\.isComposing/);
  assert.match(contentScript, /event\.preventDefault\(\);\s*panel\.querySelector\('\[data-composer-form\]'\)\?\.requestSubmit\(\);/);
  assert.doesNotMatch(contentScript, /event\.key === 'Enter' && \(event\.metaKey \|\| event\.ctrlKey\)/);
});

test('starting a run is not blocked by asynchronous state persistence', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const runTaskBody = contentScript.match(/async function runTask\(\) \{[\s\S]*?\n  async function applySyncChangesToOverleaf/)?.[0] || '';
  const beforeStartRun = runTaskBody.split(/currentRunView = startRunView\(/)[0] || '';

  assert.doesNotMatch(beforeStartRun, /await saveState\(\)/);
  assert.match(runTaskBody, /saveStateSoon\(\)/);
});

test('send button shows a spinner while a Codex run is active', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );

  assert.match(css, /#codex-overleaf-panel\[data-running="true"\] \.codex-composer-toolbar \[data-run\]/);
  assert.match(css, /#codex-overleaf-panel\[data-running="true"\] \.codex-composer-toolbar \[data-run\]::after/);
  assert.match(css, /animation:\s*codex-run-spin/);
  assert.match(css, /@keyframes codex-run-spin/);
});

test('clicking the running spinner requests cancellation instead of being disabled', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const clickHandler = contentScript.match(/\[data-run\]'\)\.addEventListener\('click'[\s\S]*?\n      \}\);/)?.[0] || '';
  const setRunningBody = contentScript.match(/function setRunning\(running\) \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.match(clickHandler, /if \(currentRunView\)/);
  assert.match(clickHandler, /cancelActiveRun\(\)/);
  assert.match(contentScript, /async function cancelActiveRun\(/);
  assert.match(contentScript, /method:\s*'codex\.cancel'/);
  assert.doesNotMatch(setRunningBody, /\[data-run\]'\)\.disabled = running/);
  assert.match(setRunningBody, /aria-label', running \? '中断当前任务' : '发送'/);
});

test('task failures after a user cancellation request render as interrupted', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );

  assert.match(contentScript, /if \(runCancellationRequested \|\| isRunCancellationError\(response\.error\)\)/);
  assert.match(contentScript, /if \(runCancellationRequested \|\| isRunCancellationError\(error\)\)/);
});

test('undo button is visually prominent when a run has reversible writes', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );

  assert.match(contentScript, /撤销改动/);
  assert.match(css, /#codex-overleaf-panel \[data-run-undo\]\s*\{[\s\S]*background:\s*#a14b00/);
  assert.match(css, /#codex-overleaf-panel \[data-run-undo\]\s*\{[\s\S]*border:\s*1px solid #f0883e/);
  assert.match(css, /#codex-overleaf-panel \[data-run-undo\]\s*\{[\s\S]*font-weight:\s*700/);
  assert.match(css, /#codex-overleaf-panel \[data-run-undo\]\s*\{[\s\S]*box-shadow:/);
});
