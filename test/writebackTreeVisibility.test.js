const assert = require('node:assert/strict');
const test = require('node:test');

const projectFiles = require('../extension/src/shared/projectFiles');
const writebackRouter = require('../extension/src/page/writebackRouter');

function createRouter({ manager, pathExists, delay, editorText = '' }) {
  return writebackRouter.create({
    compileBridge: { markSourceEdited() {} },
    delay,
    folderWriteback: {
      async ensureParentFolders() {
        return { ok: true, parentFolderId: 'root', createdFolders: [] };
      }
    },
    normalizeSafeProjectPath: projectFiles.normalizeSafeProjectPath,
    readActiveEditorText: () => editorText,
    treeOperations: {
      findFileTreeManager: () => manager,
      getActiveFilePath: () => '',
      openFileByPath: async () => ({ ok: true }),
      projectPathExists: pathExists
    },
    window: {
      CodexOverleafProjectFiles: projectFiles,
      atob(value) {
        return Buffer.from(value, 'base64').toString('binary');
      },
      setTimeout,
      clearTimeout
    }
  });
}

test('binary upload waits for delayed Overleaf tree visibility', async () => {
  let visible = false;
  let delayCalls = 0;
  let uploadCalls = 0;
  const router = createRouter({
    manager: {
      async uploadFile() {
        uploadCalls += 1;
      }
    },
    pathExists: path => visible && path === 'figures/overview.png',
    async delay() {
      delayCalls += 1;
      if (delayCalls === 2) visible = true;
    }
  });

  const result = await router.applyOperations({
    runProjectId: 'project-1',
    baseFiles: [],
    operations: [{
      type: 'binary-create',
      path: 'figures/overview.png',
      contentBase64: Buffer.from('png-bytes').toString('base64')
    }]
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.applied.length, 1);
  assert.equal(uploadCalls, 1);
  assert.ok(delayCalls >= 2);
});

test('text creation waits for delayed Overleaf tree visibility', async () => {
  let visible = false;
  let delayCalls = 0;
  const router = createRouter({
    manager: { async createDoc() {} },
    pathExists: path => visible && path === 'sections/new.tex',
    editorText: 'new content',
    async delay() {
      delayCalls += 1;
      if (delayCalls === 3) visible = true;
    }
  });

  const result = await router.applyOperations({
    runProjectId: 'project-1',
    operations: [{ type: 'create', path: 'sections/new.tex', content: 'new content' }]
  });

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.applied.length, 1);
  assert.ok(delayCalls >= 3);
});

test('rename and delete wait for their complete delayed tree state', async () => {
  let sourceVisible = true;
  let renamedVisible = false;
  let renameDelayCalls = 0;
  const renameRouter = createRouter({
    manager: { async renameEntity() {} },
    pathExists(path) {
      return path === 'main.tex' ? sourceVisible : path === 'renamed.tex' && renamedVisible;
    },
    async delay() {
      renameDelayCalls += 1;
      if (renameDelayCalls === 2) {
        sourceVisible = false;
        renamedVisible = true;
      }
    }
  });

  const renamed = await renameRouter.applyOperations({
    runProjectId: 'project-1',
    operations: [{ type: 'rename', path: 'main.tex', to: 'renamed.tex' }]
  });
  assert.equal(renamed.ok, true, JSON.stringify(renamed));

  let deleteVisible = true;
  let deleteDelayCalls = 0;
  const deleteRouter = createRouter({
    manager: { async deleteEntity() {} },
    pathExists: path => path === 'obsolete.tex' && deleteVisible,
    async delay() {
      deleteDelayCalls += 1;
      if (deleteDelayCalls === 2) deleteVisible = false;
    }
  });

  const deleted = await deleteRouter.applyOperations({
    runProjectId: 'project-1',
    operations: [{ type: 'delete', path: 'obsolete.tex' }]
  });
  assert.equal(deleted.ok, true, JSON.stringify(deleted));
  assert.ok(renameDelayCalls >= 2);
  assert.ok(deleteDelayCalls >= 2);
});
