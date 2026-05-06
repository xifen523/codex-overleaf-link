'use strict';

const DEFAULT_POSIX_PATH_SEGMENTS = [
  '/Library/TeX/texbin',
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin'
];

function buildLauncher({ platform = process.platform, nodePath, bridgeEntryPath, agentPath, defaultPathSegments }) {
  if (platform === 'win32') {
    return buildWindowsLauncherScript({ nodePath, bridgeEntryPath, agentPath });
  }
  if (platform === 'darwin' || platform === 'linux') {
    return buildLauncherScript({ nodePath, bridgeEntryPath, agentPath, defaultPathSegments });
  }
  throw new Error(`Unsupported launcher platform: ${platform}`);
}

function buildLauncherScript({ nodePath, bridgeEntryPath, agentPath, defaultPathSegments = DEFAULT_POSIX_PATH_SEGMENTS }) {
  const launcherPath = defaultPathSegments.join(':');
  return [
    '#!/bin/sh',
    'set -eu',
    'HOME_DIR="${HOME:-/tmp}"',
    'LOG_DIR="$HOME_DIR/.codex-overleaf"',
    'mkdir -p "$LOG_DIR" 2>/dev/null || true',
    '{',
    '  printf \'%s launcher.start pid=%s ppid=%s home=%s path=%s\\n\' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$$" "${PPID:-}" "$HOME_DIR" "${PATH:-}"',
    '  printf \'%s launcher.node=%s\\n\' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "' + escapeShellSingleQuoted(nodePath) + '"',
    '} >> "$LOG_DIR/native-host-launcher.log" 2>/dev/null || true',
    `export PATH="${escapeDoubleQuoted(launcherPath)}:\${PATH:-}"`,
    `export CODEX_OVERLEAF_AGENT_FILE=${shellSingleQuoted(nodePath)}`,
    `export CODEX_OVERLEAF_AGENT_ARGS_JSON=${shellSingleQuoted(JSON.stringify([agentPath]))}`,
    `exec "${escapeDoubleQuoted(nodePath)}" "${escapeDoubleQuoted(bridgeEntryPath)}"`,
    ''
  ].join('\n');
}

function buildWindowsLauncherScript({ nodePath, bridgeEntryPath, agentPath }) {
  return [
    '@echo off',
    'setlocal',
    `set "CODEX_OVERLEAF_AGENT_FILE=${escapeBatchSetValue(nodePath)}"`,
    `set CODEX_OVERLEAF_AGENT_ARGS_JSON=${escapeBatchRawSetValue(JSON.stringify([agentPath]))}`,
    `"${escapeBatchCommandArg(nodePath)}" "${escapeBatchCommandArg(bridgeEntryPath)}"`,
    ''
  ].join('\r\n');
}

function escapeDoubleQuoted(value) {
  return String(value).replace(/(["\\$`])/g, '\\$1');
}

function escapeShellSingleQuoted(value) {
  return String(value).replace(/'/g, "'\\''");
}

function shellSingleQuoted(value) {
  return `'${escapeShellSingleQuoted(value)}'`;
}

function escapeBatchSetValue(value) {
  return String(value).replace(/%/g, '%%').replace(/"/g, '""');
}

function escapeBatchCommandArg(value) {
  return String(value).replace(/%/g, '%%').replace(/"/g, '""');
}

function escapeBatchRawSetValue(value) {
  return String(value).replace(/%/g, '%%').replace(/[\r\n]/g, '');
}

module.exports = {
  buildLauncher,
  buildLauncherScript
};
