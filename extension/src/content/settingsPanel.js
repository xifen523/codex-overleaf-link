(function initCodexOverleafSettingsPanel() {
  'use strict';

  function create(options = {}) {
    const container = options.container;
    if (!container) {
      throw new Error('CodexOverleafSettingsPanel requires a container');
    }
    const instance = {
      container,
      callbacks: options.callbacks || {},
      button: options.button || null
    };

    container.innerHTML = `
      <section class="codex-custom-instructions-panel codex-project-settings-panel" data-custom-instructions-panel data-project-settings-panel>
        <div class="codex-custom-instructions-head">
          <button type="button" data-settings-back title="Back" aria-label="Back">‹</button>
          <div>
            <div class="codex-custom-instructions-title" data-i18n="projectSettingsTitle">Project Settings</div>
            <span data-i18n="customInstructionsTitle" hidden>Custom Instructions</span>
            <span data-i18n="customInstructionsSubtitle" hidden>Give Codex extra instructions and context for this Overleaf project.</span>
            <div class="codex-custom-instructions-subtitle" data-i18n="projectSettingsSubtitle">Governance, local skills, and custom instructions for this Overleaf project.</div>
            <a class="codex-custom-instructions-learn-more" data-custom-instructions-learn-more data-i18n="customInstructionsLearnMore" href="https://developers.openai.com/codex/guides/agents-md#create-global-guidance" target="_blank" rel="noopener noreferrer">Learn more</a>
          </div>
          <span class="codex-settings-save-status" data-settings-save-status data-i18n="settingsSaved">Saved</span>
        </div>
        <label class="codex-custom-instructions-label" for="codex-custom-instructions-input" data-i18n="personalizationConfig">Personalization</label>
        <textarea id="codex-custom-instructions-input" class="codex-custom-instructions-input" data-custom-instructions-input rows="7" placeholder="Style, terminology, venue constraints, and LaTeX conventions for this project."></textarea>
        <div class="codex-project-settings-section">
          <div class="codex-project-settings-section-title" data-i18n="governanceRulesTitle">Governance Rules</div>
          <label class="codex-custom-instructions-label" for="codex-governance-readonly-patterns" data-i18n="governanceReadonlyPatterns">Read-only patterns</label>
          <textarea id="codex-governance-readonly-patterns" class="codex-project-settings-textarea" data-governance-readonly-patterns rows="3" placeholder="paper/accepted/**&#10;main.tex"></textarea>
          <label class="codex-custom-instructions-label" for="codex-governance-writable-patterns" data-i18n="governanceWritablePatterns">Writable patterns</label>
          <textarea id="codex-governance-writable-patterns" class="codex-project-settings-textarea" data-governance-writable-patterns rows="3" placeholder="sections/**&#10;figures/**"></textarea>
          <label class="codex-project-settings-check">
            <input type="checkbox" data-sensitive-check-enabled>
            <span data-i18n="sensitiveCheckEnabled">Check for sensitive content before Codex runs</span>
          </label>
          <label class="codex-project-settings-check">
            <input type="checkbox" data-sensitive-confirm-allowed>
            <span data-i18n="sensitiveConfirmAllowed">Allow explicit confirmation when sensitive findings exist</span>
          </label>
        </div>
        <div class="codex-project-settings-section">
          <div class="codex-project-settings-section-title" data-i18n="localSkillsTitle">Local Skills</div>
          <label class="codex-project-settings-check">
            <input type="checkbox" data-load-codex-local-skills>
            <span data-i18n="loadCodexLocalSkills">Load local Codex skills</span>
          </label>
          <label class="codex-project-settings-check">
            <input type="checkbox" data-load-codex-overleaf-skills>
            <span data-i18n="loadCodexOverleafSkills">Load Codex Overleaf skills</span>
          </label>
          <div class="codex-local-skill-list" data-local-skill-list></div>
          <div class="codex-project-settings-status" data-project-settings-status></div>
        </div>
      </section>
    `;

    container.querySelector('[data-settings-back]')?.addEventListener('click', () => instance.callbacks.onBack?.());
    // Personalization textarea: auto-save on blur (change event only — avoids per-keystroke saves).
    const customInstructionsInput = container.querySelector('[data-custom-instructions-input]');
    customInstructionsInput?.addEventListener('change', event => instance.callbacks.onInputChange?.(event));
    // Governance and skill fields: auto-save on change and input for immediate response.
    for (const selector of ['[data-governance-readonly-patterns]', '[data-governance-writable-patterns]', '[data-sensitive-check-enabled]', '[data-sensitive-confirm-allowed]', '[data-load-codex-local-skills]', '[data-load-codex-overleaf-skills]']) {
      const element = container.querySelector(selector);
      element?.addEventListener?.('change', event => instance.callbacks.onInputChange?.(event));
      element?.addEventListener?.('input', event => instance.callbacks.onInputChange?.(event));
    }

    return {
      show: () => show(instance),
      hide: () => hide(instance),
      loadState: state => loadState(instance, state),
      readState: () => readState(instance),
      setStatus: (text, status) => setStatus(instance, text, status),
      clearStatus: () => clearStatus(instance),
      destroy: () => destroy(instance),
      _instance: instance
    };
  }

  function show(target) {
    const instance = target?._instance || target;
    const root = getRoot(instance);
    if (!root) {
      return;
    }
    const button = getButton(instance);
    if (button) {
      button.dataset.active = 'true';
      button.setAttribute('aria-expanded', 'true');
    }
    root.querySelector('[data-custom-instructions-input]')?.focus?.();
  }

  function hide(target) {
    const instance = target?._instance || target;
    const root = getRoot(instance);
    if (!root) {
      return;
    }
    const button = getButton(instance);
    if (button) {
      button.dataset.active = 'false';
      button.setAttribute('aria-expanded', 'false');
    }
    clearStatus(instance);
  }

  function isVisible(target) {
    const instance = target?._instance || target;
    // Visibility is governed by the panel root's data-view attribute.
    const panelRoot = instance?.container?.closest?.('[data-view]') ||
      instance?.container?.ownerDocument?.querySelector?.('[data-view]');
    if (panelRoot) {
      return panelRoot.dataset.view === 'settings';
    }
    // Fallback: treat as not visible if we cannot read the view state.
    return false;
  }

  function loadState(target, state = {}) {
    const instance = target?._instance || target;
    const root = getRoot(instance);
    if (!root) {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(state, 'customInstructions')) {
      const input = root.querySelector('[data-custom-instructions-input]');
      if (input) {
        input.value = state.customInstructions || '';
      }
    }
    if (Object.prototype.hasOwnProperty.call(state, 'governanceRules')) {
      const rules = state.governanceRules || {};
      setValue(root, '[data-governance-readonly-patterns]', (rules.readonlyPatterns || []).join('\n'));
      setValue(root, '[data-governance-writable-patterns]', (rules.writablePatterns || []).join('\n'));
      setChecked(root, '[data-sensitive-check-enabled]', rules.sensitiveCheckEnabled !== false);
      setChecked(root, '[data-sensitive-confirm-allowed]', rules.sensitiveConfirmAllowed === true);
    }
    if (Object.prototype.hasOwnProperty.call(state, 'skillToggles')) {
      const toggles = state.skillToggles || {};
      setChecked(root, '[data-load-codex-local-skills]', toggles.loadCodexLocalSkills !== false);
      setChecked(root, '[data-load-codex-overleaf-skills]', toggles.loadCodexOverleafSkills !== false);
    }
  }

  function readState(target) {
    const instance = target?._instance || target;
    const root = getRoot(instance);
    return {
      customInstructions: root?.querySelector('[data-custom-instructions-input]')?.value || '',
      governanceRules: {
        readonlyPatterns: readPatternList(root?.querySelector('[data-governance-readonly-patterns]')?.value),
        writablePatterns: readPatternList(root?.querySelector('[data-governance-writable-patterns]')?.value),
        sensitiveCheckEnabled: root?.querySelector('[data-sensitive-check-enabled]')?.checked !== false,
        sensitiveConfirmAllowed: root?.querySelector('[data-sensitive-confirm-allowed]')?.checked === true
      },
      skillToggles: {
        loadCodexLocalSkills: root?.querySelector('[data-load-codex-local-skills]')?.checked !== false,
        loadCodexOverleafSkills: root?.querySelector('[data-load-codex-overleaf-skills]')?.checked !== false
      }
    };
  }

  function setStatus(target, text, status = 'info') {
    const instance = target?._instance || target;
    const element = getRoot(instance)?.querySelector('[data-project-settings-status]');
    if (!element) {
      return;
    }
    element.textContent = text || '';
    element.dataset.status = status;
  }

  function clearStatus(target) {
    const instance = target?._instance || target;
    const element = getRoot(instance)?.querySelector('[data-project-settings-status]');
    if (!element) {
      return;
    }
    element.textContent = '';
    delete element.dataset.status;
  }

  function getRoot(instance) {
    return instance?.container?.querySelector('[data-project-settings-panel]') || null;
  }

  function getButton(instance) {
    return instance?.button || document.querySelector('[data-custom-instructions-settings]');
  }

  function setValue(root, selector, value) {
    const element = root.querySelector(selector);
    if (element) {
      element.value = value;
    }
  }

  function setChecked(root, selector, checked) {
    const element = root.querySelector(selector);
    if (element) {
      element.checked = checked;
    }
  }

  function readPatternList(value) {
    return String(value || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
  }

  function destroy(instance) {
    instance.container.textContent = '';
  }

  window.CodexOverleafSettingsPanel = {
    create,
    loadState,
    readState,
    show,
    hide,
    isVisible,
    setStatus,
    clearStatus
  };
})();
