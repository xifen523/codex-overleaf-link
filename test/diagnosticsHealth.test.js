const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { extractFunction } = require('./_helpers/extractFunction');

const repo = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('diagnostics trigger shows a health dot driven by native compatibility', () => {
  const diag = repo('extension/src/content/diagnosticsPanel.js');
  const runtime = repo('extension/src/content/contentRuntime.js');
  const css = repo('extension/styles/panel.css');

  assert.match(diag, /data-diagnostics-health-dot/, 'trigger carries a health dot');
  const updateStatus = extractFunction(diag, 'updateStatus');
  assert.match(updateStatus, /data-diagnostics-health-dot/);
  assert.match(updateStatus, /dot\.dataset\.health/);
  // The native-compatibility refresh pushes the health bucket to the dot.
  assert.match(runtime, /setDiagnosticsHealth\('ok'\)/);
  assert.match(runtime, /setDiagnosticsHealth\(classification === 'update-available' \? 'warn' : 'fail'\)/);
  assert.match(runtime, /setDiagnosticsHealth\('fail'\)/);
  // CSS colors the dot per state.
  assert.match(css, /\.codex-diagnostics-dot\[data-health="ok"\]/);
  assert.match(css, /\.codex-diagnostics-dot\[data-health="fail"\]/);
});

test('Run all diagnostics aggregates every check into one report', () => {
  const runtime = repo('extension/src/content/contentRuntime.js');
  const runAll = extractFunction(runtime, 'runAllDiagnostics');

  assert.match(runAll, /collectOnly: true/, 'checks run in collect-only mode');
  for (const fn of ['inspectNativeEnvironment', 'inspectPageStateDiagnostics', 'inspectProjectSnapshot', 'inspectOtWarmMirrorDiagnostics']) {
    assert.match(runAll, new RegExp(fn), `Run all includes ${fn}`);
  }
  assert.match(runAll, /checks\.push\(/);
  assert.match(runAll, /setDiagnosticsHealth\(worst\)/);

  // Aggregated checks render as scannable status rows.
  const diag = repo('extension/src/content/diagnosticsPanel.js');
  assert.match(diag, /function renderCheckRows/);
  assert.match(diag, /codex-diagnostics-check-glyph/);
  assert.match(diag, /if \(Array\.isArray\(result\.checks\)/);
});

test('experimental OT toggle and language selector relocated from the menu to Settings', () => {
  const diag = repo('extension/src/content/diagnosticsPanel.js');
  const settings = repo('extension/src/content/settingsPanel.js');

  // Removed from the diagnostics menu.
  assert.doesNotMatch(diag, /data-language-toggle/);
  assert.doesNotMatch(diag, /data-experimental-ot-toggle/);
  // Relocated into Settings and wired.
  assert.match(settings, /data-experimental-ot-toggle/);
  assert.match(settings, /data-experimental-ot\b/);
  assert.match(settings, /data-language-select/);
  assert.match(settings, /data-i18n="experimentalTitle"/);
  assert.match(settings, /onOtToggleClick/);
});

test('diagnostics health i18n is available in English and Chinese', () => {
  const I18n = require('../extension/src/shared/i18n');
  for (const key of [
    'diagnosticsRunAllTitle', 'diagnosticsHealthTitle', 'diagnosticsRunningAll',
    'diagnosticsHealthOk', 'diagnosticsHealthWarn', 'diagnosticsHealthFail',
    'diagnosticsNativeShort', 'diagnosticsPageShort', 'diagnosticsSnapshotShort',
    'diagnosticsOtShort', 'experimentalTitle', 'languageLabel', 'languageHelp'
  ]) {
    assert.notEqual(I18n.t('en', key), key, `missing English ${key}`);
    assert.notEqual(I18n.t('zh', key), key, `missing Chinese ${key}`);
  }
});
