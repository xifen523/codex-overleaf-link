(function initCodexOverleafLocalSkillsPanel(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafLocalSkillsPanel = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function localSkillsPanelFactory() {
  'use strict';

  function createLocalSkillsPanelController(deps = {}) {
    const getPanel = typeof deps.getPanel === 'function' ? deps.getPanel : () => null;
    const root = deps.root || (typeof window !== 'undefined' ? window : globalThis);
    const document = deps.document || root.document || (typeof globalThis !== 'undefined' ? globalThis.document : null);
    const getState = typeof deps.getState === 'function' ? deps.getState : () => null;
    const setState = typeof deps.setState === 'function' ? deps.setState : () => {};
    const saveState = typeof deps.saveState === 'function' ? deps.saveState : null;
    const sendBackgroundNative = typeof deps.sendBackgroundNative === 'function'
      ? deps.sendBackgroundNative
      : () => Promise.resolve({ ok: false });
    const getSkillLoadingSettings = typeof deps.getSkillLoadingSettings === 'function'
      ? deps.getSkillLoadingSettings
      : () => ({ loadCodexOverleafSkills: true });
    const isCodexOverleafSkillEnabled = typeof deps.isCodexOverleafSkillEnabled === 'function'
      ? deps.isCodexOverleafSkillEnabled
      : () => true;
    const setCodexOverleafSkillEnabled = typeof deps.setCodexOverleafSkillEnabled === 'function'
      ? deps.setCodexOverleafSkillEnabled
      : () => {};
    const setProjectSettingsStatus = typeof deps.setProjectSettingsStatus === 'function'
      ? deps.setProjectSettingsStatus
      : () => {};
    const tr = typeof deps.tr === 'function' ? deps.tr : key => key;
    const tx = typeof deps.tx === 'function' ? deps.tx : (english) => english;
    const getComposerSkillInvocation = typeof deps.getComposerSkillInvocation === 'function'
      ? deps.getComposerSkillInvocation
      : () => null;
    const normalizeComposerSkillInvocation = typeof deps.normalizeComposerSkillInvocation === 'function'
      ? deps.normalizeComposerSkillInvocation
      : value => value;
    const clearComposerSkillInvocation = typeof deps.clearComposerSkillInvocation === 'function'
      ? deps.clearComposerSkillInvocation
      : () => {};
    const setSlashCodexOverleafSkills = typeof deps.setSlashCodexOverleafSkills === 'function'
      ? deps.setSlashCodexOverleafSkills
      : () => {};
    const clearSlashCodexOverleafSkills = typeof deps.clearSlashCodexOverleafSkills === 'function'
      ? deps.clearSlashCodexOverleafSkills
      : () => {};

    async function refreshLocalSkills() {
      showSkillListLoading();
      try {
        const codexOverleafResponse = await sendBackgroundNative({
          method: 'skills.list',
          params: { scope: 'codex-overleaf' }
        });
        if (!codexOverleafResponse?.ok) {
          throw new Error(codexOverleafResponse?.error?.message || 'native host did not return Codex Overleaf skills');
        }
        const codexOverleafSkills = Array.isArray(codexOverleafResponse.result?.skills)
          ? codexOverleafResponse.result.skills
          : [];
        const state = getState() || {};
        setState({
          ...state,
          codexOverleafSkills
        });
        setSlashCodexOverleafSkills(codexOverleafSkills);
        renderLocalSkillList();
      } catch (err) {
        renderLocalSkillList();
        throw err;
      }
    }

    function showSkillListLoading() {
      const list = getPanel()?.querySelector('[data-local-skill-list]');
      if (!list) {
        return;
      }
      list.textContent = '';
      const placeholder = document.createElement('div');
      placeholder.className = 'codex-project-settings-empty';
      placeholder.textContent = tr('codexOverleafSkillsLoading');
      list.append(placeholder);
    }

    // Tracks which row is currently in "confirming remove" state.
    // Only one row may be in this state at a time.
    let confirmingRowId = null;

    function getCodexOverleafSkillsForSettings() {
      const state = getState() || {};
      return Array.isArray(state.codexOverleafSkills) ? state.codexOverleafSkills : [];
    }

    function renderLocalSkillList() {
      const list = getPanel()?.querySelector('[data-local-skill-list]');
      if (!list) {
        return;
      }
      confirmingRowId = null;
      const codexOverleafSkills = getCodexOverleafSkillsForSettings();
      const codexOverleafEnabled = getSkillLoadingSettings().loadCodexOverleafSkills !== false;
      list.textContent = '';
      if (!codexOverleafEnabled) {
        appendLocalSkillEmpty(list, tr('codexOverleafSkillsDisabled'));
      }
      if (!codexOverleafSkills.length) {
        appendLocalSkillEmpty(list, tr('codexOverleafSkillsEmpty'));
        return;
      }
      for (const skill of codexOverleafSkills) {
        renderCodexOverleafSkillRow(list, skill, codexOverleafEnabled);
      }
    }

    function renderCodexOverleafSkillRow(list, skill, masterEnabled) {
      const id = String(skill?.id || '').trim();
      if (!id) {
        return;
      }
      const row = document.createElement('div');
      row.className = 'codex-local-skill-row';
      row.dataset.scope = 'codex-overleaf';
      if (!masterEnabled) {
        row.dataset.disabled = 'true';
      }

      // Skill name + "(id)" on the left.
      const text = document.createElement('span');
      text.textContent = skill.title ? `${skill.title} (${id})` : id;
      text.title = text.textContent;
      row.append(text);

      // Per-skill enable switch — appended last so it sits on the right of the
      // row, after the Remove control. It remains a real checkbox input.
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.className = 'codex-switch';
      toggle.checked = isCodexOverleafSkillEnabled(id);
      toggle.setAttribute('aria-label', tr('codexOverleafSkillEnableToggle'));
      if (!masterEnabled) {
        toggle.disabled = true;
      }
      toggle.addEventListener('change', event => {
        setCodexOverleafSkillEnabled(id, event.target.checked);
      });

      if (skill.removable !== false) {
        // The Remove / Confirm / Cancel controls share an actions container so
        // the per-skill switch always stays rightmost in the row, regardless of
        // the inline confirmation state.
        const actions = document.createElement('div');
        actions.className = 'codex-local-skill-actions';

        // Remove button — clicking it enters the inline confirmation state.
        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.textContent = tr('localSkillRemove');

        // Confirm and Cancel buttons — only in the DOM while confirming.
        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.textContent = tr('localSkillRemoveConfirm');

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.textContent = tr('localSkillRemoveCancel');

        function enterConfirming() {
          // Reset any previously confirming row back to its Remove button state.
          if (confirmingRowId !== null && confirmingRowId !== id) {
            resetConfirmingRow();
          }
          confirmingRowId = id;
          removeBtn.remove();
          row.dataset.confirming = 'true';
          actions.append(confirmBtn, cancelBtn);
        }

        function exitConfirming() {
          confirmingRowId = null;
          confirmBtn.remove();
          cancelBtn.remove();
          delete row.dataset.confirming;
          actions.append(removeBtn);
        }

        removeBtn.addEventListener('click', event => {
          event.preventDefault();
          enterConfirming();
        });

        cancelBtn.addEventListener('click', event => {
          event.preventDefault();
          exitConfirming();
        });

        confirmBtn.addEventListener('click', event => {
          event.preventDefault();
          // In-progress: disable Confirm, Cancel, and the enable toggle; update text.
          confirmBtn.disabled = true;
          cancelBtn.disabled = true;
          toggle.disabled = true;
          confirmBtn.textContent = tr('localSkillRemoving');
          removeCodexOverleafSkill(id).catch(error => {
            setProjectSettingsStatus(tx(`Failed to remove Codex Overleaf skill: ${error.message}`, `删除 Codex Overleaf 技能失败：${error.message}`), 'failed');
            // Restore row on failure so the user can retry.
            confirmBtn.disabled = false;
            cancelBtn.disabled = false;
            toggle.disabled = !masterEnabled;
            confirmBtn.textContent = tr('localSkillRemoveConfirm');
          });
        });

        actions.append(removeBtn);
        row.append(actions);

        // Store references so resetConfirmingRow can find and reset this row.
        row._exitConfirming = exitConfirming;
        row._skillId = id;
      }

      // Per-skill enable switch is always the last child (rightmost).
      row.append(toggle);

      list.append(row);
    }

    function resetConfirmingRow() {
      // Walk the skill list to find the row whose id matches confirmingRowId.
      const list = getPanel()?.querySelector('[data-local-skill-list]');
      if (!list) {
        return;
      }
      for (const child of Array.from(list.children || [])) {
        if (child._skillId === confirmingRowId && child._exitConfirming) {
          child._exitConfirming();
          break;
        }
      }
    }

    function appendLocalSkillEmpty(list, text) {
      const empty = document.createElement('div');
      empty.className = 'codex-project-settings-empty';
      empty.textContent = text;
      list.append(empty);
    }

    async function removeCodexOverleafSkill(id) {
      const response = await sendBackgroundNative({
        method: 'skills.remove',
        params: {
          scope: 'codex-overleaf',
          id
        }
      });
      if (!response?.ok) {
        throw new Error(response?.error?.message || 'native host did not remove Codex Overleaf skill');
      }
      const activeSkill = normalizeComposerSkillInvocation(getComposerSkillInvocation());
      if (activeSkill?.scope === 'codex-overleaf' && activeSkill.skillId === id) {
        clearComposerSkillInvocation();
      }
      setProjectSettingsStatus(tr('codexOverleafSkillRemoveDone'), 'completed');
      clearSlashCodexOverleafSkills();
      await refreshLocalSkills();
      await saveState?.();
    }

    return {
      refreshLocalSkills,
      renderLocalSkillList,
      removeCodexOverleafSkill
    };
  }

  return {
    createLocalSkillsPanelController
  };
});
