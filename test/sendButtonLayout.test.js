const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function extractFunction(source, name) {
  const markers = [`function ${name}(`, `async function ${name}(`];
  const start = markers
    .map(marker => source.indexOf(marker))
    .filter(index => index !== -1)
    .sort((a, b) => a - b)[0] ?? -1;
  assert.notEqual(start, -1, `${name} should exist`);
  const openBrace = source.indexOf('{', start);
  assert.notEqual(openBrace, -1, `${name} should have a body`);
  let depth = 0;
  for (let index = openBrace; index < source.length; index++) {
    if (source[index] === '{') {
      depth++;
    } else if (source[index] === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  assert.fail(`${name} body should close`);
}

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
  assert.match(contentScript, /const modelCatalog = getModelCatalog\(\)/);
  assert.match(contentScript, /modelCatalog\.FALLBACK_MODELS/);
  assert.match(contentScript, /normalizeDiscoveredModels\(\{\s*models:\s*sourceModels,\s*selectedModel:\s*currentSelectedModel\s*\}\)/);
  assert.match(contentScript, /function renderModelOptions\(models,\s*selectedModel\)/);
  assert.match(contentScript, /function renderSpeedOptions\(/);
  assert.match(contentScript, /function renderModelConfigChoices\(/);
  assert.match(contentScript, /data-speed/);
  assert.match(contentScript, /model\.speedTiers/);
  assert.match(contentScript, /document\.createElement\('option'\)/);
  assert.match(contentScript, /document\.createElement\('button'\)/);
  assert.match(contentScript, /option\.textContent\s*=\s*model\.label/);
  assert.match(contentScript, /const sourceTitle = tr\('modelDisplayTitle'/);
  assert.match(contentScript, /modelDisplay\.title = sourceTitle/);
  assert.match(i18n, /modelSourceFallback:\s*'fallback'/);
  assert.match(i18n, /modelSourceDiscovered:\s*'discovered'/);
  assert.match(i18n, /modelDisplayTitle:\s*'\{label\} - Model list: \{source\}'/);
});

test('composer preserves user model changes made while native discovery is pending', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const loadModelOptions = extractFunction(contentScript, 'loadModelOptions');
  const awaitIndex = loadModelOptions.indexOf('await sendBackgroundNative');
  const currentSelectionIndex = loadModelOptions.indexOf('const currentSelectedModel = resolveSelectedModel() || selectedModel');

  assert.notEqual(awaitIndex, -1, 'loadModelOptions should await native discovery');
  assert.notEqual(currentSelectionIndex, -1, 'loadModelOptions should re-read selection after discovery returns');
  assert.equal(awaitIndex < currentSelectionIndex, true, 'selection must be re-read after await');
  assert.match(loadModelOptions, /normalizeDiscoveredModels\(\{\s*models:\s*sourceModels,\s*selectedModel:\s*currentSelectedModel\s*\}\)/);
  assert.match(loadModelOptions, /renderModelOptions\(normalized\.models,\s*currentSelectedModel\)/);
});

test('composer preserves a custom selected model before async discovery finishes', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const applyStateToPanel = extractFunction(contentScript, 'applyStateToPanel');
  const readPanelInputs = extractFunction(contentScript, 'readPanelInputs');
  const readSelectedModelInput = extractFunction(contentScript, 'readSelectedModelInput');
  const renderIndex = applyStateToPanel.indexOf('renderModelOptions(getModelCatalog().FALLBACK_MODELS, state.model)');
  const assignIndex = applyStateToPanel.indexOf("panel.querySelector('[data-model]').value = state.model");

  assert.notEqual(renderIndex, -1, 'applyStateToPanel should render fallback/custom model options synchronously');
  assert.notEqual(assignIndex, -1, 'applyStateToPanel should still select state.model');
  assert.equal(renderIndex < assignIndex, true, 'custom option must exist before assigning state.model');
  assert.match(readPanelInputs, /model:\s*readSelectedModelInput\(\)/);
  assert.match(readSelectedModelInput, /modelSelect\?\.value\s*\|\|\s*state\?\.model\s*\|\|\s*''/);
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
