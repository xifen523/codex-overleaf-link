const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ReviewHunks = require('../extension/src/content/reviewHunks');

const DIFF_REVIEW_PANEL_PATH = '../extension/src/content/diffReviewPanel.js';

function extractFunction(source, name) {
  const markers = [`function ${name}(`, `async function ${name}(`];
  const start = markers
    .map(marker => source.indexOf(marker))
    .filter(index => index !== -1)
    .sort((a, b) => a - b)[0] ?? -1;
  assert.notEqual(start, -1, `${name} should exist`);
  const openBrace = source.indexOf('{', start);
  assert.notEqual(openBrace, -1, `${name} should have a body`);
  let depth = 0;
  for (let index = openBrace; index < source.length; index++) {
    if (source[index] === '{') {
      depth++;
    } else if (source[index] === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  assert.fail(`${name} body should close`);
}

function createMinimalDocument() {
  class Element {
    constructor(tagName) {
      this.tagName = tagName.toUpperCase();
      this.children = [];
      this.dataset = {};
      this.attributes = {};
      this.listeners = {};
      this.className = '';
      this.textContent = '';
      this.title = '';
      this.type = '';
      this.tabIndex = undefined;
    }

    append(...children) {
      this.children.push(...children);
    }

    appendChild(child) {
      this.append(child);
      return child;
    }

    replaceChildren(...children) {
      this.children = children;
    }

    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }

    getAttribute(name) {
      return this.attributes[name];
    }

    addEventListener(type, listener) {
      this.listeners[type] = this.listeners[type] || [];
      this.listeners[type].push(listener);
    }

    dispatchEvent(event) {
      for (const listener of this.listeners[event.type] || []) {
        listener(event);
      }
      return !event.defaultPrevented;
    }

    focus() {
      this.focused = true;
    }

    blur() {
      this.blurred = true;
      this.focused = false;
    }

    click() {
      const results = [];
      for (const listener of this.listeners.click || []) {
        results.push(listener({ currentTarget: this, target: this }));
      }
      return Promise.all(results);
    }

    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    }

    querySelectorAll(selector) {
      const matches = [];
      const attr = selector.match(/^\[([^\]]+)\]$/)?.[1];
      if (!attr) {
        return matches;
      }
      const visit = node => {
        if (Object.prototype.hasOwnProperty.call(node.attributes, attr)) {
          matches.push(node);
        }
        for (const child of node.children || []) {
          visit(child);
        }
      };
      visit(this);
      return matches;
    }
  }

  return {
    createTextNode(text) {
      return {
        nodeType: 3,
        textContent: String(text || ''),
        children: []
      };
    },
    createElement(tagName) {
      return new Element(tagName);
    }
  };
}

function collectElementText(node) {
  return [
    node?.textContent || '',
    ...(node?.children || []).map(child => collectElementText(child))
  ].join('');
}

function collectElements(node, predicate, result = []) {
  if (!node) {
    return result;
  }
  if (predicate(node)) {
    result.push(node);
  }
  for (const child of node.children || []) {
    collectElements(child, predicate, result);
  }
  return result;
}

function loadMarkdownRendererHarness(projectFiles = [], options = {}) {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const LineReferences = require('../extension/src/shared/lineReferences');
  const document = createMinimalDocument();
  const pageBridgeCalls = [];
  const toasts = [];
  const start = contentScript.indexOf('function getCurrentProjectReferenceFiles');
  assert.notEqual(start, -1, 'line-reference renderer helpers should exist');
  const endFunction = extractFunction(contentScript, 'normalizeInlineOrderedLists');
  const end = contentScript.indexOf(endFunction) + endFunction.length;
  const markdownRegion = [
    contentScript.slice(start, end),
    extractFunction(contentScript, 'isMarkdownHeadingLine'),
    extractFunction(contentScript, 'isMarkdownListLine'),
    extractFunction(contentScript, 'isMarkdownOrderedListLine'),
    extractFunction(contentScript, 'isSameMarkdownListKind'),
    extractFunction(contentScript, 'stripMarkdownListMarker')
  ].join('\n');

  return Function('document', 'LineReferences', 'projectFiles', 'pageBridgeCalls', 'toasts', 'options', `
    let state = {
      focusFiles: [],
      session: { focusFiles: [] },
      sessions: []
    };
    let currentRunView = { projectFiles };
    function callPageBridge(method, params) {
      pageBridgeCalls.push({ method, params });
      return options.callPageBridge
        ? options.callPageBridge(method, params)
        : Promise.resolve(options.pageBridgeResult || { ok: true });
    }
    function showPluginToast(text, options) {
      toasts.push({ text, options });
    }
    function tr(key) { return key; }
    function tx(english) { return english; }
    ${markdownRegion}
    return {
      buildMarkdownInlineNodes,
      renderMarkdownInlineText,
      renderMarkdownBlockText,
      formatMarkdownLinkLabel,
      formatMarkdownHref,
      pageBridgeCalls,
      toasts
    };
  `)(document, LineReferences, projectFiles, pageBridgeCalls, toasts, options);
}

function findLineReferenceButtons(node) {
  return collectElements(node, item => item.className === 'codex-line-reference');
}

function loadCreateDiffReviewElementForTest(options = {}) {
  delete require.cache[require.resolve(DIFF_REVIEW_PANEL_PATH)];
  const pageBridgeCalls = [];
  const DiffReviewPanel = require(DIFF_REVIEW_PANEL_PATH);
  const controller = DiffReviewPanel.createDiffReviewPanelController({
    document: createMinimalDocument(),
    root: { CodexOverleafReviewHunks: ReviewHunks },
    reviewHunks: ReviewHunks,
    callPageBridge(method, params) {
      pageBridgeCalls.push({ method, params });
      return Promise.resolve(options.pageBridgeResult || { ok: true });
    },
    tr(key) {
      return key;
    }
  });
  const createDiffReviewElement = controller.createDiffReviewElement;
  createDiffReviewElement.pageBridgeCalls = pageBridgeCalls;
  return createDiffReviewElement;
}

test('content runtime guards duplicate initialization and exposes fail-closed state', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );

  assert.match(contentScript, /__codexOverleafContentRuntimeInstalled/);
  assert.match(contentScript, /__codexOverleafContentRuntimeState/);
  assert.match(contentScript, /stale-panel-before-runtime-init/);
  assert.match(contentScript, /async-init-failed/);
  assert.match(contentScript, /alreadyInstalled:\s*true/);
});

test('panel renderer has compact overlay behavior for narrow viewports', () => {
  const renderer = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/panelRenderer.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );

  assert.match(renderer, /codex-overleaf-panel-compact/);
  assert.match(renderer, /viewportWidth < instance\.minWidth \+ instance\.pageMinWidth/);
  assert.match(renderer, /persist:\s*!compact && options\.persist !== false/);
  assert.match(renderer, /isCompactViewport\(instance\)/);
  assert.match(css, /codex-overleaf-panel-mounted:not\(\.codex-overleaf-panel-compact\) body/);
  assert.match(css, /max-height:\s*calc\(100vh - 24px\)/);
  assert.match(css, /codex-panel-resize-handle[\s\S]*display:\s*none/);
});

test('composer attachments enforce a total raw byte limit before reads', () => {
  const attachments = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/composerAttachments.js'),
    'utf8'
  );
  const runtime = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );

  assert.match(runtime, /MAX_COMPOSER_ATTACHMENT_TOTAL_BYTES = 32 \* 1024 \* 1024/);
  assert.match(attachments, /maxAttachmentTotalBytes/);
  assert.match(attachments, /canReserveAttachmentBytes\(fileSize\)/);
  assert.match(attachments, /pendingAttachmentBytes \+= fileSize/);
  assert.match(attachments, /pendingAttachmentBytes = Math\.max\(0, pendingAttachmentBytes - fileSize\)/);
  assert.match(attachments, /readFileAsDataUrl\(file\)/);
});

test('composer defaults to English task modes and keeps Chinese translations available', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  ).replace(/\r\n/g, '\n');
  const composerPanel = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/composerPanel.js'),
    'utf8'
  );

  const i18n = fs.readFileSync(
    path.join(__dirname, '../extension/src/shared/i18n.js'),
    'utf8'
  );
  const localSkillsPanel = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/localSkillsPanel.js'),
    'utf8'
  );

  assert.match(composerPanel, /data-mode-choice="ask"[\s\S]*>Ask<\/button>/);
  assert.match(composerPanel, /data-mode-choice="confirm"[\s\S]*>Suggest<\/button>/);
  assert.match(composerPanel, /data-mode-choice="auto"[\s\S]*>Auto<\/button>/);
  assert.match(i18n, /modeAsk:\s*'只问不改'/);
  assert.match(i18n, /modeConfirm:\s*'建议修改'/);
  assert.match(i18n, /modeAuto:\s*'自动写入'/);
});

test('composer shows confirm and auto as explicit visible write-mode choices', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const composerPanel = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/composerPanel.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );
  const contentSurface = `${contentScript}\n${composerPanel}`;

  assert.match(contentSurface, /class="codex-mode-row"/);
  assert.match(contentSurface, /class="codex-mode-switch"/);
  assert.match(contentSurface, /data-mode-choice="ask"/);
  assert.match(contentSurface, /data-mode-choice="confirm"/);
  assert.match(contentSurface, /data-mode-choice="auto"/);
  assert.match(contentScript, /function selectMode\(/);
  assert.match(contentScript, /function syncModeControls\(/);
  assert.match(contentScript, /querySelectorAll\('\[data-mode-choice\]'\)/);
  assert.match(css, /\.codex-mode-switch\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\[data-mode-choice\]\[data-active="true"\]/);
});

test('run timeline uses user-facing action transcript and undo language', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );

  assert.match(contentScript, /我会先理解你的请求/);
  assert.match(contentScript, /正在同步 Overleaf 项目到本地 Codex workspace/);
  assert.match(contentScript, /本地 Codex session 开始运行/);
  assert.match(contentScript, /同步本地 Codex 改动到 Overleaf/);
  assert.match(contentScript, /本地 Codex 改动已同步回 Overleaf/);
  assert.match(contentScript, /undoCheckpointPlain/);
  assert.match(contentScript, /undoNoTraceTitle/);
  assert.doesNotMatch(contentScript, /Starting \$\{state\.mode\} task/);
  assert.doesNotMatch(contentScript, /Apply result:/);
  assert.doesNotMatch(contentScript, /Undo checkpoint recorded:/);
});

test('task runs sync the full project only when a Codex run starts', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const runTaskBody = contentScript.match(/async function runTask\(\) \{[\s\S]*?\n  async function handleTaskResult/)?.[0] || '';

  assert.match(runTaskBody, /getRunProjectSnapshot\(\)/);
  assert.match(contentScript, /preferLightweight:\s*true/);
  assert.match(contentScript, /allowZipFallback:\s*true/);
  assert.match(contentScript, /requireFullProject:\s*true/);
  assert.doesNotMatch(runTaskBody, /getProjectSnapshot', \{ force: true \}/);
  assert.match(runTaskBody, /method: 'codex\.run'/);
  assert.match(runTaskBody, /syncChanges/);
  assert.match(runTaskBody, /applySyncChangesToOverleaf/);
  assert.doesNotMatch(runTaskBody, /scheduleProjectSync\(/);
  assert.match(contentScript, /async function applySyncChangesToOverleaf/);
});

test('project settings expose governed rules and local skills without Overleaf asset upload controls', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const attachmentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/composerAttachments.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );
  const i18n = fs.readFileSync(
    path.join(__dirname, '../extension/src/shared/i18n.js'),
    'utf8'
  );
  const localSkillsPanel = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/localSkillsPanel.js'),
    'utf8'
  );
  const settingsPanel = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/settingsPanel.js'),
    'utf8'
  );
  const settingsSource = `${contentScript}\n${settingsPanel}`;

  assert.match(settingsSource, /data-project-settings-panel/);
  assert.match(settingsSource, /data-governance-readonly-patterns/);
  assert.match(settingsSource, /data-governance-writable-patterns/);
  assert.match(settingsSource, /data-sensitive-check-enabled/);
  assert.match(settingsSource, /data-sensitive-confirm-allowed/);
  assert.match(settingsSource, /data-load-codex-local-skills/);
  assert.match(settingsSource, /data-load-codex-overleaf-skills/);
  assert.match(settingsSource, /data-local-skill-list/);
  assert.match(contentScript, /CodexOverleafLocalSkillsPanel/);
  assert.match(contentScript, /localSkillsPanel\.refreshLocalSkills/);
  assert.match(localSkillsPanel, /codexOverleafSkills/);
  assert.match(localSkillsPanel, /function getCodexOverleafSkillsForSettings/);
  assert.match(localSkillsPanel, /function removeCodexOverleafSkill/);
  assert.match(localSkillsPanel, /params:\s*\{\s*scope:\s*'codex-overleaf'\s*\}/);
  assert.doesNotMatch(contentScript, /data-local-skill-install-id/);
  assert.doesNotMatch(contentScript, /data-local-skill-install-content/);
  assert.doesNotMatch(contentScript, /installLocalSkillFromSettings/);
  assert.doesNotMatch(contentScript, /data-asset-upload/);
  assert.doesNotMatch(contentScript, /uploadSelectedAssets/);
  assert.doesNotMatch(contentScript, /getAssetUploadBaseline/);
  assert.match(contentScript, /function normalizeGovernanceRulesByProject/);
  assert.match(contentScript, /function normalizeSelectedLocalSkillIdsByProject/);
  assert.match(contentScript, /function readSkillLoadingSettingsFromSettings/);
  assert.match(contentScript, /loadCodexLocalSkills/);
  assert.match(contentScript, /loadCodexOverleafSkills/);
  assert.match(contentScript, /governanceRulesByProject/);
  assert.match(contentScript, /method:\s*'skills\.list'/);
  assert.match(localSkillsPanel, /method:\s*'skills\.remove'/);
  assert.doesNotMatch(localSkillsPanel, /projectLocalSkillsTitle/);
  assert.doesNotMatch(localSkillsPanel, /localSkillsEmpty/);
  assert.doesNotMatch(localSkillsPanel, /data-local-skill-selected/);
  assert.match(css, /\.codex-project-settings-panel/);
  assert.match(css, /\.codex-local-skill-list/);
  assert.doesNotMatch(css, /\.codex-local-skill-install-row/);
  assert.doesNotMatch(css, /\.codex-asset-upload-row/);
  assert.match(i18n, /projectSettingsTitle/);
  assert.match(i18n, /governanceReadonlyPatterns/);
  assert.match(i18n, /localSkillsTitle/);
  assert.doesNotMatch(i18n, /projectLocalSkillsTitle/);
  assert.doesNotMatch(i18n, /localSkillsEmpty/);
  assert.doesNotMatch(i18n, /codexOverleafSkillsTitle/);
  assert.match(i18n, /codexOverleafSkillsEmpty/);
  assert.match(i18n, /loadCodexLocalSkills/);
  assert.match(i18n, /loadCodexOverleafSkills/);
  assert.doesNotMatch(i18n, /assetUploadTitle/);
});

test('project settings renders only Codex Overleaf managed skills', async () => {
  delete require.cache[require.resolve('../extension/src/content/localSkillsPanel')];
  const LocalSkillsPanel = require('../extension/src/content/localSkillsPanel');
  const document = createMinimalDocument();
  const panel = document.createElement('div');
  const list = document.createElement('div');
  list.setAttribute('data-local-skill-list', '');
  panel.append(list);
  const requests = [];
  let state = {};
  let overleafEnabled = true;
  let slashSkills = [];
  const labels = {
    codexOverleafSkillsEmpty: 'No Codex Overleaf skills installed.',
    codexOverleafSkillsDisabled: 'Codex Overleaf skills are disabled.',
    localSkillRemove: 'Remove'
  };
  const controller = LocalSkillsPanel.createLocalSkillsPanelController({
    document,
    getPanel: () => panel,
    getState: () => state,
    setState: nextState => {
      state = nextState;
    },
    getCurrentProjectId: () => 'project-1',
    getSkillLoadingSettings: () => ({ loadCodexOverleafSkills: overleafEnabled }),
    tr: key => labels[key] || key,
    sendBackgroundNative(request) {
      requests.push(request);
      if (request.params?.scope === 'codex-overleaf') {
        return Promise.resolve({
          ok: true,
          result: {
            skills: [
              {
                id: 'auto-rebuttal',
                title: 'Auto Rebuttal',
                scope: 'codex-overleaf'
              }
            ]
          }
        });
      }
      return Promise.resolve({ ok: true, result: { skills: [] } });
    },
    setSlashCodexOverleafSkills(skills) {
      slashSkills = skills;
    }
  });

  await controller.refreshLocalSkills();

  assert.deepEqual(
    requests.map(request => request.params),
    [{ scope: 'codex-overleaf' }]
  );
  assert.equal(slashSkills[0]?.id, 'auto-rebuttal');
  assert.doesNotMatch(collectElementText(list), /project-local/i);
  assert.match(collectElementText(list), /Auto Rebuttal \(auto-rebuttal\)/);

  overleafEnabled = false;
  controller.renderLocalSkillList();

  assert.match(collectElementText(list), /Codex Overleaf skills are disabled/);
  assert.match(collectElementText(list), /Auto Rebuttal \(auto-rebuttal\)/);
});

test('project settings omits the remove button for official skills with removable: false', async () => {
  delete require.cache[require.resolve('../extension/src/content/localSkillsPanel')];
  const LocalSkillsPanel = require('../extension/src/content/localSkillsPanel');
  const document = createMinimalDocument();
  const panel = document.createElement('div');
  const list = document.createElement('div');
  list.setAttribute('data-local-skill-list', '');
  panel.append(list);
  let state = {};
  const labels = {
    codexOverleafSkillsEmpty: 'No Codex Overleaf skills installed.',
    codexOverleafSkillsDisabled: 'Codex Overleaf skills are disabled.',
    localSkillRemove: 'Remove'
  };
  const controller = LocalSkillsPanel.createLocalSkillsPanelController({
    document,
    getPanel: () => panel,
    getState: () => state,
    setState: nextState => {
      state = nextState;
    },
    getCurrentProjectId: () => 'project-1',
    getSkillLoadingSettings: () => ({ loadCodexOverleafSkills: true }),
    tr: key => labels[key] || key,
    sendBackgroundNative() {
      return Promise.resolve({
        ok: true,
        result: {
          skills: [
            {
              id: 'annotated-rewrite',
              title: 'Annotated Rewrite',
              scope: 'codex-overleaf',
              official: true,
              removable: false
            },
            {
              id: 'custom-style',
              title: 'Custom Style',
              scope: 'codex-overleaf',
              official: false,
              removable: true
            }
          ]
        }
      });
    },
    setSlashCodexOverleafSkills() {}
  });

  await controller.refreshLocalSkills();

  const rows = collectElements(
    list,
    node => node.className === 'codex-local-skill-row'
  );
  const officialRow = rows.find(row =>
    collectElementText(row).includes('annotated-rewrite')
  );
  const customRow = rows.find(row =>
    collectElementText(row).includes('custom-style')
  );

  assert.ok(officialRow, 'official skill row should be present');
  assert.equal(
    collectElements(officialRow, node => node.tagName === 'BUTTON').length,
    0,
    'official skill should not have a remove button'
  );
  assert.ok(customRow, 'custom skill row should be present');
  assert.ok(
    collectElements(customRow, node => node.tagName === 'BUTTON').length > 0,
    'custom skill should have a remove button'
  );
});

