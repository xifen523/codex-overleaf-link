'use strict';

const { FALLBACK_MODELS } = require('../../extension/src/shared/models');

const DEFAULT_REASONING_EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh']);

function resolveCodexModels(params = {}, env = process.env) {
  void params;
  void env;

  return {
    models: FALLBACK_MODELS.map(model => ({
      ...model,
      reasoningEfforts: DEFAULT_REASONING_EFFORTS.slice(),
      defaultReasoningEffort: 'medium'
    })),
    source: 'fallback',
    fetchedAt: new Date().toISOString()
  };
}

module.exports = {
  resolveCodexModels
};
