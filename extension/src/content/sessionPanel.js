(function initCodexOverleafSessionPanel() {
  'use strict';

  function create(options = {}) {
    const container = options.container;
    if (!container) {
      throw new Error('CodexOverleafSessionPanel requires a container');
    }
    const instance = {
      container,
      callbacks: options.callbacks || {},
      i18n: options.i18n || {},
      deriveSessionTitle: options.deriveSessionTitle,
      isDisplayableSession: options.isDisplayableSession || (() => true),
      selectVisibleSessionsForList: options.selectVisibleSessionsForList,
      isSessionRunning: options.isSessionRunning || (() => false),
      formatSessionTime: options.formatSessionTime || defaultFormatSessionTime,
      maxVisible: options.maxVisible || 3,
      pinnedSessionIds: options.pinnedSessionIds || [],
      sessions: options.sessions || [],
      activeSessionId: options.activeSessionId || null,
      showAll: false
    };

    container.innerHTML = `
      <section class="codex-task-section">
        <div class="codex-section-head">
          <span data-i18n="sessionsHead">Sessions</span>
          <span data-session-count></span>
        </div>
        <div class="codex-session-list" data-session-list></div>
        <button type="button" class="codex-view-all" data-view-all hidden></button>
      </section>
    `;

    container.querySelector('[data-view-all]')?.addEventListener('click', () => {
      instance.showAll = true;
      render(instance);
    });

    render(instance);
    return {
      update: (sessions, activeSessionId, updateOptions = {}) => update(instance, sessions, activeSessionId, updateOptions),
      destroy: () => destroy(instance),
      _instance: instance
    };
  }

  function update(target, sessions, activeSessionId, updateOptions = {}) {
    const instance = target?._instance || target;
    if (!instance) {
      return;
    }
    instance.sessions = Array.isArray(sessions) ? sessions : [];
    instance.activeSessionId = activeSessionId || null;
    instance.pinnedSessionIds = updateOptions.pinnedSessionIds || instance.pinnedSessionIds || [];
    // Preserve the expanded ("View all") state across re-renders (delete, rename,
    // a composer keystroke, a run start) — only change it when a caller passes an
    // explicit value. Previously every update snapped the list back to 3 rows.
    if (updateOptions.showAll !== undefined) {
      instance.showAll = updateOptions.showAll === true;
    }
    render(instance);
  }

  function render(instance) {
    const list = instance.container.querySelector('[data-session-list]');
    if (!list) {
      return;
    }

    const sessions = (instance.sessions || []).filter(instance.isDisplayableSession);
    const visibleSessions = getVisibleSessions(instance, sessions);
    const count = instance.container.querySelector('[data-session-count]');
    if (count) {
      count.textContent = sessions.length ? `${sessions.length}` : '';
    }

    list.replaceChildren();
    if (!visibleSessions.length) {
      const hint = document.createElement('div');
      hint.className = 'codex-session-empty-hint';
      hint.textContent = t(instance, 'sessionListEmpty');
      list.append(hint);
    }
    for (const session of visibleSessions) {
      list.append(renderSessionRow(instance, session));
    }

    const viewAll = instance.container.querySelector('[data-view-all]');
    if (viewAll) {
      viewAll.hidden = instance.showAll || sessions.length <= instance.maxVisible;
      viewAll.textContent = t(instance, 'viewAllSessions', { count: sessions.length });
    }
  }

  function getVisibleSessions(instance, sessions) {
    if (typeof instance.selectVisibleSessionsForList === 'function') {
      return instance.selectVisibleSessionsForList(instance.sessions, instance.activeSessionId, {
        showAll: instance.showAll,
        maxVisible: instance.maxVisible,
        pinnedSessionIds: instance.pinnedSessionIds
      });
    }
    return instance.showAll ? sessions : sessions.slice(0, instance.maxVisible);
  }

  function renderSessionRow(instance, session) {
    const row = document.createElement('div');
    const isRunningSession = instance.isSessionRunning(session);
    row.className = 'codex-session-row';
    row.dataset.active = session.id === instance.activeSessionId ? 'true' : 'false';
    row.dataset.running = isRunningSession ? 'true' : 'false';

    const switchButton = document.createElement('button');
    switchButton.type = 'button';
    switchButton.className = 'codex-session-switch';
    const titleNode = document.createElement('span');
    titleNode.className = 'codex-session-row-title';
    const timeNode = document.createElement('time');
    switchButton.append(titleNode, timeNode);

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'codex-session-title-input';
    titleInput.setAttribute('aria-label', t(instance, 'renameSession'));
    titleInput.maxLength = 80;
    titleInput.hidden = true;

    const renameButton = document.createElement('button');
    renameButton.type = 'button';
    renameButton.className = 'codex-session-rename';
    renameButton.title = t(instance, 'renameSession');
    renameButton.setAttribute('aria-label', t(instance, 'renameSession'));
    renameButton.textContent = '✎';

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'codex-session-delete';
    deleteButton.textContent = '×';

    row.append(switchButton, titleInput, renameButton, deleteButton);
    const displayTitle = getDisplayTitle(instance, session);
    switchButton.title = displayTitle;
    titleNode.textContent = displayTitle;
    timeNode.textContent = instance.formatSessionTime(session.updatedAt || session.createdAt);
    switchButton.addEventListener('click', () => instance.callbacks.onSelect?.(session.id));
    // Keyboard nav: Up/Down move focus between rows, Enter/Space switch (native
    // button activation -> onSelect), Delete/Backspace delete the focused row.
    switchButton.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const switches = Array.from(instance.container.querySelectorAll('.codex-session-switch'));
        const index = switches.indexOf(switchButton);
        const next = event.key === 'ArrowDown' ? switches[index + 1] : switches[index - 1];
        next?.focus();
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && !deleteButton.disabled) {
        event.preventDefault();
        instance.callbacks.onDelete?.(session.id);
      }
    });
    renameButton.addEventListener('click', event => {
      event.stopPropagation();
      beginRename(instance, row, session);
    });
    deleteButton.disabled = isRunningSession;
    deleteButton.title = isRunningSession ? t(instance, 'deleteRunningSession') : t(instance, 'deleteSession');
    deleteButton.setAttribute('aria-label', isRunningSession ? t(instance, 'deleteRunningSession') : t(instance, 'deleteSession'));
    deleteButton.addEventListener('click', event => {
      event.stopPropagation();
      instance.callbacks.onDelete?.(session.id);
    });
    return row;
  }

  function beginRename(instance, row, session) {
    const input = row?.querySelector('.codex-session-title-input');
    const switchButton = row?.querySelector('.codex-session-switch');
    if (!session || !input || !switchButton) {
      return;
    }

    let settled = false;
    row.dataset.editing = 'true';
    input.value = getDisplayTitle(instance, session);
    input.hidden = false;
    switchButton.hidden = true;
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
      if (!commit) {
        render(instance);
        return;
      }
      instance.callbacks.onRename?.(session.id, input.value);
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

  function getDisplayTitle(target, session) {
    const instance = target?._instance || target;
    const title = typeof session?.title === 'string' ? session.title.trim() : '';
    if (title && title !== 'New task') {
      return title;
    }
    if (typeof instance?.deriveSessionTitle === 'function') {
      return instance.deriveSessionTitle(session?.runs, session?.task) || t(instance, 'newSessionFallback');
    }
    return session?.task || t(instance, 'newSessionFallback');
  }

  function t(instance, key, params) {
    if (typeof instance?.i18n === 'function') {
      return instance.i18n(key, params);
    }
    if (typeof instance?.i18n?.tr === 'function') {
      return instance.i18n.tr(key, params);
    }
    if (typeof instance?.i18n?.t === 'function') {
      return instance.i18n.t(key, params);
    }
    return key;
  }

  function defaultFormatSessionTime(timestamp) {
    return timestamp ? String(timestamp) : '';
  }

  function destroy(instance) {
    instance.container.textContent = '';
  }

  window.CodexOverleafSessionPanel = {
    create,
    update,
    getDisplayTitle
  };
})();
