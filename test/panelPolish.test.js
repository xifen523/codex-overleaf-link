const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { extractFunction } = require('./_helpers/extractFunction');

const repo = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('model picker rests as a quiet pill with a model/reasoning separator', () => {
  const css = repo('extension/styles/panel.css');
  const rest = css.match(/#codex-overleaf-panel \.codex-model-config-button \{[\s\S]*?\n\}/g) || [];
  assert.ok(rest.some(block => /background-color: var\(--tl-surface-2\)/.test(block)
    && /border: 1px solid transparent/.test(block)), 'resting pill: surface bg + reserved border');
  assert.match(css, /\.codex-model-config-button\[data-active="true"\],\n#codex-overleaf-panel \.codex-model-config-button:hover \{[^}]*border-color: var\(--tl-border\)/);
  assert.match(css, /\[data-reasoning-display\] \{[^}]*border-left: 1px solid var\(--tl-border\)/);
});

test('the empty timeline shows a second hint line for @ and / affordances', () => {
  const view = repo('extension/src/content/runTimelineView.js');
  assert.match(view, /empty-runs-hint/);
  assert.match(view, /tr\('emptyRunsHint'\)/);
  const css = repo('extension/styles/panel.css');
  assert.match(css, /\.empty-runs-hint/);
  const I18n = require('../extension/src/shared/i18n');
  for (const locale of ['en', 'zh']) {
    assert.notEqual(I18n.t(locale, 'emptyRunsHint'), 'emptyRunsHint', `missing ${locale} emptyRunsHint`);
  }
});

test('non-finishRunView run teardowns stop the elapsed tick explicitly', () => {
  const runtime = repo('extension/src/content/contentRuntime.js');
  const finallyBlock = runtime.match(/\} finally \{[\s\S]*?runCancellationRequested = false;/)?.[0] || '';
  assert.match(finallyBlock, /stopRunElapsedTick\(\);/);
  const catchBlock = runtime.match(/runTask\(\)\.catch\(error => \{[\s\S]*?\}\);/)?.[0] || '';
  assert.match(catchBlock, /stopRunElapsedTick\(\);/);
});

test('dead tl-pulse keyframes stay deleted and referenced animations exist', () => {
  const css = repo('extension/styles/panel.css');
  assert.doesNotMatch(css, /tl-pulse/);
  assert.match(css, /@keyframes tl-fade-in/);
  assert.match(css, /@keyframes codex-session-spin/);
});

test('settings panel destroy clears the saved-flash timer', () => {
  const settings = repo('extension/src/content/settingsPanel.js');
  const destroy = extractFunction(settings, 'destroy');
  assert.match(destroy, /clearTimeout\(instance\._savedFlashTimer\)/);
});
