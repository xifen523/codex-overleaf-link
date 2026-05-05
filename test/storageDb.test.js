const assert = require('node:assert/strict');
const test = require('node:test');

const {
  TARGET_SCHEMA_VERSION,
  DB_NAME,
  STORES,
  buildSessionRecord,
  buildTurnRecord,
  buildEventRecord,
  buildArtifactRecord,
  extractLightweightPrefs,
  buildActiveSessionByProject
} = require('../extension/src/shared/storageDb');

test('TARGET_SCHEMA_VERSION is a positive integer', () => {
  assert.equal(typeof TARGET_SCHEMA_VERSION, 'number');
  assert.ok(TARGET_SCHEMA_VERSION > 0);
  assert.equal(TARGET_SCHEMA_VERSION, Math.floor(TARGET_SCHEMA_VERSION));
});

test('DB_NAME is codex-overleaf', () => {
  assert.equal(DB_NAME, 'codex-overleaf');
});

test('STORES has four stores with correct structure', () => {
  const storeNames = Object.keys(STORES);
  assert.deepEqual(storeNames.sort(), ['artifacts', 'events', 'sessions', 'turns']);

  // sessions store
  assert.equal(STORES.sessions.keyPath, 'id');
  assert.deepEqual(Object.keys(STORES.sessions.indexes).sort(), ['projectId', 'updatedAt']);
  assert.equal(STORES.sessions.indexes.projectId.keyPath, 'projectId');
  assert.equal(STORES.sessions.indexes.updatedAt.keyPath, 'updatedAt');

  // turns store
  assert.equal(STORES.turns.keyPath, 'id');
  assert.deepEqual(Object.keys(STORES.turns.indexes).sort(), ['createdAt', 'sessionId']);
  assert.equal(STORES.turns.indexes.sessionId.keyPath, 'sessionId');
  assert.equal(STORES.turns.indexes.createdAt.keyPath, 'createdAt');

  // events store
  assert.equal(STORES.events.keyPath, 'id');
  assert.deepEqual(Object.keys(STORES.events.indexes).sort(), ['index', 'turnId']);
  assert.equal(STORES.events.indexes.turnId.keyPath, 'turnId');
  assert.equal(STORES.events.indexes.index.keyPath, 'index');

  // artifacts store
  assert.equal(STORES.artifacts.keyPath, 'id');
  assert.deepEqual(Object.keys(STORES.artifacts.indexes).sort(), ['turnId', 'type']);
  assert.equal(STORES.artifacts.indexes.turnId.keyPath, 'turnId');
  assert.equal(STORES.artifacts.indexes.type.keyPath, 'type');
});

test('STORES indexes all have unique: false', () => {
  for (const storeName of Object.keys(STORES)) {
    const indexes = STORES[storeName].indexes;
    for (const indexName of Object.keys(indexes)) {
      assert.equal(indexes[indexName].unique, false,
        `${storeName}.${indexName} should have unique: false`);
    }
  }
});

test('buildSessionRecord normalizes with defaults', () => {
  const record = buildSessionRecord({ id: 'ses_1', projectId: 'proj_1' });
  assert.equal(record.id, 'ses_1');
  assert.equal(record.projectId, 'proj_1');
  assert.equal(record.title, '');
  assert.equal(record.codexThreadId, '');
  assert.equal(record.status, 'active');
  assert.deepEqual(record.focusFiles, []);
  assert.ok(typeof record.createdAt === 'string' && record.createdAt.length > 0);
  assert.ok(typeof record.updatedAt === 'string' && record.updatedAt.length > 0);
});

test('buildSessionRecord preserves provided values', () => {
  const input = {
    id: 'ses_custom',
    projectId: 'proj_2',
    title: 'My Session',
    codexThreadId: 'thread_abc',
    status: 'completed',
    focusFiles: ['main.tex', 'intro.tex'],
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-02T00:00:00.000Z'
  };
  const record = buildSessionRecord(input);
  assert.equal(record.id, 'ses_custom');
  assert.equal(record.projectId, 'proj_2');
  assert.equal(record.title, 'My Session');
  assert.equal(record.codexThreadId, 'thread_abc');
  assert.equal(record.status, 'completed');
  assert.deepEqual(record.focusFiles, ['main.tex', 'intro.tex']);
  assert.equal(record.createdAt, '2025-01-01T00:00:00.000Z');
  assert.equal(record.updatedAt, '2025-01-02T00:00:00.000Z');
});

