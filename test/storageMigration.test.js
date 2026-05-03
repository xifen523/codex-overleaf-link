const { test } = require('node:test');
const assert = require('node:assert');

const Migration = require('../extension/src/shared/storageMigration');

test('storageMigration exports PREFS_KEY', () => {
  assert.strictEqual(Migration.PREFS_KEY, 'codexOverleafPrefs');
});

test('storageMigration exports runMigrationIfNeeded', () => {
  assert.strictEqual(typeof Migration.runMigrationIfNeeded, 'function');
});

test('storageMigration exports savePrefs', () => {
  assert.strictEqual(typeof Migration.savePrefs, 'function');
});

test('storageMigration exports loadPrefs', () => {
  assert.strictEqual(typeof Migration.loadPrefs, 'function');
});

test('migration preserves legacy session task, history, runs, and settings', async () => {
  const calls = {
    putRecords: [],
    set: [],
    remove: []
  };
  const legacyStorageKey = 'codexOverleafPanelState:project_1';
  const legacyBlob = {
    model: 'gpt-5.3-codex-spark',
    reasoningEffort: 'xhigh',
    mode: 'auto',
    requireReviewing: false,
    activeSessionId: 'session_legacy',
    sessions: [{
      id: 'session_legacy',
      title: 'Fix grammar',
      task: '帮我检查语法错误',
      mode: 'auto',
      model: 'gpt-5.3-codex-spark',
      reasoningEffort: 'xhigh',
      requireReviewing: false,
      focusFiles: ['paper.tex'],
      history: [{ task: '上一轮', result: '改了引言', at: '2026-05-02T02:00:00.000Z' }],
      runs: [{
        id: 'run_legacy',
        task: '帮我检查语法错误',
        status: 'completed',
        events: [{ title: '本轮完成报告', status: 'completed' }]
      }],
      createdAt: '2026-05-02T01:00:00.000Z',
      updatedAt: '2026-05-02T02:00:00.000Z'
    }]
  };
  const fakeStorageDb = {
    TARGET_SCHEMA_VERSION: 1,
    buildSessionRecord(input) {
      return { ...input };
    },
    putRecords(storeName, records) {
      calls.putRecords.push({ storeName, records });
      return Promise.resolve(records);
    },
    getAllByIndex() {
      return Promise.resolve([]);
    },
    extractLightweightPrefs(blob) {
      return {
        storageSchemaVersion: 1,
        model: blob.model,
        reasoningEffort: blob.reasoningEffort,
        mode: blob.mode,
        requireReviewing: blob.requireReviewing !== false,
        activeSessionByProject: {}
      };
    },
    buildActiveSessionByProject(existing, projectId, sessionId) {
      return { ...existing, [projectId]: sessionId };
    }
  };
  const previousWindow = global.window;
  const previousChrome = global.chrome;
  global.window = { CodexOverleafStorageDb: fakeStorageDb };
  global.chrome = {
    storage: {
      local: {
        get() {
          return Promise.resolve({ [legacyStorageKey]: legacyBlob });
        },
        set(payload) {
          calls.set.push(payload);
          return Promise.resolve();
        },
        remove(key) {
          calls.remove.push(key);
          return Promise.resolve();
        }
      }
    }
  };

  try {
    const result = await Migration.runMigrationIfNeeded('project_1', legacyStorageKey);
    const [record] = calls.putRecords[0].records;

    assert.equal(result.migrated, true);
    assert.equal(record.id, 'session_legacy');
    assert.equal(record.task, '帮我检查语法错误');
    assert.equal(record.mode, 'auto');
    assert.equal(record.model, 'gpt-5.3-codex-spark');
    assert.equal(record.reasoningEffort, 'xhigh');
    assert.equal(record.requireReviewing, false);
    assert.deepEqual(record.focusFiles, ['paper.tex']);
    assert.deepEqual(record.history, legacyBlob.sessions[0].history);
    assert.deepEqual(record.runs, legacyBlob.sessions[0].runs);
    assert.equal(calls.remove[0], legacyStorageKey);
  } finally {
    global.window = previousWindow;
    global.chrome = previousChrome;
  }
});
