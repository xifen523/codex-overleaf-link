const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_PANEL_STATE,
  createSession,
  deleteSession,
  getActiveSession,
  isDisplayableSession,
  normalizePanelState,
  prepareStateForStorage,
  estimateJsonBytes,
  recordSessionResult,
  setActiveSession,
  updateActiveSession
} = require('../extension/src/shared/sessionState');

test('normalizes missing panel state with defaults and a session id', () => {
  const state = normalizePanelState({});

  assert.equal(state.mode, DEFAULT_PANEL_STATE.mode);
  assert.equal(state.model, DEFAULT_PANEL_STATE.model);
  assert.equal(state.reasoningEffort, DEFAULT_PANEL_STATE.reasoningEffort);
  assert.match(state.session.id, /^session_/);
  assert.equal(state.sessions.length, 1);
  assert.equal(state.activeSessionId, state.session.id);
});

test('creates a fresh session with empty history', () => {
  const session = createSession();

  assert.match(session.id, /^session_/);
  assert.deepEqual(session.history, []);
  assert.deepEqual(session.runs, []);
  assert.deepEqual(session.focusFiles, []);
  assert.equal(session.title, 'New task');
});

test('normalizes focus files as session scoped context', () => {
  const state = normalizePanelState({
    activeSessionId: 'session_a',
    sessions: [{
      id: 'session_a',
      title: 'A',
      focusFiles: ['main.tex', '', 'main.tex', 42, 'refs.bib']
    }]
  });

  assert.deepEqual(state.session.focusFiles, ['main.tex', 'refs.bib']);
  assert.deepEqual(state.sessions[0].focusFiles, ['main.tex', 'refs.bib']);

  const updated = updateActiveSession(state, { task: 'Check intro' });
  assert.deepEqual(updated.session.focusFiles, ['main.tex', 'refs.bib']);
  assert.deepEqual(updated.sessions[0].focusFiles, ['main.tex', 'refs.bib']);
});

test('does not display a blank default session as a task', () => {
  assert.equal(isDisplayableSession(createSession()), false);
  assert.equal(isDisplayableSession({
    id: 'session_draft',
    title: 'New task',
    task: 'draft prompt',
    runs: [],
    history: []
  }), true);
  assert.equal(isDisplayableSession({
    id: 'session_run',
    title: 'New task',
    task: '',
    runs: [{ id: 'run_1', task: 'done', status: 'completed' }],
    history: []
  }), true);
});

test('records bounded session history', () => {
  let session = createSession();
  for (let index = 0; index < 12; index += 1) {
    session = recordSessionResult(session, {
      task: `task ${index}`,
      result: `result ${index}`
    });
  }

  assert.equal(session.history.length, 10);
  assert.equal(session.history[0].task, 'task 2');
  assert.equal(session.history[9].task, 'task 11');
});

test('migrates legacy single-session state into a switchable session list', () => {
  const state = normalizePanelState({
    mode: 'confirm',
    model: 'gpt-5.5',
    reasoningEffort: 'xhigh',
    requireReviewing: false,
    task: 'legacy draft',
    session: { id: 'session_legacy', history: [{ task: 'old task', result: 'done' }] },
    runs: [{ id: 'run_legacy', task: 'old task', status: 'completed' }]
  });

  assert.equal(state.sessions.length, 1);
  assert.equal(state.activeSessionId, 'session_legacy');
  assert.equal(state.session.id, 'session_legacy');
  assert.equal(state.task, 'legacy draft');
  assert.equal(state.mode, 'confirm');
  assert.equal(state.model, 'gpt-5.5');
  assert.equal(state.reasoningEffort, 'xhigh');
  assert.equal(state.requireReviewing, false);
  assert.equal(state.runs[0].id, 'run_legacy');
  assert.equal(getActiveSession(state).runs[0].id, 'run_legacy');
});

test('switches active session and mirrors composer settings from that session', () => {
  const state = normalizePanelState({
    activeSessionId: 'session_b',
    sessions: [{
      id: 'session_a',
      title: 'A',
      task: 'draft a',
      mode: 'auto',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      runs: [{ id: 'run_a', task: 'task a', status: 'completed' }]
    }, {
      id: 'session_b',
      title: 'B',
      task: 'draft b',
      mode: 'confirm',
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
      runs: [{ id: 'run_b', task: 'task b', status: 'completed' }]
    }]
  });

  assert.equal(state.session.id, 'session_b');
  assert.equal(state.task, 'draft b');
  assert.equal(state.mode, 'confirm');
  assert.equal(state.model, 'gpt-5.5');
  assert.equal(state.reasoningEffort, 'xhigh');
  assert.equal(state.runs[0].id, 'run_b');
});

