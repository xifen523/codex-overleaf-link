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
    locale: 'en',
    requireReviewing: true,
    autoOpen: true,
    panelWidth: 380,
    task: '',
    focusFiles: [],
    session: null,
    runs: [],
    sessions: [],
    activeSessionId: ''
  };

  const VALID_MODES = new Set(['ask', 'confirm', 'auto']);
  const VALID_REASONING = new Set(['low', 'medium', 'high', 'xhigh']);
  const VALID_LOCALES = new Set(['en', 'zh']);
  const VALID_TITLE_SOURCES = new Set(['auto', 'manual']);
  const LEGACY_DEFAULT_SESSION_TITLE = 'New task';
  const SESSION_AUTO_TITLE_CHARS = 24;
  const MAX_RUN_EVENTS = 300;
  const STORAGE_DEFAULT_LIMITS = {
    maxSessions: 12,
    maxRunsPerSession: 10,
    maxEventsPerRun: 120,
    maxUndoRunsPerSession: 2,
    maxUndoBytesPerRun: 320 * 1024,
    targetBytes: 4 * 1024 * 1024,
    titleChars: 6000,
    detailChars: 3000,
    reportDetailChars: 64000,
    historyChars: 1800,
    taskChars: 12000,
    sessionTitleChars: 80,
    statusTextChars: 800
  };
  const STORAGE_AGGRESSIVE_LIMITS = {
    maxSessions: 4,
    maxRunsPerSession: 3,
    maxEventsPerRun: 20,
    maxUndoRunsPerSession: 1,
    maxUndoBytesPerRun: 160 * 1024,
    targetBytes: 768 * 1024,
    titleChars: 1000,
    detailChars: 300,
    reportDetailChars: 16000,
    historyChars: 400,
    taskChars: 2000,
    sessionTitleChars: 80,
    statusTextChars: 400
  };

  function normalizePanelState(input = {}, options = {}) {
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
    if (!VALID_LOCALES.has(state.locale)) {
      state.locale = DEFAULT_PANEL_STATE.locale;
    }
    state.requireReviewing = state.requireReviewing !== false;
    state.autoOpen = state.autoOpen !== false;
    state.panelWidth = normalizePanelWidth(state.panelWidth);
    state.task = typeof state.task === 'string' ? state.task : '';
    state.model = typeof state.model === 'string' && state.model ? state.model : DEFAULT_PANEL_STATE.model;
    state.runs = normalizeRuns(state.runs, options);
    state.sessions = normalizeSessions(state, input, options);
    state.activeSessionId = resolveActiveSessionId(state.sessions, input.activeSessionId);

    return mirrorActiveSession(state);
  }

  function normalizeSessions(state, input, options = {}) {
    const explicitSessions = Array.isArray(input.sessions) ? input.sessions : [];
    const sessions = explicitSessions
      .filter(session => session && typeof session.id === 'string')
      .map(session => normalizeSession(session, state, options));

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
      titleSource: legacySession.titleSource,
      updatedAt: legacySession.updatedAt
    }, state, options)];
  }

  function normalizeSession(session, fallbackState = DEFAULT_PANEL_STATE, options = {}) {
    const history = Array.isArray(session.history) ? session.history.slice(-10) : [];
    const normalizedRuns = normalizeRuns(session.runs, options);
    const runs = normalizedRuns.length ? normalizedRuns : recoverRunsFromHistory(session, history);
    const rawTitle = typeof session.title === 'string' ? session.title.trim() : '';
    const derivedTitle = deriveSessionTitle(runs, session.task);
    const titleSource = normalizeTitleSource(session.titleSource, rawTitle, derivedTitle);
    const title = normalizeSessionTitle(rawTitle, derivedTitle, titleSource);

    return {
      id: session.id,
      title,
      titleSource,
      createdAt: typeof session.createdAt === 'string' ? session.createdAt : new Date().toISOString(),
      updatedAt: typeof session.updatedAt === 'string' ? session.updatedAt : new Date().toISOString(),
      history,
      runs,
      task: typeof session.task === 'string' ? session.task : '',
      mode: VALID_MODES.has(session.mode) ? session.mode : fallbackState.mode,
      model: typeof session.model === 'string' && session.model ? session.model : fallbackState.model,
      reasoningEffort: VALID_REASONING.has(session.reasoningEffort)
        ? session.reasoningEffort
        : fallbackState.reasoningEffort,
      requireReviewing: session.requireReviewing !== false,
      focusFiles: normalizeFocusFiles(session.focusFiles),
      codexThreadId: typeof session.codexThreadId === 'string' ? session.codexThreadId : ''
    };
  }

  function recoverRunsFromHistory(session, history) {
    if (!Array.isArray(history) || !history.length) {
      return [];
    }
    return normalizeRuns(history.map((entry, index) => {
      const task = typeof entry?.task === 'string' && entry.task.trim()
        ? entry.task.trim()
        : (typeof session.task === 'string' && session.task.trim() ? session.task.trim() : 'untitled task');
      const timestamp = typeof entry?.at === 'string' ? entry.at : session.updatedAt;
      const result = typeof entry?.result === 'string' && entry.result.trim()
        ? entry.result.trim()
        : '这轮任务有历史记录，但没有保存详细结果。';
      return {
        id: `recovered_${session.id}_${index}`,
        task,
        mode: session.mode,
        model: session.model,
        reasoningEffort: session.reasoningEffort,
        status: 'completed',
        statusText: '已处理',
        startedAt: timestamp,
        finishedAt: timestamp,
        events: [{
          title: '本轮完成报告',
          status: 'completed',
          kind: 'report',
          timestamp,
          detail: {
            '结论': result
          }
        }]
      };
    }));
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
      focusFiles: normalizeFocusFiles(active.focusFiles),
      codexThreadId: active.codexThreadId || ''
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
    const runs = Array.isArray(overrides.runs) ? normalizeRuns(overrides.runs) : [];
    const rawTitle = typeof overrides.title === 'string' ? overrides.title.trim() : '';
    const derivedTitle = deriveSessionTitle(runs, overrides.task || rawTitle);
    const titleSource = VALID_TITLE_SOURCES.has(overrides.titleSource)
      ? overrides.titleSource
      : (rawTitle && rawTitle !== LEGACY_DEFAULT_SESSION_TITLE ? 'manual' : 'auto');
    return {
      id: `session_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      title: normalizeSessionTitle(rawTitle, derivedTitle, titleSource),
      titleSource,
      createdAt: overrides.createdAt || new Date().toISOString(),
      updatedAt: overrides.updatedAt || new Date().toISOString(),
      history: Array.isArray(overrides.history) ? overrides.history.slice(-10) : [],
      runs,
      task: typeof overrides.task === 'string' ? overrides.task : '',
      mode: VALID_MODES.has(overrides.mode) ? overrides.mode : DEFAULT_PANEL_STATE.mode,
      model: typeof overrides.model === 'string' && overrides.model ? overrides.model : DEFAULT_PANEL_STATE.model,
      reasoningEffort: VALID_REASONING.has(overrides.reasoningEffort)
        ? overrides.reasoningEffort
        : DEFAULT_PANEL_STATE.reasoningEffort,
      requireReviewing: overrides.requireReviewing !== false,
      focusFiles: normalizeFocusFiles(overrides.focusFiles),
      codexThreadId: typeof overrides.codexThreadId === 'string' ? overrides.codexThreadId : ''
    };
  }

  function recordSessionResult(session, entry) {
    const base = session?.id ? session : createSession();
    return {
      ...base,
      id: base.id,
      titleSource: VALID_TITLE_SOURCES.has(base.titleSource) ? base.titleSource : 'auto',
      history: [
        ...(Array.isArray(base.history) ? base.history : []),
        {
          task: entry.task || 'untitled task',
          result: entry.result || entry.status || 'completed',
          at: entry.at || new Date().toISOString()
        }
      ].slice(-10),
      updatedAt: entry.at || new Date().toISOString()
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
      const next = {
        ...session,
        ...patch,
        updatedAt: patch.updatedAt || new Date().toISOString()
      };
      if (
        session.titleSource === 'manual' &&
        patch.titleSource !== 'manual' &&
        Object.prototype.hasOwnProperty.call(patch, 'title')
      ) {
        next.title = session.title;
        next.titleSource = 'manual';
      }
      return normalizeSession({
        ...next
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
    const taskTitle = sanitizeAutoTitle(task);
    if (taskTitle) {
      return taskTitle;
    }
    const firstRunTask = Array.isArray(runs) && runs.length ? runs[0]?.task : '';
    return sanitizeAutoTitle(firstRunTask);
  }

  function normalizeTitleSource(value, rawTitle, derivedTitle) {
    if (VALID_TITLE_SOURCES.has(value)) {
      return value;
    }
    if (rawTitle && rawTitle !== LEGACY_DEFAULT_SESSION_TITLE && rawTitle !== derivedTitle) {
      return 'manual';
    }
    return 'auto';
  }

  function normalizeSessionTitle(rawTitle, derivedTitle, titleSource) {
    if (titleSource === 'manual') {
      return normalizeTextField(rawTitle === LEGACY_DEFAULT_SESSION_TITLE ? '' : rawTitle, STORAGE_DEFAULT_LIMITS.sessionTitleChars);
    }
    return sanitizeAutoTitle(rawTitle === LEGACY_DEFAULT_SESSION_TITLE ? '' : rawTitle) || derivedTitle || '';
  }

  function sanitizeAutoTitle(value) {
    const title = String(value || '')
      .replace(/@file:[^\s]+/g, ' ')
      .replace(/@(context|compile-log)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!title) {
      return '';
    }
    return title.length > SESSION_AUTO_TITLE_CHARS
      ? `${title.slice(0, SESSION_AUTO_TITLE_CHARS - 1)}…`
      : title;
  }

  function isDisplayableSession(session) {
    if (!session?.id) {
      return false;
    }
    const hasTask = typeof session.task === 'string' && session.task.trim().length > 0;
    const hasRuns = Array.isArray(session.runs) && session.runs.length > 0;
    const hasHistory = Array.isArray(session.history) && session.history.length > 0;
    const title = typeof session.title === 'string' ? session.title.trim() : '';
    const hasRealTitle = title.length > 0 && title !== LEGACY_DEFAULT_SESSION_TITLE;
    return hasTask || hasRuns || hasHistory || hasRealTitle;
  }

  function selectVisibleSessionsForList(sessions, activeSessionId, options = {}) {
    const maxVisible = Number.isFinite(options.maxVisible) && options.maxVisible > 0
      ? Math.floor(options.maxVisible)
      : 3;
    const displayable = (Array.isArray(sessions) ? sessions : []).filter(isDisplayableSession);
    if (options.showAll || displayable.length <= maxVisible) {
      return displayable.slice().reverse();
    }

    const pinnedSessionIds = Array.isArray(options.pinnedSessionIds)
      ? options.pinnedSessionIds.filter(Boolean)
      : [];
    const recent = displayable.slice(-maxVisible).reverse();
    if (pinnedSessionIds.length) {
      const selected = [];
      const pushSession = session => {
        if (session && !selected.some(item => item.id === session.id)) {
          selected.push(session);
        }
      };
      pushSession(displayable.find(session => session.id === activeSessionId));
      for (const pinnedId of pinnedSessionIds) {
        pushSession(displayable.find(session => session.id === pinnedId));
      }
      for (const session of recent) {
        pushSession(session);
      }
      return selected.slice(0, maxVisible);
    }

    if (!activeSessionId || recent.some(session => session.id === activeSessionId)) {
      return recent;
    }

    const active = displayable.find(session => session.id === activeSessionId);
    if (!active) {
      return recent;
    }
    return [active, ...recent.filter(session => session.id !== activeSessionId).slice(0, maxVisible - 1)];
  }

  function normalizeRuns(runs, options = {}) {
    return (Array.isArray(runs) ? runs : [])
      .filter(run => run && typeof run.id === 'string')
      .map(run => normalizeRun(run, options))
      .slice(-20);
  }

  function normalizeRun(run, options = {}) {
    const shouldStopRestoredRun = options.restoreRunningRuns === true && run.status === 'running';
    const events = normalizeRunEvents(run.events);
    if (shouldStopRestoredRun) {
      events.push({
        title: '页面刷新后已停止跟踪这轮任务',
        status: 'failed',
        detail: '插件重新加载时发现这轮任务还标记为处理中。为了避免继续显示过期状态，已把它标记为中断；可以重新运行任务。',
        timestamp: new Date().toISOString()
      });
    }

    return {
      id: run.id,
      task: typeof run.task === 'string' && run.task ? run.task : 'untitled task',
      mode: typeof run.mode === 'string' ? run.mode : '',
      model: typeof run.model === 'string' ? run.model : '',
      reasoningEffort: typeof run.reasoningEffort === 'string' ? run.reasoningEffort : '',
      status: shouldStopRestoredRun ? 'failed' : normalizeRunStatus(run.status),
      statusText: shouldStopRestoredRun ? '页面刷新后已停止跟踪' : typeof run.statusText === 'string' ? run.statusText : '',
      startedAt: typeof run.startedAt === 'string' ? run.startedAt : '',
      finishedAt: shouldStopRestoredRun ? new Date().toISOString() : typeof run.finishedAt === 'string' ? run.finishedAt : '',
      events: events.slice(-MAX_RUN_EVENTS),
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
        timestamp: typeof event.timestamp === 'string' ? event.timestamp : '',
        kind: typeof event.kind === 'string' ? event.kind : 'activity',
        technicalDetail: event.technicalDetail,
        streamKey: typeof event.streamKey === 'string' ? event.streamKey : '',
        streamRole: typeof event.streamRole === 'string' ? event.streamRole : ''
      }))
      .slice(-MAX_RUN_EVENTS);
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

  function prepareStateForStorage(input = {}, options = {}) {
    const limits = options.aggressive ? STORAGE_AGGRESSIVE_LIMITS : STORAGE_DEFAULT_LIMITS;
    const compact = compactPanelStateForStorage(input, limits);
    if (!options.aggressive && estimateJsonBytes(compact) > limits.targetBytes) {
      return prepareStateForStorage(input, { aggressive: true });
    }
    return compact;
  }

  function compactPanelStateForStorage(input, limits) {
    const source = {
      ...DEFAULT_PANEL_STATE,
      ...(input && typeof input === 'object' ? input : {})
    };
    const sourceSessions = getSourceSessions(source);
    const activeSessionId = typeof source.activeSessionId === 'string'
      ? source.activeSessionId
      : source.session?.id;
    const selectedSessions = selectSessionsForStorage(sourceSessions, activeSessionId, limits.maxSessions);
    const compactSessions = selectedSessions.map(session => compactSessionForStorage(session, source, limits));
    const resolvedActiveId = compactSessions.some(session => session.id === activeSessionId)
      ? activeSessionId
      : compactSessions[compactSessions.length - 1]?.id || '';
    const active = compactSessions.find(session => session.id === resolvedActiveId) || compactSessions[0] || null;

    return {
      mode: VALID_MODES.has(active?.mode) ? active.mode : normalizeMode(source.mode),
      model: normalizeTextField(active?.model || source.model || DEFAULT_PANEL_STATE.model, 80),
      reasoningEffort: VALID_REASONING.has(active?.reasoningEffort)
        ? active.reasoningEffort
        : normalizeReasoning(source.reasoningEffort),
      locale: normalizeLocale(source.locale),
      requireReviewing: active ? active.requireReviewing !== false : source.requireReviewing !== false,
      autoOpen: source.autoOpen !== false,
      panelWidth: normalizePanelWidth(source.panelWidth),
      task: normalizeTextField(active?.task || source.task || '', limits.taskChars),
      focusFiles: normalizeFocusFiles(active?.focusFiles || source.focusFiles),
      session: active ? {
        id: active.id,
        history: compactHistory(active.history, limits),
        focusFiles: normalizeFocusFiles(active.focusFiles)
      } : null,
      runs: [],
      sessions: compactSessions,
      activeSessionId: active?.id || ''
    };
  }

  function getSourceSessions(source) {
    if (Array.isArray(source.sessions) && source.sessions.some(session => session?.id)) {
      return source.sessions;
    }
    const legacySession = source.session?.id ? source.session : createSession({
      mode: source.mode,
      model: source.model,
      reasoningEffort: source.reasoningEffort,
      requireReviewing: source.requireReviewing
    });
    return [{
      ...legacySession,
      task: source.task,
      mode: source.mode,
      model: source.model,
      reasoningEffort: source.reasoningEffort,
      requireReviewing: source.requireReviewing,
      focusFiles: normalizeFocusFiles(source.focusFiles || legacySession.focusFiles),
      runs: Array.isArray(source.runs) ? source.runs : legacySession.runs,
      title: legacySession.title || deriveSessionTitle(source.runs, source.task),
      titleSource: legacySession.titleSource,
      updatedAt: legacySession.updatedAt
    }];
  }

  function selectSessionsForStorage(sessions, activeSessionId, maxSessions) {
    const filtered = (Array.isArray(sessions) ? sessions : [])
      .filter(session => session && typeof session.id === 'string');
    if (filtered.length <= maxSessions) {
      return filtered;
    }

    const active = filtered.find(session => session.id === activeSessionId);
    const recent = filtered.slice(-maxSessions);
    if (!active || recent.some(session => session.id === active.id)) {
      return recent;
    }
    return [
      active,
      ...recent.filter(session => session.id !== active.id).slice(-(maxSessions - 1))
    ];
  }

  function compactSessionForStorage(session, fallbackState, limits) {
    const runs = compactRunsForStorage(session.runs, limits);
    const title = typeof session.title === 'string' && session.title.trim()
      ? session.title.trim()
      : deriveSessionTitle(runs, session.task);
    return {
      id: session.id,
      title: normalizeTextField(title, limits.sessionTitleChars),
      titleSource: VALID_TITLE_SOURCES.has(session.titleSource) ? session.titleSource : 'auto',
      createdAt: typeof session.createdAt === 'string' ? session.createdAt : new Date().toISOString(),
      updatedAt: typeof session.updatedAt === 'string' ? session.updatedAt : new Date().toISOString(),
      history: compactHistory(session.history, limits),
      runs,
      task: normalizeTextField(session.task, limits.taskChars),
      mode: normalizeMode(session.mode || fallbackState.mode),
      model: normalizeTextField(session.model || fallbackState.model || DEFAULT_PANEL_STATE.model, 80),
      reasoningEffort: normalizeReasoning(session.reasoningEffort || fallbackState.reasoningEffort),
      requireReviewing: session.requireReviewing !== false,
      focusFiles: normalizeFocusFiles(session.focusFiles)
    };
  }

  function compactHistory(history, limits) {
    return (Array.isArray(history) ? history : [])
      .slice(-10)
      .map(entry => ({
        task: normalizeTextField(entry?.task, 300),
        result: normalizeTextField(entry?.result, limits.historyChars),
        at: typeof entry?.at === 'string' ? entry.at : ''
      }));
  }

  function compactRunsForStorage(runs, limits) {
    const selectedRuns = (Array.isArray(runs) ? runs : [])
      .filter(run => run && typeof run.id === 'string')
      .slice(-limits.maxRunsPerSession);
    const undoRunIds = new Set(selectedRuns
      .slice()
      .reverse()
      .filter(run => Array.isArray(run.undoOperations) && run.undoOperations.length)
      .slice(0, limits.maxUndoRunsPerSession)
      .map(run => run.id));
    return selectedRuns.map(run => compactRunForStorage(run, limits, undoRunIds.has(run.id)));
  }

  function compactRunForStorage(run, limits, keepUndoPayload) {
    const undoPayload = compactUndoPayload(run, limits, keepUndoPayload);
    return {
      id: run.id,
      task: normalizeTextField(run.task || 'untitled task', limits.taskChars),
      mode: typeof run.mode === 'string' ? run.mode : '',
      model: normalizeTextField(run.model, 80),
      reasoningEffort: typeof run.reasoningEffort === 'string' ? run.reasoningEffort : '',
      status: normalizeRunStatus(run.status),
      statusText: normalizeTextField(run.statusText, limits.statusTextChars),
      startedAt: typeof run.startedAt === 'string' ? run.startedAt : '',
      finishedAt: typeof run.finishedAt === 'string' ? run.finishedAt : '',
      events: compactRunEvents(run.events, limits),
      appliedOperations: [],
      undoOperations: undoPayload.undoOperations,
      undoBaseFiles: undoPayload.undoBaseFiles,
      undoStatus: typeof run.undoStatus === 'string' ? run.undoStatus : ''
    };
  }

  function compactRunEvents(events, limits) {
    return (Array.isArray(events) ? events : [])
      .filter(event => event && typeof event.title === 'string')
      .slice(-limits.maxEventsPerRun)
      .map(event => {
        const compact = {
          title: normalizeTextField(event.title, limits.titleChars),
          status: typeof event.status === 'string' ? event.status : 'info',
          timestamp: typeof event.timestamp === 'string' ? event.timestamp : '',
          kind: typeof event.kind === 'string' ? event.kind : 'activity',
          streamKey: typeof event.streamKey === 'string' ? event.streamKey : '',
          streamRole: typeof event.streamRole === 'string' ? event.streamRole : ''
        };
        const detail = compactDetailForStorage(event.detail, getEventDetailLimit(event, limits));
        if (detail !== undefined) {
          compact.detail = detail;
        }
        return compact;
      });
  }

  function getEventDetailLimit(event, limits) {
    return event.kind === 'report'
      ? (limits.reportDetailChars || limits.detailChars)
      : limits.detailChars;
  }

  function compactDetailForStorage(detail, maxChars) {
    if (detail === undefined) {
      return undefined;
    }
    if (typeof detail === 'string') {
      return normalizeTextField(detail, maxChars);
    }
    if (detail === null || typeof detail === 'number' || typeof detail === 'boolean') {
      return detail;
    }
    try {
      return normalizeTextField(JSON.stringify(detail), maxChars);
    } catch (_error) {
      return '[detail omitted]';
    }
  }

  function compactUndoPayload(run, limits, keepUndoPayload) {
    if (!keepUndoPayload) {
      return {
        undoOperations: [],
        undoBaseFiles: []
      };
    }

    const undoOperations = safeJsonClone(Array.isArray(run.undoOperations) ? run.undoOperations : []);
    const undoBaseFiles = normalizeRunFiles(run.undoBaseFiles);
    const payload = {
      undoOperations,
      undoBaseFiles
    };
    if (!undoOperations.length || estimateJsonBytes(payload) > limits.maxUndoBytesPerRun) {
      return {
        undoOperations: [],
        undoBaseFiles: []
      };
    }
    return payload;
  }

  function normalizeMode(mode) {
    return VALID_MODES.has(mode) ? mode : DEFAULT_PANEL_STATE.mode;
  }

  function normalizeReasoning(reasoningEffort) {
    return VALID_REASONING.has(reasoningEffort)
      ? reasoningEffort
      : DEFAULT_PANEL_STATE.reasoningEffort;
  }

  function normalizeLocale(locale) {
    return VALID_LOCALES.has(locale) ? locale : DEFAULT_PANEL_STATE.locale;
  }

  function normalizePanelWidth(value) {
    const width = Number(value);
    if (!Number.isFinite(width) || width <= 0) {
      return DEFAULT_PANEL_STATE.panelWidth;
    }
    return Math.round(Math.min(760, Math.max(340, width)));
  }

  function normalizeTextField(value, maxChars) {
    const text = typeof value === 'string' ? value : '';
    if (!Number.isFinite(maxChars) || maxChars <= 0 || text.length <= maxChars) {
      return text;
    }
    return `${text.slice(0, Math.max(0, maxChars - 1))}…`;
  }

  function safeJsonClone(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_error) {
      return [];
    }
  }

  function estimateJsonBytes(value) {
    let serialized = '';
    try {
      serialized = JSON.stringify(value);
    } catch (_error) {
      return Infinity;
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.byteLength(serialized, 'utf8');
    }
    return new Blob([serialized]).size;
  }

  return {
    DEFAULT_PANEL_STATE,
    createSession,
    deleteSession,
    getActiveSession,
    isDisplayableSession,
      normalizePanelState,
      deriveSessionTitle,
      recordSessionResult,
    selectVisibleSessionsForList,
    setActiveSession,
    updateActiveSession,
    normalizeRuns,
    prepareStateForStorage,
    estimateJsonBytes
  };
});
