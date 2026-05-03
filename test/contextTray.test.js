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
  const i18n = fs.readFileSync(
    path.join(__dirname, '../extension/src/shared/i18n.js'),
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
  assert.match(contentScript, /function buildContextTree\(/);
  assert.match(contentScript, /function renderContextTreeNode\(/);
  assert.match(contentScript, /function selectFocusFile\(/);
  assert.match(contentScript, /function renderContextSummary\(/);
  assert.match(contentScript, /nextFocusFiles/);
  assert.match(contentScript, /data-context-summary-clear/);
  assert.match(i18n, /clearFiles:\s*'清除全部 @file'/);
  assert.match(i18n, /addContext:\s*'添加 @ 上下文'/);
  assert.match(contentScript, /@compile-log/);
  assert.match(contentScript, /@current-section/);
  assert.match(contentScript, /focusFiles: getActiveFocusFiles\(\)/);
  assert.equal(contentScript.includes('Add context uses the active Overleaf project snapshot automatically.'), false);
  assert.match(css, /\.codex-context-tray/);
  assert.match(css, /\.codex-context-tray\s*\{[\s\S]*position: absolute/);
  assert.match(css, /\.codex-composer\s*\{[\s\S]*position: relative/);
  assert.match(css, /\.codex-context-file/);
  assert.match(css, /\.codex-context-folder/);
  assert.match(css, /\.codex-context-folder-name/);
  assert.match(css, /\.codex-context-file\[data-selected="true"\]/);
  assert.match(css, /\.codex-context-summary/);
  assert.match(css, /\.codex-context-summary-chip/);
  assert.match(css, /\.codex-context-summary-clear/);
  assert.match(css, /\.codex-context-summary:hover \.codex-context-summary-clear/);
});

test('context picker preserves project folder hierarchy instead of flattening by file type', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );

  const renderContextFilesBody = contentScript.match(/function renderContextFiles\(project\) \{[\s\S]*?\n  function renderContextSelection/)?.[0] || '';

  assert.match(renderContextFilesBody, /buildContextTree\(files\)/);
  assert.match(renderContextFilesBody, /renderContextTreeNode/);
  assert.doesNotMatch(renderContextFilesBody, /sortContextFiles\(project\?\.files/);
  assert.match(contentScript, /file\.path\.split\('\/'\)/);
});

test('context picker uses only dedicated file-list results, not task snapshots', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const loadContextFilesBody = contentScript.match(/async function loadContextFiles\(options = \{\}\) \{[\s\S]*?\n  function renderContextFiles/)?.[0] || '';
  const getRunProjectSnapshotBody = contentScript.match(/async function getRunProjectSnapshot\(\) \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.match(contentScript, /function isContextFileListProject\(/);
  assert.match(loadContextFilesBody, /isContextFileListProject\(contextProject\)/);
  assert.doesNotMatch(getRunProjectSnapshotBody, /contextProject\s*=\s*project/);
});

test('context picker renders folders as collapsed expandable tree controls', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const renderContextTreeNodeBody = contentScript.match(/function renderContextTreeNode\(node, container, selected, depth\) \{[\s\S]*?\n  function renderContextSelection/)?.[0] || '';

  assert.match(renderContextTreeNodeBody, /document\.createElement\('details'\)/);
  assert.match(renderContextTreeNodeBody, /document\.createElement\('summary'\)/);
  assert.match(contentScript, /contextExpandedFolders = new Set\(\)/);
  assert.match(renderContextTreeNodeBody, /folder\.open = contextExpandedFolders\.has\(node\.path\)/);
  assert.match(renderContextTreeNodeBody, /folder\.addEventListener\('toggle'/);
  assert.doesNotMatch(renderContextTreeNodeBody, /folder\.open = true/);
});

test('context picker shows non-text resources but does not allow selecting them as Codex focus files', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const renderContextTreeNodeBody = contentScript.match(/function renderContextTreeNode\(node, container, selected, depth\) \{[\s\S]*?\n  function renderContextSelection/)?.[0] || '';

  assert.match(renderContextTreeNodeBody, /file\.selectable !== false/);
  assert.match(renderContextTreeNodeBody, /button\.disabled = !selectable/);
  assert.match(renderContextTreeNodeBody, /selectable \? file\.path :/);
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
