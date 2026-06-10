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
            <div class="codex-custom-instructions-subtitle" data-i18n="projectSettingsSubtitle">Customize how Codex behaves in this and all projects.</div>
          </div>
          <span class="codex-settings-save-status" data-settings-save-status data-i18n="settingsSaved">Saved</span>
        </div>
        <div class="codex-project-settings-status" data-project-settings-status></div>
        <div class="codex-project-settings-scope">
          <div class="codex-project-settings-scope-title codex-set-eyebrow" data-i18n="settingsScopeProjectTitle">This project</div>
          <details class="codex-set-group" open>
            <summary class="codex-set-group-head"><span data-i18n="personalizationConfig">Personalization</span></summary>
            <div class="codex-set-card">
              <p class="codex-set-row-help" data-i18n="personalizationHelp">Style, terminology, and LaTeX conventions Codex should follow in this project.</p>
              <textarea id="codex-custom-instructions-input" class="codex-custom-instructions-input" data-custom-instructions-input rows="6" placeholder="Style, terminology, venue constraints, and LaTeX conventions for this project."></textarea>
            </div>
          </details>
          <details class="codex-set-group" open>
            <summary class="codex-set-group-head"><span data-i18n="governanceRulesTitle">Governance Rules</span></summary>
            <div class="codex-set-card">
              <div class="codex-set-row">
                <label class="codex-set-row-label" for="codex-governance-readonly-patterns" data-i18n="governanceReadonlyPatterns">Read-only patterns</label>
                <p class="codex-set-row-help" data-i18n="governanceReadonlyHelp">Files Codex must never modify (one glob per line).</p>
                <textarea id="codex-governance-readonly-patterns" class="codex-project-settings-textarea" data-governance-readonly-patterns rows="3" placeholder="paper/accepted/**&#10;main.tex"></textarea>
              </div>
              <div class="codex-set-row">
                <label class="codex-set-row-label" for="codex-governance-writable-patterns" data-i18n="governanceWritablePatterns">Writable patterns</label>
                <p class="codex-set-row-help" data-i18n="governanceWritableHelp">Files Codex may edit (one glob per line).</p>
                <textarea id="codex-governance-writable-patterns" class="codex-project-settings-textarea" data-governance-writable-patterns rows="3" placeholder="sections/**&#10;figures/**"></textarea>
              </div>
              <div class="codex-set-hairline"></div>
              <label class="codex-project-settings-row codex-project-settings-row--switch">
                <span class="codex-project-settings-row-label" data-i18n="sensitiveCheckEnabled">Check for sensitive content before Codex runs</span>
                <input type="checkbox" class="codex-switch" data-sensitive-check-enabled>
              </label>
              <p class="codex-set-row-help" data-i18n="sensitiveCheckHelp">Scan project files for secrets and PII before each Codex run.</p>
              <label class="codex-project-settings-row codex-project-settings-row--switch">
                <span class="codex-project-settings-row-label" data-i18n="sensitiveConfirmAllowed">Allow explicit confirmation when sensitive findings exist</span>
                <input type="checkbox" class="codex-switch" data-sensitive-confirm-allowed>
              </label>
              <p class="codex-set-row-help" data-i18n="sensitiveConfirmHelp">Let you review and proceed when the scan flags content.</p>
            </div>
          </details>
          <details class="codex-set-group">
            <summary class="codex-set-group-head"><span data-i18n="experimentalTitle">Experimental</span></summary>
            <div class="codex-set-card">
              <input type="checkbox" data-experimental-ot hidden>
              <button type="button" class="codex-diagnostics-ot-toggle" data-experimental-ot-toggle role="switch" aria-checked="false">
                <span data-i18n="experimentalOtMenuTitle">Experimental OT Mirror</span>
                <small data-experimental-ot-menu-status>OT: Off · Experimental: tracks the current editor and warms the local mirror; falls back when unsafe.</small>
              </button>
            </div>
          </details>
        </div>
        <div class="codex-project-settings-scope codex-project-settings-scope--global">
          <div class="codex-project-settings-scope-title codex-set-eyebrow" data-i18n="settingsScopeGlobalTitle">All projects</div>
          <details class="codex-set-group" open>
            <summary class="codex-set-group-head"><span data-i18n="appearanceTitle">Appearance</span></summary>
            <div class="codex-set-card">
              <label class="codex-project-settings-row codex-project-settings-row--switch">
                <span class="codex-project-settings-row-label" data-i18n="themeLabel">Theme</span>
                <select class="codex-set-select" data-theme-select>
                  <option value="dark" data-i18n="themeDark">Dark</option>
                  <option value="light" data-i18n="themeLight">Light</option>
                  <option value="auto" data-i18n="themeAuto">Follow system</option>
                </select>
              </label>
              <p class="codex-set-row-help" data-i18n="themeHelp">Switch the Codex panel between dark, light, or following your operating system.</p>
              <label class="codex-project-settings-row codex-project-settings-row--switch">
                <span class="codex-project-settings-row-label" data-i18n="languageLabel">Language</span>
                <select class="codex-set-select" data-language-select>
                  <option value="en" data-i18n="languageEnglish">English</option>
                  <option value="zh" data-i18n="languageChinese">中文</option>
                </select>
              </label>
              <p class="codex-set-row-help" data-i18n="languageHelp">Panel display language.</p>
            </div>
          </details>
          <details class="codex-set-group" open>
            <summary class="codex-set-group-head"><span data-i18n="localSkillsTitle">Skills</span></summary>
            <div class="codex-set-card">
              <label class="codex-project-settings-row codex-project-settings-row--switch">
                <span class="codex-project-settings-row-label" data-i18n="loadCodexLocalSkills">Load local Codex skills</span>
                <input type="checkbox" class="codex-switch" data-load-codex-local-skills>
              </label>
              <p class="codex-set-row-help" data-i18n="loadCodexLocalSkillsHelp">Pull skills from your local Codex installation.</p>
              <button type="button" class="codex-skills-entry" data-skills-entry>
                <span class="codex-skills-entry-label" data-i18n="codexOverleafSkillsEntry">Codex Overleaf skills</span>
                <span class="codex-skills-entry-summary" data-skills-entry-summary></span>
                <span class="codex-skills-entry-chevron" aria-hidden="true">›</span>
              </button>
            </div>
          </details>
        </div>
      </section>
      <section class="codex-custom-instructions-panel codex-skills-panel" data-skills-screen>
        <div class="codex-custom-instructions-head">
          <button type="button" data-skills-back title="Back" aria-label="Back">‹</button>
          <div>
            <div class="codex-custom-instructions-title" data-i18n="codexOverleafSkillsTitle">Codex Overleaf skills</div>
          </div>
        </div>
        <div class="codex-set-card">
          <label class="codex-project-settings-row codex-project-settings-row--switch">
            <span class="codex-project-settings-row-label" data-i18n="loadCodexOverleafSkills">Load Codex Overleaf skills</span>
            <input type="checkbox" class="codex-switch" data-load-codex-overleaf-skills>
          </label>
        </div>
        <div class="codex-skills-divider"></div>
        <div class="codex-local-skill-list" data-local-skill-list></div>
      </section>
    `;

    container.querySelector('[data-settings-back]')?.addEventListener('click', () => instance.callbacks.onBack?.());
    container.querySelector('[data-skills-back]')?.addEventListener('click', () => instance.callbacks.onSkillsBack?.());
    container.querySelector('[data-skills-entry]')?.addEventListener('click', () => instance.callbacks.onSkillsOpen?.());
    // Experimental OT mirror toggle (relocated here from the diagnostics menu);
    // its enable/disable flow stays in the runtime, wired through callbacks.
    container.querySelector('[data-experimental-ot-toggle]')?.addEventListener('click', event => instance.callbacks.onOtToggleClick?.(event));
    container.querySelector('[data-experimental-ot-toggle]')?.addEventListener('keydown', event => instance.callbacks.onOtToggleKeydown?.(event));
    container.querySelector('[data-experimental-ot]')?.addEventListener('change', event => instance.callbacks.onOtCheckboxChange?.(event));
    // Personalization textarea: auto-save on change (the change event fires on blur — avoids per-keystroke saves).
    const customInstructionsInput = container.querySelector('[data-custom-instructions-input]');
    customInstructionsInput?.addEventListener('change', event => {
      instance.callbacks.onInputChange?.(event);
      flashSaved(instance);
    });
    // Governance and skill fields: auto-save on change and input for immediate response.
    for (const selector of ['[data-governance-readonly-patterns]', '[data-governance-writable-patterns]', '[data-sensitive-check-enabled]', '[data-sensitive-confirm-allowed]', '[data-load-codex-local-skills]', '[data-load-codex-overleaf-skills]', '[data-theme-select]', '[data-language-select]']) {
      const element = container.querySelector(selector);
      element?.addEventListener?.('change', event => {
        instance.callbacks.onInputChange?.(event);
        flashSaved(instance);
      });
      element?.addEventListener?.('input', event => instance.callbacks.onInputChange?.(event));
    }

    return {
      show: () => show(instance),
      hide: () => hide(instance),
      loadState: state => loadState(instance, state),
      readState: () => readState(instance),
      setStatus: (text, status) => setStatus(instance, text, status),
      clearStatus: () => clearStatus(instance),
      setSkillsSummary: text => setSkillsSummary(instance, text),
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
    // Visibility is governed by the panel root's data-view attribute. The
    // settings surface counts as visible for both the settings screen and the
    // skills sub-page, so the gear toggle can close either back to the session.
    const panelRoot = instance?.container?.closest?.('[data-view]') ||
      instance?.container?.ownerDocument?.querySelector?.('[data-view]');
    if (panelRoot) {
      return panelRoot.dataset.view === 'settings' || panelRoot.dataset.view === 'skills';
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
      // The local-skills switch lives on the settings screen; the Codex Overleaf
      // master switch lives on the skills screen. Both are reachable from the
      // shared container, so query that instead of a single screen root.
      const scope = instance?.container || root;
      const toggles = state.skillToggles || {};
      setChecked(scope, '[data-load-codex-local-skills]', toggles.loadCodexLocalSkills !== false);
      setChecked(scope, '[data-load-codex-overleaf-skills]', toggles.loadCodexOverleafSkills !== false);
      setValue(scope, '[data-theme-select]', state.theme || 'dark');
      setValue(scope, '[data-language-select]', state.language || 'en');
    }
  }

  function readState(target) {
    const instance = target?._instance || target;
    const root = getRoot(instance);
    // Skill toggles span two screens, so read them from the shared container.
    const scope = instance?.container || root;
    return {
      customInstructions: root?.querySelector('[data-custom-instructions-input]')?.value || '',
      governanceRules: {
        readonlyPatterns: readPatternList(root?.querySelector('[data-governance-readonly-patterns]')?.value),
        writablePatterns: readPatternList(root?.querySelector('[data-governance-writable-patterns]')?.value),
        sensitiveCheckEnabled: root?.querySelector('[data-sensitive-check-enabled]')?.checked !== false,
        sensitiveConfirmAllowed: root?.querySelector('[data-sensitive-confirm-allowed]')?.checked === true
      },
      skillToggles: {
        loadCodexLocalSkills: scope?.querySelector('[data-load-codex-local-skills]')?.checked !== false,
        loadCodexOverleafSkills: scope?.querySelector('[data-load-codex-overleaf-skills]')?.checked !== false
      },
      theme: scope?.querySelector('[data-theme-select]')?.value || 'dark',
      language: scope?.querySelector('[data-language-select]')?.value || 'en'
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

  function setSkillsSummary(target, text) {
    const instance = target?._instance || target;
    const element = instance?.container?.querySelector('[data-skills-entry-summary]');
    if (!element) {
      return;
    }
    element.textContent = text || '';
  }

  // Flash the "✓ Saved" indicator after a field auto-saves, then fade it out.
  // The fields persist immediately on change, so this is purely a confirmation
  // cue — it never gates the save itself.
  function flashSaved(instance) {
    const status = instance?.container?.querySelector('[data-settings-save-status]');
    if (!status) {
      return;
    }
    status.dataset.state = 'saved';
    if (instance._savedFlashTimer) {
      clearTimeout(instance._savedFlashTimer);
    }
    instance._savedFlashTimer = setTimeout(() => {
      const current = instance?.container?.querySelector('[data-settings-save-status]');
      if (current) {
        current.dataset.state = '';
      }
    }, 1600);
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
    if (instance._savedFlashTimer) {
      clearTimeout(instance._savedFlashTimer);
      instance._savedFlashTimer = null;
    }
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
    clearStatus,
    setSkillsSummary
  };
})();
