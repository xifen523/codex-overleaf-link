const assert = require('node:assert/strict');
const test = require('node:test');

const compatibility = require('../extension/src/shared/compatibility');

const REQUIRED_CAPABILITIES = [
  'bridgePing',
  'mirrorSync',
  'mirrorPatchFiles',
  'mirrorStatus',
  'codexRun',
  'codexCancel',
  'codexModels',
  'historyClearPlugin',
  'localSkills',
  'mirrorSensitiveScan'
];

function compatibleNative(overrides = {}) {
  return {
    ok: true,
    result: {
      host: 'com.codex.overleaf',
      platform: 'darwin',
      version: '0.9.0',
      protocolVersion: 1,
      supportedProtocol: { min: 1, max: 1 },
      capabilities: Object.fromEntries(REQUIRED_CAPABILITIES.map(capability => [capability, true])),
      minExtensionVersion: '0.9.0',
      environment: {
        codex: { ok: true }
      },
      ...overrides
    }
  };
}

function statusFor(response, metadata = { version: '0.9.0' }) {
  return compatibility.evaluateNativeCompatibility(response, metadata).status;
}

function canonicalInstallCommand() {
  return 'CODEX_OVERLEAF_REF=v0.9.0 bash -c "$(curl -fsSL https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/v0.9.0/install.sh)"';
}

test('buildBridgePingParams returns v0.9 extension protocol metadata', () => {
  assert.equal(compatibility.MIN_NATIVE_VERSION, '0.9.0');
  assert.equal(compatibility.BUILD_TARGET_VERSION, '0.9.0');
  assert.equal(compatibility.EXTENSION_PROTOCOL_VERSION, 1);
  assert.deepEqual(compatibility.buildBridgePingParams({ version: '0.9.0' }), {
    extensionVersion: '0.9.0',
    extensionProtocolVersion: 1,
    supportedNativeProtocol: { min: 1, max: 1 },
    requiredCapabilities: REQUIRED_CAPABILITIES
  });
});

test('evaluateNativeCompatibility classifies missing native responses', () => {
  assert.equal(statusFor(null), 'native_missing');
  assert.equal(statusFor({ ok: false, error: { code: 'native_disconnected' } }), 'native_missing');
});

test('evaluateNativeCompatibility classifies v0.3-like ping responses as too old', () => {
  assert.equal(statusFor({
    ok: true,
    result: {
      host: 'com.codex.overleaf',
      platform: 'darwin',
      version: '0.3.0',
      protocolVersion: 1,
      environment: {}
    }
  }), 'native_too_old');
});

test('evaluateNativeCompatibility classifies malformed native versions as too old', () => {
  assert.equal(statusFor(compatibleNative({ version: 'next' })), 'native_too_old');
});

test('evaluateNativeCompatibility classifies native versions below v0.9 as too old', () => {
  assert.equal(statusFor(compatibleNative({ version: '0.8.0' })), 'native_too_old');
});

test('evaluateNativeCompatibility classifies missing required capabilities as too old', () => {
  const missingCapability = compatibleNative({
    capabilities: {
      bridgePing: true,
      mirrorSync: true,
      mirrorStatus: true,
      codexRun: true,
      codexCancel: true,
      codexModels: true,
      historyClearPlugin: true
    }
  });
  const falseCapability = compatibleNative({
    capabilities: {
      ...compatibleNative().result.capabilities,
      mirrorPatchFiles: false
    }
  });

  assert.equal(statusFor(missingCapability), 'native_too_old');
  assert.equal(statusFor(falseCapability), 'native_too_old');
});

test('evaluateNativeCompatibility classifies extension versions below native minimum as too old', () => {
  assert.equal(
    statusFor(compatibleNative({ minExtensionVersion: '0.9.0' }), { version: '0.7.0' }),
    'extension_too_old'
  );
});

test('evaluateNativeCompatibility returns a structured status for malformed extension versions', () => {
  for (const version of ['next', null]) {
    const result = compatibility.evaluateNativeCompatibility(compatibleNative(), { version });

    assert.equal(result.status, 'extension_too_old');
    assert.equal(result.installCommand, canonicalInstallCommand());
  }
});

test('evaluateNativeCompatibility classifies protocol range mismatches', () => {
  assert.equal(statusFor(compatibleNative({
    supportedProtocol: { min: 2, max: 2 },
    protocolVersion: 2
  })), 'protocol_unsupported');
});

test('evaluateNativeCompatibility classifies explicit Codex environment failures as unhealthy', () => {
  assert.equal(statusFor(compatibleNative({
    environment: {
      codex: { ok: false, reason: 'not found' }
    }
  })), 'native_unhealthy');
});

test('evaluateNativeCompatibility allows compatible metadata without Codex environment details', () => {
  assert.equal(statusFor(compatibleNative({ environment: {} })), 'ok');
});

test('evaluateNativeCompatibility allows healthy v0.9 native metadata', () => {
  assert.equal(statusFor(compatibleNative()), 'ok');
});

test('buildInstallCommand returns the canonical version-pinned installer', () => {
  assert.equal(
    compatibility.buildInstallCommand('0.9.0'),
    canonicalInstallCommand()
  );
  assert.equal(compatibility.buildInstallCommand('v0.9.0'), canonicalInstallCommand());
});

test('buildInstallCommand falls back to the canonical target for unsafe versions', () => {
  for (const version of [
    '0.9.0; touch /tmp/pwned',
    '0.9.0 && touch /tmp/pwned',
    ' 0.9.0',
    '0.9.0 ',
    '0.9.0/bad',
    'v0.9.0$(id)',
    '',
    null
  ]) {
    assert.equal(compatibility.buildInstallCommand(version), canonicalInstallCommand());
  }
});

test('compatibility recovery command uses the build target instead of caller metadata version', () => {
  const result = compatibility.evaluateNativeCompatibility(compatibleNative(), { version: '0.3.0' });

  assert.equal(result.status, 'extension_too_old');
  assert.equal(result.installCommand, canonicalInstallCommand());
});

test('isNativeMethodAllowed applies the native compatibility policy', () => {
  for (const method of ['bridge.ping', 'mirror.status', 'codex.cancel']) {
    assert.equal(compatibility.isNativeMethodAllowed(method, 'native_missing'), true);
    assert.equal(compatibility.isNativeMethodAllowed(method, 'native_too_old'), true);
  }

  assert.equal(compatibility.isNativeMethodAllowed('codex.models', 'native_missing'), false);
  assert.equal(compatibility.isNativeMethodAllowed('codex.models', 'native_too_old'), true);
  assert.equal(compatibility.isNativeMethodAllowed('codex.models', { status: 'native_unhealthy' }), true);

  for (const method of [
    'codex.history.clearPlugin',
    'mirror.sync',
    'mirror.patchFiles',
    'codex.run',
    'task.run',
    'task.confirm',
    'mirror.scanSensitive',
    'skills.list',
    'skills.install',
    'skills.remove'
  ]) {
    assert.equal(compatibility.isNativeMethodAllowed(method, 'native_too_old'), false);
    assert.equal(compatibility.isNativeMethodAllowed(method, 'native_unhealthy'), false);
    assert.equal(compatibility.isNativeMethodAllowed(method, 'ok'), true);
  }
});
