const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

async function loadBudgetModule() {
  return import(pathToFileURL(path.join(repoRoot, 'scripts/check-architecture-budget.mjs')).href);
}

function writeLines(rootDir, relativePath, lines) {
  const fullPath = path.join(rootDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, Array.from({ length: lines }, (_, index) => `line ${index}`).join('\n'), 'utf8');
}

test('architecture budget tracks v0.9.5 split targets for the largest files', async () => {
  const { ARCHITECTURE_FILE_BUDGETS } = await loadBudgetModule();
  assert.deepEqual(
    ARCHITECTURE_FILE_BUDGETS.map(entry => [entry.path, entry.maxLines]),
    [
      ['extension/src/contentScript.js', 4500],
      ['extension/src/pageBridge.js', 2200],
      ['native-host/src/codexSessionRunner.js', 1500],
      ['native-host/src/taskRunner.js', 1000]
    ]
  );
});

test('architecture budget documents exceptions for files still above target', async () => {
  const { ARCHITECTURE_FILE_BUDGETS, collectArchitectureBudgetResults } = await loadBudgetModule();
  const results = collectArchitectureBudgetResults({ rootDir: repoRoot });

  for (const result of results) {
    if (!result.targetMet) {
      const budget = ARCHITECTURE_FILE_BUDGETS.find(entry => entry.path === result.path);
      assert.ok(budget.exception, `${result.path} should document the v0.9.5 exception`);
      assert.equal(result.lineCount <= result.currentCeiling, true, `${result.path} should not grow past its exception ceiling`);
    }
  }
});

test('architecture budget allows documented exception ceilings before final target enforcement', async () => {
  const { collectArchitectureBudgetErrors } = await loadBudgetModule();
  assert.deepEqual(collectArchitectureBudgetErrors({ rootDir: repoRoot }), []);
});

test('architecture budget can fail closed when v0.9.5 targets are enforced', async () => {
  const { ARCHITECTURE_FILE_BUDGETS, collectArchitectureBudgetErrors } = await loadBudgetModule();
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-budget-'));
  try {
    for (const entry of ARCHITECTURE_FILE_BUDGETS) {
      writeLines(rootDir, entry.path, entry.maxLines + 1);
    }
    const errors = collectArchitectureBudgetErrors({ rootDir, enforceTarget: true });
    assert.equal(errors.length, ARCHITECTURE_FILE_BUDGETS.length);
    assert.ok(errors.every(error => error.includes('limit is')));
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
