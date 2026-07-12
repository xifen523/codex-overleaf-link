const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { extractFunction } = require('./_helpers/extractFunction');
const { createSession, normalizePanelState } = require('../extension/src/shared/sessionState');

const repo = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

test('normalizePanelState prunes inactive empty sessions but keeps the active empty + real ones', () => {
  const real = { ...createSession(), id: 's_real', task: 'rewrite the intro' };
  const emptyActive = { ...createSession(), id: 's_active' };
  const emptyOther = { ...createSession(), id: 's_other' };
  const state = normalizePanelState({
    sessions: [real, emptyOther, emptyActive],
    activeSessionId: 's_active'
  });
  const ids = state.sessions.map(session => session.id);
  assert.ok(ids.includes('s_real'), 'a session with real work is kept');
  assert.ok(ids.includes('s_active'), 'the active empty session is kept (never left with nothing)');
  assert.equal(ids.includes('s_other'), false, 'an inactive empty session is pruned');
});

test('normalizePanelState never prunes the sole session', () => {
  const onlyEmpty = { ...createSession(), id: 's_only' };
  const state = normalizePanelState({ sessions: [onlyEmpty], activeSessionId: 's_only' });
  assert.equal(state.sessions.length, 1);
  assert.equal(state.sessions[0].id, 's_only');
});