test('updates active session without mutating inactive sessions', () => {
  const state = normalizePanelState({
    activeSessionId: 'session_b',
    sessions: [
      { id: 'session_a', title: 'A', task: 'draft a', runs: [] },
      { id: 'session_b', title: 'B', task: 'draft b', runs: [] }
    ]
  });

  const updated = updateActiveSession(state, {
    task: 'new draft',
    runs: [{ id: 'run_new', task: 'new draft', status: 'completed' }]
  });

  assert.equal(updated.sessions[0].task, 'draft a');
  assert.equal(updated.sessions[1].task, 'new draft');
  assert.equal(updated.task, 'new draft');
  assert.equal(updated.runs[0].id, 'run_new');
});

test('sets active session without re-normalizing running runs', () => {
  const state = normalizePanelState({
    activeSessionId: 'session_a',
    sessions: [
      { id: 'session_a', title: 'A', runs: [] },
      { id: 'session_b', title: 'B', runs: [{ id: 'run_b', task: 'task b', status: 'running' }] }
    ]
  });

  const switched = setActiveSession(state, 'session_b');

  assert.equal(switched.session.id, 'session_b');
  assert.equal(switched.runs[0].status, 'failed');
  assert.equal(switched.runs[0].events.length, 1);
});

test('deletes inactive sessions without changing the active session', () => {
  const state = normalizePanelState({
    activeSessionId: 'session_b',
    sessions: [
      { id: 'session_a', title: 'A', runs: [{ id: 'run_a', task: 'task a', status: 'completed' }] },
      { id: 'session_b', title: 'B', task: 'draft b', runs: [{ id: 'run_b', task: 'task b', status: 'completed' }] }
    ]
  });

  const updated = deleteSession(state, 'session_a');

  assert.deepEqual(updated.sessions.map(session => session.id), ['session_b']);
  assert.equal(updated.activeSessionId, 'session_b');
  assert.equal(updated.session.id, 'session_b');
  assert.equal(updated.task, 'draft b');
  assert.equal(updated.runs[0].id, 'run_b');
});

test('deletes active sessions and switches to the most recent remaining session', () => {
  const state = normalizePanelState({
    activeSessionId: 'session_b',
    sessions: [
      { id: 'session_a', title: 'A', updatedAt: '2026-05-01T10:00:00.000Z', runs: [] },
      { id: 'session_b', title: 'B', updatedAt: '2026-05-01T11:00:00.000Z', runs: [] },
      { id: 'session_c', title: 'C', updatedAt: '2026-05-01T12:00:00.000Z', task: 'draft c', runs: [] }
    ]
  });

  const updated = deleteSession(state, 'session_b');

  assert.deepEqual(updated.sessions.map(session => session.id), ['session_a', 'session_c']);
  assert.equal(updated.activeSessionId, 'session_c');
  assert.equal(updated.session.id, 'session_c');
  assert.equal(updated.task, 'draft c');
});

test('deleting the final session creates a fresh empty active session', () => {
  const state = normalizePanelState({
    activeSessionId: 'session_only',
    mode: 'confirm',
    model: 'gpt-5.5',
    reasoningEffort: 'xhigh',
    sessions: [
      { id: 'session_only', title: 'Only', task: 'draft', mode: 'confirm', model: 'gpt-5.5', reasoningEffort: 'xhigh', runs: [] }
    ]
  });

  const updated = deleteSession(state, 'session_only');

  assert.equal(updated.sessions.length, 1);
  assert.notEqual(updated.session.id, 'session_only');
  assert.equal(updated.session.id, updated.activeSessionId);
  assert.equal(updated.task, '');
  assert.deepEqual(updated.runs, []);
  assert.equal(updated.mode, 'confirm');
  assert.equal(updated.model, 'gpt-5.5');
  assert.equal(updated.reasoningEffort, 'xhigh');
});

test('normalizes bounded persisted run history for the panel', () => {
  const state = normalizePanelState({
    runs: Array.from({ length: 24 }, (_, index) => ({
      id: `run_${index}`,
      task: `task ${index}`,
      status: index % 2 ? 'completed' : 'running',
      events: [{ title: `event ${index}` }],
      undoOperations: index === 23 ? [{ type: 'edit', path: 'main.tex', replaceAll: 'before' }] : [],
      undoBaseFiles: index === 23 ? [{ path: 'main.tex', content: 'after' }] : []
    }))
  });

  assert.equal(state.runs.length, 20);
  assert.equal(state.runs[0].id, 'run_4');
  assert.equal(state.runs[19].id, 'run_23');
  assert.equal(state.runs[19].status, 'completed');
  assert.deepEqual(state.runs[19].undoOperations, [{ type: 'edit', path: 'main.tex', replaceAll: 'before' }]);
  assert.deepEqual(state.runs[19].undoBaseFiles, [{ path: 'main.tex', content: 'after' }]);
});

