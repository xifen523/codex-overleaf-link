(function initAgentTranscript(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafAgentTranscript = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function agentTranscriptFactory() {
  'use strict';

  const TECHNICAL_EVENT_PATTERNS = [
    /^agent\.command\./,
    /^native\.task\./,
    /^codex\.prompt\./,
    /^codex\.stdout\./,
    /^codex\.item\./,
    /^codex\.turn\./
  ];

  const OPERATION_LABELS = {
    edit: '编辑',
    create: '新建',
    rename: '重命名',
    move: '移动',
    delete: '删除'
  };

  function mapAgentEventToActivity(event = {}) {
    const type = String(event.type || '');

    if (type === 'overleaf.sync.started') {
      const fileCount = Number(event.detail?.fileCount) || 0;
      return {
        kind: 'activity',
        visible: true,
        title: fileCount
          ? `正在同步 Overleaf 项目到本地 Codex workspace：${fileCount} 个文本文件。`
          : '正在同步 Overleaf 项目到本地 Codex workspace。',
        status: 'running',
        technicalDetail: normalizeRawEvent(event)
      };
    }

    if (type === 'overleaf.sync.completed') {
      const fileCount = Number(event.detail?.fileCount) || 0;
      return {
        kind: 'activity',
        visible: true,
        title: fileCount
          ? `已同步 ${fileCount} 个文本文件，本地 Codex 将直接处理这份 workspace。`
          : '已同步 Overleaf 项目，本地 Codex 将直接处理这份 workspace。',
        status: 'completed',
        technicalDetail: normalizeRawEvent(event)
      };
    }

    if (type === 'overleaf.sync.changes') {
      const files = normalizeStringList(event.detail?.files);
      const changedCount = Number(event.detail?.changedCount) || files.length;
      return {
        kind: 'activity',
        visible: true,
        title: changedCount
          ? `Codex 本地改动已收集：${formatFilesInline(files)}。`
          : 'Codex 没有产生需要同步回 Overleaf 的文件改动。',
        status: 'completed',
        technicalDetail: normalizeRawEvent(event)
      };
    }

    if (type === 'codex.session.event' || type === 'codex.session.request') {
      return mapCodexSessionEvent(event);
    }

    if (type === 'agent.snapshot.preparing') {
      const fileCount = Number(event.detail?.fileCount) || 0;
      const totalChars = Number(event.detail?.totalChars) || 0;
      return {
        kind: 'activity',
        visible: true,
        title: fileCount
          ? `正在同步 Overleaf 项目到本地上下文：${fileCount} 个文本文件，约 ${formatCompactNumber(totalChars)} 字符。`
          : '正在同步 Overleaf 项目到本地上下文。',
        status: 'running',
        technicalDetail: normalizeRawEvent(event)
      };
    }

    if (type === 'agent.snapshot.ready') {
      const fileCount = Number(event.detail?.fileCount) || 0;
      return {
        kind: 'activity',
        visible: true,
        title: fileCount
          ? `已同步 ${fileCount} 个文本文件，Codex 将基于这份内容继续分析。`
          : '已同步 Overleaf 项目内容，Codex 将基于这份内容继续分析。',
        status: 'completed',
        technicalDetail: normalizeRawEvent(event)
      };
    }

    if (type === 'codex.exec.started') {
      return {
        kind: 'activity',
        visible: true,
        title: '本地 Codex 已开始处理这轮任务。',
        status: 'running',
        technicalDetail: normalizeRawEvent(event)
      };
    }

    if (type === 'codex.exec.completed') {
      const failed = event.status === 'failed' || Number(event.detail?.code) !== 0;
      return {
        kind: 'activity',
        visible: true,
        title: failed ? '本地 Codex 没有正常完成。' : '本地 Codex 已完成分析。',
        status: failed ? 'failed' : 'completed',
        technicalDetail: normalizeRawEvent(event)
      };
    }

    if (type === 'codex.command.started' || type === 'codex.command.completed') {
      return summarizeCommandActivity(event);
    }

    if (type === 'codex.agent.message') {
      const title = cleanVisibleText(event.detail?.text || event.title || '');
      if (!title || looksTechnical(title)) {
        return technicalOnly(event);
      }
      return {
        kind: 'activity',
        visible: true,
        title,
        status: event.status === 'failed' ? 'failed' : 'completed',
        technicalDetail: normalizeRawEvent(event)
      };
    }

    if (type === 'codex.agent.result') {
      return {
        kind: 'activity',
        visible: true,
        title: 'Codex 已整理出本轮结果，正在生成报告。',
        status: 'completed',
        technicalDetail: normalizeRawEvent(event)
      };
    }

    if (isTechnicalEventType(type)) {
      return technicalOnly(event);
    }

    const title = cleanVisibleText(event.title || '');
    if (!title || looksTechnical(title)) {
      return technicalOnly(event);
    }

    return {
      kind: 'activity',
      visible: true,
      title,
      status: event.status || 'running',
      technicalDetail: normalizeRawEvent(event)
    };
  }

  function mapCodexSessionEvent(event) {
    const method = String(event.detail?.method || event.title || '');
    const params = event.detail?.params || {};

    if (event.type === 'codex.session.request') {
      return {
        kind: 'activity',
        visible: true,
        title: formatCodexApprovalRequest(method),
        status: 'running',
        technicalDetail: normalizeRawEvent(event)
      };
    }

    if (method === 'thread/started') {
      return {
        kind: 'activity',
        visible: true,
        title: '本地 Codex session 已创建。',
        status: 'completed',
        technicalDetail: normalizeRawEvent(event)
      };
    }
    if (method === 'turn/started') {
      return {
        kind: 'activity',
        visible: true,
        title: 'Codex 开始处理这轮请求。',
        status: 'running',
        technicalDetail: normalizeRawEvent(event)
      };
    }
    if (method === 'turn/completed') {
      return {
        kind: 'activity',
        visible: true,
        title: 'Codex 完成本地处理，正在准备同步改动。',
        status: 'completed',
        technicalDetail: normalizeRawEvent(event)
      };
    }
    if (method === 'turn/plan/updated') {
      return {
        kind: 'activity',
        visible: true,
        title: formatPlanUpdateTitle(params),
        status: 'running',
        detail: formatPlanUpdateDetail(params),
        technicalDetail: normalizeRawEvent(event)
      };
    }
    if (method === 'turn/diff/updated') {
      const changedFiles = extractDiffFileCount(params.diff);
      return {
        kind: 'activity',
        visible: true,
        title: changedFiles
          ? `Codex 更新了本地文件差异：${changedFiles} 个文件。`
          : 'Codex 更新了本地文件差异。',
        status: 'running',
        technicalDetail: normalizeRawEvent(event)
      };
    }
    if (method === 'item/started' || method === 'item/completed') {
      return mapThreadItemEvent(params.item, method === 'item/started', event);
    }
    if (method === 'item/agentMessage/delta' || method === 'item/reasoning/summaryTextDelta') {
      const title = cleanVisibleText(params.delta || '');
      if (!title) {
        return technicalOnly(event);
      }
      return {
        kind: 'stream',
        visible: true,
        title,
        status: 'running',
        streamKey: getCodexStreamKey(method, params),
        streamRole: method === 'item/agentMessage/delta' ? 'assistant' : 'reasoning',
        appendText: true
      };
    }
    if (method === 'item/reasoning/summaryPartAdded') {
      return technicalOnly(event);
    }
    if (method === 'item/reasoning/textDelta') {
      return technicalOnly(event);
    }
    if (method === 'item/fileChange/patchUpdated') {
      const files = getPatchChangeFiles(params.changes);
      return {
        kind: 'activity',
        visible: true,
        title: files.length
          ? `Codex 正在修改本地文件：${formatFilesInline(files)}。`
          : 'Codex 正在修改本地文件。',
        status: 'running',
        technicalDetail: normalizeRawEvent(event)
      };
    }
    if (method === 'item/fileChange/outputDelta') {
      return {
        kind: 'activity',
        visible: true,
        title: 'Codex 正在写入本地文件。',
        status: 'running',
        technicalDetail: normalizeRawEvent(event)
      };
    }
    if (method === 'model/rerouted') {
      return {
        kind: 'activity',
        visible: true,
        title: 'Codex 已切换到可用模型继续运行。',
        status: 'running',
        technicalDetail: normalizeRawEvent(event)
      };
    }
    if (method === 'warning' || method === 'guardianWarning' || method === 'configWarning') {
      const title = cleanVisibleText(params.message || params.warning || '');
      return {
        kind: 'activity',
        visible: true,
        title: title || 'Codex 返回了一条运行提示。',
        status: 'running',
        technicalDetail: normalizeRawEvent(event)
      };
    }

    return technicalOnly(event);
  }

  function mapThreadItemEvent(item = {}, started, event) {
    const status = started ? 'running' : (item.status === 'failed' ? 'failed' : 'completed');
    if (item.type === 'agentMessage') {
      const title = cleanVisibleText(item.text || '');
      if (title) {
        return {
          kind: 'stream',
          visible: true,
          title,
          status,
          streamKey: getItemStreamKey('agent', item),
          streamRole: 'assistant',
          replaceText: true
        };
      }
    }
    if (item.type === 'reasoning') {
      const summary = normalizeStringList(item.summary).at(-1);
      if (!started && summary) {
        return {
          kind: 'stream',
          visible: true,
          title: summary,
          status,
          streamKey: getItemStreamKey('reasoning', item),
          streamRole: 'reasoning',
          replaceText: true
        };
      }
      return {
        kind: 'activity',
        visible: true,
        title: started ? 'Codex 正在分析。' : 'Codex 完成了一段分析。',
        status,
        technicalDetail: normalizeRawEvent(event)
      };
    }
    if (item.type === 'plan') {
      const title = cleanVisibleText(item.text || '');
      return {
        kind: 'activity',
        visible: true,
        title: title || 'Codex 更新了计划。',
        status,
        technicalDetail: normalizeRawEvent(event)
      };
    }
    if (item.type === 'commandExecution') {
      return summarizeCommandActivity({
        type: started ? 'codex.command.started' : 'codex.command.completed',
        status,
        detail: {
          command: item.command,
          output: item.aggregatedOutput,
          exitCode: item.exitCode
        }
      });
    }
    if (item.type === 'fileChange') {
      const files = getPatchChangeFiles(item.changes);
      return {
        kind: 'activity',
        visible: true,
        title: files.length
          ? `${started ? 'Codex 正在修改' : 'Codex 已修改'}本地文件：${formatFilesInline(files)}。`
          : (started ? 'Codex 正在修改本地文件。' : 'Codex 已完成本地文件修改。'),
        status,
        technicalDetail: normalizeRawEvent(event)
      };
    }
    if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') {
      return {
        kind: 'activity',
        visible: true,
        title: `${started ? '正在使用' : '已使用'}工具：${cleanVisibleText(item.tool || '本地工具')}。`,
        status,
        technicalDetail: normalizeRawEvent(event)
      };
    }

    return technicalOnly(event);
  }

  function formatCodexApprovalRequest(method) {
    if (/fileChange\/requestApproval/.test(method)) {
      return 'Codex 请求写入本地文件，正在按当前模式处理。';
    }
    if (/commandExecution\/requestApproval/.test(method)) {
      return 'Codex 请求运行本地命令，正在按当前模式处理。';
    }
    return 'Codex 请求继续操作，正在按当前模式处理。';
  }

  function getCodexStreamKey(method, params = {}) {
    const itemId = cleanVisibleText(params.itemId || params.item?.id || '');
    if (method === 'item/agentMessage/delta') {
      return `agent:${itemId || 'current'}`;
    }
    if (method === 'item/reasoning/summaryTextDelta') {
      return `reasoning:${itemId || 'current'}`;
    }
    return `${method}:${itemId || 'current'}`;
  }

  function getItemStreamKey(prefix, item = {}) {
    const itemId = cleanVisibleText(item.id || item.itemId || '');
    return `${prefix}:${itemId || 'current'}`;
  }

  function formatPlanUpdateTitle(params = {}) {
    const steps = Array.isArray(params.plan) ? params.plan : [];
    const active = steps.find(step => step.status === 'in_progress') || steps.find(step => step.status === 'pending');
    const text = cleanVisibleText(active?.step || params.explanation || '');
    return text ? `Codex 计划更新：${text}` : 'Codex 更新了执行计划。';
  }

  function formatPlanUpdateDetail(params = {}) {
    const steps = Array.isArray(params.plan) ? params.plan : [];
    if (!steps.length) {
      return undefined;
    }
    const labels = {
      pending: '待处理',
      in_progress: '进行中',
      completed: '已完成'
    };
    return {
      '计划': steps
        .map(step => `${labels[step.status] || step.status || '状态'}：${cleanVisibleText(step.step || '')}`)
        .filter(Boolean)
        .join('\n')
    };
  }

  function translateRawError(message, context = {}) {
    const text = String(message || '');
    if (/Mode must be "confirm" or "auto"/i.test(text)) {
      return {
        conclusion: '这轮没有写入：当前是“只问不改”，但这个任务需要写入权限。',
        nextStep: '请切换到“建议修改”或“自动写入”后重新运行。'
      };
    }
    if (/Agent returned invalid JSON/i.test(text)) {
      return {
        conclusion: '这轮没有写入：Codex 已结束，但本地桥接器没有读到可用结果。',
        nextStep: '请重新运行一次；如果再次失败，请打开技术详情查看本地 Codex 输出。'
      };
    }
    if (/Could not parse Codex output/i.test(text)) {
      return {
        conclusion: '这轮没有写入：Codex 返回的结果格式不完整。',
        nextStep: '请重新运行一次；如果再次失败，请打开技术详情查看原始输出。'
      };
    }
    if (/timed out/i.test(text)) {
      return {
        conclusion: '这轮没有写入：本地 Codex 运行超时。',
        nextStep: '请缩小 @context 或提高超时时间后重试。'
      };
    }
    if (/output limit exceeded/i.test(text)) {
      return {
        conclusion: '这轮没有写入：本地 Codex 输出过长，桥接器停止读取。',
        nextStep: '请缩小 @context 后重试，或在技术详情中查看输出限制。'
      };
    }
    if (/codex_not_found|Codex CLI was not found|ENOENT/i.test(text)) {
      return {
        conclusion: '这轮没有启动：本机没有找到 Codex CLI。',
        nextStep: '请确认终端里可以运行 `codex`，然后重新安装 native host 或刷新扩展后重试。'
      };
    }
    if (/checkpoint/i.test(text)) {
      return {
        conclusion: '这轮没有自动写入：Codex 没有拿到可恢复版本。',
        nextStep: '请切换到“建议修改”，或确认 Overleaf Reviewing 已开启后再用“自动写入”。'
      };
    }
    if (/changed while Codex was working|任务执行期间被你或协作者改过/i.test(text)) {
      return {
        conclusion: '这轮没有覆盖文件：任务执行期间文件被你或协作者改过。',
        nextStep: '请先确认 Overleaf 当前内容，再重新运行任务。'
      };
    }

    return {
      conclusion: context.mode === 'ask'
        ? '这轮分析失败：本地 Codex 没有返回可用说明。'
        : '这轮任务失败：本地 Codex 没有返回可用结果，未确认任何写入。',
      nextStep: '请查看技术详情，处理本地 Codex 错误后重试。'
    };
  }

  function buildHumanCompletionReport(input = {}) {
    const applyResults = normalizeApplyResults(input.applyResults);
    const appliedCount = applyResults.reduce((sum, result) => sum + (result.applied?.length || 0), 0);
    const skippedCount = applyResults.reduce((sum, result) => sum + (result.skipped?.length || 0), 0);
    const translatedError = input.errorMessage ? translateRawError(input.errorMessage, { mode: input.mode }) : null;
    const userReport = normalizeUserReport(input.userReport);
    const report = userReport || buildFallbackReport(input, {
      appliedCount,
      skippedCount,
      translatedError
    });

    if (!report.writeResult && (applyResults.length || input.includeWriteResult)) {
      report.writeResult = `已写入 ${appliedCount} 项，跳过 ${skippedCount} 项`;
    }
    if (!report.undo && input.undoCount !== undefined) {
      report.undo = input.undoCount
        ? `可撤销本轮 ${input.undoCount} 项写入`
        : '本轮没有可撤销的写入';
    }

    const failed = input.status === 'failed' || input.status === 'blocked';
    return {
      title: '本轮完成报告',
      status: failed ? 'failed' : 'completed',
      text: formatHumanReport(report)
    };
  }

  function formatHumanReport(report = {}) {
    const sections = [];
    const conclusion = cleanVisibleMarkdownText(report.conclusion || '');
    if (conclusion) {
      sections.push(`结论：${conclusion}`);
    }
    addListSection(sections, '检查范围', report.checked);
    addListSection(sections, '发现', report.findings);
    addListSection(sections, '计划修改', report.plannedChanges);
    addListSection(sections, '修改', report.appliedChanges);
    const unchangedReason = cleanVisibleText(report.unchangedReason || '');
    if (unchangedReason) {
      sections.push(`未修改原因：${unchangedReason}`);
    }
    const writeResult = cleanVisibleText(report.writeResult || '');
    if (writeResult) {
      sections.push(`写入结果：${writeResult}`);
    }
    const undo = cleanVisibleText(report.undo || '');
    if (undo) {
      sections.push(`可撤销：${undo}`);
    }
    const nextStep = cleanVisibleText(report.nextStep || '');
    if (nextStep) {
      sections.push(`下一步：${nextStep}`);
    }
    return sections.join('\n\n');
  }

  function buildFallbackReport(input, counts) {
    const operations = Array.isArray(input.operations) ? input.operations : [];
    const appliedOperations = collectAppliedOperations(input.applyResults);
    const affectedFiles = collectAffectedFiles(operations, input.summary, input.applyResults);
    const noWrites = operations.length === 0 && appliedOperations.length === 0;
    const conclusion = counts.translatedError?.conclusion
      || input.conclusion
      || input.notes
      || (noWrites ? '这轮任务已完成，没有写入 Overleaf 文件。' : '这轮任务已完成。');

    return {
      conclusion,
      checked: normalizeStringList(input.checked || input.userReport?.checked),
      findings: normalizeStringList(input.findings),
      plannedChanges: counts.appliedCount ? [] : operations.map(formatOperationLine),
      appliedChanges: appliedOperations.map(formatOperationLine),
      unchangedReason: input.unchangedReason || (noWrites ? inferUnchangedReason(input) : ''),
      writeResult: input.writeResult || (counts.appliedCount || counts.skippedCount
        ? `已写入 ${counts.appliedCount} 项，跳过 ${counts.skippedCount} 项`
        : ''),
      undo: input.undo,
      nextStep: input.nextStep || counts.translatedError?.nextStep || formatFallbackNextStep(input, counts.skippedCount, affectedFiles)
    };
  }

  function inferUnchangedReason(input) {
    if (input.mode === 'ask' || input.status === '只问不改') {
      return '这轮是只问不改。';
    }
    if (input.status === 'rejected') {
      return '你取消了这轮修改。';
    }
    return '';
  }

  function formatFallbackNextStep(input, skippedCount, affectedFiles) {
    if (skippedCount) {
      return '请查看本轮报告中的跳过项，处理后可以重试。';
    }
    if (input.status === 'blocked' || input.status === 'failed') {
      return '请处理上面的原因后重试。';
    }
    if (!affectedFiles.length) {
      return '可以继续追问，或加入更多 @context 后再检查。';
    }
    return '请在 Overleaf 中查看这些文件的留痕修改。';
  }

  function normalizeUserReport(report) {
    if (!report || typeof report !== 'object') {
      return null;
    }
    return {
      conclusion: cleanVisibleMarkdownText(report.conclusion || ''),
      checked: normalizeStringList(report.checked),
      findings: normalizeStringList(report.findings),
      plannedChanges: normalizeStringList(report.plannedChanges),
      appliedChanges: normalizeStringList(report.appliedChanges),
      unchangedReason: cleanVisibleText(report.unchangedReason || ''),
      nextStep: cleanVisibleText(report.nextStep || '')
    };
  }

  function technicalOnly(event) {
    return {
      kind: 'technical',
      visible: false,
      title: '技术详情',
      status: event?.status || 'info',
      detail: normalizeRawEvent(event)
    };
  }

  function normalizeRawEvent(event = {}) {
    return {
      type: event.type || 'unknown',
      title: event.title || '',
      status: event.status || '',
      timestamp: event.timestamp || '',
      detail: event.detail || {}
    };
  }

  function isTechnicalEventType(type) {
    return TECHNICAL_EVENT_PATTERNS.some(pattern => pattern.test(type));
  }

  function summarizeCommandActivity(event) {
    const type = String(event.type || '');
    const command = String(event.detail?.command || '');
    const output = String(event.detail?.output || '');
    const commandKind = classifyCommand(command);
    const running = type === 'codex.command.started';
    const failed = event.status === 'failed' || Number(event.detail?.exitCode) > 0;

    if (running) {
      return {
        kind: 'activity',
        visible: true,
        title: formatCommandStartedTitle(commandKind, command),
        status: 'running',
        detail: formatCommandPublicDetail(commandKind, command),
        technicalDetail: normalizeRawEvent(event)
      };
    }

    return {
      kind: 'activity',
      visible: true,
      title: formatCommandCompletedTitle(commandKind, output, failed),
      status: failed ? 'failed' : 'completed',
      detail: formatCommandPublicDetail(commandKind, command),
      technicalDetail: normalizeRawEvent(event)
    };
  }

  function classifyCommand(command) {
    const text = String(command || '').trim();
    if (/^(rg|grep)\b/i.test(text) || /\b(rg|grep)\b/i.test(text)) {
      return 'search';
    }
    if (/^(cat|sed|nl|head|tail|awk)\b/i.test(text)) {
      return 'read';
    }
    if (/\b(latexmk|pdflatex|xelatex|lualatex|bibtex|biber)\b/i.test(text)) {
      return 'compile';
    }
    if (/^(ls|find)\b/i.test(text)) {
      return 'list';
    }
    return 'check';
  }

  function formatCommandStartedTitle(kind, command) {
    if (kind === 'search') {
      const query = extractSearchQuery(command);
      return query ? `正在搜索项目内容：${query}` : '正在搜索项目内容。';
    }
    if (kind === 'read') {
      return '正在读取相关文件内容。';
    }
    if (kind === 'compile') {
      return '正在运行 LaTeX 相关检查。';
    }
    if (kind === 'list') {
      return '正在查看项目文件结构。';
    }
    return '正在执行一次本地检查。';
  }

  function formatCommandCompletedTitle(kind, output, failed) {
    if (failed) {
      if (kind === 'search') {
        return '搜索没有正常完成。';
      }
      if (kind === 'compile') {
        return 'LaTeX 检查没有正常完成。';
      }
      return '本地检查没有正常完成。';
    }

    if (kind === 'search') {
      const count = countMeaningfulLines(output);
      return count ? `搜索完成，找到 ${count} 条相关线索。` : '搜索完成，没有找到明显相关线索。';
    }
    if (kind === 'read') {
      return '相关文件内容已读取。';
    }
    if (kind === 'compile') {
      return 'LaTeX 相关检查已完成。';
    }
    if (kind === 'list') {
      return '项目文件结构已查看。';
    }
    return '本地检查已完成。';
  }

  function formatCommandPublicDetail(kind, command) {
    if (kind !== 'search') {
      return undefined;
    }
    const query = extractSearchQuery(command);
    return query ? { '搜索目标': query } : undefined;
  }

  function extractSearchQuery(command) {
    const text = String(command || '').trim();
    const match = text.match(/\b(?:rg|grep)\s+(?:-[^\s]+\s+)*(['"]?)([^'"\s][^'"]*?)\1(?:\s|$)/i);
    if (!match) {
      return '';
    }
    return cleanVisibleText(match[2])
      .replace(/[\\{}]/g, '')
      .slice(0, 40);
  }

  function countMeaningfulLines(output) {
    return String(output || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .length;
  }

  function extractDiffFileCount(diff) {
    const files = new Set();
    for (const line of String(diff || '').split(/\r?\n/)) {
      const match = line.match(/^diff --git a\/(.+?) b\//);
      if (match?.[1]) {
        files.add(match[1]);
      }
    }
    return files.size;
  }

  function getPatchChangeFiles(changes = []) {
    const files = [];
    const seen = new Set();
    for (const change of Array.isArray(changes) ? changes : []) {
      const filePath = cleanVisibleText(change?.path || '');
      if (filePath && !seen.has(filePath)) {
        seen.add(filePath);
        files.push(filePath);
      }
    }
    return files;
  }

  function formatFilesInline(files = []) {
    const values = normalizeStringList(files);
    if (!values.length) {
      return '没有文件';
    }
    if (values.length <= 3) {
      return values.join('、');
    }
    return `${values.slice(0, 3).join('、')} 等 ${values.length} 个文件`;
  }

  function formatCompactNumber(value) {
    const number = Number(value) || 0;
    if (number >= 1000000) {
      return `${Math.round(number / 100000) / 10}M`;
    }
    if (number >= 1000) {
      return `${Math.round(number / 100) / 10}k`;
    }
    return String(number);
  }

  function looksTechnical(text) {
    const value = String(text || '').trim();
    return /^(\{|\[)/.test(value)
      || /stdout|stderr|schema|JSON|exit[_ ]?code|CODEX_OVERLEAF_EVENT/i.test(value)
      || /^(codex|agent|native)\.[a-z0-9_.-]+/i.test(value)
      || /^[a-z]+(?:\/[a-zA-Z0-9]+)+/.test(value);
  }

  function cleanVisibleText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function cleanVisibleMarkdownText(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[^\S\n]+/g, ' ')
      .split('\n')
      .map(line => line.trim())
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function addListSection(sections, label, values) {
    const items = normalizeStringList(values);
    if (!items.length) {
      return;
    }
    sections.push(`${label}：\n${items.map(item => `- ${item}`).join('\n')}`);
  }

  function normalizeStringList(value) {
    const values = Array.isArray(value) ? value : (value ? [value] : []);
    return values
      .map(item => cleanVisibleText(item))
      .filter(Boolean);
  }

  function normalizeApplyResults(applyResults) {
    if (!applyResults) {
      return [];
    }
    return Array.isArray(applyResults) ? applyResults.filter(Boolean) : [applyResults];
  }

  function collectAppliedOperations(applyResults) {
    const operations = [];
    for (const result of normalizeApplyResults(applyResults)) {
      for (const item of result.applied || []) {
        if (item?.operation) {
          operations.push(item.operation);
        }
      }
    }
    return operations;
  }

  function collectAffectedFiles(operations = [], summary, applyResults = []) {
    const files = [];
    const seen = new Set();
    const add = filePath => {
      if (!filePath || seen.has(filePath)) {
        return;
      }
      seen.add(filePath);
      files.push(filePath);
    };
    for (const filePath of summary?.affectedFiles || []) {
      add(filePath);
    }
    for (const operation of operations || []) {
      add(operation?.path || operation?.from || operation?.to);
    }
    for (const result of normalizeApplyResults(applyResults)) {
      for (const item of [...(result?.applied || []), ...(result?.skipped || [])]) {
        add(item?.operation?.path || item?.operation?.from || item?.operation?.to);
      }
    }
    return files;
  }

  function formatOperationLine(operation) {
    const label = OPERATION_LABELS[operation?.type] || operation?.type || '处理';
    const filePath = operation?.path || operation?.from || operation?.to || '未知文件';
    const reason = cleanVisibleText(operation?.reason || '');
    return reason ? `${filePath}：${label}（${reason}）` : `${filePath}：${label}`;
  }

  return {
    buildHumanCompletionReport,
    formatHumanReport,
    mapAgentEventToActivity,
    translateRawError
  };
});
