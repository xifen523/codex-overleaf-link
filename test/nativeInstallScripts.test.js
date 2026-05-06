const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { DEFAULT_CHROME_EXTENSION_ID } = require('../native-host/src/manifest');
const { getDefaultBridgePath } = require('../native-host/src/nativeHostPlatform');

const CANONICAL_V050_INSTALL_COMMAND = 'CODEX_OVERLEAF_REF=v0.5.0 bash -c "$(curl -fsSL https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/v0.5.0/install.sh)"';

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
    assert.match(result.stdout, /Runtime package version: 0\.5\.0/);
    const runtimePackagePath = path.join(runtimeRoot, 'package.json');
    assert.equal(fs.existsSync(runtimePackagePath), true);
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

test('native uninstall script continues when Windows registry key is already missing', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-win-uninstall-missing-reg-test-'));
  const regLog = path.join(tempDir, 'reg.log');
  const runtimeRoot = path.join(tempDir, 'runtime');
  const bridgePath = path.join(tempDir, 'codex-overleaf-bridge.cmd');
  fs.mkdirSync(runtimeRoot, { recursive: true });
  fs.writeFileSync(path.join(runtimeRoot, 'marker.txt'), 'remove');
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

test('README documents v0.5 cross-platform install, uninstall, release artifacts, and Web Store extension id flow', () => {
  const readme = fs.readFileSync(path.join(__dirname, '../README.md'), 'utf8');

  assert.match(readme, /curl -fsSL "https:\/\/raw\.githubusercontent\.com\/Ghqqqq\/codex-overleaf-link\/main\/install\.sh\?\$\(date \+%s\)" \| bash/);
  assert.ok(readme.includes(CANONICAL_V050_INSTALL_COMMAND));
  assert.match(readme, /iwr\s+https:\/\/raw\.githubusercontent\.com\/Ghqqqq\/codex-overleaf-link\/v0\.5\.0\/install\.ps1/i);
  assert.match(readme, /powershell\s+-ExecutionPolicy\s+Bypass\s+-File\s+install\.ps1/i);
  assert.match(readme, /macOS\s+\/\s+Linux/i);
  assert.match(readme, /Windows/i);
  assert.match(readme, /codex-overleaf-link-extension-v0\.5\.0\.zip/);
  assert.match(readme, /loadable Chrome extension/i);
  assert.match(readme, /codex-overleaf-native-host-v0\.5\.0\.tar\.gz/);
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
    '  printf \'{"version":"0.5.0"}\\n\' > "$target/package.json"',
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
  assert.match(result.stdout, /Package version: 0\.5\.0/);
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
