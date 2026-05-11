const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULT_PANEL_STATE,
  createSession,
  deleteSession,
  getActiveSession,
  isDisplayableSession,
  normalizePanelState,
  prepareStateForStorage,
  estimateJsonBytes,
  recordSessionResult,
  selectVisibleSessionsForList,
  setActiveSession,
  updateActiveSession
} = require('../extension/src/shared/sessionState');

const SECRET = ['sk', 'v0test_DO_NOT_LEAK_1234567890abcdef'].join('-');
const SECRET_PATH = `sections/${SECRET}/main.tex`;
const PROJECT_TEXT = `PROJECT_TEXT_SHOULD_NOT_PERSIST ${SECRET}`;
const TASK_PROMPT = `TASK_PROMPT_SHOULD_NOT_PERSIST ${SECRET}`;
const COMPILE_LOG = `COMPILE_LOG_SHOULD_NOT_PERSIST ${SECRET}`;
const COMMAND_OUTPUT = `COMMAND_OUTPUT_SHOULD_NOT_PERSIST ${SECRET}`;
const NO_SECRET_PROMPT_BODY = 'PROMPT_BODY_SHOULD_NOT_PERSIST';
const NO_SECRET_COMMAND_OUTPUT = 'COMMAND_OUTPUT_SHOULD_NOT_PERSIST';
const NO_SECRET_COMPILE_LOG = 'COMPILE_LOG_SHOULD_NOT_PERSIST';
const NO_SECRET_RAW_DIFF = 'RAW_DIFF_SHOULD_NOT_PERSIST';
const NO_SECRET_PROJECT_TEXT = 'PROJECT_TEXT_SHOULD_NOT_PERSIST';
const NO_SECRET_IMAGE_DATA_URL = 'data:image/png;base64,NO_SECRET_IMAGE_DATA_SHOULD_NOT_PERSIST';
const GITHUB_PAT = ['ghp', 'A'.repeat(36)].join('_');
const GITHUB_FINE_GRAINED_PAT = ['github', 'pat', 'B'.repeat(36)].join('_');
const SLACK_TOKEN = `xoxb-${'C'.repeat(24)}`;
const AWS_ACCESS_KEY = `AKIA${'D'.repeat(16)}`;
const BEARER_TOKEN_VALUE = `${'e'.repeat(32)}.${'f'.repeat(16)}`;
const BEARER_TOKEN = `Bearer ${BEARER_TOKEN_VALUE}`;
const PRIVATE_KEY_BLOCK = [
  '-----BEGIN ' + 'PRIVATE KEY-----',
  'MIIEvCOMMONSECRETKEYDATA',
  '-----END ' + 'PRIVATE KEY-----'
].join('\n');
const API_KEY_VALUE = 'api_key_common_secret_12345';
const TOKEN_VALUE = 'token_common_secret_12345';
const PASSWORD_VALUE = 'password_common_secret_12345';
const COMMON_SECRET_TEXT = [
  GITHUB_PAT,
  GITHUB_FINE_GRAINED_PAT,
  SLACK_TOKEN,
  AWS_ACCESS_KEY,
  BEARER_TOKEN,
  PRIVATE_KEY_BLOCK,
  `api_key=${API_KEY_VALUE}`,
  `token: ${TOKEN_VALUE}`,
  `password=${PASSWORD_VALUE}`
].join(' ');
const COMMON_SECRET_FORBIDDEN_VALUES = [
  GITHUB_PAT,
  GITHUB_FINE_GRAINED_PAT,
  SLACK_TOKEN,
  AWS_ACCESS_KEY,
  BEARER_TOKEN_VALUE,
  'MIIEvCOMMONSECRETKEYDATA',
  API_KEY_VALUE,
  TOKEN_VALUE,
  PASSWORD_VALUE
];

test('normalizes missing panel state with defaults and a session id', () => {
  const state = normalizePanelState({});

  assert.equal(state.mode, DEFAULT_PANEL_STATE.mode);
  assert.equal(state.model, DEFAULT_PANEL_STATE.model);
  assert.equal(state.reasoningEffort, DEFAULT_PANEL_STATE.reasoningEffort);
  assert.equal(state.speedTier, DEFAULT_PANEL_STATE.speedTier);
  assert.equal(state.locale, 'en');
  assert.equal(state.loadCodexLocalSkills, true);
  assert.equal(state.loadCodexOverleafSkills, true);
  assert.deepEqual(state.customInstructionsByProject, {});
  assert.match(state.session.id, /^session_/);
  assert.equal(state.sessions.length, 1);
  assert.equal(state.activeSessionId, state.session.id);
});

