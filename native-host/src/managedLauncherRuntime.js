#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const nativeRoot = path.resolve(__dirname, '..');
const managedRoot = path.dirname(nativeRoot);
const extensionRoot = path.join(managedRoot, 'extension');
const activeVersion = readVersionPointer('active-version');
const previousVersion = readVersionPointer('previous-version');
const selectedVersion = selectRunnableVersion(activeVersion, previousVersion);

if (!selectedVersion) {
  process.stderr.write('Codex Overleaf managed native runtime is unavailable. Run install-managed again.\n');
  process.exit(1);
}

const versionRoot = path.join(nativeRoot, 'versions', selectedVersion);
const entryPath = path.join(versionRoot, 'native-host', 'src', 'index.js');
const agentPath = path.join(versionRoot, 'scripts', 'codex-json-agent.mjs');
const env = {
  ...process.env,
  CODEX_OVERLEAF_MANAGED: '1',
  CODEX_OVERLEAF_MANAGED_ROOT: managedRoot,
  CODEX_OVERLEAF_MANAGED_NATIVE_ROOT: nativeRoot,
  CODEX_OVERLEAF_MANAGED_EXTENSION_ROOT: extensionRoot,
  CODEX_OVERLEAF_ACTIVE_VERSION: selectedVersion,
  CODEX_OVERLEAF_AGENT_FILE: process.execPath,
  CODEX_OVERLEAF_AGENT_ARGS_JSON: JSON.stringify([agentPath])
};

const child = spawn(process.execPath, [entryPath], {
  env,
  stdio: 'inherit',
  windowsHide: true
});
child.on('error', error => {
  process.stderr.write('Failed to start Codex Overleaf managed runtime: ' + error.message + '\n');
  process.exit(1);
});
child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(Number.isInteger(code) ? code : 1);
});

function readVersionPointer(name) {
  try {
    const value = fs.readFileSync(path.join(nativeRoot, name), 'utf8').trim();
    return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value) ? value : '';
  } catch (_error) {
    return '';
  }
}

function selectRunnableVersion(active, previous) {
  for (const version of [active, previous]) {
    if (!version) {
      continue;
    }
    const entry = path.join(nativeRoot, 'versions', version, 'native-host', 'src', 'index.js');
    if (fs.existsSync(entry) && fs.statSync(entry).isFile()) {
      return version;
    }
  }
  return '';
}
