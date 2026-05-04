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

  assert.match(contentScript, /data-run title="Send" aria-label="Send"/);
  assert.match(css, /\.codex-composer-toolbar\s*\{[\s\S]*display: grid/);
  assert.match(css, /\.codex-composer-toolbar\s*\{[\s\S]*grid-template-columns:/);
  assert.match(css, /\.codex-composer-toolbar \[data-run\]\s*\{[\s\S]*grid-column: 6/);
  assert.match(css, /\.codex-composer-toolbar \[data-run\]\s*\{[\s\S]*width: 28px/);
  assert.match(css, /\.codex-composer-toolbar select\s*\{[\s\S]*min-width: 0/);
});

test('composer selects reserve room for the dropdown chevron', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );

  const selectBody = (css.match(/#codex-overleaf-panel \.codex-composer-toolbar select\s*\{[\s\S]*?\n\}/g) || [])
    .find(block => /width:\s*100%/.test(block)) || '';

  assert.match(selectBody, /appearance:\s*none/);
  assert.match(selectBody, /padding:\s*0 18px 0 3px/);
  assert.match(selectBody, /background-image:\s*url\("data:image\/svg\+xml/);
  assert.match(selectBody, /background-position:\s*right 4px center/);
  assert.match(selectBody, /text-overflow:\s*ellipsis/);
});

test('composer model picker shows the full selected model name while preserving model ids', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );
  const modelSelect = contentScript.match(/<select data-model[\s\S]*?<\/select>/)?.[0] || '';

  assert.match(contentScript, /data-model-display/);
  assert.match(contentScript, /<span data-model-display>GPT-5\.4<\/span>/);
  assert.doesNotMatch(contentScript, /const MODEL_DISPLAY_LABELS/);
  assert.doesNotMatch(contentScript, /'gpt-5\.5': '5\.5'/);
  assert.doesNotMatch(contentScript, /'gpt-5\.3-codex-spark': '5\.3S'/);
  assert.match(contentScript, /function updateModelDisplay/);
  assert.match(contentScript, /modelDisplay\.textContent = fullLabel/);
  assert.match(modelSelect, /<option value="gpt-5\.5">GPT-5\.5<\/option>/);
  assert.match(modelSelect, /<option value="gpt-5\.3-codex-spark">GPT-5\.3 Codex Spark<\/option>/);
  assert.match(css, /\.codex-model-picker \[data-model-display\]\s*\{[\s\S]*text-overflow:\s*ellipsis/);
  assert.match(css, /\.codex-model-picker select\s*\{[\s\S]*opacity:\s*0/);
});

test('composer discovers model options through the native codex.models endpoint', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const i18n = fs.readFileSync(
    path.join(__dirname, '../extension/src/shared/i18n.js'),
    'utf8'
  );

  assert.match(contentScript, /let modelDiscovery\s*=\s*\{\s*status:\s*'fallback'/);
  assert.match(contentScript, /loadModelOptions\(\)\.catch/);
  assert.match(contentScript, /async function loadModelOptions\(\)/);
  assert.match(contentScript, /method:\s*'codex\.models'/);
  assert.match(contentScript, /window\.CodexOverleafModels\.FALLBACK_MODELS/);
  assert.match(contentScript, /normalizeDiscoveredModels\(\{\s*models:\s*sourceModels,\s*selectedModel/);
  assert.match(contentScript, /function renderModelOptions\(models,\s*selectedModel\)/);
  assert.match(contentScript, /document\.createElement\('option'\)/);
  assert.match(contentScript, /option\.textContent\s*=\s*model\.label/);
  assert.match(contentScript, /modelDisplay\.title\s*=\s*tr\('modelDisplayTitle'/);
  assert.match(i18n, /modelSourceFallback:\s*'fallback'/);
  assert.match(i18n, /modelSourceDiscovered:\s*'discovered'/);
  assert.match(i18n, /modelDisplayTitle:\s*'\{label\} - Model list: \{source\}'/);
});

test('composer model picker stays compact when the side panel is wide', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );

  const toolbarBlock = css.match(/#codex-overleaf-panel \.codex-composer-toolbar\s*\{[\s\S]*?\n\}/)?.[0] || '';
  const modelBlock = css.match(/#codex-overleaf-panel \.codex-model-picker\s*\{[\s\S]*?\n\}/)?.[0] || '';

  assert.doesNotMatch(toolbarBlock, /minmax\(96px,\s*1fr\)/);
  assert.match(toolbarBlock, /grid-template-columns:\s*26px 42px minmax\(0,\s*1fr\) minmax\(112px,\s*150px\) 66px 28px/);
  assert.match(modelBlock, /max-width:\s*150px/);
});

test('composer describes compile toggle as a post-write action', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const i18n = fs.readFileSync(
    path.join(__dirname, '../extension/src/shared/i18n.js'),
    'utf8'
  );

  assert.match(contentScript, /data-auto-recompile/);
  assert.match(contentScript, /<span class="codex-recompile-label" data-i18n="autoCompile">Auto Compile<\/span>/);
  assert.match(i18n, /Codex 写入后自动点击 Overleaf Recompile/);
});

test('side panel can be resized and persists width as lightweight prefs', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );

  assert.match(css, /--codex-overleaf-panel-width:\s*380px/);
  assert.match(contentScript, /PANEL_DEFAULT_WIDTH = 380/);
  assert.match(contentScript, /PANEL_MIN_WIDTH = 340/);
  assert.match(contentScript, /PANEL_MAX_WIDTH = 760/);
  assert.match(contentScript, /data-panel-resize-handle/);
  assert.match(contentScript, /function startPanelResize/);
  assert.match(contentScript, /function applyPanelWidth/);
  assert.match(contentScript, /function clampPanelWidth/);
  assert.match(contentScript, /saveStateSoon\(\)/);
  assert.match(css, /\.codex-panel-resize-handle/);
  assert.match(css, /cursor:\s*col-resize/);
});

test('composer sends through a form submit path with a guarded run handler', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );

  assert.match(contentScript, /<form class="codex-composer" data-composer-form>/);
  assert.match(contentScript, /<button type="submit" data-run title="Send" aria-label="Send">↑<\/button>/);
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
  assert.match(setRunningBody, /aria-label', running \? tr\('cancelRun'\) : tr\('send'\)/);
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

  assert.match(contentScript, /tr\('undoRun'\)/);
  assert.match(css, /#codex-overleaf-panel \[data-run-undo\]\s*\{[\s\S]*background:\s*#a14b00/);
  assert.match(css, /#codex-overleaf-panel \[data-run-undo\]\s*\{[\s\S]*border:\s*1px solid #f0883e/);
  assert.match(css, /#codex-overleaf-panel \[data-run-undo\]\s*\{[\s\S]*font-weight:\s*700/);
  assert.match(css, /#codex-overleaf-panel \[data-run-undo\]\s*\{[\s\S]*box-shadow:/);
});

test('panel persistence uses hybrid IndexedDB storage with legacy fallback', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );

  assert.match(contentScript, /prepareStateForStorage/);
  assert.match(contentScript, /chrome\.storage\.local\.set\(\{ \[storageKey\]: prepareStateForStorage\(state\) \}\)/);
  assert.match(contentScript, /saveState\(\)\.catch/);
  // Hybrid approach: prefs via Migration, sessions via StorageDb
  assert.match(contentScript, /Migration\.savePrefs\(prefs\)/);
  assert.match(contentScript, /StorageDb\.putRecords\('sessions', sessionRecords\)/);
  assert.match(contentScript, /StorageDb\.extractLightweightPrefs\(compactState, projectId\)/);
  assert.match(contentScript, /runs:\s*Array\.isArray\(session\.runs\)/);
  assert.match(contentScript, /history:\s*Array\.isArray\(session\.history\)/);
});

test('storage notice is not appended repeatedly during autosave', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const saveStateBody = contentScript.match(/async function saveState\(\) \{[\s\S]*?\n  function saveStateSoon/)?.[0] || '';
  const appendStorageNoticeBody = contentScript.match(/function appendStorageNoticeOnce\(key, text\) \{[\s\S]*?\n  function saveStateSoon/)?.[0] || '';
  const appendPlainLogBody = contentScript.match(/function appendPlainLog\(text\) \{[\s\S]*?\n  function updateProbeNotice/)?.[0] || '';
  const showPluginToastBody = contentScript.match(/function showPluginToast\(text, options = \{\}\) \{[\s\S]*?\n  function updateProbeNotice/)?.[0] || '';

  assert.match(contentScript, /storageNoticeKeys = new Set\(\)/);
  assert.match(contentScript, /function appendStorageNoticeOnce\(/);
  assert.match(saveStateBody, /appendStorageNoticeOnce\('save-failed'/);
  assert.doesNotMatch(appendStorageNoticeBody, /appendRunEvent\(\{/);
  assert.match(appendStorageNoticeBody, /showPluginToast/);
  assert.match(appendPlainLogBody, /showPluginToast/);
  assert.match(showPluginToastBody, /dataset\.repeatCount/);
});