test('normalizes Codex skill loading toggles as global panel preferences', () => {
  const state = normalizePanelState({
    loadCodexLocalSkills: false,
    loadCodexOverleafSkills: false,
    activeSessionId: 'session_a',
    sessions: [
      { id: 'session_a', title: 'A', runs: [] },
      { id: 'session_b', title: 'B', runs: [] }
    ]
  });

  assert.equal(state.loadCodexLocalSkills, false);
  assert.equal(state.loadCodexOverleafSkills, false);

  const switched = setActiveSession(state, 'session_b');
  assert.equal(switched.loadCodexLocalSkills, false);
  assert.equal(switched.loadCodexOverleafSkills, false);

  const compact = prepareStateForStorage(switched);
  assert.equal(compact.loadCodexLocalSkills, false);
  assert.equal(compact.loadCodexOverleafSkills, false);
});

test('normalizes locale as a global panel preference across sessions', () => {
  const state = normalizePanelState({
    locale: 'zh',
    activeSessionId: 'session_a',
    sessions: [
      { id: 'session_a', title: 'A', runs: [] },
      { id: 'session_b', title: 'B', runs: [] }
    ]
  });

  assert.equal(state.locale, 'zh');

  const switched = setActiveSession(state, 'session_b');
  assert.equal(switched.locale, 'zh');

  const compact = prepareStateForStorage(switched);
  assert.equal(compact.locale, 'zh');
});

test('normalizes custom instructions as a project-level preference across sessions', () => {
  const state = normalizePanelState({
    customInstructionsByProject: {
      project_a: 'Use NeurIPS style. Prefer \\cref{}.',
      project_b: 42,
      '': 'ignored'
    },
    activeSessionId: 'session_a',
    sessions: [
      { id: 'session_a', title: 'A', runs: [] },
      { id: 'session_b', title: 'B', runs: [] }
    ]
  });

  assert.deepEqual(state.customInstructionsByProject, {
    project_a: 'Use NeurIPS style. Prefer \\cref{}.',
    project_b: ''
  });

  const switched = setActiveSession(state, 'session_b');
  assert.deepEqual(switched.customInstructionsByProject, state.customInstructionsByProject);

  const compact = prepareStateForStorage(switched);
  assert.deepEqual(compact.customInstructionsByProject, state.customInstructionsByProject);
});

test('length-limits custom instruction values during normalization and storage compaction', () => {
  const longInstructions = 'x'.repeat(13000);
  const state = normalizePanelState({
    customInstructionsByProject: {
      project_long: longInstructions
    }
  });

  assert.equal(state.customInstructionsByProject.project_long.length, 12000);
  assert.match(state.customInstructionsByProject.project_long, /…$/);

  const compact = prepareStateForStorage({
    ...state,
    customInstructionsByProject: {
      project_long: longInstructions
    }
  });
  assert.equal(compact.customInstructionsByProject.project_long.length, 12000);
  assert.match(compact.customInstructionsByProject.project_long, /…$/);
});

test('creates a fresh session with empty history', () => {
  const session = createSession();

  assert.match(session.id, /^session_/);
  assert.deepEqual(session.history, []);
  assert.deepEqual(session.runs, []);
  assert.deepEqual(session.focusFiles, []);
  assert.equal(session.title, '');
  assert.equal(session.titleSource, 'auto');
});

test('derives compact auto titles from the first task without context tokens', () => {
  const state = normalizePanelState({
    activeSessionId: 'session_a',
    sessions: [{
      id: 'session_a',
      title: '',
      titleSource: 'auto',
      task: '',
      runs: []
    }]
  });

  const updated = updateActiveSession(state, {
    title: '帮我检查一下语法问题并直接修复这篇论文中的明显错误 @context @file:paper.tex',
    titleSource: 'auto'
  });

  assert.equal(updated.sessions[0].title, '帮我检查一下语法问题并直接修复这篇论文中的明显…');
  assert.equal(updated.sessions[0].titleSource, 'auto');
});

test('manual session titles survive later task updates', () => {
  const state = normalizePanelState({
    activeSessionId: 'session_a',
    sessions: [{
      id: 'session_a',
      title: 'AAAI 摘要润色',
      titleSource: 'manual',
      task: 'old draft',
      runs: []
    }]
  });

  const updated = updateActiveSession(state, {
    task: '帮我检查语法问题并修正',
    title: '帮我检查语法问题并修正',
    titleSource: 'auto'
  });

  assert.equal(updated.sessions[0].title, 'AAAI 摘要润色');
  assert.equal(updated.sessions[0].titleSource, 'manual');
});

test('normalizes focus files as session scoped context', () => {
  const state = normalizePanelState({
    activeSessionId: 'session_a',
    sessions: [{
      id: 'session_a',
      title: 'A',
      focusFiles: ['main.tex', '', 'main.tex', 42, 'refs.bib']
    }]
  });

  assert.deepEqual(state.session.focusFiles, ['main.tex', 'refs.bib']);
  assert.deepEqual(state.sessions[0].focusFiles, ['main.tex', 'refs.bib']);

  const updated = updateActiveSession(state, { task: 'Check intro' });
  assert.deepEqual(updated.session.focusFiles, ['main.tex', 'refs.bib']);
  assert.deepEqual(updated.sessions[0].focusFiles, ['main.tex', 'refs.bib']);
});