test('preserves stream metadata and enough processing history for completed runs', () => {
  const state = normalizePanelState({
    runs: [{
      id: 'run_stream_history',
      task: 'check references',
      status: 'completed',
      events: Array.from({ length: 120 }, (_, index) => index === 119
        ? {
          title: 'Final answer',
          status: 'completed',
          kind: 'stream',
          streamKey: 'agent:final',
          streamRole: 'assistant'
        }
        : {
          title: `process ${index}`,
          status: 'running',
          kind: 'activity'
        })
    }]
  });

  assert.equal(state.runs[0].events.length, 120);
  const final = state.runs[0].events.at(-1);
  assert.equal(final.kind, 'stream');
  assert.equal(final.streamKey, 'agent:final');
  assert.equal(final.streamRole, 'assistant');
});

test('marks restored running runs as interrupted', () => {
  const state = normalizePanelState({
    runs: [{
      id: 'run_active',
      task: 'still running before reload',
      status: 'running',
      statusText: 'Running',
      events: [{ title: 'Codex exec started', status: 'running' }]
    }]
  });

  assert.equal(state.runs[0].status, 'failed');
  assert.equal(state.runs[0].statusText, 'Interrupted by page reload');
  assert.equal(state.runs[0].events[1].title, 'Run interrupted by page reload');
});

test('prepares a compact persisted state without storing huge historical payloads', () => {
  const largeText = 'x'.repeat(20000);
  const undoText = 'u'.repeat(120000);
  const state = normalizePanelState({
    activeSessionId: 'session_heavy',
    sessions: [{
      id: 'session_heavy',
      title: 'Heavy',
      task: 'Inspect a large manuscript',
      runs: Array.from({ length: 12 }, (_, index) => ({
        id: `run_${index}`,
        task: `task ${index}`,
        status: 'completed',
        events: Array.from({ length: 20 }, (__, eventIndex) => ({
          title: `**reasoning ${eventIndex}** ${largeText}`,
          detail: { raw: largeText },
          technicalDetail: { raw: largeText },
          kind: eventIndex % 2 ? 'stream' : 'activity'
        })),
        undoOperations: [{ type: 'edit', path: 'main.tex', replaceAll: undoText }],
        undoBaseFiles: [
          { path: 'main.tex', content: undoText }
        ]
      }))
    }]
  });

  const compact = prepareStateForStorage(state);
  const activeStoredSession = compact.sessions.find(session => session.id === compact.activeSessionId);

  assert.ok(estimateJsonBytes(compact) < 4 * 1024 * 1024);
  assert.equal(compact.runs.length, 0);
  assert.equal(activeStoredSession.runs.length, 10);
  assert.equal(activeStoredSession.runs[0].events.length, 20);
  assert.equal(activeStoredSession.runs[0].events[0].technicalDetail, undefined);
  assert.ok(activeStoredSession.runs[0].events[0].title.length < 6100);
  assert.equal(activeStoredSession.runs[0].undoOperations.length, 0);
  assert.equal(activeStoredSession.runs.at(-1).undoOperations.length, 1);
});

test('aggressive storage preparation preserves the active session essentials under a smaller cap', () => {
  const state = normalizePanelState({
    activeSessionId: 'session_active',
    sessions: Array.from({ length: 16 }, (_, index) => ({
      id: index === 1 ? 'session_active' : `session_${index}`,
      title: `Session ${index}`,
      task: `task ${index} ${'x'.repeat(10000)}`,
      runs: Array.from({ length: 8 }, (__, runIndex) => ({
        id: `run_${index}_${runIndex}`,
        task: `run ${runIndex}`,
        status: 'completed',
        events: Array.from({ length: 80 }, (___, eventIndex) => ({
          title: `event ${eventIndex} ${'y'.repeat(5000)}`,
          detail: { text: 'z'.repeat(5000) }
        }))
      }))
    }))
  });

  const compact = prepareStateForStorage(state, { aggressive: true });

  assert.ok(estimateJsonBytes(compact) < 768 * 1024);
  assert.equal(compact.activeSessionId, 'session_active');
  assert.equal(compact.sessions.some(session => session.id === 'session_active'), true);
  const activeStoredSession = compact.sessions.find(session => session.id === compact.activeSessionId);
  assert.equal(compact.runs.length, 0);
  assert.ok(activeStoredSession.runs.length <= 3);
  assert.ok(activeStoredSession.runs.every(run => run.events.length <= 20));
});
