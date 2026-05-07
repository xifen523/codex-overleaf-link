const assert = require('node:assert/strict');
const test = require('node:test');

const audit = require('../extension/src/shared/auditRecords');

const SECRET = 'sk-v0test_DO_NOT_LEAK_1234567890abcdef';
const PROJECT_TEXT = `PROJECT_TEXT_SHOULD_NOT_APPEAR ${SECRET}`;
const TASK_PROMPT = `TASK_PROMPT_SHOULD_NOT_APPEAR ${SECRET}`;
const COMPILE_LOG = `COMPILE_LOG_SHOULD_NOT_APPEAR ${SECRET}`;
const RAW_DIFF = `RAW_DIFF_SHOULD_NOT_APPEAR ${SECRET}`;
const COMMAND_OUTPUT = `COMMAND_OUTPUT_SHOULD_NOT_APPEAR ${SECRET}`;
const NATIVE_LOG_MESSAGE = `NATIVE_LOG_SHOULD_NOT_APPEAR ${SECRET}`;
const BINARY_CONTENT = `BINARY_CONTENT_SHOULD_NOT_APPEAR ${SECRET}`;
const NO_SECRET_PROMPT_BODY = 'PROMPT_BODY_SHOULD_NOT_PERSIST';
const NO_SECRET_COMMAND_OUTPUT = 'COMMAND_OUTPUT_SHOULD_NOT_PERSIST';
const NO_SECRET_COMPILE_LOG = 'COMPILE_LOG_SHOULD_NOT_PERSIST';
const NO_SECRET_RAW_DIFF = 'RAW_DIFF_SHOULD_NOT_PERSIST';
const NO_SECRET_PROJECT_TEXT = 'PROJECT_TEXT_SHOULD_NOT_PERSIST';
const NO_SECRET_MESSAGE = 'MESSAGE_BODY_SHOULD_NOT_PERSIST';
const SECRET_PATH = `sections/${SECRET}/main.tex`;
const GITHUB_PAT = `ghp_${'A'.repeat(36)}`;
const GITHUB_FINE_GRAINED_PAT = `github_pat_${'B'.repeat(36)}`;
const SLACK_TOKEN = `xoxb-${'C'.repeat(24)}`;
const AWS_ACCESS_KEY = `AKIA${'D'.repeat(16)}`;
const BEARER_TOKEN_VALUE = `${'e'.repeat(32)}.${'f'.repeat(16)}`;
const BEARER_TOKEN = `Bearer ${BEARER_TOKEN_VALUE}`;
const PRIVATE_KEY_BLOCK = [
  '-----BEGIN PRIVATE KEY-----',
  'MIIEvCOMMONSECRETKEYDATA',
  '-----END PRIVATE KEY-----'
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

test('buildAuditDraftRecord stores summaries without prompt bodies', () => {
  const record = audit.buildAuditDraftRecord({
    id: 'aud_1',
    projectId: 'proj',
    sessionId: 'ses',
    turnId: 'turn',
    task: 'Rewrite the full introduction with private context',
    prompt: 'FULL PROMPT secret body that must not be stored',
    focusFiles: ['main.tex'],
    selectedSkillIds: ['style'],
    sensitiveFindings: [{ detectorId: 'secret-assignment', source: 'task', preview: 'secret = [REDACTED]' }],
    createdAt: '2026-05-06T00:00:00.000Z'
  });

  assert.equal(record.id, 'aud_1');
  assert.equal(record.projectId, 'proj');
  assert.equal(record.resultStatus, 'draft');
  assert.equal(record.prompt, undefined);
  assert.equal(record.task, undefined);
  assert.match(record.promptSummary, /^\[prompt omitted; chars=\d+; hash=[a-f0-9]{8}\]$/);
  assert.equal(record.promptSummary.includes('Rewrite the full introduction'), false);
  assert.deepEqual(record.focusFiles, ['main.tex']);
  assert.deepEqual(record.selectedSkillIds, ['style']);
});

test('buildAuditFinalRecord stores file lists and diff counts only', () => {
  const final = audit.buildAuditFinalRecord({
    draft: audit.buildAuditDraftRecord({ id: 'aud_2', projectId: 'proj' }),
    completedAt: '2026-05-06T00:01:00.000Z',
    changedFiles: [{ path: 'main.tex', content: 'full body' }],
    appliedFiles: ['main.tex'],
    skippedFiles: [{ path: 'figures/raw.bin', reason: 'unsupported' }],
    blockedFiles: [{ path: 'locked.tex', reason: 'readonly', content: 'blocked body' }],
    diffSummary: { filesChanged: 2, additions: 5, deletions: 1 },
    resultStatus: 'blocked'
  });

  assert.equal(final.resultStatus, 'blocked');
  assert.deepEqual(final.changedFiles, [{ path: 'main.tex' }]);
  assert.deepEqual(final.appliedFiles, [{ path: 'main.tex' }]);
  assert.deepEqual(final.blockedFiles, [{ path: 'locked.tex', reason: 'readonly' }]);
  assert.deepEqual(final.diffSummary, { filesChanged: 2, additions: 5, deletions: 1 });
  assert.equal(JSON.stringify(final).includes('full body'), false);
});

test('audit records redact seeded secret fixtures from summaries and paths', () => {
  const draft = audit.buildAuditDraftRecord({
    id: 'aud_secret',
    projectId: 'proj',
    sessionId: 'ses',
    turnId: 'turn',
    task: TASK_PROMPT,
    focusFiles: [SECRET_PATH],
    sensitiveFindings: [{
      detectorId: 'fake-secret',
      path: SECRET_PATH,
      source: 'task',
      preview: TASK_PROMPT
    }],
    createdAt: '2026-05-06T00:00:00.000Z'
  });

  const final = audit.buildAuditFinalRecord({
    draft,
    changedFiles: [{ path: SECRET_PATH, content: PROJECT_TEXT }],
    blockedFiles: [{ path: SECRET_PATH, reason: `blocked ${SECRET}`, content: PROJECT_TEXT }],
    appliedFiles: [SECRET_PATH],
    skippedFiles: [{ path: SECRET_PATH, reason: `binary ${SECRET}`, content: BINARY_CONTENT }],
    diffSummary: { filesChanged: 1, additions: 1, deletions: 1, binaryFilesChanged: 1 }
  });

  assert.equal(JSON.stringify(final).includes(SECRET), false);
  assert.equal(JSON.stringify(final).includes(PROJECT_TEXT), false);
});

test('audit records redact common secret formats from draft summaries and metadata', () => {
  const draft = audit.buildAuditDraftRecord({
    id: 'aud_common_secrets',
    projectId: `project-${GITHUB_PAT}`,
    sessionId: `session-${SLACK_TOKEN}`,
    turnId: `turn-${AWS_ACCESS_KEY}`,
    task: `Rotate leaked credentials ${COMMON_SECRET_TEXT}`,
    focusFiles: [`sections/${GITHUB_PAT}/main.tex`],
    selectedSkillIds: [`skill-${GITHUB_FINE_GRAINED_PAT}`],
    sensitiveFindings: [{
      detectorId: 'api-token',
      path: `sections/${SLACK_TOKEN}/secrets.tex`,
      source: `prompt-${AWS_ACCESS_KEY}`,
      preview: COMMON_SECRET_TEXT
    }],
    createdAt: '2026-05-06T00:00:00.000Z'
  });

  const final = audit.buildAuditFinalRecord({
    draft,
    changedFiles: [{ path: `sections/${GITHUB_FINE_GRAINED_PAT}/main.tex`, content: COMMON_SECRET_TEXT }],
    blockedFiles: [{ path: `blocked/${AWS_ACCESS_KEY}.tex`, reason: `blocked ${BEARER_TOKEN}` }],
    appliedFiles: [`sections/${GITHUB_PAT}/main.tex`],
    skippedFiles: [{ path: `skipped/${SLACK_TOKEN}.tex`, reason: `password=${PASSWORD_VALUE}` }],
    saveVerification: {
      status: `failed ${GITHUB_PAT}`,
      errorCode: `token: ${TOKEN_VALUE}`,
      message: COMMON_SECRET_TEXT
    }
  });

  const serialized = JSON.stringify(final);
  assert.match(draft.promptSummary, /^\[prompt omitted; chars=\d+; hash=[a-f0-9]{8}\]$/);
  for (const forbidden of COMMON_SECRET_FORBIDDEN_VALUES) {
    assert.equal(serialized.includes(forbidden), false, `audit record leaked ${forbidden}`);
  }
});

test('audit records summarize no-secret saveVerification and object blobs without raw nested content', () => {
  const draft = audit.buildAuditDraftRecord({
    id: 'aud_no_secret_privacy',
    projectId: 'proj',
    sessionId: 'ses',
    turnId: 'turn',
    task: NO_SECRET_PROMPT_BODY,
    prompt: NO_SECRET_PROJECT_TEXT,
    saveVerification: {
      status: 'failed',
      stdout: NO_SECRET_COMMAND_OUTPUT,
      stderr: NO_SECRET_COMPILE_LOG,
      output: NO_SECRET_COMMAND_OUTPUT,
      commandOutput: NO_SECRET_COMMAND_OUTPUT,
      raw: NO_SECRET_RAW_DIFF,
      compileLog: NO_SECRET_COMPILE_LOG,
      diff: NO_SECRET_RAW_DIFF,
      content: NO_SECRET_PROJECT_TEXT,
      text: NO_SECRET_PROJECT_TEXT,
      body: NO_SECRET_PROMPT_BODY,
      message: NO_SECRET_MESSAGE,
      diagnostics: {
        status: 'failed',
        stdout: NO_SECRET_COMMAND_OUTPUT,
        message: NO_SECRET_MESSAGE
      }
    }
  });

  const final = audit.buildAuditFinalRecord({
    draft,
    changedFiles: [{
      path: 'main.tex',
      content: NO_SECRET_PROJECT_TEXT,
      diff: NO_SECRET_RAW_DIFF,
      message: NO_SECRET_MESSAGE
    }],
    diffSummary: { filesChanged: 1, additions: 2, deletions: 1 },
    saveVerification: {
      status: 'failed',
      ok: false,
      stdout: NO_SECRET_COMMAND_OUTPUT,
      stderr: NO_SECRET_COMPILE_LOG,
      output: NO_SECRET_COMMAND_OUTPUT,
      commandOutput: NO_SECRET_COMMAND_OUTPUT,
      raw: NO_SECRET_RAW_DIFF,
      compileLog: NO_SECRET_COMPILE_LOG,
      diff: NO_SECRET_RAW_DIFF,
      content: NO_SECRET_PROJECT_TEXT,
      text: NO_SECRET_PROJECT_TEXT,
      body: NO_SECRET_PROMPT_BODY,
      message: NO_SECRET_MESSAGE,
      diagnostics: {
        status: 'failed',
        errorCode: 'latex_failed',
        stdout: NO_SECRET_COMMAND_OUTPUT,
        stderr: NO_SECRET_COMPILE_LOG,
        message: NO_SECRET_MESSAGE
      }
    }
  });

  const diagnostic = audit.buildDiagnosticBundle({
    auditLogs: [final],
    run: {
      id: 'run_no_secret_privacy',
      status: 'failed',
      events: [{
        title: NO_SECRET_COMMAND_OUTPUT,
        status: 'failed',
        kind: 'stream',
        message: NO_SECRET_MESSAGE,
        text: NO_SECRET_PROJECT_TEXT
      }]
    },
    nativeEnvironment: {
      codex: {
        ok: false,
        stdout: NO_SECRET_COMMAND_OUTPUT,
        stderr: NO_SECRET_COMPILE_LOG,
        message: NO_SECRET_MESSAGE
      }
    }
  });

  for (const container of [draft, final, diagnostic]) {
    const serialized = JSON.stringify(container);
    for (const forbidden of [
      NO_SECRET_PROMPT_BODY,
      NO_SECRET_COMMAND_OUTPUT,
      NO_SECRET_COMPILE_LOG,
      NO_SECRET_RAW_DIFF,
      NO_SECRET_PROJECT_TEXT,
      NO_SECRET_MESSAGE
    ]) {
      assert.equal(serialized.includes(forbidden), false, `audit JSON leaked ${forbidden}`);
    }
  }

  assert.deepEqual(final.saveVerification.diagnostics, {
    status: 'failed',
    errorCode: 'latex_failed',
    errorCategory: 'error'
  });
  assert.equal(diagnostic.auditLogs[0].saveVerification.status, 'failed');
  assert.equal(diagnostic.auditLogs[0].saveVerification.errorCategory, 'error');
});

test('buildDiagnosticBundle redacts content-bearing metadata', () => {
  const bundle = audit.buildDiagnosticBundle({
    compatibility: { status: 'ok', native: { version: '0.8.0', environment: { codex: { ok: true } } } },
    mirror: { status: 'ready', files: [{ path: 'main.tex', content: 'body' }] },
    auditLogs: [{ id: 'aud', projectId: 'proj', promptSummary: 'short', fullDiff: 'diff body' }],
    run: { id: 'run', events: [{ title: 'Applied files', text: 'full event text', errorCode: 'none' }] },
    governance: { readonlyPatterns: ['locked/**'], writablePatterns: ['main.tex'], sensitiveCheckEnabled: true },
    platform: { os: 'darwin', arch: 'arm64', content: 'secret platform content' },
    nativeEnvironment: { codex: { ok: true, path: '/usr/bin/codex' }, compileLog: 'secret compile log' },
    projectId: 'project-secret-id'
  });

  const serialized = JSON.stringify(bundle);
  assert.equal(serialized.includes('body'), false);
  assert.equal(serialized.includes('project-secret-id'), false);
  assert.equal(bundle.projectIdHash.length > 0, true);
  assert.deepEqual(bundle.platform, { os: 'darwin', arch: 'arm64' });
  assert.deepEqual(bundle.nativeEnvironment, { codex: { ok: true, pathPresent: true } });
  assert.deepEqual(bundle.governance, {
    readonlyPatternCount: 1,
    writablePatternCount: 1,
    sensitiveCheckEnabled: true,
    sensitiveConfirmAllowed: false
  });
});

test('buildDiagnosticBundle redacts common secret formats from diagnostic summaries', () => {
  const bundle = audit.buildDiagnosticBundle({
    compatibility: {
      status: `failed ${GITHUB_PAT}`,
      extension: { version: `0.9.0-${SLACK_TOKEN}` },
      native: { status: `error ${AWS_ACCESS_KEY}`, version: `v ${GITHUB_FINE_GRAINED_PAT}` },
      modelDiscovery: { status: `failed ${BEARER_TOKEN}`, errorCode: `token: ${TOKEN_VALUE}` }
    },
    platform: {
      host: `native ${GITHUB_PAT}`,
      os: `darwin ${SLACK_TOKEN}`,
      arch: 'arm64',
      version: `password=${PASSWORD_VALUE}`
    },
    nativeEnvironment: {
      status: `bad ${AWS_ACCESS_KEY}`,
      codex: { ok: false, version: `v ${GITHUB_FINE_GRAINED_PAT}`, errorCode: `api_key=${API_KEY_VALUE}` },
      latex: { ok: false, missing: [`latexmk-${SLACK_TOKEN}`], errorCode: `auth ${BEARER_TOKEN}` }
    },
    mirror: {
      status: `ready ${GITHUB_PAT}`,
      rootStatus: `ok ${SLACK_TOKEN}`,
      errorCode: `password=${PASSWORD_VALUE}`,
      files: [{ path: `main-${AWS_ACCESS_KEY}.tex`, content: COMMON_SECRET_TEXT }]
    },
    auditLogs: [{
      id: `aud-${GITHUB_PAT}`,
      sessionId: `session-${SLACK_TOKEN}`,
      turnId: `turn-${AWS_ACCESS_KEY}`,
      promptSummary: COMMON_SECRET_TEXT,
      focusFiles: [`sections/${GITHUB_PAT}/main.tex`],
      changedFiles: [{ path: `sections/${GITHUB_FINE_GRAINED_PAT}/main.tex`, content: COMMON_SECRET_TEXT }],
      blockedFiles: [{ path: `blocked/${AWS_ACCESS_KEY}.tex`, reason: `blocked ${BEARER_TOKEN}` }],
      appliedFiles: [`sections/${GITHUB_PAT}/main.tex`],
      skippedFiles: [{ path: `skipped/${SLACK_TOKEN}.tex`, reason: `token: ${TOKEN_VALUE}` }],
      saveVerification: { status: `failed ${GITHUB_PAT}`, errorCode: `api_key=${API_KEY_VALUE}` }
    }],
    run: {
      id: `run-${GITHUB_FINE_GRAINED_PAT}`,
      status: `failed ${SLACK_TOKEN}`,
      errorCode: `auth ${BEARER_TOKEN}`,
      events: [{
        title: COMMON_SECRET_TEXT,
        status: `failed ${GITHUB_PAT}`,
        errorCode: `password=${PASSWORD_VALUE}`,
        kind: `stream-${AWS_ACCESS_KEY}`
      }]
    },
    governance: {
      readonlyPatterns: [`locked/${GITHUB_PAT}/**`],
      writablePatterns: [`sections/${SLACK_TOKEN}/main.tex`],
      sensitiveCheckEnabled: true
    },
    projectId: `project-${GITHUB_PAT}`
  });

  const serialized = JSON.stringify(bundle);
  for (const forbidden of COMMON_SECRET_FORBIDDEN_VALUES) {
    assert.equal(serialized.includes(forbidden), false, `diagnostic bundle leaked ${forbidden}`);
  }
});

test('buildDiagnosticBundle allowlists diagnostic summaries for seeded secret fixtures', () => {
  const bundle = audit.buildDiagnosticBundle({
    compatibility: {
      status: 'ok',
      extension: { version: '0.9.0', body: TASK_PROMPT },
      native: {
        status: 'ok',
        version: '0.9.0',
        protocolVersion: 1,
        environment: { message: NATIVE_LOG_MESSAGE }
      },
      modelDiscovery: {
        status: 'failed',
        errorCode: 'codex_models_failed',
        stdout: COMMAND_OUTPUT
      }
    },
    platform: {
      host: 'native',
      platform: 'darwin',
      arch: 'arm64',
      version: '0.9.0',
      message: NATIVE_LOG_MESSAGE
    },
    nativeEnvironment: {
      codex: {
        ok: true,
        version: '0.42.0',
        path: `/Users/example/${SECRET}/bin/codex`,
        stdout: COMMAND_OUTPUT,
        message: NATIVE_LOG_MESSAGE
      },
      latex: {
        ok: false,
        available: ['latexmk'],
        missing: ['pdflatex'],
        tools: {
          latexmk: `/Library/TeX/${SECRET}/latexmk`
        },
        compileLog: COMPILE_LOG
      },
      pathPreview: [`/Users/example/${SECRET}/bin`],
      logs: [NATIVE_LOG_MESSAGE]
    },
    mirror: {
      status: 'ready',
      rootStatus: 'ok',
      files: [
        { path: 'main.tex', content: PROJECT_TEXT, size: PROJECT_TEXT.length },
        { path: SECRET_PATH, content: BINARY_CONTENT, size: 2048, binary: true }
      ],
      skippedFiles: [{ path: SECRET_PATH, reason: `binary ${SECRET}`, content: BINARY_CONTENT }]
    },
    auditLogs: [{
      id: 'aud_secret',
      projectId: `project-${SECRET}`,
      sessionId: 'ses',
      turnId: 'turn',
      promptSummary: TASK_PROMPT,
      focusFiles: [SECRET_PATH],
      sensitiveFindings: [{ detectorId: 'fake-secret', path: SECRET_PATH, preview: PROJECT_TEXT }],
      changedFiles: [{ path: SECRET_PATH, content: PROJECT_TEXT, diff: RAW_DIFF, size: 2048 }],
      blockedFiles: [{ path: SECRET_PATH, reason: `blocked ${SECRET}`, content: PROJECT_TEXT }],
      appliedFiles: [SECRET_PATH],
      skippedFiles: [{ path: SECRET_PATH, reason: `binary ${SECRET}`, content: BINARY_CONTENT }],
      diffSummary: { filesChanged: 1, additions: 2, deletions: 1, binaryFilesChanged: 1 },
      saveVerification: {
        status: 'failed',
        message: COMMAND_OUTPUT,
        compileLog: COMPILE_LOG
      }
    }],
    run: {
      id: 'run_secret',
      status: 'failed',
      errorCode: 'codex_failed',
      events: [{
        title: `Native stderr: ${NATIVE_LOG_MESSAGE}`,
        status: 'failed',
        kind: 'stream',
        errorCode: 'native_stderr',
        detail: PROJECT_TEXT,
        text: COMMAND_OUTPUT
      }]
    },
    governance: {
      readonlyPatterns: [`locked/${SECRET}/**`],
      writablePatterns: [SECRET_PATH],
      sensitiveCheckEnabled: true
    },
    projectId: `project-${SECRET}`
  });

  const serialized = JSON.stringify(bundle);
  for (const forbidden of [
    SECRET,
    PROJECT_TEXT,
    TASK_PROMPT,
    COMPILE_LOG,
    RAW_DIFF,
    COMMAND_OUTPUT,
    NATIVE_LOG_MESSAGE,
    BINARY_CONTENT
  ]) {
    assert.equal(serialized.includes(forbidden), false, `diagnostic bundle leaked ${forbidden}`);
  }

  assert.deepEqual(Object.keys(bundle).sort(), [
    'auditLogs',
    'compatibility',
    'createdAt',
    'governance',
    'mirror',
    'nativeEnvironment',
    'platform',
    'projectIdHash',
    'run'
  ]);
  assert.equal(bundle.projectIdHash.length > 0, true);
  assert.equal(bundle.projectId, undefined);
  assert.equal(bundle.compatibility.extension.version, '0.9.0');
  assert.equal(bundle.nativeEnvironment.codex.ok, true);
  assert.equal(bundle.nativeEnvironment.codex.path, undefined);
  assert.equal(bundle.mirror.fileCount, 2);
  assert.equal(bundle.mirror.byteCount >= PROJECT_TEXT.length + 2048, true);
  assert.equal(bundle.auditLogs[0].projectId, undefined);
  assert.equal(bundle.auditLogs[0].promptSummary, undefined);
  assert.equal(bundle.auditLogs[0].promptPreview.redacted, true);
});
