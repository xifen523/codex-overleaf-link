(function initCodexOverleafProviderProfiles(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafProviderProfiles = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function providerProfilesFactory() {
  'use strict';

  const BUILTIN_PROVIDER_ID = 'builtin';

  function normalizeCatalog(value = {}) {
    const providers = Array.isArray(value.providers)
      ? value.providers.map(normalizeProvider).filter(Boolean)
      : [];
    if (!providers.some(provider => provider.id === BUILTIN_PROVIDER_ID)) {
      providers.unshift(buildBuiltinProvider());
    }
    const requestedActiveId = normalizeText(value.activeProviderId);
    const activeProviderId = providers.some(provider => provider.id === requestedActiveId)
      ? requestedActiveId
      : BUILTIN_PROVIDER_ID;
    return {
      activeProviderId,
      providers,
      storeRevision: normalizeInteger(value.storeRevision)
    };
  }

  function normalizeProvider(value) {
    if (!value || typeof value !== 'object') {
      return null;
    }
    const id = normalizeText(value.id);
    if (!id) {
      return null;
    }
    if (id === BUILTIN_PROVIDER_ID || value.kind === 'builtin') {
      return buildBuiltinProvider();
    }
    const models = normalizeModels(value.models);
    const defaultModelId = normalizeText(value.defaultModelId) || models[0]?.id || '';
    return {
      id,
      kind: 'custom',
      revision: normalizeInteger(value.revision),
      name: normalizeText(value.name) || 'Custom provider',
      baseUrl: normalizeText(value.baseUrl),
      wireApiPreference: normalizeWireApi(value.wireApiPreference, true),
      resolvedWireApi: normalizeWireApi(value.resolvedWireApi, false),
      models,
      defaultModelId,
      requestTimeoutMs: normalizeInteger(value.requestTimeoutMs) || 30000,
      reasoningAdapter: normalizeReasoningAdapter(value.reasoningAdapter),
      reasoningCapability: normalizeReasoningCapability(value.reasoningCapability),
      hasSecret: value.hasSecret === true,
      secretUpdatedAt: normalizeInteger(value.secretUpdatedAt),
      endpointDisclosureHost: normalizeText(value.endpointDisclosureHost),
      endpointDisclosureAcceptedAt: normalizeInteger(value.endpointDisclosureAcceptedAt),
      lastVerified: value.lastVerified && typeof value.lastVerified === 'object'
        ? {
            revision: normalizeInteger(value.lastVerified.revision),
            at: normalizeInteger(value.lastVerified.at),
            modelId: normalizeText(value.lastVerified.modelId),
            wireApi: normalizeWireApi(value.lastVerified.wireApi, false)
          }
        : null,
      createdAt: normalizeInteger(value.createdAt),
      updatedAt: normalizeInteger(value.updatedAt)
    };
  }

  function normalizeModels(models) {
    if (!Array.isArray(models)) {
      return [];
    }
    const seen = new Set();
    const result = [];
    for (const value of models) {
      const id = normalizeText(typeof value === 'string' ? value : value?.id);
      if (!id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      result.push({
        id,
        label: normalizeText(value?.label) || id,
        reasoningEfforts: Array.isArray(value?.reasoningEfforts)
          ? value.reasoningEfforts.map(normalizeText).filter(Boolean)
          : []
      });
    }
    return result;
  }

  function buildBuiltinProvider() {
    return {
      id: BUILTIN_PROVIDER_ID,
      kind: 'builtin',
      revision: 0,
      name: 'Built-in Codex',
      editable: false,
      deletable: false,
      models: []
    };
  }

  function buildEmptyDraft() {
    return {
      id: '',
      kind: 'custom',
      revision: 0,
      name: 'Custom provider',
      baseUrl: '',
      wireApiPreference: 'auto',
      resolvedWireApi: '',
      models: [],
      defaultModelId: '',
      requestTimeoutMs: 30000,
      reasoningAdapter: 'auto',
      reasoningCapability: 'auto',
      hasSecret: false,
      secretUpdatedAt: 0,
      endpointDisclosureHost: '',
      lastVerified: null
    };
  }

  function getActiveProvider(catalog = {}) {
    const normalized = normalizeCatalog(catalog);
    return normalized.providers.find(provider => provider.id === normalized.activeProviderId)
      || buildBuiltinProvider();
  }

  function buildRunSelection(catalog = {}) {
    const active = getActiveProvider(catalog);
    return {
      providerId: active.id,
      providerRevision: active.revision || 0
    };
  }

  function normalizeWireApi(value, allowAuto) {
    const normalized = normalizeText(value).toLowerCase();
    if (normalized === 'responses' || normalized === 'chat') {
      return normalized;
    }
    return allowAuto ? 'auto' : '';
  }

  function normalizeReasoningAdapter(value) {
    const normalized = normalizeText(value).toLowerCase();
    return ['auto', 'none', 'deepseek', 'reasoning_effort', 'openrouter', 'enable_thinking', 'thinking', 'reasoning_split'].includes(normalized)
      ? normalized
      : 'auto';
  }

  function normalizeReasoningCapability(value) {
    const normalized = normalizeText(value).toLowerCase();
    return ['auto', 'none', 'toggle', 'effort'].includes(normalized) ? normalized : 'auto';
  }

  function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function normalizeInteger(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
  }

  return {
    BUILTIN_PROVIDER_ID,
    buildBuiltinProvider,
    buildEmptyDraft,
    buildRunSelection,
    getActiveProvider,
    normalizeCatalog,
    normalizeProvider
  };
});
