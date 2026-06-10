const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { extractFunction } = require('./_helpers/extractFunction');
const SessionState = require('../extension/src/shared/sessionState');

const repo = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('renameSession shared helper enforces the ghost guard (manual vs auto)', () => {
  const base = SessionState.normalizePanelState({
    sessions: [{ id: 's1', title: '', titleSource: 'auto', task: 'fix the intro', runs: [], history: [] }],
    activeSessionId: 's1'
  });
  const derived = SessionState.deriveSessionTitle(base.sessions[0].runs, base.sessions[0].task);
  const opts = { placeholderTitle: 'New Session' };

  const custom = SessionState.renameSession(base, 's1', 'My survey draft', opts).sessions[0];
  assert.equal(custom.titleSource, 'manual');
  assert.equal(custom.title, 'My survey draft');
  // committing the placeholder or the derived/auto title must stay auto
  assert.equal(SessionState.renameSession(base, 's1', 'New Session', opts).sessions[0].titleSource, 'auto');
  assert.equal(SessionState.renameSession(base, 's1', derived, opts).sessions[0].titleSource, 'auto');
  assert.equal(SessionState.renameSession(base, 's1', '   ', opts).sessions[0].titleSource, 'auto');
  // unknown session id is a normalize-only no-op
  const untouched = SessionState.renameSession(base, 'nope', 'X', opts);
  assert.equal(untouched.sessions[0].title, base.sessions[0].title);
});

test('dashboard rows expand into a per-project session list', () => {
  const src = repo('extension/src/content/recentProjects.js');
  assert.match(src, /data-row-expand/);
  assert.match(src, /data-project-sessions/);
  assert.match(src, /data-project-row-wrap/);
  // sessions come from the IndexedDB sessions store by projectId, scoped to
  // the current account, newest first
  const load = extractFunction(src, 'loadProjectSessionRecords');
  assert.match(load, /getAllByIndex\('sessions', 'projectId', projectId\)/);
  assert.match(load, /record\.accountScopeId === scope/);
  assert.match(load, /localeCompare/);
  // running sessions are protected (badge derived from the stored record)
  const rowFn = extractFunction(src, 'renderProjectSessionRow');
  assert.match(rowFn, /derivePrimaryStatusBadge\(record\) === 'running'/);
  assert.match(rowFn, /del\.disabled = true/);
});

test('dashboard delete mirrors the in-project flow: confirm, storage, record, native, toasts', () => {
  const src = repo('extension/src/content/recentProjects.js');
  const del = extractFunction(src, 'deleteDashboardSession');
  assert.match(del, /deleteSessionRunningToast/);
  assert.match(del, /deleteSessionTitle/);
  assert.match(del, /deleteSessionConfirm/);
  assert.match(del, /confirmDefaultCancel/);
  assert.match(del, /destructive: true/);
  assert.match(del, /SessionState\.deleteSession\(state, record\.id\)/);
  assert.match(del, /deleteRecord\('sessions', record\.id\)/);
  assert.match(del, /codex\.history\.clearPlugin/);
  assert.match(del, /sessionId: record\.id/);
  assert.match(del, /threadId: record\.codexThreadId \|\| ''/);
  assert.match(del, /deleteSessionHistoryFailedToast/);
  assert.match(del, /deleteSessionNoThreadToast/);
  assert.match(del, /deleteSessionDoneToast/);
  // the variant re-renders and restores the expansion afterwards
  assert.match(del, /renderRecentProjectsVariant\(\{ expandProjectId: projectId \}\)/);
});

test('dashboard storage writeback uses the same key + normalize/prepare pipeline as saveState', () => {
  const src = repo('extension/src/content/recentProjects.js');
  const mutate = extractFunction(src, 'mutateProjectPanelState');
  assert.match(src, /getProjectStorageKey\(PANEL_STATE_BASE_KEY, 'https:\/\/www\.overleaf\.com\/project\/' \+ projectId\)/);
  assert.match(mutate, /normalizePanelState\(blob\)/);
  assert.match(mutate, /prepareStateForStorage\(nextState\)/);
  // wiring hands over the runtime's storage base key + modal/toast/native fns
  const runtime = repo('extension/src/content/contentRuntime.js');
  assert.match(runtime, /PANEL_STATE_BASE_KEY: LEGACY_STORAGE_KEY/);
  for (const dep of ['showPluginConfirm', 'showPluginToast', 'sendBackgroundNative']) {
    const wiring = runtime.match(/const recentProjects = window\.CodexOverleafRecentProjects\.create\(\{[\s\S]*?\}\);/)?.[0] || '';
    assert.match(wiring, new RegExp(dep));
  }
});

test('dashboard rename reuses the shared ghost guard and treats unchanged input as cancel', () => {
  const src = repo('extension/src/content/recentProjects.js');
  const begin = extractFunction(src, 'beginDashboardSessionRename');
  assert.match(begin, /record\.titleSource === 'manual'/, 'seed only from a real manual title');
  assert.match(begin, /nextRaw\.trim\(\) === seed\.trim\(\)/, 'unchanged rename is a no-op');
  assert.match(begin, /event\.key === 'Escape'/);
  const commit = extractFunction(src, 'commitDashboardSessionRename');
  assert.match(commit, /SessionState\.renameSession\(/);
  assert.match(commit, /placeholderTitle: tr\('newSessionFallback'\)/);
  assert.match(commit, /buildSessionRecord\(/, 'IndexedDB record renormalized via buildSessionRecord');
});

test('dashboard session management i18n + CSS are present', () => {
  const I18n = require('../extension/src/shared/i18n');
  for (const key of ['recentProjects_sessions_empty', 'recentProjects_sessions_toggle']) {
    assert.notEqual(I18n.t('en', key), key, `missing English ${key}`);
    assert.notEqual(I18n.t('zh', key), key, `missing Chinese ${key}`);
  }
  const css = repo('extension/styles/panel.css');
  assert.match(css, /\.recent-projects-row-expand/);
  assert.match(css, /\.recent-projects-sessions \{/);
  assert.match(css, /\.recent-projects-session-row\[data-running="true"\]/);
  assert.match(css, /\.recent-projects-session-action--delete:hover/);
  assert.match(css, /\.recent-projects-session-rename-input/);
});
