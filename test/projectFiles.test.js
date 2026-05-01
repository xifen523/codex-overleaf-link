const assert = require('node:assert/strict');
const test = require('node:test');

const {
  collectUniqueTextPaths,
  isUsableProjectFileContent,
  isTextProjectPath,
  normalizePath
} = require('../extension/src/shared/projectFiles');

test('keeps LaTeX project text files and skips binary assets', () => {
  assert.equal(isTextProjectPath('main.tex'), true);
  assert.equal(isTextProjectPath('ref.bib'), true);
  assert.equal(isTextProjectPath('jmlr.cls'), true);
  assert.equal(isTextProjectPath('figure.png'), false);
  assert.equal(isTextProjectPath('paper.pdf'), false);
});

test('normalizes and deduplicates project file paths with a cap', () => {
  const paths = collectUniqueTextPaths([
    ' main.tex ',
    'main.tex',
    'sections\\intro.tex',
    'plot.pdf',
    'refs.bib',
    'notes.md'
  ], 3);

  assert.deepEqual(paths, ['main.tex', 'sections/intro.tex', 'refs.bib']);
});

test('rejects parent directory paths', () => {
  assert.equal(isTextProjectPath('../secret.tex'), false);
  assert.equal(normalizePath('/main.tex'), 'main.tex');
});

test('distinguishes loaded project content from editor placeholders', () => {
  assert.equal(isUsableProjectFileContent('Loading…'), false);
  assert.equal(isUsableProjectFileContent('Loading...'), false);
  assert.equal(isUsableProjectFileContent(''), false);
  assert.equal(isUsableProjectFileContent('\\documentclass{article}'), true);
});
