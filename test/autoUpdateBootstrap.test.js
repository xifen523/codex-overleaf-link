const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'extension/bootstrap/background.js'), 'utf8');
const contentRuntimeSource = fs.readFileSync(path.join(root, 'extension/src/content/contentRuntime.js'), 'utf8');
const manifest = require('../extension/bootstrap/manifest.template.json');
const runtimeManifest = require('../extension/runtime-manifest.json');

test('managed Bootstrap owns alarms, scripting and native messaging while runtime stays replaceable', () => {
  assert.equal(manifest.permissions.includes('alarms'), true);
  assert.equal(manifest.permissions.includes('scripting'), true);
  assert.equal(manifest.permissions.includes('nativeMessaging'), true);
  assert.equal(manifest.content_scripts, undefined);
  assert.equal(manifest.background.service_worker, 'bootstrap/background.js');
  assert.match(source, /registerContentScripts/);
  assert.match(source, /persistAcrossSessions:\s*true/);
  assert.match(source, /chrome\.runtime\.reload\(\)/);
});

test('runtime manifest preserves content order and places idle probe before content runtime', () => {
  const idle = runtimeManifest.js.indexOf('src/content/updateIdle.js');
  const runtime = runtimeManifest.js.indexOf('src/content/contentRuntime.js');
  const entry = runtimeManifest.js.indexOf('src/contentScript.js');
  assert.equal(idle >= 0 && idle < runtime && runtime < entry, true);
});

test('health confirmation waits for the replacement content runtime to answer from Overleaf', () => {
  assert.match(contentRuntimeSource, /codex-overleaf\/runtime-health-probe/);
  assert.match(source, /await verifyPendingRuntimeHealth\(targetVersion\)[\s\S]*method:\s*'update\.confirm'/);
  assert.match(source, /transaction\?\.state === 'rolled_back'[\s\S]*reloadPendingOverleafTabs/);
});
