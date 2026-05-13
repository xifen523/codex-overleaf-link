'use strict';

function buildCodexPrompt(request) {
  const project = request.project || {};
  const files = Array.isArray(project.files) ? project.files : [];
  const focusFiles = normalizeFocusFiles(request.focusFiles || request.session?.focusFiles);
  const activePath = normalizeProjectPath(project.activePath);
  const orderedFiles = orderFilesByFocus(files, focusFiles);
  const inventory = orderedFiles.map(file => `- ${file.path} (${String(file.content || '').length} chars)`).join('\n') || '- no files supplied';

  return [
    'You are generating edit operations for an Overleaf project.',
    '',
    `Mode: ${request.mode}`,
    `Model: ${request.model || 'default'}`,
    `Reasoning effort: ${request.reasoningEffort || 'default'}`,
    `Session: ${request.session?.id || 'none'}`,
    `Task: ${request.task}`,
    `Active file: ${activePath || 'unknown'}`,
    '',
    'Recent session history:',
    formatSessionHistory(request.session?.history),
    '',
    'Focus files:',
    formatFocusFiles(focusFiles, files),
    '',
    'Project location citation rules:',
    formatProjectLocationCitationRules(),
    '',
    'Focused project file inventory:',
    formatFocusedProjectFileInventory([activePath, ...focusFiles]),
    '',
    'Files:',
    inventory,
    '',
    'Return JSON only. Do not include Markdown fences.',
    'Set status to "completed", "requires_task_confirmation", or "delete_plan_required".',
    'Return userReport as natural user-facing language for the Overleaf panel.',
    'Never put raw JSON, schema, stdout, stderr, or implementation details in userReport.',
    'Always include notes as one concise user-facing sentence summarizing what changed or what was checked. For analysis-only or check-only tasks, set operations to [] and put concise findings in notes.',
    'During the run, write short user-facing progress messages that say what you are checking, what you found, and what you will do next. Do not expose hidden chain-of-thought.',
    'For Ask Mode, do not propose or return write operations. Return operations as [] and use notes for findings, explanations, and suggested next steps.',
    'For userReport, include conclusion, checked files, findings, planned changes, applied changes, unchanged reason, and next step.',
    'The schema is strict: every operation must include type, path, to, find, replace, replaceAll, content, and reason; use null for unused fields.',
    'Use only these operation types:',
    '- edit: { "type": "edit", "path": "...", "find": "...", "replace": "..." }',
    '- edit replace all: { "type": "edit", "path": "...", "replaceAll": "..." }',
    '- create: { "type": "create", "path": "...", "content": "..." }',
    '- rename: { "type": "rename", "path": "...", "to": "..." }',
    '- move: { "type": "move", "path": "...", "to": "..." }',
    '- delete: { "type": "delete", "path": "...", "reason": "..." }',
    '',
    'Do not invent files that are not needed. Prefer minimal find/replace edits over replaceAll.',
    'When focus files are provided, treat them as the primary context for reasoning and edits. Use other project files only when the task requires cross-file consistency, references, imports, or compilation context.',
    'For Ask Mode, focus files still guide analysis, but never write.',
    'For Confirm Mode, operations may include deletes because the user confirms the whole task summary before application.',
    'For Auto Mode, deletes will be paused and confirmed separately by the bridge.',
    '',
    'Project file contents:',
    ...orderedFiles.map(file => [
      `--- FILE: ${file.path} ---`,
      String(file.content || ''),
      `--- END FILE: ${file.path} ---`
    ].join('\n'))
  ].join('\n');
}

function normalizeFocusFiles(value) {
  const seen = new Set();
  const files = [];
  for (const item of Array.isArray(value) ? value : []) {
    const path = normalizeProjectPath(item);
    if (!path || seen.has(path)) {
      continue;
    }
    seen.add(path);
    files.push(path);
  }
  return files.slice(0, 5);
}

