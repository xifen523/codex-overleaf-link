const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const popupSource = fs.readFileSync(path.join(root, 'extension/src/popup.js'), 'utf8');
const coordinatorSource = fs.readFileSync(path.join(root, 'extension/src/backgroundUpdateCoordinator.js'), 'utf8');
const noticeSource = fs.readFileSync(path.join(root, 'extension/src/content/updateNotice.js'), 'utf8');
const bootstrapSource = fs.readFileSync(path.join(root, 'extension/bootstrap/background.js'), 'utf8');
const bootstrapPopupCss = fs.readFileSync(path.join(root, 'extension/bootstrap/popup.css'), 'utf8');
const bootstrapPopupMarkup = fs.readFileSync(path.join(root, 'extension/bootstrap/popup.html'), 'utf8');
const runtimeManifest = require('../extension/runtime-manifest.json');

test('runtime Popup takes ownership after DOMContentLoaded and exposes explicit consent actions', () => {
  assert.match(popupSource, /DOMContentLoaded/);
  assert.match(popupSource, /section\.replaceChildren/);
  assert.match(popupSource, /codex-overleaf\/consent-update-install/);
  assert.match(popupSource, /codex-overleaf\/consent-update-later/);
  assert.match(popupSource, /codex-overleaf\/consent-update-dismiss/);
  assert.match(popupSource, /role', 'progressbar'/);
  assert.match(popupSource, /aria-valuetext/);
  assert.match(popupSource, /copy\.phase !== copy\.detail/);
  assert.match(popupSource, /if \(showPhaseText\) card\.append\(phase\)/);
  assert.match(popupSource, /consent-update-focus/);
  assert.match(popupSource, /createUpdateSteps/);
  assert.match(popupSource, /This popup may close briefly while the extension restarts/);
  assert.match(bootstrapPopupCss, /body\.consent-update-focus/);
  assert.match(bootstrapPopupCss, /html\s*\{[\s\S]*background:/);
  assert.doesNotMatch(bootstrapPopupCss, /translateY/);
  assert.match(bootstrapPopupMarkup, /data-popup-context/);
  assert.doesNotMatch(popupSource, /navigator\.language/);
});

test('automatic runtime checks are check-only and installation delegates to the guarded bootstrap executor', () => {
  const automaticCheck = coordinatorSource.match(/async function checkOnly[\s\S]*?\n  }\n\n  async function installUpdate/)[0];
  const installUpdate = coordinatorSource.match(/async function installUpdate[\s\S]*?\n  }\n\n  async function postponeUpdate/)[0];
  assert.match(automaticCheck, /'update\.check'/);
  assert.doesNotMatch(automaticCheck, /'update\.(authorize|stage|apply)'/);
  assert.match(coordinatorSource, /'update\.authorize'/);
  assert.match(coordinatorSource, /recoverInterruptedCheck/);
  assert.match(coordinatorSource, /update_check_timeout/);
  assert.match(coordinatorSource, /consent-update-dismiss/);
  assert.match(installUpdate, /CodexOverleafManagedUpdateExecutor/);
  assert.match(installUpdate, /installAuthorizedUpdate/);
  assert.doesNotMatch(installUpdate, /chrome\.runtime\.sendMessage/);
  assert.match(bootstrapSource, /CodexOverleafManagedUpdateExecutor\s*=\s*Object\.freeze/);
  assert.match(bootstrapSource, /installAuthorizedUpdate:\s*\(\)\s*=>\s*checkAndStage\(\{ manual: true \}\)/);
  assert.match(coordinatorSource, /Number\.MAX_SAFE_INTEGER/);
  assert.match(coordinatorSource, /update_revoke_too_late[\s\S]*return getView\(\)/);
});

test('panel notice loads after the idle gate and before content runtime', () => {
  const idle = runtimeManifest.js.indexOf('src/content/updateIdle.js');
  const notice = runtimeManifest.js.indexOf('src/content/updateNotice.js');
  const runtime = runtimeManifest.js.indexOf('src/content/contentRuntime.js');
  assert.equal(idle >= 0 && idle < notice && notice < runtime, true);
  assert.match(noticeSource, /data-update-notice-action/);
  assert.match(noticeSource, /waiting_for_idle/);
  assert.match(noticeSource, /aria-valuetext/);
  assert.match(noticeSource, /options\.getLocale/);
  assert.doesNotMatch(noticeSource, /navigator\.language/);
});
