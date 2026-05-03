'use strict';

const fs = require('node:fs');
const path = require('node:path');

const COPIED_USER_CODEX_FILES = [
  'auth.json',
  'config.toml',
  'AGENTS.md',
  'installation_id',
  'models_cache.json',
  'version.json'
];

const LINKED_USER_CODEX_DIRS = [
  'skills',
  'plugins',
  'superpowers',
  'rules',
  'memories',
  'vendor_imports'
];

const HISTORY_DIRS = [
  'sessions',
  'archived_sessions',
  'history'
];

function getUserCodexHome(env = process.env) {
  const home = env.HOME || process.env.HOME || process.cwd();
  return path.resolve(env.CODEX_OVERLEAF_USER_CODEX_HOME || env.CODEX_HOME || path.join(home, '.codex'));
}

function getPluginCodexHome(env = process.env) {
  const home = env.HOME || process.env.HOME || process.cwd();
  return path.resolve(env.CODEX_OVERLEAF_CODEX_HOME || path.join(home, '.codex-overleaf', 'codex-home'));
}

function preparePluginCodexHome(env = process.env) {
  const userHome = getUserCodexHome(env);
  const pluginHome = getPluginCodexHome(env);

  fs.mkdirSync(pluginHome, { recursive: true });
  if (samePath(userHome, pluginHome)) {
    return { userHome, pluginHome, copied: [] };
  }

  const copied = [];
  const linked = [];
  for (const fileName of COPIED_USER_CODEX_FILES) {
    const source = path.join(userHome, fileName);
    const target = path.join(pluginHome, fileName);
    if (!isRegularFile(source)) {
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    copied.push(fileName);
  }

  for (const dirName of LINKED_USER_CODEX_DIRS) {
    const source = path.join(userHome, dirName);
    const target = path.join(pluginHome, dirName);
    if (!isDirectory(source) || !ensureSymlink(source, target)) {
      continue;
    }
    linked.push(dirName);
  }

  return { userHome, pluginHome, copied, linked };
}

function buildCodexHomeEnv(env = process.env) {
  const prepared = preparePluginCodexHome(env);
  return {
    ...env,
    CODEX_HOME: prepared.pluginHome,
    CODEX_OVERLEAF_CODEX_HOME: prepared.pluginHome,
    CODEX_OVERLEAF_USER_CODEX_HOME: prepared.userHome
  };
}

function clearPluginCodexHistory(optionsOrEnv = {}, maybeEnv = null) {
  const { options, env } = normalizeClearHistoryArgs(optionsOrEnv, maybeEnv);
  const pluginHome = getPluginCodexHome(env);

  if (options.threadId) {
    return clearPluginCodexThreadHistory(pluginHome, options.threadId);
  }

  if (options.scope !== 'all') {
    return {
      pluginHome,
      removed: [],
      scope: 'thread',
      skipped: true,
      reason: 'missing_thread_id'
    };
  }

  const removed = [];

  for (const dirName of HISTORY_DIRS) {
    const target = path.join(pluginHome, dirName);
    if (!isInsideDirectory(target, pluginHome) || !fs.existsSync(target)) {
      continue;
    }
    fs.rmSync(target, { recursive: true, force: true });
    removed.push(dirName);
  }

  return {
    pluginHome,
    removed,
    scope: 'all'
  };
}

function normalizeClearHistoryArgs(optionsOrEnv, maybeEnv) {
  if (maybeEnv) {
    return {
      options: normalizeClearHistoryOptions(optionsOrEnv),
      env: maybeEnv
    };
  }

  const first = optionsOrEnv || {};
  const looksLikeEnv = hasAnyOwn(first, [
    'HOME',
    'CODEX_HOME',
    'CODEX_OVERLEAF_CODEX_HOME',
    'CODEX_OVERLEAF_USER_CODEX_HOME'
  ]) && !hasAnyOwn(first, ['scope', 'threadId', 'sessionId']);

  if (looksLikeEnv) {
    return {
      options: { scope: 'all' },
      env: first
    };
  }

  return {
    options: normalizeClearHistoryOptions(first),
    env: process.env
  };
}

function normalizeClearHistoryOptions(options = {}) {
  return {
    ...options,
    threadId: String(options.threadId || '').trim(),
    scope: options.scope || (options.threadId ? 'thread' : '')
  };
}

function clearPluginCodexThreadHistory(pluginHome, threadId) {
  const removed = [];
  for (const dirName of HISTORY_DIRS) {
    const root = path.join(pluginHome, dirName);
    if (!isInsideDirectory(root, pluginHome) || !fs.existsSync(root)) {
      continue;
    }
    for (const filePath of listRegularFiles(root)) {
      if (!fileContainsThreadId(filePath, threadId)) {
        continue;
      }
      fs.rmSync(filePath, { force: true });
      removed.push(toForwardSlashPath(path.relative(pluginHome, filePath)));
      removeEmptyParents(path.dirname(filePath), root);
    }
  }
  return {
    pluginHome,
    removed,
    scope: 'thread',
    threadId
  };
}

function listRegularFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(child);
      } else if (entry.isFile()) {
        files.push(child);
      }
    }
  }
  return files;
}

function fileContainsThreadId(filePath, threadId) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > 5 * 1024 * 1024) {
      return false;
    }
    return fs.readFileSync(filePath, 'utf8').includes(JSON.stringify(threadId));
  } catch {
    return false;
  }
}

function removeEmptyParents(startDir, stopDir) {
  let current = path.resolve(startDir);
  const stop = path.resolve(stopDir);
  while (current && current !== stop && isInsideDirectory(current, stop)) {
    try {
      fs.rmdirSync(current);
    } catch {
      break;
    }
    current = path.dirname(current);
  }
}

function hasAnyOwn(object, keys) {
  return keys.some(key => Object.prototype.hasOwnProperty.call(object, key));
}

function toForwardSlashPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function isRegularFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isDirectory(filePath) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function ensureSymlink(source, target) {
  try {
    const existing = fs.lstatSync(target);
    if (existing.isSymbolicLink() && path.resolve(fs.readlinkSync(target)) === path.resolve(source)) {
      return true;
    }
    return false;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      return false;
    }
  }

  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.symlinkSync(source, target, 'dir');
  return true;
}

function samePath(left, right) {
  return path.resolve(left) === path.resolve(right);
}

function isInsideDirectory(target, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

module.exports = {
  buildCodexHomeEnv,
  clearPluginCodexHistory,
  getPluginCodexHome,
  getUserCodexHome,
  preparePluginCodexHome
};
