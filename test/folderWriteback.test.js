const assert = require('node:assert/strict');
const test = require('node:test');

const FolderWriteback = require('../extension/src/page/folderWriteback');

function createHarness({ rootFolder, responseStatus = 200 } = {}) {
  const requests = [];
  const foldersById = new Map();
  indexFolders(rootFolder, foldersById);
  const window = {
    _ide: { project: { rootFolder: [rootFolder] } },
    location: { origin: 'https://www.overleaf.com', pathname: '/project/project-1' },
    metaAttributesCache: new Map([['ol-csrfToken', 'csrf-token']]),
    setTimeout
  };
  const treeOperations = {
    getProjectId: () => 'project-1',
    folderPathExists(folderPath) {
      return Boolean(findFolder(rootFolder, folderPath));
    }
  };
  const api = FolderWriteback.create({
    window,
    document: { head: { querySelector: () => null } },
    treeOperations,
    normalizePath: value => String(value || '').replace(/\\/g, '/'),
    delay: () => Promise.resolve(),
    async fetch(url, options) {
      const body = JSON.parse(options.body);
      requests.push({ url, options, body });
      if (responseStatus !== 200) {
        return response({ message: 'denied' }, responseStatus);
      }
      const parent = foldersById.get(body.parent_folder_id);
      const folder = { _id: `folder-${requests.length}`, name: body.name, folders: [], docs: [] };
      parent.folders.push(folder);
      foldersById.set(folder._id, folder);
      return response(folder, 200);
    }
  });
  return { api, requests };
}

function response(data, status) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => 'application/json' },
    async json() { return data; }
  };
}

function indexFolders(folder, byId) {
  byId.set(folder._id, folder);
  for (const child of folder.folders || []) indexFolders(child, byId);
}

function findFolder(root, folderPath) {
  let current = root;
  for (const part of folderPath.split('/').filter(Boolean)) {
    current = (current.folders || []).find(folder => folder.name === part);
    if (!current) return null;
  }
  return current;
}

test('folder writeback creates every missing parent in order with official Overleaf endpoints', async () => {
  const rootFolder = { _id: 'root', name: '', folders: [], docs: [] };
  const { api, requests } = createHarness({ rootFolder });

  const result = await api.ensureParentFolders('tables/results/conference.tex');

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.parentFolderId, 'folder-2');
  assert.deepEqual(result.createdFolders, ['tables', 'tables/results']);
  assert.deepEqual(requests.map(item => item.body), [
    { parent_folder_id: 'root', name: 'tables' },
    { parent_folder_id: 'folder-1', name: 'results' }
  ]);
  assert.ok(requests.every(item => item.options.headers['X-Csrf-Token'] === 'csrf-token'));
});

test('folder writeback reuses an existing parent without creating duplicates', async () => {
  const rootFolder = {
    _id: 'root',
    name: '',
    folders: [{ _id: 'tables-id', name: 'tables', folders: [], docs: [] }],
    docs: []
  };
  const { api, requests } = createHarness({ rootFolder });

  const result = await api.ensureParentFolders('tables/conference.tex');

  assert.equal(result.ok, true);
  assert.equal(result.parentFolderId, 'tables-id');
  assert.deepEqual(result.createdFolders, []);
  assert.equal(requests.length, 0);
});

test('folder writeback fails closed when Overleaf rejects parent creation', async () => {
  const rootFolder = { _id: 'root', name: '', folders: [], docs: [] };
  const { api } = createHarness({ rootFolder, responseStatus: 403 });

  const result = await api.ensureParentFolders('tables/conference.tex');

  assert.equal(result.ok, false);
  assert.equal(result.code, 'parent_folder_create_failed');
  assert.equal(result.failure.changedDocument, false);
  assert.match(result.reason, /HTTP 403/);
});

test('folder writeback can create and populate a text file through the official document endpoint', async () => {
  const rootFolder = { _id: 'root', name: '', folders: [], docs: [] };
  let created = false;
  let editorText = '';
  const window = {
    _ide: { project: { rootFolder: [rootFolder] } },
    location: { origin: 'https://www.overleaf.com', pathname: '/project/project-1' },
    metaAttributesCache: new Map([['ol-csrfToken', 'csrf-token']]),
    setTimeout
  };
  const api = FolderWriteback.create({
    window,
    document: { head: { querySelector: () => null } },
    normalizePath: value => String(value || '').replace(/\\/g, '/'),
    delay: () => Promise.resolve(),
    treeOperations: {
      getProjectId: () => 'project-1',
      projectPathExists: () => created,
      openFileByPath: async () => ({ ok: true })
    },
    readActiveEditorText: () => editorText,
    replaceActiveEditorText(value) { editorText = value; return { ok: true }; },
    async fetch(url, options) {
      assert.match(url, /\/project\/project-1\/doc$/);
      assert.deepEqual(JSON.parse(options.body), { parent_folder_id: 'root', name: 'conference.tex' });
      created = true;
      return response({ _id: 'doc-1', name: 'conference.tex' }, 200);
    }
  });

  const result = await api.createTextFile('conference.tex', 'table body');

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.method, 'overleaf-rest.create-doc');
  assert.equal(result.verifiedContent, 'table body');
  assert.equal(editorText, 'table body');
});

test('folder writeback creates a missing parent before creating and populating a nested file', async () => {
  const rootFolder = { _id: 'root', name: '', folders: [], docs: [] };
  const requests = [];
  let createdPath = '';
  let editorText = '';
  const window = {
    _ide: { project: { rootFolder: [rootFolder] } },
    location: { origin: 'https://www.overleaf.com', pathname: '/project/project-1' },
    metaAttributesCache: new Map([['ol-csrfToken', 'csrf-token']]),
    setTimeout
  };
  const api = FolderWriteback.create({
    window,
    document: { head: { querySelector: () => null } },
    normalizePath: value => String(value || '').replace(/\\/g, '/'),
    delay: () => Promise.resolve(),
    treeOperations: {
      getProjectId: () => 'project-1',
      folderPathExists: folderPath => Boolean(findFolder(rootFolder, folderPath)),
      projectPathExists: filePath => filePath === createdPath,
      openFileByPath: async filePath => ({ ok: filePath === createdPath })
    },
    readActiveEditorText: () => editorText,
    replaceActiveEditorText(value) { editorText = value; return { ok: true }; },
    async fetch(url, options) {
      const body = JSON.parse(options.body);
      requests.push({ url, body });
      if (url.endsWith('/folder')) {
        assert.deepEqual(body, { parent_folder_id: 'root', name: 'tables' });
        const folder = { _id: 'tables-id', name: 'tables', folders: [], docs: [] };
        rootFolder.folders.push(folder);
        return response(folder, 200);
      }
      assert.match(url, /\/project\/project-1\/doc$/);
      assert.deepEqual(body, { parent_folder_id: 'tables-id', name: 'conference_evidence.tex' });
      createdPath = 'tables/conference_evidence.tex';
      return response({ _id: 'doc-1', name: 'conference_evidence.tex' }, 200);
    }
  });

  const result = await api.createTextFile(
    'tables/conference_evidence.tex',
    '\\begin{table}evidence\\end{table}'
  );

  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.createdFolders, ['tables']);
  assert.equal(requests.length, 2);
  assert.equal(editorText, '\\begin{table}evidence\\end{table}');
});
