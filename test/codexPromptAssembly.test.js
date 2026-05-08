const assert = require('node:assert/strict');
const test = require('node:test');

const {
  buildCodexTurnPrompt,
  validatePromptSize
} = require('../native-host/src/codexPromptAssembly');

test('buildCodexTurnPrompt separates system context from the user request', () => {
  const prompt = buildCodexTurnPrompt({
    task: 'Polish the introduction.',
    customInstructions: 'Prefer concise academic prose.',
    skills: [{ id: 'style', name: 'Style Guide', content: 'Avoid vague claims.' }],
    skillInvocation: { skillId: 'style', forced: true },
    attachments: [{ name: 'notes.txt', relativePath: '.codex-overleaf-attachments/notes.txt', size: 12, mimeType: 'text/plain' }],
    activePath: 'main.tex',
    contextFiles: ['sections/intro.tex'],
    compileContext: { enabled: true, logSummary: 'LaTeX Warning: Citation undefined.' },
    mode: 'confirm',
    session: {
      id: 'session-1',
      history: [{ task: 'Earlier task', result: 'Done' }]
    },
    projectKey: 'project-1',
    workspacePath: '/tmp/project-1'
  });

  assert.match(prompt.systemPrompt, /Session id: session-1/);
  assert.match(prompt.systemPrompt, /Prefer concise academic prose/);
  assert.match(prompt.systemPrompt, /## style: Style Guide/);
  assert.match(prompt.systemPrompt, /Avoid vague claims/);
  assert.match(prompt.systemPrompt, /\.codex-overleaf-attachments\/notes\.txt/);
  assert.match(prompt.systemPrompt, /main\.tex/);
  assert.match(prompt.systemPrompt, /sections\/intro\.tex/);
  assert.match(prompt.systemPrompt, /Citation undefined/);
  assert.equal(prompt.userPrompt, 'Current user request:\nPolish the introduction.');
});

test('validatePromptSize reports total prompt characters and native-message overflow', () => {
  const small = validatePromptSize('system', 'user');
  assert.deepEqual(small, {
    ok: true,
    totalChars: 10,
    exceedsLimit: false
  });

  const large = validatePromptSize('x'.repeat(1024 * 1024), 'y');
  assert.equal(large.ok, false);
  assert.equal(large.exceedsLimit, true);
  assert.equal(large.totalChars, 1024 * 1024 + 1);
});