test('buildSessionRecord preserves reloadable session state', () => {
  const input = {
    id: 'ses_stateful',
    projectId: 'proj_stateful',
    title: 'Check grammar',
    task: '帮我检查语法错误',
    mode: 'auto',
    model: 'gpt-5.3-codex-spark',
    reasoningEffort: 'xhigh',
    speedTier: 'fast',
    requireReviewing: false,
    history: [{ task: '上一轮', result: '改了摘要', at: '2026-05-02T01:00:00.000Z' }],
    runs: [{
      id: 'run_1',
      task: '帮我检查语法错误',
      status: 'completed',
      events: [{ title: 'Codex 完成处理。', status: 'completed' }]
    }]
  };

  const record = buildSessionRecord(input);

  assert.equal(record.task, '帮我检查语法错误');
  assert.equal(record.mode, 'auto');
  assert.equal(record.model, 'gpt-5.3-codex-spark');
  assert.equal(record.reasoningEffort, 'xhigh');
  assert.equal(record.speedTier, 'fast');
  assert.equal(record.requireReviewing, false);
  assert.deepEqual(record.history, input.history);
  assert.deepEqual(record.runs, input.runs);
});

test('buildSessionRecord generates id when not provided', () => {
  const record = buildSessionRecord({ projectId: 'proj_3' });
  assert.ok(record.id.startsWith('ses_'));
  assert.ok(record.id.length > 4);
});

test('buildTurnRecord normalizes with defaults', () => {
  const record = buildTurnRecord({ id: 'turn_1', sessionId: 'ses_1' });
  assert.equal(record.id, 'turn_1');
  assert.equal(record.sessionId, 'ses_1');
  assert.equal(record.task, '');
  assert.equal(record.mode, '');
  assert.equal(record.model, '');
  assert.equal(record.reasoningEffort, '');
  assert.equal(record.speedTier, '');
  assert.ok(typeof record.createdAt === 'string' && record.createdAt.length > 0);
  assert.equal(record.completedAt, '');
  assert.equal(record.finalSummary, '');
});

test('buildTurnRecord preserves provided values', () => {
  const input = {
    id: 'turn_x',
    sessionId: 'ses_x',
    task: 'Fix the bug',
    mode: 'auto',
    model: 'gpt-5.4',
    reasoningEffort: 'high',
    speedTier: 'fast',
    createdAt: '2025-03-01T00:00:00.000Z',
    completedAt: '2025-03-01T00:05:00.000Z',
    finalSummary: 'Bug fixed successfully'
  };
  const record = buildTurnRecord(input);
  assert.equal(record.id, 'turn_x');
  assert.equal(record.sessionId, 'ses_x');
  assert.equal(record.task, 'Fix the bug');
  assert.equal(record.mode, 'auto');
  assert.equal(record.model, 'gpt-5.4');
  assert.equal(record.reasoningEffort, 'high');
  assert.equal(record.speedTier, 'fast');
  assert.equal(record.createdAt, '2025-03-01T00:00:00.000Z');
  assert.equal(record.completedAt, '2025-03-01T00:05:00.000Z');
  assert.equal(record.finalSummary, 'Bug fixed successfully');
});

test('buildTurnRecord generates id when not provided', () => {
  const record = buildTurnRecord({ sessionId: 'ses_1' });
  assert.ok(record.id.startsWith('turn_'));
});

test('buildEventRecord normalizes with defaults', () => {
  const record = buildEventRecord({ id: 'evt_1', turnId: 'turn_1' });
  assert.equal(record.id, 'evt_1');
  assert.equal(record.turnId, 'turn_1');
  assert.equal(record.index, 0);
  assert.equal(record.kind, '');
  assert.equal(record.text, '');
  assert.equal(record.detail, null);
  assert.ok(typeof record.createdAt === 'string' && record.createdAt.length > 0);
});

test('buildEventRecord preserves provided values', () => {
  const input = {
    id: 'evt_x',
    turnId: 'turn_x',
    index: 5,
    kind: 'file_edit',
    text: 'Edited main.tex',
    detail: { path: 'main.tex' },
    createdAt: '2025-04-01T00:00:00.000Z'
  };
  const record = buildEventRecord(input);
  assert.equal(record.id, 'evt_x');
  assert.equal(record.turnId, 'turn_x');
  assert.equal(record.index, 5);
  assert.equal(record.kind, 'file_edit');
  assert.equal(record.text, 'Edited main.tex');
  assert.deepEqual(record.detail, { path: 'main.tex' });
  assert.equal(record.createdAt, '2025-04-01T00:00:00.000Z');
});

test('buildEventRecord generates id when not provided', () => {
  const record = buildEventRecord({ turnId: 'turn_1', index: 0 });
  assert.ok(record.id.startsWith('evt_'));
});

test('buildArtifactRecord normalizes with defaults', () => {
  const record = buildArtifactRecord({ id: 'art_1', turnId: 'turn_1' });
  assert.equal(record.id, 'art_1');
  assert.equal(record.turnId, 'turn_1');
  assert.equal(record.type, '');
  assert.equal(record.path, '');
  assert.equal(record.payload, null);
  assert.ok(typeof record.createdAt === 'string' && record.createdAt.length > 0);
});

test('buildArtifactRecord preserves provided values', () => {
  const input = {
    id: 'art_x',
    turnId: 'turn_x',
    type: 'file',
    path: 'output/result.pdf',
    payload: { size: 1024 },
    createdAt: '2025-05-01T00:00:00.000Z'
  };
  const record = buildArtifactRecord(input);
  assert.equal(record.id, 'art_x');
  assert.equal(record.turnId, 'turn_x');
  assert.equal(record.type, 'file');
  assert.equal(record.path, 'output/result.pdf');
  assert.deepEqual(record.payload, { size: 1024 });
  assert.equal(record.createdAt, '2025-05-01T00:00:00.000Z');
});