test('does not display a blank default session as a task', () => {
  assert.equal(isDisplayableSession(createSession()), false);
  assert.equal(isDisplayableSession({
    id: 'session_draft',
    title: 'New task',
    task: 'draft prompt',
    runs: [],
    history: []
  }), true);
  assert.equal(isDisplayableSession({
    id: 'session_run',
    title: 'New task',
    task: '',
    runs: [{ id: 'run_1', task: 'done', status: 'completed' }],
    history: []
  }), true);
});

test('session list keeps an older active session visible alongside recent sessions', () => {
  const sessions = Array.from({ length: 5 }, (_, index) => ({
    id: `session_${index}`,
    title: `Task ${index}`,
    runs: [{ id: `run_${index}`, task: `task ${index}`, status: 'completed' }],
    history: []
  }));

  const visible = selectVisibleSessionsForList(sessions, 'session_0', { maxVisible: 3 });

  assert.deepEqual(visible.map(session => session.id), ['session_0', 'session_4', 'session_3']);
});

test('session list keeps a running pinned session visible alongside the active session', () => {
  const sessions = Array.from({ length: 5 }, (_, index) => ({
    id: `session_${index}`,
    title: `Task ${index}`,
    runs: [{ id: `run_${index}`, task: `task ${index}`, status: 'completed' }],
    history: []
  }));

  const visible = selectVisibleSessionsForList(sessions, 'session_0', {
    maxVisible: 3,
    pinnedSessionIds: ['session_1']
  });

  assert.deepEqual(visible.map(session => session.id), ['session_0', 'session_1', 'session_4']);
});

test('records bounded session history', () => {
  let session = createSession();
  for (let index = 0; index < 12; index += 1) {
    session = recordSessionResult(session, {
      task: `task ${index}`,
      result: `result ${index}`
    });
  }

  assert.equal(session.history.length, 10);
  assert.equal(session.history[0].task, 'task 2');
  assert.equal(session.history[9].task, 'task 11');
});

test('recordSessionResult preserves existing session runs and settings', () => {
  const session = createSession({
    title: 'Grammar pass',
    task: '帮我检查语法',
    mode: 'auto',
    model: 'gpt-5.4-mini',
    reasoningEffort: 'xhigh',
    requireReviewing: false,
    focusFiles: ['paper.tex'],
    codexThreadId: 'thread_123',
    runs: [{
      id: 'run_1',
      task: '帮我检查语法',
      status: 'completed',
      events: [{ title: '本轮完成报告', status: 'completed' }]
    }]
  });

  const updated = recordSessionResult(session, {
    task: '帮我检查语法',
    result: '已检查并总结'
  });

  assert.equal(updated.id, session.id);
  assert.equal(updated.title, 'Grammar pass');
  assert.equal(updated.task, '帮我检查语法');
  assert.equal(updated.mode, 'auto');
  assert.equal(updated.model, 'gpt-5.4-mini');
  assert.equal(updated.reasoningEffort, 'xhigh');
  assert.equal(updated.requireReviewing, false);
  assert.deepEqual(updated.focusFiles, ['paper.tex']);
  assert.equal(updated.codexThreadId, 'thread_123');
  assert.equal(updated.runs[0].id, 'run_1');
  assert.equal(updated.history.at(-1).result, '已检查并总结');
});

test('normalizes run attachment previews in memory and omits raw previews from compact storage', () => {
  const state = normalizePanelState({
    runs: [{
      id: 'run_attachments',
      task: '解读下图片',
      status: 'completed',
      attachments: [
        {
          name: 'image.png',
          mimeType: 'image/png',
          size: 1234,
          kind: 'image',
          previewDataUrl: 'data:image/png;base64,abc123',
          contentBase64: 'raw-file-content-must-not-persist'
        },
        {
          name: '../CV_CN.pdf',
          mimeType: 'application/pdf',
          size: 4567,
          kind: 'file',
          previewDataUrl: 'data:application/pdf;base64,drop'
        }
      ]
    }]
  });

  assert.deepEqual(state.runs[0].attachments, [
    {
      name: 'image.png',
      mimeType: 'image/png',
      size: 1234,
      kind: 'image',
      previewDataUrl: 'data:image/png;base64,abc123'
    },
    {
      name: 'CV_CN.pdf',
      mimeType: 'application/pdf',
      size: 4567,
      kind: 'file',
      previewDataUrl: ''
    }
  ]);

  const compact = prepareStateForStorage(state);
  assert.deepEqual(compact.sessions[0].runs[0].attachments, [
    {
      name: 'image.png',
      mimeType: 'image/png',
      size: 1234,
      kind: 'image'
    },
    {
      name: 'CV_CN.pdf',
      mimeType: 'application/pdf',
      size: 4567,
      kind: 'file'
    }
  ]);
  assert.equal(JSON.stringify(compact).includes('data:image/png;base64,abc123'), false);
  assert.equal(JSON.stringify(compact).includes('raw-file-content-must-not-persist'), false);
});

