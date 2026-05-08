(function initCodexOverleafDiagnosticsPanel() {
  'use strict';

  function create(options = {}) {
    const container = options.container;
    if (!container) {
      throw new Error('CodexOverleafDiagnosticsPanel requires a container');
    }
    const instance = {
      container,
      callbacks: options.callbacks || {},
      i18n: options.i18n || {},
      dismissInstalled: false
    };

    container.innerHTML = `
      <div class="codex-diagnostics-wrap">
        <button type="button" data-diagnostics-menu title="Diagnostics" aria-label="Diagnostics" aria-expanded="false">⋯</button>
        <div class="codex-diagnostics-menu" data-diagnostics-popover hidden>
          <div class="codex-diagnostics-hint" data-i18n="diagnosticsHint">Use when Codex cannot run, write, or read files</div>
          <input type="checkbox" data-experimental-ot hidden>
          <button type="button" class="codex-diagnostics-ot-toggle" data-experimental-ot-toggle role="switch" aria-checked="false" title="Experimental read-only OT mirror warming. If unavailable or stale, Codex falls back to the normal project read path.">
            <span data-i18n="experimentalOtMenuTitle">Experimental OT Mirror</span>
            <small data-experimental-ot-menu-status>OT: Off · Experimental: tracks the current editor and warms the local mirror; falls back when unsafe.</small>
          </button>
          <button type="button" data-diagnostics-native-env>
            <span data-i18n="diagnosticsNativeTitle">Check Local Connection</span>
            <small data-i18n="diagnosticsNativeSubtitle">Codex, Native Host, LaTeX tools</small>
          </button>
          <button type="button" data-diagnostics-page-state>
            <span data-i18n="diagnosticsPageTitle">Check Overleaf Write Access</span>
            <small data-i18n="diagnosticsPageSubtitle">Current file, write access, track changes</small>
          </button>
          <button type="button" data-diagnostics-snapshot>
            <span data-i18n="diagnosticsSnapshotTitle">Check Project Read</span>
            <small data-i18n="diagnosticsSnapshotSubtitle">Full project, assets, read source</small>
          </button>
          <button type="button" data-diagnostics-ot>
            <span data-i18n="diagnosticsOtTitle">Check Experimental OT Mirror</span>
            <small data-i18n="diagnosticsOtSubtitle">Status, fresh files, fallback</small>
          </button>
          <button type="button" data-diagnostics-export>
            <span data-i18n="diagnosticsExportTitle">Export Diagnostics</span>
            <small data-i18n="diagnosticsExportSubtitle">Redacted audit and environment bundle</small>
          </button>
          <button type="button" data-language-toggle>
            <span data-i18n="switchLanguage">Switch to Chinese</span>
            <small data-i18n="switchLanguageHint">Change panel language</small>
          </button>
        </div>
        <section class="codex-diagnostics-result" data-diagnostics-result hidden>
          <div class="codex-diagnostics-result-head">
            <div>
              <div class="codex-diagnostics-result-title" data-diagnostics-result-title></div>
              <div class="codex-diagnostics-result-subtitle" data-diagnostics-result-subtitle></div>
            </div>
            <button type="button" data-diagnostics-result-close title="Close" aria-label="Close diagnostics result">×</button>
          </div>
          <div class="codex-diagnostics-result-body" data-diagnostics-result-body></div>
          <details class="codex-diagnostics-technical" data-diagnostics-result-details>
            <summary data-i18n="technicalDetails">Technical Details</summary>
            <pre data-diagnostics-result-technical></pre>
          </details>
        </section>
      </div>
    `;

    bindStaticActions(instance);
    installDismiss(instance);

    return {
      show: () => toggleMenu(instance, true),
      hide: () => closeMenu(instance),
      updateStatus: status => updateStatus(instance, status),
      destroy: () => destroy(instance),
      _instance: instance
    };
  }

  function bindStaticActions(instance) {
    const root = instance.container;
    root.querySelector('[data-diagnostics-menu]')?.addEventListener('click', () => toggleMenu(instance));
    root.querySelector('[data-diagnostics-native-env]')?.addEventListener('click', () => instance.callbacks.onNativeEnvironment?.());
    root.querySelector('[data-diagnostics-page-state]')?.addEventListener('click', () => instance.callbacks.onPageState?.());
    root.querySelector('[data-diagnostics-snapshot]')?.addEventListener('click', () => instance.callbacks.onSnapshot?.());
    root.querySelector('[data-diagnostics-ot]')?.addEventListener('click', () => instance.callbacks.onOtDiagnostics?.());
    root.querySelector('[data-diagnostics-export]')?.addEventListener('click', () => instance.callbacks.onExport?.());
    root.querySelector('[data-language-toggle]')?.addEventListener('click', () => instance.callbacks.onLanguageToggle?.());
    root.querySelector('[data-diagnostics-result-close]')?.addEventListener('click', () => closeResult(instance));
    root.querySelector('[data-experimental-ot-toggle]')?.addEventListener('click', event => instance.callbacks.onOtToggleClick?.(event));
    root.querySelector('[data-experimental-ot-toggle]')?.addEventListener('keydown', event => instance.callbacks.onOtToggleKeydown?.(event));
    root.querySelector('[data-experimental-ot]')?.addEventListener('change', event => instance.callbacks.onOtCheckboxChange?.(event));
  }

  function toggleMenu(target, forceOpen) {
    const instance = target?._instance || target;
    const popover = instance?.container?.querySelector('[data-diagnostics-popover]');
    const button = instance?.container?.querySelector('[data-diagnostics-menu]');
    if (!popover || !button) {
      return;
    }
    const open = typeof forceOpen === 'boolean' ? forceOpen : popover.hidden;
    if (open) {
      instance.callbacks.onBeforeOpen?.();
    }
    popover.hidden = !open;
    button.dataset.active = open ? 'true' : 'false';
    button.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function closeMenu(target) {
    const instance = target?._instance || target;
    const popover = instance?.container?.querySelector('[data-diagnostics-popover]');
    const button = instance?.container?.querySelector('[data-diagnostics-menu]');
    if (!popover || !button) {
      return;
    }
    popover.hidden = true;
    button.dataset.active = 'false';
    button.setAttribute('aria-expanded', 'false');
  }

  function closeResult(target) {
    const instance = target?._instance || target;
    const result = instance?.container?.querySelector('[data-diagnostics-result]');
    if (result) {
      result.hidden = true;
    }
  }

  function showLoading(target, title, subtitle) {
    const instance = target?._instance || target;
    showResult(instance, {
      title,
      subtitle: subtitle || t(instance, 'diagnosticsLoading'),
      status: 'running',
      summary: t(instance, 'diagnosticsLoadingSummary')
    });
  }

  function showResult(target, result = {}) {
    const instance = target?._instance || target;
    const root = instance?.container?.querySelector('[data-diagnostics-result]');
    if (!root) {
      return;
    }

    root.hidden = false;
    root.dataset.status = result.status || 'info';
    root.querySelector('[data-diagnostics-result-title]').textContent = result.title || t(instance, 'diagnosticsResult');
    root.querySelector('[data-diagnostics-result-subtitle]').textContent = result.subtitle || '';

    const body = root.querySelector('[data-diagnostics-result-body]');
    body.textContent = '';
    appendParagraph(body, result.summary || t(instance, 'diagnosticsNoResult'));
    if (Array.isArray(result.bullets) && result.bullets.length) {
      const list = document.createElement('ul');
      for (const item of result.bullets) {
        const li = document.createElement('li');
        li.textContent = item;
        list.append(li);
      }
      body.append(list);
    }
    if (result.nextStep) {
      const next = document.createElement('p');
      next.className = 'codex-diagnostics-next-step';
      next.textContent = `${t(instance, 'nextStepPrefix')}${result.nextStep}`;
      body.append(next);
    }
    if (result.installCommand) {
      renderInstallCommand(instance, body, result.installCommand);
    }

    const details = root.querySelector('[data-diagnostics-result-details]');
    const technical = root.querySelector('[data-diagnostics-result-technical]');
    const technicalText = String(result.technical || '').trim();
    details.open = false;
    details.hidden = !technicalText;
    technical.textContent = technicalText;
  }

  function renderInstallCommand(instance, container, command) {
    const wrap = document.createElement('div');
    wrap.className = 'codex-install-command';

    const label = document.createElement('div');
    label.className = 'codex-install-command-label';
    label.textContent = t(instance, 'runInTerminal');
    wrap.append(label);

    const code = document.createElement('code');
    code.textContent = command;
    wrap.append(code);

    const copyButton = document.createElement('button');
    copyButton.type = 'button';
    copyButton.textContent = t(instance, 'copyInstallCommand');
    copyButton.addEventListener('click', async () => {
      await navigator.clipboard.writeText(command);
      copyButton.textContent = t(instance, 'copied');
      setTimeout(() => {
        copyButton.textContent = t(instance, 'copyInstallCommand');
      }, 1400);
    });
    wrap.append(copyButton);

    container.append(wrap);
  }

  function appendParagraph(container, text) {
    const paragraph = document.createElement('p');
    paragraph.textContent = text;
    container.append(paragraph);
  }

  function installDismiss(instance) {
    if (instance.dismissInstalled) {
      return;
    }
    instance.dismissInstalled = true;
    document.addEventListener('click', event => {
      const wrap = instance.container?.querySelector('.codex-diagnostics-wrap');
      if (!wrap || wrap.contains(event.target)) {
        return;
      }
      closeMenu(instance);
    }, true);
  }

  function updateStatus(target, status = {}) {
    const instance = target?._instance || target;
    const ot = status.ot || {};
    const toggle = instance?.container?.querySelector('[data-experimental-ot-toggle]');
    if (toggle && Object.prototype.hasOwnProperty.call(ot, 'enabled')) {
      toggle.setAttribute('aria-checked', ot.enabled ? 'true' : 'false');
    }
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

  function destroy(instance) {
    instance.container.textContent = '';
  }

  window.CodexOverleafDiagnosticsPanel = {
    create,
    updateStatus,
    toggleMenu,
    closeMenu,
    closeResult,
    showLoading,
    showResult
  };
})();
