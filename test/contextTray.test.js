const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('add context button opens a visible Overleaf project file picker', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );

  assert.match(contentScript, /data-add-context[^>]+aria-expanded="false"/);
  assert.match(contentScript, /data-context-tray/);
  assert.match(contentScript, /data-context-summary/);
  assert.match(contentScript, /data-context-file-list/);
  assert.match(contentScript, /data-context-refresh/);
  assert.match(contentScript, /function toggleContextTray\(/);
  assert.match(contentScript, /function isContextTrayClickTarget\(/);
  assert.match(contentScript, /function renderContextFiles\(/);
  assert.match(contentScript, /function selectFocusFile\(/);
  assert.match(contentScript, /function renderContextSummary\(/);
  assert.match(contentScript, /nextFocusFiles/);
  assert.match(contentScript, /data-context-summary-clear/);
  assert.match(contentScript, /清除全部 @file/);
  assert.match(contentScript, /添加 @ 上下文/);
  assert.match(contentScript, /@compile-log/);
  assert.match(contentScript, /@current-section/);
  assert.match(contentScript, /focusFiles: getActiveFocusFiles\(\)/);
  assert.equal(contentScript.includes('Add context uses the active Overleaf project snapshot automatically.'), false);
  assert.match(css, /\.codex-context-tray/);
  assert.match(css, /\.codex-context-tray\s*\{[\s\S]*position: absolute/);
  assert.match(css, /\.codex-composer\s*\{[\s\S]*position: relative/);
  assert.match(css, /\.codex-context-file/);
  assert.match(css, /\.codex-context-file\[data-selected="true"\]/);
  assert.match(css, /\.codex-context-summary/);
  assert.match(css, /\.codex-context-summary-chip/);
  assert.match(css, /\.codex-context-summary-clear/);
  assert.match(css, /\.codex-context-summary:hover \.codex-context-summary-clear/);
});

test('context picker closes when clicking anywhere outside the picker and plus button', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const dismissBody = contentScript.match(/function installContextDismiss\(\) \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.match(dismissBody, /document\.addEventListener\('click'/);
  assert.match(dismissBody, /isContextTrayClickTarget\(event\.target\)/);
  assert.doesNotMatch(dismissBody, /composer\.contains\(event\.target\)/);
});
