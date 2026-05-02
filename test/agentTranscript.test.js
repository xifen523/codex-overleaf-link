const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildHumanCompletionReport,
  formatHumanReport,
  mapAgentEventToActivity,
  translateRawError
} = require('../extension/src/shared/agentTranscript');

test('translates raw write-mode errors into user-facing remediation', () => {
  const translated = translateRawError('Mode must be "confirm" or "auto"', { mode: 'ask' });

  assert.equal(translated.conclusion, '这轮没有写入：当前是“只问不改”，但这个任务需要写入权限。');
  assert.equal(translated.nextStep, '请切换到“建议修改”或“自动写入”后重新运行。');
  assert.doesNotMatch(JSON.stringify(translated), /Mode must be/);
});

test('keeps schema-only lifecycle events out of the visible transcript', () => {
  for (const event of [
    { type: 'codex.prompt.ready', title: 'Codex prompt prepared' },
    { type: 'codex.stdout.line', title: 'Codex produced non-JSON output', detail: { text: '{"raw":true}' } }
  ]) {
    const activity = mapAgentEventToActivity(event);
    assert.equal(activity.kind, 'technical');
    assert.equal(activity.visible, false);
  }
});

test('maps project sync events to visible human progress without temp paths', () => {
  const preparing = mapAgentEventToActivity({
    type: 'agent.snapshot.preparing',
    detail: { fileCount: 13, totalChars: 42000 }
  });
  const ready = mapAgentEventToActivity({
    type: 'agent.snapshot.ready',
    detail: { tempDir: '/tmp/codex-overleaf-agent-secret', fileCount: 13 }
  });

  assert.equal(preparing.visible, true);
  assert.match(preparing.title, /正在同步 Overleaf 项目/);
  assert.equal(ready.visible, true);
  assert.match(ready.title, /已同步 13 个文本文件/);
  assert.doesNotMatch(ready.title, /tmp|codex-overleaf-agent/);
});

test('maps native glue sync events to the same visible Overleaf workspace story', () => {
  const started = mapAgentEventToActivity({
    type: 'overleaf.sync.started',
    detail: { fileCount: 13, projectId: 'aabbccddeeff001122334455' }
  });
  const completed = mapAgentEventToActivity({
    type: 'overleaf.sync.completed',
    detail: { fileCount: 13, workspacePath: '/tmp/private/path' }
  });
  const changes = mapAgentEventToActivity({
    type: 'overleaf.sync.changes',
    detail: { changedCount: 2, files: ['main.tex', 'refs.bib'] }
  });

  assert.equal(started.visible, true);
  assert.match(started.title, /正在同步 Overleaf 项目到本地 Codex workspace/);
  assert.equal(completed.visible, true);
  assert.match(completed.title, /本地 Codex 将直接处理这份 workspace/);
  assert.doesNotMatch(completed.title, /tmp|private/);
  assert.equal(changes.visible, true);
  assert.match(changes.title, /Codex 本地改动已收集：main\.tex、refs\.bib/);
});

test('maps Codex app-server events to native-feeling transcript lines', () => {
  const plan = mapAgentEventToActivity({
    type: 'codex.session.event',
    title: 'turn/plan/updated',
    detail: {
      method: 'turn/plan/updated',
      params: {
        plan: [
          { step: '检查 main.tex 中的 citation key', status: 'in_progress' },
          { step: '核对 bibliography 文件', status: 'pending' }
        ]
      }
    }
  });
  const reasoning = mapAgentEventToActivity({
    type: 'codex.session.event',
    title: 'item/reasoning/summaryTextDelta',
    detail: {
      method: 'item/reasoning/summaryTextDelta',
      params: { delta: '先定位 citation 使用点，再核对 bib 条目。' }
    }
  });
  const patch = mapAgentEventToActivity({
    type: 'codex.session.event',
    title: 'item/fileChange/patchUpdated',
    detail: {
      method: 'item/fileChange/patchUpdated',
      params: {
        changes: [
          { path: 'main.tex', kind: 'update', diff: '...' }
        ]
      }
    }
  });

  assert.equal(plan.visible, true);
  assert.match(plan.title, /Codex 计划更新：检查 main\.tex/);
  assert.equal(reasoning.visible, true);
  assert.equal(reasoning.kind, 'stream');
  assert.equal(reasoning.title, '先定位 citation 使用点，再核对 bib 条目。');
  assert.equal(reasoning.streamKey, 'reasoning:current');
  assert.equal(reasoning.technicalDetail, undefined);
  assert.equal(patch.visible, true);
  assert.match(patch.title, /Codex 正在修改本地文件：main\.tex/);
  assert.doesNotMatch(plan.title + reasoning.title + patch.title, /turn\/|item\/|schema|JSON/);
});

test('keeps raw reasoning text out of the visible transcript', () => {
  const activity = mapAgentEventToActivity({
    type: 'codex.session.event',
    title: 'item/reasoning/textDelta',
    detail: {
      method: 'item/reasoning/textDelta',
      params: { delta: 'private chain-of-thought fragment' }
    }
  });

  assert.equal(activity.kind, 'technical');
  assert.equal(activity.visible, false);
  assert.doesNotMatch(activity.title || '', /private chain-of-thought/);
});

