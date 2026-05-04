(function initBackground() {
  'use strict';

  const HOST_NAME = 'com.codex.overleaf';
  let port = null;
  const pending = new Map();

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type !== 'codex-overleaf/native-request') {
      return undefined;
    }

    if (!isAllowedOverleafSender(sender)) {
      sendResponse({
        ok: false,
        error: {
          code: 'forbidden_sender',
          message: 'Native requests are only accepted from Overleaf project pages.'
        }
      });
      return undefined;
    }

    if (message.payload?.method === 'codex.cancel') {
      try {
        const id = sendNativeCancel(message.payload);
        sendResponse({
          ok: true,
          result: {
            sent: true,
            id
          }
        });
      } catch (error) {
        sendResponse({
          ok: false,
          error: {
            code: 'native_connection_failed',
            message: error.message
          }
        });
      }
      return undefined;
    }

    sendNativeRequest(message.payload, sender)
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

  function sendNativeCancel(payload) {
    const nativePort = ensurePort();
    const id = payload.id || crypto.randomUUID();
    nativePort.postMessage({ ...payload, id });
    return id;
  }

  function ensurePort() {
    if (port) {
      return port;
    }

    port = chrome.runtime.connectNative(HOST_NAME);
    port.onMessage.addListener(message => {
      const id = message?.id;
      if (!pending.has(id)) {
        if (message?.ok === false) {
          resolveUnmatchedNativeError(message);
        }
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

  function resolveUnmatchedNativeError(message) {
    if (pending.size === 1) {
      const [pendingId, pendingRequest] = pending.entries().next().value;
      pendingRequest.resolve({
        ...message,
        id: pendingId
      });
      pending.delete(pendingId);
      return;
    }

    const ambiguousRequests = Array.from(pending.entries());
    pending.clear();
    for (const [pendingId, pendingRequest] of ambiguousRequests) {
      pendingRequest.resolve({
        id: pendingId,
        ok: false,
        error: {
          code: 'ambiguous_native_error',
          message: 'Native host returned an error without a request id while multiple requests were pending.',
          nativeError: message.error || message
        }
      });
    }
  }

  function isAllowedOverleafSender(sender) {
    if (!sender?.tab) {
      const extensionUrl = chrome.runtime.getURL('');
      const senderUrl = sender?.url || '';
      return sender?.id === chrome.runtime.id && senderUrl.startsWith(extensionUrl);
    }

    const senderUrl = sender.tab?.url || '';
    try {
      const url = new URL(senderUrl);
      return url.protocol === 'https:' && (
        url.hostname === 'www.overleaf.com' || url.hostname === 'overleaf.com'
      );
    } catch (_error) {
      return false;
    }
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
