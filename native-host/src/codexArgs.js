'use strict';

function buildCodexExecArgs({ cwd, schemaPath, outputPath, model, reasoningEffort, speedTier }) {
  const args = [
    ...buildCodexSpeedArgs(speedTier),
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

function buildCodexSpeedArgs(speedTier) {
  if (speedTier === 'fast') {
    return ['--enable', 'fast_mode', '-c', 'service_tier="fast"'];
  }
  return ['--disable', 'fast_mode'];
}

module.exports = {
  buildCodexExecArgs,
  buildCodexSpeedArgs
};