test('composer slash menu offers Codex Overleaf skill installation and installed skills', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );
  const i18n = fs.readFileSync(
    path.join(__dirname, '../extension/src/shared/i18n.js'),
    'utf8'
  );
  const composerPanel = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/composerPanel.js'),
    'utf8'
  );
  const composerSource = `${contentScript}\n${composerPanel}`;
  const keydownBody = contentScript.match(/function handleTaskInputKeydown\(event\) \{[\s\S]*?\n  function createDiffReviewElement/)?.[0] || '';
  const selectBody = extractFunction(contentScript, 'selectSlashCommand');
  const runTaskBody = contentScript.match(/async function runTask\(\) \{[\s\S]*?\n  async function preflightWriteSafety/)?.[0] || '';

  assert.match(composerSource, /data-slash-menu/);
  assert.match(composerSource, /data-slash-command="install-skill"/);
  assert.match(composerSource, /data-slash-command-kind/);
  assert.match(contentScript, /scope:\s*'codex-overleaf'/);
  assert.match(composerSource, /data-composer-skill-context/);
  assert.match(composerSource, /data-composer-skill-label/);
  assert.match(composerSource, /data-composer-skill-clear/);
  assert.match(keydownBody, /handleSlashMenuKeydown\(event\)/);
  assert.match(contentScript, /function updateSlashMenuForTaskInput/);
  assert.match(contentScript, /function refreshCodexOverleafSkillsForSlashMenu/);
  assert.match(contentScript, /function selectSlashCommand/);
  assert.match(contentScript, /function activateSkillInstallerComposerContext/);
  assert.match(contentScript, /function activateCodexOverleafSkillComposerContext/);
  assert.match(contentScript, /function getComposerSkillInvocationForRun/);
  assert.match(contentScript, /async function runSkillInstallerTask/);
  assert.match(selectBody, /activateSkillInstallerComposerContext\(\)/);
  assert.match(selectBody, /activateCodexOverleafSkillComposerContext/);
  assert.match(runTaskBody, /const submittedSkillInvocation = getComposerSkillInvocationForRun\(\)/);
  assert.match(runTaskBody, /submittedSkillInvocation\?\.id === 'skill-installer'[\s\S]*runSkillInstallerTask/);
  assert.match(runTaskBody, /try\s*\{\s*if \(submittedSkillInvocation\?\.id === 'skill-installer'\)[\s\S]*runSkillInstallerTask/);
  assert.match(runTaskBody, /finally\s*\{[\s\S]*setRunning\(false\)[\s\S]*nativeChannel\.clearActiveRequest\(\)/);
  assert.match(runTaskBody, /skillInvocation:\s*submittedSkillInvocation/);
  assert.match(contentScript, /skipMirrorSync:\s*true/);
  assert.doesNotMatch(contentScript, /function showCodexOverleafSkillInstallDialog/);
  assert.match(css, /\.codex-slash-menu/);
  assert.match(css, /\.codex-composer-skill-context/);
  assert.doesNotMatch(css, /\.codex-skill-install-dialog/);
  assert.match(i18n, /slashInstallSkillTitle/);
  assert.match(i18n, /slashUseSkillSubtitle/);
  assert.match(i18n, /skillInstallerComposerLabel/);
  assert.match(i18n, /skillInstallerComposerClear/);
});

test('task runs use sensitive preflight, skill toggles, governance gating, binary confirmation, and audit summaries', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const runTaskBody = contentScript.match(/async function runTask\(\) \{[\s\S]*?\n  async function preflightWriteSafety/)?.[0] || '';
  const applyBody = contentScript.match(/async function applySyncChangesToOverleaf[\s\S]*?\n  async function verifyPostWriteSaveState/)?.[0] || '';

  assert.match(contentScript, /CodexOverleafGovernanceRules/);
  assert.match(contentScript, /CodexOverleafSensitiveScan/);
  assert.match(contentScript, /CodexOverleafAuditRecords/);
  assert.doesNotMatch(runTaskBody, /submittedSelectedSkillIds/);
  assert.match(runTaskBody, /const submittedSkillLoadingSettings = getSkillLoadingSettings\(\)/);
  assert.match(runTaskBody, /createAuditDraftForRun/);
  assert.match(runTaskBody, /runSensitivePreflight\(\{\s*task,\s*project/);
  assert.match(runTaskBody, /runSensitivePreflight\(\{[\s\S]*useExistingMirror/);
  assert.doesNotMatch(runTaskBody, /selectedSkillIds:\s*submittedSelectedSkillIds/);
  assert.match(runTaskBody, /skillLoadingSettings:\s*submittedSkillLoadingSettings/);
  assert.match(runTaskBody, /finalizeAuditRecord/);
  assert.match(runTaskBody, /sensitiveFindings/);
  assert.match(applyBody, /evaluateGovernedOperations/);
  assert.match(applyBody, /buildGovernanceSkippedApplyResult/);
  assert.match(applyBody, /confirmBinaryOperations/);
  assert.match(applyBody, /binary-create|overwrite-binary/);
  assert.match(applyBody, /blockedFiles/);
  assert.match(applyBody, /skippedFiles/);
  assert.match(applyBody, /appliedFiles/);
  assert.match(contentScript, /buildAuditDiffSummary/);
  assert.doesNotMatch(contentScript, /fullDiff\s*:/);
  assert.doesNotMatch(contentScript, /compileLog\s*:/);
});

test('composer supports pasted or dropped turn attachments without Overleaf asset writeback', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const attachmentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/composerAttachments.js'),
    'utf8'
  );
  const composerPanel = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/composerPanel.js'),
    'utf8'
  );
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../extension/manifest.json'), 'utf8'));
  const runTaskBody = contentScript.match(/async function runTask\(\) \{[\s\S]*?\n  async function preflightWriteSafety/)?.[0] || '';
  const clearBody = extractFunction(contentScript, 'clearTaskComposer');
  const scriptOrder = manifest.content_scripts[0].js;

  assert.match(composerPanel, /data-attachment-strip/);
  assert.ok(
    scriptOrder.indexOf('src/content/composerAttachments.js') < scriptOrder.indexOf('src/contentScript.js'),
    'composer attachment controller loads before contentScript'
  );
  assert.match(composerPanel, /'paste'/);
  assert.match(composerPanel, /'dragover'/);
  assert.match(composerPanel, /'drop'/);
  assert.match(contentScript, /onPaste:\s*handleComposerPaste/);
  assert.match(contentScript, /onDragOver:\s*handleComposerDragOver/);
  assert.match(contentScript, /onDrop:\s*handleComposerDrop/);
  assert.match(attachmentScript, /createComposerAttachmentController/);
  assert.match(contentScript, /function addComposerAttachmentFiles/);
  assert.match(contentScript, /function renderComposerAttachments/);
  assert.match(runTaskBody, /const submittedAttachments = getComposerAttachmentsForRun\(\)/);
  assert.match(runTaskBody, /attachments:\s*submittedAttachments/);
  assert.match(clearBody, /composerAttachmentController\.clear\(\)/);
  assert.doesNotMatch(contentScript, /User-selected asset upload/);
  assert.doesNotMatch(contentScript, /asset_upload_rejected/);
  assert.doesNotMatch(contentScript, /mode:\s*'asset-upload'/);
});

test('composer paste collects clipboard file items once when files and items both expose the same paste', () => {
  const attachmentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/composerAttachments.js'),
    'utf8'
  );
  const collectFilesFromDataTransfer = vm.runInNewContext(`
    ${extractFunction(attachmentScript, 'normalizeAttachmentName')}
    (${extractFunction(attachmentScript, 'collectFilesFromDataTransfer')})
  `);
  const filesEntry = { name: 'image.png', type: 'image/png', size: 128, lastModified: 1 };
  const itemEntry = { name: 'clipboard-image.png', type: 'image/png', size: 128, lastModified: 2 };

  const files = collectFilesFromDataTransfer({
    files: [filesEntry],
    items: [
      { kind: 'string', getAsFile: () => null },
      { kind: 'file', getAsFile: () => itemEntry }
    ]
  });

  assert.equal(files.length, 1);
  assert.equal(files[0], itemEntry);
});

test('composer attachment adds dedupe the same file while async reads are pending', async () => {
  const attachmentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/composerAttachments.js'),
    'utf8'
  );
  const sandbox = {
    window: {},
    document: {},
    console,
    setTimeout,
    clearTimeout
  };
  const pendingReads = [];
  sandbox.FileReader = class FakeFileReader {
    readAsDataURL() {
      pendingReads.push(() => {
        this.result = 'data:image/png;base64,aGVsbG8=';
        this.onload?.();
      });
    }
  };
  vm.runInNewContext(attachmentScript, sandbox);
  const controller = sandbox.window.CodexOverleafComposerAttachments.createComposerAttachmentController({
    getPanel: () => ({ querySelector: () => null }),
    tx: (en) => en,
    tr: (key) => key,
    appendPlainLog() {}
  });
  const file = { name: 'image.png', type: 'image/png', size: 128 };

  const first = controller.addFiles([file]);
  const second = controller.addFiles([file]);
  for (const resolve of pendingReads.splice(0)) {
    resolve();
  }
  await Promise.all([first, second]);

  assert.equal(controller.getAttachmentsForRun().length, 1);
});

test('composer and run history render image previews and file attachment icons', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const attachmentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/composerAttachments.js'),
    'utf8'
  );
  const composerPanel = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/composerPanel.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );
  const composerMarkup = composerPanel.match(/<form class="codex-composer" data-composer-form>[\s\S]*?<\/form>/)?.[0] || '';
  const startRunBody = contentScript.match(/function startRunView\(\{[\s\S]*?\n  function finishRunView/)?.[0] || '';
  const renderCardBody = contentScript.match(/function renderRunCard\(run\) \{[\s\S]*?\n  function getRunStatusText/)?.[0] || '';
  const renderAttachmentsBody = attachmentScript.match(/function renderAttachmentPreviewList[\s\S]*?\n  function showAttachmentPreviewDialog/)?.[0] || '';

  assert.ok(
    composerMarkup.indexOf('data-attachment-strip') < composerMarkup.indexOf('<textarea data-task'),
    'attachment previews render above the composer textarea'
  );
  assert.match(attachmentScript, /function buildAttachmentPreviewData/);
  assert.match(contentScript, /function createRunAttachmentSnapshots/);
  assert.match(startRunBody, /attachments = \[\]/);
  assert.match(startRunBody, /attachments:\s*createRunAttachmentSnapshots\(attachments\)/);
  assert.match(renderCardBody, /data-run-attachments/);
  assert.match(renderCardBody, /renderAttachmentPreviewList\(run\.attachments/);
  assert.match(renderAttachmentsBody, /document\.createElement\('img'\)/);
  assert.match(renderAttachmentsBody, /codex-attachment-file-icon/);
  assert.match(renderAttachmentsBody, /showAttachmentPreviewDialog\(attachment/);
  assert.match(attachmentScript, /function showAttachmentPreviewDialog\(attachment/);
  assert.match(attachmentScript, /data-attachment-preview-dialog/);
  assert.match(css, /\.codex-attachment-preview-list/);
  assert.match(css, /\.codex-attachment-preview-card/);
  assert.match(css, /\.codex-attachment-preview-dialog/);
});

test('reused mirror sensitive preflight scans native mirror before Codex dispatch', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const preflightBody = extractFunction(contentScript, 'runSensitivePreflight');

  assert.match(preflightBody, /useExistingMirror/);
  assert.match(preflightBody, /scanNativeMirrorSensitiveFindings/);
  assert.doesNotMatch(preflightBody, /sensitiveCheckEnabled === false \|\| !SensitiveScan/);
  assert.match(contentScript, /method:\s*'mirror\.scanSensitive'/);
  assert.match(contentScript, /mirror-sensitive-scan-unavailable/);
});

test('post-write compile summaries are included in the final completion report', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const applyBody = contentScript.match(/async function applySyncChangesToOverleaf[\s\S]*?\n  async function verifyPostWriteSaveState/)?.[0] || '';
  const compileBody = contentScript.match(/async function autoRecompileAfterWriteback[\s\S]*?\n  async function resolveCompileLogContext/)?.[0] || '';

  assert.match(applyBody, /const compileSummary = appliedPaths\.length/);
  assert.match(applyBody, /appendCompileSummaryToConclusion\(writebackConclusion,\s*compileSummary\)/);
  assert.match(compileBody, /return buildPostWriteCompileSummary/);
  assert.match(compileBody, /callPageBridge\('getCompileLog'/);
  assert.match(contentScript, /function appendCompileSummaryToConclusion/);
});

test('task run snapshots request binary assets so local LaTeX can see Figures directories', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const getRunProjectSnapshotBody = contentScript.match(/async function getRunProjectSnapshot\(\) \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.match(getRunProjectSnapshotBody, /includeBinaryFiles:\s*true/);
  assert.match(getRunProjectSnapshotBody, /zipOnly:\s*true/);
  assert.match(contentScript, /资源文件/);
});

test('task run snapshots bypass cache so Codex sees the latest Overleaf state', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const getRunProjectSnapshotBody = contentScript.match(/async function getRunProjectSnapshot\(\) \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.match(getRunProjectSnapshotBody, /force:\s*true/);
  assert.match(getRunProjectSnapshotBody, /maxAgeMs:\s*0/);
});

test('whole-project ZIP sync waits long enough before falling back to focused files', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const getRunProjectSnapshotBody = contentScript.match(/async function getRunProjectSnapshot\(\) \{[\s\S]*?\n  \}/)?.[0] || '';
  const timeoutBody = contentScript.match(/function getPageBridgeTimeoutMs\(method\) \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.match(contentScript, /const RUN_SNAPSHOT_ZIP_TIMEOUT_MS\s*=\s*30000/);
  assert.match(contentScript, /const SNAPSHOT_PAGE_BRIDGE_TIMEOUT_MS\s*=\s*70000/);
  assert.match(getRunProjectSnapshotBody, /zipTimeoutMs:\s*RUN_SNAPSHOT_ZIP_TIMEOUT_MS/);
  assert.match(timeoutBody, /return SNAPSHOT_PAGE_BRIDGE_TIMEOUT_MS/);
});

test('task run blocks unfocused partial project snapshots before they can rewrite the local mirror', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const warningsBody = contentScript.match(/function getProjectSnapshotWarnings\(project\) \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.match(warningsBody, /fullProjectSnapshot/);
  assert.match(contentScript, /没有读到完整的 Overleaf 项目/);
  assert.match(contentScript, /snapshotWarnings\.blocking\.length && !warmMirrorReuse\.useExistingMirror && !focusedPartialSnapshot/);
  assert.match(contentScript, /只读到你选择的上下文文件/);
});

test('fresh warm mirror can carry a run when Overleaf only returns a partial snapshot', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const i18n = fs.readFileSync(
    path.join(__dirname, '../extension/src/shared/i18n.js'),
    'utf8'
  );

  assert.match(contentScript, /async function resolveWarmMirrorReuse/);
  assert.match(contentScript, /Full project snapshot was not captured/);
  assert.match(contentScript, /classifyMirrorHealth\(mirrorStatus\)/);
  assert.match(contentScript, /mirrorHealth\.reusable/);
  assert.match(contentScript, /tr\('warmMirrorPartialOverlayTitle'\)/);
  assert.match(i18n, /没有读到完整 Overleaf 项目，但本地 workspace 刚同步过/);
  assert.match(contentScript, /mergeProjectWithSyncChangeBaseFiles\(project,\s*syncChanges\)/);
});

test('successful Overleaf writeback refreshes page snapshot cache and native mirror baseline', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const applyBody = contentScript.match(/async function applySyncChangesToOverleaf[\s\S]*?\n  function buildSyncApplyOperations/)?.[0] || '';

  assert.match(applyBody, /refreshProjectMirrorAfterWriteback\(project, applied, saveVerification\)/);
  assert.match(contentScript, /invalidateProjectSnapshot/);
  assert.match(contentScript, /method:\s*'mirror\.sync'/);
});

test('post-write side effects wait for verified Overleaf save state', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const applyBody = contentScript.match(/async function applySyncChangesToOverleaf[\s\S]*?\n  function buildSyncApplyOperations/)?.[0] || '';
  const verifyBody = contentScript.match(/async function verifyPostWriteSaveState[\s\S]*?\n  async function refreshProjectMirrorAfterWriteback/)?.[0] || '';

  const applyIndex = applyBody.indexOf("await callPageBridge('applyOperations'");
  const verifyIndex = applyBody.indexOf('verifyPostWriteSaveState()');
  const refreshIndex = applyBody.indexOf('refreshProjectMirrorAfterWriteback(project, applied, saveVerification)');
  const recompileIndex = applyBody.indexOf('autoRecompileAfterWriteback(appliedPaths, saveVerification)');

  assert.ok(applyIndex >= 0, 'applyOperations call is present');
  assert.ok(verifyIndex > applyIndex, 'save verification happens after applyOperations');
  assert.ok(refreshIndex > verifyIndex, 'mirror refresh happens after save verification');
  assert.ok(recompileIndex > verifyIndex, 'auto compile happens after save verification');
  assert.match(verifyBody, /callPageBridge\('waitForSaveState', \{\s*deadlineMs:\s*5000,\s*requirePositiveSignal:\s*true\s*\}\)/);
  assert.match(verifyBody, /state:\s*'verified_saved'/);
  assert.match(verifyBody, /state:\s*'unknown_timeout'/);
  assert.match(verifyBody, /state:\s*'unavailable'/);
  assert.match(applyBody, /appendPostWriteSaveVerificationWarning\(saveVerification\)/);
});

test('empty or malformed apply results do not trigger save verification', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const applyBody = contentScript.match(/async function applySyncChangesToOverleaf[\s\S]*?\n  function buildSyncApplyOperations/)?.[0] || '';
  const helperBody = contentScript.match(/function hasApplyResultEntries\(applied = \{\}\) \{[\s\S]*?\n  \}/)?.[0] || '';
  const appliedHelperBody = contentScript.match(/function getAppliedEntries\(applied = \{\}\) \{[\s\S]*?\n  \}/)?.[0] || '';
  const skippedHelperBody = contentScript.match(/function getSkippedEntries\(applied = \{\}\) \{[\s\S]*?\n  \}/)?.[0] || '';
  const hasApplyResultEntries = Function(`${appliedHelperBody}\n${skippedHelperBody}\nreturn (${helperBody});`)();

  assert.match(contentScript, /function hasApplyResultEntries\(applied = \{\}\)/);
  assert.match(contentScript, /function getAppliedEntries\(applied = \{\}\)/);
  assert.match(helperBody, /getAppliedEntries\(applied\)/);
  assert.match(helperBody, /getSkippedEntries\(applied\)/);
  assert.match(appliedHelperBody, /Array\.isArray\(applied\?\.applied\)/);
  assert.match(skippedHelperBody, /Array\.isArray\(applied\?\.skipped\)/);
  assert.equal(hasApplyResultEntries({ applied: 'x' }), false);
  assert.equal(hasApplyResultEntries({ skipped: { length: 1 } }), false);
  assert.equal(hasApplyResultEntries({ applied: [], skipped: [] }), false);
  assert.equal(hasApplyResultEntries({ applied: [{}] }), true);
  assert.equal(hasApplyResultEntries({ skipped: [{}] }), true);
  assert.match(applyBody, /const hasConfirmedApplyResult = hasApplyResultEntries\(applied\)/);
  assert.match(applyBody, /const saveVerification = hasConfirmedApplyResult\s*\?[\s\S]*?verifyPostWriteSaveState\(\)[\s\S]*?:/);
  assert.match(applyBody, /if \(hasConfirmedApplyResult\) \{[\s\S]*?appendPostWriteSaveVerificationWarning\(saveVerification\)/);
});

test('malformed skipped apply result entries are not treated as partial writeback', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const applyBody = contentScript.match(/async function applySyncChangesToOverleaf[\s\S]*?\n  async function verifyPostWriteSaveState/)?.[0] || '';
  const applyTaskBody = contentScript.match(/async function applyTaskOperations[\s\S]*?\n  async function ensureReviewingBeforeWrite/)?.[0] || '';
  const recordUndoBody = contentScript.match(/function recordUndoFromApply\(project, applyResult\) \{[\s\S]*?\n  function normalizeApplyTrackedChanges/)?.[0] || '';
  const helperBody = contentScript.match(/function getSkippedEntries\(applied = \{\}\) \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.match(contentScript, /function getSkippedEntries\(applied = \{\}\)/);
  const getSkippedEntries = Function(`return (${helperBody});`)();
  assert.match(helperBody, /Array\.isArray\(applied\?\.skipped\)/);
  assert.deepEqual(getSkippedEntries({ skipped: 'x' }), []);
  assert.deepEqual(getSkippedEntries({ skipped: { length: 1 } }), []);
  assert.deepEqual(getSkippedEntries({ skipped: [{}] }), [{}]);
  assert.match(applyBody, /const skippedEntries = getSkippedEntries\(applied\)/);
  assert.doesNotMatch(applyBody, /applied\?\.skipped\?\.length|applied\.skipped\?\.length/);
  assert.match(recordUndoBody, /const skippedEntries = getSkippedEntries\(applyResult\)/);
  assert.doesNotMatch(recordUndoBody, /applyResult\.skipped\?\.length/);
  assert.match(applyTaskBody, /\.\.\.getSkippedEntries\(applied\)/);
  assert.doesNotMatch(applyTaskBody, /\.\.\.\(applied\.skipped \|\| \[\]\)/);
});

test('post-write mirror refresh waits for verified save but auto compile still delegates to compile bridge', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const refreshBody = contentScript.match(/async function refreshProjectMirrorAfterWriteback[\s\S]*?\n  function getAppliedOperationPaths/)?.[0] || '';
  const autoCompileBody = contentScript.match(/async function autoRecompileAfterWriteback[\s\S]*?\n  async function resolveCompileLogContext/)?.[0] || '';
  const saveWarningBody = contentScript.match(/function appendPostWriteSaveVerificationWarning[\s\S]*?\n  async function refreshProjectMirrorAfterWriteback/)?.[0] || '';

  assert.match(refreshBody, /async function refreshProjectMirrorAfterWriteback\(project = \{\}, applied = \{\}, saveVerification = \{\}\)/);
  assert.match(autoCompileBody, /async function autoRecompileAfterWriteback\(writtenPaths = \[\], saveVerification = \{\}\)/);
  assert.match(refreshBody, /saveVerification\?\.state !== 'verified_saved'[\s\S]*?return;/);
  assert.doesNotMatch(autoCompileBody, /saveVerification\?\.state !== 'verified_saved'[\s\S]*?return;/);
  assert.ok(
    refreshBody.indexOf("saveVerification?.state !== 'verified_saved'") < refreshBody.indexOf("callPageBridge('invalidateProjectSnapshot'"),
    'mirror refresh checks verified save before invalidating snapshot cache'
  );
  assert.ok(
    refreshBody.indexOf("saveVerification?.state !== 'verified_saved'") < refreshBody.indexOf("callPageBridge('getProjectSnapshot'"),
    'mirror refresh checks verified save before fetching a fresh snapshot'
  );
  assert.ok(
    refreshBody.indexOf("saveVerification?.state !== 'verified_saved'") < refreshBody.indexOf("method: 'mirror.sync'"),
    'mirror refresh checks verified save before syncing native mirror'
  );
  assert.match(autoCompileBody, /callPageBridge\('triggerCompile', \{[\s\S]*requireVerifiedSave:\s*saveVerification\?\.state === 'verified_saved'/);
  assert.match(autoCompileBody, /saveVerification\?\.state !== 'verified_saved'[\s\S]*Overleaf save was not verified, but Auto Compile is on/);
  assert.doesNotMatch(saveWarningBody, /auto compile (?:was|were) skipped/);
});

test('no-change writeback path does not wait for Overleaf save verification', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  ).replace(/\r\n/g, '\n');
  const applyBody = contentScript.match(/async function applySyncChangesToOverleaf[\s\S]*?\n  function buildSyncApplyOperations/)?.[0] || '';
  const noChangeBlock = applyBody.match(/if \(!operations\.length\) \{[\s\S]*?return \{[\s\S]*?\n      \};\n    \}/)?.[0] || '';

  assert.doesNotMatch(noChangeBlock, /verifyPostWriteSaveState/);
  assert.ok(
    noChangeBlock.length && applyBody.indexOf(noChangeBlock) < applyBody.indexOf('verifyPostWriteSaveState'),
    'no-change path returns before save verification'
  );
});

test('post-write mirror refresh refuses partial snapshots before touching native baseline', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const refreshBody = contentScript.match(/async function refreshProjectMirrorAfterWriteback[\s\S]*?\n  function mergeVerifiedAppliedFiles/)?.[0] || '';

  assert.match(refreshBody, /capabilities\?\.fullProjectSnapshot/);
  assert.match(refreshBody, /没有读到完整项目/);
  assert.match(refreshBody, /return;\s*\}\s*\n\s*const syncedProject/);
});