test('prepareStateForStorage redacts seeded secrets from persisted session state', () => {
  const state = normalizePanelState({
    task: TASK_PROMPT,
    focusFiles: [SECRET_PATH],
    customInstructionsByProject: {
      [`project-${SECRET}`]: `Prefer concise edits ${SECRET}`
    },
    sessions: [{
      id: 'session_secret',
      title: `Secret session ${SECRET}`,
      task: TASK_PROMPT,
      history: [{
        task: TASK_PROMPT,
        result: COMMAND_OUTPUT,
        at: '2026-05-06T00:00:00.000Z'
      }],
      focusFiles: [SECRET_PATH],
      runs: [{
        id: 'run_secret',
        task: TASK_PROMPT,
        status: 'completed',
        statusText: COMMAND_OUTPUT,
        events: [{
          title: `Compile failed ${SECRET}`,
          status: 'failed',
          kind: 'report',
          detail: {
            commandOutput: COMMAND_OUTPUT,
            compileLog: COMPILE_LOG,
            projectText: PROJECT_TEXT,
            path: SECRET_PATH
          },
          technicalDetail: {
            raw: COMMAND_OUTPUT
          }
        }],
        attachments: [{
          name: SECRET_PATH,
          mimeType: 'text/plain',
          size: 128,
          previewDataUrl: ''
        }],
        undoOperations: [{
          type: 'edit',
          path: SECRET_PATH,
          replaceAll: PROJECT_TEXT
        }],
        undoBaseFiles: [{ path: SECRET_PATH, content: PROJECT_TEXT }],
        undoExpectedFiles: [{ path: SECRET_PATH, content: PROJECT_TEXT }],
        undoTrackedChanges: [{ key: `tracked-${SECRET}`, path: SECRET_PATH, label: `Change ${SECRET}` }]
      }]
    }],
    activeSessionId: 'session_secret'
  });

  const compact = prepareStateForStorage(state);
  const serialized = JSON.stringify(compact);

  for (const forbidden of [
    SECRET,
    PROJECT_TEXT,
    TASK_PROMPT,
    COMPILE_LOG,
    COMMAND_OUTPUT,
    SECRET_PATH
  ]) {
    assert.equal(serialized.includes(forbidden), false, `persisted state leaked ${forbidden}`);
  }

  const run = compact.sessions[0].runs[0];
  assert.equal(run.undoOperations.length, 0);
  assert.equal(run.undoBaseFiles.length, 0);
  assert.equal(run.undoExpectedFiles.length, 0);
});

test('prepareStateForStorage redacts common secret formats from persisted session state', () => {
  const state = normalizePanelState({
    task: `Rotate leaked credentials ${COMMON_SECRET_TEXT}`,
    focusFiles: [`sections/${GITHUB_PAT}/main.tex`],
    customInstructionsByProject: {
      [`project-${GITHUB_FINE_GRAINED_PAT}`]: `Use replacement token: ${TOKEN_VALUE}`
    },
    sessions: [{
      id: 'session_common_secrets',
      title: `Secret rotation ${GITHUB_PAT}`,
      task: `Rotate leaked credentials ${COMMON_SECRET_TEXT}`,
      history: [{
        task: `History ${GITHUB_PAT}`,
        result: COMMON_SECRET_TEXT,
        at: '2026-05-06T00:00:00.000Z'
      }],
      focusFiles: [`sections/${SLACK_TOKEN}/main.tex`],
      runs: [{
        id: 'run_common_secrets',
        task: `Run ${COMMON_SECRET_TEXT}`,
        status: 'completed',
        statusText: `Failed with ${BEARER_TOKEN}`,
        events: [{
          title: `Event ${GITHUB_PAT}`,
          status: 'failed',
          kind: 'report',
          detail: {
            summary: COMMON_SECRET_TEXT,
            path: `sections/${AWS_ACCESS_KEY}/main.tex`
          },
          technicalDetail: {
            raw: COMMON_SECRET_TEXT
          }
        }],
        attachments: [{
          name: `attachment-${SLACK_TOKEN}.txt`,
          mimeType: 'text/plain',
          size: 128,
          previewDataUrl: ''
        }],
        undoOperations: [{
          type: 'edit',
          path: `sections/${GITHUB_PAT}/main.tex`,
          replaceAll: COMMON_SECRET_TEXT
        }],
        undoBaseFiles: [{ path: `sections/${GITHUB_PAT}/main.tex`, content: COMMON_SECRET_TEXT }],
        undoExpectedFiles: [{ path: `sections/${GITHUB_PAT}/main.tex`, content: COMMON_SECRET_TEXT }],
        undoTrackedChanges: [{ key: `tracked-${GITHUB_PAT}`, path: `sections/${SLACK_TOKEN}/main.tex`, label: `Change ${AWS_ACCESS_KEY}` }],
        undoStatus: `undo ${BEARER_TOKEN}`
      }]
    }],
    activeSessionId: 'session_common_secrets'
  });

  const compact = prepareStateForStorage(state);
  const serialized = JSON.stringify(compact);
  assert.match(compact.task, /^\[task omitted; chars=\d+; hash=[a-f0-9]{8}\]$/);
  for (const forbidden of COMMON_SECRET_FORBIDDEN_VALUES) {
    assert.equal(serialized.includes(forbidden), false, `persisted state leaked ${forbidden}`);
  }

  const run = compact.sessions[0].runs[0];
  assert.equal(run.undoOperations.length, 0);
  assert.equal(run.undoBaseFiles.length, 0);
  assert.equal(run.undoExpectedFiles.length, 0);
});

