'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TOOL_NAMES = ['codex', 'latexmk', 'pdflatex', 'xelatex', 'lualatex', 'bibtex', 'biber'];
const LATEX_TOOL_NAMES = ['latexmk', 'pdflatex', 'xelatex', 'lualatex', 'bibtex', 'biber'];

function buildNativeRuntimeEnv(baseEnv = process.env, options = {}) {
  const env = { ...baseEnv };
  const loginShellEnv = options.readLoginShellEnv
    ? options.readLoginShellEnv(baseEnv)
    : readLoginShellEnv(baseEnv);
  const defaultPathSegments = Object.hasOwn(options, 'defaultPathSegments')
    ? options.defaultPathSegments
    : getDefaultPathSegments(baseEnv);
  const pathSegments = [
    loginShellEnv?.PATH,
    baseEnv.PATH,
    ...defaultPathSegments
  ];

  env.PATH = mergePathSegments(pathSegments);
  env.CODEX_OVERLEAF_ENV_READY = '1';

  for (const tool of TOOL_NAMES) {
    env[getToolEnvName(tool)] = resolveExecutable(tool, env.PATH) || '';
  }

  return env;
}

function readLoginShellEnv(baseEnv = process.env) {
  if (baseEnv.CODEX_OVERLEAF_DISABLE_SHELL_ENV === '1') {
    return null;
  }

  const shell = selectLoginShell(baseEnv);
  if (!shell) {
    return null;
  }

  const command = [
    'printf "__CODEX_OVERLEAF_ENV_START__\\n"',
    'printf "PATH=%s\\n" "$PATH"',
    'printf "__CODEX_OVERLEAF_ENV_END__\\n"'
  ].join('; ');
  const args = shouldUseLoginFlag(shell) ? ['-l', '-i', '-c', command] : ['-c', command];
  const result = spawnSync(shell, args, {
    env: {
      ...baseEnv,
      PATH: baseEnv.PATH || '/usr/bin:/bin:/usr/sbin:/sbin'
    },
    encoding: 'utf8',
    timeout: 1500,
    maxBuffer: 64 * 1024
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  return parseMarkedShellEnv(result.stdout || '');
}

function parseMarkedShellEnv(output) {
  const match = String(output).match(/__CODEX_OVERLEAF_ENV_START__\n([\s\S]*?)\n__CODEX_OVERLEAF_ENV_END__/);
  if (!match) {
    return null;
  }

  const env = {};
  for (const line of match[1].split(/\r?\n/)) {
    const index = line.indexOf('=');
    if (index <= 0) {
      continue;
    }
    env[line.slice(0, index)] = line.slice(index + 1);
  }
  return env;
}

function selectLoginShell(env = process.env) {
  const candidates = [
    env.SHELL,
    '/bin/zsh',
    '/bin/bash',
    '/bin/sh'
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) {
      continue;
    }
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Try the next common shell.
    }
  }
  return '';
}

function shouldUseLoginFlag(shell) {
  return ['zsh', 'bash'].includes(path.basename(shell));
}

function getDefaultPathSegments(env = process.env) {
  const home = env.HOME || os.homedir();
  return [
    path.dirname(process.execPath),
    path.join(home, '.local/bin'),
    path.join(home, '.npm-global/bin'),
    path.join(home, 'bin'),
    '/Library/TeX/texbin',
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin'
  ];
}

function mergePathSegments(values) {
  const seen = new Set();
  const merged = [];
  for (const value of values) {
    for (const segment of String(value || '').split(path.delimiter)) {
      const clean = segment.trim();
      if (!clean || seen.has(clean)) {
        continue;
      }
      seen.add(clean);
      merged.push(clean);
    }
  }
  return merged.join(path.delimiter);
}

function resolveExecutable(name, pathValue) {
  for (const directory of String(pathValue || '').split(path.delimiter)) {
    if (!directory) {
      continue;
    }
    const candidate = path.join(directory, name);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Keep searching PATH.
    }
  }
  return '';
}

function summarizeNativeEnvironment(env = process.env) {
  const availableLatex = LATEX_TOOL_NAMES.filter(tool => Boolean(env[getToolEnvName(tool)]));
  const missingLatex = LATEX_TOOL_NAMES.filter(tool => !env[getToolEnvName(tool)]);
  return {
    codex: {
      ok: Boolean(env.CODEX_OVERLEAF_CODEX_PATH),
      path: env.CODEX_OVERLEAF_CODEX_PATH || ''
    },
    latex: {
      ok: availableLatex.length > 0,
      available: availableLatex,
      missing: missingLatex,
      tools: Object.fromEntries(LATEX_TOOL_NAMES.map(tool => [tool, env[getToolEnvName(tool)] || '']))
    },
    pathPreview: String(env.PATH || '').split(path.delimiter).filter(Boolean).slice(0, 12)
  };
}

function getToolEnvName(tool) {
  return `CODEX_OVERLEAF_${String(tool).replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}_PATH`;
}

module.exports = {
  buildNativeRuntimeEnv,
  getDefaultPathSegments,
  mergePathSegments,
  parseMarkedShellEnv,
  readLoginShellEnv,
  resolveExecutable,
  summarizeNativeEnvironment
};
