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

test('task runs sync the full project only when a Codex run starts', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
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

test('task run snapshots request binary assets so local LaTeX can see Figures directories', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const getRunProjectSnapshotBody = contentScript.match(/async function getRunProjectSnapshot\(\) \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.match(getRunProjectSnapshotBody, /includeBinaryFiles:\s*true/);
  assert.match(getRunProjectSnapshotBody, /zipOnly:\s*true/);
  assert.match(contentScript, /资源文件/);
});

test('task run snapshots bypass cache so Codex sees the latest Overleaf state', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const getRunProjectSnapshotBody = contentScript.match(/async function getRunProjectSnapshot\(\) \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.match(getRunProjectSnapshotBody, /force:\s*true/);
  assert.match(getRunProjectSnapshotBody, /maxAgeMs:\s*0/);
});

test('whole-project ZIP sync waits long enough before falling back to focused files', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
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
    path.join(__dirname, '../extension/src/contentScript.js'),
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
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );

  assert.match(contentScript, /async function resolveWarmMirrorReuse/);
  assert.match(contentScript, /Full project snapshot was not captured/);
  assert.match(contentScript, /const WARM_MIRROR_MAX_AGE_MS\s*=\s*5 \* 60 \* 1000/);
  assert.match(contentScript, /mirrorStatus\.ageMs >= WARM_MIRROR_MAX_AGE_MS/);
  assert.match(contentScript, /没有读到完整 Overleaf 项目，但本地 workspace 刚同步过/);
  assert.match(contentScript, /mergeProjectWithSyncChangeBaseFiles\(project,\s*syncChanges\)/);
});

test('successful Overleaf writeback refreshes page snapshot cache and native mirror baseline', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const applyBody = contentScript.match(/async function applySyncChangesToOverleaf[\s\S]*?\n  function buildSyncApplyOperations/)?.[0] || '';

  assert.match(applyBody, /refreshProjectMirrorAfterWriteback/);
  assert.match(contentScript, /invalidateProjectSnapshot/);
  assert.match(contentScript, /method:\s*'mirror\.sync'/);
});

test('post-write mirror refresh refuses partial snapshots before touching native baseline', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const refreshBody = contentScript.match(/async function refreshProjectMirrorAfterWriteback[\s\S]*?\n  function mergeVerifiedAppliedFiles/)?.[0] || '';

  assert.match(refreshBody, /capabilities\?\.fullProjectSnapshot/);
  assert.match(refreshBody, /没有读到完整项目/);
  assert.match(refreshBody, /return;\s*\}\s*\n\s*const syncedProject/);
});

