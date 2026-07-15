'use strict';

const crypto = require('node:crypto');
const {
  normalizeReasoningAdapter,
  normalizeReasoningCapability
} = require('./providerReasoning');

const ALLOWED_WIRE_APIS = new Set(['auto', 'responses', 'chat']);
const ALLOWED_REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
const UNSAFE_CLI_VALUE = /[\0\r\n"&|<>^%!`]/;

function normalizeProviderDraft(value = {}) {
  const name = normalizeRequiredText(value.name, 'provider_name_invalid', 'Provider name is required.', 64);
  assertCliSafe(name, 'provider_name_invalid', 'Provider name contains unsupported command characters.');
  const baseUrl = normalizeBaseUrl(value.baseUrl);
  const wireApiPreference = normalizeWireApi(value.wireApiPreference, true);
  const models = normalizeModels(value.models);
  if (!models.length) {
    throw providerError('provider_model_not_configured', 'At least one model ID is required.');
  }
  const defaultModelId = normalizeRequiredText(
    value.defaultModelId,
    'provider_model_not_configured',
    'A default model ID is required.',
    200
  );
  assertCliSafe(defaultModelId, 'provider_model_not_configured', 'Default model ID contains unsupported command characters.');
  if (!models.some(model => model.id === defaultModelId)) {
    throw providerError('provider_model_not_configured', 'The default model must be present in the provider model list.');
  }
  const requestTimeoutMs = normalizeTimeout(value.requestTimeoutMs);
  const reasoningAdapter = normalizeReasoningAdapter(value.reasoningAdapter);
  const reasoningCapability = normalizeReasoningCapability(value.reasoningCapability);
  return {
    name,
    baseUrl,
    wireApiPreference,
    models,
    defaultModelId,
    requestTimeoutMs,
    reasoningAdapter,
    reasoningCapability
  };
}

function normalizeModels(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  const seen = new Set();
  const result = [];
  for (const value of values.slice(0, 32)) {
    const id = normalizeText(typeof value === 'string' ? value : value?.id);
    if (!id || id.length > 200 || seen.has(id)) {
      continue;
    }
    assertCliSafe(id, 'provider_model_not_configured', `Model ID ${id} contains unsupported command characters.`);
    seen.add(id);
    const label = normalizeText(value?.label) || id;
    const reasoningEfforts = Array.isArray(value?.reasoningEfforts)
      ? value.reasoningEfforts.map(normalizeText).filter(effort => ALLOWED_REASONING_EFFORTS.has(effort))
      : [];
    result.push({ id, label: label.slice(0, 200), reasoningEfforts: Array.from(new Set(reasoningEfforts)) });
  }
  return result;
}

function normalizeBaseUrl(value) {
  const text = normalizeRequiredText(value, 'provider_base_url_invalid', 'Base URL is required.', 2048);
  let parsed;
  try {
    parsed = new URL(text);
  } catch (_error) {
    throw providerError('provider_base_url_invalid', 'Base URL is not a valid URL.');
  }
  if (parsed.username || parsed.password) {
    throw providerError('provider_base_url_invalid', 'Base URL cannot contain credentials.');
  }
  if (parsed.search || parsed.hash) {
    throw providerError('provider_base_url_invalid', 'Base URL cannot contain a query string or fragment.');
  }
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && isLoopbackHost(parsed.hostname))) {
    throw providerError('provider_base_url_insecure', 'HTTPS is required except for loopback endpoints.');
  }
  const pathname = parsed.pathname.replace(/\/+$/, '');
  const normalized = `${parsed.origin}${pathname === '/' ? '' : pathname}`;
  assertCliSafe(normalized, 'provider_base_url_invalid', 'Base URL contains unsupported command characters.');
  return normalized;
}

function normalizeWireApi(value, allowAuto = false) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'responses' || normalized === 'chat' || (allowAuto && normalized === 'auto')) {
    return normalized;
  }
  if (allowAuto && !normalized) {
    return 'auto';
  }
  throw providerError('provider_protocol_incompatible', 'API protocol must be Auto, Responses, or Chat Completions.');
}

function normalizeSecret(value) {
  if (value === undefined || value === null || value === '') {
    return '';
  }
  const text = String(value);
  if (text.length > 8192 || /[\0\r\n]/.test(text)) {
    throw providerError('provider_secret_invalid', 'API key contains unsupported characters or exceeds the size limit.');
  }
  return text;
}

function computeDraftFingerprint(draft, secret) {
  const normalized = normalizeProviderDraft(draft);
  const secretDigest = crypto.createHash('sha256').update(normalizeSecret(secret)).digest('hex');
  return crypto.createHash('sha256').update(JSON.stringify({ normalized, secretDigest })).digest('hex');
}

function getEndpointHost(baseUrl) {
  try {
    return new URL(baseUrl).hostname;
  } catch (_error) {
    return '';
  }
}

function sanitizeProfile(profile, hasSecret) {
  return {
    id: profile.id,
    kind: 'custom',
    revision: profile.revision,
    name: profile.name,
    baseUrl: profile.baseUrl,
    wireApiPreference: profile.wireApiPreference,
    resolvedWireApi: profile.resolvedWireApi || '',
    models: profile.models.map(model => ({ ...model, reasoningEfforts: model.reasoningEfforts.slice() })),
    defaultModelId: profile.defaultModelId,
    requestTimeoutMs: profile.requestTimeoutMs,
    reasoningAdapter: profile.reasoningAdapter || 'auto',
    reasoningCapability: profile.reasoningCapability || 'auto',
    hasSecret: Boolean(hasSecret),
    secretUpdatedAt: profile.secretUpdatedAt || 0,
    endpointDisclosureHost: profile.endpointDisclosureHost || '',
    endpointDisclosureBaseUrl: profile.endpointDisclosureBaseUrl || '',
    endpointDisclosureAcceptedAt: profile.endpointDisclosureAcceptedAt || 0,
    lastVerified: profile.lastVerified
      ? {
          revision: profile.lastVerified.revision,
          at: profile.lastVerified.at,
          modelId: profile.lastVerified.modelId,
          wireApi: profile.lastVerified.wireApi
        }
      : null,
    createdAt: profile.createdAt || 0,
    updatedAt: profile.updatedAt || 0
  };
}

function normalizeTimeout(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 30000;
  }
  return Math.min(120000, Math.max(5000, Math.floor(number)));
}

function normalizeRequiredText(value, code, message, maxLength) {
  const text = normalizeText(value);
  if (!text || text.length > maxLength || /[\0\r\n]/.test(text)) {
    throw providerError(code, message);
  }
  return text;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function assertCliSafe(value, code, message) {
  if (UNSAFE_CLI_VALUE.test(value)) {
    throw providerError(code, message);
  }
}

function isLoopbackHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

function providerError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, details);
  return error;
}

module.exports = {
  computeDraftFingerprint,
  getEndpointHost,
  normalizeProviderDraft,
  normalizeSecret,
  normalizeWireApi,
  providerError,
  sanitizeProfile
};
