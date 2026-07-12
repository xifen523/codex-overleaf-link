(function initCodexOverleafSessionMenuView() {
  'use strict';

  function create(deps = {}) {
    const {
      commitSessionRename,
      deleteSessionWithConfirm,
      document,
      formatSessionTime,
      getActiveSession,
      getPanel,
      getSessionDisplayTitle,
      getState,
      isDisplayableSession,
      isSessionRunning,
      startNewSession,
      switchSession,
      tr
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
        textNode.textContent = active && isDisplayableSession(active)
          ? getSessionDisplayTitle(active)
          : tr('newSessionFallback');
      }
      if (deleteButton) {
        const running = active ? isSessionRunning(active) : false;
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
      const createButton = document.createElement('button');
      createButton.type = 'button';
      createButton.className = 'codex-session-menu-new';
      createButton.textContent = `+ ${tr('newSession')}`;
      createButton.addEventListener('click', event => {
        event.stopPropagation();
        closeSessionMenu();
        startNewSession();
      });
      menu.append(createButton);
    }

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

    return {
      applySessionLabel,
      beginActiveSessionRename,
      bindActiveSessionHeader,
      closeSessionMenu,
      renderSessionMenu,
      toggleSessionMenu
    };
  }

  window.CodexOverleafSessionMenuView = { create };
})();
