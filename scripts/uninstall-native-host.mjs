#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import {
  getDefaultBridgePath,
  getDefaultRuntimeRoot,
  getNativeHostRegistrationTarget
} from '../native-host/src/nativeHostPlatform.js';

const require = createRequire(import.meta.url);
const { uninstallManagedRuntime } = require('../native-host/src/runtimeInstaller.js');

const args = parseArgs(process.argv.slice(2));
const platform = args.platform || process.platform;
const browser = args.browser || 'chrome';
const platformPath = platform === 'win32' ? path.win32 : path.posix;
const runtimePlatformPath = args.runtimeRoot && path.isAbsolute(args.runtimeRoot) ? path : platformPath;
const defaultInstallRoot = getDefaultRuntimeRoot({ platform, browser, env: process.env });
const installRoot = resolveForPlatform(args.runtimeRoot || defaultInstallRoot, platformPath);
const defaultBridgePath = getDefaultBridgePath({ platform, browser, env: process.env });
const bridgePath = resolveForPlatform(args.bridgePath || defaultBridgePath, platformPath);
const registrationTarget = getNativeHostRegistrationTarget({
  platform,
  browser,
  env: process.env
});
const manifestPath = registrationTarget.manifestPath;

removeManifestPath(manifestPath);
if (registrationTarget.kind === 'registry') {
  if (deleteWindowsRegistryValue(registrationTarget.registryKey)) {
    console.log(`Removed Native Messaging host registry key: ${registrationTarget.registryKey}`);
  } else {
    console.log(`Native Messaging host registry key not found: ${registrationTarget.registryKey}`);
  }
}
removeBridgePath(bridgePath);
if (!args.keepRuntime) {
  const result = uninstallManagedRuntime({
    runtimeRoot: installRoot,
    defaultRuntimeRoot: defaultInstallRoot,
    platformPath: runtimePlatformPath
  });
  if (result.action === 'not-found') {
    console.log(`Runtime root not found: ${installRoot}`);
  } else if (result.removed) {
    console.log(`Removed Runtime root: ${installRoot}`);
  }
}

console.log('Codex Overleaf native host uninstall finished.');
console.log('Project mirrors and plugin Codex history under ~/.codex-overleaf are left intact.');

function resolveForPlatform(targetPath, platformPathModule) {
  if (platformPathModule.isAbsolute(targetPath)) {
    return targetPath;
  }
  return platformPathModule.resolve(targetPath);
}

function removePath(target, label) {
  if (!fs.existsSync(target)) {
    console.log(`${label} not found: ${target}`);
    return;
  }
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`Removed ${label}: ${target}`);
}

function removeManifestPath(target) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      console.log(`Native Messaging host manifest not found: ${target}`);
      return;
    }
    throw error;
  }

  if (stat.isDirectory()) {
    throw new Error(`Refusing to remove Native Messaging host manifest directory: ${target}`);
  }

  fs.rmSync(target, { force: true });
  console.log(`Removed Native Messaging host manifest: ${target}`);
}

function removeBridgePath(target) {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      console.log(`Bridge executable not found: ${target}`);
      return;
    }
    throw error;
  }

  if (stat.isDirectory()) {
    throw new Error(`Refusing to remove bridge directory: ${target}`);
  }

  fs.rmSync(target, { force: true });
  console.log(`Removed Bridge executable: ${target}`);
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

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--bridge-path') {
      parsed.bridgePath = argv[index + 1];
      index += 1;
    } else if (arg === '--runtime-root') {
      parsed.runtimeRoot = argv[index + 1];
      index += 1;
    } else if (arg === '--keep-runtime') {
      parsed.keepRuntime = true;
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
