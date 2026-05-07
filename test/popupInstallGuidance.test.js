const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const compatibility = require('../extension/src/shared/compatibility');

test('popup sends compatibility-aware bridge ping params', async () => {
  let sentMessage = null;
  await loadPopupHarness({
    nativeResponse: compatibleNativeResponse(),
    onSendMessage(message) {
      sentMessage = message;
    }
  });

  assert.equal(sentMessage?.payload?.method, 'bridge.ping');
  assert.deepEqual(
    JSON.parse(JSON.stringify(sentMessage?.payload?.params)),
    compatibility.buildBridgePingParams({ version: compatibility.BUILD_TARGET_VERSION })
  );
});

test('popup treats an old native response as update-required instead of connected', async () => {
  const harness = await loadPopupHarness({
    nativeResponse: oldNativeResponse()
  });

  assert.equal(harness.elements.nativeInstall.hidden, false);
  assert.match(harness.elements.status.textContent, /Native host update required/i);
  assert.doesNotMatch(harness.elements.status.textContent, /connected/i);
  assert.equal(harness.elements.installCommand.textContent, compatibility.buildInstallCommand());
});

test('popup reflects the active Overleaf panel state and toggles it', async () => {
  const tabMessages = [];
  const harness = await loadPopupHarness({
    nativeResponse: compatibleNativeResponse(),
    activeTab: {
      id: 42,
      url: 'https://www.overleaf.com/project/example'
    },
    onTabMessage(_tabId, message) {
      tabMessages.push(message);
      if (message.type === 'codex-overleaf/get-panel-state') {
        return { ok: true, open: true };
      }
      if (message.type === 'codex-overleaf/toggle-panel') {
        return { ok: true, open: false };
      }
      return { ok: false };
    }
  });

  assert.equal(harness.elements.button.textContent, 'Close panel in Overleaf');
  assert.match(harness.elements.status.textContent, /Panel is open/i);

  await harness.elements.button.click();

  assert.deepEqual(tabMessages.map(message => message.type), [
    'codex-overleaf/get-panel-state',
    'codex-overleaf/toggle-panel'
  ]);
  assert.equal(harness.closed, true);
});

test('popup shows an open action when the active Overleaf panel is closed', async () => {
  const harness = await loadPopupHarness({
    nativeResponse: compatibleNativeResponse(),
    activeTab: {
      id: 43,
      url: 'https://overleaf.com/project/example'
    },
    onTabMessage(_tabId, message) {
      if (message.type === 'codex-overleaf/get-panel-state') {
        return { ok: true, open: false };
      }
      return { ok: true, open: true };
    }
  });

  assert.equal(harness.elements.button.textContent, 'Open panel in Overleaf');
  assert.match(harness.elements.status.textContent, /Panel is closed/i);
});

function compatibleNativeResponse() {
  return {
    ok: true,
    result: {
      host: 'com.codex.overleaf',
      platform: 'darwin',
      version: '0.4.0',
      protocolVersion: 1,
      supportedProtocol: { min: 1, max: 1 },
      capabilities: Object.fromEntries(
        compatibility.REQUIRED_CAPABILITIES.map(capability => [capability, true])
      ),
      minExtensionVersion: '0.4.0',
      environment: {
        codex: { ok: true }
      }
    }
  };
}

function oldNativeResponse() {
  return {
    ok: true,
    result: {
      host: 'com.codex.overleaf',
      platform: 'darwin',
      version: '0.3.0',
      protocolVersion: 1,
      environment: {}
    }
  };
}

async function loadPopupHarness({ nativeResponse, activeTab = null, onSendMessage, onTabMessage } = {}) {
  const compatibilitySource = fs.readFileSync(
    path.join(__dirname, '../extension/src/shared/compatibility.js'),
    'utf8'
  );
  const popupSource = fs.readFileSync(
    path.join(__dirname, '../extension/src/popup.js'),
    'utf8'
  );
  const elements = {
    button: createPopupElement('open-panel'),
    status: createPopupElement('status'),
    nativeInstall: createPopupElement('native-install', { hidden: true }),
    installCommand: createPopupElement('install-command'),
    copyInstallCommand: createPopupElement('copy-install-command')
  };
  const elementById = {
    'open-panel': elements.button,
    status: elements.status,
    'native-install': elements.nativeInstall,
    'install-command': elements.installCommand,
    'copy-install-command': elements.copyInstallCommand
  };

  const harness = { closed: false };
  const sandbox = {
    chrome: {
      runtime: {
        getManifest() {
          return { version: compatibility.BUILD_TARGET_VERSION };
        },
        sendMessage(message) {
          if (typeof onSendMessage === 'function') {
            onSendMessage(message);
          }
          return Promise.resolve(nativeResponse);
        }
      },
      tabs: {
        query() {
          return Promise.resolve(activeTab ? [activeTab] : []);
        },
        sendMessage(tabId, message) {
          if (typeof onTabMessage === 'function') {
            return Promise.resolve(onTabMessage(tabId, message));
          }
          return Promise.resolve();
        }
      }
    },
    crypto: {
      randomUUID() {
        return 'popup-request-id';
      }
    },
    document: {
      getElementById(id) {
        return elementById[id] || null;
      }
    },
    navigator: {
      clipboard: {
        writeText() {
          return Promise.resolve();
        }
      }
    },
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
    console
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  sandbox.close = () => {
    harness.closed = true;
  };

  vm.runInNewContext(`${compatibilitySource}\n${popupSource}`, sandbox);
  await new Promise(resolve => setImmediate(resolve));
  await Promise.resolve();
  await Promise.resolve();

  harness.elements = elements;
  return harness;
}

function createPopupElement(id, options = {}) {
  const listeners = new Map();
  return {
    id,
    hidden: options.hidden === true,
    textContent: '',
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    click() {
      const listener = listeners.get('click');
      return listener?.({ preventDefault() {} });
    }
  };
}
