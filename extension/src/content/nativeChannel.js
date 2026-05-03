(function initCodexOverleafNativeChannel(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafNativeChannel = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function nativeChannelFactory() {
  'use strict';

  function create(deps = {}) {
    const runtime = deps.chrome?.runtime || chrome.runtime;
    const cryptoImpl = deps.crypto || crypto;
    let activeRequestId = null;

    function sendNative(payload) {
      const id = cryptoImpl.randomUUID();
      activeRequestId = id;
      return runtime.sendMessage({
        type: 'codex-overleaf/native-request',
        payload: {
          id,
          ...payload
        }
      });
    }

    function sendBackgroundNative(payload) {
      const id = cryptoImpl.randomUUID();
      return runtime.sendMessage({
        type: 'codex-overleaf/native-request',
        payload: {
          id,
          ...payload
        }
      });
    }

    function getActiveRequestId() {
      return activeRequestId;
    }

    function clearActiveRequest() {
      activeRequestId = null;
    }

    function shouldHandleNativeEvent(message = {}) {
      return message?.type === 'codex-overleaf/native-event' && message.id === activeRequestId;
    }

    return {
      clearActiveRequest,
      getActiveRequestId,
      sendBackgroundNative,
      sendNative,
      shouldHandleNativeEvent
    };
  }

  return {
    create
  };
});
