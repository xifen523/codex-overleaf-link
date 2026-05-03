(function initCodexOverleafI18n(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafI18n = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function i18nFactory() {
  'use strict';

  const DEFAULT_LOCALE = 'en';
  const VALID_LOCALES = new Set(['en', 'zh']);

  const MESSAGES = {
    en: {
      resizePanel: 'Drag to resize the Codex panel. Double click to reset.',
      codexActions: 'Codex actions',
      refreshProbe: 'Refresh current file status. This will not sync or modify files.',
      diagnosticsMenu: 'Diagnostics',
      diagnosticsHint: 'Use when Codex cannot run, write, or read files',
      diagnosticsNativeTitle: 'Check Local Connection',
      diagnosticsNativeSubtitle: 'Codex, Native Host, LaTeX tools',
      diagnosticsPageTitle: 'Check Overleaf Write Access',
      diagnosticsPageSubtitle: 'Current file, write access, track changes',
      diagnosticsSnapshotTitle: 'Check Project Read',
      diagnosticsSnapshotSubtitle: 'Full project, assets, read source',
      diagnosticsSnapshotLoading: 'Checking whether the extension can read the full Overleaf project.',
      diagnosticsSnapshotErrorSummary: 'Overleaf may still be loading, or the page API did not return project files yet.',
      diagnosticsNativeLoading: 'Checking whether local Codex, Native Host, and LaTeX tools are available.',
      diagnosticsNativeEmptySummary: 'The local service is connected, but it did not return Codex or LaTeX tool details.',
      diagnosticsPageLoading: 'Checking the current file, write access, and track changes.',
      diagnosticsLoading: 'Checking current state.',
      diagnosticsLoadingSummary: 'Reading diagnostics. This will not modify Overleaf files.',
      diagnosticsResult: 'Diagnostics',
      diagnosticsNoResult: 'No displayable diagnostic result was returned.',
      nextStepPrefix: 'Next: ',
      runInTerminal: 'Run in Terminal:',
      copyInstallCommand: 'Copy install command',
      copied: 'Copied',
      switchLanguage: 'Switch to Chinese',
      switchLanguageHint: 'Change panel language',
      close: 'Close',
      closeDiagnostics: 'Close diagnostics result',
      technicalDetails: 'Technical Details',
      newSession: 'New Session',
      tasks: 'Tasks',
      placeholder: 'Ask Codex anything. Type @ to add context',
      mode: 'Mode',
      writeMode: 'Write mode',
      modeAsk: 'Ask',
      modeAskTitle: 'Read and analyze only. Do not write to Overleaf.',
      modeConfirm: 'Suggest',
      modeConfirmTitle: 'Show a change plan first, then write after approval.',
      modeAuto: 'Auto',
      modeAutoTitle: 'Write directly after authorization. Deletes still require confirmation.',
      addContext: 'Add @ context',
      requireReviewing: 'Track',
      requireReviewingTitle: 'When enabled, Codex checks or switches Overleaf Reviewing/Track Changes before writing. Deletes still require confirmation.',
      autoCompile: 'Auto Compile',
      autoCompileTitle: 'After Codex writes, click Overleaf Recompile and record the compile result for this task. Ask mode will not trigger it.',
      send: 'Send',
      cancelRun: 'Cancel Current Task',
      contextTitle: '@ Context',
      refreshFileList: 'Refresh file list',
      contextStatus: 'Type @ to add context: @file, @compile-log, @current-section.',
      contextLoadingFiles: 'Reading available @files...',
      contextReadFailed: 'Could not read files: {message}',
      contextNoFiles: 'No usable text files were read from this Overleaf project.',
      contextSelectedFiles: 'Added {count} @file items. Future tasks will focus on them first.',
      contextDefaultWholeProject: 'Default is the whole project. Add @file; @compile-log and @current-section are available as context options.',
      contextResourceTitle: '{path} (non-text resource, shown only as project structure for now)',
      contextWholeProjectChip: 'Default: whole project',
      clearFiles: 'Clear all @file context',
      resource: 'Asset',
      viewAllSessions: 'View all ({count})',
      renameSession: 'Rename session',
      deleteSession: 'Delete session',
      deleteRunningSession: 'Task running. Cancel it before deleting.',
      newSessionFallback: 'New Session',
      emptyRunLabel: 'Start a Codex task',
      unknownMode: 'Unknown mode',
      askStatus: 'Ask',
      canRun: 'Ready',
      validatingEditor: 'Verify editor on write',
      needsReviewing: 'Needs Reviewing',
      needsReviewingAndFile: 'Needs Reviewing and an open file',
      wholeProjectContext: 'will read the whole project',
      currentFileContext: 'read the current file',
      fileContext: 'has selected @file context',
      contextContext: 'has selected @context',
      refreshProbeLoading: 'Refreshing current file, write access, and track changes...',
      refreshProbeDone: 'Refreshed: {status}',
      refreshProbeFailed: 'Refresh failed. Reload Overleaf and try again.',
      processedFailed: 'Failed {elapsed}',
      processing: 'Running {elapsed}',
      processed: 'Done {elapsed}'
    },
    zh: {
      resizePanel: '拖动调整 Codex 面板宽度，双击恢复默认宽度',
      codexActions: 'Codex 操作',
      refreshProbe: '重新检测当前文件状态；不会同步或修改文件',
      diagnosticsMenu: '排查问题',
      diagnosticsHint: '遇到无法运行、无法写入、读不到文件时使用',
      diagnosticsNativeTitle: '检查本机连接',
      diagnosticsNativeSubtitle: 'Codex、Native Host、LaTeX 工具',
      diagnosticsPageTitle: '检查 Overleaf 写入',
      diagnosticsPageSubtitle: '当前文件、写入能力、留痕状态',
      diagnosticsSnapshotTitle: '检查项目读取',
      diagnosticsSnapshotSubtitle: '完整项目、资源文件、读取来源',
      diagnosticsSnapshotLoading: '确认插件能否读取完整 Overleaf 项目。',
      diagnosticsSnapshotErrorSummary: '这通常是 Overleaf 页面还没加载完成，或者当前页面接口暂时没有返回项目文件。',
      diagnosticsNativeLoading: '确认本机 Codex、Native Host 和 LaTeX 工具是否可用。',
      diagnosticsNativeEmptySummary: '本机服务已经连接，但没有返回 Codex 或 LaTeX 的工具详情。',
      diagnosticsPageLoading: '确认当前文件、写入能力和留痕状态。',
      diagnosticsLoading: '正在检查当前状态。',
      diagnosticsLoadingSummary: '正在读取信息，不会修改 Overleaf 文件。',
      diagnosticsResult: '诊断结果',
      diagnosticsNoResult: '没有返回可展示的诊断结果。',
      nextStepPrefix: '下一步：',
      runInTerminal: '在终端运行：',
      copyInstallCommand: '复制安装命令',
      copied: '已复制',
      switchLanguage: '切换为英文',
      switchLanguageHint: '切换面板语言',
      close: '关闭',
      closeDiagnostics: '关闭诊断结果',
      technicalDetails: '技术细节',
      newSession: '新建会话',
      tasks: '任务',
      placeholder: '问 Codex 任何事。输入 @ 添加上下文',
      mode: '模式',
      writeMode: '写入模式',
      modeAsk: '只问不改',
      modeAskTitle: '只读取和分析，不写入 Overleaf',
      modeConfirm: '建议修改',
      modeConfirmTitle: '先给出修改方案，确认后写入',
      modeAuto: '自动写入',
      modeAutoTitle: '授权后直接写入，删除仍需确认',
      addContext: '添加 @ 上下文',
      requireReviewing: '留痕',
      requireReviewingTitle: '开启后，写入前会确认并尝试切到 Overleaf Reviewing/Track Changes；删除仍需确认。',
      autoCompile: '自动编译',
      autoCompileTitle: 'Codex 写入后自动点击 Overleaf Recompile，并把编译结果记录到本轮任务。只问不改时不会触发。',
      send: '发送',
      cancelRun: '中断当前任务',
      contextTitle: '@ 上下文',
      refreshFileList: '刷新文件列表',
      contextStatus: '输入 @ 添加上下文：@文件、@compile-log、@current-section。',
      contextLoadingFiles: '正在读取可添加的 @文件...',
      contextReadFailed: '读取文件失败：{message}',
      contextNoFiles: '没有从当前 Overleaf 项目读取到可用文本文件。',
      contextSelectedFiles: '已添加 {count} 个 @file；后续任务会优先围绕它们。',
      contextDefaultWholeProject: '默认使用整个项目。可添加 @file；@compile-log 和 @current-section 将作为后续上下文能力。',
      contextResourceTitle: '{path}（非文本资源，当前只作为项目结构显示）',
      contextWholeProjectChip: '默认：整个项目',
      clearFiles: '清除全部 @file',
      resource: '资源',
      viewAllSessions: '查看全部（{count} 个）',
      renameSession: '重命名会话',
      deleteSession: '删除会话',
      deleteRunningSession: '任务运行中，先中断后再删除',
      newSessionFallback: '新会话',
      emptyRunLabel: '开始一个 Codex 任务',
      unknownMode: '未知模式',
      askStatus: '只问不改',
      canRun: '可以运行',
      validatingEditor: '写入时验证编辑器',
      needsReviewing: '需要开启 Reviewing',
      needsReviewingAndFile: '需要开启 Reviewing 并打开文件',
      wholeProjectContext: '将读取整个项目',
      currentFileContext: '已读到当前文件',
      fileContext: '已选择 @file 上下文',
      contextContext: '已选择 @context',
      refreshProbeLoading: '正在重新检测当前文件、写入权限和留痕状态...',
      refreshProbeDone: '已重新检测：{status}',
      refreshProbeFailed: '检测失败：请刷新 Overleaf 页面后重试',
      processedFailed: '处理失败 {elapsed}',
      processing: '处理中 {elapsed}',
      processed: '已处理 {elapsed}'
    }
  };

  function normalizeLocale(value) {
    return VALID_LOCALES.has(value) ? value : DEFAULT_LOCALE;
  }

  function getOppositeLocale(value) {
    return normalizeLocale(value) === 'zh' ? 'en' : 'zh';
  }

  function t(locale, key, params) {
    const normalized = normalizeLocale(locale);
    const dict = MESSAGES[normalized] || MESSAGES[DEFAULT_LOCALE];
    let text = dict[key] || MESSAGES[DEFAULT_LOCALE][key] || key;
    if (params && typeof params === 'object') {
      for (const name of Object.keys(params)) {
        text = text.replace(new RegExp(`\\{${escapeRegExp(name)}\\}`, 'g'), String(params[name]));
      }
    }
    return text;
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  return {
    DEFAULT_LOCALE,
    MESSAGES,
    normalizeLocale,
    getOppositeLocale,
    t
  };
});
