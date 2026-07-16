const assert = require('node:assert/strict');
const test = require('node:test');

const projectFiles = require('../extension/src/shared/projectFiles');
const staleGuard = require('../extension/src/shared/staleGuard');
const writebackRouter = require('../extension/src/page/writebackRouter');

test('a dependency creation failure aborts the batch before main.tex can reference a missing file', async () => {
  let sourceEdited = false;
  let mainText = '\\documentclass{article}';
  const router = writebackRouter.create({
    compileBridge: {
      markSourceEdited() { sourceEdited = true; }
    },
    folderWriteback: {
      async ensureParentFolders() {
        return {
          ok: false,
          code: 'parent_folder_create_failed',
          reason: 'Overleaf rejected creation of tables (HTTP 403).'
        };
      }
    },
    normalizeSafeProjectPath: projectFiles.normalizeSafeProjectPath,
    readActiveEditorText: () => mainText,
    replaceActiveEditorPatches() {
      throw new Error('main.tex must not be written after dependency creation fails');
    },
    treeOperations: {
      getActiveFilePath: () => 'main.tex',
      projectPathExists: () => false
    },
    window: {
      CodexOverleafStaleGuard: staleGuard,
      setTimeout,
      clearTimeout
    }
  });

  const result = await router.applyOperations({
    runProjectId: 'project-1',
    baseFiles: [{ path: 'main.tex', content: mainText }],
    operations: [
      {
        type: 'create',
        path: 'tables/conference_evidence.tex',
        content: '\\begin{table}evidence\\end{table}'
      },
      {
        type: 'edit',
        path: 'main.tex',
        patches: [{ from: mainText.length, to: mainText.length, expected: '', insert: '\n\\input{tables/conference_evidence}' }]
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 2);
  assert.equal(result.skipped[0].result.code, 'parent_folder_create_failed');
  assert.equal(result.skipped[1].operation.path, 'main.tex');
  assert.equal(result.skipped[1].result.code, 'writeback_batch_aborted');
  assert.equal(result.skipped[1].result.failure.changedDocument, false);
  assert.equal(mainText, '\\documentclass{article}');
  assert.equal(sourceEdited, false);
});
