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
const {
  getDefaultBridgePath,
  getDefaultRuntimeRoot,
  getNativeHostRegistrationTarget,
  getNativeManifestPath
} = require('../native-host/src/nativeHostPlatform');
const extensionManifest = require('../extension/manifest.json');

test('release metadata is prepared for v0.5.0', () => {
  assert.equal(packageJson.version, '0.5.0');
  assert.equal(extensionManifest.version, packageJson.version);
});

test('release docs carry exact v0.5.0 badge and changelog heading', () => {
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
  const changelog = fs.readFileSync(path.join(__dirname, '../CHANGELOG.md'), 'utf8');

  assert.match(readme, /version-0\.5\.0-blue/);
  assert.doesNotMatch(readme, /version-0\.4\.0-blue/);
  assert.match(changelog, /^## v0\.5\.0 - 2026-05-06$/m);
  assert.doesNotMatch(changelog, /^## v0\.4\.0 - 2026-05-06[\s\S]*version-0\.5\.0-blue/m);
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

test('builds a host manifest with an injectable Windows absolute bridge path', () => {
  const manifest = buildHostManifest({
    extensionId: 'abcdefghijklmnopabcdefghijklmnop',
    bridgePath: 'C:\\Users\\Alice\\AppData\\Local\\CodexOverleaf\\codex-overleaf-bridge.cmd',
    platform: 'win32'
  });

  assert.equal(
    manifest.path,
    'C:\\Users\\Alice\\AppData\\Local\\CodexOverleaf\\codex-overleaf-bridge.cmd'
  );
});

test('returns the user-level macOS Chrome native host manifest path', () => {
  assert.equal(
    getChromeNativeHostManifestPath(),
    path.posix.join(os.homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.codex.overleaf.json')
  );
});

test('returns the macOS Chrome native host manifest path from injected environment', () => {
  assert.equal(
    getChromeNativeHostManifestPath({ env: { HOME: '/Users/injected' } }),
    '/Users/injected/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.codex.overleaf.json'
  );
});

test('returns injectable Linux Chrome and Chromium native host manifest paths', () => {
  assert.equal(
    getNativeManifestPath({ platform: 'linux', homeDir: '/home/alice', browser: 'chrome' }),
    '/home/alice/.config/google-chrome/NativeMessagingHosts/com.codex.overleaf.json'
  );
  assert.equal(
    getNativeManifestPath({ platform: 'linux', homeDir: '/home/alice', browser: 'chromium' }),
    '/home/alice/.config/chromium/NativeMessagingHosts/com.codex.overleaf.json'
  );
});

test('returns native host paths from an injected HOME environment', () => {
  assert.equal(
    getNativeManifestPath({ platform: 'linux', env: { HOME: '/home/env-user' } }),
    '/home/env-user/.config/google-chrome/NativeMessagingHosts/com.codex.overleaf.json'
  );
});

test('returns Windows Chrome native host registry metadata with a local app data manifest path', () => {
  const target = getNativeHostRegistrationTarget({
    platform: 'win32',
    browser: 'chrome',
    homeDir: 'C:\\Users\\Alice',
    env: {
      LOCALAPPDATA: 'C:\\Users\\Alice\\AppData\\Local'
    }
  });

  assert.equal(target.kind, 'registry');
  assert.equal(target.root, 'HKCU');
  assert.equal(
    target.registryKey,
    'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.codex.overleaf'
  );
  assert.equal(
    target.manifestPath,
    'C:\\Users\\Alice\\AppData\\Local\\CodexOverleaf\\native-host-runtime\\com.codex.overleaf.json'
  );
  assert.equal(path.win32.isAbsolute(target.manifestPath), true);
});

test('uses Windows USERPROFILE before HOME when local app data is not injected', () => {
  assert.equal(
    getDefaultRuntimeRoot({
      platform: 'win32',
      env: {
        HOME: 'C:\\msys64\\home\\alice',
        USERPROFILE: 'C:\\Users\\Alice'
      }
    }),
    'C:\\Users\\Alice\\AppData\\Local\\CodexOverleaf\\native-host-runtime'
  );
});

test('returns injectable default runtime and bridge paths without mutating process platform', () => {
  assert.equal(
    getDefaultRuntimeRoot({ platform: 'linux', homeDir: '/home/alice' }),
    '/home/alice/.codex-overleaf/native-host-runtime'
  );
  assert.equal(
    getDefaultBridgePath({ platform: 'linux', homeDir: '/home/alice' }),
    '/home/alice/.codex-overleaf/codex-overleaf-bridge'
  );
});

test('rejects unsupported native host platforms before registration', () => {
  assert.throws(
    () => getNativeHostRegistrationTarget({ platform: 'freebsd', homeDir: '/home/alice' }),
    /Unsupported native host platform: freebsd/
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

test('content script loads shared compatibility before native and panel scripts', () => {
  const scripts = extensionManifest.content_scripts[0].js;
  const compatibilityIndex = scripts.indexOf('src/shared/compatibility.js');

  assert.ok(compatibilityIndex > -1);
  assert.ok(compatibilityIndex < scripts.indexOf('src/content/nativeChannel.js'));
  assert.ok(compatibilityIndex < scripts.indexOf('src/contentScript.js'));
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