function normalizeProjectPath(value) {
  const path = String(value || '')
    .replace(/^@file:/i, '')
    .replace(/\\/g, '/')
    .trim();
  if (!path || /^file:\/\//i.test(path) || /^[A-Za-z]:\//.test(path)) {
    return '';
  }
  const projectPath = path.replace(/^\/+/, '');
  const wasAbsolutePath = path.startsWith('/');
  if (wasAbsolutePath && /^(Users|home|tmp|var|private|Volumes)\//i.test(projectPath)) {
    return '';
  }
  if (/(^|\/)\.codex-overleaf\/projects(\/|$)/.test(projectPath)) {
    return '';
  }
  return projectPath;
}

function formatProjectLocationCitationRules() {
  return [
    '- In any user-visible output, cite project locations using only Overleaf project-relative paths from the project file inventory below.',
    '- Use path:LINE[:COLUMN] (for example, path/to/file.tex:12:3).',
    '- Do not cite local absolute paths, temporary workspace paths, file:// URLs, or markdown links to local files.',
    '- If a line number is uncertain, cite only the project-relative file path.'
  ].join('\n');
}

function formatFocusedProjectFileInventory(files) {
  const focusFiles = normalizeFocusFiles(files);
  if (!focusFiles.length) {
    return '- none selected.';
  }
  return focusFiles.map(filePath => `- ${filePath}`).join('\n');
}

function formatFocusFiles(focusFiles, files) {
  if (!focusFiles.length) {
    return '- none (default to whole project)';
  }

  const fileByPath = new Map(files.map(file => [file.path, file]));
  return focusFiles.map(path => {
    const file = fileByPath.get(path);
    if (!file) {
      return `- ${path} (primary context, not present in current snapshot)`;
    }
    return `- ${path} (primary context, ${String(file.content || '').length} chars)`;
  }).join('\n');
}

function orderFilesByFocus(files, focusFiles) {
  const focusSet = new Set(focusFiles);
  return [...files].sort((left, right) => {
    const leftFocus = focusSet.has(left.path);
    const rightFocus = focusSet.has(right.path);
    if (leftFocus !== rightFocus) {
      return leftFocus ? -1 : 1;
    }
    return String(left.path || '').localeCompare(String(right.path || ''));
  });
}

function formatSessionHistory(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return '- none';
  }

  return history.slice(-8).map((item, index) => {
    const task = item.task || 'untitled task';
    const result = item.result || item.status || 'no result recorded';
    return `${index + 1}. ${task}: ${result}`;
  }).join('\n');
}

function buildOutputSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'operations', 'notes', 'userReport'],
    properties: {
      status: {
        type: 'string',
        enum: ['requires_task_confirmation', 'completed', 'delete_plan_required']
      },
      notes: {
        type: 'string'
      },
      userReport: {
        type: 'object',
        additionalProperties: false,
        required: [
          'conclusion',
          'checked',
          'findings',
          'plannedChanges',
          'appliedChanges',
          'unchangedReason',
          'nextStep'
        ],
        properties: {
          conclusion: { type: 'string' },
          checked: {
            type: 'array',
            items: { type: 'string' }
          },
          findings: {
            type: 'array',
            items: { type: 'string' }
          },
          plannedChanges: {
            type: 'array',
            items: { type: 'string' }
          },
          appliedChanges: {
            type: 'array',
            items: { type: 'string' }
          },
          unchangedReason: { type: 'string' },
          nextStep: { type: 'string' }
        }
      },
      operations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'path', 'to', 'find', 'replace', 'replaceAll', 'content', 'reason'],
          properties: {
            type: {
              type: 'string',
              enum: ['edit', 'create', 'rename', 'move', 'delete']
            },
            path: { type: 'string' },
            to: { type: ['string', 'null'] },
            find: { type: ['string', 'null'] },
            replace: { type: ['string', 'null'] },
            replaceAll: { type: ['string', 'null'] },
            content: { type: ['string', 'null'] },
            reason: { type: ['string', 'null'] }
          }
        }
      }
    }
  };
}

module.exports = {
  buildCodexPrompt,
  buildOutputSchema
};