test('maps assistant message deltas to one updatable stream', () => {
  const first = mapAgentEventToActivity({
    type: 'codex.session.event',
    title: 'item/agentMessage/delta',
    detail: {
      method: 'item/agentMessage/delta',
      params: { itemId: 'msg_1', delta: '我先检查 citation ' }
    }
  });
  const second = mapAgentEventToActivity({
    type: 'codex.session.event',
    title: 'item/agentMessage/delta',
    detail: {
      method: 'item/agentMessage/delta',
      params: { itemId: 'msg_1', delta: '是否都在 ref.bib 中。' }
    }
  });

  assert.equal(first.kind, 'stream');
  assert.equal(second.kind, 'stream');
  assert.equal(first.streamKey, 'agent:msg_1');
  assert.equal(second.streamKey, 'agent:msg_1');
  assert.equal(first.appendText, true);
  assert.equal(first.technicalDetail, undefined);
});

test('maps Codex command events to visible natural progress without raw commands', () => {
  const started = mapAgentEventToActivity({
    type: 'codex.command.started',
    detail: { command: 'rg citation main.tex' }
  });
  const completed = mapAgentEventToActivity({
    type: 'codex.command.completed',
    detail: {
      command: 'rg citation main.tex',
      output: '1:\\cite{a}\n2:\\cite{b}\n',
      exitCode: 0
    }
  });

  assert.equal(started.visible, true);
  assert.equal(started.status, 'running');
  assert.match(started.title, /正在搜索项目内容/);
  assert.doesNotMatch(started.title, /rg citation main\.tex/);
  assert.equal(completed.visible, true);
  assert.equal(completed.status, 'completed');
  assert.match(completed.title, /搜索完成，找到 2 条相关线索/);
  assert.doesNotMatch(completed.title, /rg citation main\.tex|\\cite/);
});

test('maps human agent messages to visible progress without speaker labels', () => {
  const activity = mapAgentEventToActivity({
    type: 'codex.agent.message',
    detail: {
      text: '我会先检查 main.tex 里的引用，再和 references.bib 对照。'
    }
  });

  assert.equal(activity.kind, 'activity');
  assert.equal(activity.visible, true);
  assert.equal(activity.title, '我会先检查 main.tex 里的引用，再和 references.bib 对照。');
  assert.doesNotMatch(activity.title, /Codex 说/);
});

test('formats userReport as a readable final report', () => {
  const report = buildHumanCompletionReport({
    status: 'completed',
    userReport: {
      conclusion: '没有发现缺失 citation key，也没有修改文件。',
      checked: ['main.tex', 'references.bib'],
      findings: ['4 个 citation key 都能在 .bib 中找到对应条目。'],
      plannedChanges: [],
      appliedChanges: [],
      unchangedReason: '这轮是只问不改。',
      nextStep: '如果 Overleaf 仍有 warning，请把编译日志加入 @context 后再跑一次。'
    },
    operations: [
      { type: 'edit', path: 'main.tex', find: 'old', replace: 'new' }
    ]
  });

  assert.equal(report.title, '本轮完成报告');
  assert.match(report.text, /结论：没有发现缺失 citation key，也没有修改文件。/);
  assert.match(report.text, /检查范围：\n- main\.tex\n- references\.bib/);
  assert.match(report.text, /发现：\n- 4 个 citation key/);
  assert.match(report.text, /未修改原因：这轮是只问不改。/);
  assert.match(report.text, /下一步：如果 Overleaf 仍有 warning/);
  assert.doesNotMatch(report.text, /"type"|"find"|"replace"|old|new/);
});

test('preserves markdown sections in Codex final assistant reports', () => {
  const finalAnswer = [
    '我检查了主稿 [main.tex](/Users/example/.codex-overleaf/projects/p/workspace/main.tex:1)。',
    '',
    '**优先改**',
    '- [main.tex:117](/Users/example/.codex-overleaf/projects/p/workspace/main.tex:117)：`\\label{fig: example}` 应改成 `\\label{fig:example}`。',
    '- [checklist.tex:56](/Users/example/.codex-overleaf/projects/p/workspace/checklist.tex:56)：`In general.` 应改成 `In general,`。'
  ].join('\n');

  const report = buildHumanCompletionReport({
    status: 'completed',
    conclusion: finalAnswer,
    operations: [],
    applyResults: []
  });

  assert.match(report.text, /结论：我检查了主稿 \[main\.tex\]/);
  assert.match(report.text, /\n\n\*\*优先改\*\*\n- \[main\.tex:117\]/);
  assert.doesNotMatch(report.text, /\*\*优先改\*\* - \[main\.tex:117\]/);
});

test('builds fallback final reports without raw operation JSON', () => {
  const report = buildHumanCompletionReport({
    status: 'completed',
    notes: '已润色摘要的一句话。',
    operations: [
      { type: 'edit', path: 'main.tex', find: 'old', replace: 'new', reason: '语法更自然' }
    ],
    applyResults: [
      {
        applied: [{ operation: { type: 'edit', path: 'main.tex' }, result: { status: 'ok' } }],
        skipped: []
      }
    ],
    undoCount: 1
  });

  assert.match(report.text, /结论：已润色摘要的一句话。/);
  assert.match(report.text, /修改：\n- main\.tex：编辑/);
  assert.match(report.text, /写入结果：已写入 1 项，跳过 0 项/);
  assert.match(report.text, /可撤销：可撤销本轮 1 项写入/);
  assert.doesNotMatch(report.text, /"type"|"find"|"replace"|old|new/);
});

test('formatHumanReport omits empty sections', () => {
  const text = formatHumanReport({
    conclusion: '没有发现问题。',
    checked: [],
    findings: [],
    plannedChanges: [],
    appliedChanges: [],
    unchangedReason: '',
    nextStep: ''
  });

  assert.equal(text, '结论：没有发现问题。');
});
