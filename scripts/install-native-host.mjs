#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_CHROME_EXTENSION_ID,
  buildHostManifest,
  getChromeNativeHostManifestPath,
  validateChromeExtensionId
} from '../native-host/src/manifest.js';
import { buildLauncherScript } from '../native-host/src/launcher.js';

const args = parseArgs(process.argv.slice(2));
const extensionId = args.extensionId || DEFAULT_CHROME_EXTENSION_ID;

if (!validateChromeExtensionId(extensionId)) {
  console.error('Usage: npm run install:native -- [--extension-id <32-letter-chrome-extension-id>]');
  process.exit(2);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultInstallRoot = path.join(os.homedir(), '.codex-overleaf', 'native-host-runtime');
const installRoot = path.resolve(args.runtimeRoot || defaultInstallRoot);
const bridgeEntryPath = path.join(installRoot, 'native-host/src/index.js');
const agentPath = path.join(installRoot, 'scripts/codex-json-agent.mjs');
const defaultBridgePath = path.join(os.homedir(), '.codex-overleaf', 'codex-overleaf-bridge');
const bridgePath = path.resolve(args.bridgePath || defaultBridgePath);
const manifestPath = getChromeNativeHostManifestPath();
const manifest = buildHostManifest({
  extensionId,
  bridgePath
});

installRuntime(installRoot);
fs.mkdirSync(path.dirname(bridgePath), { recursive: true });
fs.writeFileSync(bridgePath, buildLauncherScript({
  nodePath: process.execPath,
  bridgeEntryPath,
  agentPath
}), 'utf8');
fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
fs.chmodSync(bridgePath, 0o755);
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(`Installed Native Messaging host manifest: ${manifestPath}`);
console.log(`Bridge executable: ${bridgePath}`);
console.log(`Runtime root: ${installRoot}`);
console.log(`Allowed Chrome extension id: ${extensionId}`);

function installRuntime(targetRoot) {
  fs.rmSync(targetRoot, { recursive: true, force: true });
  copyFile(path.resolve(__dirname, '../package.json'), path.join(targetRoot, 'package.json'));
  copyDirectory(path.resolve(__dirname, '../native-host/src'), path.join(targetRoot, 'native-host/src'));
  copyDirectory(path.resolve(__dirname, '../extension/src/shared'), path.join(targetRoot, 'extension/src/shared'));
  copyFile(path.resolve(__dirname, './codex-json-agent.mjs'), path.join(targetRoot, 'scripts/codex-json-agent.mjs'));
}

function copyDirectory(source, target) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
    } else if (entry.isFile()) {
      copyFile(sourcePath, targetPath);
    }
  }
}

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
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
    }
  }
  return parsed;
}
