const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildCodexHomeEnv,
  clearPluginCodexHistory,
  getPluginCodexHome,
  getUserCodexHome,
  preparePluginCodexHome
} = require('../native-host/src/codexHome');

test('Codex homes fall back to USERPROFILE when HOME is absent', () => {
  const userProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-userprofile-'));
  try {
    assert.equal(getUserCodexHome({ USERPROFILE: userProfile }), path.join(userProfile, '.codex'));
    assert.equal(
      getPluginCodexHome({ USERPROFILE: userProfile }),
      path.join(userProfile, '.codex-overleaf', 'codex-home')
    );
  } finally {
    fs.rmSync(userProfile, { recursive: true, force: true });
  }
});

test('Windows Codex homes prefer USERPROFILE before HOME', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-msys-home-'));
  const userProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-win-profile-'));
  try {
    const env = { HOME: home, USERPROFILE: userProfile };

    assert.equal(getUserCodexHome(env, { platform: 'win32' }), path.join(userProfile, '.codex'));
    assert.equal(
      getPluginCodexHome(env, { platform: 'win32' }),
      path.join(userProfile, '.codex-overleaf', 'codex-home')
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(userProfile, { recursive: true, force: true });
  }
});

test('plugin Codex home mirrors auth/config but does not copy global sessions', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-home-'));
  const userCodexHome = path.join(home, '.codex');
  const userSessionFile = path.join(userCodexHome, 'sessions', '2026', '05', '02', 'session.jsonl');
  try {
    fs.mkdirSync(path.dirname(userSessionFile), { recursive: true });
    fs.writeFileSync(path.join(userCodexHome, 'auth.json'), '{"token":"user-token"}\n', 'utf8');
    fs.writeFileSync(path.join(userCodexHome, 'config.toml'), 'model = "gpt-5.5"\n', 'utf8');
    fs.writeFileSync(userSessionFile, '{"global":true}\n', 'utf8');

    const prepared = preparePluginCodexHome({ HOME: home });
    const pluginHome = path.join(home, '.codex-overleaf', 'codex-home');

    assert.equal(prepared.pluginHome, pluginHome);
    assert.equal(prepared.userHome, userCodexHome);
    assert.equal(fs.readFileSync(path.join(pluginHome, 'auth.json'), 'utf8'), '{"token":"user-token"}\n');
    assert.equal(fs.readFileSync(path.join(pluginHome, 'config.toml'), 'utf8'), 'model = "gpt-5.5"\n');
    assert.equal(fs.existsSync(path.join(pluginHome, 'sessions')), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('plugin Codex home and copied auth use restrictive permissions', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-home-'));
  const userCodexHome = path.join(home, '.codex');
  try {
    fs.mkdirSync(userCodexHome, { recursive: true });
    fs.writeFileSync(path.join(userCodexHome, 'auth.json'), '{"token":"user-token"}\n', 'utf8');

    const prepared = preparePluginCodexHome({ HOME: home });
    const pluginHomeMode = fs.statSync(prepared.pluginHome).mode & 0o777;
    const authMode = fs.statSync(path.join(prepared.pluginHome, 'auth.json')).mode & 0o777;

    assert.equal(pluginHomeMode, 0o700);
    assert.equal(authMode, 0o600);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('plugin Codex home reuses local Codex skills and plugin config without linking history', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-home-'));
  const userCodexHome = path.join(home, '.codex');
  try {
    fs.mkdirSync(path.join(userCodexHome, 'skills'), { recursive: true });
    fs.mkdirSync(path.join(userCodexHome, 'plugins'), { recursive: true });
    fs.mkdirSync(path.join(userCodexHome, 'rules'), { recursive: true });
    fs.mkdirSync(path.join(userCodexHome, 'sessions'), { recursive: true });

    preparePluginCodexHome({ HOME: home });
    const pluginHome = path.join(home, '.codex-overleaf', 'codex-home');

    assert.equal(fs.lstatSync(path.join(pluginHome, 'skills')).isSymbolicLink(), true);
    assert.equal(fs.readlinkSync(path.join(pluginHome, 'skills')), path.join(userCodexHome, 'skills'));
    assert.equal(fs.lstatSync(path.join(pluginHome, 'plugins')).isSymbolicLink(), true);
    assert.equal(fs.lstatSync(path.join(pluginHome, 'rules')).isSymbolicLink(), true);
    assert.equal(fs.existsSync(path.join(pluginHome, 'sessions')), false);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('plugin Codex home reports skipped links while preserving copied auth/config', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-link-failure-'));
  const userCodexHome = path.join(home, '.codex');
  const originalSymlinkSync = fs.symlinkSync;
  try {
    fs.mkdirSync(path.join(userCodexHome, 'skills'), { recursive: true });
    fs.writeFileSync(path.join(userCodexHome, 'auth.json'), '{"token":"user-token"}\n', 'utf8');
    fs.writeFileSync(path.join(userCodexHome, 'config.toml'), 'model = "gpt-5.5"\n', 'utf8');
    fs.symlinkSync = () => {
      const error = new Error('link denied');
      error.code = 'EPERM';
      throw error;
    };

    const prepared = preparePluginCodexHome({ HOME: home });
    const pluginHome = path.join(home, '.codex-overleaf', 'codex-home');

    assert.equal(fs.readFileSync(path.join(pluginHome, 'auth.json'), 'utf8'), '{"token":"user-token"}\n');
    assert.equal(fs.readFileSync(path.join(pluginHome, 'config.toml'), 'utf8'), 'model = "gpt-5.5"\n');
    assert.deepEqual(prepared.linked, []);
    assert.deepEqual(prepared.skippedLinks.map(link => [link.name, link.reason]), [['skills', 'EPERM']]);
  } finally {
    fs.symlinkSync = originalSymlinkSync;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('Windows plugin Codex directory links request junction semantics', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-junction-'));
  const userCodexHome = path.join(home, 'user-codex');
  const pluginHome = path.join(home, 'plugin-codex');
  const originalSymlinkSync = fs.symlinkSync;
  const calls = [];
  try {
    fs.mkdirSync(path.join(userCodexHome, 'skills'), { recursive: true });
    fs.symlinkSync = (source, target, type) => {
      calls.push({ source, target, type });
    };

    const prepared = preparePluginCodexHome({
      CODEX_OVERLEAF_USER_CODEX_HOME: userCodexHome,
      CODEX_OVERLEAF_CODEX_HOME: pluginHome
    }, { platform: 'win32' });

    assert.deepEqual(prepared.linked, ['skills']);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].source, path.join(userCodexHome, 'skills'));
    assert.equal(calls[0].target, path.join(pluginHome, 'skills'));
    assert.equal(calls[0].type, 'junction');
  } finally {
    fs.symlinkSync = originalSymlinkSync;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('Codex app-server env uses plugin-local CODEX_HOME', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-home-'));
  try {
    const env = buildCodexHomeEnv({
      HOME: home,
      PATH: '/usr/bin',
      CODEX_OVERLEAF_CODEX_PATH: '/usr/local/bin/codex'
    });

    assert.equal(env.CODEX_HOME, path.join(home, '.codex-overleaf', 'codex-home'));
    assert.equal(env.CODEX_OVERLEAF_CODEX_HOME, path.join(home, '.codex-overleaf', 'codex-home'));
    assert.equal(env.CODEX_OVERLEAF_USER_CODEX_HOME, path.join(home, '.codex'));
    assert.equal(env.PATH, '/usr/bin');
    assert.equal(env.CODEX_OVERLEAF_CODEX_PATH, '/usr/local/bin/codex');
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('clearing plugin Codex history never removes the user global Codex sessions', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-home-'));
  const userSessionFile = path.join(home, '.codex', 'sessions', '2026', '05', '02', 'user.jsonl');
  const pluginSessionFile = path.join(getPluginCodexHome({ HOME: home }), 'sessions', '2026', '05', '02', 'plugin.jsonl');
  const pluginArchiveFile = path.join(getPluginCodexHome({ HOME: home }), 'archived_sessions', 'archived.jsonl');
  try {
    fs.mkdirSync(path.dirname(userSessionFile), { recursive: true });
    fs.mkdirSync(path.dirname(pluginSessionFile), { recursive: true });
    fs.mkdirSync(path.dirname(pluginArchiveFile), { recursive: true });
    fs.writeFileSync(userSessionFile, '{"source":"vscode"}\n', 'utf8');
    fs.writeFileSync(pluginSessionFile, '{"source":"overleaf-plugin"}\n', 'utf8');
    fs.writeFileSync(pluginArchiveFile, '{"source":"overleaf-plugin"}\n', 'utf8');

    const result = clearPluginCodexHistory({ HOME: home });

    assert.deepEqual(result.removed.sort(), ['archived_sessions', 'sessions']);
    assert.equal(fs.existsSync(pluginSessionFile), false);
    assert.equal(fs.existsSync(pluginArchiveFile), false);
    assert.equal(fs.existsSync(userSessionFile), true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('clearing plugin Codex history by thread id removes only that Codex thread', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-home-'));
  const userSessionFile = path.join(home, '.codex', 'sessions', '2026', '05', '02', 'user.jsonl');
  const pluginThreadFile = path.join(getPluginCodexHome({ HOME: home }), 'sessions', '2026', '05', '02', 'thread-a.jsonl');
  const otherPluginThreadFile = path.join(getPluginCodexHome({ HOME: home }), 'sessions', '2026', '05', '02', 'thread-a-extra.jsonl');
  const archivedThreadFile = path.join(getPluginCodexHome({ HOME: home }), 'archived_sessions', '2026', '05', '02', 'thread-a.jsonl');
  try {
    fs.mkdirSync(path.dirname(userSessionFile), { recursive: true });
    fs.mkdirSync(path.dirname(pluginThreadFile), { recursive: true });
    fs.mkdirSync(path.dirname(archivedThreadFile), { recursive: true });
    fs.writeFileSync(userSessionFile, '{"id":"thread-a","source":"vscode"}\n', 'utf8');
    fs.writeFileSync(pluginThreadFile, '{"threadId":"thread-a","source":"overleaf-plugin"}\n', 'utf8');
    fs.writeFileSync(otherPluginThreadFile, '{"threadId":"thread-a-extra","source":"overleaf-plugin"}\n', 'utf8');
    fs.writeFileSync(archivedThreadFile, '{"threadId":"thread-a","source":"overleaf-plugin"}\n', 'utf8');

    const result = clearPluginCodexHistory({ threadId: 'thread-a' }, { HOME: home });

    assert.equal(result.scope, 'thread');
    assert.deepEqual(result.removed.sort(), [
      'archived_sessions/2026/05/02/thread-a.jsonl',
      'sessions/2026/05/02/thread-a.jsonl'
    ]);
    assert.equal(fs.existsSync(pluginThreadFile), false);
    assert.equal(fs.existsSync(archivedThreadFile), false);
    assert.equal(fs.existsSync(otherPluginThreadFile), true);
    assert.equal(fs.existsSync(userSessionFile), true);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