test('idle background sync does not poll or touch the Overleaf editor', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const initBody = contentScript.match(/async function init\(\) \{[\s\S]*?\n  \}/)?.[0] || '';

  assert.doesNotMatch(initBody, /initWarmMirror/);
  assert.doesNotMatch(initBody, /scheduleProjectSync/);
  assert.doesNotMatch(initBody, /mirror\.sync/);
  assert.doesNotMatch(contentScript, /setInterval\(\(\) => \{[\s\S]*syncMirrorBackground/);
  assert.doesNotMatch(contentScript, /function scheduleProjectSync/);
  assert.doesNotMatch(contentScript, /addEventListener\('input', scheduleMirrorPrefetch\)/);
  assert.doesNotMatch(initBody, /scheduleProbeRefresh/);
  assert.doesNotMatch(initBody, /installInteractionRefresh/);
});

test('status probing and mirror prefetch have no automatic refresh helpers left behind', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );

  assert.doesNotMatch(contentScript, /function installInteractionRefresh/);
  assert.doesNotMatch(contentScript, /function scheduleProbeRefresh/);
  assert.doesNotMatch(contentScript, /function scheduleDebouncedProbeRefresh/);
  assert.doesNotMatch(contentScript, /function scheduleMirrorPrefetch/);
  assert.doesNotMatch(contentScript, /function syncMirrorBackground/);
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

test('deleting a UI session also clears plugin-isolated Codex history', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const deleteBody = contentScript.match(/async function deleteSessionWithConfirm\(sessionId\) \{[\s\S]*?\n  function setRunning/)?.[0] || '';

  assert.match(deleteBody, /codex\.history\.clearPlugin/);
  assert.match(deleteBody, /插件隔离的本地 Codex 历史/);
  assert.doesNotMatch(deleteBody, /This deletes local session history/);
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
  assert.match(contentScript, /const visibleView = getCurrentRunViewForRender\(\)/);
  assert.match(contentScript, /collapseRunProcess\(visibleView/);
  assert.match(contentScript, /formatProcessedSummary/);
  assert.match(contentScript, /已处理/);
  assert.match(contentScript, /runProcess\.open = false/);
  assert.match(css, /\.run-process summary/);
});

test('context compaction appears as a lightweight checkpoint inside processed history', () => {
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
    path.join(__dirname, '../extension/src/contentScript.js'),
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
    path.join(__dirname, '../extension/src/contentScript.js'),
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
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
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
  assert.match(sessionListBody, /const isRunningSession = isSessionRunning\(session\)/);
  assert.doesNotMatch(sessionListBody, /const isRunningSession = currentRunView\?\.sessionId === session\.id/);
  assert.match(sessionListBody, /row\.dataset\.running = isRunningSession \? 'true' : 'false'/);
  assert.match(sessionListBody, /deleteButton\.disabled = isRunningSession/);
  assert.match(contentScript, /function isSessionRunning\(session\) \{/);
  assert.match(contentScript, /run\.status === 'running'/);
  assert.match(css, /\.codex-session-row\[data-running="true"\]/);
  assert.match(css, /codex-session-spin/);
});

test('running tasks are only marked interrupted when restoring persisted state after reload', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
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
    path.join(__dirname, '../extension/src/contentScript.js'),
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

test('high-volume Codex stream output is throttled before panel rendering and storage writes', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
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
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );

  assert.match(contentScript, />留痕</);
  assert.match(contentScript, /开启后，写入前会确认并尝试切到 Overleaf Reviewing\/Track Changes；删除仍需确认。/);
  assert.match(css, /\.codex-review-label/);
});

test('write paths enforce Overleaf Reviewing before applying changes when requested', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const pageBridge = fs.readFileSync(
    path.join(__dirname, '../extension/src/pageBridge.js'),
    'utf8'
  );
  const applySyncBody = contentScript.match(/async function applySyncChangesToOverleaf[\s\S]*?\n  function buildSyncApplyOperations/)?.[0] || '';
  const applyTaskBody = contentScript.match(/async function applyTaskOperations[\s\S]*?\n  function partitionOperationsForApply/)?.[0] || '';

  assert.match(contentScript, /async function ensureReviewingBeforeWrite/);
  assert.match(applySyncBody, /await ensureReviewingBeforeWrite\(operations\)/);
  assert.match(applySyncBody, /requireReviewing:\s*state\.requireReviewing === true/);
  assert.match(applyTaskBody, /await ensureReviewingBeforeWrite\(partitioned\.safe\)/);
  assert.match(applyTaskBody, /requireReviewing:\s*state\.requireReviewing === true/);
  assert.match(pageBridge, /method === 'ensureReviewing'/);
  assert.match(pageBridge, /function ensureReviewing\(/);
  assert.match(pageBridge, /requireReviewing:\s*params\.requireReviewing === true/);
  assert.match(pageBridge, /buildReviewingRequiredBlockedResult/);
});

test('write tasks preflight Reviewing before syncing or starting local Codex', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const runTaskBody = contentScript.match(/async function runTask\(\) \{[\s\S]*?\n  async function handleTaskResult/)?.[0] || '';
  const preflightIndex = runTaskBody.indexOf('preflightWriteSafety()');
  const snapshotIndex = runTaskBody.indexOf('getRunProjectSnapshot()');
  const codexRunIndex = runTaskBody.indexOf("method: 'codex.run'");
  const preflightBody = contentScript.match(/async function preflightWriteSafety\(\) \{[\s\S]*?\n  async function handleTaskResult/)?.[0] || '';

  assert.match(contentScript, /async function preflightWriteSafety\(/);
  assert.ok(preflightIndex > -1);
  assert.ok(snapshotIndex > -1);
  assert.ok(codexRunIndex > -1);
  assert.ok(preflightIndex < snapshotIndex);
  assert.ok(preflightIndex < codexRunIndex);
  assert.match(preflightBody, /state\.mode === 'ask'/);
  assert.match(preflightBody, /state\?\.requireReviewing/);
  assert.match(preflightBody, /callPageBridge\('ensureReviewing'/);
  assert.match(preflightBody, /任务未开始：无法开启 Overleaf 留痕/);
  assert.match(preflightBody, /finishRunView\('未开始：无法开启留痕', 'failed'\)/);
});

test('write preflight gives natural feedback for automatic Reviewing activation', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const preflightBody = contentScript.match(/async function preflightWriteSafety\(\) \{[\s\S]*?\n  async function handleTaskResult/)?.[0] || '';

  assert.match(preflightBody, /正在确认 Overleaf 留痕状态/);
  assert.match(preflightBody, /已开启 Overleaf 留痕，开始处理任务/);
  assert.match(preflightBody, /Overleaf 留痕已经开启，开始处理任务/);
  assert.match(preflightBody, /你可能没有权限，或 Overleaf 当前页面没有暴露切换入口/);
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
  assert.match(contentScript, /function renderMarkdownInlineText\(/);
  assert.match(contentScript, /document\.createElement\('strong'\)/);
  assert.doesNotMatch(contentScript, /run-stream-text[\s\S]{0,240}\.innerHTML/);
  assert.match(css, /\.run-stream-text/);
  assert.match(agentTranscript, /if \(method === 'item\/reasoning\/textDelta'\) \{\s*return technicalOnly\(event\);\s*\}/);
  assert.doesNotMatch(contentScript, /technicalDetail:\s*normalizeRawAgentEvent\(event\)/);
});

test('final assistant summary is collected from all assistant stream messages', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
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
    path.join(__dirname, '../extension/src/contentScript.js'),
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
    path.join(__dirname, '../extension/src/contentScript.js'),
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
    path.join(__dirname, '../extension/src/contentScript.js'),
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
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );

  assert.match(contentScript, /function normalizeInlineOrderedLists\(/);
  assert.match(contentScript, /document\.createElement\('ol'\)/);
  assert.match(contentScript, /isMarkdownOrderedListLine/);
});

test('auto mode shows a readonly diff after applying Codex changes', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );
  const applySyncBody = contentScript.match(/async function applySyncChangesToOverleaf[\s\S]*?\n  function buildSyncApplyOperations/)?.[0] || '';

  assert.match(contentScript, /function renderReadOnlyDiffReview\(/);
  assert.match(applySyncBody, /const applied = operations\.length[\s\S]*renderReadOnlyDiffReview\(getAppliedSyncChanges\(syncChanges, applied\)/);
  assert.match(contentScript, /function getAppliedSyncChanges\(/);
  assert.match(contentScript, /dataset\.readonly = 'true'/);
  assert.match(css, /\.codex-diff-review\[data-readonly="true"\]/);
  assert.doesNotMatch(applySyncBody, /本地 Codex 改动预览：\$\{syncChanges\.filter/);
});

test('confirm diff review uses immediate per-file decisions and batch accept reject actions', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );
  const createDiffBody = contentScript.match(/function createDiffReviewElement\(syncChanges[\s\S]*?\n  function renderDiffReview/)?.[0] || '';
  const renderDiffBody = contentScript.match(/function renderDiffReview\(syncChanges\) \{[\s\S]*?\n  function renderReadOnlyDiffReview/)?.[0] || '';

  assert.match(createDiffBody, /card\.dataset\.decision = readonly \? 'accepted' : 'pending'/);
  assert.match(createDiffBody, /function decideFileChange\(path, accepted\)/);
  assert.match(createDiffBody, /status\.textContent = accepted \? '已接受' : '已拒绝'/);
  assert.match(renderDiffBody, /acceptAllBtn\.textContent = '接受全部'/);
  assert.match(renderDiffBody, /rejectAllBtn\.textContent = '拒绝全部'/);
  assert.doesNotMatch(renderDiffBody, /应用选中/);
  assert.match(renderDiffBody, /finishIfAllDecided/);
  assert.match(css, /\.codex-diff-file\[data-decision="accepted"\]/);
  assert.match(css, /\.codex-diff-toolbar-summary/);
});

test('auto recompile is based on successfully applied Overleaf writes', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const runTaskBody = contentScript.match(/async function runTask\(\) \{[\s\S]*?\n  function buildCodexRunParams/)?.[0] || '';
  const applySyncBody = contentScript.match(/async function applySyncChangesToOverleaf[\s\S]*?\n  async function refreshProjectMirrorAfterWriteback/)?.[0] || '';

  assert.doesNotMatch(runTaskBody, /response\.result\.syncChanges[\s\S]*autoRecompileAfterWriteback/);
  assert.match(applySyncBody, /const appliedPaths = getAppliedOperationPaths\(applied\)/);
  assert.match(applySyncBody, /autoRecompileAfterWriteback\(appliedPaths\)/);
});

test('@compile-log context is preserved across Codex run retries', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const runTaskBody = contentScript.match(/async function runTask\(\) \{[\s\S]*?\n  function buildCodexRunParams/)?.[0] || '';

  assert.match(contentScript, /function buildCodexRunParams\(/);
  assert.match(runTaskBody, /compileLogContext = await resolveCompileLogContext\(\)/);
  assert.match(runTaskBody, /mirror_stale[\s\S]*buildCodexRunParams\([\s\S]*compileLogContext/);
  assert.match(runTaskBody, /thread_resume_failed[\s\S]*buildCodexRunParams\([\s\S]*compileLogContext/);
});

test('compile page bridge calls use long-running timeouts', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );

  assert.match(contentScript, /function getPageBridgeTimeoutMs\(method\)/);
  assert.match(contentScript, /method === 'triggerCompile' \|\| method === 'getCompileLog'/);
  assert.match(contentScript, /return 60000/);
  assert.match(contentScript, /const timeoutMs = getPageBridgeTimeoutMs\(method\)/);
});

test('partial writeback report tells the user what already changed and how to recover', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
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
  assert.match(contentScript, /撤销改动/);
  assert.match(contentScript, /撤销已写入部分/);
  assert.match(contentScript, /recordUndoFromApply\(project, applied\)[\s\S]*appendPartialWritebackWarning\(applied\)/);
  assert.match(contentScript, /appendPartialWritebackWarning\(applied\)/);
});

test('undo flow blocks legacy full-file replaceAll restores that would mark whole documents changed', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const undoRunBody = contentScript.match(/async function undoRun\(runId\) \{[\s\S]*?\n  function recordUndoFromApply/)?.[0] || '';

  assert.match(contentScript, /const MAX_SAFE_UNDO_REPLACEALL_CHARS/);
  assert.match(contentScript, /function findUnsafeFullFileUndoOperation\(/);
  assert.match(undoRunBody, /findUnsafeFullFileUndoOperation\(run\.undoOperations\)/);
  assert.match(contentScript, /已阻止旧格式全文撤销/);
});

test('undo flow uses no-trace restoring instead of requiring Reviewing write mode', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const undoRunBody = contentScript.match(/async function undoRun\(runId\) \{[\s\S]*?\n  function findUnsafeFullFileUndoOperation/)?.[0] || '';

  assert.doesNotMatch(undoRunBody, /ensureReviewingBeforeWrite\(run\.undoOperations\)/);
  assert.match(undoRunBody, /reviewingPolicy:\s*'no-trace-undo'/);
  assert.match(contentScript, /无留痕撤销/);
});

test('change preview is grouped by file with edit evidence instead of raw operation counts', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
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
