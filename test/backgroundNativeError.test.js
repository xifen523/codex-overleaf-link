const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const compatibility = require('../extension/src/shared/compatibility');
const backgroundPath = path.join(__dirname, '../extension/src/background.js');
const COMPATIBILITY_REQUIRED_METHODS = [
  'codex.run',
  'task.run',
  'task.confirm',
  'mirror.sync',
  'mirror.patchFiles',
  'codex.history.clearPlugin'
];
const RECOVERABLE_METHODS = [
  'bridge.ping',
  'mirror.status',
  'codex.models',
  'codex.cancel'
];

function readBackground() {
  return fs.readFileSync(backgroundPath, 'utf8');
}

test('background resolves active requests when native reports a framing error without an id', () => {
  const background = readBackground();

  assert.match(background, /resolveUnmatchedNativeError/);
  assert.match(background, /message\?\.ok === false/);
  assert.match(background, /pending\.size === 1/);
  assert.match(background, /pendingRequest\.resolve\(\{\s*\.\.\.message,\s*id:\s*pendingId\s*\}\)/);
});

test('background validates Overleaf senders before forwarding native requests', () => {
  const background = readBackground();

  assert.match(background, /function isAllowedOverleafSender\(/);
  assert.match(background, /chrome\.runtime\.getURL\(''\)/);
  assert.match(background, /sender\?\.id === chrome\.runtime\.id/);
  assert.match(background, /sender\.tab\?\.url/);
  assert.match(background, /www\.overleaf\.com/);
  assert.match(background, /forbidden_sender/);
});

test('background routes multi-request unmatched native errors through retry policy', () => {
  const background = readBackground();

  assert.match(background, /pending\.size === 1/);
  assert.match(background, /handlePortDisconnect\(getUnmatchedNativeErrorMessage\(message\)\)/);
  assert.doesNotMatch(background, /ambiguous_native_error/);
  assert.doesNotMatch(background, /for \(const \[pendingId, pendingRequest\] of pending\.entries\(\)\)/);
});

test('background classifies native request retry safety by method', () => {
  const background = readBackground();

  assert.match(background, /function getNativeRetryClass\(method\)/);
  assert.match(background, /case 'bridge\.ping':[\s\S]*?return 'safe_read_retry'/);
  assert.match(background, /case 'mirror\.status':[\s\S]*?return 'safe_read_retry'/);
  assert.match(background, /case 'mirror\.sync':[\s\S]*?return 'safe_sync_retry'/);
  assert.match(background, /case 'mirror\.patchFiles':[\s\S]*?return 'safe_sync_retry'/);
  assert.match(background, /case 'codex\.cancel':[\s\S]*?return 'best_effort'/);
  assert.match(background, /case 'codex\.run':[\s\S]*?return 'no_silent_retry'/);
  assert.match(background, /case 'task\.run':[\s\S]*?return 'no_silent_retry'/);
});

test('background loads the shared compatibility helper before handling native requests', () => {
  const background = readBackground();

  assert.match(background, /importScripts\(['"]shared\/compatibility\.js['"]\)/);
  assert.match(background, /CodexOverleafCompatibility\.isNativeMethodAllowed/);
});

test('background uses the compatibility policy for required and recoverable methods', () => {
  const background = readBackground();

  for (const method of COMPATIBILITY_REQUIRED_METHODS) {
    assert.equal(compatibility.isNativeMethodAllowed(method, 'native_too_old'), false, `${method} should require compatible native`);
    assert.equal(compatibility.isNativeMethodAllowed(method, 'ok'), true, `${method} should be allowed when compatible`);
    assert.match(background, new RegExp(method.replace(/[.]/g, '\\.')));
  }

  for (const method of RECOVERABLE_METHODS) {
    const expected = method === 'codex.models'
      ? compatibility.isNativeMethodAllowed(method, 'native_too_old')
      : compatibility.isNativeMethodAllowed(method, 'native_missing');
    assert.equal(expected, true, `${method} should remain available for recovery or read-only fallback`);
    assert.match(background, new RegExp(method.replace(/[.]/g, '\\.')));
  }
});

test('background tracks per-request native retry state and handles disconnect centrally', () => {
  const background = readBackground();

  assert.match(background, /retryClass:\s*getNativeRetryClass\(request\.method\)/);
  assert.match(background, /retryCount:\s*0/);
  assert.match(background, /finalResponseReceived:\s*false/);
  assert.match(background, /eventForwarded:\s*false/);
  assert.match(background, /pendingRequest\.finalResponseReceived\s*=\s*true/);
  assert.match(background, /function handlePortDisconnect\(errorMessage\)/);
  assert.match(background, /function canRetryNativeRequest\(pendingRequest\)/);
});

test('background blocks side-effecting native requests with non-ok compatibility evidence before posting', async () => {
  const harness = loadBackgroundHarness();
  const sender = {
    tab: {
      id: 101,
      url: 'https://www.overleaf.com/project/abc123'
    }
  };

  const runResponse = harness.sendNative({
    id: 'run-incompatible',
    method: 'codex.run',
    params: {
      task: 'write',
      nativeCompatibility: {
        status: 'native_too_old',
        installCommand: compatibility.buildInstallCommand()
      }
    }
  }, sender);

  assert.equal(harness.ports.length, 0);

  const blockedRun = await settleWithin(runResponse);
  assert.equal(blockedRun.ok, false);
  assert.equal(blockedRun.error.code, 'native_incompatible');
  assert.match(blockedRun.error.message, /Native host/i);
});

test('background retries safe status after disconnect while failing codex.run without restart', async () => {
  const harness = loadBackgroundHarness();
  const sender = {
    tab: {
      id: 101,
      url: 'https://www.overleaf.com/project/abc123'
    }
  };

  const statusResponse = harness.sendNative(
    { id: 'status-1', method: 'mirror.status', params: { projectId: 'abc123' } },
    sender
  );
  const runResponse = harness.sendNative(
    { id: 'run-1', method: 'codex.run', params: { task: 'write' } },
    sender
  );

  assert.equal(harness.ports.length, 1);
  assert.deepEqual(
    harness.ports[0].messages.map(message => message.id),
    ['status-1', 'run-1']
  );

  harness.ports[0].disconnect('Native host disconnected');

  assert.equal(harness.ports.length, 2);
  assert.deepEqual(
    harness.ports[1].messages.map(message => `${message.id}:${message.method}`),
    ['status-1:mirror.status']
  );

  const interruptedRun = await runResponse;
  assert.equal(interruptedRun.ok, false);
  assert.equal(interruptedRun.error.code, 'native_execution_interrupted');
  assert.equal(
    interruptedRun.error.message,
    'Native host disconnected while an execution request was running. The request was not retried to avoid repeating side effects.'
  );

  harness.ports[1].emitMessage({
    id: 'status-1',
    ok: true,
    result: {
      status: 'ready'
    }
  });

  const retriedStatus = await statusResponse;
  assert.equal(retriedStatus.id, 'status-1');
  assert.equal(retriedStatus.ok, true);
  assert.equal(retriedStatus.result.status, 'ready');
});

test('background retries a safe request once when cached native port postMessage throws', async () => {
  const harness = loadBackgroundHarness({
    configurePort(port, index) {
      if (index === 0) {
        port.failNextPostMessage('Stale native port');
      }
    }
  });
  const sender = {
    tab: {
      id: 101,
      url: 'https://www.overleaf.com/project/abc123'
    }
  };

  const statusResponse = harness.sendNative(
    { id: 'status-stale', method: 'mirror.status', params: { projectId: 'abc123' } },
    sender
  );

  assert.equal(harness.ports.length, 2);
  assert.deepEqual(harness.ports[0].messages, []);
  assert.deepEqual(
    harness.ports[1].messages.map(message => `${message.id}:${message.method}`),
    ['status-stale:mirror.status']
  );

  harness.ports[1].emitMessage({
    id: 'status-stale',
    ok: true,
    result: {
      status: 'ready'
    }
  });

  const retriedStatus = await statusResponse;
  assert.equal(retriedStatus.id, 'status-stale');
  assert.equal(retriedStatus.ok, true);
  assert.equal(retriedStatus.result.status, 'ready');
});

test('background does not retry execution requests when native postMessage throws', async () => {
  const harness = loadBackgroundHarness({
    configurePort(port, index) {
      if (index === 0) {
        port.failNextPostMessage('Stale native port');
      }
    }
  });
  const sender = {
    tab: {
      id: 101,
      url: 'https://www.overleaf.com/project/abc123'
    }
  };

  const runResponse = harness.sendNative(
    { id: 'run-stale', method: 'codex.run', params: { task: 'write' } },
    sender
  );

  assert.equal(harness.ports.length, 1);
  assert.deepEqual(harness.ports[0].messages, []);

  const interruptedRun = await runResponse;
  assert.equal(interruptedRun.ok, false);
  assert.equal(interruptedRun.error.code, 'native_execution_interrupted');
});

test('background scopes no-id native errors through per-request retry policy', async () => {
  const harness = loadBackgroundHarness();
  const sender = {
    tab: {
      id: 101,
      url: 'https://www.overleaf.com/project/abc123'
    }
  };

  const statusResponse = harness.sendNative(
    { id: 'status-bad-frame', method: 'mirror.status', params: { projectId: 'abc123' } },
    sender
  );
  const runResponse = harness.sendNative(
    { id: 'run-bad-frame', method: 'codex.run', params: { task: 'write' } },
    sender
  );

  assert.deepEqual(
    harness.ports[0].messages.map(message => `${message.id}:${message.method}`),
    ['status-bad-frame:mirror.status', 'run-bad-frame:codex.run']
  );

  harness.ports[0].emitMessage({
    ok: false,
    error: {
      code: 'bad_frame',
      message: 'Native host returned an error without a request id.'
    }
  });

  assert.equal(harness.ports.length, 2);
  assert.deepEqual(
    harness.ports[1].messages.map(message => `${message.id}:${message.method}`),
    ['status-bad-frame:mirror.status']
  );

  const interruptedRun = await runResponse;
  assert.equal(interruptedRun.ok, false);
  assert.equal(interruptedRun.error.code, 'native_execution_interrupted');

  harness.ports[1].emitMessage({
    id: 'status-bad-frame',
    ok: true,
    result: {
      status: 'ready'
    }
  });

  const retriedStatus = await statusResponse;
  assert.equal(retriedStatus.id, 'status-bad-frame');
  assert.equal(retriedStatus.ok, true);
  assert.equal(retriedStatus.result.status, 'ready');
});

test('background ignores explicit unknown native error ids for a single pending request', async () => {
  const harness = loadBackgroundHarness();
  const sender = {
    tab: {
      id: 101,
      url: 'https://www.overleaf.com/project/abc123'
    }
  };

  const statusResponse = harness.sendNative(
    { id: 'status-known', method: 'mirror.status', params: { projectId: 'abc123' } },
    sender
  );

  harness.ports[0].emitMessage({
    id: 'unknown',
    ok: false,
    error: {
      code: 'cancel_failed',
      message: 'Cancel request was not found.'
    }
  });

  await assert.rejects(
    settleWithin(statusResponse),
    /Timed out waiting for native response to settle/
  );
  assert.equal(harness.ports.length, 1);

  harness.ports[0].emitMessage({
    id: 'status-known',
    ok: true,
    result: {
      status: 'ready'
    }
  });

  const status = await statusResponse;
  assert.equal(status.ok, true);
  assert.equal(status.result.status, 'ready');
});

test('background ignores explicit unknown native error ids while multiple requests are pending', async () => {
  const harness = loadBackgroundHarness();
  const sender = {
    tab: {
      id: 101,
      url: 'https://www.overleaf.com/project/abc123'
    }
  };

  const statusResponse = harness.sendNative(
    { id: 'status-known-multi', method: 'mirror.status', params: { projectId: 'abc123' } },
    sender
  );
  const runResponse = harness.sendNative(
    { id: 'run-known-multi', method: 'codex.run', params: { task: 'write' } },
    sender
  );

  harness.ports[0].emitMessage({
    id: 'unknown',
    ok: false,
    error: {
      code: 'cancel_failed',
      message: 'Cancel request was not found.'
    }
  });

  await assert.rejects(
    settleWithin(statusResponse),
    /Timed out waiting for native response to settle/
  );
  await assert.rejects(
    settleWithin(runResponse),
    /Timed out waiting for native response to settle/
  );
  assert.equal(harness.ports.length, 1);
  assert.deepEqual(
    harness.ports[0].messages.map(message => `${message.id}:${message.method}`),
    ['status-known-multi:mirror.status', 'run-known-multi:codex.run']
  );

  harness.ports[0].emitMessage({
    id: 'status-known-multi',
    ok: true,
    result: {
      status: 'ready'
    }
  });
  harness.ports[0].emitMessage({
    id: 'run-known-multi',
    ok: false,
    error: {
      code: 'native_execution_interrupted',
      message: 'Native host disconnected while an execution request was running.'
    }
  });

  const status = await statusResponse;
  const run = await runResponse;
  assert.equal(status.ok, true);
  assert.equal(status.result.status, 'ready');
  assert.equal(run.ok, false);
  assert.equal(run.error.code, 'native_execution_interrupted');
});

test('background retries all safe requests attached to a port when a later postMessage throws', async () => {
  const harness = loadBackgroundHarness({
    configurePort(port, index) {
      if (index === 0) {
        port.failPostMessageWhen(message => message.id === 'status-new');
      }
    }
  });
  const sender = {
    tab: {
      id: 101,
      url: 'https://www.overleaf.com/project/abc123'
    }
  };

  const oldStatusResponse = harness.sendNative(
    { id: 'status-old', method: 'mirror.status', params: { projectId: 'abc123' } },
    sender
  );
  const newStatusResponse = harness.sendNative(
    { id: 'status-new', method: 'mirror.status', params: { projectId: 'abc123' } },
    sender
  );

  assert.equal(harness.ports.length, 2);
  assert.deepEqual(
    harness.ports[0].messages.map(message => `${message.id}:${message.method}`),
    ['status-old:mirror.status']
  );
  assert.deepEqual(
    harness.ports[1].messages.map(message => `${message.id}:${message.method}`),
    ['status-old:mirror.status', 'status-new:mirror.status']
  );

  harness.ports[1].emitMessage({
    id: 'status-old',
    ok: true,
    result: {
      status: 'old-ready'
    }
  });
  harness.ports[1].emitMessage({
    id: 'status-new',
    ok: true,
    result: {
      status: 'new-ready'
    }
  });

  const oldStatus = await oldStatusResponse;
  const newStatus = await newStatusResponse;
  assert.equal(oldStatus.result.status, 'old-ready');
  assert.equal(newStatus.result.status, 'new-ready');
});

test('background fails older execution request when later safe postMessage throws on same port', async () => {
  const harness = loadBackgroundHarness({
    configurePort(port, index) {
      if (index === 0) {
        port.failPostMessageWhen(message => message.id === 'status-after-run');
      }
    }
  });
  const sender = {
    tab: {
      id: 101,
      url: 'https://www.overleaf.com/project/abc123'
    }
  };

  const runResponse = harness.sendNative(
    { id: 'run-old', method: 'codex.run', params: { task: 'write' } },
    sender
  );
  const statusResponse = harness.sendNative(
    { id: 'status-after-run', method: 'mirror.status', params: { projectId: 'abc123' } },
    sender
  );

  assert.equal(harness.ports.length, 2);
  assert.deepEqual(
    harness.ports[0].messages.map(message => `${message.id}:${message.method}`),
    ['run-old:codex.run']
  );
  assert.deepEqual(
    harness.ports[1].messages.map(message => `${message.id}:${message.method}`),
    ['status-after-run:mirror.status']
  );

  const interruptedRun = await settleWithin(runResponse);
  assert.equal(interruptedRun.ok, false);
  assert.equal(interruptedRun.error.code, 'native_execution_interrupted');

  harness.ports[1].emitMessage({
    id: 'status-after-run',
    ok: true,
    result: {
      status: 'ready'
    }
  });

  const retriedStatus = await statusResponse;
  assert.equal(retriedStatus.ok, true);
  assert.equal(retriedStatus.result.status, 'ready');
});

test('background fails pending codex.run when cancel postMessage throws on the same stale port', async () => {
  const harness = loadBackgroundHarness({
    configurePort(port, index) {
      if (index === 0) {
        port.failPostMessageWhen(message => message.method === 'codex.cancel');
      }
    }
  });
  const sender = {
    tab: {
      id: 101,
      url: 'https://www.overleaf.com/project/abc123'
    }
  };

  const runResponse = harness.sendNative(
    { id: 'run-cancel-target', method: 'codex.run', params: { task: 'write' } },
    sender
  );
  const cancelResponse = await harness.sendNative(
    { id: 'cancel-stale', method: 'codex.cancel', params: { requestId: 'run-cancel-target' } },
    sender
  );

  assert.equal(cancelResponse.ok, false);
  assert.equal(cancelResponse.error.code, 'native_connection_failed');
  assert.equal(harness.ports.length, 1);
  assert.deepEqual(
    harness.ports[0].messages.map(message => `${message.id}:${message.method}`),
    ['run-cancel-target:codex.run']
  );

  const interruptedRun = await settleWithin(runResponse);
  assert.equal(interruptedRun.ok, false);
  assert.equal(interruptedRun.error.code, 'native_execution_interrupted');

  const postedRunCount = harness.ports
    .flatMap(port => port.messages)
    .filter(message => message.method === 'codex.run').length;
  assert.equal(postedRunCount, 1);
});

test('background retries pending safe request when cancel postMessage throws on the same stale port', async () => {
  const harness = loadBackgroundHarness({
    configurePort(port, index) {
      if (index === 0) {
        port.failPostMessageWhen(message => message.method === 'codex.cancel');
      }
    }
  });
  const sender = {
    tab: {
      id: 101,
      url: 'https://www.overleaf.com/project/abc123'
    }
  };

  const statusResponse = harness.sendNative(
    { id: 'status-before-cancel', method: 'mirror.status', params: { projectId: 'abc123' } },
    sender
  );
  const cancelResponse = await harness.sendNative(
    { id: 'cancel-stale-safe', method: 'codex.cancel', params: { requestId: 'run-id' } },
    sender
  );

  assert.equal(cancelResponse.ok, false);
  assert.equal(cancelResponse.error.code, 'native_connection_failed');
  assert.equal(harness.ports.length, 2);
  assert.deepEqual(
    harness.ports[0].messages.map(message => `${message.id}:${message.method}`),
    ['status-before-cancel:mirror.status']
  );
  assert.deepEqual(
    harness.ports[1].messages.map(message => `${message.id}:${message.method}`),
    ['status-before-cancel:mirror.status']
  );

  harness.ports[1].emitMessage({
    id: 'status-before-cancel',
    ok: true,
    result: {
      status: 'ready'
    }
  });

  const retriedStatus = await statusResponse;
  assert.equal(retriedStatus.ok, true);
  assert.equal(retriedStatus.result.status, 'ready');
});

function loadBackgroundHarness(options = {}) {
  const ports = [];
  let onMessageListener = null;
  let uuidCounter = 0;

  const chrome = {
    runtime: {
      id: 'extension-id',
      lastError: null,
      getURL(pathname) {
        return `chrome-extension://extension-id/${pathname}`;
      },
      onMessage: {
        addListener(listener) {
          onMessageListener = listener;
        }
      },
      connectNative() {
        const port = createNativePort(chrome);
        ports.push(port);
        if (typeof options.configurePort === 'function') {
          options.configurePort(port, ports.length - 1);
        }
        return port;
      }
    },
    tabs: {
      sendMessage(_tabId, _message, callback) {
        if (typeof callback === 'function') {
          callback();
        }
      }
    }
  };

  const sandbox = {
    chrome,
    crypto: {
      randomUUID() {
        uuidCounter += 1;
        return `uuid-${uuidCounter}`;
      }
    },
    importScripts(...scriptPaths) {
      for (const scriptPath of scriptPaths) {
        if (scriptPath === 'shared/compatibility.js') {
          sandbox.CodexOverleafCompatibility = compatibility;
          continue;
        }
        throw new Error(`Unexpected importScripts path: ${scriptPath}`);
      }
    },
    URL
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(readBackground(), sandbox);

  assert.equal(typeof onMessageListener, 'function');

  return {
    ports,
    sendNative(payload, sender) {
      return new Promise(resolve => {
        onMessageListener({
          type: 'codex-overleaf/native-request',
          payload
        }, sender, resolve);
      });
    }
  };
}

function createNativePort(chrome) {
  const messageListeners = [];
  const disconnectListeners = [];
  const postMessageFailures = [];
  const postMessageFailurePredicates = [];

  return {
    messages: [],
    onMessage: {
      addListener(listener) {
        messageListeners.push(listener);
      }
    },
    onDisconnect: {
      addListener(listener) {
        disconnectListeners.push(listener);
      }
    },
    postMessage(message) {
      if (postMessageFailures.length > 0) {
        throw postMessageFailures.shift();
      }
      const failureIndex = postMessageFailurePredicates.findIndex(predicate => predicate(message));
      if (failureIndex !== -1) {
        postMessageFailurePredicates.splice(failureIndex, 1);
        throw new Error('Native postMessage failed');
      }
      this.messages.push(message);
    },
    failNextPostMessage(message = 'Native postMessage failed') {
      postMessageFailures.push(new Error(message));
    },
    failPostMessageWhen(predicate) {
      postMessageFailurePredicates.push(predicate);
    },
    emitMessage(message) {
      for (const listener of messageListeners) {
        listener(message);
      }
    },
    disconnect(message = 'Native host disconnected') {
      chrome.runtime.lastError = { message };
      for (const listener of disconnectListeners) {
        listener();
      }
      chrome.runtime.lastError = null;
    }
  };
}

function settleWithin(promise) {
  return Promise.race([
    promise,
    new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error('Timed out waiting for native response to settle.')), 20);
    })
  ]);
}
