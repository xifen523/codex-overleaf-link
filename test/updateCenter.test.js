const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

test('dedicated update center exposes a persistent, staged update experience', () => {
  const html = read('extension/bootstrap/update.html');
  const css = read('extension/bootstrap/update.css');

  assert.match(html, /id="update-title"/);
  assert.match(html, /id="progress-track"[^>]*role="progressbar"/);
  assert.match(html, /data-stage="download"/);
  assert.match(html, /data-stage="safe-point"/);
  assert.match(html, /data-stage="restart"/);
  assert.match(html, /id="technical-details"/);
  assert.match(html, /id="update-actions"/);
  assert.match(css, /\.update-stages li\[data-state="active"\]/);
  assert.match(css, /\.progress-track\[data-indeterminate="true"\]/);
  assert.match(css, /prefers-reduced-motion/);
});

test('update center restores persisted progress and survives managed restarts', () => {
  const source = read('extension/bootstrap/update.js');

  assert.match(source, /consent-update-get-state/);
  assert.match(source, /consent-update-check/);
  assert.match(source, /consent-update-install/);
  assert.match(source, /consent-update-later/);
  assert.match(source, /chrome\.storage\.onChanged\.addListener/);
  assert.match(source, /Reconnecting after restart/);
  assert.match(source, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(source, /window\.history\.replaceState/);
});

test('toolbar popup routes install and retry actions into one named update center', () => {
  const source = read('extension/src/popup.js');

  assert.match(source, /function openUpdateCenter/);
  assert.match(source, /codex-overleaf-update-center/);
  assert.match(source, /bootstrap\/update\.html/);
  assert.match(source, /action === 'install' \|\| action === 'retry' \|\| action === 'center'/);
});
