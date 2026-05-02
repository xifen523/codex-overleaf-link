const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildCodexHomeEnv,
  clearPluginCodexHistory,
  getPluginCodexHome,
  preparePluginCodexHome
} = require('../native-host/src/codexHome');

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
