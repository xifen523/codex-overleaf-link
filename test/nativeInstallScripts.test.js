const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { DEFAULT_CHROME_EXTENSION_ID } = require('../native-host/src/manifest');
const { getDefaultBridgePath } = require('../native-host/src/nativeHostPlatform');
const {
  assertSafeManagedRuntimeRoot,
  installRuntimeFromPackage,
  readRuntimeMarker,
  uninstallManagedRuntime
} = require('../native-host/src/runtimeInstaller');

const CURRENT_PACKAGE_VERSION = require('../package.json').version;
const CURRENT_RELEASE_REF = `v${CURRENT_PACKAGE_VERSION}`;
const CANONICAL_RELEASE_INSTALL_COMMAND = `CODEX_OVERLEAF_REF=${CURRENT_RELEASE_REF} bash -c "$(curl -fsSL https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/${CURRENT_RELEASE_REF}/install.sh)"`;
const CANONICAL_WINDOWS_RELEASE_REF_COMMAND = `$env:CODEX_OVERLEAF_REF='${CURRENT_RELEASE_REF}'`;
const CANONICAL_WINDOWS_RELEASE_INSTALL_URL = `https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/${CURRENT_RELEASE_REF}/install.ps1`;
const CANONICAL_WINDOWS_RELEASE_RUN_COMMAND = 'powershell -ExecutionPolicy Bypass -File install.ps1';

function writeFakeRegistryCommand(tempDir, options = {}) {
  const scriptPath = path.join(tempDir, 'fake-reg.js');
  const exitCode = Number.isInteger(options.exitCode) ? options.exitCode : 0;
  fs.writeFileSync(scriptPath, [
    'const fs = require("node:fs");',
    'const args = process.argv.slice(2);',
    'fs.appendFileSync(process.env.REG_LOG, `${args.join("\\n")}\\n`);',
    options.stderr ? `process.stderr.write(${JSON.stringify(options.stderr)});` : '',
    `process.exit(${exitCode});`,
    ''
  ].filter(Boolean).join('\n'), 'utf8');

  return {
    CODEX_OVERLEAF_REG_EXE: process.execPath,
    CODEX_OVERLEAF_REG_EXE_ARGS_JSON: JSON.stringify([scriptPath])
  };
}

function getTestWindowsLocalAppData(tempDir) {
  if (process.platform === 'win32') {
    return path.win32.join(tempDir, 'LocalAppData');
  }
  return 'C:\\Users\\Alice\\AppData\\Local';
}

