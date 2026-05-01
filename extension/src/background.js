(function initBackground() {
  'use strict';

  const HOST_NAME = 'com.codex.overleaf';
  let port = null;
  const pending = new Map();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== 'codex-overleaf/native-request') {
      return undefined;
    }

    sendNativeRequest(message.payload, _sender)
      .then(result => sendResponse(result))
      .catch(error => {
        sendResponse({
          ok: false,
          error: {
            code: 'native_connection_failed',
            message: error.message
          }
        });
      });

    return true;
  });

  function sendNativeRequest(payload, sender) {
    const nativePort = ensurePort();
    const id = payload.id || crypto.randomUUID();
    const request = { ...payload, id };

    return new Promise((resolve, reject) => {
      pending.set(id, {
        resolve,
        reject,
        tabId: sender?.tab?.id
      });
      nativePort.postMessage(request);
    });
  }

  function ensurePort() {
    if (port) {
      return port;
    }

    port = chrome.runtime.connectNative(HOST_NAME);
    port.onMessage.addListener(message => {
      const id = message?.id;
      if (!pending.has(id)) {
        return;
      }
      const pendingRequest = pending.get(id);
      if (message?.event) {
        forwardNativeEvent(pendingRequest.tabId, id, message.event);
        return;
      }
      pendingRequest.resolve(message);
      pending.delete(id);
    });
    port.onDisconnect.addListener(() => {
      const error = chrome.runtime.lastError?.message || 'Native host disconnected';
      for (const pendingRequest of pending.values()) {
        pendingRequest.reject(new Error(error));
      }
      pending.clear();
      port = null;
    });

    return port;
  }

  function forwardNativeEvent(tabId, id, event) {
    if (typeof tabId !== 'number') {
      return;
    }

    chrome.tabs.sendMessage(tabId, {
      type: 'codex-overleaf/native-event',
      id,
      event
    }, () => {
      void chrome.runtime.lastError;
    });
  }
})();