test('prepareStateForStorage summarizes no-secret prompt and body fields instead of persisting raw text', () => {
  const state = normalizePanelState({
    task: NO_SECRET_PROMPT_BODY,
    sessions: [{
      id: 'session_no_secret_privacy',
      title: 'No-secret privacy regression',
      task: NO_SECRET_PROMPT_BODY,
      history: [{
        task: NO_SECRET_PROMPT_BODY,
        result: NO_SECRET_COMMAND_OUTPUT,
        at: '2026-05-06T00:00:00.000Z'
      }],
      focusFiles: ['main.tex', 'sections/method.tex'],
      runs: [{
        id: 'run_no_secret_privacy',
        task: NO_SECRET_PROMPT_BODY,
        status: 'failed',
        statusText: NO_SECRET_COMMAND_OUTPUT,
        startedAt: '2026-05-06T00:00:00.000Z',
        finishedAt: '2026-05-06T00:01:00.000Z',
        events: [{
          title: NO_SECRET_COMMAND_OUTPUT,
          status: NO_SECRET_COMMAND_OUTPUT,
          kind: 'report',
          detail: {
            commandOutput: NO_SECRET_COMMAND_OUTPUT,
            compileLog: NO_SECRET_COMPILE_LOG,
            rawDiff: NO_SECRET_RAW_DIFF,
            projectText: NO_SECRET_PROJECT_TEXT,
            path: 'main.tex'
          }
        }],
        attachments: [{
          name: 'figure.png',
          mimeType: 'image/png',
          size: 256,
          kind: 'image',
          previewDataUrl: NO_SECRET_IMAGE_DATA_URL
        }]
      }]
    }],
    activeSessionId: 'session_no_secret_privacy'
  });

  const compact = prepareStateForStorage(state);
  const serialized = JSON.stringify(compact);

  for (const forbidden of [
    NO_SECRET_PROMPT_BODY,
    NO_SECRET_COMMAND_OUTPUT,
    NO_SECRET_COMPILE_LOG,
    NO_SECRET_RAW_DIFF,
    NO_SECRET_PROJECT_TEXT,
    NO_SECRET_IMAGE_DATA_URL
  ]) {
    assert.equal(serialized.includes(forbidden), false, `persisted state leaked ${forbidden}`);
  }

  const storedRun = compact.sessions[0].runs[0];
  assert.equal(compact.sessions[0].title, 'No-secret privacy regression');
  assert.deepEqual(compact.sessions[0].focusFiles, ['main.tex', 'sections/method.tex']);
  assert.equal(storedRun.status, 'failed');
  assert.equal(storedRun.startedAt, '2026-05-06T00:00:00.000Z');
  assert.equal(storedRun.finishedAt, '2026-05-06T00:01:00.000Z');
  assert.deepEqual(storedRun.attachments, [{
    name: 'figure.png',
    mimeType: 'image/png',
    size: 256,
    kind: 'image'
  }]);
});

test('normalizes previously corrupted history-only sessions into clickable runs', () => {
  const state = normalizePanelState({
    sessions: [{
      id: 'session_corrupted',
      title: 'Grammar pass',
      task: '',
      history: [{
        task: '帮我检查语法',
        result: '结论：发现 3 处语法问题。',
        at: '2026-05-02T17:51:00.134Z'
      }]
    }],
    activeSessionId: 'session_corrupted'
  });

  assert.equal(state.runs.length, 1);
  assert.equal(state.runs[0].id, 'recovered_session_corrupted_0');
  assert.equal(state.runs[0].task, '帮我检查语法');
  assert.equal(state.runs[0].status, 'completed');
  assert.equal(state.runs[0].events[0].kind, 'report');
  assert.deepEqual(state.runs[0].events[0].detail, {
    '结论': '结论：发现 3 处语法问题。'
  });
});