test('idle background sync does not poll or touch the Overleaf editor', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const initBody = contentScript.match(/async function init\(\) \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.doesNotMatch(initBody, /initWarmMirror/);
  assert.doesNotMatch(initBody, /scheduleProjectSync/);
  assert.doesNotMatch(initBody, /mirror\.sync/);
  assert.doesNotMatch(contentScript, /setInterval\(\(\) => \{[\s\S]*syncMirrorBackground/);
  assert.doesNotMatch(contentScript, /function scheduleProjectSync/);
  assert.doesNotMatch(initBody, /scheduleProbeRefresh/);
  assert.doesNotMatch(initBody, /installInteractionRefresh/);
});

test('mirror prefetch is non-invasive and never enables editor navigation', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const prefetchBody = contentScript.match(/async function syncMirrorPrefetch[\s\S]*?\n  function/)?.[0] || '';

  assert.match(prefetchBody, /allowEditorNavigation:\s*false/);
  assert.match(prefetchBody, /requireFullProject:\s*true/);
  assert.doesNotMatch(prefetchBody, /openFileByPath/);
});

test('warm send checks mirror status before full project snapshot fallback', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const runTaskBody = contentScript.match(/async function runTask\(\) \{[\s\S]*?\n  async function preflightWriteSafety/)?.[0] || '';

  assert.match(runTaskBody, /resolveWarmRunStart/);
  assert.ok(runTaskBody.indexOf('resolveWarmRunStart') < runTaskBody.indexOf('getRunProjectSnapshot'));
});

test('send waits for in-flight mirror prefetch before starting codex run', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const runTaskBody = contentScript.match(/async function runTask\(\) \{[\s\S]*?\n  async function preflightWriteSafety/)?.[0] || '';
  const helperBody = contentScript.match(/async function settleMirrorPrefetchBeforeRun\(\) \{[\s\S]*?\n  function/)?.[0] || '';

  assert.match(runTaskBody, /await settleMirrorPrefetchBeforeRun\(\)/);
  assert.ok(runTaskBody.indexOf('await settleMirrorPrefetchBeforeRun()') < runTaskBody.indexOf("method: 'codex.run'"));
  assert.match(helperBody, /mirrorPrefetchState\.timer/);
  assert.match(helperBody, /window\.clearTimeout\(mirrorPrefetchState\.timer\)/);
  assert.match(helperBody, /mirrorPrefetchState\.inFlight/);
  assert.match(helperBody, /await mirrorPrefetchState\.inFlight/);
  assert.match(helperBody, /isExpectedPrefetchSkip/);
});

test('warm send verifies a non-invasive current or focus overlay before reusing mirror', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const warmStartBody = contentScript.match(/async function resolveWarmRunStart[\s\S]*?\n  async function prepareMirrorStaleRetry/)?.[0] || '';

  assert.match(warmStartBody, /callPageBridge\('getProjectSnapshot'/);
  assert.match(warmStartBody, /allowEditorNavigation:\s*false/);
  assert.match(warmStartBody, /allowZipFallback:\s*false/);
  assert.match(warmStartBody, /restrictToRequestedPathsOnly:\s*true/);
  assert.match(warmStartBody, /buildSnapshotFileOverlays/);
  assert.match(warmStartBody, /catch \(error\)[\s\S]*useExistingMirror:\s*false/);
  assert.doesNotMatch(warmStartBody, /fileOverlays:\s*\[\]/);
  assert.doesNotMatch(warmStartBody, /fullProjectSnapshot:\s*true[\s\S]*method:\s*'warm-mirror'/);
});

test('focused OT freshness is checked before project-level warm mirror freshness', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const otWarmMirrorController = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/otWarmMirrorController.js'),
    'utf8'
  );
  const warmStartBody = contentScript.match(/async function resolveWarmRunStart[\s\S]*?\n  async function prepareMirrorStaleRetry/)?.[0] || '';

  assert.match(warmStartBody, /otWarmMirrorController\.canUseOtWarmStart/);
  assert.ok(
    warmStartBody.indexOf('canUseOtWarmStart') < warmStartBody.indexOf('isMirrorReusable'),
    'OT per-file freshness must be considered before project-level freshness rejects the mirror'
  );
  assert.match(warmStartBody, /enabled:\s*isExperimentalOtEnabled\(\)/);
  assert.match(warmStartBody, /focusFiles/);
  assert.match(warmStartBody, /otWarmStart:\s*true/);
  assert.match(warmStartBody, /reason:\s*'ot_focus_fresh'/);
  assert.match(warmStartBody, /fullProjectSnapshot:\s*false/);
  assert.match(warmStartBody, /method:\s*'ot-warm-mirror'/);
  assert.match(otWarmMirrorController, /reason:\s*'no_focus_files'/);
  assert.doesNotMatch(warmStartBody, /otFreshFileCount/);
});

