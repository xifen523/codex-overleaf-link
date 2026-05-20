const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectFiles = require('../extension/src/shared/projectFiles');

const treeOperationsSource = fs.readFileSync(
  path.join(__dirname, '../extension/src/page/treeOperations.js'),
  'utf8'
);

test('tree operations resolves nested DOM basename nodes through Overleaf doc ids', () => {
  const rootId = '111111111111111111111111';
  const nestedId = '222222222222222222222222';
  const rootNode = makeTreeNode({ label: 'main.tex', docId: rootId, openPath: 'main.tex' });
  const nestedNode = makeTreeNode({ label: 'main.tex', docId: nestedId, openPath: 'sections/main.tex' });
  const harness = createTreeOperationsHarness({
    selectedPath: 'main.tex',
    nodes: [rootNode, nestedNode],
    docs: [
      { path: 'main.tex', id: rootId },
      { path: 'sections/main.tex', id: nestedId }
    ]
  });

  assert.equal(harness.ops.readProjectPathFromNode(nestedNode), 'sections/main.tex');
});

test('tree operations infers nested basename file paths from folder DOM ancestry', () => {
  const fileNode = makeDomNode({
    tagName: 'LI',
    role: 'treeitem',
    ariaLabel: 'test.tex',
    textContent: 'descriptiontest.texmore_vertMenu'
  });
  const childList = makeDomNode({
    tagName: 'UL',
    role: 'tree',
    className: 'file-tree-folder-list',
    children: [fileNode]
  });
  const folderNode = makeDomNode({
    tagName: 'LI',
    role: 'treeitem',
    ariaLabel: 'example',
    textContent: 'expand_moreexample',
    children: [childList]
  });
  const rootNode = makeDomNode({
    tagName: 'DIV',
    className: 'file-tree',
    children: [folderNode]
  });
  const harness = createTreeOperationsHarness({
    selectedPath: 'test.tex',
    nodes: [rootNode, folderNode, childList, fileNode],
    docs: []
  });

  assert.equal(harness.ops.readProjectPathFromNode(fileNode), 'example/test.tex');
});

test('tree operations infers nested files from Overleaf sibling folder-list DOM', () => {
  const folderNode = makeDomNode({
    tagName: 'LI',
    role: 'treeitem',
    ariaLabel: 'example',
    textContent: 'expand_moreexample'
  });
  const fileNode = makeDomNode({
    tagName: 'LI',
    role: 'treeitem',
    ariaLabel: 'test.tex',
    textContent: 'descriptiontest.tex'
  });
  const nestedList = makeDomNode({
    tagName: 'UL',
    role: 'tree',
    className: 'list-unstyled file-tree-folder-list',
    textContent: 'descriptiontest.tex',
    children: [
      makeDomNode({
        tagName: 'DIV',
        className: 'file-tree-folder-list-inner',
        textContent: 'descriptiontest.tex',
        children: [fileNode]
      })
    ]
  });
  const rootInner = makeDomNode({
    tagName: 'DIV',
    className: 'file-tree-folder-list-inner',
    textContent: 'expand_moreexampledescriptiontest.texdescriptionmain.tex',
    children: [
      folderNode,
      nestedList,
      makeDomNode({
        tagName: 'LI',
        role: 'treeitem',
        ariaLabel: 'main.tex',
        textContent: 'descriptionmain.tex'
      })
    ]
  });
  const rootList = makeDomNode({
    tagName: 'UL',
    role: 'tree',
    className: 'list-unstyled file-tree-folder-list file-tree-list',
    children: [rootInner]
  });
  const rootNode = makeDomNode({
    tagName: 'DIV',
    className: 'file-tree',
    children: [rootList]
  });
  const harness = createTreeOperationsHarness({
    selectedPath: 'main.tex',
    nodes: [rootNode, rootList, rootInner, folderNode, nestedList, ...nestedList.children, fileNode],
    docs: []
  });

  assert.equal(harness.ops.readProjectPathFromNode(fileNode), 'example/test.tex');
});