test('migrates legacy single-session state into a switchable session list', () => {
  const state = normalizePanelState({
    mode: 'confirm',
    model: 'gpt-5.5',
    reasoningEffort: 'xhigh',
    speedTier: 'fast',
    requireReviewing: false,
    task: 'legacy draft',
    session: { id: 'session_legacy', history: [{ task: 'old task', result: 'done' }] },
    runs: [{ id: 'run_legacy', task: 'old task', status: 'completed' }]
  });

  assert.equal(state.sessions.length, 1);
  assert.equal(state.activeSessionId, 'session_legacy');
  assert.equal(state.session.id, 'session_legacy');
  assert.equal(state.task, 'legacy draft');
  assert.equal(state.mode, 'confirm');
  assert.equal(state.model, 'gpt-5.5');
  assert.equal(state.reasoningEffort, 'xhigh');
  assert.equal(state.speedTier, 'fast');
  assert.equal(state.requireReviewing, false);
  assert.equal(state.runs[0].id, 'run_legacy');
  assert.equal(getActiveSession(state).runs[0].id, 'run_legacy');
});

test('switches active session and mirrors composer settings from that session', () => {
  const state = normalizePanelState({
    activeSessionId: 'session_b',
    sessions: [{
      id: 'session_a',
      title: 'A',
      task: 'draft a',
      mode: 'auto',
      model: 'gpt-5.4',
      reasoningEffort: 'high',
      speedTier: 'standard',
      runs: [{ id: 'run_a', task: 'task a', status: 'completed' }]
    }, {
      id: 'session_b',
      title: 'B',
      task: 'draft b',
      mode: 'confirm',
      model: 'gpt-5.5',
      reasoningEffort: 'xhigh',
      speedTier: 'fast',
      runs: [{ id: 'run_b', task: 'task b', status: 'completed' }]
    }]
  });

  assert.equal(state.session.id, 'session_b');
  assert.equal(state.task, 'draft b');
  assert.equal(state.mode, 'confirm');
  assert.equal(state.model, 'gpt-5.5');
  assert.equal(state.reasoningEffort, 'xhigh');
  assert.equal(state.speedTier, 'fast');
  assert.equal(state.runs[0].id, 'run_b');
});

test('updates active session without mutating inactive sessions', () => {
  const state = normalizePanelState({
    activeSessionId: 'session_b',
    sessions: [
      { id: 'session_a', title: 'A', task: 'draft a', runs: [] },
      { id: 'session_b', title: 'B', task: 'draft b', runs: [] }
    ]
  });

  const updated = updateActiveSession(state, {
    task: 'new draft',
    runs: [{ id: 'run_new', task: 'new draft', status: 'completed' }]
  });

  assert.equal(updated.sessions[0].task, 'draft a');
  assert.equal(updated.sessions[1].task, 'new draft');
  assert.equal(updated.task, 'new draft');
  assert.equal(updated.runs[0].id, 'run_new');
});

test('keeps in-memory running runs active while switching sessions', () => {
  const state = normalizePanelState({
    activeSessionId: 'session_a',
    sessions: [
      { id: 'session_a', title: 'A', runs: [] },
      { id: 'session_b', title: 'B', runs: [{ id: 'run_b', task: 'task b', status: 'running' }] }
    ]
  });

  const switched = setActiveSession(state, 'session_b');

  assert.equal(switched.session.id, 'session_b');
  assert.equal(switched.runs[0].status, 'running');
  assert.equal(switched.runs[0].events.length, 0);
});

test('deletes inactive sessions without changing the active session', () => {
  const state = normalizePanelState({
    activeSessionId: 'session_b',
    sessions: [
      { id: 'session_a', title: 'A', runs: [{ id: 'run_a', task: 'task a', status: 'completed' }] },
      { id: 'session_b', title: 'B', task: 'draft b', runs: [{ id: 'run_b', task: 'task b', status: 'completed' }] }
    ]
  });

  const updated = deleteSession(state, 'session_a');

  assert.deepEqual(updated.sessions.map(session => session.id), ['session_b']);
  assert.equal(updated.activeSessionId, 'session_b');
  assert.equal(updated.session.id, 'session_b');
  assert.equal(updated.task, 'draft b');
  assert.equal(updated.runs[0].id, 'run_b');
});

