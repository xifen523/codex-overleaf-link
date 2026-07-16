'use strict';

const fs = require('node:fs');
const { buildNativeRuntimeEnv } = require('./nativeEnvironment');

function resolveCodexCommand(env = process.env, options = {}) {
  const prepared = (
    env.CODEX_OVERLEAF_ENV_READY === '1' ||
    Object.prototype.hasOwnProperty.call(env, 'CODEX_OVERLEAF_CODEX_PATH')
  );
  if (!prepared) {
    return 'codex';
  }

  const existsSync = options.existsSync || fs.existsSync;
  const configured = String(env.CODEX_OVERLEAF_CODEX_PATH || '');
  if (!configured) {
    return '';
  }
  if (existsSync(configured)) {
    return configured;
  }

  const rebuild = options.buildNativeRuntimeEnv || buildNativeRuntimeEnv;
  const refreshed = rebuild(env) || {};
  Object.assign(env, refreshed);
  return String(refreshed.CODEX_OVERLEAF_CODEX_PATH || '');
}

function shouldUseShellForCommand(command, env = process.env) {
  const platform = env.CODEX_OVERLEAF_PLATFORM || process.platform;
  if (platform !== 'win32') {
    return false;
  }
  const text = String(command || '');
  return text === 'codex' || /\.(?:cmd|bat)$/i.test(text);
}

module.exports = {
  resolveCodexCommand,
  shouldUseShellForCommand
};
