'use strict';

function buildCodexExecArgs({ cwd, schemaPath, outputPath, model, reasoningEffort }) {
  const args = [
    '--ask-for-approval',
    'never',
    'exec',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--cd',
    cwd,
    '--output-schema',
    schemaPath,
    '--output-last-message',
    outputPath,
    '--json'
  ];

  if (model) {
    args.push('-m', model);
  }

  if (reasoningEffort) {
    args.push('-c', `model_reasoning_effort="${reasoningEffort}"`);
  }

  args.push('-');
  return args;
}

module.exports = {
  buildCodexExecArgs
};
