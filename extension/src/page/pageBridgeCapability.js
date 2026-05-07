(function initPageBridgeCapability(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafPageBridgeCapability = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function pageBridgeCapabilityFactory() {
  'use strict';

  function create() {
    const state = {
      capability: ''
    };

    return {
      initializePageBridgeCapability(capability) {
        return initializePageBridgeCapability(state, capability);
      },
      hasValidPageBridgeCapability(capability) {
        return hasValidPageBridgeCapability(state, capability);
      }
    };
  }

  function initializePageBridgeCapability(state, capability) {
    if (!isValidPageBridgeCapability(capability)) {
      return {
        ok: false,
        code: 'invalid_page_bridge_capability',
        error: 'Invalid page bridge capability'
      };
    }
    if (!state.capability) {
      state.capability = capability;
      return { ok: true };
    }
    if (capability === state.capability) {
      return { ok: true, alreadyInitialized: true };
    }
    return {
      ok: false,
      code: 'page_bridge_capability_already_initialized',
      error: 'Page bridge capability is already initialized'
    };
  }

  function hasValidPageBridgeCapability(state, capability) {
    return Boolean(state.capability && capability === state.capability);
  }

  function isValidPageBridgeCapability(capability) {
    return typeof capability === 'string'
      && capability.length >= 16
      && capability.length <= 256
      && !/[\u0000-\u001f\u007f]/.test(capability);
  }

  function buildUnauthorizedBridgeResult() {
    return {
      ok: false,
      code: 'page_bridge_unauthorized',
      error: 'Page bridge request is not authorized'
    };
  }

  return {
    buildUnauthorizedBridgeResult,
    create,
    isValidPageBridgeCapability
  };
});
