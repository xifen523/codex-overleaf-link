'use strict';

const {
  activateProvider,
  deleteProvider,
  listProviders,
  loadProviderState,
  resolveDraftSecret,
  upsertProvider
} = require('./providerStore');
const {
  computeDraftFingerprint,
  getEndpointHost,
  normalizeProviderDraft,
  providerError
} = require('./providerProfile');
const { sanitizeProviderMessage } = require('./providerRedaction');
const { createProviderLaunch } = require('./codexProviderLaunch');
const { runProviderConnectionTest } = require('./codexProviderTest');
const { getReasoningControl } = require('./providerReasoning');

const PROVIDER_METHODS = new Set([
  'codex.providers.list',
  'codex.providers.test',
  'codex.providers.test.cancel',
  'codex.providers.upsert',
  'codex.providers.activate',
  'codex.providers.delete'
]);
const AUTO_PROTOCOL_FALLBACK_CODES = new Set([
  'provider_protocol_incompatible'
]);
const activeTests = new Map();

function isProviderMethod(method) {
  return PROVIDER_METHODS.has(method);
}

async function handleProviderRequest(request, env = process.env) {
  try {
    const params = request.params || {};
    switch (request.method) {
      case 'codex.providers.list':
        return okResponse(request.id, listProviders(env));
      case 'codex.providers.upsert':
        return okResponse(request.id, upsertProvider(params, env));
      case 'codex.providers.activate':
        return okResponse(request.id, activateProvider(params, env));
      case 'codex.providers.delete':
        return okResponse(request.id, deleteProvider(params, env));
      case 'codex.providers.test.cancel':
        return okResponse(request.id, cancelProviderTest(params.operationId));
      case 'codex.providers.test':
        return okResponse(request.id, await testProvider(params, env));
      default:
        throw providerError('method_not_found', `Unknown provider method: ${request.method}`);
    }
  } catch (error) {
    return providerErrorResponse(request.id, error);
  }
}

async function testProvider(params, env) {
  const operationId = String(params.operationId || '');
  if (!operationId) {
    throw providerError('invalid_request', 'Provider test requires an operation id.');
  }
  const draft = normalizeProviderDraft(params.draft || {});
  const secret = resolveDraftSecret(params, env);
  const fingerprint = computeDraftFingerprint(draft, secret);
  const controller = new AbortController();
  activeTests.get(operationId)?.abort?.();
  activeTests.set(operationId, controller);
  const protocols = draft.wireApiPreference === 'auto'
    ? ['responses', 'chat']
    : [draft.wireApiPreference];
  try {
    let lastError;
    for (const wireApi of protocols) {
      const launch = createProviderLaunch({
        profile: { id: params.profileId || 'draft', revision: params.expectedRevision || 0, ...draft },
        secret,
        modelId: draft.defaultModelId,
        wireApi
      });
      try {
        const result = await runProviderConnectionTest({ launch, env, signal: controller.signal });
        return {
          ok: true,
          operationId,
          draftFingerprint: fingerprint,
          resolvedWireApi: wireApi,
          testedModelId: draft.defaultModelId,
          durationMs: result.durationMs
        };
      } catch (error) {
        lastError = error;
        const canTryChat = draft.wireApiPreference === 'auto'
          && wireApi === 'responses'
          && AUTO_PROTOCOL_FALLBACK_CODES.has(error.code);
        if (!canTryChat) {
          throw error;
        }
      }
    }
    throw lastError || providerError('provider_protocol_incompatible', 'No compatible provider protocol was found.');
  } catch (error) {
    error.message = sanitizeProviderMessage(error?.message, [secret]);
    throw error;
  } finally {
    if (activeTests.get(operationId) === controller) {
      activeTests.delete(operationId);
    }
  }
}

function cancelProviderTest(operationId) {
  const id = String(operationId || '');
  const controller = activeTests.get(id);
  if (!controller) {
    return { cancelled: false };
  }
  controller.abort();
  activeTests.delete(id);
  return { cancelled: true };
}

