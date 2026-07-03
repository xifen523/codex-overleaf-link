(function initCodexOverleafSessionManager() {
  'use strict';

  const SessionPanel = window.CodexOverleafSessionPanel;
  const {
    createSession,
    deleteSession,
    setActiveSession,
    getActiveSession,
    isDisplayableSession,
    normalizePanelState,
    deriveSessionTitle
  } = window.CodexOverleafSessionState;

  // Session manager — the session lifecycle + list/rename/delete surface
  // carved out of contentRuntime.js (v1.4.7 structural-debt phase 3). Code
  // moved verbatim except that mutable runtime state is read through
  // getState()/getPanel()/getSessionPanelInstance() and written back through
  // setState() (sessions are immutable-update: every mutation rebuilds state
  // via the shared sessionState helpers and hands it back to the runtime).
  function create(deps = {}) {
    const {
      tr,
      showPluginConfirm,
      showPluginToast,
      sendBackgroundNative,
      saveState,
      saveStateSoon,
      readPanelInputs,
      applyStateToPanel,
      getPanel,
      getState,
      setState,
      getSessionPanelInstance,
      formatSessionTime
    } = deps;

  function applySessionLabel() {
    const trigger = getPanel().querySelector('[data-session-menu-trigger]');
    if (trigger) {
      trigger.title = tr('sessionMenuOpen');
      trigger.setAttribute('aria-label', tr('sessionMenuOpen'));
    }
    const textNode = getPanel().querySelector('[data-session-label-text]');
    const deleteButton = getPanel().querySelector('[data-session-delete]');
    const renameButton = getPanel().querySelector('[data-session-rename]');
    const renameInput = getPanel().querySelector('[data-session-rename-input]');
    const active = getActiveSession(getState());
    if (textNode) {
      // Always show a title — fall back to the New Session placeholder for an
      // empty active session (which has no list row), so the session you are in
      // is never blank and unmanageable from the header.
      textNode.textContent = active && isDisplayableSession(active)
        ? getSessionDisplayTitle(active)
        : tr('newSessionFallback');
    }
    if (deleteButton) {
      const running = active ? isSessionRunning(active) : false;
      // Deleting the sole empty session is a documented no-op (it would just
      // mint another empty), so disable it rather than leave a dead click.
      const soleEmpty = Boolean(active) && !isDisplayableSession(active) && (getState()?.sessions || []).length <= 1;
      deleteButton.disabled = !active || running || soleEmpty;
      deleteButton.title = running ? tr('deleteRunningSession') : tr('deleteSession');
      deleteButton.setAttribute('aria-label', running ? tr('deleteRunningSession') : tr('deleteSession'));
    }
    if (renameButton) {
      renameButton.title = tr('renameSession');
      renameButton.setAttribute('aria-label', tr('renameSession'));
    }
    renameInput?.setAttribute('aria-label', tr('renameSession'));
  }

  // Wire the active-session header bar once (rename + delete act on the active
  // session, reusing the same paths as the per-row controls).
  function bindActiveSessionHeader() {
    getPanel().querySelector('[data-session-delete]')?.addEventListener('click', event => {
      event.stopPropagation();
      if (getState()?.activeSessionId) {
        deleteSessionWithConfirm(getState().activeSessionId);
      }
    });
    getPanel().querySelector('[data-session-rename]')?.addEventListener('click', event => {
      event.stopPropagation();
      beginActiveSessionRename();
    });
    getPanel().querySelector('[data-session-menu-trigger]')?.addEventListener('click', event => {
      event.stopPropagation();
      toggleSessionMenu();
    });
    // Close the dropdown on any click outside it (capture phase, so the
    // panel's own click-stoppers don't swallow the dismiss — same pattern as
    // the diagnostics menu) and on Escape.
    document.addEventListener('click', event => {
      const menu = getPanel()?.querySelector('[data-session-menu]');
      if (!menu || menu.hidden) {
        return;
      }
      const trigger = getPanel()?.querySelector('[data-session-menu-trigger]');
      if (menu.contains(event.target) || trigger?.contains(event.target)) {
        return;
      }
      closeSessionMenu();
    }, true);
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        closeSessionMenu();
      }
    }, true);
  }

  // Header session dropdown: lists every saved session where the user works,
  // switches on click, and offers New session — the embedded list below stays
  // as the always-visible overview.
  function toggleSessionMenu() {
    const menu = getPanel()?.querySelector('[data-session-menu]');
    if (!menu) {
      return;
    }
    if (menu.hidden) {
      renderSessionMenu(menu);
    }
    menu.hidden = !menu.hidden;
    getPanel()?.querySelector('[data-session-menu-trigger]')
      ?.setAttribute('aria-expanded', menu.hidden ? 'false' : 'true');
  }

  function closeSessionMenu() {
    const menu = getPanel()?.querySelector('[data-session-menu]');
    if (!menu || menu.hidden) {
      return;
    }
    menu.hidden = true;
    getPanel()?.querySelector('[data-session-menu-trigger]')?.setAttribute('aria-expanded', 'false');
  }

  function renderSessionMenu(menu) {
    menu.replaceChildren();
    const state = getState();
    const sessions = (state?.sessions || [])
      .filter(isDisplayableSession)
      .slice()
      .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
    for (const session of sessions) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'codex-session-menu-item';
      row.dataset.active = session.id === state?.activeSessionId ? 'true' : 'false';
      row.dataset.running = isSessionRunning(session) ? 'true' : 'false';
      const title = document.createElement('span');
      title.className = 'codex-session-menu-item-title';
      title.textContent = getSessionDisplayTitle(session);
      title.title = getSessionDisplayTitle(session);
      const time = document.createElement('time');
      time.className = 'codex-session-menu-item-time';
      time.textContent = formatSessionTime(session.updatedAt || session.createdAt);
      const absoluteTs = session.updatedAt || session.createdAt;
      if (absoluteTs) {
        time.title = new Date(absoluteTs).toLocaleString();
      }
      row.append(title, time);
      row.addEventListener('click', event => {
        event.stopPropagation();
        closeSessionMenu();
        if (session.id !== getState()?.activeSessionId) {
          switchSession(session.id);
        }
      });
      menu.append(row);
    }
    const create = document.createElement('button');
    create.type = 'button';
    create.className = 'codex-session-menu-new';
    create.textContent = `+ ${tr('newSession')}`;
    create.addEventListener('click', event => {
      event.stopPropagation();
      closeSessionMenu();
      startNewSession();
    });
    menu.append(create);
  }

  // Inline-rename the active session from the header bar (mirrors the per-row
  // rename: Enter / blur commits, Escape cancels).
  function beginActiveSessionRename() {
    const active = getActiveSession(getState());
    const wrap = getPanel().querySelector('[data-session-label]');
    const trigger = getPanel().querySelector('[data-session-menu-trigger]');
    const textNode = getPanel().querySelector('[data-session-label-text]');
    const input = getPanel().querySelector('[data-session-rename-input]');
    if (!active || !wrap || !textNode || !input) {
      return;
    }
    closeSessionMenu();
    let settled = false;
    wrap.dataset.editing = 'true';
    // Seed the box from a real title only; an empty/auto session opens blank so
    // accepting the default does not commit the placeholder as a manual title.
    const seed = isDisplayableSession(active) ? getSessionDisplayTitle(active) : '';
    input.value = seed;
    input.hidden = false;
    textNode.hidden = true;
    if (trigger) {
      trigger.hidden = true;
    }
    input.focus();
    input.select();
    const cleanup = () => {
      input.removeEventListener('keydown', onKeydown);
      input.removeEventListener('blur', onBlur);
    };
    const finish = commit => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      input.hidden = true;
      textNode.hidden = false;
      if (trigger) {
        trigger.hidden = false;
      }
      delete wrap.dataset.editing;
      // Treat an unchanged value (incl. a no-op blur) as a cancel so it never
      // rewrites the title source.
      if (commit && input.value.trim() !== seed.trim()) {
        commitSessionRename(active.id, input.value);
      }
    };
    const onKeydown = event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    };
    const onBlur = () => finish(true);
    input.addEventListener('keydown', onKeydown);
    input.addEventListener('blur', onBlur);
  }

  async function startNewSession() {
    // Leaving a still-running session is allowed but never silent: the run
    // keeps going in the background and lands in its own session.
    const runningActive = getActiveSession(getState());
    if (runningActive && isSessionRunning(runningActive)) {
      const approved = await showPluginConfirm({
        title: tr('sessionSwitchRunningTitle'),
        message: tr('sessionSwitchRunningMessage'),
        confirmLabel: tr('sessionSwitchRunningConfirm')
      });
      if (!approved) {
        return;
      }
    }
    readPanelInputs();
    // Reuse an already-empty, idle active session instead of minting a ghost.
    // Empty sessions are invisible in the list yet still consume the storage cap
    // (slice(-20) / maxSessions), so spamming "New Session" could silently evict
    // real history. Only mint when the current session holds real work.
    const active = getActiveSession(getState());
    if (active && !isDisplayableSession(active) && !isSessionRunning(active)) {
      getPanel().querySelector('[data-task]')?.focus();
      return;
    }
    // The 21st session silently and PERMANENTLY evicts the oldest one
    // (slice(-20) + the storage retention diff physically deletes its
    // record). Never let that happen without consent.
    const currentSessions = getState().sessions || [];
    if (currentSessions.length >= 20) {
      const oldest = currentSessions[0];
      const evictionApproved = await showPluginConfirm({
        title: tr('sessionEvictTitle'),
        message: tr('sessionEvictMessage', { title: String(oldest?.title || '').slice(0, 40) || '…' }),
        confirmLabel: tr('sessionEvictConfirm'),
        destructive: true
      });
      if (!evictionApproved) {
        return;
      }
    }
    const session = createSession({
      mode: getState().mode,
      model: getState().model,
      reasoningEffort: getState().reasoningEffort,
      speedTier: getState().speedTier,
      requireReviewing: getState().requireReviewing
    });
    setState(normalizePanelState({
      ...getState(),
      sessions: [...(getState().sessions || []), session].slice(-20),
      activeSessionId: session.id
    }));
    await saveState();
    applyStateToPanel();
    getPanel().querySelector('[data-task]')?.focus();
  }

  async function switchSession(sessionId) {
    if (sessionId === getState().activeSessionId) {
      return;
    }
    const runningActive = getActiveSession(getState());
    if (runningActive && isSessionRunning(runningActive)) {
      const approved = await showPluginConfirm({
        title: tr('sessionSwitchRunningTitle'),
        message: tr('sessionSwitchRunningMessage'),
        confirmLabel: tr('sessionSwitchRunningConfirm')
      });
      if (!approved) {
        return;
      }
    }
    readPanelInputs();
    setState(setActiveSession(getState(), sessionId));
    await saveState();
    applyStateToPanel();
  }

  async function deleteSessionWithConfirm(sessionId) {
    const target = (getState().sessions || []).find(session => session.id === sessionId);
    if (!target) {
      return;
    }
    if (isSessionRunning(target)) {
      showPluginToast(tr('deleteSessionRunningToast'), { status: 'warning' });
      return;
    }

    const remaining = (getState().sessions || []).filter(session => session.id !== sessionId);

    // An empty (non-displayable) session has no task/runs/history and no native
    // thread, so deleting it is a lossless local action — skip the destructive
    // modal. Deleting the sole empty session would just mint another empty, so
    // it is a no-op.
    if (!isDisplayableSession(target)) {
      if (!remaining.length) {
        return;
      }
      setState(deleteSession(getState(), sessionId));
      await saveState();
      applyStateToPanel();
      showPluginToast(tr('deleteSessionDeletedToast'), { status: 'info' });
      return;
    }

    // Deleting the only session is really a reset (deleteSession mints a fresh
    // empty replacement), so use honest copy for that case.
    const lastSession = remaining.length === 0;
    const approved = await showPluginConfirm({
      title: lastSession ? tr('resetSessionTitle') : tr('deleteSessionTitle'),
      message: lastSession
        ? tr('resetSessionMessage')
        : [
          getSessionDisplayTitle(target),
          '',
          tr('deleteSessionMessage')
        ].join('\n'),
      confirmLabel: lastSession ? tr('resetSessionConfirm') : tr('deleteSessionConfirm'),
      cancelLabel: tr('confirmDefaultCancel'),
      destructive: true
    });
    if (!approved) {
      return;
    }

    setState(deleteSession(getState(), sessionId));
    await saveState();
    applyStateToPanel();

    try {
      const response = await sendBackgroundNative({
        method: 'codex.history.clearPlugin',
        params: {
          sessionId,
          threadId: target.codexThreadId || ''
        }
      });
      if (!response?.ok) {
        showPluginToast(tr('deleteSessionHistoryFailedToast', { message: response?.error?.message || 'native host did not return success' }), { status: 'warning', sticky: true });
      } else if (response.result?.skipped) {
        showPluginToast(tr('deleteSessionNoThreadToast'), { status: 'info' });
      } else {
        showPluginToast(tr('deleteSessionDoneToast'), { status: 'completed' });
      }
    } catch (error) {
      showPluginToast(tr('deleteSessionHistoryFailedToast', { message: error.message }), { status: 'warning', sticky: true });
    }
  }
  function renderSessionList(options = {}) {
    // Omit showAll unless a caller explicitly sets it, so the getPanel() keeps its own
    // expanded/collapsed getState() across re-renders (see sessionPanel.update).
    const updateOptions = { pinnedSessionIds: getRunningSessionIds() };
    if (options.showAll !== undefined) {
      updateOptions.showAll = options.showAll;
    }
    SessionPanel.update(getSessionPanelInstance(), getState()?.sessions || [], getState()?.activeSessionId || null, updateOptions);
  }

  function getSessionDisplayTitle(session) {
    return SessionPanel.getDisplayTitle(getSessionPanelInstance(), session);
  }



  async function commitSessionRename(sessionId, title) {
    const session = findSessionById(sessionId);
    if (!session) {
      return;
    }
    const cleanTitle = String(title || '').replace(/\s+/g, ' ').trim();
    const derived = deriveSessionTitle(session.runs, session.task);
    // Only a value that is genuinely a custom title becomes a pinned manual
    // title. An empty value, the localized New Session placeholder, or the
    // auto-derived title itself all stay 'auto' — otherwise renaming an empty
    // session would promote the placeholder into a real title (resurrecting the
    // ghost the prune/reuse-guard eliminate) and a no-op blur would freeze an
    // auto title.
    const isCustom = Boolean(cleanTitle) && cleanTitle !== tr('newSessionFallback') && cleanTitle !== derived;
    replaceSessionInState({
      ...session,
      title: isCustom ? cleanTitle : derived,
      titleSource: isCustom ? 'manual' : 'auto',
      updatedAt: new Date().toISOString()
    });
    await saveState();
    applySessionLabel();
    renderSessionList();
  }
  function getRunningSessionIds() {
    return (getState().sessions || [])
      .filter(isSessionRunning)
      .map(session => session.id);
  }

  function isSessionRunning(session) {
    return Boolean((session?.runs || []).some(run => run.status === 'running'));
  }
  function findSessionById(sessionId) {
    if (!sessionId) {
      return null;
    }
    return (getState().sessions || []).find(session => session.id === sessionId)
      || (getState().session?.id === sessionId ? getState().session : null);
  }

  function replaceSessionInState(session) {
    if (!session?.id) {
      return;
    }
    setState(normalizePanelState({
      ...getState(),
      sessions: (getState().sessions || []).map(item => item.id === session.id ? session : item)
    }));
  }

  function updateSessionById(sessionId, patch = {}) {
    const session = findSessionById(sessionId);
    if (!session) {
      return;
    }
    replaceSessionInState({
      ...session,
      ...patch
    });
  }

    return {
      closeSessionMenu,
      applySessionLabel,
      bindActiveSessionHeader,
      startNewSession,
      switchSession,
      deleteSessionWithConfirm,
      renderSessionList,
      commitSessionRename,
      getRunningSessionIds,
      isSessionRunning,
      findSessionById,
      replaceSessionInState,
      updateSessionById
    };
  }

  window.CodexOverleafSessionManager = { create };
})();
