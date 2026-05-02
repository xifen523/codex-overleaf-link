const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildNativeRuntimeEnv,
  summarizeNativeEnvironment
} = require('../native-host/src/nativeEnvironment');

test('native runtime env discovers Codex and TeX tools from the user login shell path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-env-'));
  const shellBin = path.join(root, 'shell-bin');
  fs.mkdirSync(shellBin, { recursive: true });
  fs.writeFileSync(path.join(shellBin, 'codex'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(shellBin, 'latexmk'), '#!/bin/sh\n', { mode: 0o755 });

  try {
    const env = buildNativeRuntimeEnv({
      HOME: root,
      PATH: '/usr/bin:/bin',
      SHELL: '/bin/zsh'
    }, {
      readLoginShellEnv: () => ({
        PATH: shellBin
      }),
      defaultPathSegments: []
    });

    assert.equal(env.CODEX_OVERLEAF_CODEX_PATH, path.join(shellBin, 'codex'));
    assert.equal(env.CODEX_OVERLEAF_LATEXMK_PATH, path.join(shellBin, 'latexmk'));
    assert.equal(env.PATH.split(path.delimiter)[0], shellBin);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('native runtime env falls back to standard macOS developer paths without user input', () => {
  const env = buildNativeRuntimeEnv({
    HOME: '/Users/example',
    PATH: '/usr/bin:/bin'
  }, {
    readLoginShellEnv: () => null
  });

  assert.equal(env.PATH.split(path.delimiter).includes('/Library/TeX/texbin'), true);
  assert.equal(env.PATH.split(path.delimiter).includes('/opt/homebrew/bin'), true);
  assert.equal(env.PATH.split(path.delimiter).includes('/Users/example/.local/bin'), true);
});

test('native environment summary reports discovered tools without exposing raw shell internals', () => {
  const env = {
    PATH: '/usr/bin:/bin',
    CODEX_OVERLEAF_CODEX_PATH: '/opt/homebrew/bin/codex',
    CODEX_OVERLEAF_LATEXMK_PATH: '/Library/TeX/texbin/latexmk',
    CODEX_OVERLEAF_PDFLATEX_PATH: ''
  };

  const summary = summarizeNativeEnvironment(env);

  assert.equal(summary.codex.ok, true);
  assert.equal(summary.codex.path, '/opt/homebrew/bin/codex');
  assert.deepEqual(summary.latex.available, ['latexmk']);
  assert.deepEqual(summary.latex.missing, ['pdflatex', 'xelatex', 'lualatex', 'bibtex', 'biber']);
  assert.equal(Object.hasOwn(summary, 'rawShellOutput'), false);
});