test('deletes active sessions and switches to the most recent remaining session', () => {
  const state = normalizePanelState({
    activeSessionId: 'session_b',
    sessions: [
      { id: 'session_a', title: 'A', updatedAt: '2026-05-01T10:00:00.000Z', runs: [] },
      { id: 'session_b', title: 'B', updatedAt: '2026-05-01T11:00:00.000Z', runs: [] },
      { id: 'session_c', title: 'C', updatedAt: '2026-05-01T12:00:00.000Z', task: 'draft c', runs: [] }
    ]
  });

  const updated = deleteSession(state, 'session_b');

  assert.deepEqual(updated.sessions.map(session => session.id), ['session_a', 'session_c']);
  assert.equal(updated.activeSessionId, 'session_c');
  assert.equal(updated.session.id, 'session_c');
  assert.equal(updated.task, 'draft c');
});

test('deleting the final session creates a fresh empty active session', () => {
  const state = normalizePanelState({
    activeSessionId: 'session_only',
    mode: 'confirm',
    model: 'gpt-5.5',
    reasoningEffort: 'xhigh',
    sessions: [
      { id: 'session_only', title: 'Only', task: 'draft', mode: 'confirm', model: 'gpt-5.5', reasoningEffort: 'xhigh', runs: [] }
    ]
  });

  const updated = deleteSession(state, 'session_only');

  assert.equal(updated.sessions.length, 1);
  assert.notEqual(updated.session.id, 'session_only');
  assert.equal(updated.session.id, updated.activeSessionId);
  assert.equal(updated.task, '');
  assert.deepEqual(updated.runs, []);
  assert.equal(updated.mode, 'confirm');
  assert.equal(updated.model, 'gpt-5.5');
  assert.equal(updated.reasoningEffort, 'xhigh');
});

test('normalizes bounded persisted run history for the panel', () => {
  const state = normalizePanelState({
    runs: Array.from({ length: 24 }, (_, index) => ({
      id: `run_${index}`,
      task: `task ${index}`,
      status: index % 2 ? 'completed' : 'running',
      events: [{ title: `event ${index}` }],
      undoOperations: index === 23 ? [{ type: 'edit', path: 'main.tex', replaceAll: 'before' }] : [],
      undoBaseFiles: index === 23 ? [{ path: 'main.tex', content: 'after' }] : []
    }))
  });

  assert.equal(state.runs.length, 20);
  assert.equal(state.runs[0].id, 'run_4');
  assert.equal(state.runs[19].id, 'run_23');
  assert.equal(state.runs[19].status, 'completed');
  assert.deepEqual(state.runs[19].undoOperations, [{ type: 'edit', path: 'main.tex', replaceAll: 'before' }]);
  assert.deepEqual(state.runs[19].undoBaseFiles, [{ path: 'main.tex', content: 'after' }]);
});

test('preserves stream metadata and enough processing history for completed runs', () => {
  const state = normalizePanelState({
    runs: [{
      id: 'run_stream_history',
      task: 'check references',
      status: 'completed',
      events: Array.from({ length: 120 }, (_, index) => index === 119
        ? {
          title: 'Final answer',
          status: 'completed',
          kind: 'stream',
          streamKey: 'agent:final',
          streamRole: 'assistant'
        }
        : {
          title: `process ${index}`,
          status: 'running',
          kind: 'activity'
        })
    }]
  });

  assert.equal(state.runs[0].events.length, 120);
  const final = state.runs[0].events.at(-1);
  assert.equal(final.kind, 'stream');
  assert.equal(final.streamKey, 'agent:final');
  assert.equal(final.streamRole, 'assistant');
});

test('marks restored persisted running runs as no longer tracked after reload', () => {
  const state = normalizePanelState({
    runs: [{
      id: 'run_active',
      task: 'still running before reload',
      status: 'running',
      statusText: 'Running',
      events: [{ title: 'Codex exec started', status: 'running' }]
    }]
  }, {
    restoreRunningRuns: true
  });

  assert.equal(state.runs[0].status, 'failed');
  assert.equal(state.runs[0].statusText, '页面刷新后已停止跟踪');
  assert.equal(state.runs[0].events[1].title, '页面刷新后已停止跟踪这轮任务');
});

test('prepares a compact persisted state without storing huge historical payloads', () => {
  const largeText = 'x'.repeat(20000);
  const undoText = 'u'.repeat(120000);
  const state = normalizePanelState({
    activeSessionId: 'session_heavy',
    sessions: [{
      id: 'session_heavy',
      title: 'Heavy',
      task: 'Inspect a large manuscript',
      runs: Array.from({ length: 12 }, (_, index) => ({
        id: `run_${index}`,
        task: `task ${index}`,
        status: 'completed',
        events: Array.from({ length: 20 }, (__, eventIndex) => ({
          title: `**reasoning ${eventIndex}** ${largeText}`,
          detail: { raw: largeText },
          technicalDetail: { raw: largeText },
          kind: eventIndex % 2 ? 'stream' : 'activity'
        })),
        undoOperations: [{ type: 'edit', path: 'main.tex', replaceAll: undoText }],
        undoBaseFiles: [
          { path: 'main.tex', content: undoText }
        ]
      }))
    }]
  });

  const compact = prepareStateForStorage(state);
  const activeStoredSession = compact.sessions.find(session => session.id === compact.activeSessionId);

  assert.ok(estimateJsonBytes(compact) < 4 * 1024 * 1024);
  assert.equal(compact.runs.length, 0);
  assert.equal(activeStoredSession.runs.length, 10);
  assert.equal(activeStoredSession.runs[0].events.length, 20);
  assert.equal(activeStoredSession.runs[0].events[0].technicalDetail, undefined);
  assert.ok(activeStoredSession.runs[0].events[0].title.length < 6100);
  assert.equal(activeStoredSession.runs[0].undoOperations.length, 0);
  assert.equal(activeStoredSession.runs.at(-1).undoOperations.length, 0);
});