test('OT warm starts force focused run params for initial and thread-resume codex runs', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const runTaskBody = contentScript.match(/async function runTask\(\) \{[\s\S]*?\n  function buildCodexRunParams/)?.[0] || '';
  const runParamBlocks = Array.from(runTaskBody.matchAll(/buildCodexRunParams\(\{[\s\S]*?submittedMode\s*\}/g))
    .map(match => match[0]);

  assert.match(runTaskBody, /if \(warmMirrorReuse\.otWarmStart\) \{[\s\S]*restrictToFocusFiles\s*=\s*true/);
  assert.ok(runParamBlocks.length >= 3, 'initial, mirror-stale retry, and thread-resume run params should be visible');
  for (const block of runParamBlocks) {
    assert.match(block, /otWarmStart/);
    assert.match(block, /restrictToFocusFiles/);
  }
});

test('experimental OT warm mirror polls page OT events and patches the native mirror', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const pollBody = extractFunction(contentScript, 'pollOtEvents');
  const flushBody = extractFunction(contentScript, 'flushOtPatchBatch');

  assert.match(contentScript, /CodexOverleafOtWarmMirrorController/);
  assert.match(contentScript, /function scheduleOtEventPolling/);
  assert.match(contentScript, /function clearOtEventPolling/);
  assert.match(pollBody, /otWarmMirrorController\.shouldPauseOtWarmMirror\(\{\s*running:\s*Boolean\(currentRunView\)\s*\}\)/);
  assert.match(pollBody, /callPageBridge\('getOtStatus'/);
  assert.match(pollBody, /callPageBridge\('drainOtEvents'/);
  assert.match(pollBody, /queueOtPatchEvents/);
  assert.match(flushBody, /otWarmMirrorController\.buildPatchFilesRequest/);
  assert.match(flushBody, /method:\s*'mirror\.patchFiles'/);
  assert.match(flushBody, /sendBackgroundNative\(request\)/);
  assert.match(contentScript, /flushOtPatchBatch/);
});

test('invalid native OT patch results mark the warm mirror inconsistent using skippedFiles fields', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const flushBody = extractFunction(contentScript, 'flushOtPatchBatch');

  assert.match(flushBody, /skippedFiles/);
  assert.match(flushBody, /skippedCount/);
  assert.match(flushBody, /updateOtStatusDisplay\('inconsistent'\)/);
  assert.doesNotMatch(flushBody, /result\?\.skipped\b|result\.skipped\b/);
});

test('native OT patch success requires valid appliedCount and appliedFiles evidence', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const flushBody = extractFunction(contentScript, 'flushOtPatchBatch');

  assert.match(flushBody, /appliedFiles/);
  assert.match(flushBody, /appliedCount/);
  assert.match(flushBody, /Array\.isArray\(result\?\.appliedFiles\)/);
  assert.match(flushBody, /Number\.isFinite\(Number\(result\?\.appliedCount\)\)/);
  assert.match(flushBody, /appliedCount <= 0/);
  assert.match(flushBody, /appliedFiles\.length !== appliedCount/);
  const invalidResultIndex = flushBody.indexOf("otWarmMirrorState.lastErrorCode = 'mirror_patch_invalid_result'");
  const inconsistentIndex = flushBody.indexOf("updateOtStatusDisplay('inconsistent')", invalidResultIndex);
  const observingIndex = flushBody.indexOf("updateOtStatusDisplay('observing')");

  assert.ok(invalidResultIndex >= 0, 'invalid applied evidence sets a native patch result error code');
  assert.ok(inconsistentIndex > invalidResultIndex, 'invalid applied evidence marks OT status inconsistent');
  assert.ok(
    observingIndex > inconsistentIndex,
    'invalid applied evidence is handled before the successful observing status'
  );
});

test('warm mirror overlays preserve active file alongside focused files', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const helperBody = contentScript.match(/function buildSnapshotFileOverlays\(project = \{\}, focusFiles = \[\], options = \{\}\) \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.match(helperBody, /activePath/);
  assert.match(helperBody, /focusSet\.has/);
  assert.match(helperBody, /normalizedPath === activePath/);
  assert.doesNotMatch(helperBody, /focusFiles\.length\s*\?\s*textFiles\.filter\(file => focusSet\.has/);
});

test('ask mode is not blocked by write-safety preconditions', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const runTaskBody = contentScript.match(/async function runTask\(\) \{[\s\S]*?\n  async function handleTaskResult/)?.[0] || '';
  const codexSessionRunner = fs.readFileSync(
    path.join(__dirname, '../native-host/src/codexSessionRunner.js'),
    'utf8'
  );

  assert.doesNotMatch(runTaskBody, /state\.mode !== 'ask' && state\.requireReviewing/);
  assert.match(runTaskBody, /const submittedMode = state\.mode/);
  assert.match(runTaskBody, /mode:\s*submittedMode/);
  assert.match(codexSessionRunner, /params\.mode === 'ask'/);
  assert.match(codexSessionRunner, /sandboxMode: 'read-only'/);
  assert.match(codexSessionRunner, /approvalPolicy: 'never'/);
});

test('ask mode ignores unexpected local Codex writeback changes without failing the answer', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const applySyncBody = contentScript.match(/async function applySyncChangesToOverleaf[\s\S]*?\n  async function verifyPostWriteSaveState/)?.[0] || '';
  const guardEnd = applySyncBody.indexOf('let operations = buildSyncApplyOperations');
  const guardBody = guardEnd > -1 ? applySyncBody.slice(0, guardEnd) : applySyncBody;

  assert.match(applySyncBody, /const runMode = options\.mode \|\| state\.mode/);
  assert.match(applySyncBody, /options\.mode === 'ask'/);
  assert.match(applySyncBody, /Ask mode ignored local file changes/);
  assert.match(contentScript, /mode:\s*submittedMode/);
  assert.match(contentScript, /resolveWarmMirrorReuse\(project,[\s\S]*mode:\s*submittedMode/);
  assert.doesNotMatch(contentScript, /mode:\s*state\.mode,[\s\S]*unsupportedChanges: response\.result\.unsupportedChanges/);
  assert.ok(applySyncBody.indexOf("options.mode === 'ask'") < applySyncBody.indexOf('buildSyncApplyOperations'));
  assert.match(guardBody, /return \{/);
  assert.match(guardBody, /hasSkippedOperations:\s*false/);
  assert.match(guardBody, /resultStatus:\s*'ask_ignored_local_changes'/);
  assert.doesNotMatch(guardBody, /status:\s*'failed'/);
  assert.doesNotMatch(guardBody, /callPageBridge\('applyOperations'/);
});

test('composer clears the submitted task as soon as Codex accepts the run', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const runTaskBody = contentScript.match(/async function runTask\(\) \{[\s\S]*?\n  async function handleTaskResult/)?.[0] || '';

  assert.match(runTaskBody, /currentRunView = startRunView\(/);
  assert.match(runTaskBody, /clearTaskComposer\(\)/);
  assert.match(contentScript, /function clearTaskComposer\(/);
  assert.match(contentScript, /taskInput\.value = ''/);
  assert.match(contentScript, /task: ''/);
});

test('deleting a UI session also clears plugin-isolated Codex history', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const deleteBody = contentScript.match(/async function deleteSessionWithConfirm\(sessionId\) \{[\s\S]*?\n  function setRunning/)?.[0] || '';

  assert.match(deleteBody, /codex\.history\.clearPlugin/);
  assert.match(deleteBody, /threadId:\s*target\.codexThreadId/);
  assert.match(deleteBody, /deleteSessionMessage/);
  assert.doesNotMatch(deleteBody, /清理插件隔离的本地 Codex 历史/);
  assert.doesNotMatch(deleteBody, /This deletes local session history/);
});

test('session deletion status uses plugin toast instead of task transcript space', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const panelRenderer = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/panelRenderer.js'),
    'utf8'
  );
  const sessionPanel = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/sessionPanel.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );
  const contentSurface = `${contentScript}\n${sessionPanel}\n${panelRenderer}`;
  const deleteBody = contentScript.match(/async function deleteSessionWithConfirm\(sessionId\) \{[\s\S]*?\n  function setRunning/)?.[0] || '';
  const plainLogBody = contentScript.match(/function appendPlainLog\(text\) \{[\s\S]*?\n  function updateProbeNotice/)?.[0] || '';
  const toastCss = css.match(/#codex-overleaf-panel \.codex-toast-region \{[\s\S]*?\n\}/)?.[0] || '';
  const taskSectionIndex = contentSurface.indexOf('<section class="codex-task-section">');
  const toastRegionIndex = contentSurface.indexOf('<div class="codex-toast-region" data-toast-region');
  const threadSectionIndex = contentSurface.indexOf('<section class="codex-thread-section">');

  assert.match(contentSurface, /data-toast-region/);
  assert.match(contentScript, /function showPluginToast\(/);
  assert.ok(taskSectionIndex >= 0, 'task section exists');
  assert.ok(toastRegionIndex > taskSectionIndex, 'toast region renders below task section');
  assert.ok(threadSectionIndex > toastRegionIndex, 'toast region renders above the transcript');
  assert.doesNotMatch(toastCss, /position:\s*(?:fixed|absolute|sticky)/);
  assert.doesNotMatch(toastCss, /top:\s*44px/);
  assert.match(deleteBody, /showPluginToast/);
  assert.doesNotMatch(deleteBody, /appendPlainLog/);
  assert.doesNotMatch(plainLogBody, /log\.append\(item\)/);
});

test('run history renders as a compact single-column transcript without persistent speaker rails', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );

  assert.match(contentScript, /root\.className = 'transcript-turn run-card'/);
  assert.match(contentScript, /class="run-prompt"/);
  assert.match(contentScript, /data-run-process/);
  assert.match(contentScript, /class="run-activity-list"/);
  assert.match(contentScript, /data-run-report/);
  assert.match(contentScript, /data-run-process-summary/);
  assert.doesNotMatch(contentScript, /data-run-technical-log/);
  assert.doesNotMatch(contentScript, />技术详情</);
  assert.doesNotMatch(contentScript, /<summary>Task<\/summary>/);
  assert.doesNotMatch(contentScript, /class="run-speaker"/);
  assert.doesNotMatch(contentScript, />你<\/div>/);
  assert.doesNotMatch(contentScript, />Codex<\/div>/);
  assert.doesNotMatch(css, /grid-template-columns:\s*46px minmax/);
  assert.match(css, /\.run-activity\s*\{[\s\S]*grid-template-columns:\s*14px minmax\(0,\s*1fr\)/);
});

test('activity rows are compact lines, not per-event cards with persistent timestamps', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );

  assert.match(contentScript, /function renderActivityLine\(/);
  assert.match(contentScript, /className = 'run-activity'/);
  assert.doesNotMatch(contentScript, /details\.className = 'run-event'/);
  assert.doesNotMatch(contentScript, /class="run-event"/);
  assert.match(css, /\.run-activity\s*\{[\s\S]*min-height:\s*20px/);
  assert.match(css, /\.run-activity-time\s*\{[\s\S]*display:\s*none/);
  assert.match(css, /\.run-process/);
  assert.doesNotMatch(css, /\.run-technical-log/);
});

test('completed runs collapse processing history behind a processed summary', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );

  assert.match(contentScript, /function finishRunView\(/);
  assert.match(contentScript, /const visibleView = getCurrentRunViewForRender\(\)/);
  assert.match(contentScript, /collapseRunProcess\(visibleView/);
  assert.match(contentScript, /formatProcessedSummary/);
  assert.match(contentScript, /已处理/);
  assert.match(contentScript, /runProcess\.open = false/);
  assert.match(css, /\.run-process summary/);
});

test('context compaction appears as a lightweight checkpoint inside processed history', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const agentTranscript = fs.readFileSync(
    path.join(__dirname, '../extension/src/shared/agentTranscript.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );

  assert.match(agentTranscript, /上下文已压缩，Codex 继续处理/);
  assert.match(agentTranscript, /kind:\s*'checkpoint'/);
  assert.match(contentScript, /row\.dataset\.kind = event\.kind \|\| 'activity'/);
  assert.match(contentScript, /collapseRunProcess\(visibleView/);
  assert.match(css, /\.run-activity\[data-kind="checkpoint"\]/);
  assert.match(css, /\.run-activity\[data-kind="checkpoint"\]\s+\.run-activity-title::before/);
  assert.doesNotMatch(agentTranscript, /技术详情[^']*上下文已压缩/);
});

test('run log autoscroll follows realtime output unless the user scrolls upward', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );

  assert.match(contentScript, /let logAutoFollow = true/);
  assert.match(contentScript, /let userScrollIntentUntil = 0/);
  assert.match(contentScript, /function bindLogAutoFollow\(/);
  assert.match(contentScript, /function getLogScrollContainer\(/);
  assert.match(contentScript, /querySelector\('\[data-log\]'\)/);
  assert.doesNotMatch(contentScript, /querySelector\('\[data-main\]'\)\s*\|\| panel\?\.querySelector\('\[data-log\]'\)/);
  assert.match(contentScript, /function isLogNearBottom\(/);
  assert.match(contentScript, /function markUserScrollIntent\(/);
  assert.match(contentScript, /Date\.now\(\) <= userScrollIntentUntil/);
  assert.match(contentScript, /function scrollLogToBottom\(/);
  assert.match(contentScript, /requestAnimationFrame/);
  assert.match(contentScript, /scrollLogToBottom\(\{ force: true \}\)/);
  assert.match(contentScript, /scrollLogToBottom\(\)/);
});

test('task session navigation stays pinned while the transcript scrolls', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );

  assert.match(css, /\.codex-vscode-main\s*\{[\s\S]*display:\s*flex/);
  assert.match(css, /\.codex-vscode-main\s*\{[\s\S]*flex-direction:\s*column/);
  assert.match(css, /\.codex-vscode-main\s*\{[\s\S]*overflow:\s*hidden/);
  assert.match(css, /\.codex-task-section\s*\{[\s\S]*flex:\s*0 0 auto/);
  assert.match(css, /\.codex-task-section\s*\{[\s\S]*max-height:/);
  assert.match(css, /\.codex-task-section\s*\{[\s\S]*overflow-y:\s*auto/);
  assert.match(css, /\.codex-thread-section\s*\{[\s\S]*flex:\s*1 1 auto/);
  assert.match(css, /\.codex-thread-section\s*\{[\s\S]*min-height:\s*0/);
  assert.match(css, /\.col-log\s*\{[\s\S]*overflow-y:\s*auto/);
});

test('running Codex tasks do not block switching to another session for reading history', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const switchBody = contentScript.match(/async function switchSession\(sessionId\) \{[\s\S]*?\n  async function deleteSessionWithConfirm/)?.[0] || '';

  assert.doesNotMatch(switchBody, /Finish the current Codex task before switching sessions/);
  assert.doesNotMatch(switchBody, /if \(currentRunView\)/);
  assert.match(contentScript, /sessionId:\s*state\.activeSessionId/);
  assert.match(contentScript, /findRunRecord\(currentRunView\.recordId,\s*currentRunView\.sessionId\)/);
});

test('running Codex tasks only lock the running session, not the whole session list', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );
  const sessionPanel = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/sessionPanel.js'),
    'utf8'
  );
  const startNewBody = contentScript.match(/async function startNewSession\(\) \{[\s\S]*?\n  async function switchSession/)?.[0] || '';
  const deleteBody = contentScript.match(/async function deleteSessionWithConfirm\(sessionId\) \{[\s\S]*?\n  function setRunning/)?.[0] || '';
  const setRunningBody = contentScript.match(/function setRunning\(running\) \{[\s\S]*?\n  function startRunView/)?.[0] || '';
  const sessionListBody = contentScript.match(/function renderSessionList\(\{ showAll = false \} = \{\}\) \{[\s\S]*?\n  function renderRunHistory/)?.[0] || '';

  assert.doesNotMatch(startNewBody, /Finish the current Codex task before starting a new session/);
  assert.doesNotMatch(setRunningBody, /\[data-new-session\]'\)\.disabled = running/);
  assert.match(deleteBody, /isSessionRunning\(target\)/);
  assert.doesNotMatch(deleteBody, /currentRunView\?\.sessionId === sessionId/);
  assert.doesNotMatch(deleteBody, /Finish the current Codex task before deleting a session/);
  assert.match(sessionListBody, /pinnedSessionIds:\s*getRunningSessionIds\(\)/);
  assert.doesNotMatch(sessionListBody, /pinnedSessionIds:\s*\[currentRunView\?\.sessionId\]\.filter\(Boolean\)/);
  assert.match(sessionPanel, /const isRunningSession = instance\.isSessionRunning\(session\)/);
  assert.doesNotMatch(sessionPanel, /const isRunningSession = currentRunView\?\.sessionId === session\.id/);
  assert.match(sessionPanel, /row\.dataset\.running = isRunningSession \? 'true' : 'false'/);
  assert.match(sessionPanel, /deleteButton\.disabled = isRunningSession/);
  assert.match(contentScript, /function isSessionRunning\(session\) \{/);
  assert.match(contentScript, /run\.status === 'running'/);
  assert.match(css, /\.codex-session-row\[data-running="true"\]/);
  assert.match(css, /codex-session-spin/);
});

test('running tasks are only marked interrupted when restoring persisted state after reload', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const sessionState = fs.readFileSync(
    path.join(__dirname, '../extension/src/shared/sessionState.js'),
    'utf8'
  );

  assert.match(contentScript, /normalizePanelState\(await loadStoredState\(\),\s*\{\s*restoreRunningRuns:\s*true\s*\}\)/);
  assert.match(sessionState, /restoreRunningRuns/);
  assert.doesNotMatch(sessionState, /Run interrupted by page reload/);
  assert.doesNotMatch(sessionState, /Interrupted by page reload/);
  assert.match(sessionState, /页面刷新后已停止跟踪这轮任务/);
});

test('session list keeps the selected historical session reachable', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const sessionState = fs.readFileSync(
    path.join(__dirname, '../extension/src/shared/sessionState.js'),
    'utf8'
  );

  assert.match(contentScript, /selectVisibleSessionsForList/);
  assert.match(contentScript, /state\.activeSessionId/);
  assert.match(sessionState, /function selectVisibleSessionsForList/);
  assert.match(sessionState, /activeSessionId/);
});

test('session titles auto-name once and can be manually renamed inline', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );
  const sessionPanel = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/sessionPanel.js'),
    'utf8'
  );
  const startRunBody = contentScript.match(/function startRunView\(\{ task, mode, model, reasoningEffort, speedTier \}\) \{[\s\S]*?\n  function finishRunView/)?.[0] || '';

  assert.match(startRunBody, /active\?\.titleSource !== 'manual'/);
  assert.match(startRunBody, /deriveSessionTitle/);
  assert.match(sessionPanel, /codex-session-rename/);
  assert.match(sessionPanel, /codex-session-title-input/);
  assert.match(sessionPanel, /function beginRename/);
  assert.match(contentScript, /cleanTitle \? 'manual' : 'auto'/);
  assert.match(css, /\.codex-session-rename/);
  assert.match(css, /\.codex-session-title-input/);
});

test('high-volume Codex stream output is throttled before panel rendering and storage writes', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const appendRunEventBody = contentScript.match(/function appendRunEvent\(input = \{\}\) \{[\s\S]*?\n  function getCurrentRunViewForRender/)?.[0] || '';

  assert.match(contentScript, /STREAM_RENDER_FLUSH_MS/);
  assert.match(contentScript, /STREAM_SAVE_DELAY_MS/);
  assert.match(contentScript, /pendingStreamRenderEvents = new Map\(\)/);
  assert.match(contentScript, /function scheduleStreamEventRender/);
  assert.match(contentScript, /function flushPendingStreamRenders/);
  assert.match(contentScript, /function scheduleRunStateSave/);
  assert.match(appendRunEventBody, /scheduleRunStateSave\(event\.kind\)/);
  assert.match(appendRunEventBody, /scheduleStreamEventRender\(renderedEvent\)/);
  assert.match(appendRunEventBody, /if \(event\.kind === 'stream'\) \{[\s\S]*scheduleStreamEventRender\(renderedEvent\)/);
});

test('reviewing safety toggle is labeled instead of a mysterious check icon', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const composerPanel = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/composerPanel.js'),
    'utf8'
  );
  const i18n = fs.readFileSync(
    path.join(__dirname, '../extension/src/shared/i18n.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );

  assert.match(`${contentScript}\n${composerPanel}`, /data-i18n="requireReviewing">Track</);
  assert.match(i18n, /requireReviewing:\s*'留痕'/);
  assert.match(i18n, /开启后，写入前会确认并尝试切到 Overleaf Reviewing\/Track Changes；删除仍需确认。/);
  assert.match(css, /\.codex-review-label/);
});

test('write paths enforce Overleaf Reviewing before applying changes when requested', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const pageBridge = fs.readFileSync(
    path.join(__dirname, '../extension/src/pageBridge.js'),
    'utf8'
  );
  const applySyncBody = contentScript.match(/async function applySyncChangesToOverleaf[\s\S]*?\n  function buildSyncApplyOperations/)?.[0] || '';
  const applyTaskBody = contentScript.match(/async function applyTaskOperations[\s\S]*?\n  function partitionOperationsForApply/)?.[0] || '';

  assert.match(contentScript, /async function ensureReviewingBeforeWrite/);
  assert.match(applySyncBody, /const runRequireReviewing = typeof options\.requireReviewing === 'boolean'/);
  assert.match(applySyncBody, /await ensureReviewingBeforeWrite\(operations,\s*\{\s*requireReviewing:\s*runRequireReviewing\s*\}\)/);
  assert.match(applySyncBody, /requireReviewing:\s*runRequireReviewing/);
  assert.match(applySyncBody, /requireEditing:\s*!runRequireReviewing/);
  assert.doesNotMatch(applySyncBody, /requireReviewing:\s*state\.requireReviewing === true/);
  assert.match(applyTaskBody, /await ensureReviewingBeforeWrite\(partitioned\.safe,\s*\{\s*requireReviewing:\s*runRequireReviewing\s*\}\)/);
  assert.match(applyTaskBody, /requireReviewing:\s*runRequireReviewing/);
  assert.match(applyTaskBody, /requireEditing:\s*!runRequireReviewing/);
  assert.doesNotMatch(applyTaskBody, /requireReviewing:\s*state\.requireReviewing === true/);
  assert.match(pageBridge, /method === 'ensureReviewing'/);
  assert.match(pageBridge, /method === 'ensureEditing'/);
  assert.match(pageBridge, /function ensureReviewing\(/);
  assert.match(pageBridge, /function ensureEditing\(/);
  assert.match(pageBridge, /requireReviewing:\s*params\.requireReviewing === true/);
  assert.match(pageBridge, /requireEditing:\s*params\.requireEditing === true/);
  const writebackRouter = fs.readFileSync(path.join(__dirname, '../extension/src/page/writebackRouter.js'), 'utf8');
  assert.match(writebackRouter, /buildReviewingRequiredBlockedResult/);
  assert.match(writebackRouter, /buildEditingRequiredBlockedResult/);
});

test('write tasks preflight Reviewing or Editing before syncing or starting local Codex', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const runTaskBody = contentScript.match(/async function runTask\(\) \{[\s\S]*?\n  async function handleTaskResult/)?.[0] || '';
  const preflightIndex = runTaskBody.indexOf('preflightWriteSafety({');
  const snapshotIndex = runTaskBody.indexOf('getRunProjectSnapshot()');
  const codexRunIndex = runTaskBody.indexOf("method: 'codex.run'");
  const preflightBody = contentScript.match(/async function preflightWriteSafety\([^)]*\) \{[\s\S]*?\n  async function handleTaskResult/)?.[0] || '';

  assert.match(contentScript, /async function preflightWriteSafety\(/);
  assert.ok(preflightIndex > -1);
  assert.ok(snapshotIndex > -1);
  assert.ok(codexRunIndex > -1);
  assert.ok(preflightIndex < snapshotIndex);
  assert.ok(preflightIndex < codexRunIndex);
  assert.match(runTaskBody, /const submittedRequireReviewing = state\.requireReviewing === true/);
  assert.match(runTaskBody, /preflightWriteSafety\(\{\s*mode:\s*submittedMode,\s*requireReviewing:\s*submittedRequireReviewing\s*\}\)/);
  assert.match(preflightBody, /const mode = options\.mode \|\| state\.mode/);
  assert.match(preflightBody, /const requireReviewing = typeof options\.requireReviewing === 'boolean'/);
  assert.match(preflightBody, /mode === 'ask'/);
  assert.match(preflightBody, /const method = requireReviewing \? 'ensureReviewing' : 'ensureEditing'/);
  assert.match(preflightBody, /callPageBridge\(method/);
  assert.match(preflightBody, /任务未开始：无法开启 Overleaf 留痕/);
  assert.match(preflightBody, /任务未开始：无法切换到 Overleaf Editing/);
  assert.match(preflightBody, /const finishTitle = requireReviewing/);
  assert.match(preflightBody, /tx\('Not started: could not enable Track Changes', '未开始：无法开启留痕'\)/);
  assert.match(preflightBody, /tx\('Not started: could not switch to Editing', '未开始：无法切换到 Editing'\)/);
  assert.match(preflightBody, /finishRunView\(finishTitle, 'failed'\)/);
});

test('native side-effecting requests are gated on compatibility before dispatch', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const sendNativeBody = extractFunction(contentScript, 'sendNative');
  const sendBackgroundNativeBody = extractFunction(contentScript, 'sendBackgroundNative');
  const ensureBody = extractFunction(contentScript, 'ensureNativeCompatibilityForMethod');

  assert.match(contentScript, /NATIVE_COMPATIBILITY_GATED_METHODS/);
  for (const method of [
    'codex.run',
    'task.run',
    'task.confirm',
    'mirror.sync',
    'mirror.patchFiles',
    'codex.history.clearPlugin'
  ]) {
    assert.match(contentScript, new RegExp(method.replace(/[.]/g, '\\.')));
  }
  assert.match(ensureBody, /CodexOverleafCompatibility\?\.buildBridgePingParams/);
  assert.match(ensureBody, /CodexOverleafCompatibility\?\.evaluateNativeCompatibility/);
  assert.match(ensureBody, /CodexOverleafCompatibility\?\.isNativeMethodAllowed/);
  assert.match(ensureBody, /native_update_required/);
  assert.match(ensureBody, /formatNativeCompatibilityBlockedMessage/);
  assert.match(sendNativeBody, /await ensureNativeCompatibilityForMethod\(payload\?\.method\)/);
  assert.match(sendNativeBody, /attachNativeCompatibilityEvidence/);
  assert.match(sendBackgroundNativeBody, /await ensureNativeCompatibilityForMethod\(payload\?\.method\)/);
  assert.match(sendBackgroundNativeBody, /attachNativeCompatibilityEvidence/);
});

test('cancellation during native compatibility gate prevents codex.run dispatch', async () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const sendNativeBody = extractFunction(contentScript, 'sendNative');

  let cancellationRequested = false;
  let nativeSent = false;
  const sendNative = Function(
    'ensureNativeCompatibilityForMethod',
    'nativeChannel',
    'attachNativeCompatibilityEvidence',
    'throwIfCancelledBeforeNativeDispatch',
    `return (${sendNativeBody});`
  )(
    async () => {
      cancellationRequested = true;
      return { ok: true, compatibility: { status: 'ok' } };
    },
    {
      sendNative() {
        nativeSent = true;
        return Promise.resolve({ ok: true });
      }
    },
    payload => payload,
    () => {
      if (cancellationRequested) {
        const error = new Error('Codex run was cancelled by the user');
        error.code = 'codex_cancelled';
        throw error;
      }
    }
  );

  await assert.rejects(
    sendNative({ method: 'codex.run', params: { task: 'write' } }),
    /Codex run was cancelled by the user/
  );
  assert.equal(nativeSent, false);
});

test('read-only native discovery and diagnostics bypass the compatibility run gate', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const loadModelBody = extractFunction(contentScript, 'loadModelOptions');
  const mirrorFreshnessBody = extractFunction(contentScript, 'getMirrorFreshness');
  const inspectBody = extractFunction(contentScript, 'inspectNativeEnvironment');

  assert.match(loadModelBody, /method:\s*'codex\.models'/);
  assert.match(mirrorFreshnessBody, /method:\s*'mirror\.status'/);
  assert.match(inspectBody, /method:\s*'bridge\.ping'/);
  assert.doesNotMatch(loadModelBody, /ensureNativeCompatibilityForMethod/);
  assert.doesNotMatch(mirrorFreshnessBody, /ensureNativeCompatibilityForMethod/);
  assert.doesNotMatch(inspectBody, /ensureNativeCompatibilityForMethod/);
});

test('write preflight gives natural feedback for automatic Reviewing or Editing activation', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const preflightBody = contentScript.match(/async function preflightWriteSafety\([^)]*\) \{[\s\S]*?\n  async function handleTaskResult/)?.[0] || '';

  assert.match(preflightBody, /正在确认 Overleaf 留痕状态/);
  assert.match(preflightBody, /正在确认 Overleaf Editing 模式/);
  assert.match(preflightBody, /已开启 Overleaf 留痕，开始处理任务/);
  assert.match(preflightBody, /Overleaf 留痕已经开启，开始处理任务/);
  assert.match(preflightBody, /已切到 Overleaf Editing，开始处理任务/);
  assert.match(preflightBody, /Overleaf 已在 Editing 模式，开始处理任务/);
  assert.match(preflightBody, /你可能没有权限，或 Overleaf 当前页面没有暴露切换入口/);
  assert.match(preflightBody, /请在 Overleaf 手动切到 Editing 后重试/);
});

test('native and raw agent events go through the human transcript mapper', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const appendNativeEventBody = contentScript.match(/function appendNativeEvent\(event\) \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.match(contentScript, /CodexOverleafAgentTranscript/);
  assert.match(appendNativeEventBody, /mapAgentEventToActivity\(event,\s*\{\s*locale:\s*getLocale\(\)\s*\}\)/);
  assert.match(contentScript, /appendTechnicalEvent/);
  assert.doesNotMatch(contentScript, /function mapAgentActivity\(event\)/);
});

test('Codex JSONL messages and tool progress become visible without raw command labels', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const agentTranscript = fs.readFileSync(
    path.join(__dirname, '../extension/src/shared/agentTranscript.js'),
    'utf8'
  );

  assert.match(agentTranscript, /codex\.agent\.message/);
  assert.match(agentTranscript, /codex\.command\.started/);
  assert.match(agentTranscript, /summarizeCommandActivity/);
  assert.doesNotMatch(contentScript, /Codex 说/);
  assert.doesNotMatch(contentScript, /Codex 正在运行命令/);
  assert.doesNotMatch(contentScript, /命令已完成/);
});

test('Codex realtime deltas update one stream instead of appending raw event rows', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const agentTranscript = fs.readFileSync(
    path.join(__dirname, '../extension/src/shared/agentTranscript.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );

  assert.match(agentTranscript, /kind:\s*'stream'/);
  assert.match(agentTranscript, /streamKey:\s*getCodexStreamKey/);
  assert.match(contentScript, /function upsertRunStreamRecordEvent\(/);
  assert.match(contentScript, /function upsertStreamEvent\(/);
  assert.match(contentScript, /className = 'run-stream'/);
  assert.match(contentScript, /function renderMarkdownInlineText\(/);
  assert.match(contentScript, /document\.createElement\('strong'\)/);
  assert.doesNotMatch(contentScript, /run-stream-text[\s\S]{0,240}\.innerHTML/);
  assert.match(css, /\.run-stream-text/);
  assert.match(agentTranscript, /if \(method === 'item\/reasoning\/textDelta'\) \{\s*return technicalOnly\(event, locale\);\s*\}/);
  assert.doesNotMatch(contentScript, /technicalDetail:\s*normalizeRawAgentEvent\(event\)/);
});

test('final assistant summary is collected from all assistant stream messages', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );

  assert.match(contentScript, /function getAssistantAnswerForCurrentRun\(/);
  assert.match(contentScript, /\.filter\(event =>[\s\S]*event\.streamRole === 'assistant'/);
  assert.match(contentScript, /\.map\(event => cleanFinalAnswer\(event\.title\)\)/);
  assert.match(contentScript, /\.join\('\\n\\n'\)/);
  assert.doesNotMatch(contentScript, /function getLatestAssistantAnswerForCurrentRun\(/);
});

test('same UI session records final assistant summary for the next Codex turn', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );

  assert.match(contentScript, /function buildSessionHistoryResult/);
  assert.match(contentScript, /const assistantMessage = response\.result\.assistantMessage \|\| getAssistantAnswerForCurrentRun\(\)/);
  assert.match(contentScript, /result:\s*buildSessionHistoryResult\(\{[\s\S]*assistantMessage,/);
  assert.match(contentScript, /const syncChanges = response\.result\.syncChanges \|\| \[\]/);
  assert.match(contentScript, /syncChanges\s*\n\s*\}\)/);
});

test('post-run session persistence failures do not turn ask results into failed analysis', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const successPath = contentScript.match(/const syncOutcome = await applySyncChangesToOverleaf[\s\S]*?Codex 结果已生成，但保存本地会话记录失败[\s\S]*?\}\);/)?.[0] || '';

  assert.match(successPath, /try\s*\{/);
  assert.match(successPath, /await saveState\(\)/);
  assert.match(successPath, /catch \(persistenceError\)/);
  assert.match(successPath, /Codex 结果已生成，但保存本地会话记录失败/);
  assert.doesNotMatch(successPath, /throw persistenceError/);
});

test('completion report is structured around user outcomes rather than a one-line status', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const agentTranscript = fs.readFileSync(
    path.join(__dirname, '../extension/src/shared/agentTranscript.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );

  assert.match(contentScript, /function appendCompletionReport\(/);
  assert.match(contentScript, /buildHumanCompletionReport/);
  assert.match(contentScript, /translateRawError/);
  assert.match(contentScript, /assistantMessage/);
  assert.match(contentScript, /getAssistantAnswerForCurrentRun/);
  assert.match(contentScript, /className = 'run-final-answer'/);
  assert.match(contentScript, /renderMarkdownBlockText\(body/);
  assert.match(contentScript, /function renderMarkdownBlockText\(/);
  assert.match(contentScript, /function formatMarkdownHref\(/);
  assert.match(contentScript, /workspace\/\$\{fileLabel\}:\$\{line\}/);
  assert.match(css, /\.run-final-answer ul/);
  assert.match(css, /\.run-final-answer a/);
  assert.doesNotMatch(contentScript, /body\.textContent = formatEventDetail\(event\.detail \|\| \{\}\)/);
  assert.match(agentTranscript, /结论/);
  assert.match(agentTranscript, /检查范围/);
  assert.match(agentTranscript, /发现/);
  assert.match(agentTranscript, /写入结果/);
  assert.match(agentTranscript, /可撤销/);
  assert.match(agentTranscript, /下一步/);
  assert.doesNotMatch(contentScript, /nextStep: response\.error\.message/);
  assert.doesNotMatch(contentScript, /本地 Codex 返回错误/);
  assert.doesNotMatch(contentScript, /Summary:/);
});

test('writeback completion report keeps Codex final summary as the conclusion', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const applyBody = contentScript.match(/async function applySyncChangesToOverleaf[\s\S]*?\n  function buildSyncApplyOperations/)?.[0] || '';
  const writebackReportBlock = applyBody.match(/const summaryLine = appendChangeSummary[\s\S]*?appendCompletionReport\(\{[\s\S]*?\n    \}\);/)?.[0] || '';

  assert.match(applyBody, /const assistantMessage = cleanFinalAnswer/);
  assert.match(writebackReportBlock, /assistantMessage/);
  assert.doesNotMatch(writebackReportBlock, /conclusion:\s*applied\.skipped\?\.length\s*\?[\s\S]*:\s*'本地 Codex 改动已同步回 Overleaf。'/);
});

test('completion report renderer turns inline numbered findings into readable ordered lists', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );

  assert.match(contentScript, /function normalizeInlineOrderedLists\(/);
  assert.match(contentScript, /document\.createElement\('ol'\)/);
  assert.match(contentScript, /isMarkdownOrderedListLine/);
});

test('auto mode shows a readonly diff after applying Codex changes', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const diffReviewPanel = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/diffReviewPanel.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );
  const applySyncBody = contentScript.match(/async function applySyncChangesToOverleaf[\s\S]*?\n  function buildSyncApplyOperations/)?.[0] || '';

  assert.match(contentScript, /function renderReadOnlyDiffReview\(/);
  assert.match(contentScript, /diffReviewPanel\.renderReadOnlyDiffReview\(syncChanges,\s*title\)/);
  assert.match(applySyncBody, /const applied = operations\.length[\s\S]*renderReadOnlyDiffReview\(getAppliedSyncChanges\(syncChanges, applied\)/);
  assert.match(contentScript, /function getAppliedSyncChanges\(/);
  assert.match(diffReviewPanel, /dataset\.readonly = 'true'/);
  assert.match(css, /\.codex-diff-review\[data-readonly="true"\]/);
  assert.doesNotMatch(applySyncBody, /本地 Codex 改动预览：\$\{syncChanges\.filter/);
});

test('confirm diff review uses immediate per-file decisions and batch accept reject actions', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const diffReviewPanel = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/diffReviewPanel.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );
  const wrapperBody = contentScript.match(/function createDiffReviewElement\(syncChanges[\s\S]*?\n  function renderReadOnlyDiffReview/)?.[0] || '';
  const createDiffBody = diffReviewPanel.match(/function createDiffReviewElement\(syncChanges[\s\S]*?\n    function renderDiffReview/)?.[0] || '';
  const renderDiffBody = diffReviewPanel.match(/function renderDiffReview\(syncChanges\) \{[\s\S]*?\n    function renderReadOnlyDiffReview/)?.[0] || '';

  assert.match(wrapperBody, /return diffReviewPanel\.createDiffReviewElement\(syncChanges,\s*options\)/);
  assert.match(wrapperBody, /return diffReviewPanel\.renderDiffReview\(syncChanges\)/);
  assert.match(createDiffBody, /card\.dataset\.decision = readonly \? 'accepted' : 'pending'/);
  assert.match(createDiffBody, /function decideFileChange\(path, accepted\)/);
  assert.match(createDiffBody, /status\.textContent = accepted \? tr\('diffAccepted'\) : tr\('diffRejected'\)/);
  assert.match(renderDiffBody, /acceptAllBtn\.textContent = tr\('diffAcceptAll'\)/);
  assert.match(renderDiffBody, /rejectAllBtn\.textContent = tr\('diffRejectAll'\)/);
  assert.match(renderDiffBody, /review\.decidePendingChanges\(true\)/);
  assert.match(renderDiffBody, /review\.decidePendingChanges\(false\)/);
  assert.doesNotMatch(renderDiffBody, /finish\(syncChanges\)/);
  assert.doesNotMatch(renderDiffBody, /finish\(\[\]\)/);
  assert.doesNotMatch(renderDiffBody, /应用选中/);
  assert.match(renderDiffBody, /finishIfAllDecided/);
  assert.match(css, /\.codex-diff-file\[data-decision="accepted"\]/);
  assert.match(css, /\.codex-diff-toolbar-summary/);
});

test('confirm diff review renders hunk controls and resolves accepted hunk patches', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const diffReviewPanel = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/diffReviewPanel.js'),
    'utf8'
  );
  const createDiffBody = diffReviewPanel.match(/function createDiffReviewElement\(syncChanges[\s\S]*?\n    function renderDiffReview/)?.[0] || '';
  const renderDiffBody = diffReviewPanel.match(/function renderDiffReview\(syncChanges\) \{[\s\S]*?\n    function renderReadOnlyDiffReview/)?.[0] || '';

  assert.match(contentScript, /CodexOverleafReviewHunks/);
  assert.match(createDiffBody, /window\.CodexOverleafReviewHunks/);
  assert.match(createDiffBody, /data-diff-hunk-accept/);
  assert.match(createDiffBody, /data-diff-hunk-reject/);
  assert.match(createDiffBody, /data-diff-hunk-jump/);
  assert.match(createDiffBody, /buildAcceptedSyncChanges\(syncChanges,\s*decisions\)/);
  assert.match(renderDiffBody, /review\.getAcceptedChanges\(\)/);
  assert.match(renderDiffBody, /buildAcceptedSyncChanges/);
});

test('confirm diff review exposes editor-native hunk review limits and shortcuts', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const diffReviewPanel = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/diffReviewPanel.js'),
    'utf8'
  );
  const createDiffBody = diffReviewPanel.match(/function createDiffReviewElement\(syncChanges[\s\S]*?\n    function renderDiffReview/)?.[0] || '';

  assert.match(diffReviewPanel, /const MAX_INITIAL_REVIEW_HUNKS = 20/);
  assert.match(diffReviewPanel, /const MAX_INITIAL_HUNK_LINES = 80/);
  assert.match(createDiffBody, /container\.tabIndex = 0/);
  assert.match(createDiffBody, /handleDiffReviewKeydown/);
  assert.match(createDiffBody, /addEventListener\('keydown', handleDiffReviewKeydown\)/);
  assert.match(createDiffBody, /callPageBridge\('jumpToPosition',\s*\{\s*path/);
  assert.match(createDiffBody, /case 'j'/);
  assert.match(createDiffBody, /case 'k'/);
  assert.match(createDiffBody, /case 'a'/);
  assert.match(createDiffBody, /case 'r'/);
  assert.match(createDiffBody, /case 'Enter'/);
  assert.match(createDiffBody, /case 'Escape'/);
  assert.match(createDiffBody, /isDiffReviewEditableTarget/);
  assert.match(createDiffBody, /MAX_INITIAL_REVIEW_HUNKS/);
  assert.match(createDiffBody, /MAX_INITIAL_HUNK_LINES/);
});

test('hunk review buttons return only the accepted patch subset', () => {
  const createDiffReviewElement = loadCreateDiffReviewElementForTest();
  const syncChanges = [
    {
      type: 'write',
      path: 'main.tex',
      patches: [
        { from: 0, to: 5, expected: 'alpha', insert: 'ALPHA' },
        { from: 6, to: 10, expected: 'beta', insert: 'BETA' }
      ],
      diff: [
        { lines: [{ type: 'remove', text: 'alpha' }, { type: 'add', text: 'ALPHA' }] },
        { lines: [{ type: 'remove', text: 'beta' }, { type: 'add', text: 'BETA' }] }
      ]
    }
  ];

  const review = createDiffReviewElement(syncChanges);
  const acceptButtons = review.container.querySelectorAll('[data-diff-hunk-accept]');
  const rejectButtons = review.container.querySelectorAll('[data-diff-hunk-reject]');
  acceptButtons[0].click();
  rejectButtons[1].click();

  assert.equal(review.getPendingCount(), 0);
  assert.deepEqual(review.getAcceptedChanges(), [
    {
      ...syncChanges[0],
      patches: [syncChanges[0].patches[0]]
    }
  ]);
});

test('hunk decision collapses the decided hunk and advances focus to the next pending hunk', () => {
  const createDiffReviewElement = loadCreateDiffReviewElementForTest();
  const syncChanges = [
    {
      type: 'write',
      path: 'main.tex',
      patches: [
        { from: 0, to: 5, expected: 'alpha', insert: 'ALPHA' },
        { from: 6, to: 10, expected: 'beta', insert: 'BETA' }
      ],
      diff: [
        { lines: [{ type: 'remove', text: 'alpha' }, { type: 'add', text: 'ALPHA' }] },
        { lines: [{ type: 'remove', text: 'beta' }, { type: 'add', text: 'BETA' }] }
      ]
    }
  ];

  const review = createDiffReviewElement(syncChanges);
  review.container.querySelector('[data-diff-hunk-accept]').click();
  const hunks = review.container.querySelectorAll('[data-diff-review-hunk]');

  assert.equal(hunks[0].dataset.collapsed, 'true');
  assert.equal(hunks[0].dataset.focused, 'false');
  assert.equal(hunks[1].dataset.focused, 'true');
});

test('bulk hunk decisions preserve already decided hunks and fill only pending hunks', () => {
  const createDiffReviewElement = loadCreateDiffReviewElementForTest();
  const syncChanges = [
    {
      type: 'write',
      path: 'main.tex',
      patches: [
        { from: 0, to: 5, expected: 'alpha', insert: 'ALPHA' },
        { from: 6, to: 10, expected: 'beta', insert: 'BETA' },
        { from: 11, to: 16, expected: 'gamma', insert: 'GAMMA' }
      ],
      diff: [
        { lines: [{ type: 'remove', text: 'alpha' }, { type: 'add', text: 'ALPHA' }] },
        { lines: [{ type: 'remove', text: 'beta' }, { type: 'add', text: 'BETA' }] },
        { lines: [{ type: 'remove', text: 'gamma' }, { type: 'add', text: 'GAMMA' }] }
      ]
    }
  ];

  const acceptRest = createDiffReviewElement(syncChanges);
  acceptRest.container.querySelector('[data-diff-hunk-reject]').click();
  acceptRest.decidePendingChanges(true);
  assert.deepEqual(acceptRest.getAcceptedChanges()[0]?.patches, [
    syncChanges[0].patches[1],
    syncChanges[0].patches[2]
  ]);

  const rejectRest = createDiffReviewElement(syncChanges);
  rejectRest.container.querySelector('[data-diff-hunk-accept]').click();
  rejectRest.decidePendingChanges(false);
  assert.deepEqual(rejectRest.getAcceptedChanges()[0]?.patches, [
    syncChanges[0].patches[0]
  ]);
});

test('file hunk decisions preserve already decided hunks and fill only pending file hunks', () => {
  const createDiffReviewElement = loadCreateDiffReviewElementForTest();
  const syncChanges = [
    {
      type: 'write',
      path: 'main.tex',
      patches: [
        { from: 0, to: 5, expected: 'alpha', insert: 'ALPHA' },
        { from: 6, to: 10, expected: 'beta', insert: 'BETA' },
        { from: 11, to: 16, expected: 'gamma', insert: 'GAMMA' }
      ],
      diff: [
        { lines: [{ type: 'remove', text: 'alpha' }, { type: 'add', text: 'ALPHA' }] },
        { lines: [{ type: 'remove', text: 'beta' }, { type: 'add', text: 'BETA' }] },
        { lines: [{ type: 'remove', text: 'gamma' }, { type: 'add', text: 'GAMMA' }] }
      ]
    }
  ];

  const acceptRest = createDiffReviewElement(syncChanges);
  acceptRest.container.querySelector('[data-diff-hunk-reject]').click();
  acceptRest.decideFileChange('main.tex', true);
  assert.deepEqual(acceptRest.getAcceptedChanges()[0]?.patches, [
    syncChanges[0].patches[1],
    syncChanges[0].patches[2]
  ]);

  const rejectRest = createDiffReviewElement(syncChanges);
  rejectRest.container.querySelector('[data-diff-hunk-accept]').click();
  rejectRest.decideFileChange('main.tex', false);
  assert.deepEqual(rejectRest.getAcceptedChanges()[0]?.patches, [
    syncChanges[0].patches[0]
  ]);
});

test('hunk review renders patch text when display diff has fewer hunks than patches', () => {
  const createDiffReviewElement = loadCreateDiffReviewElementForTest();
  const syncChanges = [
    {
      type: 'write',
      path: 'main.tex',
      patches: [
        { from: 0, to: 5, expected: 'alpha', insert: 'ALPHA' },
        { from: 20, to: 24, expected: 'beta', insert: 'BETA' },
        { from: 40, to: 45, expected: 'gamma', insert: 'GAMMA' }
      ],
      diff: [
        { lines: [{ type: 'remove', text: 'alpha' }, { type: 'add', text: 'ALPHA' }] }
      ]
    }
  ];

  const review = createDiffReviewElement(syncChanges);
  const lineTexts = review.container
    .querySelectorAll('[data-diff-line]')
    .map(line => line.textContent);

  assert.equal(review.container.querySelectorAll('[data-diff-review-hunk]').length, 3);
  assert.deepEqual(lineTexts, [
    'alpha',
    'ALPHA',
    'beta',
    'BETA',
    'gamma',
    'GAMMA'
  ]);
});

test('hunk jump button calls page bridge with path and offset metadata', () => {
  const createDiffReviewElement = loadCreateDiffReviewElementForTest();
  const syncChanges = [
    {
      type: 'write',
      path: 'main.tex',
      patches: [
        { from: 6, to: 10, expected: 'beta', insert: 'BETA' }
      ],
      diff: [
        { lines: [{ type: 'remove', text: 'beta' }, { type: 'add', text: 'BETA' }] }
      ]
    }
  ];

  const review = createDiffReviewElement(syncChanges);
  review.container.querySelector('[data-diff-hunk-jump]').click();

  assert.deepEqual(JSON.parse(JSON.stringify(createDiffReviewElement.pageBridgeCalls)), [
    {
      method: 'jumpToPosition',
      params: { path: 'main.tex', from: 6, to: 10 }
    }
  ]);
});

test('large diff review initially limits hunks and long hunk lines with explicit expansion controls', () => {
  const createDiffReviewElement = loadCreateDiffReviewElementForTest();
  const patches = Array.from({ length: 22 }, (_, index) => ({
    from: index * 10,
    to: index * 10 + 1,
    expected: `old-${index}`,
    insert: `new-${index}`
  }));
  const longLines = Array.from({ length: 85 }, (_, index) => ({
    type: index % 2 ? 'add' : 'remove',
    text: `line-${index}`
  }));
  const syncChanges = [
    {
      type: 'write',
      path: 'main.tex',
      patches,
      diff: patches.map((patch, index) => ({
        lines: index === 0 ? longLines : [{ type: 'add', text: patch.insert }]
      }))
    }
  ];

  const review = createDiffReviewElement(syncChanges);
  assert.equal(review.container.querySelectorAll('[data-diff-review-hunk]').length, 20);
  assert.equal(review.container.querySelectorAll('[data-diff-line]').length, 99);
  assert.equal(review.container.querySelectorAll('[data-diff-show-more-hunks]').length, 1);
  assert.equal(review.container.querySelectorAll('[data-diff-hunk-expand]').length, 1);

  review.container.querySelector('[data-diff-hunk-expand]').click();
  assert.equal(review.container.querySelectorAll('[data-diff-line]').length, 104);

  review.container.querySelector('[data-diff-show-more-hunks]').click();
  assert.equal(review.container.querySelectorAll('[data-diff-review-hunk]').length, 22);
});

test('large diff review applies initial hunk budget globally across files', () => {
  const createDiffReviewElement = loadCreateDiffReviewElementForTest();
  const buildChange = pathName => {
    const patches = Array.from({ length: 12 }, (_, index) => ({
      from: index * 10,
      to: index * 10 + 1,
      expected: `${pathName}-old-${index}`,
      insert: `${pathName}-new-${index}`
    }));
    return {
      type: 'write',
      path: pathName,
      patches,
      diff: patches.map(patch => ({
        lines: [{ type: 'add', text: patch.insert }]
      }))
    };
  };

  const review = createDiffReviewElement([
    buildChange('main.tex'),
    buildChange('sections/intro.tex')
  ]);

  assert.equal(review.container.querySelectorAll('[data-diff-review-hunk]').length, 20);
  assert.equal(review.container.querySelectorAll('[data-diff-show-more-hunks]').length, 1);

  review.container.querySelector('[data-diff-show-more-hunks]').click();
  assert.equal(review.container.querySelectorAll('[data-diff-review-hunk]').length, 24);
});

test('large diff review preserves decided hunk status after show more rerender', () => {
  const createDiffReviewElement = loadCreateDiffReviewElementForTest();
  const patches = Array.from({ length: 22 }, (_, index) => ({
    from: index * 10,
    to: index * 10 + 1,
    expected: `old-${index}`,
    insert: `new-${index}`
  }));
  const review = createDiffReviewElement([
    {
      type: 'write',
      path: 'main.tex',
      patches,
      diff: patches.map(patch => ({
        lines: [{ type: 'add', text: patch.insert }]
      }))
    }
  ]);

  review.container.querySelector('[data-diff-hunk-accept]').click();
  review.container.querySelector('[data-diff-show-more-hunks]').click();

  assert.equal(review.container.querySelectorAll('[data-diff-hunk-status]').length, 1);
  assert.equal(review.container.querySelectorAll('[data-diff-hunk-accept]').length, 21);
  assert.equal(review.container.querySelectorAll('[data-diff-hunk-reject]').length, 21);
  assert.equal(review.container.querySelectorAll('[data-diff-hunk-jump]').length, 21);
});

test('diff review shortcuts ignore focused hunk action buttons', () => {
  const createDiffReviewElement = loadCreateDiffReviewElementForTest();
  const review = createDiffReviewElement([
    {
      type: 'write',
      path: 'main.tex',
      patches: [
        { from: 0, to: 5, expected: 'alpha', insert: 'ALPHA' }
      ],
      diff: [
        { lines: [{ type: 'remove', text: 'alpha' }, { type: 'add', text: 'ALPHA' }] }
      ]
    }
  ]);
  const jumpButton = review.container.querySelector('[data-diff-hunk-jump]');
  const event = {
    type: 'keydown',
    key: 'Enter',
    target: jumpButton,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    }
  };

  review.container.dispatchEvent(event);

  assert.equal(event.defaultPrevented, false);
  assert.deepEqual(createDiffReviewElement.pageBridgeCalls, []);
});

test('hunk jump failure renders visible hunk-level status text', async () => {
  const createDiffReviewElement = loadCreateDiffReviewElementForTest({
    pageBridgeResult: { ok: false, reason: 'editor unavailable' }
  });
  const review = createDiffReviewElement([
    {
      type: 'write',
      path: 'main.tex',
      patches: [
        { from: 0, to: 5, expected: 'alpha', insert: 'ALPHA' }
      ],
      diff: [
        { lines: [{ type: 'remove', text: 'alpha' }, { type: 'add', text: 'ALPHA' }] }
      ]
    }
  ]);

  await review.container.querySelector('[data-diff-hunk-jump]').click();

  const status = review.container.querySelector('[data-diff-hunk-jump-status]');
  assert.ok(status);
  assert.match(status.textContent, /editor unavailable/);
  assert.equal(review.container.querySelector('[data-diff-review-hunk]').dataset.jumpStatus, 'failed');
});

test('diff review keyboard shortcuts are scoped and only prevent handled keys', () => {
  const createDiffReviewElement = loadCreateDiffReviewElementForTest();
  const syncChanges = [
    {
      type: 'write',
      path: 'main.tex',
      patches: [
        { from: 0, to: 5, expected: 'alpha', insert: 'ALPHA' },
        { from: 6, to: 10, expected: 'beta', insert: 'BETA' }
      ],
      diff: [
        { lines: [{ type: 'remove', text: 'alpha' }, { type: 'add', text: 'ALPHA' }] },
        { lines: [{ type: 'remove', text: 'beta' }, { type: 'add', text: 'BETA' }] }
      ]
    }
  ];
  const review = createDiffReviewElement(syncChanges);
  const dispatchKey = (key, target = review.container) => {
    const event = {
      type: 'keydown',
      key,
      target,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      }
    };
    review.container.dispatchEvent(event);
    return event;
  };

  assert.equal(dispatchKey('x').defaultPrevented, false);
  assert.equal(dispatchKey('a', { tagName: 'INPUT' }).defaultPrevented, false);
  assert.equal(dispatchKey('a').defaultPrevented, true);
  assert.equal(dispatchKey('j').defaultPrevented, true);
  assert.equal(dispatchKey('r').defaultPrevented, true);
  assert.equal(dispatchKey('Escape').defaultPrevented, true);
  assert.equal(review.container.blurred, true);
  assert.equal(review.getPendingCount(), 0);
  assert.deepEqual(review.getAcceptedChanges()[0]?.patches, [syncChanges[0].patches[0]]);
});

test('file-level hunk review action preserves previous hunk decisions for that file', () => {
  const createDiffReviewElement = loadCreateDiffReviewElementForTest();
  const syncChanges = [
    {
      type: 'write',
      path: 'main.tex',
      patches: [
        { from: 0, to: 5, expected: 'alpha', insert: 'ALPHA' },
        { from: 6, to: 10, expected: 'beta', insert: 'BETA' }
      ],
      diff: [
        { lines: [{ type: 'remove', text: 'alpha' }, { type: 'add', text: 'ALPHA' }] },
        { lines: [{ type: 'remove', text: 'beta' }, { type: 'add', text: 'BETA' }] }
      ]
    }
  ];

  const review = createDiffReviewElement(syncChanges);
  review.container.querySelector('[data-diff-hunk-reject]').click();
  review.decideFileChange('main.tex', true);

  assert.equal(review.getPendingCount(), 0);
  assert.deepEqual(
    review.getAcceptedChanges()[0]?.patches,
    [syncChanges[0].patches[1]]
  );
});

test('auto recompile is based on successfully applied Overleaf writes', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const runTaskBody = contentScript.match(/async function runTask\(\) \{[\s\S]*?\n  function buildCodexRunParams/)?.[0] || '';
  const applySyncBody = contentScript.match(/async function applySyncChangesToOverleaf[\s\S]*?\n  async function refreshProjectMirrorAfterWriteback/)?.[0] || '';

  assert.doesNotMatch(runTaskBody, /response\.result\.syncChanges[\s\S]*autoRecompileAfterWriteback/);
  assert.match(applySyncBody, /const appliedPaths = getAppliedOperationPaths\(applied\)/);
  assert.match(applySyncBody, /autoRecompileAfterWriteback\(appliedPaths, saveVerification\)/);
  assert.match(contentScript, /preferUiClick:\s*true/);
});

test('@compile-log context is preserved across Codex run retries', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const runTaskBody = contentScript.match(/async function runTask\(\) \{[\s\S]*?\n  function buildCodexRunParams/)?.[0] || '';

  assert.match(contentScript, /function buildCodexRunParams\(/);
  assert.match(runTaskBody, /compileLogContext = await resolveCompileLogContext\(\)/);
  assert.match(runTaskBody, /mirror_stale[\s\S]*buildCodexRunParams\([\s\S]*compileLogContext/);
  assert.match(runTaskBody, /thread_resume_failed[\s\S]*buildCodexRunParams\([\s\S]*compileLogContext/);
});

test('runTask freezes submitted custom instructions for initial and retry codex runs', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const runTaskBody = contentScript.match(/async function runTask\(\) \{[\s\S]*?\n  function buildCodexRunParams/)?.[0] || '';
  const submittedModeIndex = runTaskBody.indexOf('const submittedMode = state.mode');
  const submittedReviewingIndex = runTaskBody.indexOf('const submittedRequireReviewing = state.requireReviewing === true');
  const submittedCustomInstructionsIndex = runTaskBody.indexOf('const submittedCustomInstructions = getCustomInstructionsForCurrentProject()');
  const taskIndex = runTaskBody.indexOf('const task = state.task.trim()');
  const runParamBlocks = Array.from(runTaskBody.matchAll(/buildCodexRunParams\(\{[\s\S]*?submittedMode\s*\}/g))
    .map(match => match[0]);

  assert.match(contentScript, /function getCustomInstructionsForCurrentProject\(/);
  assert.ok(submittedModeIndex >= 0, 'runTask should freeze the submitted mode');
  assert.ok(submittedReviewingIndex > submittedModeIndex, 'runTask should freeze reviewing after mode');
  assert.ok(
    submittedCustomInstructionsIndex > submittedReviewingIndex,
    'runTask should freeze custom instructions with the submitted run options'
  );
  assert.ok(
    taskIndex > submittedCustomInstructionsIndex,
    'runTask should freeze custom instructions before later run setup can observe settings changes'
  );
  assert.equal(
    runParamBlocks.length,
    3,
    'initial, mirror-stale retry, and thread-resume run params should be visible'
  );
  for (const block of runParamBlocks) {
    assert.match(block, /customInstructions:\s*submittedCustomInstructions/);
    assert.doesNotMatch(block, /getCustomInstructionsForCurrentProject\(\)/);
  }
});

test('content script run-param wrapper uses explicit custom instructions before falling back to getter', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const wrapperBody = contentScript.match(/function buildCodexRunParams\(\{[\s\S]*?\n  function appendRunCancelledReport/)?.[0] || '';
  const wrapperSource = wrapperBody.replace(/\n  function appendRunCancelledReport$/, '');
  const harness = Function(`
    let getterCalls = 0;
    let getterValue = 'fresh getter value';
    const runController = {
      buildCodexRunParams(params) {
        return params;
      }
    };
    const state = {
      mode: 'auto',
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
      codexOverleafSkills: [],
      codexOverleafSkillEnabled: {}
    };
    function getCurrentProjectId() { return 'project-123'; }
    function getCustomInstructionsForCurrentProject() {
      getterCalls++;
      return getterValue;
    }
    function getCodexOverleafSkillEnabled() {
      const map = state.codexOverleafSkillEnabled;
      return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
    }
    function isCodexOverleafSkillEnabled(skillId) {
      const map = getCodexOverleafSkillEnabled();
      if (!Object.prototype.hasOwnProperty.call(map, skillId)) {
        return true;
      }
      return map[skillId] !== false;
    }
    function getEnabledCodexOverleafSkillIds() {
      const skills = Array.isArray(state.codexOverleafSkills) ? state.codexOverleafSkills : [];
      return skills
        .map(skill => String(skill && skill.id || '').trim())
        .filter(id => id && isCodexOverleafSkillEnabled(id));
    }
    ${wrapperSource}
    return {
      buildCodexRunParams,
      setGetterValue(value) { getterValue = value; },
      getGetterCalls: () => getterCalls
    };
  `)();

  const explicit = harness.buildCodexRunParams({
    task: '润色摘要',
    customInstructions: 'submitted frozen instructions'
  });
  assert.equal(explicit.customInstructions, 'submitted frozen instructions');
  assert.equal(harness.getGetterCalls(), 0);

  harness.setGetterValue('fallback getter instructions');
  const fallback = harness.buildCodexRunParams({ task: '检查语法' });
  assert.equal(fallback.customInstructions, 'fallback getter instructions');
  assert.equal(harness.getGetterCalls(), 1);
  assert.match(wrapperBody, /customInstructions:\s*customInstructions === undefined\s*\?\s*getCustomInstructionsForCurrentProject\(\)\s*:\s*customInstructions/);
});

test('warm mirror stale retry fetches a real snapshot before full-sync retry', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const staleRetryBody = contentScript.match(/if \(!response\.ok && response\.error\?\.code === 'mirror_stale' && useExistingMirror\) \{[\s\S]*?\n      \}/)?.[0] || '';

  assert.match(staleRetryBody, /const staleRetry = await prepareMirrorStaleRetry/);
  assert.match(staleRetryBody, /project = staleRetry\.project/);
  assert.match(staleRetryBody, /getRunProjectSnapshot\(\)/);
  assert.ok(
    staleRetryBody.indexOf('getRunProjectSnapshot()') < staleRetryBody.indexOf('useExistingMirror: false'),
    'mirror_stale retry must fetch a real snapshot before disabling mirror reuse'
  );
});

test('warm mirror writeback does not seed new empty files as existing base files', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const helperBody = contentScript.match(/function mergeProjectWithSyncChangeBaseFiles\(project = \{\}, syncChanges = \[\]\) \{[\s\S]*?\n  \}/)?.[0] || '';
  const existsHelperBody = contentScript.match(/function syncChangeHasPreviousFile\(change = \{\}\) \{[\s\S]*?\n  \}/)?.[0] || '';
  const helper = Function(`${existsHelperBody}\nreturn (${helperBody});`)();
  const merged = helper({ files: [] }, [
    { type: 'write', path: 'new-empty.tex', previousContent: '', content: 'new' },
    { type: 'write', path: 'existing.tex', previousExists: true, previousContent: '', content: 'changed' },
    { type: 'write', path: 'empty-existing.tex', previousExists: true, previousContent: '', content: 'now not empty' },
    { type: 'write', path: 'legacy-existing.tex', previousContent: 'before', content: 'after' }
  ]);

  assert.deepEqual(merged.files.map(file => file.path), ['existing.tex', 'empty-existing.tex', 'legacy-existing.tex']);
  assert.doesNotMatch(helperBody, /typeof change\.previousContent !== 'string'/);
  assert.match(existsHelperBody, /change\.previousExists === true|change\.baselineExists === true/);
});

test('mirror prefetch treats expected busy failures as non-retained skips', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const prefetchBody = contentScript.match(/async function syncMirrorPrefetch[\s\S]*?\n  function/)?.[0] || '';
  const skipHelperBody = contentScript.match(/function isExpectedPrefetchSkip[\s\S]*?\n  async function syncMirrorPrefetch/)?.[0] || '';

  assert.match(prefetchBody, /isExpectedPrefetchSkip/);
  assert.match(prefetchBody, /return \{ ok: false, skipped: true/);
  assert.match(skipHelperBody, /project_locked/);
  assert.match(skipHelperBody, /project_changed/);
});

test('warm synthetic runs announce mirror reuse without logging empty snapshot copy', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const runTaskBody = contentScript.match(/async function runTask\(\) \{[\s\S]*?\n  async function preflightWriteSafety/)?.[0] || '';
  const initialRunBody = runTaskBody.split(/\/\/ Handle mirror_stale error by retrying with full sync/)[0] || '';
  const initialRunLines = initialRunBody.split('\n');
  const snapshotLogLineIndex = initialRunLines.findIndex(line => line.includes('appendLog(formatProjectSnapshotUserLog(project))'));

  assert.match(initialRunBody, /if \(!useExistingMirror\) \{[\s\S]*formatProjectSnapshotUserLog\(project\)/);
  assert.ok(snapshotLogLineIndex > 0);
  assert.match(initialRunLines[snapshotLogLineIndex - 1], /if \(!useExistingMirror\) \{/);
});

test('compile page bridge calls use long-running timeouts', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );

  assert.match(contentScript, /function getPageBridgeTimeoutMs\(method\)/);
  assert.match(contentScript, /const COMPILE_PAGE_BRIDGE_TIMEOUT_MS\s*=\s*75000/);
  assert.match(contentScript, /method === 'triggerCompile' \|\| method === 'getCompileLog'/);
  assert.match(contentScript, /return COMPILE_PAGE_BRIDGE_TIMEOUT_MS/);
  assert.match(contentScript, /const timeoutMs = getPageBridgeTimeoutMs\(method\)/);
});

test('tracked-change undo page bridge calls have enough time to reject many changes', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const timeoutBody = contentScript.match(/function getPageBridgeTimeoutMs\(method\) \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.match(timeoutBody, /method === 'rejectTrackedChanges'/);
  assert.match(timeoutBody, /return 120000/);
});

test('partial writeback report tells the user what already changed and how to recover', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const appendApplyResultBody = contentScript.match(/function appendApplyResult\(result\) \{[\s\S]*?\n  function formatOperationType/)?.[0] || '';
  const partialWarningIndex = contentScript.indexOf('function appendPartialWritebackWarning');
  const appendApplyIndex = contentScript.indexOf('function appendApplyResult');

  assert.match(contentScript, /function appendPartialWritebackWarning\(/);
  assert.ok(partialWarningIndex > -1);
  assert.ok(appendApplyIndex > -1);
  assert.ok(partialWarningIndex < appendApplyIndex);
  assert.doesNotMatch(appendApplyResultBody, /function appendPartialWritebackWarning/);
  assert.match(contentScript, /部分写入已完成/);
  assert.match(contentScript, /写入被跳过/);
  assert.match(contentScript, /function formatWritebackSkippedNextStep/);
  assert.match(contentScript, /这轮没有任何内容写入。请查看跳过原因，处理后重试。/);
  assert.match(contentScript, /undoRun/);
  assert.match(contentScript, /undoPartialRun/);
  assert.match(contentScript, /recordUndoFromApply\(project, applied\)[\s\S]*appendPartialWritebackWarning\(applied\)/);
  assert.match(contentScript, /appendPartialWritebackWarning\(applied\)/);
});

test('undo flow blocks legacy full-file replaceAll restores that would mark whole documents changed', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const undoRunBody = contentScript.match(/async function undoRun\(runId\) \{[\s\S]*?\n  function recordUndoFromApply/)?.[0] || '';

  assert.match(contentScript, /const MAX_SAFE_UNDO_REPLACEALL_CHARS/);
  assert.match(contentScript, /function findUnsafeFullFileUndoOperation\(/);
  assert.match(undoRunBody, /findUnsafeFullFileUndoOperation\(undoOperations,\s*\{/);
  assert.match(undoRunBody, /allowSnapshotRestore:\s*undoRestore\.snapshotRestore/);
  assert.match(contentScript, /undoUnsafeFullFileTitle/);
});

test('undo flow uses no-trace restoring instead of requiring Reviewing write mode', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const undoRunBody = contentScript.match(/async function undoRun\(runId\) \{[\s\S]*?\n  function findUnsafeFullFileUndoOperation/)?.[0] || '';

  assert.doesNotMatch(undoRunBody, /ensureReviewingBeforeWrite\(run\.undoOperations\)/);
  assert.match(undoRunBody, /reviewingPolicy:\s*'no-trace-undo'/);
  assert.match(contentScript, /undoNoTraceTitle/);
});

test('no-trace undo restores original file snapshots in one operation per file', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const undoRunBody = contentScript.match(/async function undoRun\(runId\) \{[\s\S]*?\n  async function undoRunTrackedChanges/)?.[0] || '';
  const recordUndoBody = contentScript.match(/function recordUndoFromApply\(project, applyResult\) \{[\s\S]*?\n  function normalizeApplyTrackedChanges/)?.[0] || '';

  assert.match(contentScript, /function buildNoTraceUndoRestoreOperations\(run\)/);
  assert.match(contentScript, /function hasNoTraceSnapshotUndo\(run\)/);
  assert.match(contentScript, /buildSnapshotRestoreUndo/);
  assert.match(undoRunBody, /const undoRestore = buildNoTraceUndoRestore\(run\)/);
  assert.match(undoRunBody, /const undoOperations = undoRestore\.operations/);
  assert.match(undoRunBody, /operations:\s*undoOperations/);
  assert.match(undoRunBody, /baseFiles:\s*run\.undoBaseFiles \|\| \[\]/);
  assert.match(recordUndoBody, /record\.undoExpectedFiles = selectExpectedFilesForTrackedUndo\(project, combinedAppliedOperations, \[\]\)/);
  assert.doesNotMatch(recordUndoBody, /record\.undoExpectedFiles = \[\]/);
});

test('no-trace undo marks button applied when verified restore succeeds despite stale leftover skips', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const undoRunBody = contentScript.match(/async function undoRun\(runId\) \{[\s\S]*?\n  async function undoRunTrackedChanges/)?.[0] || '';

  assert.match(contentScript, /function isUndoResultEffectivelyApplied\(run, result\)/);
  assert.match(undoRunBody, /const undoApplied = isUndoResultEffectivelyApplied\(run, result\)/);
  assert.match(undoRunBody, /status:\s*undoApplied \? 'completed' : result\.skipped\?\.length \? 'failed' : 'completed'/);
  assert.match(undoRunBody, /setRunUndoStatus\(runId,\s*undoApplied \? 'applied' : 'partial'\)/);
});

test('reviewing write undo rejects Overleaf tracked changes instead of text patching', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const undoRunBody = contentScript.match(/async function undoRun\(runId\) \{[\s\S]*?\n  function appendUndoReviewingPolicyEvent/)?.[0] || '';
  const recordUndoBody = contentScript.match(/function recordUndoFromApply\(project, applyResult\) \{[\s\S]*?\n  function appendRunRecordEvent/)?.[0] || '';

  assert.match(undoRunBody, /rejectTrackedChanges/);
  assert.match(undoRunBody, /run\.undoTrackedChanges/);
  assert.match(recordUndoBody, /applyResult\?\.trackedChanges/);
  assert.match(recordUndoBody, /undoTrackedChanges/);
  assert.match(recordUndoBody, /undoCheckpointMissing/);
});

test('reviewing write undo passes post-run content so Overleaf native undo can revert the whole transaction', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const pageBridge = fs.readFileSync(
    path.join(__dirname, '../extension/src/pageBridge.js'),
    'utf8'
  );
  const writebackRouter = fs.readFileSync(
    path.join(__dirname, '../extension/src/page/writebackRouter.js'),
    'utf8'
  );
  const undoRunBody = contentScript.match(/async function undoRunTrackedChanges\(runId, run\) \{[\s\S]*?\n  function getRunUndoCount/)?.[0] || '';
  const undoCountBody = contentScript.match(/function getRunUndoCount\(run\) \{[\s\S]*?\n  function appendUndoReviewingPolicyEvent/)?.[0] || '';
  const recordUndoBody = contentScript.match(/function recordUndoFromApply\(project, applyResult\) \{[\s\S]*?\n  function normalizeApplyTrackedChanges/)?.[0] || '';

  assert.match(contentScript, /buildExpectedFilesAfterOperations/);
  assert.match(contentScript, /function buildTrackedUndoPostFiles\(run\)/);
  assert.match(contentScript, /function hasTrackedEditorUndo\(run\)/);
  assert.match(undoRunBody, /postFiles:\s*buildTrackedUndoPostFiles\(run\)/);
  assert.match(contentScript, /hasTrackedEditorUndo\(run\)/);
  assert.match(undoCountBody, /hasTrackedEditorUndo\(run\)\s*\?\s*1\s*:\s*0/);
  assert.match(recordUndoBody, /hasTrackedEditorUndo\(record\)/);
  assert.match(recordUndoBody, /undoCheckpointNative/);
  assert.match(writebackRouter, /function rejectTrackedChangesViaEditorUndo/);
  assert.match(writebackRouter, /rejectTrackedChangesViaEditorUndo\(expectedFiles,\s*postFiles,\s*applied\)[\s\S]*?if \(!trackedChanges\.length\)/);
  assert.match(writebackRouter, /function findEditorUndoControl/);
  assert.match(writebackRouter, /method:\s*'overleaf-editor-undo'/);
});

test('change preview is grouped by file with edit evidence instead of raw operation counts', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );

  assert.match(contentScript, /function groupOperationsByFile\(/);
  assert.match(contentScript, /function formatFileChangePreview\(/);
  assert.match(contentScript, /patches/);
  assert.match(contentScript, /局部修改/);
  assert.match(contentScript, /find/);
  assert.match(contentScript, /replace/);
  assert.doesNotMatch(contentScript, /replaceAll: change\.content \|\| ''/);
  assert.doesNotMatch(contentScript, /修改计划：编辑 \$\{summary\.counts\.edit/);
});

test('stale write copy explains user or collaborator edits without snapshot jargon', () => {
  const staleGuard = fs.readFileSync(
    path.join(__dirname, '../extension/src/shared/staleGuard.js'),
    'utf8'
  );

  assert.match(staleGuard, /任务执行期间被你或协作者改过/);
  assert.match(staleGuard, /Codex 没有覆盖它/);
  assert.doesNotMatch(staleGuard, /task-start snapshot/);
  assert.doesNotMatch(staleGuard, /captured the project snapshot/);
});

test('confirmation prompts render as Codex plugin dialogs instead of browser page alerts', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );

  assert.doesNotMatch(contentScript, /window\.confirm\s*\(/);
  assert.match(contentScript, /data-plugin-confirm/);
  assert.match(contentScript, /async function showPluginConfirm\(/);
  assert.match(contentScript, /confirmBrand/);
  const confirmBody = contentScript.match(/async function showPluginConfirm\([\s\S]*?\n  function buildCodexRunParams/)?.[0] || '';
  assert.match(confirmBody, /assets\/icons\/codex-overleaf-dialog-icon\.png/);
  assert.doesNotMatch(confirmBody, /assets\/icons\/codex-overleaf-icon\.png/);
  assert.doesNotMatch(confirmBody, /assets\/icons\/icon32\.png/);
  assert.equal(
    fs.existsSync(path.join(__dirname, '../extension/assets/icons/codex-overleaf-dialog-icon.png')),
    true
  );
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../extension/manifest.json'), 'utf8'));
  assert.equal(
    manifest.web_accessible_resources[0].resources.includes('assets/icons/codex-overleaf-dialog-icon.png'),
    true
  );
  assert.match(css, /\.codex-plugin-confirm/);
  assert.match(css, /\.codex-plugin-confirm-card/);
});

test('English locale is applied to dialogs, diff review, undo controls, and transcripts', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const diffReviewPanel = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/diffReviewPanel.js'),
    'utf8'
  );
  const i18n = fs.readFileSync(
    path.join(__dirname, '../extension/src/shared/i18n.js'),
    'utf8'
  );

  const confirmBody = contentScript.match(/async function showPluginConfirm\([\s\S]*?\n  function buildCodexRunParams/)?.[0] || '';
  const undoBody = contentScript.match(/function configureUndoButton\(root, run\) \{[\s\S]*?\n  function refreshRunCard/)?.[0] || '';
  const transcriptCallBody = contentScript.match(/function appendNativeEvent\(event\) \{[\s\S]*?\n  function appendRunEvent/)?.[0] || '';
  const completionBody = contentScript.match(/function appendCompletionReport\(input = \{\}\) \{[\s\S]*?\n  function formatCompletionWork/)?.[0] || '';

  assert.match(i18n, /confirmBrand:\s*'Codex Confirm'/);
  assert.match(i18n, /diffAcceptAll:\s*'Accept all'/);
  assert.match(i18n, /undoRun:\s*'Undo changes'/);
  assert.match(confirmBody, /brand\.textContent = tr\('confirmBrand'\)/);
  assert.match(diffReviewPanel, /tr\('diffAccepted'\)/);
  assert.match(diffReviewPanel, /tr\('diffAcceptAll'\)/);
  assert.match(undoBody, /tr\('undoRun'\)/);
  assert.match(undoBody, /tr\('undoApplied'\)/);
  assert.match(transcriptCallBody, /mapAgentEventToActivity\(event,\s*\{\s*locale:\s*getLocale\(\)\s*\}\)/);
  assert.match(completionBody, /locale:\s*getLocale\(\)/);
});

test('page bridge messages require same-origin responses in both directions', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const pageBridge = fs.readFileSync(
    path.join(__dirname, '../extension/src/pageBridge.js'),
    'utf8'
  );

  assert.match(contentScript, /event\.origin !== window\.location\.origin/);
  assert.match(pageBridge, /event\.origin !== window\.location\.origin/);
  assert.match(contentScript, /pageBridgeVersion !== CodexOverleafCompatibility\?\.BUILD_TARGET_VERSION/);
  assert.match(pageBridge, /pageBridgeVersion:\s*PAGE_BRIDGE_INSTALL_VERSION/);
  assert.match(pageBridge, /__codexOverleafPageBridgeInstalledVersion/);
});

test('page bridge exposes a read-only realtime OT observer', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const pageBridge = fs.readFileSync(
    path.join(__dirname, '../extension/src/pageBridge.js'),
    'utf8'
  );
  const injectPageBridgeBody = contentScript.match(/async function injectPageBridge\(\) \{[\s\S]*?\n  \}/)?.[0] || '';
  const optionalOtBody = contentScript.match(/async function injectOptionalOtDependencies\(\) \{[\s\S]*?\n  \}/)?.[0] || '';
  const pageBridgeScripts = Array.from(
    injectPageBridgeBody.matchAll(/injectScriptOnce\('([^']+)'/g),
    match => match[1]
  );
  const optionalScripts = Array.from(
    optionalOtBody.matchAll(/injectScriptOnce\('([^']+)'/g),
    match => match[1]
  );
  const otTextIndex = optionalScripts.indexOf('src/shared/otText.js');
  const observerIndex = optionalScripts.indexOf('src/page/overleafRealtimeObserver.js');
  const capabilityIndex = pageBridgeScripts.indexOf('src/page/pageBridgeCapability.js');
  const pageBridgeIndex = pageBridgeScripts.indexOf('src/pageBridge.js');

  assert.ok(optionalOtBody, 'content script keeps optional OT dependency loading separate from page bridge loading');
  assert.ok(otTextIndex > -1, 'content script explicitly injects the OT text helper into the page world when available');
  assert.ok(observerIndex > -1, 'content script explicitly injects the realtime observer into the page world when available');
  assert.ok(capabilityIndex > -1, 'content script injects the page bridge capability guard');
  assert.ok(pageBridgeIndex > -1, 'content script injects the page bridge');
  assert.ok(otTextIndex < observerIndex, 'OT text helper loads before the realtime observer');
  assert.ok(capabilityIndex < pageBridgeIndex, 'page bridge capability guard loads before the page bridge');
  assert.match(injectPageBridgeBody, /await injectOptionalOtDependencies\(\)[\s\S]*await injectScriptOnce\('src\/pageBridge\.js'/);
  assert.match(optionalOtBody, /try\s*\{[\s\S]*src\/shared\/otText\.js[\s\S]*src\/page\/overleafRealtimeObserver\.js[\s\S]*\}\s*catch \(_error\) \{/);
  assert.match(pageBridge, /CodexOverleafRealtimeObserver\.create/);
  assert.match(pageBridge, /method === 'startOtObserver'/);
  assert.match(pageBridge, /method === 'stopOtObserver'/);
  assert.match(pageBridge, /method === 'getOtStatus'/);
  assert.match(pageBridge, /method === 'drainOtEvents'/);
  assert.doesNotMatch(pageBridge, /\b(?:writeOt|applyOt|sendOt)\b/);
});

test('header exposes project custom instructions settings and editor surface', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const i18n = fs.readFileSync(
    path.join(__dirname, '../extension/src/shared/i18n.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );
  const panelRenderer = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/panelRenderer.js'),
    'utf8'
  );
  const settingsPanel = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/settingsPanel.js'),
    'utf8'
  );
  const headerActions = panelRenderer.match(/<div class="codex-vscode-head-actions"[\s\S]*data-custom-instructions-settings[\s\S]*?<\/div>/)?.[0] || '';
  const settingsSource = `${contentScript}\n${settingsPanel}`;

  assert.match(headerActions, /data-new-session/);
  assert.match(headerActions, /data-custom-instructions-settings/);
  assert.ok(
    headerActions.indexOf('data-new-session') < headerActions.indexOf('data-custom-instructions-settings'),
    'custom instructions settings must be the rightmost header action after New Session'
  );
  assert.match(settingsSource, /data-custom-instructions-panel/);
  assert.match(settingsSource, /data-custom-instructions-input/);
  assert.doesNotMatch(settingsSource, /data-custom-instructions-save/);
  assert.doesNotMatch(settingsSource, /data-custom-instructions-learn-more/);
  for (const key of [
    'personalizationConfig',
    'customInstructionsPlaceholder',
    'settingsScopeProjectTitle',
    'settingsScopeGlobalTitle'
  ]) {
    assert.match(settingsSource, new RegExp(`data-i18n="${key}"|tr\\('${key}'\\)`), `settings panel should use ${key}`);
    assert.match(i18n, new RegExp(`${key}:\\s*'`), `i18n should define ${key}`);
  }
  assert.match(css, /\.codex-custom-instructions-panel/);
  assert.match(css, /\.codex-custom-instructions-input/);
});

test('project custom instructions Learn more link has been removed', () => {
  const settingsPanel = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/settingsPanel.js'),
    'utf8'
  );
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const contentSurface = `${contentScript}\n${settingsPanel}`;

  assert.doesNotMatch(contentSurface, /data-custom-instructions-learn-more/);
  assert.doesNotMatch(contentScript, /showCustomInstructionsLearnMore/);
  assert.doesNotMatch(contentScript, /customInstructionsLearnMoreToast/);
});

test('project custom instructions editor auto-saves on change and restores by project', async () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const harness = Function(`
    let currentProjectId = 'project_a';
    let savedCount = 0;
    let focused = false;
    let customInstructionsEditorProjectId = '';
    let customInstructionsEditorValue = '';
    let state = {
      customInstructionsByProject: {}
    };
    const customInstructionsInput = {
      value: '',
      placeholder: '',
      focus() { focused = true; }
    };
    const settingsButton = {
      dataset: { view: 'settings' },
      setAttribute(name, value) { this[name] = value; }
    };
    const fakeInput = (value = '') => ({ value, checked: false });
    const controls = {
      '[data-custom-instructions-input]': customInstructionsInput,
      '[data-custom-instructions-settings]': settingsButton,
      '[data-reasoning]': fakeInput(),
      '[data-mode]': fakeInput('ask'),
      '[data-task]': fakeInput(),
      '[data-speed]': fakeInput('standard'),
      '[data-require-reviewing]': fakeInput(),
      '[data-auto-recompile]': fakeInput(),
      '[data-experimental-ot]': null,
      '[data-model]': null,
      '[data-project-settings-panel]': null
    };
    // panel.dataset.view drives the settings-visibility guard in readPanelInputs
    const panel = {
      dataset: { view: 'settings' },
      querySelector(selector) {
        return Object.prototype.hasOwnProperty.call(controls, selector) ? controls[selector] : null;
      },
      querySelectorAll() { return []; }
    };
    const settingsPanelInstance = {};
    const SettingsPanel = {
      show() {
        settingsButton.dataset.active = 'true';
        settingsButton.setAttribute('aria-expanded', 'true');
        customInstructionsInput.focus();
      },
      hide() {
        settingsButton.dataset.active = 'false';
        settingsButton.setAttribute('aria-expanded', 'false');
      },
      setStatus() {},
      clearStatus() {},
      isVisible() { return panel.dataset.view === 'settings'; },
      loadState() {},
      readState() {
        return {
          governanceRules: {},
          skillToggles: {}
        };
      }
    };
    const panelRendererInstance = {
      setView(v) { panel.dataset.view = v; }
    };
    function getCurrentProjectId() { return currentProjectId; }
    function closeDiagnosticsMenu() {}
    function closeDiagnosticsResult() {}
    function closeModelConfigPopover() {}
    function closeContextTray() {}
    function syncProjectSettingsEditorForProject() {}
    function refreshLocalSkills() { return Promise.resolve(); }
    function setGovernanceRulesForCurrentProject() {}
    function readGovernanceRulesFromSettings() { return {}; }
    function getSkillLoadingSettings() {
      return {
        loadCodexLocalSkills: state.loadCodexLocalSkills !== false,
        loadCodexOverleafSkills: state.loadCodexOverleafSkills !== false
      };
    }
    function setSkillLoadingSettings(settings) {
      if (settings && typeof settings === 'object') {
        state = { ...state, ...settings };
      }
    }
    function readSkillLoadingSettingsFromSettings() { return {}; }
    function renderLocalSkillList() {}
    function syncExperimentalOtToggleForProject() {}
    let lastExperimentalOtProjectId = '';
    function setExperimentalOtEnabledForProject() {}
    function updateActiveSession(s) { return s; }
    function readSelectedModelInput() { return ''; }
    function readSelectedSpeedInput() { return 'standard'; }
    function getRenderedModelEntries() { return []; }
    function renderSpeedOptions() {}
    function renderModelConfigChoices() {}
    function updateModelDisplay() {}
    function syncModeControls() {}
    function applySessionLabel() {}
    function renderSessionList() {}
    function tr(key) { return key; }
    async function saveState() { savedCount++; }
    ${extractFunction(contentScript, 'normalizeCustomInstructionsByProject')}
    ${extractFunction(contentScript, 'getCustomInstructionsForCurrentProject')}
    ${extractFunction(contentScript, 'setCustomInstructionsForProject')}
    ${extractFunction(contentScript, 'syncCustomInstructionsEditorForProject')}
    ${extractFunction(contentScript, 'clearProjectSettingsStatus')}
    ${extractFunction(contentScript, 'openCustomInstructionsSettings')}
    ${extractFunction(contentScript, 'closeCustomInstructionsSettings')}
    ${extractFunction(contentScript, 'setSettingsSaveStatus')}
    ${extractFunction(contentScript, 'readPanelInputs')}
    ${extractFunction(contentScript, 'persistPanelInputs')}
    return {
      input: customInstructionsInput,
      panel,
      settingsButton,
      getState: () => state,
      getSavedCount: () => savedCount,
      wasFocused: () => focused,
      navigate(projectId) {
        currentProjectId = projectId;
        syncCustomInstructionsEditorForProject(projectId);
      },
      openCustomInstructionsSettings,
      closeCustomInstructionsSettings,
      persistPanelInputs
    };
  `)();

  harness.openCustomInstructionsSettings();
  assert.equal(harness.wasFocused(), true);
  assert.equal(harness.panel.dataset.view, 'settings');

  harness.input.value = 'Use NeurIPS style and \\\\cref{}.';
  await harness.persistPanelInputs();
  assert.equal(
    harness.getState().customInstructionsByProject.project_a,
    'Use NeurIPS style and \\\\cref{}.'
  );
  assert.equal(harness.getSavedCount(), 1);

  harness.navigate('project_b');
  assert.equal(harness.input.value, '');

  harness.navigate('project_a');
  assert.equal(harness.input.value, 'Use NeurIPS style and \\\\cref{}.');
});

test('persistPanelInputs save-status lifecycle: success path ends at settingsSaved', async () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const statusHistory = [];
  const harness = Function('pushStatus', `
    let currentProjectId = 'project_a';
    let state = { customInstructionsByProject: {} };
    const customInstructionsInput = { value: '', placeholder: '', focus() {} };
    const settingsButton = { dataset: {}, setAttribute() {} };
    const statusEl = { set textContent(v) { pushStatus(v); } };
    const fakeInput = (value = '') => ({ value, checked: false });
    const controls = {
      '[data-custom-instructions-input]': customInstructionsInput,
      '[data-custom-instructions-settings]': settingsButton,
      '[data-reasoning]': fakeInput(),
      '[data-mode]': fakeInput('ask'),
      '[data-task]': fakeInput(),
      '[data-speed]': fakeInput('standard'),
      '[data-require-reviewing]': fakeInput(),
      '[data-auto-recompile]': fakeInput(),
      '[data-experimental-ot]': null,
      '[data-model]': null,
      '[data-project-settings-panel]': null,
      '[data-settings-save-status]': statusEl
    };
    const panel = {
      dataset: { view: 'settings' },
      querySelector(selector) {
        return Object.prototype.hasOwnProperty.call(controls, selector) ? controls[selector] : null;
      },
      querySelectorAll() { return []; }
    };
    function getCurrentProjectId() { return currentProjectId; }
    function setGovernanceRulesForCurrentProject() {}
    function readGovernanceRulesFromSettings() { return {}; }
    function getSkillLoadingSettings() {
      return { loadCodexLocalSkills: true, loadCodexOverleafSkills: true };
    }
    function setSkillLoadingSettings() {}
    function readSkillLoadingSettingsFromSettings() { return {}; }
    function renderLocalSkillList() {}
    function syncExperimentalOtToggleForProject() {}
    let lastExperimentalOtProjectId = '';
    function setExperimentalOtEnabledForProject() {}
    function updateActiveSession(s) { return s; }
    function readSelectedModelInput() { return ''; }
    function readSelectedSpeedInput() { return 'standard'; }
    function getRenderedModelEntries() { return []; }
    function renderSpeedOptions() {}
    function renderModelConfigChoices() {}
    function updateModelDisplay() {}
    function syncModeControls() {}
    function applySessionLabel() {}
    function renderSessionList() {}
    function tr(key) { return key; }
    async function saveState() {}
    ${extractFunction(contentScript, 'normalizeCustomInstructionsByProject')}
    ${extractFunction(contentScript, 'getCustomInstructionsForCurrentProject')}
    ${extractFunction(contentScript, 'setCustomInstructionsForProject')}
    ${extractFunction(contentScript, 'syncCustomInstructionsEditorForProject')}
    ${extractFunction(contentScript, 'clearProjectSettingsStatus')}
    ${extractFunction(contentScript, 'setSettingsSaveStatus')}
    ${extractFunction(contentScript, 'readPanelInputs')}
    ${extractFunction(contentScript, 'persistPanelInputs')}
    return { persistPanelInputs };
  `)(v => statusHistory.push(v));

  await harness.persistPanelInputs();
  assert.deepEqual(statusHistory, ['settingsSaving', 'settingsSaved'],
    'success path: status should be settingsSaving then settingsSaved');
});

test('persistPanelInputs save-status lifecycle: status ends at settingsSaved even when saveState rejects', async () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const statusHistory = [];
  const harness = Function('pushStatus', `
    let currentProjectId = 'project_a';
    let state = { customInstructionsByProject: {} };
    const customInstructionsInput = { value: '', placeholder: '', focus() {} };
    const settingsButton = { dataset: {}, setAttribute() {} };
    const statusEl = { set textContent(v) { pushStatus(v); } };
    const fakeInput = (value = '') => ({ value, checked: false });
    const controls = {
      '[data-custom-instructions-input]': customInstructionsInput,
      '[data-custom-instructions-settings]': settingsButton,
      '[data-reasoning]': fakeInput(),
      '[data-mode]': fakeInput('ask'),
      '[data-task]': fakeInput(),
      '[data-speed]': fakeInput('standard'),
      '[data-require-reviewing]': fakeInput(),
      '[data-auto-recompile]': fakeInput(),
      '[data-experimental-ot]': null,
      '[data-model]': null,
      '[data-project-settings-panel]': null,
      '[data-settings-save-status]': statusEl
    };
    const panel = {
      dataset: { view: 'settings' },
      querySelector(selector) {
        return Object.prototype.hasOwnProperty.call(controls, selector) ? controls[selector] : null;
      },
      querySelectorAll() { return []; }
    };
    function getCurrentProjectId() { return currentProjectId; }
    function setGovernanceRulesForCurrentProject() {}
    function readGovernanceRulesFromSettings() { return {}; }
    function getSkillLoadingSettings() {
      return { loadCodexLocalSkills: true, loadCodexOverleafSkills: true };
    }
    function setSkillLoadingSettings() {}
    function readSkillLoadingSettingsFromSettings() { return {}; }
    function renderLocalSkillList() {}
    function syncExperimentalOtToggleForProject() {}
    let lastExperimentalOtProjectId = '';
    function setExperimentalOtEnabledForProject() {}
    function updateActiveSession(s) { return s; }
    function readSelectedModelInput() { return ''; }
    function readSelectedSpeedInput() { return 'standard'; }
    function getRenderedModelEntries() { return []; }
    function renderSpeedOptions() {}
    function renderModelConfigChoices() {}
    function updateModelDisplay() {}
    function syncModeControls() {}
    function applySessionLabel() {}
    function renderSessionList() {}
    function tr(key) { return key; }
    async function saveState() { throw new Error('storage quota exceeded'); }
    ${extractFunction(contentScript, 'normalizeCustomInstructionsByProject')}
    ${extractFunction(contentScript, 'getCustomInstructionsForCurrentProject')}
    ${extractFunction(contentScript, 'setCustomInstructionsForProject')}
    ${extractFunction(contentScript, 'syncCustomInstructionsEditorForProject')}
    ${extractFunction(contentScript, 'clearProjectSettingsStatus')}
    ${extractFunction(contentScript, 'setSettingsSaveStatus')}
    ${extractFunction(contentScript, 'readPanelInputs')}
    ${extractFunction(contentScript, 'persistPanelInputs')}
    return { persistPanelInputs };
  `)(v => statusHistory.push(v));

  await assert.rejects(harness.persistPanelInputs());
  assert.deepEqual(statusHistory, ['settingsSaving', 'settingsSaved'],
    'error path: status must still end at settingsSaved despite saveState throwing');
});

test('project settings gear toggles the settings panel closed when already open', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const harness = Function(`
    let currentProjectId = 'project_a';
    let focused = false;
    let customInstructionsEditorProjectId = '';
    let customInstructionsEditorValue = '';
    let state = {
      customInstructionsByProject: {}
    };
    const customInstructionsInput = {
      value: '',
      placeholder: '',
      focus() { focused = true; }
    };
    const customInstructionsPanel = {
      hidden: true
    };
    const settingsButton = {
      dataset: {},
      setAttribute(name, value) { this[name] = value; }
    };
    const controls = {
      '[data-custom-instructions-input]': customInstructionsInput,
      '[data-custom-instructions-panel]': customInstructionsPanel,
      '[data-custom-instructions-settings]': settingsButton
    };
    const panel = {
      querySelector(selector) {
        return controls[selector] || null;
      }
    };
    const settingsPanelInstance = {};
    const SettingsPanel = {
      show() {
        customInstructionsPanel.hidden = false;
        settingsButton.dataset.active = 'true';
        settingsButton.setAttribute('aria-expanded', 'true');
        customInstructionsInput.focus();
      },
      hide() {
        customInstructionsPanel.hidden = true;
        settingsButton.dataset.active = 'false';
        settingsButton.setAttribute('aria-expanded', 'false');
      },
      isVisible() {
        return customInstructionsPanel.hidden === false;
      },
      setStatus() {},
      clearStatus() {},
      loadState() {}
    };
    const panelRendererInstance = null;
    function getCurrentProjectId() { return currentProjectId; }
    function closeDiagnosticsMenu() {}
    function closeDiagnosticsResult() {}
    function closeModelConfigPopover() {}
    function closeContextTray() {}
    function syncProjectSettingsEditorForProject() {}
    function refreshLocalSkills() { return Promise.resolve(); }
    function tr(key) { return key; }
    ${extractFunction(contentScript, 'normalizeCustomInstructionsByProject')}
    ${extractFunction(contentScript, 'syncCustomInstructionsEditorForProject')}
    ${extractFunction(contentScript, 'clearProjectSettingsStatus')}
    ${extractFunction(contentScript, 'openCustomInstructionsSettings')}
    ${extractFunction(contentScript, 'closeCustomInstructionsSettings')}
    ${extractFunction(contentScript, 'toggleCustomInstructionsSettings')}
    return {
      settingsPanel: customInstructionsPanel,
      settingsButton,
      wasFocused: () => focused,
      toggleCustomInstructionsSettings
    };
  `)();

  harness.toggleCustomInstructionsSettings();
  assert.equal(harness.settingsPanel.hidden, false);
  assert.equal(harness.settingsButton.dataset.active, 'true');
  assert.equal(harness.settingsButton['aria-expanded'], 'true');
  assert.equal(harness.wasFocused(), true);

  harness.toggleCustomInstructionsSettings();
  assert.equal(harness.settingsPanel.hidden, true);
  assert.equal(harness.settingsButton.dataset.active, 'false');
  assert.equal(harness.settingsButton['aria-expanded'], 'false');
});

test('project settings transient status is cleared when reopening the panel', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const harness = Function(`
    let currentProjectId = 'project_a';
    let focused = false;
    let customInstructionsEditorProjectId = '';
    let customInstructionsEditorValue = '';
    let state = {
      customInstructionsByProject: {}
    };
    const customInstructionsInput = {
      value: '',
      placeholder: '',
      focus() { focused = true; }
    };
    const customInstructionsPanel = {
      hidden: true
    };
    const settingsButton = {
      dataset: {},
      setAttribute(name, value) { this[name] = value; }
    };
    const projectSettingsStatus = {
      textContent: '',
      dataset: {}
    };
    const controls = {
      '[data-custom-instructions-input]': customInstructionsInput,
      '[data-custom-instructions-panel]': customInstructionsPanel,
      '[data-custom-instructions-settings]': settingsButton,
      '[data-project-settings-status]': projectSettingsStatus
    };
    const panel = {
      querySelector(selector) {
        return controls[selector] || null;
      }
    };
    const settingsPanelInstance = {};
    const SettingsPanel = {
      show() {
        customInstructionsPanel.hidden = false;
        settingsButton.dataset.active = 'true';
        settingsButton.setAttribute('aria-expanded', 'true');
        customInstructionsInput.focus();
      },
      hide() {
        customInstructionsPanel.hidden = true;
        settingsButton.dataset.active = 'false';
        settingsButton.setAttribute('aria-expanded', 'false');
      },
      setStatus(_instance, text, status) {
        projectSettingsStatus.textContent = text || '';
        projectSettingsStatus.dataset.status = status;
      },
      clearStatus() {
        projectSettingsStatus.textContent = '';
        delete projectSettingsStatus.dataset.status;
      },
      loadState() {}
    };
    const panelRendererInstance = null;
    function getCurrentProjectId() { return currentProjectId; }
    function closeDiagnosticsMenu() {}
    function closeDiagnosticsResult() {}
    function closeModelConfigPopover() {}
    function closeContextTray() {}
    function closeSlashMenu() {}
    function tx(english) { return english; }
    function tr(key) { return key; }
    function syncProjectSettingsEditorForProject() {}
    function refreshLocalSkills() { return Promise.resolve(); }
    ${extractFunction(contentScript, 'normalizeCustomInstructionsByProject')}
    ${extractFunction(contentScript, 'syncCustomInstructionsEditorForProject')}
    ${extractFunction(contentScript, 'setProjectSettingsStatus')}
    ${extractFunction(contentScript, 'clearProjectSettingsStatus')}
    ${extractFunction(contentScript, 'openCustomInstructionsSettings')}
    ${extractFunction(contentScript, 'closeCustomInstructionsSettings')}
    return {
      status: projectSettingsStatus,
      openCustomInstructionsSettings,
      closeCustomInstructionsSettings,
      setProjectSettingsStatus,
      wasFocused: () => focused
    };
  `)();

  harness.openCustomInstructionsSettings();
  harness.setProjectSettingsStatus('Codex Overleaf skill removed.', 'completed');
  assert.equal(harness.status.textContent, 'Codex Overleaf skill removed.');
  assert.equal(harness.status.dataset.status, 'completed');

  harness.closeCustomInstructionsSettings();
  harness.openCustomInstructionsSettings();

  assert.equal(harness.status.textContent, '');
  assert.notEqual(harness.status.dataset.status, 'completed');
  assert.equal(harness.wasFocused(), true);
});

test('mirror prefetch state sync preserves unsaved custom instructions for same project', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const harness = Function(`
    let currentProjectId = 'project_a';
    let state = {
      customInstructionsByProject: {
        project_a: 'Saved instructions'
      }
    };
    let customInstructionsEditorProjectId = '';
    let customInstructionsEditorValue = '';
    let mirrorPrefetchState = {
      inFlight: null,
      lastSuccessAt: 10,
      lastErrorAt: 0,
      lastError: null,
      timer: null,
      projectId: 'project_a'
    };
    const customInstructionsInput = {
      value: '',
      placeholder: ''
    };
    const panel = {
      dataset: { view: 'settings' },
      querySelector(selector) {
        if (selector === '[data-custom-instructions-input]') {
          return customInstructionsInput;
        }
        return null;
      }
    };
    const window = {
      clearTimeout() {}
    };
    function getCurrentProjectId() { return currentProjectId; }
    function tr(key) { return key; }
    function syncOtWarmMirrorStateForProject() {}
    ${extractFunction(contentScript, 'normalizeCustomInstructionsByProject')}
    ${extractFunction(contentScript, 'syncCustomInstructionsEditorForProject')}
    ${extractFunction(contentScript, 'syncMirrorPrefetchStateForProject')}
    return {
      input: customInstructionsInput,
      syncCustomInstructionsEditorForProject,
      syncMirrorPrefetchStateForProject
    };
  `)();

  harness.syncCustomInstructionsEditorForProject('project_a', { force: true });
  assert.equal(harness.input.value, 'Saved instructions');

  harness.input.value = 'Unsaved typed instructions';
  harness.syncMirrorPrefetchStateForProject();

  assert.equal(harness.input.value, 'Unsaved typed instructions');
});

test('stored project custom instructions are rehydrated before lightweight prefs are saved', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const loadBody = contentScript.match(/async function loadStoredState\(\) \{[\s\S]*?\n  async function saveState/)?.[0] || '';
  const saveBody = contentScript.match(/async function saveState\(\) \{[\s\S]*?\n  function appendStorageNoticeOnce/)?.[0] || '';

  assert.match(loadBody, /experimentalOtByProject:\s*prefs\.experimentalOtByProject \|\| \{\}/);
  assert.match(loadBody, /customInstructionsByProject:\s*prefs\.customInstructionsByProject \|\| \{\}/);
  assert.match(saveBody, /compactState\.experimentalOtByProject = state\.experimentalOtByProject/);
  assert.match(saveBody, /compactState\.customInstructionsByProject = state\.customInstructionsByProject/);
});

test('saveState merges latest lightweight prefs before saving project-scoped settings', async () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const StorageDbModule = require('../extension/src/shared/storageDb');
  const { prepareStateForStorage } = require('../extension/src/shared/sessionState');

  const harness = Function('StorageDbModule', 'prepareStateForStorage', `
    const savedPrefs = [];
    const storedSessionRecords = [];
    const deletedSessionIds = [];
    let loadPrefsCount = 0;
    let state = {
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      speedTier: 'standard',
      mode: 'confirm',
      locale: 'en',
      requireReviewing: true,
      autoRecompile: false,
      panelWidth: 420,
      activeSessionId: 'session_current',
      codexOverleafSkillEnabled: { 'venue-style': false },
      experimentalOtByProject: {
        project_a: false,
        project_b: false
      },
      customInstructionsByProject: {
        project_a: '',
        project_b: 'stale instructions from this tab'
      },
      sessions: [{
        id: 'session_current',
        title: 'Current task',
        titleSource: 'manual',
        focusFiles: [],
        codexThreadId: '',
        createdAt: '2026-05-06T00:00:00.000Z',
        updatedAt: '2026-05-06T00:01:00.000Z',
        runs: [{
          id: 'run_current',
          task: 'Current task',
          status: 'completed',
          statusText: 'Done 7s',
          startedAt: '2026-05-06T00:00:00.000Z',
          finishedAt: '2026-05-06T00:00:07.000Z',
          events: [{
            title: '本轮完成报告',
            status: 'completed',
            kind: 'report',
            detail: '结论：刷新后历史仍应显示这段回答。'
          }]
        }],
        history: [{
          task: 'Current task',
          result: '结论：刷新后历史仍应显示这段回答。',
          at: '2026-05-06T00:00:07.000Z'
        }],
        task: 'Current task',
        mode: 'confirm',
        model: 'gpt-5.4',
        reasoningEffort: 'high',
        speedTier: 'standard',
        requireReviewing: true
      }]
    };
    const latestPrefs = {
      storageSchemaVersion: 1,
      model: 'older-model',
      unknownFuturePref: { keep: true },
      autoRecompile: true,
      activeSessionByProject: {
        project_a: 'session_from_other_tab',
        project_b: 'session_b'
      },
      experimentalOtByProject: {
        project_a: true,
        project_b: true,
        project_c: false
      },
      customInstructionsByProject: {
        project_a: 'newer instructions from another tab',
        project_b: 'keep project b instructions',
        project_c: 'keep project c instructions'
      }
    };
    const StorageDb = {
      ...StorageDbModule,
      putRecords(_storeName, records) {
        storedSessionRecords.push(...records);
        return Promise.resolve(records);
      },
      getAllByIndex() {
        return Promise.resolve([{ id: 'old_project_session' }]);
      },
      deleteRecord(_storeName, id) {
        deletedSessionIds.push(id);
        return Promise.resolve();
      }
    };
    const Migration = {
      loadPrefs() {
        loadPrefsCount++;
        return Promise.resolve(JSON.parse(JSON.stringify(latestPrefs)));
      },
      savePrefs(prefs) {
        savedPrefs.push(JSON.parse(JSON.stringify(prefs)));
        return Promise.resolve();
      }
    };
    const window = {
      CodexOverleafStorageDb: StorageDb,
      CodexOverleafStorageMigration: Migration
    };
    function getCurrentProjectId() { return 'project_a'; }
    function getCodexOverleafSkillEnabled() {
      const map = state.codexOverleafSkillEnabled;
      return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
    }
    ${extractFunction(contentScript, 'normalizeExperimentalOtByProject')}
    ${extractFunction(contentScript, 'normalizeCustomInstructionsByProject')}
    ${extractFunction(contentScript, 'saveState')}
    return {
      saveState,
      getSavedPrefs: () => savedPrefs[0],
      getLoadPrefsCount: () => loadPrefsCount,
      getStoredSessionRecords: () => storedSessionRecords,
      getDeletedSessionIds: () => deletedSessionIds
    };
  `)(StorageDbModule, prepareStateForStorage);

  await harness.saveState();

  assert.equal(harness.getLoadPrefsCount(), 1);
  assert.deepEqual(harness.getSavedPrefs().unknownFuturePref, { keep: true });
  assert.equal(harness.getSavedPrefs().autoRecompile, false);
  assert.deepEqual(harness.getSavedPrefs().activeSessionByProject, {
    project_a: 'session_current',
    project_b: 'session_b'
  });
  assert.deepEqual(harness.getSavedPrefs().experimentalOtByProject, {
    project_a: false,
    project_b: true,
    project_c: false
  });
  assert.deepEqual(harness.getSavedPrefs().customInstructionsByProject, {
    project_a: '',
    project_b: 'keep project b instructions',
    project_c: 'keep project c instructions'
  });
  assert.equal(harness.getStoredSessionRecords().length, 1);
  assert.equal(harness.getStoredSessionRecords()[0].task, 'Current task');
  assert.equal(harness.getStoredSessionRecords()[0].history[0].result, '结论：刷新后历史仍应显示这段回答。');
  assert.equal(harness.getStoredSessionRecords()[0].runs[0].task, 'Current task');
  assert.equal(harness.getStoredSessionRecords()[0].runs[0].statusText, 'Done 7s');
  assert.equal(harness.getStoredSessionRecords()[0].runs[0].events[0].detail, '结论：刷新后历史仍应显示这段回答。');
  assert.deepEqual(harness.getDeletedSessionIds(), ['old_project_session']);
  assert.deepEqual(harness.getSavedPrefs().codexOverleafSkillEnabled, { 'venue-style': false });
});

test('experimental OT sync ignores stale responses and reverts failed starts to default off', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const syncBody = contentScript.match(/async function syncOtWarmMirrorController\(\) \{[\s\S]*?\n  \}/)?.[0] || '';
  const failBody = contentScript.match(/function handleFailedOtStart\(projectId, requestId\) \{[\s\S]*?\n  \}/)?.[0] || '';
  const projectChangeBody = contentScript.match(/function syncOtWarmMirrorStateForProject\(\) \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.match(contentScript, /let otSyncRequestId\s*=\s*0/);
  assert.match(contentScript, /function syncExperimentalOtToggleForProject\(/);
  assert.match(syncBody, /const projectId = getCurrentProjectId\(\)/);
  assert.match(syncBody, /const requestId = \+\+otSyncRequestId/);
  assert.match(syncBody, /const enabled = isExperimentalOtEnabledForProject\(projectId\)/);
  assert.match(syncBody, /isCurrentOtSync\(requestId,\s*projectId\)/);
  assert.match(syncBody, /getCurrentProjectId\(\) !== projectId/);
  assert.match(syncBody, /handleStaleOtStartResponse\(projectId,\s*requestId\)/);
  assert.match(syncBody, /isSuccessfulOtBridgeResponse\(response\)/);
  assert.match(syncBody, /handleFailedOtStart\(projectId,\s*requestId\)/);
  assert.match(failBody, /setExperimentalOtEnabledForProject\(projectId,\s*false\)/);
  assert.match(failBody, /experimentalOtCheckbox\.checked = false/);
  assert.match(failBody, /updateOtStatusDisplay\('unavailable'\)/);
  assert.match(failBody, /saveStateSoon\(\)/);
  assert.match(projectChangeBody, /otWarmMirrorProjectId = projectId/);
  assert.match(projectChangeBody, /syncExperimentalOtToggleForProject\(projectId\)/);
  assert.match(projectChangeBody, /otSyncRequestId\+\+/);
  assert.match(projectChangeBody, /callPageBridge\('stopOtObserver',\s*\{\s*\}\)/);
  assert.match(projectChangeBody, /syncOtWarmMirrorController\(\)/);
});

test('experimental OT input persistence does not leak checked state after project change', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const harness = Function(`
    let currentProjectId = 'project_a';
    let currentOtStatus = 'observing';
    let lastExperimentalOtProjectId = 'project_a';
    let state = {
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      speedTier: 'standard',
      mode: 'confirm',
      task: '',
      requireReviewing: true,
      autoRecompile: true,
      experimentalOtByProject: { project_a: true }
    };
    const experimentalOtCheckbox = { checked: true };
    const controls = {
      '[data-reasoning]': { value: 'high' },
      '[data-mode]': { value: 'confirm' },
      '[data-task]': { value: '' },
      '[data-require-reviewing]': { checked: true },
      '[data-auto-recompile]': { checked: true },
      '[data-experimental-ot]': experimentalOtCheckbox
    };
    const panel = {
      querySelector(selector) {
        return controls[selector] || null;
      }
    };
    function getCurrentProjectId() { return currentProjectId; }
    function updateActiveSession(current, patch) { return { ...current, ...patch }; }
    function readSelectedModelInput() { return state.model; }
    function readSelectedSpeedInput() { return state.speedTier; }
    function updateOtStatusDisplay(status) { currentOtStatus = status; }
    function updateExperimentalOtToggleControl() {}
    ${extractFunction(contentScript, 'normalizeExperimentalOtByProject')}
    ${extractFunction(contentScript, 'isExperimentalOtEnabledForProject')}
    ${extractFunction(contentScript, 'setExperimentalOtEnabledForProject')}
    ${extractFunction(contentScript, 'syncExperimentalOtToggleForProject')}
    ${extractFunction(contentScript, 'readPanelInputs')}
    return {
      checkbox: experimentalOtCheckbox,
      getState: () => state,
      getStatus: () => currentOtStatus,
      navigate(projectId) { currentProjectId = projectId; },
      readPanelInputs
    };
  `)();

  assert.equal(harness.checkbox.checked, true);
  harness.navigate('project_b');
  harness.readPanelInputs();

  assert.equal(harness.checkbox.checked, false);
  assert.equal(harness.getState().experimentalOtByProject.project_a, true);
  assert.equal(harness.getState().experimentalOtByProject.project_b, false);
  assert.equal(harness.getStatus(), 'off');
});

test('experimental OT stop does not mark off when stop bridge fails', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const syncBody = contentScript.match(/async function syncOtWarmMirrorController\(\) \{[\s\S]*?\n  \}/)?.[0] || '';
  const disabledIndex = syncBody.indexOf('if (!enabled) {');
  const failedStopIndex = syncBody.indexOf('if (!isSuccessfulOtBridgeResponse(response))', disabledIndex);
  const unavailableIndex = syncBody.indexOf("updateOtStatusDisplay('unavailable')", failedStopIndex);
  const offIndex = syncBody.indexOf("updateOtStatusDisplay('off')", disabledIndex);

  assert.notEqual(disabledIndex, -1, 'sync should have a disabled stop branch');
  assert.notEqual(failedStopIndex, -1, 'disabled branch should check stop bridge success');
  assert.notEqual(unavailableIndex, -1, 'failed stop should show unavailable');
  assert.notEqual(offIndex, -1, 'successful stop should show off');
  assert.ok(offIndex > failedStopIndex, 'off status should only be applied after successful stop handling');
  assert.ok(offIndex > unavailableIndex, 'off status should not be applied inside failed stop handling');
});

test('markdown links only allow http and https URLs', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const hrefBody = contentScript.match(/function formatMarkdownHref\(href\) \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.match(hrefBody, /protocol === 'http:' \|\| parsed\.protocol === 'https:'/);
  assert.doesNotMatch(hrefBody, /file:\/\//);
  assert.doesNotMatch(hrefBody, /return target/);
});

test('markdown renderer turns resolvable plain line references into safe jump buttons', async () => {
  const harness = loadMarkdownRendererHarness([
    { path: 'main.tex', kind: 'text' },
    { path: 'sections/main.tex', kind: 'text' },
    { path: 'sections/intro.tex', kind: 'text' },
    { path: 'appendix/intro.tex', kind: 'text' },
    { path: 'assets/data.tex', kind: 'binary' }
  ]);
  const target = createMinimalDocument().createElement('div');

  target.replaceChildren(...harness.buildMarkdownInlineNodes(
    'See main.tex:117 and sections/intro.tex:42. Ambiguous intro.tex:8 and binary assets/data.tex:9 stay text.'
  ));

  const buttons = findLineReferenceButtons(target);
  assert.deepEqual(buttons.map(button => button.textContent), ['main.tex:117', 'sections/intro.tex:42']);
  assert.equal(buttons[0].type, 'button');
  assert.equal(buttons[0].dataset.path, 'main.tex');
  assert.equal(buttons[0].dataset.line, '117');
  assert.equal(buttons[0].getAttribute('aria-label'), 'Open main.tex line 117');
  assert.match(collectElementText(target), /Ambiguous intro\.tex:8/);
  assert.match(collectElementText(target), /binary assets\/data\.tex:9/);

  await buttons[0].click();

  assert.deepEqual(harness.pageBridgeCalls[0], {
    method: 'jumpToPosition',
    params: { path: 'main.tex', line: 117, selectLine: true }
  });
});

test('markdown renderer leaves inline and fenced code refs non-clickable', () => {
  const harness = loadMarkdownRendererHarness([{ path: 'main.tex', kind: 'text' }]);
  const inlineTarget = createMinimalDocument().createElement('div');
  const blockTarget = createMinimalDocument().createElement('div');

  harness.renderMarkdownInlineText(inlineTarget, '`see main.tex:42` and main.tex:43');
  harness.renderMarkdownBlockText(blockTarget, [
    '```tex',
    'main.tex:99',
    '```',
    '',
    'Outside main.tex:100'
  ].join('\n'));

  assert.deepEqual(findLineReferenceButtons(inlineTarget).map(button => button.textContent), ['main.tex:43']);
  assert.deepEqual(findLineReferenceButtons(blockTarget).map(button => button.textContent), ['main.tex:100']);
  assert.match(collectElementText(inlineTarget), /main\.tex:42/);
  assert.match(collectElementText(blockTarget), /main\.tex:99/);
});

test('markdown renderer turns standalone inline code location refs into jump buttons', async () => {
  const harness = loadMarkdownRendererHarness([{ path: 'main.tex', kind: 'text' }]);
  const target = createMinimalDocument().createElement('div');

  harness.renderMarkdownInlineText(target, '位置在 `main.tex:28`。');

  const buttons = findLineReferenceButtons(target);
  assert.deepEqual(buttons.map(button => button.textContent), ['main.tex:28']);
  assert.equal(collectElements(target, node => node.tagName === 'CODE').length, 0);

  await buttons[0].click();

  assert.deepEqual(harness.pageBridgeCalls[0], {
    method: 'jumpToPosition',
    params: { path: 'main.tex', line: 28, selectLine: true }
  });
});

test('line-reference buttons render with link-like visual affordance', () => {
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );

  assert.match(css, /#codex-overleaf-panel \.codex-line-reference\s*\{/);
  assert.match(css, /\.codex-line-reference[\s\S]*color:\s*#4ea1ff/);
  assert.match(css, /\.codex-line-reference[\s\S]*text-decoration:\s*underline/);
  assert.match(css, /\.codex-line-reference[\s\S]*cursor:\s*pointer/);
  assert.match(css, /\.codex-line-reference[\s\S]*background:\s*transparent/);
});

test('markdown renderer sanitizes local absolute paths inside inline and fenced code', () => {
  const rawLocalPath = '/Users/alice/.codex-overleaf/projects/p/workspace/main.tex:42';
  const harness = loadMarkdownRendererHarness([{ path: 'main.tex', kind: 'text' }]);
  const inlineTarget = createMinimalDocument().createElement('div');
  const blockTarget = createMinimalDocument().createElement('div');

  harness.renderMarkdownInlineText(inlineTarget, `Inline \`${rawLocalPath}\``);
  harness.renderMarkdownBlockText(blockTarget, ['```', rawLocalPath, '```'].join('\n'));

  assert.equal(collectElementText(inlineTarget).includes('/Users/alice'), false);
  assert.equal(collectElementText(blockTarget).includes('/Users/alice'), false);
  assert.equal(findLineReferenceButtons(inlineTarget).length, 0);
  assert.equal(findLineReferenceButtons(blockTarget).length, 0);
});

test('line-reference button clicks distinguish line and line-column jumps', async () => {
  const harness = loadMarkdownRendererHarness([{ path: 'main.tex', kind: 'text' }]);
  const target = createMinimalDocument().createElement('div');
  target.replaceChildren(...harness.buildMarkdownInlineNodes('main.tex:42 and main.tex:42:7'));

  const buttons = findLineReferenceButtons(target);
  await buttons[0].click();
  await buttons[1].click();

  assert.deepEqual(harness.pageBridgeCalls, [
    {
      method: 'jumpToPosition',
      params: { path: 'main.tex', line: 42, selectLine: true }
    },
    {
      method: 'jumpToPosition',
      params: { path: 'main.tex', line: 42, column: 7, selectLine: false }
    }
  ]);
});

test('markdown renderer makes every adjacent punctuation-separated line reference clickable', async () => {
  const harness = loadMarkdownRendererHarness([{ path: 'camera_ready.tex', kind: 'text' }]);
  const target = createMinimalDocument().createElement('div');

  harness.renderMarkdownInlineText(
    target,
    '对应位置包括 camera_ready.tex:169、camera_ready.tex:225，camera_ready.tex:248,camera_ready.tex:252。'
  );

  const buttons = findLineReferenceButtons(target);
  assert.deepEqual(
    buttons.map(button => button.textContent),
    [
      'camera_ready.tex:169',
      'camera_ready.tex:225',
      'camera_ready.tex:248',
      'camera_ready.tex:252'
    ]
  );

  for (const button of buttons) {
    await button.click();
  }

  assert.deepEqual(
    harness.pageBridgeCalls.map(call => call.params),
    [
      { path: 'camera_ready.tex', line: 169, selectLine: true },
      { path: 'camera_ready.tex', line: 225, selectLine: true },
      { path: 'camera_ready.tex', line: 248, selectLine: true },
      { path: 'camera_ready.tex', line: 252, selectLine: true }
    ]
  );
});

test('markdown renderer sanitizes local path labels while preserving HTTPS links', () => {
  const rawLocalPath = '/Users/alice/.codex-overleaf/projects/p/workspace/main.tex:42';
  const harness = loadMarkdownRendererHarness([{ path: 'main.tex', kind: 'text' }]);
  const target = createMinimalDocument().createElement('div');

  harness.renderMarkdownInlineText(target, `[${rawLocalPath}](https://example.test/review)`);

  const anchors = collectElements(target, node => node.tagName === 'A');
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].href, 'https://example.test/review');
  assert.equal(anchors[0].textContent.includes('/Users/alice'), false);
  assert.equal(collectElementText(target).includes('/Users/alice'), false);
  assert.equal(findLineReferenceButtons(target).length, 0);
});

test('markdown renderer turns target-only local markdown line refs into safe jump buttons', async () => {
  const rawLocalTarget = '/Users/alice/.codex-overleaf/projects/p/workspace/main.tex:117';
  const harness = loadMarkdownRendererHarness([{ path: 'main.tex', kind: 'text' }]);
  const target = createMinimalDocument().createElement('div');

  harness.renderMarkdownInlineText(target, `[main.tex](${rawLocalTarget})`);

  const buttons = findLineReferenceButtons(target);
  const anchors = collectElements(target, node => node.tagName === 'A');
  assert.equal(anchors.length, 0);
  assert.deepEqual(buttons.map(button => button.textContent), ['main.tex:117']);
  assert.equal(collectElementText(target).includes('/Users/alice'), false);
  assert.equal(buttons[0].title.includes('/Users/alice'), false);

  await buttons[0].click();

  assert.deepEqual(harness.pageBridgeCalls[0], {
    method: 'jumpToPosition',
    params: { path: 'main.tex', line: 117, selectLine: true }
  });
});

test('unresolved local markdown targets render sanitized label-only text', () => {
  const rawLocalTarget = '/Users/alice/.codex-overleaf/projects/p/workspace/missing.tex:117';
  const harness = loadMarkdownRendererHarness([{ path: 'main.tex', kind: 'text' }]);
  const target = createMinimalDocument().createElement('div');

  harness.renderMarkdownInlineText(target, `[main.tex](${rawLocalTarget})`);

  assert.equal(findLineReferenceButtons(target).length, 0);
  assert.equal(collectElements(target, node => node.tagName === 'A').length, 0);
  assert.equal(collectElementText(target), 'main.tex');
  assert.equal(collectElementText(target).includes('/Users/alice'), false);
  assert.equal(collectElementText(target).includes('workspace'), false);
  assert.equal(collectElementText(target).includes('missing.tex:117'), false);
});

test('http markdown links never expose unsafe local target text as their label', () => {
  const rawLocalTarget = '/Users/alice/.codex-overleaf/projects/p/workspace/main.tex:117';
  const harness = loadMarkdownRendererHarness([{ path: 'main.tex', kind: 'text' }]);
  const target = createMinimalDocument().createElement('div');

  harness.renderMarkdownInlineText(target, `[review](https://example.test/review?file=${encodeURIComponent(rawLocalTarget)})`);

  const anchors = collectElements(target, node => node.tagName === 'A');
  assert.equal(anchors.length, 1);
  assert.equal(anchors[0].textContent, 'review');
  assert.equal(anchors[0].textContent.includes('/Users/alice'), false);
  assert.equal(anchors[0].textContent.includes('workspace'), false);
  assert.equal(anchors[0].href.includes('/Users/alice'), false);
  assert.equal(anchors[0].href, 'https://example.test/review');
});

test('line-reference buttons show pending state and failure feedback without leaking local paths', async () => {
  const rawLocalFailure = '/Users/alice/.codex-overleaf/projects/p/workspace/main.tex:117';
  let resolveJump;
  const pending = new Promise(resolve => {
    resolveJump = resolve;
  });
  const harness = loadMarkdownRendererHarness([{ path: 'main.tex', kind: 'text' }], {
    callPageBridge() {
      return pending;
    }
  });
  const target = createMinimalDocument().createElement('div');

  harness.renderMarkdownInlineText(target, 'main.tex:117');
  const button = findLineReferenceButtons(target)[0];
  const clickPromise = button.click();

  assert.equal(button.disabled, true);
  assert.equal(button.dataset.status, 'pending');

  resolveJump({ ok: false, error: `Could not open ${rawLocalFailure}` });
  await clickPromise;

  assert.equal(button.disabled, false);
  assert.equal(button.dataset.status, 'failed');
  assert.equal(button.title.includes('/Users/alice'), false);
  assert.equal(JSON.stringify(harness.toasts).includes('/Users/alice'), false);
});

test('run view captures safe project file inventory for final report line references beyond focus files', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );

  assert.match(contentScript, /function captureProjectReferenceFiles\(/);
  assert.match(contentScript, /currentRunView\.projectFiles = captureProjectReferenceFiles\(project\)/);
  assert.match(contentScript, /projectFiles:\s*captureProjectReferenceFiles\(arguments\[0\]\?\.project\)/);
});

test('session row controls do not interpolate translated strings through innerHTML', () => {
  const sessionPanel = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/sessionPanel.js'),
    'utf8'
  );
  const renderBody = sessionPanel.match(/function renderSessionRow\(instance, session\) \{[\s\S]*?\n  function beginRename/)?.[0] || '';

  assert.doesNotMatch(renderBody, /innerHTML\s*=/);
  assert.match(renderBody, /createElement\('button'\)/);
  assert.match(renderBody, /setAttribute\('aria-label', t\(instance, 'renameSession'\)\)/);
});

test('user-facing task failures do not render raw stack traces', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/content/contentRuntime.js'),
    'utf8'
  );
  const runTaskBody = contentScript.match(/async function runTask\(\) \{[\s\S]*?\n  async function persistRunResult/)?.[0] || '';

  assert.doesNotMatch(runTaskBody, /stack:\s*error\.stack/);
  assert.doesNotMatch(runTaskBody, /stack:\s*persistenceError\.stack/);
});