test('tree operations opens nested files without falling back to a root basename match', async () => {
  const rootId = '333333333333333333333333';
  const nestedId = '444444444444444444444444';
  const rootNode = makeTreeNode({ label: 'main.tex', docId: rootId, openPath: 'main.tex' });
  const nestedNode = makeTreeNode({ label: 'main.tex', docId: nestedId, openPath: 'sections/main.tex' });
  const harness = createTreeOperationsHarness({
    selectedPath: 'main.tex',
    nodes: [rootNode, nestedNode],
    docs: [
      { path: 'main.tex', id: rootId },
      { path: 'sections/main.tex', id: nestedId }
    ]
  });

  const opened = await harness.ops.openFileByPath('sections/main.tex');

  assert.equal(opened.ok, true, opened.reason || JSON.stringify(opened));
  assert.equal(harness.getSelectedPath(), 'sections/main.tex');
  assert.equal(rootNode.clickCount, 0);
  assert.equal(nestedNode.clickCount, 1);
});

function createTreeOperationsHarness({ selectedPath, nodes, docs }) {
  let currentPath = selectedPath;
  const document = {
    querySelector(selector) {
      if (/\[aria-selected="true"\]|\.selected/.test(selector)) {
        return nodes.find(node => node.openPath === currentPath) || null;
      }
      return null;
    },
    querySelectorAll(selector) {
      if (/treeitem|role="row"|file-tree|project-tree|data-entity-id|data-doc-id|data-id|data-file-id/.test(selector)) {
        return nodes;
      }
      return [];
    }
  };
  for (const node of nodes) {
    node.onClick = () => {
      currentPath = node.openPath;
    };
  }
  const window = {
    location: {
      pathname: '/project/test-project'
    },
    document,
    CodexOverleafProjectFiles: projectFiles,
    _ide: {
      rootFolder: buildInternalDocTree(docs)
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
    setTimeout,
    clearTimeout,
    globalThis: window
  });
  vm.runInContext(treeOperationsSource, context, { filename: 'treeOperations.js' });
  const ops = window.CodexOverleafTreeOperations.create({
    window,
    document,
    normalizePath: projectFiles.normalizeSafeProjectPath,
    readActiveEditorText: () => 'ready'
  });
  return {
    ops,
    getSelectedPath() {
      return currentPath;
    }
  };
}

function buildInternalDocTree(docs) {
  const root = { name: '', folders: [], docs: [] };
  const folders = new Map([['', root]]);
  for (const doc of docs) {
    const parts = doc.path.split('/');
    const fileName = parts.pop();
    let folderPath = '';
    let parent = root;
    for (const folderName of parts) {
      folderPath = folderPath ? `${folderPath}/${folderName}` : folderName;
      if (!folders.has(folderPath)) {
        const folder = { name: folderName, folders: [], docs: [] };
        folders.set(folderPath, folder);
        parent.folders.push(folder);
      }
      parent = folders.get(folderPath);
    }
    parent.docs.push({ name: fileName, _id: doc.id });
  }
  return root;
}

function makeTreeNode({ label, docId, openPath }) {
  return {
    textContent: label,
    children: [],
    parentElement: null,
    openPath,
    clickCount: 0,
    getAttribute(attribute) {
      if (attribute === 'data-name' || attribute === 'aria-label' || attribute === 'title') {
        return label;
      }
      if (attribute === 'data-entity-id' || attribute === 'data-doc-id' || attribute === 'data-id') {
        return docId;
      }
      return '';
    },
    dispatchEvent() {
      this.clickCount += 1;
      this.onClick?.();
      return true;
    }
  };
}

function makeDomNode({
  tagName = 'DIV',
  role = '',
  className = '',
  id = '',
  ariaLabel = '',
  title = '',
  textContent = '',
  children = []
}) {
  const node = {
    tagName,
    className,
    id,
    textContent,
    children,
    parentElement: null,
    getAttribute(attribute) {
      if (attribute === 'role') {
        return role;
      }
      if (attribute === 'class') {
        return className;
      }
      if (attribute === 'id') {
        return id;
      }
      if (attribute === 'aria-label') {
        return ariaLabel;
      }
      if (attribute === 'title') {
        return title;
      }
      return '';
    },
    dispatchEvent() {
      return true;
    }
  };
  for (const child of children) {
    child.parentElement = node;
  }
  return node;
}
