#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getChromeNativeHostManifestPath } from '../native-host/src/manifest.js';

const args = parseArgs(process.argv.slice(2));
const defaultInstallRoot = path.join(os.homedir(), '.codex-overleaf', 'native-host-runtime');
const installRoot = path.resolve(args.runtimeRoot || defaultInstallRoot);
const defaultBridgePath = path.join(os.homedir(), '.codex-overleaf', 'codex-overleaf-bridge');
const bridgePath = path.resolve(args.bridgePath || defaultBridgePath);
const manifestPath = getChromeNativeHostManifestPath();

removePath(manifestPath, 'Native Messaging host manifest');
removePath(bridgePath, 'Bridge executable');
if (!args.keepRuntime) {
  removePath(installRoot, 'Runtime root');
}

console.log('Codex Overleaf native host uninstall finished.');
console.log('Project mirrors and plugin Codex history under ~/.codex-overleaf are left intact.');

function removePath(target, label) {
  if (!fs.existsSync(target)) {
    console.log(`${label} not found: ${target}`);
    return;
  }
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`Removed ${label}: ${target}`);
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
    }
  }
  return parsed;
}
