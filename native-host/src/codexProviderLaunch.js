'use strict';

const { startChatCompletionsBridge } = require('./chatCompletionsBridge');

const PROVIDER_CONFIG_ID = 'codex_overleaf_custom';
const PROVIDER_API_KEY_ENV = 'CODEX_OVERLEAF_PROVIDER_API_KEY';
const LOOPBACK_NO_PROXY_HOSTS = ['127.0.0.1', 'localhost', '::1'];

function createProviderLaunch({ profile, secret = '', modelId, wireApi, reasoningEffort = '' }) {
  return Object.freeze({
    providerId: profile.id,
    providerRevision: profile.revision,
    providerName: profile.name,
    baseUrl: profile.baseUrl,
    modelId,
    wireApi,
    requestTimeoutMs: profile.requestTimeoutMs,
    reasoningAdapter: profile.reasoningAdapter || 'auto',
    reasoningCapability: profile.reasoningCapability || 'auto',
    reasoningEffort,
    apiKey: secret
  });
}

async function prepareProviderLaunch(launch, { signal } = {}) {
  if (!launch || launch.wireApi !== 'chat') {
    return { launch, close: async () => {} };
  }
  const bridge = await startChatCompletionsBridge({ launch, signal });
  return {
    launch: Object.freeze({
      ...launch,
      upstreamBaseUrl: launch.baseUrl,
      baseUrl: bridge.baseUrl,
      wireApi: 'responses',
      routedWireApi: 'chat',
      apiKey: bridge.clientToken
    }),
    close: bridge.close
  };
}

function buildProviderConfigArgs(launch) {
  if (!launch) {
    return [];
  }
  const values = [
    ['model', launch.modelId],
    ['model_provider', PROVIDER_CONFIG_ID],
    [`model_providers.${PROVIDER_CONFIG_ID}.name`, launch.providerName],
    [`model_providers.${PROVIDER_CONFIG_ID}.base_url`, launch.baseUrl],
    [`model_providers.${PROVIDER_CONFIG_ID}.wire_api`, launch.wireApi]
  ];
  if (launch.apiKey) {
    values.push([`model_providers.${PROVIDER_CONFIG_ID}.env_key`, PROVIDER_API_KEY_ENV]);
  }
  const args = [];
  for (const [key, value] of values) {
    args.push('-c', `${key}=${encodeTomlString(value)}`);
  }
  args.push('-c', `model_providers.${PROVIDER_CONFIG_ID}.requires_openai_auth=false`);
  return args;
}

function applyProviderEnvironment(env, launch) {
  const result = { ...(env || process.env) };
  delete result[PROVIDER_API_KEY_ENV];
  if (launch?.apiKey) {
    result[PROVIDER_API_KEY_ENV] = launch.apiKey;
  }
  if (isLoopbackBaseUrl(launch?.baseUrl)) {
    const noProxy = mergeNoProxyValues(result.NO_PROXY, result.no_proxy, LOOPBACK_NO_PROXY_HOSTS);
    result.NO_PROXY = noProxy;
    result.no_proxy = noProxy;
  }
  return result;
}

function isLoopbackBaseUrl(value) {
  try {
    const hostname = new URL(String(value || '')).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return LOOPBACK_NO_PROXY_HOSTS.includes(hostname);
  } catch (_error) {
    return false;
  }
}

function mergeNoProxyValues(...values) {
  const entries = [];
  const seen = new Set();
  for (const value of values.flat()) {
    for (const entry of String(value || '').split(',')) {
      const normalized = entry.trim();
      const key = normalized.toLowerCase();
      if (!normalized || seen.has(key)) continue;
      seen.add(key);
      entries.push(normalized);
    }
  }
  return entries.includes('*') ? '*' : entries.join(',');
}

function buildProviderSnapshot(launch) {
  if (!launch) {
    return {
      providerId: 'builtin',
      providerRevision: 0,
      providerName: 'Built-in Codex',
      providerKind: 'builtin'
    };
  }
  return {
    providerId: launch.providerId,
    providerRevision: launch.providerRevision,
    providerName: launch.providerName,
    providerKind: 'custom',
    modelId: launch.modelId,
    wireApi: launch.routedWireApi || launch.wireApi,
    requestTimeoutMs: launch.requestTimeoutMs
  };
}

function encodeTomlString(value) {
  return JSON.stringify(String(value ?? ''));
}

module.exports = {
  PROVIDER_API_KEY_ENV,
  applyProviderEnvironment,
  buildProviderConfigArgs,
  buildProviderSnapshot,
  createProviderLaunch,
  prepareProviderLaunch
};