function resolveProviderModels(params = {}, env = process.env, resolveBuiltInModels) {
  const state = loadProviderState(env);
  if (state.public.activeProviderId === 'builtin') {
    return resolveBuiltInModels(params, env);
  }
  const profile = state.public.profiles.find(item => item.id === state.public.activeProviderId);
  if (!profile) {
    throw providerError('provider_not_found', 'The active provider no longer exists.');
  }
  return {
    providerId: profile.id,
    providerRevision: profile.revision,
    providerName: profile.name,
    models: profile.models.map(model => {
      const reasoning = getReasoningControl(profile, model);
      return {
        id: model.id,
        label: model.label || model.id,
        reasoningEfforts: reasoning.efforts,
        defaultReasoningEffort: reasoning.defaultEffort,
        reasoningPresentation: reasoning.presentation,
        speedTiers: ['standard'],
        defaultSpeedTier: 'standard'
      };
    }),
    source: 'custom-provider',
    fetchedAt: new Date().toISOString()
  };
}

function resolveRunProvider(params = {}, env = process.env) {
  const state = loadProviderState(env);
  const selection = params.providerSelection;
  const activeProviderId = state.public.activeProviderId || 'builtin';
  if (selection?.providerId && selection.providerId !== activeProviderId) {
    throw providerError('provider_revision_conflict', 'The active provider changed in another tab. Refresh and retry.');
  }
  if (activeProviderId === 'builtin') {
    return {
      modelId: params.model || '',
      reasoningEffort: params.reasoningEffort || '',
      providerLaunch: null,
      providerSelection: { providerId: 'builtin', providerRevision: 0 }
    };
  }
  const profile = state.public.profiles.find(item => item.id === activeProviderId);
  if (!profile) {
    throw providerError('provider_not_found', 'The active provider no longer exists.');
  }
  if (!selection?.providerId) {
    throw providerError('provider_selection_unavailable', 'The active provider has not been confirmed by this Overleaf tab. Wait for Provider settings to load and retry.');
  }
  if (Number(selection.providerRevision) !== profile.revision) {
    throw providerError('provider_revision_conflict', 'The active provider changed in another tab. Refresh and retry.');
  }
  const endpointHost = getEndpointHost(profile.baseUrl);
  if (profile.endpointDisclosureHost !== endpointHost || profile.endpointDisclosureBaseUrl !== profile.baseUrl) {
    throw providerError('provider_disclosure_required', 'Confirm the current provider endpoint before sending project content.');
  }
  const modelId = String(params.model || profile.defaultModelId).trim();
  const model = profile.models.find(item => item.id === modelId);
  if (!model) {
    throw providerError('provider_model_not_configured', 'The selected model is not configured for the active provider.');
  }
  const wireApi = profile.wireApiPreference === 'auto'
    ? profile.resolvedWireApi
    : profile.wireApiPreference;
  if (!wireApi) {
    throw providerError('provider_protocol_unverified', 'Run Test connection before using an Auto protocol provider.');
  }
  const secret = state.secrets.secrets[profile.id] || '';
  const reasoning = getReasoningControl(profile, model);
  const supportedReasoningEfforts = reasoning.efforts;
  const reasoningEffort = supportedReasoningEfforts.includes(params.reasoningEffort)
    ? params.reasoningEffort
    : reasoning.defaultEffort;
  return {
    modelId,
    reasoningEffort,
    providerLaunch: createProviderLaunch({ profile, secret, modelId, wireApi, reasoningEffort }),
    providerSelection: { providerId: profile.id, providerRevision: profile.revision }
  };
}

function providerErrorResponse(id, error) {
  const code = error?.code || 'provider_operation_failed';
  return {
    id,
    ok: false,
    error: {
      code,
      message: `[${code}] ${sanitizeProviderMessage(error?.message || 'Provider operation failed.')}`
    }
  };
}

function okResponse(id, result) {
  return { id, ok: true, result };
}

module.exports = {
  handleProviderRequest,
  isProviderMethod,
  providerErrorResponse,
  resolveProviderModels,
  resolveRunProvider
};
