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

test('context file list does not download or unzip the Overleaf project', async () => {
  const bridge = createSnapshotHarness({
    files: {
      'main.tex': '\\documentclass{article}',
      'refs.bib': '@article{x}'
    }
  });

  const result = await bridge.call('getProjectFileList', {});

  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.files, file => file.path), ['main.tex', 'refs.bib']);
  assert.equal(bridge.getFetchCount(), 0);
});

test('project snapshots reuse the same Overleaf ZIP package within maxAgeMs', async () => {
  const bridge = createSnapshotHarness({
    files: {
      'main.tex': '\\documentclass{article}',
      'refs.bib': '@article{x}'
    }
  });

  const first = await bridge.call('getProjectSnapshot', { maxAgeMs: 5000 });
  const second = await bridge.call('getProjectSnapshot', { maxAgeMs: 5000 });

  assert.equal(first.ok, undefined);
  assert.equal(second.ok, undefined);
  assert.deepEqual(Array.from(first.files, file => file.path), ['main.tex', 'refs.bib']);
  assert.deepEqual(Array.from(second.files, file => file.path), ['main.tex', 'refs.bib']);
  assert.equal(bridge.getFetchCount(), 1);
  assert.equal(second.capabilities.diagnostics.snapshotCache, 'memory');
});

test('project snapshot falls back when the Overleaf ZIP download hangs', async () => {
  const bridge = createSnapshotHarness({
    files: {
      'main.tex': '\\documentclass{article}\\begin{document}Hello\\end{document}'
    },
    fetchMode: 'hang'
  });

  const result = await bridge.call('getProjectSnapshot', {
    force: true,
    zipTimeoutMs: 5
  });

  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].path, 'main.tex');
  assert.equal(result.files[0].content, '\\documentclass{article}\\begin{document}Hello\\end{document}');
  assert.equal(result.capabilities.method, 'active-editor');
  assert.match(result.capabilities.skipped[0].reason, /timed out/i);
});

function createSnapshotHarness({ files, fetchMode = 'zip' }) {
  const fileMap = new Map(Object.entries(files));
  const zipBuffer = createStoredZip(files);
  let listener = null;
  let fetchCount = 0;
  const pendingResults = new Map();
  const editorTextarea = {
    tagName: 'TEXTAREA',
    value: Array.from(fileMap.values())[0],
    textContent: '',
    innerText: '',
    parentElement: null,
    getAttribute(attribute) {
      if (attribute === 'aria-label') {
        return 'Source Editor editing';
      }
      if (attribute === 'class') {
        return 'source-editor';
      }
      return '';
    }
  };

  const document = {
    activeElement: editorTextarea,
    body: { innerText: '', textContent: '' },
    querySelector(selector) {
      if (/\[aria-selected="true"\]|\.selected/.test(selector)) {
        return makeTreeNode(Array.from(fileMap.keys())[0]);
      }
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'textarea') {
        return [editorTextarea];
      }
      if (/treeitem|role="row"|file-tree|project-tree|data-entity-id|data-doc-id|data-id|data-file-id/.test(selector)) {
        return Array.from(fileMap.keys(), makeTreeNode);
      }
      if (selector === '*') {
        return [editorTextarea, ...Array.from(fileMap.keys(), makeTreeNode)];
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
    _ide: {},
    fetch: async (_endpoint, options = {}) => {
      fetchCount += 1;
      if (fetchMode === 'hang') {
        return new Promise((_resolve, reject) => {
          options.signal?.addEventListener('abort', () => {
            reject(new Error('aborted by test'));
          }, { once: true });
        });
      }
      return {
        ok: true,
        headers: {
          get(name) {
            return name.toLowerCase() === 'content-type' ? 'application/zip' : '';
          }
        },
        arrayBuffer: async () => zipBuffer.slice(0)
      };
    },
    addEventListener(event, callback) {
      if (event === 'message') {
        listener = callback;
      }
    },
    postMessage(message) {
      if (message.source !== 'codex-overleaf/page') {
        return;
      }
      const resolve = pendingResults.get(message.id);
      if (resolve) {
        pendingResults.delete(message.id);
        resolve(message.result);
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
    TextDecoder,
    AbortController,
    fetch: window.fetch,
    setTimeout,
    clearTimeout,
    console
  });

  vm.runInContext(pageBridgeSource, context, { filename: 'pageBridge.js' });

  return {
    async call(method, params) {
      assert.equal(typeof listener, 'function');
      const id = `test-${pendingResults.size + 1}-${Date.now()}`;
      const resultPromise = new Promise(resolve => {
        pendingResults.set(id, resolve);
      });
      await listener({
        source: window,
        data: {
          source: 'codex-overleaf/content',
          id,
          method,
          params
        }
      });
      return resultPromise;
    },
    getFetchCount() {
      return fetchCount;
    }
  };

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
        return true;
      }
    };
  }
}

function createStoredZip(entries) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const [name, content] of Object.entries(entries)) {
    const nameBytes = encoder.encode(name);
    const contentBytes = encoder.encode(content);
    const local = new Uint8Array(30 + nameBytes.length + contentBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, 0, true);
    localView.setUint32(18, contentBytes.length, true);
    localView.setUint32(22, contentBytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(contentBytes, 30 + nameBytes.length);
    chunks.push(local);

    const directory = new Uint8Array(46 + nameBytes.length);
    const directoryView = new DataView(directory.buffer);
    directoryView.setUint32(0, 0x02014b50, true);
    directoryView.setUint16(4, 20, true);
    directoryView.setUint16(6, 20, true);
    directoryView.setUint16(10, 0, true);
    directoryView.setUint32(20, contentBytes.length, true);
    directoryView.setUint32(24, contentBytes.length, true);
    directoryView.setUint16(28, nameBytes.length, true);
    directoryView.setUint32(42, offset, true);
    directory.set(nameBytes, 46);
    central.push(directory);
    offset += local.length;
  }

  const centralOffset = offset;
  const centralSize = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(8, central.length, true);
  eocdView.setUint16(10, central.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, centralOffset, true);

  return concatUint8Arrays([...chunks, ...central, eocd]).buffer;
}

function concatUint8Arrays(chunks) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
