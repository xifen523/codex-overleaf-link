const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const packageJson = require('../package.json');
const {
  DEFAULT_CHROME_EXTENSION_ID,
  buildHostManifest,
  getChromeNativeHostManifestPath,
  validateChromeExtensionId
} = require('../native-host/src/manifest');
const extensionManifest = require('../extension/manifest.json');

test('release metadata is prepared for v0.3.0', () => {
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
  const changelog = fs.readFileSync(path.join(__dirname, '../CHANGELOG.md'), 'utf8');

  assert.equal(packageJson.version, '0.3.0');
  assert.equal(extensionManifest.version, packageJson.version);
  assert.match(readme, /version-0\.3\.0-blue/);
  assert.match(readme, /The OT warm mirror is experimental, off by default/);
  assert.match(changelog, /## v0\.3\.0 - 2026-05-06/);
  assert.match(changelog, /Experimental read-only OT warm mirror for focused Overleaf editor changes/);
  assert.match(changelog, /verified native `mirror\.patchFiles` updates/);
  assert.match(changelog, /Moved the experimental OT control out of the composer toolbar/);
  assert.match(changelog, /Full snapshot sync remains the project-level source of truth and fallback/);
});

test('validates Chrome extension ids', () => {
  assert.equal(validateChromeExtensionId('abcdefghijklmnopabcdefghijklmnop'), true);
  assert.equal(validateChromeExtensionId(DEFAULT_CHROME_EXTENSION_ID), true);
  assert.equal(validateChromeExtensionId('ABCDEFGHIJKLMNOPABCDEFGHIJKLMNOP'), false);
  assert.equal(validateChromeExtensionId('short'), false);
  assert.equal(validateChromeExtensionId('abcdefghijklmnopabcdefghijklmno1'), false);
});

test('builds a Chrome Native Messaging host manifest locked to one extension origin', () => {
  const manifest = buildHostManifest({
    extensionId: 'abcdefghijklmnopabcdefghijklmnop',
    bridgePath: '/Applications/CodexOverleaf/codex-overleaf-bridge'
  });

  assert.deepEqual(manifest, {
    name: 'com.codex.overleaf',
    description: 'Codex Overleaf local bridge',
    path: '/Applications/CodexOverleaf/codex-overleaf-bridge',
    type: 'stdio',
    allowed_origins: ['chrome-extension://abcdefghijklmnopabcdefghijklmnop/']
  });
});

test('returns the user-level macOS Chrome native host manifest path', () => {
  assert.equal(
    getChromeNativeHostManifestPath(),
    path.join(os.homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.codex.overleaf.json')
  );
});

test('rejects invalid extension ids when building the manifest', () => {
  assert.throws(() => buildHostManifest({ extensionId: 'bad', bridgePath: '/tmp/bridge' }), /Invalid Chrome extension id/);
});

test('content script loads shared i18n before the panel script', () => {
  const scripts = extensionManifest.content_scripts[0].js;
  assert.ok(scripts.indexOf('src/shared/i18n.js') > -1);
  assert.ok(scripts.indexOf('src/shared/i18n.js') < scripts.indexOf('src/contentScript.js'));
});

test('content script loads shared model catalog before the panel script', () => {
  const scripts = extensionManifest.content_scripts[0].js;
  assert.ok(scripts.indexOf('src/shared/models.js') > -1);
  assert.ok(scripts.indexOf('src/shared/models.js') < scripts.indexOf('src/contentScript.js'));
});

test('manifest loads and exposes read-only OT page dependencies', () => {
  const scripts = extensionManifest.content_scripts[0].js;
  const resources = extensionManifest.web_accessible_resources[0].resources;

  assert.ok(scripts.indexOf('src/shared/otText.js') > -1);
  assert.ok(scripts.indexOf('src/shared/otText.js') < scripts.indexOf('src/contentScript.js'));
  assert.ok(resources.includes('src/shared/otText.js'));
  assert.ok(resources.includes('src/page/overleafRealtimeObserver.js'));
});

test('content script loads mirror health helper before the panel script', () => {
  const scripts = extensionManifest.content_scripts[0].js;
  assert.ok(scripts.indexOf('src/content/mirrorHealth.js') > -1);
  assert.ok(scripts.indexOf('src/content/mirrorHealth.js') < scripts.indexOf('src/contentScript.js'));
});

test('content script loads OT warm mirror controller after lower-level helpers and before the panel script', () => {
  const scripts = extensionManifest.content_scripts[0].js;
  const controllerIndex = scripts.indexOf('src/content/otWarmMirrorController.js');
  assert.ok(controllerIndex > -1);
  for (const helper of [
    'src/content/nativeChannel.js',
    'src/content/writebackController.js',
    'src/content/runController.js',
    'src/content/mirrorHealth.js'
  ]) {
    assert.ok(scripts.indexOf(helper) < controllerIndex);
  }
  assert.ok(controllerIndex < scripts.indexOf('src/contentScript.js'));
});
