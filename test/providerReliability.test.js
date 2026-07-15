const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { computeDraftFingerprint } = require('../native-host/src/providerProfile');
const {
  PROVIDER_API_KEY_ENV,
  applyProviderEnvironment
} = require('../native-host/src/codexProviderLaunch');
const { sanitizeProviderMessage } = require('../native-host/src/providerRedaction');
const { getReasoningControl, resolveReasoningAdapter } = require('../native-host/src/providerReasoning');
const { resolveRunProvider } = require('../native-host/src/providerRuntime');
const {
  getProviderStorePaths,
  listProviders,
  loadProviderState,
  upsertProvider
} = require('../native-host/src/providerStore');
const ModelPickerSupport = require('../extension/src/content/modelPickerSupport');

function withProviderStore(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-provider-'));
  const env = { ...process.env, CODEX_OVERLEAF_PROVIDER_STORE_DIR: root };
  try {
    return callback(env);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function makeDraft(overrides = {}) {
  return {
    name: 'Example Provider',
    baseUrl: 'https://api.example.com/v1',
    wireApiPreference: 'responses',
    models: [{ id: 'example-model', label: 'Example Model', reasoningEfforts: [] }],
    defaultModelId: 'example-model',
    requestTimeoutMs: 30000,
    reasoningAdapter: 'none',
    reasoningCapability: 'none',
    ...overrides
  };
}

function saveVerifiedProvider(env, draft, options = {}) {
  const secret = options.secret || 'sk-test-secret';
  return upsertProvider({
    profileId: options.profileId,
    expectedRevision: options.expectedRevision || 0,
    draft,
    secretMutation: options.profileId
      ? { kind: 'unchanged' }
      : { kind: 'replace', value: secret },
    verifiedDraftFingerprint: computeDraftFingerprint(draft, secret),
    verifiedWireApi: 'responses',
    activate: options.activate === true,
    disclosureHost: options.activate === true ? new URL(draft.baseUrl).hostname : ''
  }, env);
}

test('custom runs require the provider revision displayed by the current tab', () => {
  withProviderStore(env => {
    const catalog = saveVerifiedProvider(env, makeDraft(), { activate: true });
    const profile = catalog.providers.find(provider => provider.id === catalog.activeProviderId);
    assert.throws(
      () => resolveRunProvider({ model: 'example-model' }, env),
      error => error?.code === 'provider_selection_unavailable'
    );
    const resolved = resolveRunProvider({
      model: 'example-model',
      providerSelection: { providerId: profile.id, providerRevision: profile.revision }
    }, env);
    assert.equal(resolved.providerSelection.providerId, profile.id);
    assert.equal(resolved.providerSelection.providerRevision, profile.revision);
  });
});

test('changing the active provider destination deactivates it and clears disclosure', () => {
  withProviderStore(env => {
    const initial = saveVerifiedProvider(env, makeDraft(), { activate: true });
    const profile = initial.providers.find(provider => provider.id === initial.activeProviderId);
    const changedDraft = makeDraft({ baseUrl: 'https://other.example.com/v1' });
    const updated = saveVerifiedProvider(env, changedDraft, {
      profileId: profile.id,
      expectedRevision: profile.revision
    });
    const changed = updated.providers.find(provider => provider.id === profile.id);
    assert.equal(updated.activeProviderId, 'builtin');
    assert.equal(changed.endpointDisclosureHost, '');
    assert.equal(changed.endpointDisclosureBaseUrl, '');
  });
});

test('provider state recovers a stale inter-process lock and keeps stores aligned', () => {
  withProviderStore(env => {
    const paths = getProviderStorePaths(env);
    fs.mkdirSync(paths.root, { recursive: true });
    fs.writeFileSync(paths.lockFile, 'stale-owner', { mode: 0o600 });
    const stale = new Date(Date.now() - 60000);
    fs.utimesSync(paths.lockFile, stale, stale);
    assert.equal(listProviders(env).activeProviderId, 'builtin');
    const state = loadProviderState(env);
    assert.equal(state.public.storeRevision, state.secrets.storeRevision);
    assert.equal(fs.existsSync(paths.lockFile), false);
  });
});

test('provider errors redact the exact API key even when it is unlabelled', () => {
  const secret = 'sk-exact-private-value';
  const sanitized = sanitizeProviderMessage(`upstream echoed ${secret} and Bearer ${secret}`, [secret]);
  assert.doesNotMatch(sanitized, /sk-exact-private-value/);
  assert.match(sanitized, /\[redacted\]/);
});

test('DeepSeek endpoints automatically expose the supported reasoning controls', () => {
  const inferred = {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    reasoningAdapter: 'auto',
    reasoningCapability: 'auto'
  };
  assert.equal(resolveReasoningAdapter(inferred, 'deepseek-reasoner'), 'deepseek');
  assert.deepEqual(getReasoningControl(inferred, {
    id: 'deepseek-reasoner',
    reasoningEfforts: ['high', 'xhigh']
  }), { efforts: ['high', 'xhigh'], defaultEffort: 'high', presentation: 'deepseek' });
  assert.equal(resolveReasoningAdapter({ ...inferred, reasoningAdapter: 'deepseek' }, 'deepseek-reasoner'), 'deepseek');
});

test('local chat bridge bypasses system proxies without discarding existing rules', () => {
  const source = {
    HTTP_PROXY: 'http://proxy.example:8080',
    NO_PROXY: 'api.example.com,localhost',
    no_proxy: 'internal.example,127.0.0.1',
    [PROVIDER_API_KEY_ENV]: 'stale-token'
  };
  const result = applyProviderEnvironment(source, {
    baseUrl: 'http://127.0.0.1:43123/v1',
    apiKey: 'bridge-token'
  });
  const bypasses = new Set(result.NO_PROXY.split(','));

  assert.equal(result.HTTP_PROXY, source.HTTP_PROXY);
  assert.equal(result.no_proxy, result.NO_PROXY);
  assert.equal(result[PROVIDER_API_KEY_ENV], 'bridge-token');
  assert.deepEqual(bypasses, new Set([
    'api.example.com',
    'localhost',
    'internal.example',
    '127.0.0.1',
    '::1'
  ]));
  assert.equal(source.NO_PROXY, 'api.example.com,localhost');
  assert.equal(source.no_proxy, 'internal.example,127.0.0.1');
});

test('remote Responses providers keep the caller proxy environment unchanged', () => {
  const source = { NO_PROXY: 'api.example.com', no_proxy: 'internal.example' };
  const result = applyProviderEnvironment(source, {
    baseUrl: 'https://api.example.com/v1',
    apiKey: ''
  });

  assert.equal(result.NO_PROXY, source.NO_PROXY);
  assert.equal(result.no_proxy, source.no_proxy);
});

test('model discovery fallback is limited to confirmed Built-in Codex catalogs', () => {
  assert.equal(ModelPickerSupport.shouldUseBuiltInFallback({ ok: true, result: { models: [] } }), true);
  assert.equal(ModelPickerSupport.shouldUseBuiltInFallback({
    ok: true,
    result: { providerId: 'custom-one', models: [] }
  }), false);
  assert.equal(ModelPickerSupport.shouldUseBuiltInFallback({
    ok: false,
    error: { code: 'provider_not_found' }
  }), false);
});