test('startNewSession reuses an empty idle active session instead of minting a ghost', () => {
  // v1.4.7: the session lifecycle lives in sessionManager.js.
  const src = repo('extension/src/content/sessionManager.js');
  const body = extractFunction(src, 'startNewSession');
  assert.match(body, /!isDisplayableSession\(active\)\s*&&\s*!isSessionRunning\(active\)/);
  assert.match(body, /\[data-task\]'\)\?\.focus\(\)/);
});

test('the active-session header bar exposes inline rename + delete', () => {
  const renderer = repo('extension/src/content/panelRenderer.js');
  const runtime = repo('extension/src/content/sessionMenuView.js');
  // markup
  assert.match(renderer, /data-session-label-text/);
  assert.match(renderer, /data-session-rename-input/);
  assert.match(renderer, /data-session-rename\b/);
  assert.match(renderer, /data-session-delete\b/);
  // wiring + flow
  assert.match(runtime, /function bindActiveSessionHeader\(/);
  assert.match(runtime, /function beginActiveSessionRename\(/);
  assert.match(runtime, /deleteSessionWithConfirm\(getState\(\)\.activeSessionId\)/);
  // header never blank: empty active falls back to the placeholder
  const label = extractFunction(runtime, 'applySessionLabel');
  assert.match(label, /newSessionFallback/);
  assert.match(label, /data-session-label-text/);
});

test('deleting an empty session skips the modal; deleting the only session reads as Reset', () => {
  const runtime = repo('extension/src/content/sessionManager.js');
  const body = extractFunction(runtime, 'deleteSessionWithConfirm');
  assert.match(body, /!isDisplayableSession\(target\)/, 'empty sessions take a skip-modal branch');
  assert.match(body, /deleteSessionDeletedToast/);
  assert.match(body, /lastSession\s*=\s*remaining\.length === 0/);
  assert.match(body, /resetSessionTitle/);
  assert.match(body, /resetSessionConfirm/);
});

test('the session list keeps its expanded state across re-renders', () => {
  const sessionPanel = repo('extension/src/content/sessionPanel.js');
  const update = extractFunction(sessionPanel, 'update');
  assert.match(update, /if \(updateOptions\.showAll !== undefined\)/, 'showAll only changes when explicitly provided');
  const runtime = repo('extension/src/content/sessionManager.js');
  const renderList = extractFunction(runtime, 'renderSessionList');
  assert.match(renderList, /if \(options\.showAll !== undefined\)/);
});

test('session list keyboard navigation + empty hint', () => {
  const sessionPanel = repo('extension/src/content/sessionPanel.js');
  assert.match(sessionPanel, /event\.key === 'ArrowDown'/);
  assert.match(sessionPanel, /event\.key === 'Delete'/);
  assert.match(sessionPanel, /codex-session-empty-hint/);
  assert.match(sessionPanel, /data-i18n="sessionsHead"/);
});

test('renaming never promotes the placeholder/auto-derived title to a manual ghost', () => {
  // Adversarial-review regression: header-renaming an empty session must not
  // commit the localized "New Session" placeholder as a manual title (which
  // would resurrect the ghost the prune/reuse-guard eliminate).
  const runtime = repo('extension/src/content/sessionManager.js');
  const commit = extractFunction(runtime, 'commitSessionRename');
  assert.match(commit, /cleanTitle !== tr\('newSessionFallback'\)/);
  assert.match(commit, /cleanTitle !== derived/);
  assert.match(commit, /titleSource: isCustom \? 'manual' : 'auto'/);
  const view = repo('extension/src/content/sessionMenuView.js');
  const begin = extractFunction(view, 'beginActiveSessionRename');
  assert.match(begin, /isDisplayableSession\(active\) \? getSessionDisplayTitle\(active\) : ''/);
  assert.match(begin, /input\.value\.trim\(\) !== seed\.trim\(\)/, 'an unchanged rename is a no-op');
});

test('header delete is disabled for the sole empty session + rename control is localized', () => {
  const runtime = repo('extension/src/content/sessionMenuView.js');
  const label = extractFunction(runtime, 'applySessionLabel');
  assert.match(label, /soleEmpty/);
  assert.match(label, /\.length <= 1/);
  assert.match(label, /renameButton\.title = tr\('renameSession'\)/);
});

test('session-management i18n is available in English and Chinese', () => {
  const I18n = require('../extension/src/shared/i18n');
  for (const key of ['sessionsHead', 'sessionListEmpty', 'deleteSessionDeletedToast', 'resetSessionTitle', 'resetSessionMessage', 'resetSessionConfirm', 'sessionMenuOpen']) {
    assert.notEqual(I18n.t('en', key), key, `missing English ${key}`);
    assert.notEqual(I18n.t('zh', key), key, `missing Chinese ${key}`);
  }
});

test('the header title is a session dropdown: list, switch, and New session in place', () => {
  const renderer = repo('extension/src/content/panelRenderer.js');
  assert.match(renderer, /data-session-menu-trigger/);
  assert.match(renderer, /data-session-menu\b/);
  assert.match(renderer, /codex-thread-title-chevron/);

  const manager = repo('extension/src/content/sessionMenuView.js');
  assert.match(manager, /function toggleSessionMenu\(/);
  assert.match(manager, /function closeSessionMenu\(/);
  const render = extractFunction(manager, 'renderSessionMenu');
  // every saved (displayable) session, newest first, active + running marked
  assert.match(render, /filter\(isDisplayableSession\)/);
  assert.match(render, /sort\(/);
  assert.match(render, /dataset\.active = session\.id === state\?\.activeSessionId/);
  assert.match(render, /dataset\.running = isSessionRunning\(session\)/);
  assert.match(render, /formatSessionTime\(session\.updatedAt \|\| session\.createdAt\)/);
  // row click switches (no-op for the active row); footer mints a new session
  assert.match(render, /switchSession\(session\.id\)/);
  assert.match(render, /startNewSession\(\)/);
  assert.match(render, /tr\('newSession'\)/);
  // outside-click dismiss uses the capture phase so panel click-stoppers
  // cannot swallow it; Escape closes too
  const bindBody = extractFunction(manager, 'bindActiveSessionHeader');
  assert.match(bindBody, /document\.addEventListener\('click',[\s\S]*?, true\)/);
  assert.match(bindBody, /event\.key === 'Escape'/);
  // renaming hides the trigger while the input is showing
  const begin = extractFunction(manager, 'beginActiveSessionRename');
  assert.match(begin, /trigger\.hidden = true/);
  // trigger is localized like the rest of the header bar
  const label = extractFunction(manager, 'applySessionLabel');
  assert.match(label, /tr\('sessionMenuOpen'\)/);

  const css = repo('extension/styles/panel.css');
  assert.match(css, /\.codex-session-menu \{/);
  assert.match(css, /\.codex-session-menu-item\[data-active="true"\]/);
  assert.match(css, /\.codex-thread-title-trigger/);
});

test('panel.css styles the active-session bar and visible row controls', () => {
  const css = repo('extension/styles/panel.css');
  assert.match(css, /\.codex-thread-title-text/);
  assert.match(css, /\.codex-thread-title-action--delete:hover/);
  assert.match(css, /\.codex-session-empty-hint/);
  // delete row control gets a distinct red hover
  assert.match(css, /\.codex-session-delete:hover\s*\{[^}]*var\(--tl-fail\)/);
});
