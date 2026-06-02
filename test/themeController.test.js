const assert = require('node:assert/strict');
const test = require('node:test');

const theme = require('../extension/src/content/themeController');

function fakeRoot() {
  return {
    attrs: {},
    setAttribute(key, value) { this.attrs[key] = value; }
  };
}

test('normalizeThemePreference passes valid values and defaults the rest to dark', () => {
  assert.equal(theme.normalizeThemePreference('dark'), 'dark');
  assert.equal(theme.normalizeThemePreference('light'), 'light');
  assert.equal(theme.normalizeThemePreference('auto'), 'auto');
  assert.equal(theme.normalizeThemePreference('neon'), 'dark');
  assert.equal(theme.normalizeThemePreference(undefined), 'dark');
  assert.equal(theme.normalizeThemePreference(null), 'dark');
});

test('resolveTheme returns the explicit theme for dark/light', () => {
  assert.equal(theme.resolveTheme('dark'), 'dark');
  assert.equal(theme.resolveTheme('light'), 'light');
});

test('resolveTheme follows the injected media query for auto', () => {
  assert.equal(theme.resolveTheme('auto', { matches: true }), 'light');
  assert.equal(theme.resolveTheme('auto', { matches: false }), 'dark');
  // Unreadable OS preference (null) falls back to the safe dark default.
  assert.equal(theme.resolveTheme('auto', null), 'dark');
});

test('applyTheme writes the resolved theme onto the panel root and returns it', () => {
  const root = fakeRoot();
  assert.equal(theme.applyTheme('light', root), 'light');
  assert.equal(root.attrs['data-theme'], 'light');

  // auto with an injected light media query resolves + writes light.
  assert.equal(theme.applyTheme('auto', root, { matches: true }), 'light');
  assert.equal(root.attrs['data-theme'], 'light');

  // auto with an injected dark media query resolves + writes dark.
  assert.equal(theme.applyTheme('auto', root, { matches: false }), 'dark');
  assert.equal(root.attrs['data-theme'], 'dark');
});

test('applyTheme tolerates a missing/invalid root', () => {
  assert.equal(theme.applyTheme('light', null), 'light');
  assert.equal(theme.applyTheme('dark', {}), 'dark');
});

test('watchAuto returns a no-op disposer for non-auto preferences', () => {
  const dispose = theme.watchAuto('light', fakeRoot(), () => {});
  assert.equal(typeof dispose, 'function');
  assert.doesNotThrow(() => dispose());
});

test('watchAuto re-applies and notifies on OS scheme change while auto', () => {
  // Stub window.matchMedia with a controllable listener registry.
  let registered = null;
  const fakeMql = {
    matches: false,
    addEventListener(_event, handler) { registered = handler; },
    removeEventListener(_event, handler) { if (registered === handler) registered = null; }
  };
  const priorWindow = global.window;
  global.window = { matchMedia: () => fakeMql };
  try {
    const root = fakeRoot();
    const seen = [];
    const dispose = theme.watchAuto('auto', root, resolved => seen.push(resolved));
    assert.equal(typeof registered, 'function', 'a change listener should be attached for auto');

    // OS flips to light -> handler re-applies and notifies.
    fakeMql.matches = true;
    registered();
    assert.equal(root.attrs['data-theme'], 'light');
    assert.deepEqual(seen, ['light']);

    dispose();
    assert.equal(registered, null, 'disposer detaches the listener');
  } finally {
    global.window = priorWindow;
  }
});