function getWindowsSimulationFilePath(tempDir, targetPath) {
  if (process.platform === 'win32') {
    return targetPath;
  }
  return path.join(tempDir, targetPath);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function writeRuntimePackageFixture(tempDir, version = '9.8.7') {
  const packageRoot = path.join(tempDir, 'package-root');
  const files = {
    'package.json': JSON.stringify({ name: 'codex-overleaf-link', version }, null, 2),
    'native-host/src/index.js': 'module.exports = {};\n',
    'extension/src/shared/compatibility.js': 'module.exports = {};\n',
    'scripts/codex-json-agent.mjs': '#!/usr/bin/env node\n',
    'scripts/install-native-host.mjs': '#!/usr/bin/env node\n',
    'scripts/uninstall-native-host.mjs': '#!/usr/bin/env node\n'
  };

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(packageRoot, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
  }

  return packageRoot;
}

test('installRuntimeFromPackage creates stable managed runtime layout and marker', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-runtime-installer-'));
  const packageRoot = writeRuntimePackageFixture(tempDir, '2.3.4');
  const runtimeRoot = path.join(tempDir, 'runtime');
  try {
    const result = installRuntimeFromPackage({ packageRoot, runtimeRoot });

    assert.equal(result.ok, true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, '.codex-overleaf-runtime.json')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'package.json')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'native-host/src/index.js')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'extension/src/shared/compatibility.js')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'scripts/codex-json-agent.mjs')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'scripts/install-native-host.mjs')), true);
    assert.equal(fs.existsSync(path.join(runtimeRoot, 'scripts/uninstall-native-host.mjs')), true);

    const marker = readRuntimeMarker(runtimeRoot);
    assert.equal(marker.managedBy, 'codex-overleaf-link');
    assert.equal(marker.version, '2.3.4');
    assert.equal(marker.installedFrom, 'npm');
    assert.equal(typeof marker.installedAt, 'string');
    assert.ok(Number.isFinite(Date.parse(marker.installedAt)));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('assertSafeManagedRuntimeRoot rejects dangerous roots and accepts a temp runtime child', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-runtime-safe-'));
  const packageRoot = writeRuntimePackageFixture(tempDir);
  try {
    const dangerousRoots = ['/', os.homedir(), packageRoot, '/usr', '/tmp'];
    for (const dangerousRoot of dangerousRoots) {
      assert.throws(
        () => assertSafeManagedRuntimeRoot(dangerousRoot, { packageRoot }),
        /Refusing to recursively remove unsafe runtime root/
      );
    }

    assert.equal(
      assertSafeManagedRuntimeRoot(path.join(tempDir, 'runtime'), { packageRoot }),
      path.join(tempDir, 'runtime')
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('managed runtime safety refuses temp roots through symlinked ancestors', t => {
  if (process.platform === 'win32') {
    t.skip('symlinked POSIX temp ancestor behavior is covered on POSIX runners');
    return;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-runtime-symlink-'));
  const outsideDir = fs.mkdtempSync(path.join(process.cwd(), '.runtime-installer-outside-'));
  const packageRoot = writeRuntimePackageFixture(tempDir);
  const linkPath = path.join(tempDir, 'link');
  const runtimeRoot = path.join(linkPath, 'runtime');
  try {
    fs.symlinkSync(outsideDir, linkPath, 'dir');

    assert.throws(
      () => assertSafeManagedRuntimeRoot(runtimeRoot, { packageRoot }),
      /Refusing to recursively remove unsafe runtime root/
    );
    assert.throws(
      () => installRuntimeFromPackage({ packageRoot, runtimeRoot }),
      /Refusing to recursively remove unsafe runtime root/
    );
    assert.throws(
      () => uninstallManagedRuntime({ runtimeRoot }),
      /Refusing to recursively remove unsafe runtime root/
    );
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('installRuntimeFromPackage refuses to replace an unmarked existing runtime root', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-runtime-unmarked-'));
  const packageRoot = writeRuntimePackageFixture(tempDir);
  const runtimeRoot = path.join(tempDir, 'runtime');
  try {
    fs.mkdirSync(runtimeRoot, { recursive: true });
    fs.writeFileSync(path.join(runtimeRoot, 'keep.txt'), 'keep', 'utf8');

    assert.throws(
      () => installRuntimeFromPackage({ packageRoot, runtimeRoot }),
      /Refusing to replace unmarked runtime root/
    );
    assert.equal(fs.readFileSync(path.join(runtimeRoot, 'keep.txt'), 'utf8'), 'keep');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('uninstallManagedRuntime removes marked runtime, refuses unmarked runtime, and honors keepRuntime', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-runtime-uninstall-'));
  const packageRoot = writeRuntimePackageFixture(tempDir);
  const runtimeRoot = path.join(tempDir, 'runtime');
  try {
    installRuntimeFromPackage({ packageRoot, runtimeRoot });
    const kept = uninstallManagedRuntime({ runtimeRoot, keepRuntime: true });
    assert.equal(kept.action, 'kept');
    assert.equal(fs.existsSync(runtimeRoot), true);

    const removed = uninstallManagedRuntime({ runtimeRoot });
    assert.equal(removed.action, 'removed');
    assert.equal(fs.existsSync(runtimeRoot), false);

    fs.mkdirSync(runtimeRoot, { recursive: true });
    fs.writeFileSync(path.join(runtimeRoot, 'keep.txt'), 'keep', 'utf8');
    assert.throws(
      () => uninstallManagedRuntime({ runtimeRoot }),
      /Refusing to remove unmarked runtime root/
    );
    assert.equal(fs.readFileSync(path.join(runtimeRoot, 'keep.txt'), 'utf8'), 'keep');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('installRuntimeFromPackage leaves previous runtime in place when staged verification fails', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-runtime-rollback-'));
  const packageRoot = writeRuntimePackageFixture(tempDir, '1.0.0');
  const runtimeRoot = path.join(tempDir, 'runtime');
  try {
    installRuntimeFromPackage({ packageRoot, runtimeRoot });
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: 'codex-overleaf-link', version: '2.0.0' }), 'utf8');

    assert.throws(
      () => installRuntimeFromPackage({
        packageRoot,
        runtimeRoot,
        verifyRuntime() {
          throw new Error('simulated staged verification failure');
        }
      }),
      /simulated staged verification failure/
    );

    assert.equal(readRuntimeMarker(runtimeRoot).version, '1.0.0');
    assert.equal(JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'package.json'), 'utf8')).version, '1.0.0');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('installRuntimeFromPackage reports rollback cleanup warnings without failing activation', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-runtime-cleanup-warning-'));
  const packageRoot = writeRuntimePackageFixture(tempDir, '1.0.0');
  const runtimeRoot = path.join(tempDir, 'runtime');
  try {
    installRuntimeFromPackage({ packageRoot, runtimeRoot });
    fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({ name: 'codex-overleaf-link', version: '2.0.0' }), 'utf8');

    const result = installRuntimeFromPackage({
      packageRoot,
      runtimeRoot,
      cleanupRollback() {
        throw new Error('simulated cleanup failure');
      }
    });

    assert.equal(result.ok, true);
    assert.equal(result.action, 'replaced');
    assert.match(result.warning, /simulated cleanup failure/);
    assert.equal(readRuntimeMarker(runtimeRoot).version, '2.0.0');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('native install script defaults to the committed extension id', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../scripts/install-native-host.mjs'),
    'utf8'
  );

  assert.match(source, /DEFAULT_CHROME_EXTENSION_ID/);
  assert.match(source, /args\.extensionId \|\| DEFAULT_CHROME_EXTENSION_ID/);
  assert.equal(DEFAULT_CHROME_EXTENSION_ID, 'illdpneeeopfffmiepaejglgmhpmdhdc');
});

test('repository does not ship a generated native bridge with local absolute paths', () => {
  assert.equal(
    fs.existsSync(path.join(__dirname, '../native-host/bin/codex-overleaf-bridge')),
    false
  );
});

test('package exposes install and uninstall native host commands', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));

  assert.equal(pkg.scripts['install:native'], 'node scripts/install-native-host.mjs');
  assert.equal(pkg.scripts['uninstall:native'], 'node scripts/uninstall-native-host.mjs');
});

test('repository ships a one-command Windows installer', () => {
  const installer = fs.readFileSync(path.join(__dirname, '../install.ps1'), 'utf8');

  assert.match(installer, /CODEX_OVERLEAF_INSTALL_DIR/);
  assert.match(installer, /CODEX_OVERLEAF_REF/);
  assert.match(installer, /CODEX_OVERLEAF_REPO_URL/);
  assert.match(installer, /CODEX_OVERLEAF_EXTENSION_ID/);
  assert.match(installer, /github\.com\/Ghqqqq\/codex-overleaf-link\.git/);
  assert.match(installer, /Get-Command\s+git/);
  assert.match(installer, /Get-Command\s+node/);
  assert.match(installer, /git clone/);
  assert.match(installer, /git -C/);
  assert.match(installer, /scripts[\\/]install-native-host\.mjs/);
  assert.match(installer, /--extension-id/);
  assert.match(installer, /chrome:\/\/extensions/);
  assert.match(installer, /Load unpacked/);
  assert.match(installer, /Reload the Chrome extension/);
  assert.match(installer, /Refresh the Overleaf page/);
});

test('Windows installer guards recursive replacement of existing non-checkout install directories', () => {
  const installer = fs.readFileSync(path.join(__dirname, '../install.ps1'), 'utf8');

  assert.match(installer, /function Assert-SafeInstallDir/);
  assert.match(installer, /Refusing to remove unsafe install directory/);
  assert.match(installer, /\[System\.IO\.Path\]::GetFullPath/);
  assert.match(installer, /\[System\.IO\.Path\]::GetPathRoot/);
  assert.match(
    installer,
    /Assert-SafeInstallDir\s+\$InstallDir[\s\S]*Remove-Item\s+-LiteralPath\s+\$InstallDir\s+-Recurse\s+-Force/
  );
});

test('native install runtime includes package metadata required by bridge ping', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-runtime-test-'));
  const runtimeRoot = path.join(tempDir, 'runtime');
  const bridgePath = path.join(tempDir, 'codex-overleaf-bridge');
  try {
    const result = spawnSync(process.execPath, [
      path.join(__dirname, '../scripts/install-native-host.mjs'),
      '--runtime-root',
      runtimeRoot,
      '--bridge-path',
      bridgePath
    ], {
      env: {
        ...process.env,
        HOME: tempDir
      },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, new RegExp(`Runtime package version: ${escapeRegExp(CURRENT_PACKAGE_VERSION)}`));
    const runtimePackagePath = path.join(runtimeRoot, 'package.json');
    const runtimeAgentPath = path.join(runtimeRoot, 'scripts/codex-json-agent.mjs');
    assert.equal(fs.existsSync(runtimePackagePath), true);
    assert.equal(fs.existsSync(runtimeAgentPath), true);
    assert.match(fs.readFileSync(bridgePath, 'utf8'), new RegExp(escapeRegExp(runtimeAgentPath)));
    const runtimePackage = JSON.parse(fs.readFileSync(runtimePackagePath, 'utf8'));
    const { handleRequest } = require(path.join(runtimeRoot, 'native-host/src/taskRunner.js'));
    const response = await handleRequest({ id: 'runtime-ping', method: 'bridge.ping', params: {} }, {});

    assert.equal(response.ok, true);
    assert.equal(response.result.version, runtimePackage.version);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('native install script writes Linux Chrome manifest under injected HOME', t => {
  if (process.platform === 'win32') {
    t.skip('Linux install path behavior is covered on POSIX runners');
    return;
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-linux-chrome-test-'));
  try {
    const result = spawnSync(process.execPath, [
      path.join(__dirname, '../scripts/install-native-host.mjs'),
      '--platform',
      'linux',
      '--browser',
      'chrome'
    ], {
      env: {
        ...process.env,
        HOME: tempDir
      },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const manifestPath = path.join(tempDir, '.config/google-chrome/NativeMessagingHosts/com.codex.overleaf.json');
    assert.equal(fs.existsSync(manifestPath), true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.path, path.posix.join(tempDir, '.codex-overleaf/codex-overleaf-bridge'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('native install script writes Linux Chromium manifest under injected HOME', t => {
  if (process.platform === 'win32') {
    t.skip('Linux install path behavior is covered on POSIX runners');
    return;
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-linux-chromium-test-'));
  try {
    const result = spawnSync(process.execPath, [
      path.join(__dirname, '../scripts/install-native-host.mjs'),
      '--platform',
      'linux',
      '--browser',
      'chromium'
    ], {
      env: {
        ...process.env,
        HOME: tempDir
      },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const manifestPath = path.join(tempDir, '.config/chromium/NativeMessagingHosts/com.codex.overleaf.json');
    assert.equal(fs.existsSync(manifestPath), true);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.path, path.posix.join(tempDir, '.codex-overleaf/codex-overleaf-bridge'));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('native install script registers Windows Chrome host with reg.exe add', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-win-install-test-'));
  const regLog = path.join(tempDir, 'reg.log');
  const registryEnv = writeFakeRegistryCommand(tempDir);
  const localAppData = getTestWindowsLocalAppData(tempDir);
  const expectedManifestPath = path.win32.join(localAppData, 'CodexOverleaf', 'native-host-runtime', 'com.codex.overleaf.json');

  try {
    const result = spawnSync(process.execPath, [
      path.join(__dirname, '../scripts/install-native-host.mjs'),
      '--platform',
      'win32',
      '--browser',
      'chrome'
    ], {
      cwd: tempDir,
      env: {
        ...process.env,
        ...registryEnv,
        HOME: tempDir,
        LOCALAPPDATA: localAppData,
        REG_LOG: regLog
      },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const regArgs = fs.readFileSync(regLog, 'utf8');
    assert.match(regArgs, /^add\n/);
    assert.match(regArgs, /HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com\.codex\.overleaf/);
    assert.match(regArgs, new RegExp(`/d\\n${escapeRegExp(expectedManifestPath)}`));
    assert.match(result.stdout, /Registered Native Messaging host registry key:/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('native install script uses a .cmd Windows bridge path by default', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-win-cmd-bridge-test-'));
  const regLog = path.join(tempDir, 'reg.log');
  const registryEnv = writeFakeRegistryCommand(tempDir);
  const localAppData = getTestWindowsLocalAppData(tempDir);
  const expectedBridgePath = path.win32.join(localAppData, 'CodexOverleaf', 'codex-overleaf-bridge.cmd');
  const expectedManifestPath = path.win32.join(localAppData, 'CodexOverleaf', 'native-host-runtime', 'com.codex.overleaf.json');

  try {
    const result = spawnSync(process.execPath, [
      path.join(__dirname, '../scripts/install-native-host.mjs'),
      '--platform',
      'win32',
      '--browser',
      'chrome'
    ], {
      cwd: tempDir,
      env: {
        ...process.env,
        ...registryEnv,
        HOME: tempDir,
        LOCALAPPDATA: localAppData,
        REG_LOG: regLog
      },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(
      getDefaultBridgePath({
        platform: 'win32',
        env: {
          LOCALAPPDATA: localAppData
        }
      }),
      expectedBridgePath
    );
    const manifest = JSON.parse(fs.readFileSync(getWindowsSimulationFilePath(tempDir, expectedManifestPath), 'utf8'));
    assert.equal(manifest.path, expectedBridgePath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('native install script rejects unsafe runtime roots before deleting them', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-install-guard-test-'));
  const unsafeRoot = path.join(tempDir, 'user-data');
  const markerPath = path.join(unsafeRoot, 'marker.txt');
  fs.mkdirSync(unsafeRoot, { recursive: true });
  fs.writeFileSync(markerPath, 'keep');

  try {
    const result = spawnSync(process.execPath, [
      path.join(__dirname, '../scripts/install-native-host.mjs'),
      '--runtime-root',
      unsafeRoot
    ], {
      env: {
        ...process.env,
        HOME: tempDir
      },
      encoding: 'utf8'
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing to recursively remove unsafe runtime root/);
    assert.equal(fs.readFileSync(markerPath, 'utf8'), 'keep');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('native uninstall script removes Windows Chrome host with reg.exe delete', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-win-uninstall-test-'));
  const regLog = path.join(tempDir, 'reg.log');
  const registryEnv = writeFakeRegistryCommand(tempDir);

  try {
    const result = spawnSync(process.execPath, [
      path.join(__dirname, '../scripts/uninstall-native-host.mjs'),
      '--platform',
      'win32',
      '--browser',
      'chrome'
    ], {
      cwd: tempDir,
      env: {
        ...process.env,
        ...registryEnv,
        HOME: tempDir,
        LOCALAPPDATA: 'C:\\Users\\Alice\\AppData\\Local',
        REG_LOG: regLog
      },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    const regArgs = fs.readFileSync(regLog, 'utf8');
    assert.match(regArgs, /^delete\n/);
    assert.match(regArgs, /HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com\.codex\.overleaf/);
    assert.match(regArgs, /\/f/);
    assert.match(result.stdout, /Removed Native Messaging host registry key:/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('native uninstall script rejects unsafe runtime roots before deleting them', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-uninstall-guard-test-'));
  const unsafeRoot = path.join(tempDir, 'user-data');
  const markerPath = path.join(unsafeRoot, 'marker.txt');
  fs.mkdirSync(unsafeRoot, { recursive: true });
  fs.writeFileSync(markerPath, 'keep');

  try {
    const result = spawnSync(process.execPath, [
      path.join(__dirname, '../scripts/uninstall-native-host.mjs'),
      '--runtime-root',
      unsafeRoot
    ], {
      env: {
        ...process.env,
        HOME: tempDir
      },
      encoding: 'utf8'
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing to recursively remove unsafe runtime root/);
    assert.equal(fs.readFileSync(markerPath, 'utf8'), 'keep');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('native uninstall script refuses to recursively delete a bridge directory', t => {
  if (process.platform === 'win32') {
    t.skip('Linux uninstall path behavior is covered on POSIX runners');
    return;
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-bridge-dir-guard-test-'));
  const bridgePath = path.join(tempDir, 'bridge-dir');
  const markerPath = path.join(bridgePath, 'marker.txt');
  fs.mkdirSync(bridgePath, { recursive: true });
  fs.writeFileSync(markerPath, 'keep');

  try {
    const result = spawnSync(process.execPath, [
      path.join(__dirname, '../scripts/uninstall-native-host.mjs'),
      '--platform',
      'linux',
      '--browser',
      'chrome',
      '--bridge-path',
      bridgePath,
      '--keep-runtime'
    ], {
      env: {
        ...process.env,
        HOME: tempDir
      },
      encoding: 'utf8'
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing to remove bridge directory/);
    assert.equal(fs.readFileSync(markerPath, 'utf8'), 'keep');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('native uninstall script refuses to recursively delete a manifest directory', t => {
  if (process.platform === 'win32') {
    t.skip('Linux manifest path behavior is covered on POSIX runners');
    return;
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-manifest-dir-guard-test-'));
  const manifestPath = path.join(tempDir, '.config/google-chrome/NativeMessagingHosts/com.codex.overleaf.json');
  const markerPath = path.join(manifestPath, 'marker.txt');
  const bridgePath = path.join(tempDir, 'codex-overleaf-bridge');
  fs.mkdirSync(manifestPath, { recursive: true });
  fs.writeFileSync(markerPath, 'keep');

  try {
    const result = spawnSync(process.execPath, [
      path.join(__dirname, '../scripts/uninstall-native-host.mjs'),
      '--platform',
      'linux',
      '--browser',
      'chrome',
      '--bridge-path',
      bridgePath,
      '--keep-runtime'
    ], {
      env: {
        ...process.env,
        HOME: tempDir
      },
      encoding: 'utf8'
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Refusing to remove Native Messaging host manifest directory/);
    assert.equal(fs.readFileSync(markerPath, 'utf8'), 'keep');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('native uninstall script continues when Windows registry key is already missing', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-win-uninstall-missing-reg-test-'));
  const regLog = path.join(tempDir, 'reg.log');
  const runtimeRoot = path.join(tempDir, 'runtime');
  const bridgePath = path.join(tempDir, 'codex-overleaf-bridge.cmd');
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.writeFileSync(path.join(runtimeRoot, '.codex-overleaf-runtime.json'), JSON.stringify({
    managedBy: 'codex-overleaf-link',
    version: CURRENT_PACKAGE_VERSION,
    installedFrom: 'npm',
    installedAt: new Date().toISOString()
  }));
  fs.writeFileSync(bridgePath, '@echo off\r\n');
  const registryEnv = writeFakeRegistryCommand(tempDir, {
    exitCode: 1,
    stderr: 'ERROR: The system was unable to find the specified registry key or value.\n'
  });

  try {
    const result = spawnSync(process.execPath, [
      path.join(__dirname, '../scripts/uninstall-native-host.mjs'),
      '--platform',
      'win32',
      '--browser',
      'chrome',
      '--runtime-root',
      runtimeRoot,
      '--bridge-path',
      bridgePath
    ], {
      cwd: tempDir,
      env: {
        ...process.env,
        ...registryEnv,
        HOME: tempDir,
        LOCALAPPDATA: 'C:\\Users\\Alice\\AppData\\Local',
        REG_LOG: regLog
      },
      encoding: 'utf8'
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(runtimeRoot), false);
    assert.equal(fs.existsSync(bridgePath), false);
    assert.match(result.stdout, /Native Messaging host registry key not found:/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('repository ships a one-command macOS installer', () => {
  const installer = fs.readFileSync(path.join(__dirname, '../install.sh'), 'utf8');
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');

  assert.match(installer, /CODEX_OVERLEAF_INSTALL_DIR/);
  assert.match(installer, /CODEX_OVERLEAF_REF/);
  assert.match(installer, /github\.com\/Ghqqqq\/codex-overleaf-link\.git/);
  assert.match(installer, /scripts\/install-native-host\.mjs/);
  assert.match(installer, /Package version/);
  assert.match(installer, /Extension path/);
  assert.match(installer, /chrome:\/\/extensions/);
  assert.match(installer, /extension/);
  assert.match(installer, /CODEX_OVERLEAF_EXTENSION_LINK/);
  assert.match(installer, /Codex Overleaf Link Extension/);
  assert.match(installer, /ln -s/);
  assert.match(installer, /pbcopy/);
  assert.match(installer, /open -a "Google Chrome" "chrome:\/\/extensions"/);
  assert.match(installer, /open -R/);
  assert.match(readme, /curl -fsSL "https:\/\/raw\.githubusercontent\.com\/Ghqqqq\/codex-overleaf-link\/main\/install\.sh\?\$\(date \+%s\)" \| bash/);
  assert.match(readme, /~\/Codex Overleaf Link Extension/);
  assert.doesNotMatch(readme, /select `~\/\.codex-overleaf\/source\/extension`/);
});

test('README documents current cross-platform install, uninstall, release artifacts, and Web Store extension id flow', () => {
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');

  assert.match(readme, /curl -fsSL "https:\/\/raw\.githubusercontent\.com\/Ghqqqq\/codex-overleaf-link\/main\/install\.sh\?\$\(date \+%s\)" \| bash/);
  assert.ok(readme.includes(CANONICAL_RELEASE_INSTALL_COMMAND));
  assert.match(readme, new RegExp(`iwr\\s+https://raw\\.githubusercontent\\.com/Ghqqqq/codex-overleaf-link/${escapeRegExp(CURRENT_RELEASE_REF)}/install\\.ps1`, 'i'));
  assert.match(readme, /powershell\s+-ExecutionPolicy\s+Bypass\s+-File\s+install\.ps1/i);
  assert.match(readme, /macOS\s+\/\s+Linux/i);
  assert.match(readme, /Windows/i);
  assert.match(readme, new RegExp(`codex-overleaf-link-extension-${escapeRegExp(CURRENT_RELEASE_REF)}\\.zip`));
  assert.match(readme, /loadable Chrome extension/i);
  assert.match(readme, new RegExp(`codex-overleaf-native-host-${escapeRegExp(CURRENT_RELEASE_REF)}\\.tar\\.gz`));
  assert.match(readme, /native host runtime/i);
  assert.match(readme, /install\.sh/);
  assert.match(readme, /install\.ps1/);
  assert.match(readme, /uninstall-native-host\.mjs/);
  assert.match(readme, /node\s+~\/\.codex-overleaf\/source\/scripts\/uninstall-native-host\.mjs/);
  assert.match(readme, /node\s+\$env:LOCALAPPDATA\\CodexOverleaf\\source\\scripts\\uninstall-native-host\.mjs/);
  assert.match(readme, /native host update required/i);
  assert.match(readme, /CODEX_OVERLEAF_EXTENSION_ID/);
  assert.match(readme, /allowed_origins/);
  assert.doesNotMatch(readme, /version-0\.4\.0-blue/);
  assert.doesNotMatch(readme, /platform-macOS-lightgrey/);
});

test('README pins every Windows release installer command with CODEX_OVERLEAF_REF', () => {
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
  const installCommand = `iwr ${CANONICAL_WINDOWS_RELEASE_INSTALL_URL} -OutFile install.ps1`;
  const installIndexes = [];
  let searchFrom = 0;
  while (true) {
    const index = readme.indexOf(installCommand, searchFrom);
    if (index === -1) {
      break;
    }
    installIndexes.push(index);
    searchFrom = index + installCommand.length;
  }

  assert.ok(installIndexes.length >= 4, 'expected install, update, recovery, and matrix Windows commands');
  for (const index of installIndexes) {
    const segment = readme.slice(index, index + 240);
    assert.ok(segment.includes(CANONICAL_WINDOWS_RELEASE_REF_COMMAND), segment);
    assert.ok(segment.includes(CANONICAL_WINDOWS_RELEASE_RUN_COMMAND), segment);
    assert.ok(
      segment.indexOf(CANONICAL_WINDOWS_RELEASE_REF_COMMAND) < segment.indexOf(CANONICAL_WINDOWS_RELEASE_RUN_COMMAND),
      segment
    );
  }
});

test('README documents Windows cleanup roots and Codex skill loading boundaries', () => {
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');
  const uninstallSection = readme.match(/<summary><strong>Uninstall<\/strong><\/summary>[\s\S]*?<\/details>/)?.[0] || '';

  assert.match(uninstallSection, /%LOCALAPPDATA%\\CodexOverleaf/i);
  assert.match(uninstallSection, /%USERPROFILE%\\.codex-overleaf/i);
  assert.doesNotMatch(
    uninstallSection,
    /\$env:LOCALAPPDATA\\CodexOverleaf` on Windows to remove local mirrors, native runtime files, and plugin history/i
  );
  assert.match(readme, /Remove-Item -Recurse -Force "\$env:LOCALAPPDATA\\CodexOverleaf", "\$env:USERPROFILE\\.codex-overleaf"/);

  assert.match(readme, /`Load local Codex skills`[\s\S]{0,800}~\/\.codex\/skills/);
  assert.match(readme, /`Load local Codex skills`[\s\S]{0,800}plugins/);
  assert.match(readme, /`Load Codex Overleaf skills`[\s\S]{0,800}~\/\.codex-overleaf\/skills/);
  assert.match(readme, /skill loading toggles default to enabled/i);
  assert.match(readme, /isolated `~\/\.codex-overleaf\/codex-home`/i);
  assert.match(readme, /does not write to or reuse global `~\/\.codex\/sessions`/i);
});

test('one-command installer works on macOS Bash 3.2 when extension id is unset', t => {
  if (process.platform === 'win32') {
    t.skip('macOS shell installer behavior is covered on POSIX runners');
    return;
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-install-test-'));
  const binDir = path.join(tempDir, 'bin');
  const installDir = path.join(tempDir, 'source');
  const visibleExtensionLink = path.join(tempDir, 'Codex Overleaf Link Extension');
  const nodeLog = path.join(tempDir, 'node-args.json');
  const openLog = path.join(tempDir, 'open-args.txt');
  const pbcopyLog = path.join(tempDir, 'pbcopy.txt');
  fs.mkdirSync(binDir, { recursive: true });

  fs.writeFileSync(path.join(binDir, 'git'), [
    '#!/bin/bash',
    'if [ "$1" = "clone" ]; then',
    '  target=""',
    '  for arg in "$@"; do target="$arg"; done',
    '  mkdir -p "$target/.git"',
    '  mkdir -p "$target/extension"',
    `  printf '{"version":"${CURRENT_PACKAGE_VERSION}"}\\n' > "$target/package.json"`,
    '  exit 0',
    'fi',
    'exit 0'
  ].join('\n'));
  fs.writeFileSync(path.join(binDir, 'node'), [
    '#!/bin/bash',
    `for arg in "$@"; do printf '%s\\n' "$arg"; done > "${nodeLog}"`,
    'echo "Installed Native Messaging host manifest: $HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.codex.overleaf.json"',
    'echo "Bridge executable: $HOME/.codex-overleaf/codex-overleaf-bridge"',
    'echo "Runtime root: $HOME/.codex-overleaf/native-host-runtime"',
    'exit 0'
  ].join('\n'));
  fs.writeFileSync(path.join(binDir, 'open'), [
    '#!/bin/bash',
    `for arg in "$@"; do printf '%s\\n' "$arg"; done >> "${openLog}"`,
    'exit 0'
  ].join('\n'));
  fs.writeFileSync(path.join(binDir, 'pbcopy'), [
    '#!/bin/bash',
    `cat > "${pbcopyLog}"`,
    'exit 0'
  ].join('\n'));
  fs.chmodSync(path.join(binDir, 'git'), 0o755);
  fs.chmodSync(path.join(binDir, 'node'), 0o755);
  fs.chmodSync(path.join(binDir, 'open'), 0o755);
  fs.chmodSync(path.join(binDir, 'pbcopy'), 0o755);

  const result = spawnSync('/bin/bash', [path.join(__dirname, '../install.sh')], {
    env: {
      HOME: tempDir,
      PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
      CODEX_OVERLEAF_REPO_URL: 'https://example.invalid/repo.git',
      CODEX_OVERLEAF_INSTALL_DIR: installDir
    },
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /CODEX_OVERLEAF_REF: main/);
  assert.match(result.stdout, new RegExp(`Package version: ${escapeRegExp(CURRENT_PACKAGE_VERSION)}`));
  assert.match(result.stdout, /Installed Native Messaging host manifest:/);
  assert.match(result.stdout, /Bridge executable:/);
  assert.match(result.stdout, /Runtime root:/);
  assert.ok(result.stdout.includes(`Extension path: ${path.join(installDir, 'extension')}`));
  assert.match(result.stdout, /Reload the Chrome extension/);
  assert.match(result.stdout, /Refresh the Overleaf page/);
  const nodeArgs = fs.readFileSync(nodeLog, 'utf8');
  assert.match(nodeArgs, /scripts\/install-native-host\.mjs/);
  assert.doesNotMatch(nodeArgs, /--extension-id/);
  assert.equal(fs.readlinkSync(visibleExtensionLink), path.join(installDir, 'extension'));
  assert.equal(fs.readFileSync(pbcopyLog, 'utf8'), visibleExtensionLink);
  const openArgs = fs.readFileSync(openLog, 'utf8');
  assert.match(openArgs, /-a\nGoogle Chrome\nchrome:\/\/extensions/);
  assert.match(openArgs, /-R/);
  assert.match(openArgs, /Codex Overleaf Link Extension/);
});