test('storage compaction summarizes long final reports instead of persisting report bodies', () => {
  const reportBody = [
    '结论：我检查了全文。',
    '',
    '### 1) 数学和引用',
    '- [paper.tex:486](/Users/example/.codex-overleaf/projects/p/workspace/paper.tex:486)：`\\eqref{eq:cmdp_obj}` 当前标签不存在。',
    'x'.repeat(8000),
    'END_REPORT_MARKER'
  ].join('\n');
  const activityDetail = `${'y'.repeat(8000)}END_ACTIVITY_MARKER`;
  const state = normalizePanelState({
    sessions: [createSession({
      title: 'Long summary',
      runs: [{
        id: 'run_long_report',
        task: '检查证明',
        status: 'completed',
        events: [
          {
            title: '本地检查已完成',
            status: 'completed',
            kind: 'activity',
            detail: activityDetail
          },
          {
            title: '本轮完成报告',
            status: 'completed',
            kind: 'report',
            detail: reportBody
          }
        ]
      }]
    })]
  });

  const compact = prepareStateForStorage(state);
  const run = compact.sessions[0].runs[0];
  const activity = run.events.find(event => event.kind === 'activity');
  const report = run.events.find(event => event.kind === 'report');

  assert.match(report.detail, /^\[detail omitted; chars=\d+; hash=[a-f0-9]{8}\]$/);
  assert.match(activity.detail, /^\[detail omitted; chars=\d+; hash=[a-f0-9]{8}\]$/);
  assert.doesNotMatch(JSON.stringify(compact), /END_REPORT_MARKER/);
  assert.doesNotMatch(JSON.stringify(compact), /END_ACTIVITY_MARKER/);
  assert.doesNotMatch(JSON.stringify(compact), /\[paper\.tex:486\]\(/);
});

test('aggressive storage preparation preserves the active session essentials under a smaller cap', () => {
  const state = normalizePanelState({
    activeSessionId: 'session_active',
    sessions: Array.from({ length: 16 }, (_, index) => ({
      id: index === 1 ? 'session_active' : `session_${index}`,
      title: `Session ${index}`,
      task: `task ${index} ${'x'.repeat(10000)}`,
      runs: Array.from({ length: 8 }, (__, runIndex) => ({
        id: `run_${index}_${runIndex}`,
        task: `run ${runIndex}`,
        status: 'completed',
        events: Array.from({ length: 80 }, (___, eventIndex) => ({
          title: `event ${eventIndex} ${'y'.repeat(5000)}`,
          detail: { text: 'z'.repeat(5000) }
        }))
      }))
    }))
  });

  const compact = prepareStateForStorage(state, { aggressive: true });

  assert.ok(estimateJsonBytes(compact) < 768 * 1024);
  assert.equal(compact.activeSessionId, 'session_active');
  assert.equal(compact.sessions.some(session => session.id === 'session_active'), true);
  const activeStoredSession = compact.sessions.find(session => session.id === compact.activeSessionId);
  assert.equal(compact.runs.length, 0);
  assert.ok(activeStoredSession.runs.length <= 3);
  assert.ok(activeStoredSession.runs.every(run => run.events.length <= 20));
});

test('normalizeSession preserves codexThreadId', () => {
  const state = normalizePanelState({
    sessions: [{ id: 'sess1', codexThreadId: 'thread_abc', title: 'test' }],
    activeSessionId: 'sess1'
  });
  const session = state.sessions[0];
  assert.strictEqual(session.codexThreadId, 'thread_abc');
});

test('updateActiveSession can set codexThreadId', () => {
  let state = normalizePanelState({
    sessions: [{ id: 'sess1', title: 'test' }],
    activeSessionId: 'sess1'
  });
  state = updateActiveSession(state, { codexThreadId: 'thread_xyz' });
  assert.strictEqual(state.sessions[0].codexThreadId, 'thread_xyz');
  assert.strictEqual(state.session.codexThreadId, 'thread_xyz');
});

test('createSession defaults codexThreadId to empty string', () => {
  const session = createSession({});
  assert.strictEqual(session.codexThreadId, '');
});
