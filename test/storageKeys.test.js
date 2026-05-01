const assert = require('node:assert/strict');
const test = require('node:test');

const {
  getOverleafProjectId,
  getProjectStorageKey
} = require('../extension/src/shared/storageKeys');

test('extracts Overleaf project ids from project URLs', () => {
  assert.equal(
    getOverleafProjectId('https://www.overleaf.com/project/aabbccddeeff001122334455#'),
    'aabbccddeeff001122334455'
  );
  assert.equal(
    getOverleafProjectId('https://overleaf.com/project/abc123?foo=bar'),
    'abc123'
  );
});

test('falls back when a URL is not an Overleaf project URL', () => {
  assert.equal(getOverleafProjectId('https://www.overleaf.com/read/abc123'), '');
  assert.equal(getOverleafProjectId('not a url'), '');
});

test('builds per-project storage keys while preserving a legacy fallback', () => {
  assert.equal(
    getProjectStorageKey('codexOverleafPanelState', 'https://www.overleaf.com/project/aabbccddeeff001122334455'),
    'codexOverleafPanelState:project:aabbccddeeff001122334455'
  );
  assert.equal(
    getProjectStorageKey('codexOverleafPanelState', 'https://www.overleaf.com/read/abc123'),
    'codexOverleafPanelState'
  );
});
