const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('contentScript delegates panel construction to focused content modules', () => {
  const contentScript = read('extension/src/content/contentRuntime.js');

  assert.match(contentScript, /CodexOverleafPanelRenderer/);
  assert.match(contentScript, /CodexOverleafSessionPanel/);
  assert.match(contentScript, /CodexOverleafSettingsPanel/);
  assert.match(contentScript, /CodexOverleafDiagnosticsPanel/);
  assert.match(contentScript, /CodexOverleafComposerPanel/);
  assert.match(contentScript, /PanelRenderer\.create/);
  assert.match(contentScript, /SessionPanel\.create/);
  assert.match(contentScript, /SettingsPanel\.create/);
  assert.match(contentScript, /DiagnosticsPanel\.create/);
  assert.match(contentScript, /ComposerPanel\.create/);
  assert.doesNotMatch(contentScript, /panel\.innerHTML\s*=\s*`/);
});

test('new content modules expose the v1 panel API globals', () => {
  const modules = {
    panelRenderer: read('extension/src/content/panelRenderer.js'),
    sessionPanel: read('extension/src/content/sessionPanel.js'),
    settingsPanel: read('extension/src/content/settingsPanel.js'),
    diagnosticsPanel: read('extension/src/content/diagnosticsPanel.js'),
    composerPanel: read('extension/src/content/composerPanel.js')
  };

  assert.match(modules.panelRenderer, /window\.CodexOverleafPanelRenderer\s*=\s*\{/);
  assert.match(modules.panelRenderer, /create,/);
  assert.match(modules.panelRenderer, /setVisible,/);
  assert.match(modules.panelRenderer, /setBadge,/);

  assert.match(modules.sessionPanel, /window\.CodexOverleafSessionPanel\s*=\s*\{/);
  assert.match(modules.sessionPanel, /create,/);
  assert.match(modules.sessionPanel, /update,/);
  assert.match(modules.sessionPanel, /getDisplayTitle/);

  assert.match(modules.settingsPanel, /window\.CodexOverleafSettingsPanel\s*=\s*\{/);
  assert.match(modules.settingsPanel, /create,/);
  assert.match(modules.settingsPanel, /loadState,/);
  assert.match(modules.settingsPanel, /readState,/);

  assert.match(modules.diagnosticsPanel, /window\.CodexOverleafDiagnosticsPanel\s*=\s*\{/);
  assert.match(modules.diagnosticsPanel, /create,/);
  assert.match(modules.diagnosticsPanel, /updateStatus,/);
  assert.match(modules.diagnosticsPanel, /showResult/);

  assert.match(modules.composerPanel, /window\.CodexOverleafComposerPanel\s*=\s*\{/);
  assert.match(modules.composerPanel, /create,/);
  assert.match(modules.composerPanel, /setState,/);
  assert.match(modules.composerPanel, /setModels/);
});

test('session rows are rendered with DOM APIs in the extracted session panel', () => {
  const sessionPanel = read('extension/src/content/sessionPanel.js');
  const renderRow = sessionPanel.match(/function renderSessionRow\(instance, session\) \{[\s\S]*?\n  function beginRename/)?.[0] || '';

  assert.match(renderRow, /document\.createElement\('button'\)/);
  assert.match(renderRow, /row\.dataset\.active/);
  assert.match(renderRow, /row\.dataset\.running/);
  assert.match(sessionPanel, /callbacks\.onRename/);
  assert.doesNotMatch(renderRow, /innerHTML\s*=/);
});

// Task 1: panel view-state and full-screen settings shell

function buildFakeDocument() {
  // Minimal fake DOM for testing panelRenderer and settingsPanel in Node.
  const elements = [];
  function makeEl(tag) {
    const el = {
      tag,
      id: '',
      className: '',
      innerHTML: '',
      textContent: '',
      hidden: false,
      dataset: {},
      style: { setProperty() {} },
      classList: {
        _classes: new Set(),
        add(...cs) { for (const c of cs) this._classes.add(c); },
        remove(...cs) { for (const c of cs) this._classes.delete(c); },
        toggle(c, force) {
          if (force === undefined) { if (this._classes.has(c)) this._classes.delete(c); else this._classes.add(c); }
          else if (force) this._classes.add(c);
          else this._classes.delete(c);
        },
        contains(c) { return this._classes.has(c); }
      },
      _children: [],
      _listeners: {},
      addEventListener(type, fn) {
        if (!this._listeners[type]) this._listeners[type] = [];
        this._listeners[type].push(fn);
      },
      removeEventListener(type, fn) {
        if (this._listeners[type]) this._listeners[type] = this._listeners[type].filter(f => f !== fn);
      },
      _fire(type, event = {}) {
        for (const fn of (this._listeners[type] || [])) fn(event);
      },
      append(...children) { for (const c of children) { this._children.push(c); c._parent = this; } },
      prepend(...children) { for (const c of children.reverse()) { this._children.unshift(c); c._parent = this; } },
      remove() { if (this._parent) this._parent._children = this._parent._children.filter(c => c !== this); },
      querySelector(sel) { return queryOne(this, sel); },
      querySelectorAll(sel) { return queryAll(this, sel); },
      setAttribute(name, value) { this[`_attr_${name}`] = value; },
      getAttribute(name) { return this[`_attr_${name}`] ?? null; },
      focus() {},
      getBoundingClientRect() { return { width: 380 }; },
      setPointerCapture() {},
      _parent: null
    };
    // Intercept innerHTML setter to build a child tree
    let _innerHTML = '';
    Object.defineProperty(el, 'innerHTML', {
      get() { return _innerHTML; },
      set(html) {
        _innerHTML = html;
        el._children = [];
        parseHtml(el, html, makeEl, elements);
      }
    });
    elements.push(el);
    return el;
  }

  const docEl = makeEl('html');
  const bodyEl = makeEl('body');
  const doc = {
    documentElement: docEl,
    body: bodyEl,
    createElement(tag) { return makeEl(tag); },
    addEventListener() {},
    removeEventListener() {},
    querySelector(sel) { return queryOne(docEl, sel); }
  };
  return { doc, elements };
}

function parseHtml(parent, html, makeEl, registry) {
  // Simple parser: extract top-level tags and their immediate content.
  // Good enough for the flat templates in panelRenderer and settingsPanel.
  const tagRe = /<(\w[\w-]*)([^>]*)>([\s\S]*?)<\/\1>|<(\w[\w-]*)([^>]*)\/>/g;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    const tag = m[1] || m[4];
    const attrs = m[2] || m[5] || '';
    const inner = m[3] || '';
    const el = makeEl(tag);
    registry.push(el);

    // Parse id
    const idM = attrs.match(/id="([^"]*)"/);
    if (idM) el.id = idM[1];

    // Parse class
    const classM = attrs.match(/class="([^"]*)"/);
    if (classM) {
      el.className = classM[1];
      for (const c of classM[1].split(/\s+/).filter(Boolean)) el.classList.add(c);
    }

    // Parse data-* attributes
    const dataRe = /data-([\w-]+)(?:="([^"]*)")?/g;
    let dm;
    while ((dm = dataRe.exec(attrs)) !== null) {
      const key = dm[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      el.dataset[key] = dm[2] || '';
    }

    // Parse type, title, aria-label, aria-expanded, hidden, for, href attrs
    for (const [, aName, aVal] of attrs.matchAll(/(\w[\w-]*)="([^"]*)"/g)) {
      el.setAttribute(aName, aVal);
      if (aName === 'hidden') el.hidden = true;
      if (aName === 'type') el.type = aVal;
      if (aName === 'rows') el.rows = Number(aVal);
      if (aName === 'placeholder') el.placeholder = aVal;
      if (aName === 'checked') el.checked = true;
      if (aName === 'value') el.value = aVal;
    }
    if (/\bhidden\b/.test(attrs) && !attrs.includes('hidden="')) el.hidden = true;

    // Recurse into inner
    if (inner.trim()) {
      parseHtml(el, inner, makeEl, registry);
    }

    parent._children.push(el);
    el._parent = parent;
  }
}

function queryOne(root, sel) {
  // Support: [data-foo], [data-foo="bar"], #id, .class, tag, and simple combinator-free forms.
  const results = queryAll(root, sel);
  return results[0] || null;
}

function queryAll(root, sel) {
  const results = [];
  function walk(el) {
    if (matchesSel(el, sel)) results.push(el);
    for (const child of el._children || []) walk(child);
  }
  for (const child of root._children || []) walk(child);
  return results;
}

function matchesSel(el, sel) {
  // Handle comma-separated selectors
  if (sel.includes(',')) {
    return sel.split(',').some(s => matchesSel(el, s.trim()));
  }
  // Handle descendant combinator (space)
  const parts = sel.trim().split(/\s+/);
  if (parts.length > 1) {
    // Match the last part against el, then check ancestors match earlier parts
    if (!matchesSel(el, parts[parts.length - 1])) return false;
    let ancestor = el._parent;
    for (let i = parts.length - 2; i >= 0; i--) {
      while (ancestor && !matchesSel(ancestor, parts[i])) ancestor = ancestor._parent;
      if (!ancestor) return false;
      ancestor = ancestor._parent;
    }
    return true;
  }

  const s = sel.trim();
  if (s.startsWith('[') && s.endsWith(']')) {
    const inner = s.slice(1, -1);
    if (inner.includes('=')) {
      const eqIdx = inner.indexOf('=');
      const attr = inner.slice(0, eqIdx).trim();
      const val = inner.slice(eqIdx + 1).replace(/^["']|["']$/g, '');
      if (attr.startsWith('data-')) {
        const key = attr.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
        return el.dataset[key] === val;
      }
      return el.getAttribute(attr) === val;
    }
    const attr = inner.trim();
    if (attr.startsWith('data-')) {
      const key = attr.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      return Object.prototype.hasOwnProperty.call(el.dataset, key);
    }
    return el.getAttribute(attr) !== null;
  }
  if (s.startsWith('#')) return el.id === s.slice(1);
  if (s.startsWith('.')) return el.classList.contains(s.slice(1));
  return el.tag === s;
}

test('panelRenderer.create sets data-view="session" and setView updates it', () => {
  const { doc } = buildFakeDocument();
  const fakeWindow = { innerWidth: 1200, addEventListener() {}, removeEventListener() {} };

  // Load the module into a sandboxed context.
  // The IIFE assigns to the `window` parameter directly, so pass fakeWindow as `window`.
  const src = read('extension/src/content/panelRenderer.js');
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', src)(fakeWindow, doc);

  const PanelRenderer = fakeWindow.CodexOverleafPanelRenderer;
  const result = PanelRenderer.create({
    document: doc,
    container: doc.documentElement,
    window: fakeWindow
  });

  assert.equal(result.panelEl.dataset.view, 'session', 'data-view should be "session" after create');

  result.setView('settings');
  assert.equal(result.panelEl.dataset.view, 'settings', 'setView("settings") should update data-view');

  result.setView('session');
  assert.equal(result.panelEl.dataset.view, 'session', 'setView("session") should revert data-view');
});

test('settingsPanel renders [data-settings-back] and no [data-custom-instructions-close]', () => {
  const { doc } = buildFakeDocument();
  const container = doc.createElement('div');
  doc.documentElement._children.push(container);

  // The IIFE assigns to the `window` parameter directly.
  const fakeWindow2 = {};
  const src = read('extension/src/content/settingsPanel.js');
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', src)(fakeWindow2, doc);

  const SettingsPanel = fakeWindow2.CodexOverleafSettingsPanel;
  SettingsPanel.create({ container });

  const backBtn = container.querySelector('[data-settings-back]');
  const closeBtn = container.querySelector('[data-custom-instructions-close]');

  assert.ok(backBtn, 'should render [data-settings-back] button');
  assert.equal(closeBtn, null, 'should NOT render [data-custom-instructions-close]');
});

test('clicking [data-settings-back] fires the onBack callback', () => {
  const { doc } = buildFakeDocument();
  const container = doc.createElement('div');
  doc.documentElement._children.push(container);

  const fakeWindow3 = {};
  const src = read('extension/src/content/settingsPanel.js');
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', src)(fakeWindow3, doc);

  const SettingsPanel = fakeWindow3.CodexOverleafSettingsPanel;
  let called = false;
  SettingsPanel.create({
    container,
    callbacks: { onBack: () => { called = true; } }
  });

  const backBtn = container.querySelector('[data-settings-back]');
  assert.ok(backBtn, 'back button must exist');
  backBtn._fire('click');
  assert.equal(called, true, 'onBack callback should be fired when back button is clicked');
});
