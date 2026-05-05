const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('project snapshot action lives in the diagnostics menu instead of the header actions', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );

  assert.equal(contentScript.includes('data-snapshot'), false);
  assert.match(contentScript, /data-diagnostics-menu/);
  assert.match(contentScript, /data-diagnostics-native-env/);
  assert.match(contentScript, /data-diagnostics-page-state/);
  assert.match(contentScript, /data-diagnostics-snapshot/);
  assert.match(contentScript, /data-diagnostics-ot/);
  assert.match(contentScript, /data-language-toggle/);
  assert.match(contentScript, /data-diagnostics-result/);
  assert.match(contentScript, /Use when Codex cannot run, write, or read files/);
  assert.match(contentScript, /Check Local Connection/);
  assert.match(contentScript, /Check Overleaf Write Access/);
  assert.match(contentScript, /Check Project Read/);
  assert.match(contentScript, /Check Experimental OT Mirror/);
  assert.match(contentScript, /Switch to Chinese/);
  assert.match(contentScript, /function toggleLanguage\(/);
  assert.match(contentScript, /function applyLocaleToPanel\(/);
  assert.match(contentScript, /function inspectNativeEnvironment\(/);
  assert.match(contentScript, /function inspectOtWarmMirrorDiagnostics\(/);
  assert.match(contentScript, /function formatOtDiagnosticsResult\(/);
  assert.match(contentScript, /function formatNativeEnvironmentResult\(/);
  assert.match(contentScript, /function toggleDiagnosticsMenu\(/);
  assert.match(contentScript, /function closeDiagnosticsMenu\(/);
  assert.match(contentScript, /function showDiagnosticsResult\(/);
  assert.match(contentScript, /function inspectProjectSnapshot\(/);
  assert.match(contentScript, /allowEditorNavigation:\s*false/);
  assert.match(css, /\.codex-diagnostics-menu/);
  assert.match(css, /\.codex-diagnostics-result/);
  assert.match(css, /\.codex-diagnostics-technical/);
});

test('diagnostics render in a floating result panel instead of the task transcript', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const nativeBody = contentScript.match(/async function inspectNativeEnvironment\(\) \{[\s\S]*?\n  function formatNativeEnvironmentResult/)?.[0] || '';
  const pageBody = contentScript.match(/async function inspectPageStateDiagnostics\(\) \{[\s\S]*?\n  async function runTask/)?.[0] || '';
  const snapshotBody = contentScript.match(/async function inspectProjectSnapshot\(\) \{[\s\S]*?\n  async function inspectNativeEnvironment/)?.[0] || '';

  assert.doesNotMatch(nativeBody, /appendLog\(/);
  assert.doesNotMatch(pageBody, /appendLog\(/);
  assert.doesNotMatch(snapshotBody, /appendLog\(/);
  assert.match(nativeBody, /showDiagnosticsLoading\(tr\('diagnosticsNativeTitle'\)/);
  assert.match(pageBody, /showDiagnosticsLoading\(tr\('diagnosticsPageTitle'\)/);
  assert.match(snapshotBody, /showDiagnosticsLoading\(tr\('diagnosticsSnapshotTitle'\)/);
  assert.match(nativeBody, /showDiagnosticsResult\(formatNativeEnvironmentResult/);
  assert.match(pageBody, /showDiagnosticsResult\(formatPageStateDiagnosticsResult/);
  assert.match(snapshotBody, /showDiagnosticsResult\(formatProjectSnapshotDiagnosticsResult/);
});

test('experimental OT diagnostics read metadata without draining project content', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const menuBody = contentScript.match(/panel\.querySelector\('\[data-diagnostics-menu\]'\)[\s\S]*?panel\.querySelector\('\[data-language-toggle\]'\)/)?.[0] || '';
  const inspectBody = contentScript.match(/async function inspectOtWarmMirrorDiagnostics\(\) \{[\s\S]*?\n  function formatOtDiagnosticsResult/)?.[0] || '';
  const formatBody = contentScript.match(/function formatOtDiagnosticsResult\(\{ otStatus, mirrorStatus \}\) \{[\s\S]*?\n  function /)?.[0] || '';
  const technicalBody = contentScript.match(/function formatOtDiagnosticsTechnicalDetails\(metadata = \{\}\) \{[\s\S]*?\n  function formatOtChannelCandidates/)?.[0] || '';

  assert.match(menuBody, /\[data-diagnostics-ot\]/);
  assert.match(menuBody, /closeDiagnosticsMenu\(\)/);
  assert.match(menuBody, /inspectOtWarmMirrorDiagnostics\(\)/);
  assert.match(inspectBody, /showDiagnosticsLoading\(tr\('diagnosticsOtTitle'\)/);
  assert.match(inspectBody, /callPageBridge\('getOtStatus'/);
  assert.match(inspectBody, /getMirrorFreshness\(\)/);
  assert.doesNotMatch(inspectBody, /drainOtEvents/);
  assert.match(inspectBody, /showDiagnosticsResult\(formatOtDiagnosticsResult\(\{ otStatus, mirrorStatus \}\)\)/);
  assert.match(inspectBody, /status:\s*'warning'/);
  assert.match(formatBody, /isExperimentalOtEnabled\(\)/);
  assert.match(formatBody, /formatOtStatusLabel/);
  assert.match(formatBody, /lastOtPatchAt/);
  assert.match(formatBody, /queuedEventCount/);
  assert.match(formatBody, /channelCandidates/);
  assert.match(formatBody, /diagnosticsOtSummaryEnabled/);
  assert.match(formatBody, /diagnosticsOtSummaryDisabled/);
  assert.match(technicalBody, /`strategy:/);
  assert.match(technicalBody, /`queuedEventCount:/);
  assert.match(technicalBody, /`lastEventAt:/);
  assert.match(technicalBody, /`lastOtPatchAt:/);
  assert.match(technicalBody, /`lastOtErrorCode:/);
  assert.match(technicalBody, /`lastErrorCode:/);
  assert.match(technicalBody, /`channelCandidates:/);
  assert.doesNotMatch(technicalBody, /`enabled:/);
  assert.doesNotMatch(technicalBody, /`fallback:/);
  assert.doesNotMatch(technicalBody, /`status:/);
  assert.doesNotMatch(technicalBody, /`state:/);
  assert.doesNotMatch(technicalBody, /`running:/);
  assert.doesNotMatch(technicalBody, /`activePath:/);
  assert.doesNotMatch(technicalBody, /`mirrorExists:/);
  assert.doesNotMatch(technicalBody, /`mirrorAgeMs:/);
  assert.doesNotMatch(technicalBody, /`otFreshFileCount:/);
  assert.doesNotMatch(technicalBody, /`otStaleFileCount:/);
  assert.doesNotMatch(formatBody, /nextContent/);
  assert.doesNotMatch(formatBody, /previousContent/);
  assert.doesNotMatch(formatBody, /\bops\b/);
  assert.doesNotMatch(formatBody, /JSON\.stringify\((otStatus|mirrorStatus)/);
});

test('experimental OT diagnostics i18n is available in English and Chinese', () => {
  const I18n = require('../extension/src/shared/i18n');
  const keys = [
    'diagnosticsOtTitle',
    'diagnosticsOtSubtitle',
    'diagnosticsOtSummaryEnabled',
    'diagnosticsOtSummaryDisabled',
    'diagnosticsOtNextStep',
    'otStatus',
    'otFreshFiles',
    'otFallback',
    'yes',
    'no'
  ];

  for (const key of keys) {
    assert.notEqual(I18n.t('en', key), key, `missing English i18n key ${key}`);
    assert.notEqual(I18n.t('zh', key), key, `missing Chinese i18n key ${key}`);
  }
});

test('diagnostic summaries use natural language while raw details stay collapsed', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );

  assert.match(contentScript, /Codex 已连接，本机 LaTeX 工具可用/);
  assert.match(contentScript, /插件没有连上本机服务/);
  assert.match(contentScript, /当前 Overleaf 文件可以读取和写入/);
  assert.match(contentScript, /插件没有确认当前编辑器可以写入/);
  assert.match(contentScript, /插件已读到完整 Overleaf 项目/);
  assert.match(contentScript, /没有读到完整的 Overleaf 项目/);
  assert.match(contentScript, /<summary data-i18n="technicalDetails">Technical Details<\/summary>/);
});

test('diagnostic result floats inside the Codex panel with visible side margins', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );
  const resultBlock = css.match(/#codex-overleaf-panel \.codex-diagnostics-result\s*\{[\s\S]*?\n\}/)?.[0] || '';

  assert.match(resultBlock, /position:\s*fixed/);
  assert.match(resultBlock, /top:\s*44px/);
  assert.match(resultBlock, /right:\s*12px/);
  assert.match(resultBlock, /width:\s*min\(316px,\s*calc\(var\(--codex-overleaf-panel-width\) - 24px\)\)/);
  assert.doesNotMatch(resultBlock, /position:\s*absolute/);
});
