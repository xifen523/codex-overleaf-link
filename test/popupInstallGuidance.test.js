const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const compatibility = require('../extension/src/shared/compatibility');

test('popup checks native host status and offers a copyable install command', () => {
  const popupHtml = fs.readFileSync(path.join(__dirname, '../extension/popup.html'), 'utf8');
  const popupJs = fs.readFileSync(path.join(__dirname, '../extension/src/popup.js'), 'utf8');
  const compatibilityScriptIndex = popupHtml.indexOf('src/shared/compatibility.js');
  const popupScriptIndex = popupHtml.indexOf('src/popup.js');

  assert.match(popupHtml, /id="native-install"/);
  assert.match(popupHtml, /id="install-command"/);
  assert.match(popupHtml, /id="copy-install-command"/);
  assert.match(popupHtml, /Native host attention required/);
  assert.doesNotMatch(popupHtml, /Native host not connected/);
  assert.ok(compatibilityScriptIndex > -1);
  assert.ok(compatibilityScriptIndex < popupScriptIndex);
  assert.match(popupJs, /const INSTALL_COMMAND/);
  assert.match(popupJs, /bridge\.ping/);
  assert.match(popupJs, /codex-overleaf\/native-request/);
  assert.match(popupJs, /navigator\.clipboard\.writeText\(INSTALL_COMMAND\)/);
  assert.match(popupJs, /showNativeInstallGuide/);
});

test('panel native diagnostics show the same copyable installer guidance when native host is missing', () => {
  const contentScript = fs.readFileSync(
    path.join(__dirname, '../extension/src/contentScript.js'),
    'utf8'
  );
  const css = fs.readFileSync(
    path.join(__dirname, '../extension/styles/panel.css'),
    'utf8'
  );

  assert.match(contentScript, /const INSTALL_COMMAND/);
  assert.match(contentScript, /renderInstallCommand/);
  assert.match(contentScript, /navigator\.clipboard\.writeText\(command\)/);
  assert.match(contentScript, /installCommand:\s*INSTALL_COMMAND/);
  assert.match(css, /\.codex-install-command/);
});

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

async function loadPopupHarness({ nativeResponse, onSendMessage } = {}) {
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
          return Promise.resolve([]);
        },
        sendMessage() {
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
  sandbox.close = () => {};

  vm.runInNewContext(`${compatibilitySource}\n${popupSource}`, sandbox);
  await new Promise(resolve => setImmediate(resolve));
  await Promise.resolve();

  return { elements };
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