test('buildArtifactRecord generates id when not provided', () => {
  const record = buildArtifactRecord({ turnId: 'turn_1', type: 'file' });
  assert.ok(record.id.startsWith('art_'));
});

test('extractLightweightPrefs extracts correct fields', () => {
  const state = {
    model: 'gpt-5.4',
    reasoningEffort: 'high',
    speedTier: 'fast',
    mode: 'confirm',
    locale: 'zh',
    requireReviewing: true,
    autoRecompile: true,
    panelWidth: 512,
    activeSessionByProject: { proj_1: 'ses_1' },
    experimentalOtByProject: { proj_1: true, proj_2: false },
    extraField: 'should be ignored',
    sessions: [{ id: 'ses_1' }]
  };
  const prefs = extractLightweightPrefs(state, 'proj_1');
  assert.equal(prefs.storageSchemaVersion, TARGET_SCHEMA_VERSION);
  assert.equal(prefs.model, 'gpt-5.4');
  assert.equal(prefs.reasoningEffort, 'high');
  assert.equal(prefs.speedTier, 'fast');
  assert.equal(prefs.mode, 'confirm');
  assert.equal(prefs.locale, 'zh');
  assert.equal(prefs.requireReviewing, true);
  assert.equal(prefs.autoRecompile, true);
  assert.equal(prefs.panelWidth, 512);
  assert.deepEqual(prefs.activeSessionByProject, { proj_1: 'ses_1' });
  assert.deepEqual(prefs.experimentalOtByProject, { proj_1: true, proj_2: false });
  assert.equal(prefs.extraField, undefined);
  assert.equal(prefs.sessions, undefined);
});

test('extractLightweightPrefs preserves only literal true experimental OT project prefs', () => {
  const prefs = extractLightweightPrefs({
    experimentalOtByProject: {
      proj_true: true,
      proj_false: false,
      proj_number: 1,
      proj_empty: '',
      proj_string: 'enabled',
      proj_object: {},
      proj_array: []
    }
  }, 'proj_true');

  assert.deepEqual(prefs.experimentalOtByProject, {
    proj_true: true,
    proj_false: false,
    proj_number: false,
    proj_empty: false,
    proj_string: false,
    proj_object: false,
    proj_array: false
  });
  assert.deepEqual(
    Object.values(prefs.experimentalOtByProject).map(value => typeof value),
    ['boolean', 'boolean', 'boolean', 'boolean', 'boolean', 'boolean', 'boolean']
  );
});

test('extractLightweightPrefs defaults missing values', () => {
  const prefs = extractLightweightPrefs({}, 'proj_2');
  assert.equal(prefs.storageSchemaVersion, TARGET_SCHEMA_VERSION);
  assert.equal(prefs.model, '');
  assert.equal(prefs.reasoningEffort, '');
  assert.equal(prefs.speedTier, '');
  assert.equal(prefs.mode, '');
  assert.equal(prefs.locale, '');
  assert.equal(prefs.requireReviewing, true);
  assert.equal(prefs.autoRecompile, true);
  assert.equal(prefs.panelWidth, 0);
  assert.deepEqual(prefs.activeSessionByProject, {});
  assert.deepEqual(prefs.experimentalOtByProject, {});
});

test('buildActiveSessionByProject merges new mapping into empty existing', () => {
  const result = buildActiveSessionByProject({}, 'proj_1', 'ses_1');
  assert.deepEqual(result, { proj_1: 'ses_1' });
});

test('buildActiveSessionByProject merges new mapping into existing', () => {
  const existing = { proj_1: 'ses_1', proj_2: 'ses_2' };
  const result = buildActiveSessionByProject(existing, 'proj_3', 'ses_3');
  assert.deepEqual(result, { proj_1: 'ses_1', proj_2: 'ses_2', proj_3: 'ses_3' });
});

test('buildActiveSessionByProject overwrites existing project mapping', () => {
  const existing = { proj_1: 'ses_old' };
  const result = buildActiveSessionByProject(existing, 'proj_1', 'ses_new');
  assert.deepEqual(result, { proj_1: 'ses_new' });
});

test('buildActiveSessionByProject handles null/undefined existing', () => {
  const result = buildActiveSessionByProject(null, 'proj_1', 'ses_1');
  assert.deepEqual(result, { proj_1: 'ses_1' });

  const result2 = buildActiveSessionByProject(undefined, 'proj_2', 'ses_2');
  assert.deepEqual(result2, { proj_2: 'ses_2' });
});

test('buildActiveSessionByProject skips empty projectId', () => {
  const existing = { proj_1: 'ses_1' };
  const result = buildActiveSessionByProject(existing, '', 'ses_new');
  assert.deepEqual(result, { proj_1: 'ses_1' });
});
