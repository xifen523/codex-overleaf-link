(function initSessionState(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafSessionState = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function sessionStateFactory() {
  'use strict';

  const DEFAULT_PANEL_STATE = {
    mode: 'confirm',
    model: 'gpt-5.4',
    reasoningEffort: 'high',
    requireReviewing: true,
    autoOpen: true,
    task: '',
    focusFiles: [],
    session: null,
    runs: [],
    sessions: [],
    activeSessionId: ''
  };

  const VALID_MODES = new Set(['ask', 'confirm', 'auto']);
  const VALID_REASONING = new Set(['low', 'medium', 'high', 'xhigh']);

  function normalizePanelState(input = {}) {
    const state = {
      ...DEFAULT_PANEL_STATE,
      ...input
    };

    if (!VALID_MODES.has(state.mode)) {
      state.mode = DEFAULT_PANEL_STATE.mode;
    }
    if (!VALID_REASONING.has(state.reasoningEffort)) {
      state.reasoningEffort = DEFAULT_PANEL_STATE.reasoningEffort;
    }
    state.requireReviewing = state.requireReviewing !== false;
    state.autoOpen = state.autoOpen !== false;
    state.task = typeof state.task === 'string' ? state.task : '';
    state.model = typeof state.model === 'string' && state.model ? state.model : DEFAULT_PANEL_STATE.model;
    state.runs = normalizeRuns(state.runs);
    state.sessions = normalizeSessions(state, input);
    state.activeSessionId = resolveActiveSessionId(state.sessions, input.activeSessionId);

    return mirrorActiveSession(state);
  }

  function normalizeSessions(state, input) {
    const explicitSessions = Array.isArray(input.sessions) ? input.sessions : [];
    const sessions = explicitSessions
      .filter(session => session && typeof session.id === 'string')
      .map(session => normalizeSession(session, state));

    if (sessions.length) {
      return sessions.slice(-20);
    }

    const legacySession = input.session?.id ? input.session : createSession();
    return [normalizeSession({
      ...legacySession,
      task: state.task,
      mode: state.mode,
      model: state.model,
      reasoningEffort: state.reasoningEffort,
      requireReviewing: state.requireReviewing,
      focusFiles: normalizeFocusFiles(state.focusFiles || legacySession.focusFiles),
      runs: state.runs,
      title: legacySession.title || deriveSessionTitle(state.runs, state.task),
      updatedAt: legacySession.updatedAt
    }, state)];
  }

  function normalizeSession(session, fallbackState = DEFAULT_PANEL_STATE) {
    const normalizedRuns = normalizeRuns(session.runs);
    const title = typeof session.title === 'string' && session.title.trim()
      ? session.title.trim()
      : deriveSessionTitle(normalizedRuns, session.task);

    return {
      id: session.id,
      title,
      createdAt: typeof session.createdAt === 'string' ? session.createdAt : new Date().toISOString(),
      updatedAt: typeof session.updatedAt === 'string' ? session.updatedAt : new Date().toISOString(),
      history: Array.isArray(session.history) ? session.history.slice(-10) : [],
      runs: normalizedRuns,
      task: typeof session.task === 'string' ? session.task : '',
      mode: VALID_MODES.has(session.mode) ? session.mode : fallbackState.mode,
      model: typeof session.model === 'string' && session.model ? session.model : fallbackState.model,
      reasoningEffort: VALID_REASONING.has(session.reasoningEffort)
        ? session.reasoningEffort
        : fallbackState.reasoningEffort,
      requireReviewing: session.requireReviewing !== false,
      focusFiles: normalizeFocusFiles(session.focusFiles)
    };
  }

  function resolveActiveSessionId(sessions, activeSessionId) {
    if (typeof activeSessionId === 'string' && sessions.some(session => session.id === activeSessionId)) {
      return activeSessionId;
    }
    return sessions[sessions.length - 1]?.id || createSession().id;
  }

  function mirrorActiveSession(state) {
    const active = getActiveSession(state);
    if (!active) {
      const session = createSession({
        mode: state.mode,
        model: state.model,
        reasoningEffort: state.reasoningEffort,
        requireReviewing: state.requireReviewing
      });
      state.sessions = [session];
      state.activeSessionId = session.id;
      return mirrorActiveSession(state);
    }

    state.session = {
      id: active.id,
      history: Array.isArray(active.history) ? active.history.slice(-10) : [],
      focusFiles: normalizeFocusFiles(active.focusFiles)
    };
    state.runs = Array.isArray(active.runs) ? active.runs : [];
    state.task = typeof active.task === 'string' ? active.task : '';
    state.focusFiles = normalizeFocusFiles(active.focusFiles);
    state.mode = VALID_MODES.has(active.mode) ? active.mode : DEFAULT_PANEL_STATE.mode;
    state.model = typeof active.model === 'string' && active.model ? active.model : DEFAULT_PANEL_STATE.model;
    state.reasoningEffort = VALID_REASONING.has(active.reasoningEffort)
      ? active.reasoningEffort
      : DEFAULT_PANEL_STATE.reasoningEffort;
    state.requireReviewing = active.requireReviewing !== false;

    return state;
  }

  function createSession(overrides = {}) {
    return {
      id: `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      title: overrides.title || 'New task',
      createdAt: overrides.createdAt || new Date().toISOString(),
      updatedAt: overrides.updatedAt || new Date().toISOString(),
      history: Array.isArray(overrides.history) ? overrides.history.slice(-10) : [],
      runs: Array.isArray(overrides.runs) ? normalizeRuns(overrides.runs) : [],
      task: typeof overrides.task === 'string' ? overrides.task : '',
      mode: VALID_MODES.has(overrides.mode) ? overrides.mode : DEFAULT_PANEL_STATE.mode,
      model: typeof overrides.model === 'string' && overrides.model ? overrides.model : DEFAULT_PANEL_STATE.model,
      reasoningEffort: VALID_REASONING.has(overrides.reasoningEffort)
        ? overrides.reasoningEffort
        : DEFAULT_PANEL_STATE.reasoningEffort,
      requireReviewing: overrides.requireReviewing !== false,
      focusFiles: normalizeFocusFiles(overrides.focusFiles)
    };
  }

  function recordSessionResult(session, entry) {
    const base = session?.id ? session : createSession();
    return {
      id: base.id,
      history: [
        ...(Array.isArray(base.history) ? base.history : []),
        {
          task: entry.task || 'untitled task',
          result: entry.result || entry.status || 'completed',
          at: entry.at || new Date().toISOString()
        }
      ].slice(-10)
    };
  }

  function getActiveSession(state) {
    return (state?.sessions || []).find(session => session.id === state.activeSessionId) || null;
  }

  function updateActiveSession(state, patch) {
    const activeSessionId = state.activeSessionId;
    const sessions = (state.sessions || []).map(session => {
      if (session.id !== activeSessionId) {
        return session;
      }
      return normalizeSession({
        ...session,
        ...patch,
        updatedAt: patch.updatedAt || new Date().toISOString()
      }, state);
    });
    return mirrorActiveSession({
      ...state,
      sessions
    });
  }

  function setActiveSession(state, sessionId) {
    if (!(state.sessions || []).some(session => session.id === sessionId)) {
      return mirrorActiveSession(state);
    }
    return mirrorActiveSession({
      ...state,
      activeSessionId: sessionId
    });
  }

  function deleteSession(state, sessionId) {
    const sessions = state.sessions || [];
    if (!sessions.some(session => session.id === sessionId)) {
      return mirrorActiveSession(state);
    }

    const remaining = sessions.filter(session => session.id !== sessionId);
    if (!remaining.length) {
      const replacement = createSession({
        mode: state.mode,
        model: state.model,
        reasoningEffort: state.reasoningEffort,
        requireReviewing: state.requireReviewing
      });
      return mirrorActiveSession({
        ...state,
        sessions: [replacement],
        activeSessionId: replacement.id
      });
    }

    const activeSessionId = state.activeSessionId === sessionId
      ? getMostRecentSession(remaining).id
      : state.activeSessionId;

    return mirrorActiveSession({
      ...state,
      sessions: remaining,
      activeSessionId
    });
  }

  function getMostRecentSession(sessions) {
    return sessions.reduce((latest, session) => {
      const latestTime = Date.parse(latest.updatedAt || latest.createdAt || '');
      const sessionTime = Date.parse(session.updatedAt || session.createdAt || '');
      if (Number.isNaN(latestTime)) {
        return session;
      }
      if (Number.isNaN(sessionTime)) {
        return latest;
      }
      return sessionTime >= latestTime ? session : latest;
    }, sessions[0]);
  }

  function deriveSessionTitle(runs, task) {
    const title = String(task || runs?.[runs.length - 1]?.task || '').trim();
    if (!title) {
      return 'New task';
    }
    return title.length > 42 ? `${title.slice(0, 42)}...` : title;
  }

  function isDisplayableSession(session) {
    if (!session?.id) {
      return false;
    }
    const hasTask = typeof session.task === 'string' && session.task.trim().length > 0;
    const hasRuns = Array.isArray(session.runs) && session.runs.length > 0;
    const hasHistory = Array.isArray(session.history) && session.history.length > 0;
    const title = typeof session.title === 'string' ? session.title.trim() : '';
    const hasRealTitle = title.length > 0 && title !== 'New task';
    return hasTask || hasRuns || hasHistory || hasRealTitle;
  }

  function normalizeRuns(runs) {
    return (Array.isArray(runs) ? runs : [])
      .filter(run => run && typeof run.id === 'string')
      .map(normalizeRun)
      .slice(-20);
  }

  function normalizeRun(run) {
    const wasRunning = run.status === 'running';
    const events = normalizeRunEvents(run.events);
    if (wasRunning) {
      events.push({
        title: 'Run interrupted by page reload',
        status: 'failed',
        detail: 'The Overleaf page was reloaded while this run was active. Start a new run to continue.',
        timestamp: new Date().toISOString()
      });
    }

    return {
      id: run.id,
      task: typeof run.task === 'string' && run.task ? run.task : 'untitled task',
      mode: typeof run.mode === 'string' ? run.mode : '',
      model: typeof run.model === 'string' ? run.model : '',
      reasoningEffort: typeof run.reasoningEffort === 'string' ? run.reasoningEffort : '',
      status: wasRunning ? 'failed' : normalizeRunStatus(run.status),
      statusText: wasRunning ? 'Interrupted by page reload' : typeof run.statusText === 'string' ? run.statusText : '',
      startedAt: typeof run.startedAt === 'string' ? run.startedAt : '',
      finishedAt: wasRunning ? new Date().toISOString() : typeof run.finishedAt === 'string' ? run.finishedAt : '',
      events: events.slice(-80),
      appliedOperations: Array.isArray(run.appliedOperations) ? run.appliedOperations : [],
      undoOperations: Array.isArray(run.undoOperations) ? run.undoOperations : [],
      undoBaseFiles: normalizeRunFiles(run.undoBaseFiles),
      undoStatus: typeof run.undoStatus === 'string' ? run.undoStatus : ''
    };
  }

  function normalizeRunStatus(status) {
    return ['running', 'completed', 'failed'].includes(status) ? status : 'completed';
  }

  function normalizeRunEvents(events) {
    return (Array.isArray(events) ? events : [])
      .filter(event => event && typeof event.title === 'string')
      .map(event => ({
        title: event.title,
        status: typeof event.status === 'string' ? event.status : 'info',
        detail: event.detail,
        timestamp: typeof event.timestamp === 'string' ? event.timestamp : ''
      }))
      .slice(-80);
  }

  function normalizeRunFiles(files) {
    return (Array.isArray(files) ? files : [])
      .filter(file => typeof file?.path === 'string' && typeof file.content === 'string')
      .map(file => ({
        path: file.path,
        content: file.content
      }));
  }

  function normalizeFocusFiles(value) {
    const seen = new Set();
    const files = [];
    for (const item of Array.isArray(value) ? value : []) {
      if (typeof item !== 'string') {
        continue;
      }
      const path = item.trim();
      if (!path || seen.has(path)) {
        continue;
      }
      seen.add(path);
      files.push(path);
    }
    return files.slice(0, 5);
  }

  return {
    DEFAULT_PANEL_STATE,
    createSession,
    deleteSession,
    getActiveSession,
    isDisplayableSession,
    normalizePanelState,
    recordSessionResult,
    setActiveSession,
    updateActiveSession,
    normalizeRuns
  };
});
