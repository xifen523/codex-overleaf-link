(function initCodexOverleafModels(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafModels = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function modelsFactory() {
  'use strict';

  const FALLBACK_MODELS = Object.freeze([
    Object.freeze({ id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' }),
    Object.freeze({ id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' }),
    Object.freeze({ id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' }),
    Object.freeze({ id: 'gpt-5.5', label: 'GPT-5.5' }),
    Object.freeze({ id: 'gpt-5.4', label: 'GPT-5.4' }),
    Object.freeze({ id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini' }),
    Object.freeze({ id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' }),
    Object.freeze({ id: 'gpt-5.3-codex-spark', label: 'GPT-5.3 Codex Spark' }),
    Object.freeze({ id: 'gpt-5.2', label: 'GPT-5.2' })
  ]);

  function normalizeDiscoveredModels({ models, selectedModel } = {}) {
    const normalized = normalizeModelList(models);
    const usedFallback = normalized.length === 0;
    const resultModels = usedFallback ? cloneModels(FALLBACK_MODELS) : normalized;
    const selectedId = normalizeModelId(selectedModel);

    if (selectedId && !resultModels.some(model => model.id === selectedId)) {
      resultModels.push({
        id: selectedId,
        label: `${selectedId} (custom)`,
        unverified: true
      });
    }

    return {
      models: resultModels,
      usedFallback
    };
  }

  function normalizeModelList(models) {
    if (!Array.isArray(models)) {
      return [];
    }

    const seen = new Set();
    const result = [];

    for (const model of models) {
      const id = normalizeModelId(typeof model === 'string' ? model : model?.id);
      if (!id || seen.has(id)) {
        continue;
      }

      seen.add(id);
      result.push(normalizeModelEntry(model, id));
    }

    return result;
  }

  function normalizeModelEntry(model, id) {
    const label = typeof model?.label === 'string' && model.label.length > 0 ? model.label : id;
    const normalized = {
      id,
      label,
      reasoningEfforts: Array.isArray(model?.reasoningEfforts) ? model.reasoningEfforts.slice() : [],
      reasoningPresentation: typeof model?.reasoningPresentation === 'string' ? model.reasoningPresentation : '',
      speedTiers: normalizeSpeedTiers(model?.speedTiers)
    };

    if (Object.prototype.hasOwnProperty.call(Object(model), 'defaultReasoningEffort')) {
      normalized.defaultReasoningEffort = model.defaultReasoningEffort;
    }
    if (Object.prototype.hasOwnProperty.call(Object(model), 'defaultSpeedTier')) {
      normalized.defaultSpeedTier = model.defaultSpeedTier;
    }

    return normalized;
  }

  function normalizeSpeedTiers(speedTiers) {
    if (!Array.isArray(speedTiers)) {
      return ['standard'];
    }

    const result = [];
    for (const tier of speedTiers) {
      const normalized = normalizeModelId(tier);
      if (normalized && !result.includes(normalized)) {
        result.push(normalized);
      }
    }
    return result.includes('standard') ? result : ['standard', ...result];
  }

  function normalizeModelId(id) {
    return typeof id === 'string' ? id.trim() : '';
  }

  function cloneModels(models) {
    return models.map(model => ({ ...model }));
  }

  return {
    FALLBACK_MODELS,
    normalizeDiscoveredModels
  };
});
