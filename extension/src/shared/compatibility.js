(function initCodexOverleafCompatibility(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafCompatibility = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function compatibilityFactory() {
  'use strict';

  const EXTENSION_PROTOCOL_VERSION = 1;
  const SUPPORTED_NATIVE_PROTOCOL = Object.freeze({ min: 1, max: 1 });
  const MIN_NATIVE_VERSION = '0.5.0';
  const BUILD_TARGET_VERSION = '0.5.0';
  const REQUIRED_CAPABILITIES = Object.freeze([
    'bridgePing',
    'mirrorSync',
    'mirrorPatchFiles',
    'mirrorStatus',
    'codexRun',
    'codexCancel',
    'codexModels',
    'historyClearPlugin'
  ]);
  const ALWAYS_ALLOWED_METHODS = new Set([
    'bridge.ping',
    'mirror.status',
    'codex.cancel'
  ]);
  const OK_ONLY_METHODS = new Set([
    'codex.history.clearPlugin',
    'mirror.sync',
    'mirror.patchFiles',
    'codex.run',
    'task.run',
    'task.confirm'
  ]);

  function buildBridgePingParams(metadata = {}) {
    const extensionVersion = resolveMetadataVersion(metadata);
    return {
      extensionVersion: extensionVersion.normalized,
      extensionProtocolVersion: EXTENSION_PROTOCOL_VERSION,
      supportedNativeProtocol: { ...SUPPORTED_NATIVE_PROTOCOL },
      requiredCapabilities: REQUIRED_CAPABILITIES.slice()
    };
  }

  function evaluateNativeCompatibility(response, metadata = {}) {
    if (!response || response.ok === false) {
      return compatibilityResult('native_missing', response, metadata);
    }

    const native = response.ok === true ? response.result : response;
    if (!native || typeof native !== 'object') {
      return compatibilityResult('native_missing', native, metadata);
    }

    const nativeVersion = parseSemver(native.version);
    if (
      !native.version ||
      !Object.prototype.hasOwnProperty.call(native, 'protocolVersion') ||
      !isProtocolRange(native.supportedProtocol) ||
      !native.capabilities ||
      typeof native.capabilities !== 'object' ||
      !nativeVersion ||
      compareSemver(nativeVersion, parseSemver(MIN_NATIVE_VERSION)) < 0 ||
      !hasRequiredCapabilities(native.capabilities)
    ) {
      return compatibilityResult('native_too_old', native, metadata);
    }

    const extensionVersion = resolveMetadataVersion(metadata);
    const minExtensionVersion = native.minExtensionVersion ? parseSemver(native.minExtensionVersion) : null;
    if (
      native.minExtensionVersion &&
      (!minExtensionVersion || !extensionVersion.valid || compareSemver(extensionVersion.parsed, minExtensionVersion) < 0)
    ) {
      return compatibilityResult('extension_too_old', native, metadata);
    }

    if (!protocolRangesOverlap(SUPPORTED_NATIVE_PROTOCOL, native.supportedProtocol)) {
      return compatibilityResult('protocol_unsupported', native, metadata);
    }

    if (native.environment?.codex?.ok === false) {
      return compatibilityResult('native_unhealthy', native, metadata);
    }

    return compatibilityResult('ok', native, metadata);
  }

  function buildInstallCommand(version = BUILD_TARGET_VERSION) {
    const normalized = normalizeReleaseVersion(version) || BUILD_TARGET_VERSION;
    const ref = `v${normalized}`;
    return `CODEX_OVERLEAF_REF=${ref} bash -c "$(curl -fsSL https://raw.githubusercontent.com/Ghqqqq/codex-overleaf-link/${ref}/install.sh)"`;
  }

  function isNativeMethodAllowed(method, compatibilityStatus) {
    if (ALWAYS_ALLOWED_METHODS.has(method)) {
      return true;
    }

    const status = getStatus(compatibilityStatus);
    if (method === 'codex.models') {
      return status !== 'native_missing';
    }

    if (OK_ONLY_METHODS.has(method)) {
      return status === 'ok';
    }

    return status === 'ok';
  }

  function compatibilityResult(status, native, metadata = {}) {
    const extensionVersion = resolveMetadataVersion(metadata);
    return {
      status,
      native,
      extensionVersion: extensionVersion.normalized,
      installCommand: buildInstallCommand()
    };
  }

  function getStatus(compatibilityStatus) {
    if (typeof compatibilityStatus === 'string') {
      return compatibilityStatus;
    }
    if (compatibilityStatus && typeof compatibilityStatus.status === 'string') {
      return compatibilityStatus.status;
    }
    return 'native_missing';
  }

  function hasRequiredCapabilities(capabilities) {
    return REQUIRED_CAPABILITIES.every(capability => capabilities[capability] === true);
  }

  function isProtocolRange(range) {
    return range &&
      Number.isInteger(range.min) &&
      Number.isInteger(range.max) &&
      range.min <= range.max;
  }

  function protocolRangesOverlap(left, right) {
    return isProtocolRange(left) &&
      isProtocolRange(right) &&
      left.min <= right.max &&
      right.min <= left.max;
  }

  function resolveMetadataVersion(metadata = {}) {
    const hasVersion = metadata &&
      typeof metadata === 'object' &&
      Object.prototype.hasOwnProperty.call(metadata, 'version');
    if (!hasVersion) {
      return {
        normalized: BUILD_TARGET_VERSION,
        parsed: parseSemver(BUILD_TARGET_VERSION),
        valid: true
      };
    }

    const normalized = normalizeReleaseVersion(metadata.version);
    if (!normalized) {
      return {
        normalized: BUILD_TARGET_VERSION,
        parsed: parseSemver(BUILD_TARGET_VERSION),
        valid: false
      };
    }

    return {
      normalized,
      parsed: parseSemver(normalized),
      valid: true
    };
  }

  function normalizeReleaseVersion(version) {
    if (typeof version !== 'string') {
      return '';
    }
    const match = /^v?(\d+\.\d+\.\d+)$/.exec(version);
    return match ? match[1] : '';
  }

  function parseSemver(version) {
    const normalized = normalizeReleaseVersion(version);
    if (!normalized) {
      return null;
    }
    const [major, minor, patch] = normalized.split('.').map(Number);
    return {
      major,
      minor,
      patch
    };
  }

  function compareSemver(left, right) {
    for (const key of ['major', 'minor', 'patch']) {
      if (left[key] !== right[key]) {
        return left[key] < right[key] ? -1 : 1;
      }
    }
    return 0;
  }

  return {
    EXTENSION_PROTOCOL_VERSION,
    SUPPORTED_NATIVE_PROTOCOL,
    MIN_NATIVE_VERSION,
    REQUIRED_CAPABILITIES,
    BUILD_TARGET_VERSION,
    buildBridgePingParams,
    evaluateNativeCompatibility,
    buildInstallCommand,
    isNativeMethodAllowed
  };
});
