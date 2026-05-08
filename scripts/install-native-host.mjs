#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CHROME_EXTENSION_ID,
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

const args = parseArgs(process.argv.slice(2));
const extensionId = args.extensionId || DEFAULT_CHROME_EXTENSION_ID;
const extensionIds = [DEFAULT_CHROME_EXTENSION_ID, extensionId];

if (!validateChromeExtensionId(extensionId)) {
  console.error('Usage: npm run install:native -- [--extension-id <32-letter-chrome-extension-id>]');
  process.exit(2);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const platform = args.platform || process.platform;
const browser = args.browser || 'chrome';
const platformPath = platform === 'win32' ? path.win32 : path.posix;
const runtimePlatformPath = args.runtimeRoot && path.isAbsolute(args.runtimeRoot) ? path : platformPath;
const defaultInstallRoot = getDefaultRuntimeRoot({ platform, browser, env: process.env });
const installRoot = resolveForPlatform(args.runtimeRoot || defaultInstallRoot, platformPath);
const bridgeEntryPath = platformPath.join(installRoot, 'native-host', 'src', 'index.js');
const agentPath = platformPath.join(installRoot, 'scripts', 'codex-json-agent.mjs');
const defaultBridgePath = getDefaultBridgePath({ platform, browser, env: process.env });
const bridgePath = resolveForPlatform(args.bridgePath || defaultBridgePath, platformPath);
const registrationTarget = getNativeHostRegistrationTarget({
  platform,
  browser,
  env: process.env
});
const manifestPath = registrationTarget.manifestPath;
const manifest = buildHostManifest({
  extensionId,
  extensionIds,
  bridgePath,
  platform
});

installRuntimeFromPackage({
  packageRoot: path.resolve(__dirname, '..'),
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

if (registrationTarget.kind === 'registry') {
  console.log(`Installed Native Messaging host manifest: ${manifestPath}`);
  console.log(`Registered Native Messaging host registry key: ${registrationTarget.registryKey}`);
} else {
  console.log(`Installed Native Messaging host manifest: ${manifestPath}`);
}
console.log(`Bridge executable: ${bridgePath}`);
console.log(`Runtime root: ${installRoot}`);
console.log(`Runtime package version: ${runtimePackageVersion}`);
console.log(`Allowed Chrome extension id: ${extensionId}`);
console.log(`Allowed Chrome extension ids: ${Array.from(new Set(extensionIds)).join(', ')}`);

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

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--extension-id') {
      parsed.extensionId = argv[index + 1];
      index += 1;
    } else if (arg === '--bridge-path') {
      parsed.bridgePath = argv[index + 1];
      index += 1;
    } else if (arg === '--runtime-root') {
      parsed.runtimeRoot = argv[index + 1];
      index += 1;
    } else if (arg === '--browser') {
      parsed.browser = argv[index + 1];
      index += 1;
    } else if (arg === '--platform') {
      parsed.platform = argv[index + 1];
      index += 1;
    }
  }
  return parsed;
}
