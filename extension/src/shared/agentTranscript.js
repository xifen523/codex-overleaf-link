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
    zh: {
      edit: '编辑',
      create: '新建',
      rename: '重命名',
      move: '移动',
      delete: '删除'
    },
    en: {
      edit: 'edit',
      create: 'create',
      rename: 'rename',
      move: 'move',
      delete: 'delete'
    }
  };

  function normalizeLocale(options = {}) {
    return options?.locale === 'en' ? 'en' : 'zh';
  }

  function textFor(locale, zh, en) {
    return locale === 'en' ? en : zh;
  }

  function mapAgentEventToActivity(event = {}, options = {}) {
    const locale = normalizeLocale(options);
    const type = String(event.type || '');

    if (isContextCompactionEvent(event)) {
      return formatContextCompactionCheckpoint(event, locale);
    }

    if (type === 'overleaf.sync.started') {
      const fileCount = Number(event.detail?.fileCount) || 0;
      return {
        kind: 'activity',
        visible: true,
        title: fileCount
          ? textFor(locale, `正在同步 Overleaf 项目到本地 Codex workspace：${fileCount} 个文本文件。`, `Syncing the Overleaf project into the local Codex workspace: ${fileCount} text files.`)
          : textFor(locale, '正在同步 Overleaf 项目到本地 Codex workspace。', 'Syncing the Overleaf project into the local Codex workspace.'),
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
          ? textFor(locale, `已同步 ${fileCount} 个文本文件，本地 Codex 将直接处理这份 workspace。`, `Synced ${fileCount} text files. Local Codex will work from this workspace.`)
          : textFor(locale, '已同步 Overleaf 项目，本地 Codex 将直接处理这份 workspace。', 'Synced the Overleaf project. Local Codex will work from this workspace.'),
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
          ? textFor(locale, `Codex 本地改动已收集：${formatFilesInline(files, locale)}。`, `Collected local Codex changes: ${formatFilesInline(files, locale)}.`)
          : textFor(locale, 'Codex 没有产生需要同步回 Overleaf 的文件改动。', 'Codex did not produce file changes to sync back to Overleaf.'),
        status: 'completed',
        technicalDetail: normalizeRawEvent(event)
      };
    }

    if (type === 'codex.session.event' || type === 'codex.session.request') {
      return mapCodexSessionEvent(event, locale);
    }

    if (type === 'agent.snapshot.preparing') {
      const fileCount = Number(event.detail?.fileCount) || 0;
      const totalChars = Number(event.detail?.totalChars) || 0;
      return {
        kind: 'activity',
        visible: true,
        title: fileCount
          ? textFor(locale, `正在同步 Overleaf 项目到本地上下文：${fileCount} 个文本文件，约 ${formatCompactNumber(totalChars)} 字符。`, `Syncing the Overleaf project into local context: ${fileCount} text files, about ${formatCompactNumber(totalChars)} characters.`)
          : textFor(locale, '正在同步 Overleaf 项目到本地上下文。', 'Syncing the Overleaf project into local context.'),
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
          ? textFor(locale, `已同步 ${fileCount} 个文本文件，Codex 将基于这份内容继续分析。`, `Synced ${fileCount} text files. Codex will continue from this content.`)
          : textFor(locale, '已同步 Overleaf 项目内容，Codex 将基于这份内容继续分析。', 'Synced the Overleaf project. Codex will continue from this content.'),
        status: 'completed',
        technicalDetail: normalizeRawEvent(event)
      };
    }

    if (type === 'codex.exec.started') {
      return {
        kind: 'activity',
        visible: true,
        title: textFor(locale, '本地 Codex 已开始处理这轮任务。', 'Local Codex started this task.'),
        status: 'running',
        technicalDetail: normalizeRawEvent(event)
      };
    }

    if (type === 'codex.exec.completed') {
      const failed = event.status === 'failed' || Number(event.detail?.code) !== 0;
      return {
        kind: 'activity',
        visible: true,
        title: failed ? textFor(locale, '本地 Codex 没有正常完成。', 'Local Codex did not finish normally.') : textFor(locale, '本地 Codex 已完成分析。', 'Local Codex finished analysis.'),
        status: failed ? 'failed' : 'completed',
        technicalDetail: normalizeRawEvent(event)
      };
    }

    if (type === 'codex.command.started' || type === 'codex.command.completed') {
      return summarizeCommandActivity(event, locale);
    }

    if (type === 'codex.agent.message') {
      const title = cleanVisibleText(event.detail?.text || event.title || '');
      if (!title || looksTechnical(title)) {
        return technicalOnly(event, locale);
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
        title: textFor(locale, 'Codex 已整理出本轮结果，正在生成报告。', 'Codex prepared this task result and is generating the report.'),
        status: 'completed',
        technicalDetail: normalizeRawEvent(event)
      };
    }

    if (isTechnicalEventType(type)) {
      return technicalOnly(event, locale);
    }

    const title = cleanVisibleText(event.title || '');
    if (!title || looksTechnical(title)) {
      return technicalOnly(event, locale);
    }

    return {
      kind: 'activity',
      visible: true,
      title,
      status: event.status || 'running',
      technicalDetail: normalizeRawEvent(event)
    };
  }

  function mapCodexSessionEvent(event, locale) {
    const method = String(event.detail?.method || event.title || '');
    const params = event.detail?.params || {};

    if (isContextCompactionEvent(event)) {
      return formatContextCompactionCheckpoint(event, locale);
    }

    if (event.type === 'codex.session.request') {
      return {
        kind: 'activity',
        visible: true,
        title: formatCodexApprovalRequest(method, locale),
        status: 'running',
        technicalDetail: normalizeRawEvent(event)
      };
    }

    if (method === 'thread/started') {
      return {
        kind: 'activity',
        visible: true,
        title: textFor(locale, '本地 Codex session 已创建。', 'Local Codex session created.'),
        status: 'completed',
        technicalDetail: normalizeRawEvent(event)
      };
    }
    if (method === 'turn/started') {
      return {
        kind: 'activity',
        visible: true,
        title: textFor(locale, 'Codex 开始处理这轮请求。', 'Codex started processing this request.'),
        status: 'running',
        technicalDetail: normalizeRawEvent(event)
      };
    }
    if (method === 'turn/completed') {
      return {
        kind: 'activity',
        visible: true,
        title: textFor(locale, 'Codex 完成本地处理，正在准备同步改动。', 'Codex finished local processing and is preparing to sync changes.'),
        status: 'completed',
        technicalDetail: normalizeRawEvent(event)
      };
    }
    if (method === 'turn/plan/updated') {
      return {
        kind: 'activity',
        visible: true,
        title: formatPlanUpdateTitle(params, locale),
        status: 'running',
        detail: formatPlanUpdateDetail(params, locale),
        technicalDetail: normalizeRawEvent(event)
      };
    }
    if (method === 'turn/diff/updated') {
      const changedFiles = extractDiffFileCount(params.diff);
      return {
        kind: 'activity',
        visible: true,
        title: changedFiles
          ? textFor(locale, `Codex 更新了本地文件差异：${changedFiles} 个文件。`, `Codex updated local file diffs: ${changedFiles} file(s).`)
          : textFor(locale, 'Codex 更新了本地文件差异。', 'Codex updated local file diffs.'),
        status: 'running',
        technicalDetail: normalizeRawEvent(event)
      };
    }
    if (method === 'item/started' || method === 'item/completed') {
      return mapThreadItemEvent(params.item, method === 'item/started', event, locale);
    }
    if (method === 'item/agentMessage/delta' || method === 'item/reasoning/summaryTextDelta') {
      const title = cleanStreamDeltaText(params.delta || '');
      if (!title.length) {
        return technicalOnly(event, locale);
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
      return technicalOnly(event, locale);
    }
    if (method === 'item/reasoning/textDelta') {
      return technicalOnly(event, locale);
    }
    if (method === 'item/fileChange/patchUpdated') {
      const files = getPatchChangeFiles(params.changes);
      return {
        kind: 'activity',
        visible: true,
        title: files.length
          ? textFor(locale, `Codex 正在修改本地文件：${formatFilesInline(files, locale)}。`, `Codex is editing local files: ${formatFilesInline(files, locale)}.`)
          : textFor(locale, 'Codex 正在修改本地文件。', 'Codex is editing local files.'),
        status: 'running',
        technicalDetail: normalizeRawEvent(event)
      };
    }
    if (method === 'item/fileChange/outputDelta') {
      return {
        kind: 'activity',
        visible: true,
        title: textFor(locale, 'Codex 正在写入本地文件。', 'Codex is writing local files.'),
        status: 'running',
        technicalDetail: normalizeRawEvent(event)
      };
    }
    if (method === 'model/rerouted') {
      return {
        kind: 'activity',
        visible: true,
        title: textFor(locale, 'Codex 已切换到可用模型继续运行。', 'Codex switched to an available model and continued.'),
        status: 'running',
        technicalDetail: normalizeRawEvent(event)
      };
    }
    if (method === 'warning' || method === 'guardianWarning' || method === 'configWarning') {
      const title = cleanVisibleText(params.message || params.warning || '');
      return {
        kind: 'activity',
        visible: true,
        title: title || textFor(locale, 'Codex 返回了一条运行提示。', 'Codex returned a runtime notice.'),
        status: 'running',
        technicalDetail: normalizeRawEvent(event)
      };
    }

    return technicalOnly(event, locale);
  }

  function isContextCompactionEvent(event = {}) {
    const type = String(event.type || '');
    const method = String(event.detail?.method || event.title || '');
    const label = `${type} ${method}`;
    return /(compact|compaction|compacted)/i.test(label)
      && /(context|thread|turn|conversation|codex)/i.test(label);
  }

  function formatContextCompactionCheckpoint(event = {}, locale = 'zh') {
    const method = String(event.detail?.method || event.title || '');
    const running = event.status === 'running' || /(started|starting|begin|prepar)/i.test(method);
    return {
      kind: 'checkpoint',
      visible: true,
      title: running
        ? textFor(locale, '正在压缩上下文，Codex 会继续处理。', 'Compacting context; Codex will continue.')
        : textFor(locale, '上下文已压缩，Codex 继续处理。', 'Context compacted; Codex continued.'),
      status: running ? 'running' : 'completed',
      technicalDetail: normalizeRawEvent(event)
    };
  }

  function mapThreadItemEvent(item = {}, started, event, locale) {
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
        title: started ? textFor(locale, 'Codex 正在分析。', 'Codex is analyzing.') : textFor(locale, 'Codex 完成了一段分析。', 'Codex completed an analysis step.'),
        status,
        technicalDetail: normalizeRawEvent(event)
      };
    }
    if (item.type === 'plan') {
      const title = cleanVisibleText(item.text || '');
      return {
        kind: 'activity',
        visible: true,
        title: title || textFor(locale, 'Codex 更新了计划。', 'Codex updated its plan.'),
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
      }, locale);
    }
    if (item.type === 'fileChange') {
      const files = getPatchChangeFiles(item.changes);
      return {
        kind: 'activity',
        visible: true,
        title: files.length
          ? (started
            ? textFor(locale, `Codex 正在修改本地文件：${formatFilesInline(files, locale)}。`, `Codex is editing local files: ${formatFilesInline(files, locale)}.`)
            : textFor(locale, `Codex 已修改本地文件：${formatFilesInline(files, locale)}。`, `Codex edited local files: ${formatFilesInline(files, locale)}.`))
          : (started
            ? textFor(locale, 'Codex 正在修改本地文件。', 'Codex is editing local files.')
            : textFor(locale, 'Codex 已完成本地文件修改。', 'Codex finished local file edits.')),
        status,
        technicalDetail: normalizeRawEvent(event)
      };
    }
    if (item.type === 'mcpToolCall' || item.type === 'dynamicToolCall') {
      return {
        kind: 'activity',
        visible: true,
        title: started
          ? textFor(locale, `正在使用工具：${cleanVisibleText(item.tool || '本地工具')}。`, `Using tool: ${cleanVisibleText(item.tool || 'local tool')}.`)
          : textFor(locale, `已使用工具：${cleanVisibleText(item.tool || '本地工具')}。`, `Used tool: ${cleanVisibleText(item.tool || 'local tool')}.`),
        status,
        technicalDetail: normalizeRawEvent(event)
      };
    }

    return technicalOnly(event, locale);
  }

  function formatCodexApprovalRequest(method, locale) {
    if (/fileChange\/requestApproval/.test(method)) {
      return textFor(locale, 'Codex 请求写入本地文件，正在按当前模式处理。', 'Codex requested local file writes; handling according to the current mode.');
    }
    if (/commandExecution\/requestApproval/.test(method)) {
      return textFor(locale, 'Codex 请求运行本地命令，正在按当前模式处理。', 'Codex requested a local command; handling according to the current mode.');
    }
    return textFor(locale, 'Codex 请求继续操作，正在按当前模式处理。', 'Codex requested to continue; handling according to the current mode.');
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

  function formatPlanUpdateTitle(params = {}, locale = 'zh') {
    const steps = Array.isArray(params.plan) ? params.plan : [];
    const active = steps.find(step => step.status === 'in_progress') || steps.find(step => step.status === 'pending');
    const text = cleanVisibleText(active?.step || params.explanation || '');
    return text
      ? textFor(locale, `Codex 计划更新：${text}`, `Codex plan update: ${text}`)
      : textFor(locale, 'Codex 更新了执行计划。', 'Codex updated its plan.');
  }

  function formatPlanUpdateDetail(params = {}, locale = 'zh') {
    const steps = Array.isArray(params.plan) ? params.plan : [];
    if (!steps.length) {
      return undefined;
    }
    const labels = locale === 'en'
      ? { pending: 'pending', in_progress: 'in progress', completed: 'completed' }
      : { pending: '待处理', in_progress: '进行中', completed: '已完成' };
    return {
      [textFor(locale, '计划', 'Plan')]: steps
        .map(step => `${labels[step.status] || step.status || '状态'}：${cleanVisibleText(step.step || '')}`)
        .filter(Boolean)
        .join('\n')
    };
  }

  function translateRawError(message, context = {}) {
    const locale = normalizeLocale(context);
    const text = String(message || '');
    if (/Mode must be "confirm" or "auto"/i.test(text)) {
      return {
        conclusion: textFor(locale, '这轮没有写入：当前是“只问不改”，但这个任务需要写入权限。', 'No files were written: this task needs write access, but the current mode is Ask.'),
        nextStep: textFor(locale, '请切换到“建议修改”或“自动写入”后重新运行。', 'Switch to Suggest or Auto and run the task again.')
      };
    }
    if (/Agent returned invalid JSON/i.test(text)) {
      return {
        conclusion: textFor(locale, '这轮没有写入：Codex 已结束，但本地桥接器没有读到可用结果。', 'No files were written: Codex finished, but the local bridge did not receive a usable result.'),
        nextStep: textFor(locale, '请重新运行一次；如果再次失败，请打开技术详情查看本地 Codex 输出。', 'Run it again. If it fails again, open Technical Details to inspect local Codex output.')
      };
    }
    if (/Could not parse Codex output/i.test(text)) {
      return {
        conclusion: textFor(locale, '这轮没有写入：Codex 返回的结果格式不完整。', 'No files were written: Codex returned an incomplete result format.'),
        nextStep: textFor(locale, '请重新运行一次；如果再次失败，请打开技术详情查看原始输出。', 'Run it again. If it fails again, open Technical Details to inspect the raw output.')
      };
    }
    if (/timed out/i.test(text)) {
      return {
        conclusion: textFor(locale, '这轮没有写入：本地 Codex 长时间没有完成。', 'No files were written: local Codex took too long to finish.'),
        nextStep: textFor(locale, '请检查本机 Codex 是否仍在运行；如果没有进展，可以中断后缩小 @context 再重试。', 'Check whether local Codex is still running. If there is no progress, cancel and retry with smaller @context.')
      };
    }
    if (/output limit exceeded/i.test(text)) {
      return {
        conclusion: textFor(locale, '这轮没有写入：本地 Codex 输出过长，桥接器停止读取。', 'No files were written: local Codex output was too large, so the bridge stopped reading.'),
        nextStep: textFor(locale, '请缩小 @context 后重试，或在技术详情中查看输出限制。', 'Retry with smaller @context, or open Technical Details to inspect the output limit.')
      };
    }
    if (/codex_not_found|Codex CLI was not found|ENOENT/i.test(text)) {
      return {
        conclusion: textFor(locale, '这轮没有启动：本机没有找到 Codex CLI。', 'This run did not start: Codex CLI was not found locally.'),
        nextStep: textFor(locale, '请确认终端里可以运行 `codex`，然后重新安装 native host 或刷新扩展后重试。', 'Confirm `codex` works in Terminal, then reinstall the native host or reload the extension.')
      };
    }
    if (/unsupported[_ ]parameter/i.test(text) && /reasoning\.summary|summary/i.test(text)) {
      return {
        conclusion: textFor(locale, '这轮没有继续：当前 Codex 模型不支持插件请求的推理摘要参数。', 'This run did not continue: the selected Codex model does not support the requested reasoning summary parameter.'),
        nextStep: textFor(locale, '请刷新扩展并重新运行；插件会按模型能力自动去掉不兼容参数。', 'Reload the extension and run again; the plugin will omit incompatible parameters based on model capability.')
      };
    }
    if (/quota|kQuotaBytes|QUOTA_BYTES/i.test(text)) {
      return {
        conclusion: textFor(locale, 'Codex 结果已经生成，但本地会话记录超出 Chrome 存储配额。', 'Codex produced a result, but local session history exceeded Chrome storage quota.'),
        nextStep: textFor(locale, '请删除一些旧 session，或刷新扩展后重试；这不是论文分析本身失败。', 'Delete older sessions or reload the extension and retry. The paper analysis itself did not fail.')
      };
    }
    if (/checkpoint/i.test(text)) {
      return {
        conclusion: textFor(locale, '这轮没有自动写入：Codex 没有拿到可恢复版本。', 'This run did not auto-write: Codex did not get a recoverable version.'),
        nextStep: textFor(locale, '请切换到“建议修改”，或确认 Overleaf Reviewing 已开启后再用“自动写入”。', 'Switch to Suggest, or confirm Overleaf Reviewing is enabled before using Auto.')
      };
    }
    if (/changed while Codex was working|任务执行期间被你或协作者改过/i.test(text)) {
      return {
        conclusion: textFor(locale, '这轮没有覆盖文件：任务执行期间文件被你或协作者改过。', 'No file was overwritten: a file changed while Codex was working.'),
        nextStep: textFor(locale, '请先确认 Overleaf 当前内容，再重新运行任务。', 'Review the current Overleaf content, then run the task again.')
      };
    }

    return {
      conclusion: context.mode === 'ask'
        ? textFor(locale, '这轮只问不改没有完成：本地 Codex 没有正常完成，因此没有生成最终说明。', 'This Ask run did not complete: local Codex did not finish normally, so no final answer was generated.')
        : textFor(locale, '这轮任务失败：本地 Codex 没有返回可用结果，未确认任何写入。', 'This task failed: local Codex returned no usable result, so no writes were confirmed.'),
      nextStep: textFor(locale, '请查看技术详情，处理本地 Codex 错误后重试。', 'Open Technical Details, resolve the local Codex error, and retry.')
    };
  }

  function buildHumanCompletionReport(input = {}) {
    const locale = normalizeLocale(input);
    const applyResults = normalizeApplyResults(input.applyResults);
    const appliedCount = applyResults.reduce((sum, result) => sum + (result.applied?.length || 0), 0);
    const skippedCount = applyResults.reduce((sum, result) => sum + (result.skipped?.length || 0), 0);
    const translatedError = input.errorMessage ? translateRawError(input.errorMessage, { mode: input.mode, locale }) : null;
    const userReport = normalizeUserReport(input.userReport);
    const report = userReport || buildFallbackReport(input, {
      appliedCount,
      skippedCount,
      translatedError
    }, locale);

    if (!report.writeResult && (applyResults.length || input.includeWriteResult)) {
      report.writeResult = formatWriteResult(appliedCount, skippedCount, locale);
    }
    if (!report.undo && input.undoCount !== undefined) {
      report.undo = input.undoCount
        ? textFor(locale, `可撤销本轮 ${input.undoCount} 项写入`, `this run has ${input.undoCount} reversible write${Number(input.undoCount) === 1 ? '' : 's'}`)
        : textFor(locale, '本轮没有可撤销的写入', 'this run has no reversible writes');
    }

    const failed = input.status === 'failed' || input.status === 'blocked';
    return {
      title: textFor(locale, '本轮完成报告', 'Task report'),
      status: failed ? 'failed' : 'completed',
      text: formatHumanReport(report, locale)
    };
  }

  function formatHumanReport(report = {}, locale = 'zh') {
    const sections = [];
    const conclusion = cleanVisibleMarkdownText(report.conclusion || '');
    if (conclusion) {
      sections.push(textFor(locale, `结论：${conclusion}`, `Conclusion: ${conclusion}`));
    }
    addListSection(sections, textFor(locale, '检查范围', 'Checked'), report.checked, locale);
    addListSection(sections, textFor(locale, '发现', 'Findings'), report.findings, locale);
    addListSection(sections, textFor(locale, '计划修改', 'Planned changes'), report.plannedChanges, locale);
    addListSection(sections, textFor(locale, '修改', 'Changes'), report.appliedChanges, locale);
    const unchangedReason = localizeVisibleReason(report.unchangedReason || '', locale);
    if (unchangedReason) {
      sections.push(textFor(locale, `未修改原因：${unchangedReason}`, `Why nothing changed: ${unchangedReason}`));
    }
    const writeResult = cleanVisibleText(report.writeResult || '');
    if (writeResult) {
      sections.push(textFor(locale, `写入结果：${writeResult}`, `Write result: ${writeResult}`));
    }
    addListSection(sections, textFor(locale, '跳过原因', 'Skipped'), report.skippedChanges, locale);
    const undo = cleanVisibleText(report.undo || '');
    if (undo) {
      sections.push(textFor(locale, `可撤销：${undo}`, `Undo: ${undo}`));
    }
    const nextStep = cleanVisibleText(report.nextStep || '');
    if (nextStep) {
      sections.push(textFor(locale, `下一步：${nextStep}`, `Next: ${nextStep}`));
    }
    return sections.join('\n\n');
  }

  function buildFallbackReport(input, counts, locale = 'zh') {
    const operations = Array.isArray(input.operations) ? input.operations : [];
    const appliedOperations = collectAppliedOperations(input.applyResults);
    const affectedFiles = collectAffectedFiles(operations, input.summary, input.applyResults);
    const noWrites = operations.length === 0 && appliedOperations.length === 0;
    const conclusion = counts.translatedError?.conclusion
      || input.conclusion
      || input.notes
      || (noWrites
        ? textFor(locale, '这轮任务已完成，没有写入 Overleaf 文件。', 'This task completed without writing Overleaf files.')
        : textFor(locale, '这轮任务已完成。', 'This task completed.'));

    return {
      conclusion,
      checked: normalizeStringList(input.checked || input.userReport?.checked),
      findings: normalizeStringList(input.findings),
      plannedChanges: counts.appliedCount ? [] : operations.map(operation => formatOperationLine(operation, locale)),
      appliedChanges: appliedOperations.map(operation => formatOperationLine(operation, locale)),
      skippedChanges: collectSkippedOperations(input.applyResults).map(item => formatSkippedOperationLine(item, locale)),
      unchangedReason: input.unchangedReason || (noWrites ? inferUnchangedReason(input, locale) : ''),
      writeResult: input.writeResult || (counts.appliedCount || counts.skippedCount
        ? formatWriteResult(counts.appliedCount, counts.skippedCount, locale)
        : ''),
      undo: input.undo,
      nextStep: input.nextStep || counts.translatedError?.nextStep || formatFallbackNextStep(input, counts.skippedCount, affectedFiles, locale)
    };
  }

  function formatWriteResult(appliedCount, skippedCount, locale = 'zh') {
    return textFor(
      locale,
      `已写入 ${appliedCount} 项，跳过 ${skippedCount} 项`,
      `wrote ${appliedCount} item${Number(appliedCount) === 1 ? '' : 's'}, skipped ${skippedCount} item${Number(skippedCount) === 1 ? '' : 's'}`
    );
  }

  function inferUnchangedReason(input, locale = 'zh') {
    if (input.mode === 'ask' || input.status === '只问不改') {
      return textFor(locale, '这轮是只问不改。', 'This run was Ask mode.');
    }
    if (input.status === 'rejected') {
      return textFor(locale, '你取消了这轮修改。', 'You cancelled this change.');
    }
    return '';
  }

  function formatFallbackNextStep(input, skippedCount, affectedFiles, locale = 'zh') {
    if (skippedCount) {
      return textFor(locale, '请查看本轮报告中的跳过项，处理后可以重试。', 'Review the skipped items in this report, then retry after resolving them.');
    }
    if (input.status === 'blocked' || input.status === 'failed') {
      return textFor(locale, '请处理上面的原因后重试。', 'Resolve the issue above, then retry.');
    }
    if (!affectedFiles.length) {
      return textFor(locale, '可以继续追问，或加入更多 @context 后再检查。', 'You can continue asking, or add more @context and run another check.');
    }
    return textFor(locale, '请在 Overleaf 中查看这些文件的留痕修改。', 'Review these tracked changes in Overleaf.');
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
      skippedChanges: normalizeStringList(report.skippedChanges),
      unchangedReason: cleanVisibleText(report.unchangedReason || ''),
      nextStep: cleanVisibleText(report.nextStep || '')
    };
  }

  function technicalOnly(event, locale = 'zh') {
    return {
      kind: 'technical',
      visible: false,
      title: textFor(locale, '技术详情', 'Technical details'),
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

  function summarizeCommandActivity(event, locale = 'zh') {
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
        title: formatCommandStartedTitle(commandKind, command, locale),
        status: 'running',
        detail: formatCommandPublicDetail(commandKind, command, locale),
        technicalDetail: normalizeRawEvent(event)
      };
    }

    return {
      kind: 'activity',
      visible: true,
      title: formatCommandCompletedTitle(commandKind, output, failed, locale),
      status: failed ? 'failed' : 'completed',
      detail: formatCommandPublicDetail(commandKind, command, locale),
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

  function formatCommandStartedTitle(kind, command, locale = 'zh') {
    if (kind === 'search') {
      const query = extractSearchQuery(command);
      return query ? textFor(locale, `正在搜索项目内容：${query}`, `Searching project content: ${query}`) : textFor(locale, '正在搜索项目内容。', 'Searching project content.');
    }
    if (kind === 'read') {
      return textFor(locale, '正在读取相关文件内容。', 'Reading related file content.');
    }
    if (kind === 'compile') {
      return textFor(locale, '正在运行 LaTeX 相关检查。', 'Running LaTeX-related checks.');
    }
    if (kind === 'list') {
      return textFor(locale, '正在查看项目文件结构。', 'Inspecting project file structure.');
    }
    return textFor(locale, '正在执行一次本地检查。', 'Running a local check.');
  }

  function formatCommandCompletedTitle(kind, output, failed, locale = 'zh') {
    if (failed) {
      if (kind === 'search') {
        return textFor(locale, '搜索没有正常完成。', 'Search did not finish normally.');
      }
      if (kind === 'compile') {
        return textFor(locale, 'LaTeX 检查没有正常完成。', 'LaTeX check did not finish normally.');
      }
      return textFor(locale, '本地检查没有正常完成。', 'Local check did not finish normally.');
    }

    if (kind === 'search') {
      const count = countMeaningfulLines(output);
      return count ? textFor(locale, `搜索完成，找到 ${count} 条相关线索。`, `Search complete: found ${count} relevant line(s).`) : textFor(locale, '搜索完成，没有找到明显相关线索。', 'Search complete: no clearly relevant lines found.');
    }
    if (kind === 'read') {
      return textFor(locale, '相关文件内容已读取。', 'Related file content has been read.');
    }
    if (kind === 'compile') {
      return textFor(locale, 'LaTeX 相关检查已完成。', 'LaTeX-related checks completed.');
    }
    if (kind === 'list') {
      return textFor(locale, '项目文件结构已查看。', 'Project file structure inspected.');
    }
    return textFor(locale, '本地检查已完成。', 'Local check completed.');
  }

  function formatCommandPublicDetail(kind, command, locale = 'zh') {
    if (kind !== 'search') {
      return undefined;
    }
    const query = extractSearchQuery(command);
    return query ? { [textFor(locale, '搜索目标', 'Search target')]: query } : undefined;
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

  function formatFilesInline(files = [], locale = 'zh') {
    const values = normalizeStringList(files);
    if (!values.length) {
      return textFor(locale, '没有文件', 'no files');
    }
    if (values.length <= 3) {
      return values.join(locale === 'en' ? ', ' : '、');
    }
    return textFor(
      locale,
      `${values.slice(0, 3).join('、')} 等 ${values.length} 个文件`,
      `${values.slice(0, 3).join(', ')} and ${values.length - 3} more`
    );
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

  function cleanStreamDeltaText(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u00a0/g, ' ');
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

  function addListSection(sections, label, values, locale = 'zh') {
    const items = normalizeStringList(values);
    if (!items.length) {
      return;
    }
    sections.push(`${label}${locale === 'en' ? ':' : '：'}\n${items.map(item => `- ${item}`).join('\n')}`);
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

  function collectSkippedOperations(applyResults) {
    const operations = [];
    for (const result of normalizeApplyResults(applyResults)) {
      for (const item of result.skipped || []) {
        if (item?.operation) {
          operations.push({
            operation: item.operation,
            result: item.result || {}
          });
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

  function formatOperationLine(operation, locale = 'zh') {
    const labels = OPERATION_LABELS[locale] || OPERATION_LABELS.zh;
    const label = labels[operation?.type] || operation?.type || textFor(locale, '处理', 'process');
    const filePath = operation?.path || operation?.from || operation?.to || textFor(locale, '未知文件', 'unknown file');
    const reason = formatOperationReason(operation, locale);
    return locale === 'en'
      ? (reason ? `${filePath}: ${label} (${reason})` : `${filePath}: ${label}`)
      : (reason ? `${filePath}：${label}（${reason}）` : `${filePath}：${label}`);
  }

  function formatOperationReason(operation, locale = 'zh') {
    const key = operation?.reasonKey || '';
    const count = Number(operation?.reasonParams?.count || 0);
    if (key === 'localWorkspaceDelete') {
      return textFor(locale, '本地 Codex workspace 删除了这个文件。', 'Local Codex workspace deleted this file.');
    }
    if (key === 'localWorkspacePatch') {
      return textFor(
        locale,
        `同步本地 Codex workspace 中的局部文件改动（${count || 0} 处）。`,
        `Synced ${count || 0} local Codex workspace edit${Number(count) === 1 ? '' : 's'}.`
      );
    }
    if (key === 'localWorkspaceContent') {
      return textFor(locale, '同步本地 Codex workspace 中的文件内容。', 'Synced file content from the local Codex workspace.');
    }
    if (key === 'localWorkspaceCreate') {
      return textFor(locale, '同步本地 Codex workspace 中的新文件。', 'Synced a new file from the local Codex workspace.');
    }
    return localizeVisibleReason(operation?.reason || '', locale);
  }

  function formatSkippedOperationLine(item, locale = 'zh') {
    const operation = item?.operation || {};
    const labels = OPERATION_LABELS[locale] || OPERATION_LABELS.zh;
    const label = labels[operation.type] || operation.type || textFor(locale, '处理', 'process');
    const filePath = operation.path || operation.from || operation.to || textFor(locale, '未知文件', 'unknown file');
    const result = item?.result || {};
    const reason = formatSkippedReason(result, operation, locale);
    return locale === 'en'
      ? `${filePath}: ${label} was not written (${reason})`
      : `${filePath}：${label}没有写入（${reason}）`;
  }

  function formatSkippedReason(result = {}, operation = {}, locale = 'zh') {
    const key = result.reasonKey || '';
    const code = result.code || '';
    const filePath = result.reasonParams?.filePath || operation?.path || operation?.from || operation?.to || '';
    if (key === 'missingBaseFile' || code === 'missing_base_file') {
      const target = filePath || textFor(locale, '这个文件', 'this file');
      return textFor(
        locale,
        `${target} 在任务开始时没有被 Codex 读到。Codex 没有覆盖它；请刷新项目内容后重试。`,
        `${target} was not read when the task started. Codex did not overwrite it; refresh the project content and retry.`
      );
    }
    if (key === 'staleSnapshot' || code === 'stale_snapshot') {
      const target = filePath || textFor(locale, '这个文件', 'this file');
      return textFor(
        locale,
        `${target} 在任务执行期间被你或协作者改过，Codex 没有覆盖它。请查看差异后重试。`,
        `${target} changed while Codex was working, so Codex did not overwrite it. Review the diff and retry.`
      );
    }
    if (key === 'stalePatchLocation') {
      return textFor(
        locale,
        'Codex 要修改的位置已经无法和当前 Overleaf 内容对齐，所以没有写入。请重新运行任务。',
        'The edit location no longer matches the current Overleaf content, so nothing was written. Rerun the task.'
      );
    }
    if (key === 'stalePatchConflict' || code === 'stale_patch_range') {
      return textFor(
        locale,
        'Codex 要修改的具体位置已经被你或协作者改过，所以没有覆盖它。请查看差异后重试。',
        'The exact edit location was changed by you or a collaborator, so Codex did not overwrite it. Review the diff and retry.'
      );
    }
    if (code === 'stale_patch') {
      return textFor(
        locale,
        '这处内容已经和 Codex 读取时不同，所以没有写入。请重新运行，让 Codex 先读取你的最新 Overleaf 内容。',
        'This exact text changed since Codex read it, so nothing was written. Rerun after Codex reads the latest Overleaf content.'
      );
    }
    if (code === 'invalid_patch') {
      return textFor(
        locale,
        'Codex 生成的局部写入范围无效，所以没有写入。',
        'Codex produced an invalid local edit range, so nothing was written.'
      );
    }
    if (code === 'write_verification_failed') {
      return textFor(
        locale,
        '写入后读回内容和 Codex 预期不一致，已停止把这次操作标记为成功。请刷新 Overleaf 后重试。',
        'After writing, the editor content did not match Codex\'s expected result, so the write was not marked successful. Reload Overleaf and retry.'
      );
    }
    if (code === 'file_tree_verification_failed') {
      return textFor(
        locale,
        'Overleaf 文件树操作没有被确认，Codex 已停止把这次操作标记为成功。',
        'Overleaf did not confirm the file-tree operation, so Codex did not mark it successful.'
      );
    }
    if (code === 'path_exists_in_snapshot') {
      const target = filePath || textFor(locale, '这个文件', 'this file');
      return textFor(
        locale,
        `${target} 在任务开始前已经存在。Codex 没有覆盖它；请改用修改文件或换一个文件名。`,
        `${target} already existed when the task started. Codex did not overwrite it; edit the file instead or choose another filename.`
      );
    }
    if (code === 'path_created_since_snapshot') {
      const target = filePath || textFor(locale, '这个文件', 'this file');
      return textFor(
        locale,
        `${target} 在任务执行期间被你或协作者新建了，Codex 没有覆盖它。请查看差异后重试。`,
        `${target} was created by you or a collaborator while Codex was working, so Codex did not overwrite it. Review the diff and retry.`
      );
    }
    return localizeVisibleReason(result.reason || result.error || result.code || textFor(locale, '未知原因', 'unknown reason'), locale);
  }

  function localizeVisibleReason(reason, locale = 'zh') {
    const text = cleanVisibleText(reason || '');
    if (!text || locale !== 'en') {
      return text;
    }
    let match = text.match(/^(.+?) 在任务开始时没有被 Codex 读到。Codex 没有覆盖它；请刷新项目内容后重试。$/);
    if (match) {
      return `${match[1]} was not read when the task started. Codex did not overwrite it; refresh the project content and retry.`;
    }
    match = text.match(/^(.+?) 在任务执行期间被你或协作者改过，Codex 没有覆盖它。请查看差异后重试。$/);
    if (match) {
      return `${match[1]} changed while Codex was working, so Codex did not overwrite it. Review the diff and retry.`;
    }
    if (text.includes('Codex 要修改的位置已经无法和当前 Overleaf 内容对齐')) {
      return 'The edit location no longer matches the current Overleaf content, so nothing was written. Rerun the task.';
    }
    if (text.includes('Codex 要修改的具体位置已经被你或协作者改过')) {
      return 'The exact edit location was changed by you or a collaborator, so Codex did not overwrite it. Review the diff and retry.';
    }
    const patchMatch = text.match(/^同步本地 Codex workspace 中的局部文件改动（(\d+) 处）。$/);
    if (patchMatch) {
      const count = Number(patchMatch[1]) || 0;
      return `Synced ${count} local Codex workspace edit${count === 1 ? '' : 's'}.`;
    }
    if (text === '本地 Codex workspace 删除了这个文件。') {
      return 'Local Codex workspace deleted this file.';
    }
    if (text === '同步本地 Codex workspace 中的文件内容。') {
      return 'Synced file content from the local Codex workspace.';
    }
    if (text === '同步本地 Codex workspace 中的新文件。') {
      return 'Synced a new file from the local Codex workspace.';
    }
    if (text.includes('Codex 在本地生成了这些文件，但插件没有同步回 Overleaf')) {
      return text
        .replace('Codex 在本地生成了这些文件，但插件没有同步回 Overleaf：', 'Codex generated these local files, but the extension did not sync them back to Overleaf:')
        .replace(/：LaTeX 构建产物，默认不写回。/g, ': LaTeX build artifact; not written back by default.')
        .replace(/：非文本文件，暂不支持自动写回。/g, ': Non-text file; automatic writeback is not supported yet.')
        .replace(/：当前类型暂不支持自动写回。/g, ': This file type is not supported for automatic writeback yet.');
    }
    return text;
  }

  return {
    buildHumanCompletionReport,
    formatHumanReport,
    mapAgentEventToActivity,
    translateRawError
  };
});
