const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  DEFAULT_CHROME_EXTENSION_ID,
  buildHostManifest,
  getChromeNativeHostManifestPath,
  validateChromeExtensionId
} = require('../native-host/src/manifest');
const extensionManifest = require('../extension/manifest.json');

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
