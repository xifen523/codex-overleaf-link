#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  getDefaultBridgePath,
  getDefaultRuntimeRoot,
  getNativeHostRegistrationTarget
} from '../native-host/src/nativeHostPlatform.js';

const require = createRequire(import.meta.url);
const { uninstallManagedRuntime } = require('../native-host/src/runtimeInstaller.js');
const scriptPath = fileURLToPath(import.meta.url);

export function uninstallNativeHost(options = {}) {
  const platform = options.platform || process.platform;
  const browser = options.browser || 'chrome';
  assertSupportedBrowser(browser);

  const env = options.env || process.env;
  const platformPath = platform === 'win32' ? path.win32 : path.posix;
  const runtimePlatformPath = options.runtimeRoot && path.isAbsolute(options.runtimeRoot) ? path : platformPath;
  const defaultInstallRoot = getDefaultRuntimeRoot({ platform, browser, env });
  const installRoot = resolveForPlatform(options.runtimeRoot || defaultInstallRoot, platformPath);
  const defaultBridgePath = getDefaultBridgePath({ platform, browser, env });
  const bridgePath = resolveForPlatform(options.bridgePath || defaultBridgePath, platformPath);
  const registrationTarget = getNativeHostRegistrationTarget({
    platform,
    browser,
    env
  });
  const manifestPath = registrationTarget.manifestPath;

  const manifest = removeManifestPath(manifestPath);
  const registry = registrationTarget.kind === 'registry'
    ? removeRegistryValue(registrationTarget.registryKey)
    : undefined;
  const bridge = options.keepRuntime
    ? { path: bridgePath, action: 'kept', removed: false, kept: true }
    : removeBridgePath(bridgePath);
  const runtimeResult = uninstallManagedRuntime({
    runtimeRoot: installRoot,
    defaultRuntimeRoot: defaultInstallRoot,
    platformPath: runtimePlatformPath,
    keepRuntime: Boolean(options.keepRuntime)
  });
  const runtime = summarizeRuntimeResult(runtimeResult);

  return {
    ok: true,
    status: deriveStatus({ manifest, runtime, keepRuntime: Boolean(options.keepRuntime) }),
    keepRuntime: Boolean(options.keepRuntime),
    browser: registrationTarget.browser,
    manifest,
    registry,
    bridge,
    runtime
  };
}

export function formatUninstallNativeHostHuman(result) {
  const lines = [];
  if (result.manifest.removed) {
    lines.push(`Removed Native Messaging host manifest: ${result.manifest.path}`);
  } else {
    lines.push(`Native Messaging host manifest not found: ${result.manifest.path}`);
  }
  if (result.registry) {
    if (result.registry.removed) {
      lines.push(`Removed Native Messaging host registry key: ${result.registry.key}`);
    } else {
      lines.push(`Native Messaging host registry key not found: ${result.registry.key}`);
    }
  }
  if (result.bridge.action === 'kept') {
    lines.push(`Kept Bridge executable: ${result.bridge.path}`);
  } else if (result.bridge.removed) {
    lines.push(`Removed Bridge executable: ${result.bridge.path}`);
  } else {
    lines.push(`Bridge executable not found: ${result.bridge.path}`);
  }
  if (result.runtime.action === 'not-found') {
    lines.push(`Runtime root not found: ${result.runtime.root}`);
  } else if (result.runtime.kept) {
    lines.push(`Kept Runtime root: ${result.runtime.root}`);
  } else if (result.runtime.removed) {
    lines.push(`Removed Runtime root: ${result.runtime.root}`);
  }
  lines.push('Codex Overleaf native host uninstall finished.');
  lines.push('Project mirrors and plugin Codex history under ~/.codex-overleaf are left intact.');
  return `${lines.join('\n')}\n`;
}

function resolveForPlatform(targetPath, platformPathModule) {
  if (platformPathModule.isAbsolute(targetPath)) {
    return targetPath;
  }
  return platformPathModule.resolve(targetPath);
}

function removeManifestPath(target) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { path: target, action: 'not-found', removed: false };
    }
    throw error;
  }

  if (stat.isDirectory()) {
    throw new Error(`Refusing to remove Native Messaging host manifest directory: ${target}`);
  }

  fs.rmSync(target, { force: true });
  return { path: target, action: 'removed', removed: true };
}

function removeBridgePath(target) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return { path: target, action: 'not-found', removed: false };
    }
    throw error;
  }

  if (stat.isDirectory()) {
    throw new Error(`Refusing to remove bridge directory: ${target}`);
  }

  fs.rmSync(target, { force: true });
  return { path: target, action: 'removed', removed: true };
}

function removeRegistryValue(registryKey) {
  if (deleteWindowsRegistryValue(registryKey)) {
    return { key: registryKey, action: 'removed', removed: true };
  }
  return { key: registryKey, action: 'not-found', removed: false };
}

function deleteWindowsRegistryValue(registryKey) {
  const registryCommand = getWindowsRegistryCommand();
  const result = spawnSync(registryCommand.file, [
    ...registryCommand.args,
    'delete',
    registryKey,
    '/f'
  ], {
    encoding: 'utf8'
  });
  if (result.error) {
    throw new Error(`Failed to run ${registryCommand.file}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const output = `${result.stderr || ''}\n${result.stdout || ''}`;
    if (/unable to find the specified registry key or value/i.test(output)) {
      return false;
    }
    throw new Error(result.stderr || result.stdout || `reg.exe delete failed with status ${result.status}`);
  }
  return true;
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

function summarizeRuntimeResult(result) {
  return {
    root: result.runtimeRoot,
    action: result.action,
    removed: Boolean(result.removed),
    kept: Boolean(result.kept),
    markerManagedBy: result.marker && result.marker.managedBy,
    markerVersion: result.marker && result.marker.version
  };
}

function deriveStatus({ manifest, runtime, keepRuntime }) {
  if (keepRuntime) {
    return manifest.removed ? 'manifest-removed-runtime-kept' : 'manifest-not-found-runtime-kept';
  }
  if (manifest.action === 'not-found' && runtime.action === 'not-found') {
    return 'not-found';
  }
  return 'uninstalled';
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
    if (arg === '--bridge-path') {
      parsed.bridgePath = readOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === '--runtime-root') {
      parsed.runtimeRoot = readOptionValue(argv, index, arg);
      index += 1;
    } else if (arg === '--keep-runtime') {
      parsed.keepRuntime = true;
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
  console.log('Usage: uninstall-native-host.mjs [--browser chrome|chromium|auto] [--runtime-root <path>] [--keep-runtime] [--json]');
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    if (args.help) {
      printUsage();
      return;
    }
    const result = uninstallNativeHost(args);
    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      process.stdout.write(formatUninstallNativeHostHuman(result));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (path.resolve(process.argv[1] || '') === scriptPath) {
  await main();
}
