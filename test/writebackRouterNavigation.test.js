const assert = require('node:assert/strict');
const test = require('node:test');

const projectFiles = require('../extension/src/shared/projectFiles');
const staleGuard = require('../extension/src/shared/staleGuard');
const writebackRouterModule = require('../extension/src/page/writebackRouter');

// Welcome-panel + write-guard v1.3.8 add-on (Task 2): the writeback router
// now requires `params.runProjectId` as defense-in-depth. These legacy
// navigation tests predate the field, so we wrap `create()` to auto-inject a
// stable id on guarded entry points and let the existing assertions run
// against the routing logic itself, unchanged.
const writebackRouter = {
  create(deps) {
    const raw = writebackRouterModule.create(deps);
    const guarded = ['applyOperations', 'acceptTrackedChanges', 'rejectTrackedChanges'];
    const wrapped = { ...raw };
    for (const method of guarded) {
      const original = raw[method];
      if (original instanceof Function) {
        wrapped[method] = (...args) => {
          if (method === 'applyOperations' && Array.isArray(args[0])) {
            return original.apply(raw, args);
          }
          const payload = args[0] && typeof args[0] === 'object' ? args[0] : {};
          if (typeof payload.runProjectId === 'string') {
            return original.apply(raw, args);
          }
          return original.call(raw, { runProjectId: 'test-project', ...payload }, ...args.slice(1));
        };
      }
    }
    return wrapped;
  }
};

