const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectFiles = require('../extension/src/shared/projectFiles');
const reviewing = require('../extension/src/shared/reviewing');
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

test('page bridge applies edit patches as local CodeMirror changes', async () => {
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
      {
        type: 'edit',
        path: 'main.tex',
        patches: [
          { from: 6, to: 10, expected: 'beta', insert: 'delta' }
        ]
      }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].result.method, 'codemirror-view-patch');
  assert.equal(bridge.getFile('main.tex'), 'alpha delta gamma');
  assert.deepEqual(bridge.getLastDispatchChanges(), [
    { from: 6, to: 10, insert: 'delta' }
  ]);
});

test('page bridge rejects stale patch expected text before editing', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    files: {
      'main.tex': 'alpha user gamma'
    }
  });

  const result = await bridge.call('applyOperations', {
    baseFiles: [
      { path: 'main.tex', content: 'alpha user gamma' }
    ],
    operations: [
      {
        type: 'edit',
        path: 'main.tex',
        patches: [
          { from: 6, to: 10, expected: 'beta', insert: 'delta' }
        ]
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped[0].result.code, 'stale_patch');
  assert.equal(bridge.getFile('main.tex'), 'alpha user gamma');
});

test('page bridge can activate Reviewing before write operations', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingOk: false,
    files: {
      'main.tex': 'alpha'
    }
  });

  const result = await bridge.call('ensureReviewing', {});

  assert.equal(result.ok, true);
  assert.equal(result.activated, true);
  assert.equal(bridge.getReviewingClickCount(), 1);
});

test('page bridge rejects write-safety confirmation when Reviewing click does not activate', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingOk: false,
    reviewingClickActivates: false,
    files: {
      'main.tex': 'alpha'
    }
  });

  const result = await bridge.call('ensureReviewing', { waitMs: 0 });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'reviewing_not_enabled');
  assert.equal(bridge.getReviewingClickCount(), 1);
});


function createPageBridgeHarness({ activePath, files, reviewingOk = true, reviewingClickActivates = true }) {
  const fileMap = new Map(Object.entries(files));
  let selectedPath = activePath;
  let listener = null;
  let pendingResult = null;
  let lastDispatchChanges = null;
  let reviewingActive = reviewingOk;
  let reviewingClickCount = 0;

  const document = {
    body: {
      get innerText() {
        return reviewingActive ? 'Reviewing' : 'Editing';
      },
      get textContent() {
        return reviewingActive ? 'Reviewing' : 'Editing';
      }
    },
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
      if (/aria-label|title|review|track|button|\*/i.test(selector)) {
        return [
          makeReviewingButton()
        ];
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
    CodexOverleafReviewing: reviewing,
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
    },
    getLastDispatchChanges() {
      return JSON.parse(JSON.stringify(lastDispatchChanges));
    },
    getReviewingClickCount() {
      return reviewingClickCount;
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
        lastDispatchChanges = transaction.changes;
        fileMap.set(selectedPath, applyEditorChanges(fileMap.get(selectedPath) || '', transaction.changes));
      }
    };
  }

  function applyEditorChanges(text, changes) {
    if (!changes) {
      return text;
    }
    if (!Array.isArray(changes)) {
      return text.slice(0, changes.from) + changes.insert + text.slice(changes.to);
    }
    return changes.slice().sort((a, b) => b.from - a.from).reduce((next, change) => {
      return next.slice(0, change.from) + change.insert + next.slice(change.to);
    }, text);
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

  function makeReviewingButton() {
    return {
      tagName: 'BUTTON',
      textContent: 'Reviewing',
      innerText: 'Reviewing',
      id: 'reviewing-mode',
      className: 'toolbar-reviewing-button',
      disabled: false,
      parentElement: null,
      getAttribute(attribute) {
        if (attribute === 'aria-label' || attribute === 'title') {
          return 'Reviewing';
        }
        if (attribute === 'aria-disabled') {
          return 'false';
        }
        if (attribute === 'aria-pressed' || attribute === 'aria-selected' || attribute === 'aria-current') {
          return reviewingActive ? 'true' : 'false';
        }
        return '';
      },
      click() {
        reviewingClickCount += 1;
        if (reviewingClickActivates) {
          reviewingActive = true;
        }
      },
      dispatchEvent() {
        this.click();
        return true;
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
