const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('composer exposes user-facing Overleaf task modes instead of internal mode names', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );

  assert.match(contentScript, /<option value="ask">只问不改<\/option>/);
  assert.match(contentScript, /<option value="confirm">建议修改<\/option>/);
  assert.match(contentScript, /<option value="auto">自动写入<\/option>/);
  assert.doesNotMatch(contentScript, />Auto<\/option>/);
  assert.doesNotMatch(contentScript, />Confirm<\/option>/);
});

test('composer shows confirm and auto as explicit visible write-mode choices', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );

  assert.match(contentScript, /class="codex-mode-row"/);
  assert.match(contentScript, /class="codex-mode-switch"/);
  assert.match(contentScript, /data-mode-choice="ask"/);
  assert.match(contentScript, /data-mode-choice="confirm"/);
  assert.match(contentScript, /data-mode-choice="auto"/);
  assert.match(contentScript, /function selectMode\(/);
  assert.match(contentScript, /function syncModeControls\(/);
  assert.match(contentScript, /querySelectorAll\('\[data-mode-choice\]'\)/);
  assert.match(css, /\.codex-mode-switch\s*\{[\s\S]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\[data-mode-choice\]\[data-active="true"\]/);
});

test('run timeline uses user-facing action transcript and undo language', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );

  assert.match(contentScript, /我会先理解你的请求/);
  assert.match(contentScript, /正在同步 Overleaf 项目到本地 Codex workspace/);
  assert.match(contentScript, /本地 Codex session 开始运行/);
  assert.match(contentScript, /同步本地 Codex 改动到 Overleaf/);
  assert.match(contentScript, /本地 Codex 改动已同步回 Overleaf/);
  assert.match(contentScript, /已创建撤销点：可撤销本轮/);
  assert.match(contentScript, /撤销本轮/);
  assert.doesNotMatch(contentScript, /Starting \$\{state\.mode\} task/);
  assert.doesNotMatch(contentScript, /Apply result:/);
  assert.doesNotMatch(contentScript, /Undo checkpoint recorded:/);
});

