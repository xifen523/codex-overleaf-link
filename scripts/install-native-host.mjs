#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  buildAllowedOrigin,
  buildHostManifest,
  validateChromeExtensionId
} from '../native-host/src/manifest.js';
import { buildLauncher } from '../native-host/src/launcher.js';
import {
  getDefaultBridgePath,
  getDefaultRuntimeRoot,
  getNativeHostRegistrationTarget
} from '../native-host/src/nativeHostPlatform.js';

const require = createRequire(import.meta.url);
const { installRuntimeFromPackage } = require('../native-host/src/runtimeInstaller.js');
const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const defaultPackageRoot = path.resolve(scriptDir, '..');

export function installNativeHost(options = {}) {
  const extensionId = options.extensionId;
  if (!extensionId) {
    throw new Error('Missing required --extension-id <chrome-extension-id>. Load the extension in chrome://extensions and pass the id shown by Chrome.');
  }
  if (!validateChromeExtensionId(extensionId)) {
    throw new Error(`Invalid Chrome extension id: ${extensionId}`);
  }

  const packageRoot = path.resolve(options.packageRoot || defaultPackageRoot);
  const extensionIds = [extensionId];
  const platform = options.platform || process.platform;
  const browser = options.browser || 'chrome';
  assertSupportedBrowser(browser);

  const env = options.env || process.env;
  const platformPath = platform === 'win32' ? path.win32 : path.posix;
  const runtimePlatformPath = options.runtimeRoot && path.isAbsolute(options.runtimeRoot) ? path : platformPath;
  const defaultInstallRoot = getDefaultRuntimeRoot({ platform, browser, env });
  const installRoot = resolveForPlatform(options.runtimeRoot || defaultInstallRoot, platformPath);
  const bridgeEntryPath = platformPath.join(installRoot, 'native-host', 'src', 'index.js');
  const agentPath = platformPath.join(installRoot, 'scripts', 'codex-json-agent.mjs');
  const defaultBridgePath = getDefaultBridgePath({ platform, browser, env });
  const bridgePath = resolveForPlatform(options.bridgePath || defaultBridgePath, platformPath);
  const registrationTarget = getNativeHostRegistrationTarget({
    platform,
    browser,
    env
  });
  const manifestPath = registrationTarget.manifestPath;
  const manifest = buildHostManifest({
    extensionId,
    extensionIds,
    bridgePath,
    platform
  });

  const runtimeInstall = installRuntimeFromPackage({
    packageRoot,
    runtimeRoot: installRoot,
    defaultRuntimeRoot: defaultInstallRoot,
    platformPath: runtimePlatformPath
  });
  const runtimePackageVersion = readRuntimePackageVersion(path.join(installRoot, 'package.json'));

  fs.mkdirSync(platformPath.dirname(bridgePath), { recursive: true });
  fs.writeFileSync(bridgePath, buildLauncher({
    platform,
    nodePath: process.execPath,
    bridgeEntryPath,
    agentPath
  }), 'utf8');
  if (platform !== 'win32') {
    fs.chmodSync(bridgePath, 0o755);
  }

  fs.mkdirSync(platformPath.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  if (registrationTarget.kind === 'registry') {
    addWindowsRegistryValue(registrationTarget.registryKey, manifestPath);
  }

  return {
    ok: true,
    action: runtimeInstall.action,
    browser: registrationTarget.browser,
    extensionId,
    manifest: {
      path: manifestPath,
      allowedOrigin: buildAllowedOrigin(extensionId),
      allowedOrigins: manifest.allowed_origins
    },
    bridge: {
      path: bridgePath
    },
    runtime: {
      root: installRoot,
      action: runtimeInstall.action,
      packageVersion: runtimePackageVersion
    },
    registry: registrationTarget.kind === 'registry'
      ? { key: registrationTarget.registryKey }
      : undefined,
    warning: runtimeInstall.warning
  };
}

export function formatInstallNativeHostHuman(result) {
  const lines = [`Installed Native Messaging host manifest: ${result.manifest.path}`];
  if (result.registry) {
    lines.push(`Registered Native Messaging host registry key: ${result.registry.key}`);
  }
  lines.push(`Bridge executable: ${result.bridge.path}`);
  lines.push(`Runtime root: ${result.runtime.root}`);
  lines.push(`Runtime package version: ${result.runtime.packageVersion}`);
  lines.push(`Allowed Chrome extension id: ${result.extensionId}`);
  lines.push(`Allowed Chrome extension ids: ${result.manifest.allowedOrigins.map(origin => origin.replace(/^chrome-extension:\/\//, '').replace(/\/$/, '')).join(', ')}`);
  if (result.warning) {
    lines.push(`Warning: ${result.warning}`);
  }
  return `${lines.join('\n')}\n`;
}

function resolveForPlatform(targetPath, platformPathModule) {
  if (platformPathModule.isAbsolute(targetPath)) {
    return targetPath;
  }
  return platformPathModule.resolve(targetPath);
}

function readRuntimePackageVersion(packagePath) {
  try {
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    return typeof pkg.version === 'string' && pkg.version ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

function addWindowsRegistryValue(registryKey, manifestPath) {
  const registryCommand = getWindowsRegistryCommand();
  const result = spawnSync(registryCommand.file, [
    ...registryCommand.args,
    'add',
    registryKey,
    '/ve',
    '/t',
    'REG_SZ',
    '/d',
    manifestPath,
    '/f'
  ], {
    encoding: 'utf8'
  });
  if (result.error) {
    throw new Error(`Failed to run ${registryCommand.file}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `reg.exe add failed with status ${result.status}`);
  }
}

function getWindowsRegistryCommand() {
  return {
    file: process.env.CODEX_OVERLEAF_REG_EXE || 'reg.exe',
    args: parseStringArrayEnv(process.env.CODEX_OVERLEAF_REG_EXE_ARGS_JSON)
  };
}

function parseStringArrayEnv(value) {
  if (!value) {
    return [];
  }
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed) || !parsed.every(item => typeof item === 'string')) {
    throw new Error('CODEX_OVERLEAF_REG_EXE_ARGS_JSON must be a JSON array of strings');
  }
  return parsed;
}

function assertSupportedBrowser(browser) {
  if (!['auto', 'chrome', 'chromium'].includes(browser)) {
    throw new Error('Usage: --browser must be one of chrome, chromium, or auto');
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--extension-id') {
      parsed.extensionId = readOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === '--bridge-path') {
      parsed.bridgePath = readOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === '--runtime-root') {
      parsed.runtimeRoot = readOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === '--browser') {
      parsed.browser = readOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === '--platform') {
      parsed.platform = readOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === '--force') {
      parsed.force = true;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--help') {
      parsed.help = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return parsed;
}

function readOptionValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${optionName}`);
  }
  return value;
}

function printUsage() {
  console.log('Usage: install-native-host.mjs --extension-id <id> [--browser chrome|chromium|auto] [--runtime-root <path>] [--json]');
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printUsage();
      return;
    }
    const result = installNativeHost(args);
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      process.stdout.write(formatInstallNativeHostHuman(result));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (path.resolve(process.argv[1] || '') === scriptPath) {
  await main();
}
