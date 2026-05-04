'use strict';

function buildLauncherScript({ nodePath, bridgeEntryPath, agentPath }) {
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
    'export PATH="/Library/TeX/texbin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:${PATH:-}"',
    `export CODEX_OVERLEAF_AGENT_FILE=${shellSingleQuoted(nodePath)}`,
    `export CODEX_OVERLEAF_AGENT_ARGS_JSON=${shellSingleQuoted(JSON.stringify([agentPath]))}`,
    `exec "${escapeDoubleQuoted(nodePath)}" "${escapeDoubleQuoted(bridgeEntryPath)}"`,
    ''
  ].join('\n');
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

module.exports = {
  buildLauncherScript
};