test('task runs reuse the project snapshot cache before Codex starts and refresh asynchronously after writes', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const runTaskBody = contentScript.match(/async function runTask\(\) \{[\s\S]*?\n  async function handleTaskResult/)?.[0] || '';

  assert.match(runTaskBody, /getRunProjectSnapshot\(\)/);
  assert.match(contentScript, /getProjectSnapshot', \{ maxAgeMs: RUN_PROJECT_SYNC_MAX_AGE_MS \}/);
  assert.doesNotMatch(runTaskBody, /getProjectSnapshot', \{ force: true \}/);
  assert.match(runTaskBody, /method: 'codex\.run'/);
  assert.match(runTaskBody, /syncChanges/);
  assert.match(runTaskBody, /applySyncChangesToOverleaf/);
  assert.match(runTaskBody, /scheduleProjectSync\(1500\)/);
  assert.match(contentScript, /async function applySyncChangesToOverleaf/);
  assert.match(contentScript, /function scheduleProjectSync/);
});

test('background mirror sync only marks the mirror fresh after native success', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const scheduleProjectSyncBody = contentScript.match(/function scheduleProjectSync\(delayMs = 30000\) \{[\s\S]*?\n  async function getRunProjectSnapshot/)?.[0] || '';

  assert.match(scheduleProjectSyncBody, /sendBackgroundNative\(/);
  assert.match(scheduleProjectSyncBody, /\.then\(response => \{/);
  assert.match(scheduleProjectSyncBody, /if \(!response\?\.ok\) \{\s*return;\s*\}/);
  assert.doesNotMatch(scheduleProjectSyncBody, /\.then\(\(\) => \{/);
});

test('ask mode is not blocked by write-safety preconditions', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const runTaskBody = contentScript.match(/async function runTask\(\) \{[\s\S]*?\n  async function handleTaskResult/)?.[0] || '';
  const codexSessionRunner = fs.readFileSync(
    path.join(__dirname, '../native-host/src/codexSessionRunner.js'),
    'utf8'
  );

  assert.doesNotMatch(runTaskBody, /state\.mode !== 'ask' && state\.requireReviewing/);
  assert.match(runTaskBody, /mode: state\.mode/);
  assert.match(codexSessionRunner, /params\.mode === 'ask'/);
  assert.match(codexSessionRunner, /sandboxMode: 'read-only'/);
  assert.match(codexSessionRunner, /approvalPolicy: 'never'/);
});

test('composer clears the submitted task as soon as Codex accepts the run', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const runTaskBody = contentScript.match(/async function runTask\(\) \{[\s\S]*?\n  async function handleTaskResult/)?.[0] || '';

  assert.match(runTaskBody, /currentRunView = startRunView\(/);
  assert.match(runTaskBody, /clearTaskComposer\(\)/);
  assert.match(contentScript, /function clearTaskComposer\(/);
  assert.match(contentScript, /taskInput\.value = ''/);
  assert.match(contentScript, /task: ''/);
});

test('run history renders as a compact single-column transcript without persistent speaker rails', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
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
    path.join(__dirname, '../extension/src/contentScript.js'),
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
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );

  assert.match(contentScript, /function finishRunView\(/);
  assert.match(contentScript, /collapseRunProcess\(currentRunView/);
  assert.match(contentScript, /formatProcessedSummary/);
  assert.match(contentScript, /已处理/);
  assert.match(contentScript, /runProcess\.open = false/);
  assert.match(css, /\.run-process summary/);
});

test('run log autoscroll follows realtime output unless the user scrolls upward', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );

  assert.match(contentScript, /let logAutoFollow = true/);
  assert.match(contentScript, /let userScrollIntentUntil = 0/);
  assert.match(contentScript, /function bindLogAutoFollow\(/);
  assert.match(contentScript, /function isLogNearBottom\(/);
  assert.match(contentScript, /function markUserScrollIntent\(/);
  assert.match(contentScript, /Date\.now\(\) <= userScrollIntentUntil/);
  assert.match(contentScript, /function scrollLogToBottom\(/);
  assert.match(contentScript, /scrollLogToBottom\(\{ force: true \}\)/);
  assert.match(contentScript, /scrollLogToBottom\(\)/);
});

test('reviewing safety toggle is labeled instead of a mysterious check icon', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );

  assert.match(contentScript, />留痕</);
  assert.match(contentScript, /开启后，写入前会要求 Overleaf 留痕\/Reviewing 可用；删除仍需确认。/);
  assert.match(css, /\.codex-review-label/);
});

test('native and raw agent events go through the human transcript mapper', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const appendNativeEventBody = contentScript.match(/function appendNativeEvent\(event\) \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.match(contentScript, /CodexOverleafAgentTranscript/);
  assert.match(appendNativeEventBody, /mapAgentEventToActivity\(event\)/);
  assert.match(contentScript, /appendTechnicalEvent/);
  assert.doesNotMatch(contentScript, /function mapAgentActivity\(event\)/);
});

test('Codex JSONL messages and tool progress become visible without raw command labels', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
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
    path.join(__dirname, '../extension/src/contentScript.js'),
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
  assert.match(css, /\.run-stream-text/);
  assert.match(agentTranscript, /if \(method === 'item\/reasoning\/textDelta'\) \{\s*return technicalOnly\(event\);\s*\}/);
  assert.doesNotMatch(contentScript, /technicalDetail:\s*normalizeRawAgentEvent\(event\)/);
});

test('completion report is structured around user outcomes rather than a one-line status', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const agentTranscript = fs.readFileSync(
    path.join(__dirname, '../extension/src/shared/agentTranscript.js'),
    'utf8'
  );

  assert.match(contentScript, /function appendCompletionReport\(/);
  assert.match(contentScript, /buildHumanCompletionReport/);
  assert.match(contentScript, /translateRawError/);
  assert.match(contentScript, /assistantMessage/);
  assert.match(contentScript, /getLatestAssistantAnswerForCurrentRun/);
  assert.match(contentScript, /className = 'run-final-answer'/);
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

test('change preview is grouped by file with edit evidence instead of raw operation counts', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );

  assert.match(contentScript, /function groupOperationsByFile\(/);
  assert.match(contentScript, /function formatFileChangePreview\(/);
  assert.match(contentScript, /find/);
  assert.match(contentScript, /replace/);
  assert.doesNotMatch(contentScript, /修改计划：编辑 \$\{summary\.counts\.edit/);
});

test('context picker presents Cursor-style @ context concepts', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );

  assert.match(contentScript, /添加 @ 上下文/);
  assert.match(contentScript, /@文件/);
  assert.match(contentScript, /@compile-log/);
  assert.match(contentScript, /@current-section/);
  assert.match(contentScript, /@context/);
  assert.doesNotMatch(contentScript, /Focus:/);
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
