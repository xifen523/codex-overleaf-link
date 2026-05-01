const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectFiles = require('../extension/src/shared/projectFiles');
const staleGuard = require('../extension/src/shared/staleGuard');

const pageBridgeSource = fs.readFileSync(
  path.join(__dirname, '../extension/src/pageBridge.js'),
  'utf8'
);

test('page bridge allows multiple successful edits to the same fresh file', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    files: {
      'main.tex': 'alpha beta gamma'
    }
  });

  const result = await bridge.call('applyOperations', {
    baseFiles: [
      { path: 'main.tex', content: 'alpha beta gamma' }
    ],
    operations: [
      { type: 'edit', path: 'main.tex', find: 'alpha', replace: 'one' },
      { type: 'edit', path: 'main.tex', find: 'gamma', replace: 'three' }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.applied.length, 2);
  assert.equal(result.skipped.length, 0);
  assert.equal(bridge.getFile('main.tex'), 'one beta three');
});

test('page bridge blocks stale file-tree deletes before mutating Overleaf state', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    files: {
      'main.tex': 'user changed'
    }
  });

  const result = await bridge.call('applyOperations', {
    baseFiles: [
      { path: 'main.tex', content: 'base snapshot' }
    ],
    operations: [
      { type: 'delete', path: 'main.tex', reason: 'remove stale file' }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].result.code, 'stale_snapshot');
  assert.equal(bridge.getFile('main.tex'), 'user changed');
});

test('page bridge blocks creates that collide with files added after the task snapshot', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    files: {
      'main.tex': 'base',
      'new.tex': 'user-created content'
    }
  });

  const result = await bridge.call('applyOperations', {
    baseFiles: [
      { path: 'main.tex', content: 'base' }
    ],
    operations: [
      { type: 'create', path: 'new.tex', content: 'codex content' }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].result.code, 'path_created_since_snapshot');
  assert.equal(bridge.getFile('new.tex'), 'user-created content');
});

test('page bridge normalizes operation paths before opening and guarding files', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'sections/main.tex',
    files: {
      'sections/main.tex': 'alpha'
    }
  });

  const result = await bridge.call('applyOperations', {
    baseFiles: [
      { path: '/sections\\main.tex', content: 'alpha' }
    ],
    operations: [
      { type: 'edit', path: '/sections\\main.tex', find: 'alpha', replace: 'beta' }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.applied.length, 1);
  assert.equal(bridge.getFile('sections/main.tex'), 'beta');
});


function createPageBridgeHarness({ activePath, files }) {
  const fileMap = new Map(Object.entries(files));
  let selectedPath = activePath;
  let listener = null;
  let pendingResult = null;

  const document = {
    body: { innerText: '', textContent: '' },
    querySelector(selector) {
      if (/\[aria-selected="true"\]|\.selected/.test(selector)) {
        return makeTreeNode(selectedPath);
      }
      return null;
    },
    querySelectorAll(selector) {
      if (/treeitem|role="row"|file-tree|project-tree|data-entity-id|data-doc-id|data-id|data-file-id/.test(selector)) {
        return Array.from(fileMap.keys(), makeTreeNode);
      }
      return [];
    },
    execCommand() {
      return false;
    }
  };

  const window = {
    location: {
      href: 'https://www.overleaf.com/project/test-project',
      origin: 'https://www.overleaf.com',
      pathname: '/project/test-project'
    },
    CodexOverleafProjectFiles: projectFiles,
    CodexOverleafReviewing: {
      detectReviewingFromSignals() {
        return { ok: true, status: 'enabled', source: 'test' };
      }
    },
    CodexOverleafStaleGuard: staleGuard,
    _ide: {
      editorView: createEditorView(),
      fileTreeManager: createFileTreeManager()
    },
    addEventListener(event, callback) {
      if (event === 'message') {
        listener = callback;
      }
    },
    postMessage(message) {
      if (message.source === 'codex-overleaf/page' && pendingResult) {
        pendingResult(message.result);
      }
    },
    setTimeout,
    clearTimeout
  };

  const context = vm.createContext({
    window,
    document,
    Node: class Node {},
    EventTarget: class EventTarget {},
    MouseEvent: class MouseEvent {},
    InputEvent: class InputEvent {},
    Event: class Event {},
    setTimeout,
    clearTimeout,
    console
  });

  vm.runInContext(pageBridgeSource, context, { filename: 'pageBridge.js' });

  return {
    async call(method, params) {
      assert.equal(typeof listener, 'function');
      const resultPromise = new Promise(resolve => {
        pendingResult = resolve;
      });
      await listener({
        source: window,
        data: {
          source: 'codex-overleaf/content',
          id: 'test-call',
          method,
          params
        }
      });
      return resultPromise;
    },
    getFile(filePath) {
      return fileMap.get(filePath);
    }
  };

  function createEditorView() {
    const doc = {
      toString() {
        return fileMap.get(selectedPath) || '';
      },
      get length() {
        return (fileMap.get(selectedPath) || '').length;
      }
    };
    return {
      state: { doc },
      dispatch(transaction) {
        fileMap.set(selectedPath, transaction.changes.insert);
      }
    };
  }

  function createFileTreeManager() {
    return {
      createDoc(filePath, content) {
        fileMap.set(filePath, content);
      },
      renameEntity(filePath, to) {
        const content = fileMap.get(filePath);
        fileMap.delete(filePath);
        fileMap.set(to, content || '');
        if (selectedPath === filePath) {
          selectedPath = to;
        }
      },
      moveEntity(filePath, to) {
        this.renameEntity(filePath, to);
      },
      deleteEntity(filePath) {
        fileMap.delete(filePath);
      }
    };
  }

  function makeTreeNode(filePath) {
    return {
      textContent: filePath,
      parentElement: null,
      getAttribute(attribute) {
        if (attribute === 'data-path' || attribute === 'aria-label' || attribute === 'title') {
          return filePath;
        }
        return '';
      },
      dispatchEvent() {
        selectedPath = filePath;
        return true;
      }
    };
  }
}