test('writeback router refuses cross-file patch writes when the editor document did not switch', async () => {
  const files = new Map([
    ['main.tex', 'root body'],
    ['example/test.tex', '']
  ]);
  let selectedPath = 'main.tex';
  let editorPath = 'main.tex';
  let sourceEdited = false;
  const editorIdentity = { type: 'codemirror-view', doc: 'main-doc' };
  const router = writebackRouter.create({
    activeEditorIdentityChanged: () => false,
    compileBridge: {
      markSourceEdited() {
        sourceEdited = true;
      }
    },
    getActiveEditorIdentity: () => editorIdentity,
    normalizeSafeProjectPath: projectFiles.normalizeSafeProjectPath,
    normalizeTextPatches,
    readActiveEditorText: () => files.get(editorPath) || '',
    replaceActiveEditorPatches(patches) {
      const text = files.get(editorPath) || '';
      const next = patches.slice().sort((left, right) => right.from - left.from).reduce((value, patch) => {
        return value.slice(0, patch.from) + patch.insert + value.slice(patch.to);
      }, text);
      files.set(editorPath, next);
      return { ok: true, method: 'codemirror-view-patch' };
    },
    treeOperations: {
      contentSignature(content) {
        const text = String(content || '');
        return `${text.length}:${text.slice(0, 80)}:${text.slice(-80)}`;
      },
      getActiveFilePath: () => selectedPath,
      openFileByPath(path) {
        selectedPath = path;
        return Promise.resolve({ ok: true, method: 'dom-click' });
      },
      waitForActiveEditorText(path) {
        return Promise.resolve({
          ok: true,
          path,
          text: files.get(editorPath) || ''
        });
      }
    },
    window: {
      CodexOverleafStaleGuard: staleGuard,
      setTimeout,
      clearTimeout
    }
  });

  const result = await router.applyOperations({
    baseFiles: [
      { path: 'main.tex', content: 'root body' },
      { path: 'example/test.tex', content: '' }
    ],
    operations: [
      {
        type: 'edit',
        path: 'example/test.tex',
        patches: [
          { from: 0, to: 0, expected: '', insert: 'initialized' }
        ]
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].result.code, 'editor_document_not_switched');
  assert.equal(files.get('main.tex'), 'root body');
  assert.equal(files.get('example/test.tex'), '');
  assert.equal(sourceEdited, false);
});

test('writeback router force-reopens a selected target when the editor is still on another document', async () => {
  const files = new Map([
    ['main.tex', 'root body'],
    ['example/test.tex', '']
  ]);
  let selectedPath = 'example/test.tex';
  let editorPath = 'main.tex';
  let forceOpenSeen = false;
  const router = writebackRouter.create({
    activeEditorIdentityChanged: previous => previous?.doc !== editorPath,
    compileBridge: { markSourceEdited() {} },
    getActiveEditorIdentity: () => ({ type: 'codemirror-view', doc: editorPath }),
    normalizeSafeProjectPath: projectFiles.normalizeSafeProjectPath,
    normalizeTextPatches,
    readActiveEditorText: () => files.get(editorPath) || '',
    replaceActiveEditorPatches(patches) {
      const text = files.get(editorPath) || '';
      const next = patches.slice().sort((left, right) => right.from - left.from).reduce((value, patch) => {
        return value.slice(0, patch.from) + patch.insert + value.slice(patch.to);
      }, text);
      files.set(editorPath, next);
      return { ok: true, method: 'codemirror-view-patch' };
    },
    treeOperations: {
      contentSignature(content) {
        const text = String(content || '');
        return `${text.length}:${text.slice(0, 80)}:${text.slice(-80)}`;
      },
      getActiveFilePath: () => selectedPath,
      openFileByPath(path, options = {}) {
        forceOpenSeen = options.force === true;
        selectedPath = path;
        editorPath = path;
        return Promise.resolve({ ok: true, method: 'dom-click' });
      },
      waitForActiveEditorText(path) {
        return Promise.resolve({
          ok: true,
          path,
          text: files.get(editorPath) || ''
        });
      }
    },
    window: {
      CodexOverleafStaleGuard: staleGuard,
      setTimeout,
      clearTimeout
    }
  });

  const result = await router.applyOperations({
    baseFiles: [
      { path: 'main.tex', content: 'root body' },
      { path: 'example/test.tex', content: '' }
    ],
    operations: [
      {
        type: 'edit',
        path: 'example/test.tex',
        patches: [
          { from: 0, to: 0, expected: '', insert: 'initialized' }
        ]
      }
    ]
  });

  assert.equal(result.ok, true, result.error || JSON.stringify(result));
  assert.equal(forceOpenSeen, true);
  assert.equal(files.get('main.tex'), 'root body');
  assert.equal(files.get('example/test.tex'), 'initialized');
});

test('writeback router waits for editor document switch before writing identical empty files', async () => {
  const files = new Map([
    ['main.tex', ''],
    ['example/test.tex', '']
  ]);
  let selectedPath = 'example/test.tex';
  let editorPath = 'main.tex';
  const router = writebackRouter.create({
    activeEditorIdentityChanged: () => false,
    compileBridge: { markSourceEdited() {} },
    getActiveEditorIdentity: () => null,
    normalizeSafeProjectPath: projectFiles.normalizeSafeProjectPath,
    normalizeTextPatches,
    readActiveEditorText: () => files.get(editorPath) || '',
    replaceActiveEditorPatches(patches) {
      const text = files.get(editorPath) || '';
      const next = patches.slice().sort((left, right) => right.from - left.from).reduce((value, patch) => {
        return value.slice(0, patch.from) + patch.insert + value.slice(patch.to);
      }, text);
      files.set(editorPath, next);
      return { ok: true, method: 'codemirror-view-patch' };
    },
    treeOperations: {
      contentSignature(content) {
        const text = String(content || '');
        return `${text.length}:${text.slice(0, 80)}:${text.slice(-80)}`;
      },
      getActiveFilePath: () => selectedPath,
      openFileByPath(path) {
        selectedPath = path;
        setTimeout(() => {
          editorPath = path;
        }, 20);
        return Promise.resolve({ ok: true, method: 'dom-click' });
      },
      waitForActiveEditorText(path) {
        return Promise.resolve({
          ok: true,
          path,
          text: files.get(editorPath) || ''
        });
      }
    },
    window: {
      CodexOverleafStaleGuard: staleGuard,
      setTimeout,
      clearTimeout
    },
    writebackOpenSettleMs: 60
  });

  const result = await router.applyOperations({
    baseFiles: [
      { path: 'main.tex', content: '' },
      { path: 'example/test.tex', content: '' }
    ],
    operations: [
      {
        type: 'edit',
        path: 'example/test.tex',
        patches: [
          { from: 0, to: 0, expected: '', insert: 'initialized' }
        ]
      }
    ]
  });

  assert.equal(result.ok, true, result.error || JSON.stringify(result));
  assert.equal(files.get('main.tex'), '');
  assert.equal(files.get('example/test.tex'), 'initialized');
});

function normalizeTextPatches(patches, length) {
  const normalized = [];
  for (const patch of patches || []) {
    const from = Number(patch?.from);
    const to = Number(patch?.to);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > length) {
      return { ok: false, code: 'invalid_patch' };
    }
    normalized.push({
      from,
      to,
      expected: String(patch.expected ?? ''),
      insert: String(patch.insert ?? '')
    });
  }
  return { ok: true, patches: normalized };
}
