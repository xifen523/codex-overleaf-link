const assert = require('node:assert/strict');
const test = require('node:test');

const governance = require('../extension/src/shared/governanceRules');

test('normalizeGovernanceRules keeps only valid rule fields', () => {
  const rules = governance.normalizeGovernanceRules({
    readonlyPatterns: [' locked/** ', '', 42],
    writablePatterns: ['src/*.tex', null, ' assets/** '],
    sensitiveCheckEnabled: false,
    sensitiveConfirmAllowed: true
  });

  assert.deepEqual(rules, {
    readonlyPatterns: ['locked/**'],
    writablePatterns: ['src/*.tex', 'assets/**'],
    sensitiveCheckEnabled: false,
    sensitiveConfirmAllowed: true
  });
});

test('matchesGovernancePattern supports star, globstar, and normalized paths', () => {
  assert.equal(governance.matchesGovernancePattern('chapters/intro.tex', 'chapters/*.tex'), true);
  assert.equal(governance.matchesGovernancePattern('/figures/nested/plot.pdf', 'figures/**'), true);
  assert.equal(governance.matchesGovernancePattern('figures/plot.pdf', '*.pdf'), false);
});

test('evaluateGovernedOperations blocks readonly writes and allowlist misses', () => {
  const result = governance.evaluateGovernedOperations([
    { type: 'edit', path: 'main.tex' },
    { type: 'delete', path: 'locked/appendix.tex' },
    { type: 'create', path: 'notes/private.tex' },
    { type: 'rename', path: 'chapters/old.tex', destinationPath: 'locked/new.tex' },
    { type: 'move', path: 'main.tex', to: 'locked/main.tex' },
    { type: 'binary-create', path: 'figures/chart.pdf' }
  ], {
    readonlyPatterns: ['locked/**'],
    writablePatterns: ['main.tex', 'figures/**']
  });

  assert.deepEqual(result.allowed.map(operation => operation.path), ['main.tex', 'figures/chart.pdf']);
  assert.deepEqual(result.blocked.map(entry => ({
    type: entry.operation.type,
    path: entry.operation.path,
    destinationPath: entry.operation.destinationPath || '',
    reason: entry.reason
  })), [
    { type: 'delete', path: 'locked/appendix.tex', destinationPath: '', reason: 'readonly' },
    { type: 'create', path: 'notes/private.tex', destinationPath: '', reason: 'writable_allowlist' },
    { type: 'rename', path: 'chapters/old.tex', destinationPath: 'locked/new.tex', reason: 'readonly' },
    { type: 'move', path: 'main.tex', destinationPath: 'locked/main.tex', reason: 'readonly' }
  ]);
});
