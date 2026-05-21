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
    }

    function getCodexOverleafSkillsForSettings() {
      const state = getState() || {};
      return Array.isArray(state.codexOverleafSkills) ? state.codexOverleafSkills : [];
    }

    function renderLocalSkillList() {
      const list = getPanel()?.querySelector('[data-local-skill-list]');
      if (!list) {
        return;
      }
      const codexOverleafSkills = getCodexOverleafSkillsForSettings();
      const codexOverleafEnabled = getSkillLoadingSettings().loadCodexOverleafSkills !== false;
      list.textContent = '';
      appendLocalSkillGroupTitle(list, tr('codexOverleafSkillsTitle'));
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

      // Leading per-skill enable toggle
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.checked = isCodexOverleafSkillEnabled(id);
      toggle.setAttribute('aria-label', tr('codexOverleafSkillEnableToggle'));
      if (!masterEnabled) {
        toggle.disabled = true;
      }
      toggle.addEventListener('change', event => {
        setCodexOverleafSkillEnabled(id, event.target.checked);
      });
      row.append(toggle);

      const text = document.createElement('span');
      text.textContent = skill.title ? `${skill.title} (${id})` : id;
      text.title = text.textContent;
      row.append(text);
      if (skill.removable !== false) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = tr('localSkillRemove');
        remove.addEventListener('click', event => {
          event.preventDefault();
          removeCodexOverleafSkill(id).catch(error => setProjectSettingsStatus(tx(`Failed to remove Codex Overleaf skill: ${error.message}`, `删除 Codex Overleaf 技能失败：${error.message}`), 'failed'));
        });
        row.append(remove);
      }
      list.append(row);
    }

    function appendLocalSkillGroupTitle(list, text) {
      const title = document.createElement('div');
      title.className = 'codex-local-skill-group-title';
      title.textContent = text;
      list.append(title);
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
