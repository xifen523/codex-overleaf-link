const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectFiles = require('../extension/src/shared/projectFiles');
const overleafEditor = require('../extension/src/page/overleafEditor');
const reviewing = require('../extension/src/shared/reviewing');
const staleGuard = require('../extension/src/shared/staleGuard');

const pageBridgeSource = fs.readFileSync(
  path.join(__dirname, '../extension/src/pageBridge.js'),
  'utf8'
);
const pageBridgeCapabilityPath = path.join(__dirname, '../extension/src/page/pageBridgeCapability.js');
const pageBridgeCapabilitySource = fs.existsSync(pageBridgeCapabilityPath)
  ? fs.readFileSync(pageBridgeCapabilityPath, 'utf8')
  : '';
const otTextSource = fs.readFileSync(
  path.join(__dirname, '../extension/src/shared/otText.js'),
  'utf8'
);
const overleafCapabilitiesSource = fs.readFileSync(
  path.join(__dirname, '../extension/src/page/overleafCapabilities.js'),
  'utf8'
);
const compileBridgeSource = fs.readFileSync(
  path.join(__dirname, '../extension/src/page/compileBridge.js'),
  'utf8'
);
const overleafEditorSource = fs.readFileSync(
  path.join(__dirname, '../extension/src/page/overleafEditor.js'),
  'utf8'
);
const overleafProjectSnapshotSource = fs.readFileSync(
  path.join(__dirname, '../extension/src/page/overleafProjectSnapshot.js'),
  'utf8'
);
const treeOperationsSource = fs.readFileSync(
  path.join(__dirname, '../extension/src/page/treeOperations.js'),
  'utf8'
);
const snapshotRouterSource = fs.readFileSync(
  path.join(__dirname, '../extension/src/page/snapshotRouter.js'),
  'utf8'
);
const writebackRouterSource = fs.readFileSync(
  path.join(__dirname, '../extension/src/page/writebackRouter.js'),
  'utf8'
);
const overleafRealtimeObserverSource = fs.readFileSync(
  path.join(__dirname, '../extension/src/page/overleafRealtimeObserver.js'),
  'utf8'
);

test('page bridge save-state source requires tri-state positive verification', () => {
  assert.doesNotMatch(pageBridgeSource, /assume saved/i);
  assert.match(pageBridgeSource, /verified_saved/);
  assert.match(pageBridgeSource, /unknown_timeout/);
  assert.match(pageBridgeSource, /unavailable/);
});

test('page bridge capability helper validates tokens and locks initialization', () => {
  assert.notEqual(pageBridgeCapabilitySource, '', 'pageBridgeCapability.js should exist');

  const window = {};
  const context = vm.createContext({ window, globalThis: window });
  vm.runInContext(pageBridgeCapabilitySource, context, { filename: 'pageBridgeCapability.js' });

  const capabilityHelper = window.CodexOverleafPageBridgeCapability;
  assert.equal(capabilityHelper.isValidPageBridgeCapability('short'), false);
  assert.equal(capabilityHelper.isValidPageBridgeCapability(`valid-capability-${'x'.repeat(16)}`), true);
  const unauthorized = capabilityHelper.buildUnauthorizedBridgeResult();
  assert.equal(unauthorized.ok, false);
  assert.equal(unauthorized.code, 'page_bridge_unauthorized');
  assert.equal(unauthorized.error, 'Page bridge request is not authorized');

  const guard = capabilityHelper.create();
  const first = guard.initializePageBridgeCapability('valid-capability-1234567890');
  const repeat = guard.initializePageBridgeCapability('valid-capability-1234567890');
  const conflict = guard.initializePageBridgeCapability('valid-capability-conflict');

  assert.equal(first.ok, true);
  assert.equal(first.alreadyInitialized, undefined);
  assert.equal(repeat.ok, true);
  assert.equal(repeat.alreadyInitialized, true);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, 'page_bridge_capability_already_initialized');
  assert.equal(guard.hasValidPageBridgeCapability('valid-capability-1234567890'), true);
  assert.equal(guard.hasValidPageBridgeCapability('valid-capability-conflict'), false);
});

test('page bridge maps a missing save indicator to unknown timeout', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    files: {
      'main.tex': 'alpha'
    }
  });

  const result = await bridge.call('waitForSaveState', { deadlineMs: 1, pollIntervalMs: 1 });

  assert.equal(result.ok, false);
  assert.equal(result.state, 'unknown_timeout');
  assert.match(result.reason, /save/i);
});

test('page bridge only returns ok true for a verified saved indicator', async () => {
  const verifiedIndicators = [
    'All changes saved',
    'Changes saved',
    'Saved'
  ];

  for (const saveIndicatorText of verifiedIndicators) {
    const bridge = createPageBridgeHarness({
      activePath: 'main.tex',
      saveIndicatorText,
      files: {
        'main.tex': 'alpha'
      }
    });

    const result = await bridge.call('waitForSaveState', { deadlineMs: 1, pollIntervalMs: 1 });

    assert.equal(result.ok, true, saveIndicatorText);
    assert.equal(result.state, 'verified_saved', saveIndicatorText);
  }
});

test('page bridge verifies visible saved text with generic save accessibility labels', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    saveIndicatorText: 'All changes saved',
    saveIndicatorAriaLabel: 'Save project',
    saveIndicatorTitle: 'Save project',
    files: {
      'main.tex': 'alpha'
    }
  });

  const result = await bridge.call('waitForSaveState', { deadlineMs: 1, pollIntervalMs: 1 });

  assert.equal(result.ok, true);
  assert.equal(result.state, 'verified_saved');
});

test('page bridge ignores hidden saved indicators when visible save state is not verified', async () => {
  const hiddenSavedIndicators = [
    { label: 'hidden attribute', node: { text: 'All changes saved', hidden: true } },
    { label: 'aria-hidden', node: { text: 'All changes saved', ariaHidden: true } },
    { label: 'display none', node: { text: 'All changes saved', display: 'none' } },
    { label: 'visibility hidden', node: { text: 'All changes saved', visibility: 'hidden' } },
    { label: 'inert', node: { text: 'All changes saved', inert: true } }
  ];
  const visibleIndicators = [
    'Saving...',
    'Not saved'
  ];

  for (const { label, node } of hiddenSavedIndicators) {
    for (const visibleText of visibleIndicators) {
      const message = `${label}: ${visibleText}`;
      const bridge = createPageBridgeHarness({
        activePath: 'main.tex',
        saveIndicatorNodes: [
          node,
          { text: visibleText }
        ],
        files: {
          'main.tex': 'alpha'
        }
      });

      const result = await bridge.call('waitForSaveState', { deadlineMs: 1, pollIntervalMs: 1 });

      assert.equal(result.ok, false, message);
      assert.equal(result.state, 'unknown_timeout', message);
    }
  }
});

test('page bridge prefers visible unverified save state over hidden stale saved state', async () => {
  for (const visibleText of ['Saving...', 'Not saved']) {
    const bridge = createPageBridgeHarness({
      activePath: 'main.tex',
      saveIndicatorNodes: [
        { text: 'All changes saved', hidden: true },
        { text: visibleText }
      ],
      files: {
        'main.tex': 'alpha'
      }
    });

    const result = await bridge.call('waitForSaveState', { deadlineMs: 1, pollIntervalMs: 1 });

    assert.equal(result.ok, false, visibleText);
    assert.equal(result.state, 'unknown_timeout', visibleText);
  }
});

test('page bridge scans all visible save indicators before verifying saved state', async () => {
  for (const visibleText of ['Not saved', 'Saving...']) {
    const bridge = createPageBridgeHarness({
      activePath: 'main.tex',
      saveIndicatorNodes: [
        { text: 'All changes saved' },
        { text: visibleText }
      ],
      files: {
        'main.tex': 'alpha'
      }
    });

    const result = await bridge.call('waitForSaveState', { deadlineMs: 1, pollIntervalMs: 1 });

    assert.equal(result.ok, false, visibleText);
    assert.equal(result.state, 'unknown_timeout', visibleText);
  }
});

test('page bridge does not verify negative save indicators', async () => {
  const negativeIndicators = [
    'Not saved',
    'Not all changes saved',
    'Changes not saved',
    'Save failed',
    '未保存',
    '保存失败'
  ];

  for (const saveIndicatorText of negativeIndicators) {
    const bridge = createPageBridgeHarness({
      activePath: 'main.tex',
      saveIndicatorText,
      files: {
        'main.tex': 'alpha'
      }
    });

    const result = await bridge.call('waitForSaveState', { deadlineMs: 1, pollIntervalMs: 1 });

    assert.equal(result.ok, false, saveIndicatorText);
    assert.equal(result.state, 'unknown_timeout', saveIndicatorText);
  }
});

test('page bridge allows multiple successful edits to the same fresh file', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    files: {
      'main.tex': 'alpha beta gamma'
    }
  });

  const result = await bridge.call('applyOperations', {
    baseFiles: [
      { path: 'main.tex', content: 'alpha beta gamma' }
    ],
    operations: [
      { type: 'edit', path: 'main.tex', find: 'alpha', replace: 'one' },
      { type: 'edit', path: 'main.tex', find: 'gamma', replace: 'three' }
    ]
  });

  assert.equal(result.ok, true, result.error || JSON.stringify(result));
  assert.equal(result.applied.length, 2);
  assert.equal(result.skipped.length, 0);
  assert.equal(bridge.getFile('main.tex'), 'one beta three');
});

test('page bridge blocks stale file-tree deletes before mutating Overleaf state', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    files: {
      'main.tex': 'user changed'
    }
  });

  const result = await bridge.call('applyOperations', {
    baseFiles: [
      { path: 'main.tex', content: 'base snapshot' }
    ],
    operations: [
      { type: 'delete', path: 'main.tex', reason: 'remove stale file' }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].result.code, 'stale_snapshot');
  assert.equal(bridge.getFile('main.tex'), 'user changed');
});

test('page bridge blocks creates that collide with files added after the task snapshot', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    files: {
      'main.tex': 'base',
      'new.tex': 'user-created content'
    }
  });

  const result = await bridge.call('applyOperations', {
    baseFiles: [
      { path: 'main.tex', content: 'base' }
    ],
    operations: [
      { type: 'create', path: 'new.tex', content: 'codex content' }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].result.code, 'path_created_since_snapshot');
  assert.equal(bridge.getFile('new.tex'), 'user-created content');
});

test('page bridge keeps safe nested operation paths working', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'sections/main.tex',
    files: {
      'sections/main.tex': 'alpha'
    }
  });

  const result = await bridge.call('applyOperations', {
    baseFiles: [
      { path: 'sections/main.tex', content: 'alpha' }
    ],
    operations: [
      { type: 'edit', path: 'sections/main.tex', find: 'alpha', replace: 'beta' }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.applied.length, 1);
  assert.equal(bridge.getFile('sections/main.tex'), 'beta');
});

test('page bridge opens nested same-basename files before writeback', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'test.tex',
    basenameOnlyTreeLabels: true,
    exposeInternalDocTree: true,
    files: {
      'test.tex': 'root alpha',
      'example/test.tex': 'nested alpha'
    }
  });

  const result = await bridge.call('applyOperations', {
    baseFiles: [
      { path: 'test.tex', content: 'root alpha' },
      { path: 'example/test.tex', content: 'nested alpha' }
    ],
    operations: [
      { type: 'edit', path: 'example/test.tex', find: 'nested', replace: 'initialized' }
    ]
  });

  assert.equal(result.ok, true, result.error || JSON.stringify(result));
  assert.equal(result.applied.length, 1);
  assert.equal(result.skipped.length, 0);
  assert.equal(bridge.getFile('test.tex'), 'root alpha');
  assert.equal(bridge.getFile('example/test.tex'), 'initialized alpha');
  assert.equal(bridge.getEditorPath(), 'example/test.tex');
});

test('page bridge rejects spoofed mutating requests without the content capability', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    files: {
      'main.tex': 'alpha beta'
    }
  });

  await bridge.initializeCapability();

  const result = await bridge.spoofCall('applyOperations', {
    baseFiles: [
      { path: 'main.tex', content: 'alpha beta' }
    ],
    operations: [
      { type: 'edit', path: 'main.tex', find: 'alpha', replace: 'omega' }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'page_bridge_unauthorized');
  assert.equal(bridge.getFile('main.tex'), 'alpha beta');
  assert.equal(bridge.getDispatchCount(), 0);
});

test('page bridge rejects spoofed tracked-change rejection and compile requests without the content capability', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    files: {
      'main.tex': 'alpha beta'
    }
  });

  await bridge.initializeCapability();

  for (const [method, params] of [
    ['rejectTrackedChanges', { trackedChanges: [{ key: 'id:change-1', id: 'change-1', path: 'main.tex' }] }],
    ['triggerCompile', {}]
  ]) {
    const result = await bridge.spoofCall(method, params);
    assert.equal(result.ok, false, method);
    assert.equal(result.code, 'page_bridge_unauthorized', method);
  }
});

test('page bridge rejects unsafe project paths before mutating the active file', async () => {
  const unsafePaths = [
    '../x',
    '.',
    '..',
    '/abs.tex',
    'C:\\tmp\\x.tex',
    'folder\\file.tex',
    'folder/%2e%2e/file.tex',
    'bad\u0000name.tex'
  ];

  for (const unsafePath of unsafePaths) {
    const bridge = createPageBridgeHarness({
      activePath: 'main.tex',
      files: {
        'main.tex': 'alpha beta'
      }
    });

    const result = await bridge.call('applyOperations', {
      baseFiles: [
        { path: 'main.tex', content: 'alpha beta' }
      ],
      operations: [
        { type: 'edit', path: unsafePath, find: 'alpha', replace: 'omega' }
      ]
    });

    assert.equal(result.ok, false, unsafePath);
    assert.equal(result.applied.length, 0, unsafePath);
    assert.equal(result.skipped.length, 1, unsafePath);
    assert.equal(result.skipped[0].result.code, 'invalid_project_path', unsafePath);
    assert.equal(bridge.getFile('main.tex'), 'alpha beta', unsafePath);
  }
});

test('page bridge applies edit patches as local CodeMirror changes', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    files: {
      'main.tex': 'alpha beta gamma'
    }
  });

  const result = await bridge.call('applyOperations', {
    baseFiles: [
      { path: 'main.tex', content: 'alpha beta gamma' }
    ],
    operations: [
      {
        type: 'edit',
        path: 'main.tex',
        patches: [
          { from: 6, to: 10, expected: 'beta', insert: 'delta' }
        ]
      }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.applied.length, 1);
  assert.equal(result.applied[0].result.method, 'codemirror-view-patch');
  assert.equal(bridge.getFile('main.tex'), 'alpha delta gamma');
  assert.deepEqual(bridge.getLastDispatchChanges(), [
    { from: 6, to: 10, insert: 'delta' }
  ]);
});

test('page bridge jumpToPosition opens target file and records CodeMirror selection', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    files: {
      'main.tex': 'main file content',
      'refs.bib': '@book{key,\n  title = {Old}\n}'
    }
  });

  const result = await bridge.call('jumpToPosition', {
    path: 'refs.bib',
    from: 7,
    to: 10
  });

  assert.equal(result.ok, true);
  assert.equal(result.method, 'codemirror-view-selection');
  assert.equal(result.path, 'refs.bib');
  assert.equal(result.from, 7);
  assert.equal(result.to, 10);
  assert.equal(bridge.getFile('main.tex'), 'main file content');
  assert.equal(bridge.getFile('refs.bib'), '@book{key,\n  title = {Old}\n}');
  assert.deepEqual(bridge.getLastSelection(), { anchor: 7, head: 10 });
  assert.equal(bridge.getLastDispatchChanges(), null);
});

test('page bridge jumpToPosition selects requested one-based line content', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    files: {
      'main.tex': 'first line\nsecond line\nthird line'
    }
  });

  const result = await bridge.call('jumpToPosition', {
    path: 'main.tex',
    line: 2,
    selectLine: true
  });

  assert.equal(result.ok, true);
  assert.equal(result.method, 'codemirror-view-selection');
  assert.equal(result.path, 'main.tex');
  assert.deepEqual(bridge.getLastSelection(), { anchor: 11, head: 22 });
  assert.equal(bridge.getLastScrollIntoView(), true);
});

test('page bridge jumpToPosition selectLine wins over requested column', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    files: {
      'main.tex': 'first line\nsecond line\nthird line'
    }
  });

  const result = await bridge.call('jumpToPosition', {
    path: 'main.tex',
    line: 2,
    column: 1,
    selectLine: true
  });

  assert.equal(result.ok, true);
  assert.equal(result.method, 'codemirror-view-selection');
  assert.equal(result.path, 'main.tex');
  assert.equal(result.from, 11);
  assert.equal(result.to, 22);
  assert.deepEqual(bridge.getLastSelection(), { anchor: 11, head: 22 });
});

test('page bridge jumpToPosition line_out_of_range includes requested line and lineCount', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    files: {
      'main.tex': 'first line\nsecond line'
    }
  });

  const result = await bridge.call('jumpToPosition', {
    path: 'main.tex',
    line: 3
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'line_out_of_range');
  assert.equal(result.path, 'main.tex');
  assert.equal(result.line, 3);
  assert.equal(result.lineCount, 2);
});

test('page bridge jumpToPosition column_out_of_range includes requested line, column, and lineLength', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    files: {
      'main.tex': 'abc\ndef'
    }
  });

  const result = await bridge.call('jumpToPosition', {
    path: 'main.tex',
    line: 2,
    column: 5
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'column_out_of_range');
  assert.equal(result.path, 'main.tex');
  assert.equal(result.line, 2);
  assert.equal(result.column, 5);
  assert.equal(result.lineLength, 3);
});

test('page bridge jumpToPosition places cursor at requested one-based column', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    files: {
      'main.tex': 'abc\ndef'
    }
  });

  const result = await bridge.call('jumpToPosition', {
    path: 'main.tex',
    line: 2,
    column: 2,
    selectLine: false
  });

  assert.equal(result.ok, true);
  assert.equal(result.method, 'codemirror-view-selection');
  assert.equal(result.path, 'main.tex');
  assert.deepEqual(bridge.getLastSelection(), { anchor: 5, head: 5 });
});

test('page bridge jumpToPosition rejects out-of-range line requests', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    files: {
      'main.tex': 'abc\ndef'
    }
  });

  const result = await bridge.call('jumpToPosition', {
    path: 'main.tex',
    line: 3,
    selectLine: true
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'line_out_of_range');
  assert.equal(result.path, 'main.tex');
  assert.deepEqual(bridge.getLastSelection(), null);
});

test('page bridge jumpToPosition rejects out-of-range column requests', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    files: {
      'main.tex': 'abc\ndef'
    }
  });

  const result = await bridge.call('jumpToPosition', {
    path: 'main.tex',
    line: 2,
    column: 5,
    selectLine: false
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'column_out_of_range');
  assert.equal(result.path, 'main.tex');
  assert.deepEqual(bridge.getLastSelection(), null);
});

test('page bridge jumpToPosition accounts for CRLF line endings when selecting a line', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    files: {
      'main.tex': 'aa\r\nbbb\r\nc'
    }
  });

  const result = await bridge.call('jumpToPosition', {
    path: 'main.tex',
    line: 2,
    selectLine: true
  });

  assert.equal(result.ok, true);
  assert.equal(result.method, 'codemirror-view-selection');
  assert.equal(result.path, 'main.tex');
  assert.deepEqual(bridge.getLastSelection(), { anchor: 4, head: 7 });
});

test('page bridge jumpToPosition selects the last line without a trailing newline', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    files: {
      'main.tex': 'one\ntwo'
    }
  });

  const result = await bridge.call('jumpToPosition', {
    path: 'main.tex',
    line: 2,
    selectLine: true
  });

  assert.equal(result.ok, true);
  assert.equal(result.method, 'codemirror-view-selection');
  assert.equal(result.path, 'main.tex');
  assert.deepEqual(bridge.getLastSelection(), { anchor: 4, head: 7 });
});

test('page bridge jumpToPosition keeps offset ranges unchanged when line mode is absent', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    files: {
      'main.tex': 'abcdef'
    }
  });

  const result = await bridge.call('jumpToPosition', {
    path: 'main.tex',
    from: 2,
    to: 4
  });

  assert.equal(result.ok, true);
  assert.equal(result.method, 'codemirror-view-selection');
  assert.equal(result.path, 'main.tex');
  assert.equal(result.from, 2);
  assert.equal(result.to, 4);
  assert.deepEqual(bridge.getLastSelection(), { anchor: 2, head: 4 });
});

test('page bridge jumpToPosition opens target file before resolving line positions', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    files: {
      'main.tex': 'main file content',
      'refs.bib': 'top\nmiddle\nbottom'
    }
  });

  const result = await bridge.call('jumpToPosition', {
    path: 'refs.bib',
    line: 2,
    selectLine: true
  });

  assert.equal(result.ok, true);
  assert.equal(result.method, 'codemirror-view-selection');
  assert.equal(result.path, 'refs.bib');
  assert.deepEqual(bridge.getLastSelection(), { anchor: 4, head: 10 });
});

test('page bridge jumpToPosition rejects out-of-range offsets without modifying content', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    files: {
      'main.tex': 'alpha'
    }
  });

  const result = await bridge.call('jumpToPosition', {
    path: 'main.tex',
    from: 0,
    to: 99
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'range_out_of_bounds');
  assert.match(result.reason, /out of range/i);
  assert.equal(result.path, 'main.tex');
  assert.equal(bridge.getFile('main.tex'), 'alpha');
  assert.equal(bridge.getDispatchCount(), 0);
  assert.equal(bridge.getLastSelection(), null);
});

test('page bridge jumpToPosition waits for delayed editor document switch before range validation', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    editorSwitchDelayMs: 360,
    files: {
      'main.tex': 'main file content is long enough for a stale selection',
      'refs.bib': 'short'
    }
  });

  const result = await bridge.call('jumpToPosition', {
    path: 'refs.bib',
    from: 0,
    to: 10
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'range_out_of_bounds');
  assert.equal(result.path, 'refs.bib');
  assert.equal(result.length, 5);
  assert.equal(bridge.getDispatchCount(), 0);
  assert.equal(bridge.getLastSelection(), null);
});

test('page bridge jumpToPosition succeeds after delayed switch when target content matches previous file', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    editorSwitchDelayMs: 360,
    files: {
      'main.tex': 'identical content',
      'refs.bib': 'identical content'
    }
  });

  const result = await bridge.call('jumpToPosition', {
    path: 'refs.bib',
    from: 0,
    to: 9
  });

  assert.equal(result.ok, true, result.reason || JSON.stringify(result));
  assert.equal(result.path, 'refs.bib');
  assert.equal(bridge.getEditorPath(), 'refs.bib');
  assert.deepEqual(bridge.getLastSelection(), { anchor: 0, head: 9 });
  assert.equal(bridge.getLastDispatchChanges(), null);
});

test('editor adapter contenteditable fallback does not hard-bound range by rendered DOM text length', () => {
  let focused = false;
  const adapter = overleafEditor.create({
    findEditorContentNode(selector) {
      if (selector === '.cm-content') {
        return {
          innerText: 'visible',
          focus() {
            focused = true;
          }
        };
      }
      return null;
    },
    findEditorTextArea() {
      return null;
    },
    getCodeMirrorEditorView() {
      return null;
    },
    getDeepActiveElement() {
      return null;
    }
  });

  const result = adapter.focusActiveEditorRange(0, 99);

  assert.equal(result.ok, true);
  assert.equal(result.method, 'selection-fallback');
  assert.equal(focused, true);
});

test('page bridge waits for editor document after opening target file before stale guarding patches', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    editorSwitchDelayMs: 360,
    files: {
      'main.tex': 'main file content that must not receive checklist edits',
      'checklist.tex': 'alpha beta gamma'
    }
  });

  const result = await bridge.call('applyOperations', {
    baseFiles: [
      { path: 'main.tex', content: 'main file content that must not receive checklist edits' },
      { path: 'checklist.tex', content: 'alpha beta gamma' }
    ],
    operations: [
      {
        type: 'edit',
        path: 'checklist.tex',
        patches: [
          { from: 6, to: 10, expected: 'beta', insert: 'delta' }
        ]
      }
    ]
  });

  assert.equal(result.ok, true);
  assert.equal(result.applied.length, 1);
  assert.equal(bridge.getFile('main.tex'), 'main file content that must not receive checklist edits');
  assert.equal(bridge.getFile('checklist.tex'), 'alpha delta gamma');
});

test('page bridge rejects stale patch expected text before editing', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    files: {
      'main.tex': 'alpha user gamma'
    }
  });

  const result = await bridge.call('applyOperations', {
    baseFiles: [
      { path: 'main.tex', content: 'alpha user gamma' }
    ],
    operations: [
      {
        type: 'edit',
        path: 'main.tex',
        patches: [
          { from: 6, to: 10, expected: 'beta', insert: 'delta' }
        ]
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped[0].result.code, 'stale_patch');
  assert.equal(bridge.getFile('main.tex'), 'alpha user gamma');
});

test('page bridge rejects edits when Overleaf readback does not match the intended content', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    dispatchApplies: false,
    files: {
      'main.tex': 'alpha beta gamma'
    }
  });

  const result = await bridge.call('applyOperations', {
    baseFiles: [
      { path: 'main.tex', content: 'alpha beta gamma' }
    ],
    operations: [
      {
        type: 'edit',
        path: 'main.tex',
        patches: [
          { from: 6, to: 10, expected: 'beta', insert: 'delta' }
        ]
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].result.code, 'write_verification_failed');
  assert.equal(bridge.getFile('main.tex'), 'alpha beta gamma');
});

test('page bridge can activate Reviewing before write operations', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingOk: false,
    files: {
      'main.tex': 'alpha'
    }
  });

  const result = await bridge.call('ensureReviewing', {});

  assert.equal(result.ok, true);
  assert.equal(result.activated, true);
  assert.equal(bridge.getReviewingClickCount(), 1);
});

test('page bridge can activate Reviewing through the current Editing mode dropdown', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingOk: false,
    reviewingClickBehavior: 'menu',
    reviewingButtonShowsCurrentMode: true,
    files: {
      'main.tex': 'alpha'
    }
  });

  const result = await bridge.call('ensureReviewing', {});

  assert.equal(result.ok, true, result.reason || JSON.stringify(result));
  assert.equal(result.activated, true);
  assert.equal(bridge.getReviewingClickCount(), 1);
  assert.equal(bridge.getModeOptionClickCount(), 1);
  assert.equal(bridge.isReviewingActive(), true);
});

test('page bridge can activate Reviewing from a roleless dropdown item', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingOk: false,
    reviewingClickBehavior: 'menu',
    reviewingButtonShowsCurrentMode: true,
    modeOptionRole: '',
    modeOptionClassName: 'dropdown-item',
    files: {
      'main.tex': 'alpha'
    }
  });

  const result = await bridge.call('ensureReviewing', {});

  assert.equal(result.ok, true, result.reason || JSON.stringify(result));
  assert.equal(bridge.getReviewingClickCount(), 1);
  assert.equal(bridge.getModeOptionClickCount(), 1);
  assert.equal(bridge.isReviewingActive(), true);
});

test('page bridge does not treat internal Reviewing permission flags as active write-safe mode', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingOk: false,
    reviewingClickActivates: false,
    reviewingClickBehavior: 'noop',
    reviewingButtonShowsCurrentMode: true,
    internalReviewingState: true,
    files: {
      'main.tex': 'alpha'
    }
  });

  const result = await bridge.call('ensureReviewing', { waitMs: 0 });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'reviewing_not_enabled');
  assert.equal(result.activated, undefined);
  assert.equal(bridge.getReviewingClickCount(), 1);
  assert.equal(bridge.isReviewingActive(), false);
});

test('page bridge blocks required Reviewing writes at the final apply boundary', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingOk: false,
    reviewingClickBehavior: 'noop',
    reviewingButtonShowsCurrentMode: true,
    internalReviewingState: true,
    files: {
      'main.tex': 'alpha beta'
    }
  });

  const result = await bridge.call('applyOperations', {
    requireReviewing: true,
    baseFiles: [
      { path: 'main.tex', content: 'alpha beta' }
    ],
    operations: [
      { type: 'edit', path: 'main.tex', find: 'alpha', replace: 'omega' }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].result.code, 'reviewing_not_enabled');
  assert.equal(bridge.getFile('main.tex'), 'alpha beta');
});

test('page bridge switches to Editing before untracked write operations', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingOk: true,
    reviewingClickBehavior: 'menu',
    reviewingButtonShowsCurrentMode: true,
    files: {
      'main.tex': 'alpha beta'
    }
  });

  const result = await bridge.call('applyOperations', {
    requireEditing: true,
    baseFiles: [
      { path: 'main.tex', content: 'alpha beta' }
    ],
    operations: [
      { type: 'edit', path: 'main.tex', find: 'alpha', replace: 'omega' }
    ]
  });

  assert.equal(result.ok, true, result.error || JSON.stringify(result));
  assert.equal(bridge.getFile('main.tex'), 'omega beta');
  assert.equal(bridge.getReviewingClickCount(), 1);
  assert.equal(bridge.getModeOptionClickCount(), 1);
  assert.equal(bridge.isReviewingActive(), false);
  assert.equal(result.reviewingPolicy.policy, 'editing-write');
  assert.equal(result.reviewingPolicy.disabled, true);
  assert.equal(result.reviewingPolicy.leftEditing, true);
});

test('page bridge blocks untracked writes when Editing cannot be confirmed', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingOk: true,
    reviewingClickBehavior: 'noop',
    reviewingButtonShowsCurrentMode: true,
    files: {
      'main.tex': 'alpha beta'
    }
  });

  const result = await bridge.call('applyOperations', {
    requireEditing: true,
    baseFiles: [
      { path: 'main.tex', content: 'alpha beta' }
    ],
    operations: [
      { type: 'edit', path: 'main.tex', find: 'alpha', replace: 'omega' }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].result.code, 'editing_not_confirmed');
  assert.equal(bridge.getFile('main.tex'), 'alpha beta');
  assert.equal(bridge.isReviewingActive(), true);
});

test('page bridge rejects write-safety confirmation when Reviewing click does not activate', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingOk: false,
    reviewingClickActivates: false,
    files: {
      'main.tex': 'alpha'
    }
  });

  const result = await bridge.call('ensureReviewing', { waitMs: 0 });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'reviewing_not_enabled');
  assert.equal(bridge.getReviewingClickCount(), 1);
});

test('page bridge applies undo operations with Reviewing disabled and leaves Editing active', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingClickBehavior: 'toggle',
    reviewingOk: true,
    files: {
      'main.tex': 'alpha delta gamma'
    }
  });

  const result = await bridge.call('applyOperations', {
    baseFiles: [
      { path: 'main.tex', content: 'alpha delta gamma' }
    ],
    reviewingPolicy: 'no-trace-undo',
    operations: [
      {
        type: 'edit',
        path: 'main.tex',
        patches: [
          { from: 6, to: 11, expected: 'delta', insert: 'beta' }
        ]
      }
    ]
  });

  assert.equal(result.ok, true, result.error || JSON.stringify(result));
  assert.equal(bridge.getFile('main.tex'), 'alpha beta gamma');
  assert.equal(bridge.getReviewingClickCount(), 1);
  assert.equal(bridge.isReviewingActive(), false);
  assert.equal(result.reviewingPolicy.policy, 'no-trace-undo');
  assert.equal(result.reviewingPolicy.disabled, true);
  assert.equal(result.reviewingPolicy.restored, false);
  assert.equal(result.reviewingPolicy.leftEditing, true);
});

test('page bridge applies all no-trace undo patches for one file in a single call', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingClickBehavior: 'toggle',
    reviewingOk: true,
    files: {
      'main.tex': 'alpha delta theta'
    }
  });

  const result = await bridge.call('applyOperations', {
    baseFiles: [
      { path: 'main.tex', content: 'alpha delta theta' }
    ],
    reviewingPolicy: 'no-trace-undo',
    operations: [
      {
        type: 'edit',
        path: 'main.tex',
        patches: [
          { from: 12, to: 17, expected: 'theta', insert: 'gamma' }
        ]
      },
      {
        type: 'edit',
        path: 'main.tex',
        patches: [
          { from: 6, to: 11, expected: 'delta', insert: 'beta' }
        ]
      }
    ]
  });

  assert.equal(result.ok, true, result.error || JSON.stringify(result));
  assert.equal(result.applied.length, 2);
  assert.equal(result.skipped.length, 0);
  assert.equal(bridge.getFile('main.tex'), 'alpha beta gamma');
  assert.equal(bridge.getDispatchCount(), 2);
});

test('page bridge no-trace undo waits when active path switches before editor content catches up', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    initialEditorPath: 'refs.bib',
    initialEditorCatchUpDelayMs: 180,
    reviewingClickBehavior: 'toggle',
    reviewingOk: true,
    files: {
      'main.tex': 'alpha delta gamma',
      'refs.bib': '@book{stale}'
    }
  });

  const result = await bridge.call('applyOperations', {
    baseFiles: [
      { path: 'main.tex', content: 'alpha delta gamma' }
    ],
    reviewingPolicy: 'no-trace-undo',
    operations: [
      {
        type: 'edit',
        path: 'main.tex',
        replaceAll: 'alpha beta gamma'
      }
    ]
  });

  assert.equal(result.ok, true, result.error || JSON.stringify(result));
  assert.equal(result.applied.length, 1);
  assert.equal(result.skipped.length, 0);
  assert.equal(bridge.getFile('main.tex'), 'alpha beta gamma');
  assert.equal(bridge.getDispatchCount(), 1);
});

test('page bridge records and rejects Overleaf tracked changes for Reviewing writes', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingOk: true,
    trackChangesOnDispatch: true,
    files: {
      'main.tex': 'alpha beta gamma'
    }
  });

  const write = await bridge.call('applyOperations', {
    requireReviewing: true,
    baseFiles: [
      { path: 'main.tex', content: 'alpha beta gamma' }
    ],
    operations: [
      {
        type: 'edit',
        path: 'main.tex',
        patches: [
          { from: 6, to: 10, expected: 'beta', insert: 'delta' }
        ]
      }
    ]
  });

  assert.equal(write.ok, true, write.error || JSON.stringify(write));
  assert.equal(bridge.getFile('main.tex'), 'alpha delta gamma');
  assert.equal(write.trackedChanges.length, 1);
  assert.equal(write.trackedChanges[0].path, 'main.tex');

  const undo = await bridge.call('rejectTrackedChanges', {
    trackedChanges: write.trackedChanges,
    expectedFiles: [
      { path: 'main.tex', content: 'alpha beta gamma' }
    ]
  });

  assert.equal(undo.ok, true, undo.error || JSON.stringify(undo));
  assert.equal(undo.applied.length, 1);
  assert.equal(undo.skipped.length, 0);
  assert.equal(bridge.getFile('main.tex'), 'alpha beta gamma');
  assert.equal(bridge.getDispatchCount(), 1);
  assert.equal(bridge.getTrackedChangeCount(), 0);
  assert.equal(bridge.getRejectClickCount(), 1);
});

test('page bridge routes acceptTrackedChanges to the writeback router: editor-undo then untracked replay', async () => {
  // Accept All no longer hunts per-change Accept controls. It editor-undoes the
  // run's tracked writeback back to its pre-write content, then re-applies the
  // post-write content as a plain (untracked) edit. The harness's editor-undo
  // button restores editorUndoTargets[path] (the pre-write content); the
  // mode button toggles so Editing-mode replay + Reviewing restore both work.
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingOk: true,
    reviewingClickBehavior: 'toggle',
    trackChangesOnDispatch: true,
    editorUndoTargets: {
      'main.tex': 'alpha beta gamma'
    },
    files: {
      'main.tex': 'alpha beta gamma'
    }
  });

  const write = await bridge.call('applyOperations', {
    requireReviewing: true,
    baseFiles: [
      { path: 'main.tex', content: 'alpha beta gamma' }
    ],
    operations: [
      {
        type: 'edit',
        path: 'main.tex',
        patches: [
          { from: 6, to: 10, expected: 'beta', insert: 'delta' }
        ]
      }
    ]
  });

  assert.equal(write.ok, true, write.error || JSON.stringify(write));
  assert.equal(bridge.getFile('main.tex'), 'alpha delta gamma');
  assert.equal(write.trackedChanges.length, 1);
  assert.equal(write.trackedChanges[0].path, 'main.tex');

  const accept = await bridge.call('acceptTrackedChanges', {
    trackedChanges: write.trackedChanges,
    expectedFiles: [
      { path: 'main.tex', content: 'alpha beta gamma' }
    ],
    postFiles: [
      { path: 'main.tex', content: 'alpha delta gamma' }
    ]
  });

  assert.equal(accept.ok, true, accept.error || JSON.stringify(accept));
  assert.ok(accept.applied.length >= 1);
  assert.equal(accept.skipped.length, 0);
  // The run's post-write content is in the document as plain text.
  assert.equal(bridge.getFile('main.tex'), 'alpha delta gamma');
  // The editor-undo cleared the run's tracked changes; the replay was untracked.
  assert.equal(bridge.getTrackedChangeCount(), 0);
  assert.equal(bridge.getEditorUndoClickCount(), 1);
  // No per-change Accept / Reject control hunting.
  assert.equal(bridge.getAcceptClickCount(), 0);
  assert.equal(bridge.getRejectClickCount(), 0);
  // The prior Reviewing mode is restored.
  assert.equal(bridge.isReviewingActive(), true);
});

test('page bridge acceptTrackedChanges bails without re-writing when editor content has drifted', async () => {
  // The editor-undo cannot reach the pre-write content (the user manually
  // edited after the run). Accept All must bail WITHOUT re-writing so it never
  // makes the document worse — same safety stance as Undo.
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingOk: true,
    reviewingClickBehavior: 'toggle',
    trackChangesOnDispatch: true,
    editorUndoTargets: {
      'main.tex': 'alpha beta gamma'
    },
    files: {
      'main.tex': 'alpha beta gamma'
    }
  });

  const write = await bridge.call('applyOperations', {
    requireReviewing: true,
    baseFiles: [
      { path: 'main.tex', content: 'alpha beta gamma' }
    ],
    operations: [
      {
        type: 'edit',
        path: 'main.tex',
        patches: [
          { from: 6, to: 10, expected: 'beta', insert: 'delta' }
        ]
      }
    ]
  });
  assert.equal(write.ok, true, write.error || JSON.stringify(write));

  // The user edits the document after the run; the post-write content the run
  // hands Accept All no longer matches what is in the editor.
  bridge.setFile('main.tex', 'alpha delta gamma plus user edit');

  const accept = await bridge.call('acceptTrackedChanges', {
    trackedChanges: write.trackedChanges,
    expectedFiles: [
      { path: 'main.tex', content: 'alpha beta gamma' }
    ],
    postFiles: [
      { path: 'main.tex', content: 'alpha delta gamma' }
    ]
  });

  assert.equal(accept.ok, false, JSON.stringify(accept));
  // The drifted document is left untouched — no re-write.
  assert.equal(bridge.getFile('main.tex'), 'alpha delta gamma plus user edit');
  assert.equal(bridge.getEditorUndoClickCount(), 0, 'a drifted post-write content is detected before any undo');
});

test('page bridge rejects unsafe tracked-change paths before clicking reject controls', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingOk: true,
    trackChangesOnDispatch: true,
    files: {
      'main.tex': 'alpha beta gamma'
    }
  });

  const write = await bridge.call('applyOperations', {
    requireReviewing: true,
    baseFiles: [
      { path: 'main.tex', content: 'alpha beta gamma' }
    ],
    operations: [
      {
        type: 'edit',
        path: 'main.tex',
        patches: [
          { from: 6, to: 10, expected: 'beta', insert: 'delta' }
        ]
      }
    ]
  });

  assert.equal(write.ok, true, write.error || JSON.stringify(write));
  assert.equal(write.trackedChanges.length, 1);

  const undo = await bridge.call('rejectTrackedChanges', {
    trackedChanges: [
      {
        ...write.trackedChanges[0],
        path: '../main.tex'
      }
    ]
  });

  assert.equal(undo.ok, false);
  assert.equal(undo.applied.length, 0);
  assert.equal(undo.skipped.length, 1);
  assert.equal(undo.skipped[0].result.code, 'invalid_project_path');
  assert.equal(bridge.getFile('main.tex'), 'alpha delta gamma');
  assert.equal(bridge.getRejectClickCount(), 0);
  assert.equal(bridge.getTrackedChangeCount(), 1);
});

test('page bridge records tracked changes for each edited file in a Reviewing write', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingOk: true,
    trackChangesOnDispatch: true,
    files: {
      'main.tex': 'alpha beta gamma',
      'refs.bib': 'title = {Old}'
    }
  });

  const write = await bridge.call('applyOperations', {
    requireReviewing: true,
    baseFiles: [
      { path: 'main.tex', content: 'alpha beta gamma' },
      { path: 'refs.bib', content: 'title = {Old}' }
    ],
    operations: [
      {
        type: 'edit',
        path: 'main.tex',
        patches: [
          { from: 6, to: 10, expected: 'beta', insert: 'delta' }
        ]
      },
      {
        type: 'edit',
        path: 'refs.bib',
        patches: [
          { from: 9, to: 12, expected: 'Old', insert: 'New' }
        ]
      }
    ]
  });

  assert.equal(write.ok, true, write.error || JSON.stringify(write));
  assert.deepEqual(Array.from(write.trackedChanges, change => change.path).sort(), ['main.tex', 'refs.bib']);
  assert.equal(bridge.getFile('main.tex'), 'alpha delta gamma');
  assert.equal(bridge.getFile('refs.bib'), 'title = {New}');

  const undo = await bridge.call('rejectTrackedChanges', {
    trackedChanges: write.trackedChanges,
    expectedFiles: [
      { path: 'main.tex', content: 'alpha beta gamma' },
      { path: 'refs.bib', content: 'title = {Old}' }
    ]
  });

  assert.equal(undo.ok, true, undo.error || JSON.stringify(undo));
  assert.equal(undo.applied.length, 2);
  assert.equal(bridge.getFile('main.tex'), 'alpha beta gamma');
  assert.equal(bridge.getFile('refs.bib'), 'title = {Old}');
  assert.equal(bridge.getTrackedChangeCount(), 0);
  assert.equal(bridge.getRejectClickCount(), 2);
});

test('page bridge rejects multiple tracked changes in one file newest first', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingOk: true,
    trackChangesOnDispatch: true,
    files: {
      'main.tex': 'alpha beta gamma'
    }
  });

  const write = await bridge.call('applyOperations', {
    requireReviewing: true,
    baseFiles: [
      { path: 'main.tex', content: 'alpha beta gamma' }
    ],
    operations: [
      {
        type: 'edit',
        path: 'main.tex',
        patches: [
          { from: 6, to: 10, expected: 'beta', insert: 'delta' }
        ]
      },
      {
        type: 'edit',
        path: 'main.tex',
        patches: [
          { from: 12, to: 17, expected: 'gamma', insert: 'theta' }
        ]
      }
    ]
  });

  assert.equal(write.ok, true, write.error || JSON.stringify(write));
  assert.equal(bridge.getFile('main.tex'), 'alpha delta theta');
  assert.equal(write.trackedChanges.length, 2);

  const undo = await bridge.call('rejectTrackedChanges', {
    trackedChanges: write.trackedChanges,
    expectedFiles: [
      { path: 'main.tex', content: 'alpha beta gamma' }
    ]
  });

  assert.equal(undo.ok, true, undo.error || JSON.stringify(undo));
  assert.equal(undo.applied.length, 2);
  assert.equal(undo.skipped.length, 0);
  assert.equal(bridge.getFile('main.tex'), 'alpha beta gamma');
  assert.equal(bridge.getRejectClickCount(), 2);
  assert.deepEqual(bridge.getRejectedChangeIds(), ['change-2', 'change-1']);
});

test('page bridge uses Overleaf editor undo to revert a tracked-change batch in one call', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingOk: true,
    trackChangesOnDispatch: true,
    editorUndoTargets: {
      'main.tex': 'alpha beta gamma'
    },
    files: {
      'main.tex': 'alpha beta gamma'
    }
  });

  const write = await bridge.call('applyOperations', {
    requireReviewing: true,
    baseFiles: [
      { path: 'main.tex', content: 'alpha beta gamma' }
    ],
    operations: [
      {
        type: 'edit',
        path: 'main.tex',
        patches: [
          { from: 6, to: 10, expected: 'beta', insert: 'delta' },
          { from: 11, to: 16, expected: 'gamma', insert: 'theta' }
        ]
      }
    ]
  });

  assert.equal(write.ok, true, write.error || JSON.stringify(write));
  assert.equal(bridge.getFile('main.tex'), 'alpha delta theta');
  assert.equal(write.trackedChanges.length, 1);

  const undo = await bridge.call('rejectTrackedChanges', {
    trackedChanges: write.trackedChanges,
    expectedFiles: [
      { path: 'main.tex', content: 'alpha beta gamma' }
    ],
    postFiles: [
      { path: 'main.tex', content: 'alpha delta theta' }
    ]
  });

  assert.equal(undo.ok, true, undo.error || JSON.stringify(undo));
  assert.equal(undo.applied.length, 1);
  assert.equal(undo.skipped.length, 0);
  assert.equal(undo.applied[0].result.method, 'overleaf-editor-undo');
  assert.equal(bridge.getFile('main.tex'), 'alpha beta gamma');
  assert.equal(bridge.getEditorUndoClickCount(), 1);
  assert.equal(bridge.getRejectClickCount(), 0);
});

test('page bridge native undo waits when active path switches before editor content catches up', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    initialEditorPath: 'refs.bib',
    initialEditorCatchUpDelayMs: 180,
    reviewingOk: true,
    editorUndoTargets: {
      'main.tex': 'alpha beta gamma'
    },
    files: {
      'main.tex': 'alpha delta gamma',
      'refs.bib': '@book{stale}'
    }
  });

  const undo = await bridge.call('rejectTrackedChanges', {
    trackedChanges: [],
    expectedFiles: [
      { path: 'main.tex', content: 'alpha beta gamma' }
    ],
    postFiles: [
      { path: 'main.tex', content: 'alpha delta gamma' }
    ]
  });

  assert.equal(undo.ok, true, undo.error || JSON.stringify(undo));
  assert.equal(undo.applied.length, 1);
  assert.equal(undo.skipped.length, 0);
  assert.equal(undo.applied[0].result.method, 'overleaf-editor-undo');
  assert.equal(bridge.getFile('main.tex'), 'alpha beta gamma');
  assert.equal(bridge.getEditorUndoClickCount(), 1);
});

test('page bridge does not use editor undo after user edits change the post-run content', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingOk: true,
    trackChangesOnDispatch: true,
    editorUndoTargets: {
      'main.tex': 'alpha beta gamma'
    },
    files: {
      'main.tex': 'alpha beta gamma'
    }
  });

  const write = await bridge.call('applyOperations', {
    requireReviewing: true,
    baseFiles: [
      { path: 'main.tex', content: 'alpha beta gamma' }
    ],
    operations: [
      {
        type: 'edit',
        path: 'main.tex',
        patches: [
          { from: 6, to: 10, expected: 'beta', insert: 'delta' }
        ]
      }
    ]
  });

  assert.equal(write.ok, true, write.error || JSON.stringify(write));
  bridge.setFile('main.tex', 'alpha delta theta user edit');

  const undo = await bridge.call('rejectTrackedChanges', {
    trackedChanges: write.trackedChanges,
    expectedFiles: [
      { path: 'main.tex', content: 'alpha beta gamma' }
    ],
    postFiles: [
      { path: 'main.tex', content: 'alpha delta gamma' }
    ]
  });

  assert.equal(undo.ok, true, undo.error || JSON.stringify(undo));
  assert.equal(bridge.getEditorUndoClickCount(), 0);
  assert.equal(bridge.getRejectClickCount(), 1);
});

test('page bridge can undo a reviewing write with no captured tracked-change refs', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingOk: true,
    editorUndoTargets: {
      'main.tex': 'alpha beta gamma'
    },
    files: {
      'main.tex': 'alpha delta gamma'
    }
  });

  const undo = await bridge.call('rejectTrackedChanges', {
    trackedChanges: [],
    expectedFiles: [
      { path: 'main.tex', content: 'alpha beta gamma' }
    ],
    postFiles: [
      { path: 'main.tex', content: 'alpha delta gamma' }
    ]
  });

  assert.equal(undo.ok, true, undo.error || JSON.stringify(undo));
  assert.equal(undo.applied.length, 1);
  assert.equal(undo.skipped.length, 0);
  assert.equal(undo.applied[0].result.method, 'overleaf-editor-undo');
  assert.equal(bridge.getFile('main.tex'), 'alpha beta gamma');
  assert.equal(bridge.getEditorUndoClickCount(), 1);
  assert.equal(bridge.getRejectClickCount(), 0);
});

test('page bridge continues tracked-change undo after Overleaf rerenders review ids', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingOk: true,
    trackChangesOnDispatch: true,
    rerenderTrackedChangeIdsOnReject: true,
    files: {
      'main.tex': 'alpha beta gamma'
    }
  });

  const write = await bridge.call('applyOperations', {
    requireReviewing: true,
    baseFiles: [
      { path: 'main.tex', content: 'alpha beta gamma' }
    ],
    operations: [
      {
        type: 'edit',
        path: 'main.tex',
        patches: [
          { from: 6, to: 10, expected: 'beta', insert: 'delta' }
        ]
      },
      {
        type: 'edit',
        path: 'main.tex',
        patches: [
          { from: 12, to: 17, expected: 'gamma', insert: 'theta' }
        ]
      }
    ]
  });

  assert.equal(write.ok, true, write.error || JSON.stringify(write));
  assert.equal(write.trackedChanges.length, 2);
  assert.equal(bridge.getFile('main.tex'), 'alpha delta theta');

  const undo = await bridge.call('rejectTrackedChanges', {
    trackedChanges: write.trackedChanges,
    expectedFiles: [
      { path: 'main.tex', content: 'alpha beta gamma' }
    ]
  });

  assert.equal(undo.ok, true, undo.error || JSON.stringify(undo));
  assert.equal(bridge.getFile('main.tex'), 'alpha beta gamma');
  assert.equal(bridge.getTrackedChangeCount(), 0);
  assert.equal(bridge.getRejectClickCount(), 2);
});

test('page bridge rejects remaining tracked changes when stored refs are incomplete', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingOk: true,
    trackChangesOnDispatch: true,
    files: {
      'main.tex': 'alpha beta gamma'
    }
  });

  const write = await bridge.call('applyOperations', {
    requireReviewing: true,
    baseFiles: [
      { path: 'main.tex', content: 'alpha beta gamma' }
    ],
    operations: [
      {
        type: 'edit',
        path: 'main.tex',
        patches: [
          { from: 6, to: 10, expected: 'beta', insert: 'delta' }
        ]
      },
      {
        type: 'edit',
        path: 'main.tex',
        patches: [
          { from: 12, to: 17, expected: 'gamma', insert: 'theta' }
        ]
      }
    ]
  });

  assert.equal(write.ok, true, write.error || JSON.stringify(write));
  assert.equal(write.trackedChanges.length, 2);
  assert.equal(bridge.getFile('main.tex'), 'alpha delta theta');

  const undo = await bridge.call('rejectTrackedChanges', {
    trackedChanges: [
      write.trackedChanges[1]
    ],
    expectedFiles: [
      { path: 'main.tex', content: 'alpha beta gamma' }
    ]
  });

  assert.equal(undo.ok, true, undo.error || JSON.stringify(undo));
  assert.equal(undo.applied.length, 2);
  assert.equal(undo.skipped.length, 0);
  assert.equal(bridge.getFile('main.tex'), 'alpha beta gamma');
  assert.equal(bridge.getTrackedChangeCount(), 0);
  assert.equal(bridge.getRejectClickCount(), 2);
});

test('page bridge sweeps remaining tracked changes for old undo records without expected files', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingOk: true,
    trackChangesOnDispatch: true,
    files: {
      'main.tex': 'alpha beta gamma'
    }
  });

  const write = await bridge.call('applyOperations', {
    requireReviewing: true,
    baseFiles: [
      { path: 'main.tex', content: 'alpha beta gamma' }
    ],
    operations: [
      {
        type: 'edit',
        path: 'main.tex',
        patches: [
          { from: 6, to: 10, expected: 'beta', insert: 'delta' }
        ]
      },
      {
        type: 'edit',
        path: 'main.tex',
        patches: [
          { from: 12, to: 17, expected: 'gamma', insert: 'theta' }
        ]
      }
    ]
  });

  assert.equal(write.ok, true, write.error || JSON.stringify(write));
  assert.equal(write.trackedChanges.length, 2);
  assert.equal(bridge.getFile('main.tex'), 'alpha delta theta');

  const undo = await bridge.call('rejectTrackedChanges', {
    trackedChanges: [
      write.trackedChanges[1]
    ],
    expectedFiles: []
  });

  assert.equal(undo.ok, true, undo.error || JSON.stringify(undo));
  assert.equal(undo.applied.length, 2);
  assert.equal(undo.skipped.length, 0);
  assert.equal(bridge.getFile('main.tex'), 'alpha beta gamma');
  assert.equal(bridge.getTrackedChangeCount(), 0);
  assert.equal(bridge.getRejectClickCount(), 2);
});

test('page bridge sweeps active file tracked changes when old undo refs have no path', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingOk: true,
    trackChangesOnDispatch: true,
    files: {
      'main.tex': 'alpha beta gamma'
    }
  });

  const write = await bridge.call('applyOperations', {
    requireReviewing: true,
    baseFiles: [
      { path: 'main.tex', content: 'alpha beta gamma' }
    ],
    operations: [
      {
        type: 'edit',
        path: 'main.tex',
        patches: [
          { from: 6, to: 10, expected: 'beta', insert: 'delta' }
        ]
      },
      {
        type: 'edit',
        path: 'main.tex',
        patches: [
          { from: 12, to: 17, expected: 'gamma', insert: 'theta' }
        ]
      }
    ]
  });

  assert.equal(write.ok, true, write.error || JSON.stringify(write));
  assert.equal(write.trackedChanges.length, 2);

  const undo = await bridge.call('rejectTrackedChanges', {
    trackedChanges: [
      {
        ...write.trackedChanges[1],
        path: ''
      }
    ],
    expectedFiles: []
  });

  assert.equal(undo.ok, true, undo.error || JSON.stringify(undo));
  assert.equal(undo.applied.length, 2);
  assert.equal(undo.skipped.length, 0);
  assert.equal(bridge.getFile('main.tex'), 'alpha beta gamma');
  assert.equal(bridge.getTrackedChangeCount(), 0);
  assert.equal(bridge.getRejectClickCount(), 2);
});

test('page bridge refuses tracked-change undo when the Overleaf review marker cannot be found', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingOk: true,
    files: {
      'main.tex': 'alpha delta gamma'
    }
  });

  const result = await bridge.call('rejectTrackedChanges', {
    trackedChanges: [
      { key: 'missing-change', path: 'main.tex' }
    ],
    expectedFiles: [
      { path: 'main.tex', content: 'alpha beta gamma' }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].result.code, 'tracked_change_not_found');
  assert.equal(bridge.getFile('main.tex'), 'alpha delta gamma');
});

test('page bridge disables Reviewing through an Overleaf mode dropdown before undo', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingClickBehavior: 'menu',
    reviewingOk: true,
    files: {
      'main.tex': 'alpha delta gamma'
    }
  });

  const result = await bridge.call('applyOperations', {
    baseFiles: [
      { path: 'main.tex', content: 'alpha delta gamma' }
    ],
    reviewingPolicy: 'no-trace-undo',
    operations: [
      {
        type: 'edit',
        path: 'main.tex',
        patches: [
          { from: 6, to: 11, expected: 'delta', insert: 'beta' }
        ]
      }
    ]
  });

  assert.equal(result.ok, true, result.error || JSON.stringify(result));
  assert.equal(bridge.getFile('main.tex'), 'alpha beta gamma');
  assert.equal(bridge.getReviewingClickCount(), 1);
  assert.equal(bridge.getModeOptionClickCount(), 1);
  assert.equal(bridge.isReviewingActive(), false);
  assert.equal(result.reviewingPolicy.disabled, true);
  assert.equal(result.reviewingPolicy.restored, false);
  assert.equal(result.reviewingPolicy.leftEditing, true);
});

test('page bridge blocks no-trace undo when Reviewing cannot be disabled', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingClickBehavior: 'noop',
    reviewingOk: true,
    files: {
      'main.tex': 'alpha delta gamma'
    }
  });

  const result = await bridge.call('applyOperations', {
    baseFiles: [
      { path: 'main.tex', content: 'alpha delta gamma' }
    ],
    reviewingPolicy: 'no-trace-undo',
    operations: [
      {
        type: 'edit',
        path: 'main.tex',
        patches: [
          { from: 6, to: 11, expected: 'delta', insert: 'beta' }
        ]
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].result.code, 'reviewing_disable_failed');
  assert.equal(bridge.getFile('main.tex'), 'alpha delta gamma');
  assert.equal(bridge.isReviewingActive(), true);
});

test('page bridge blocks no-trace undo when Editing mode is not positively confirmed', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingOk: false,
    reviewingClickBehavior: 'noop',
    exposeReviewingActiveState: false,
    files: {
      'main.tex': 'alpha delta gamma'
    }
  });

  const result = await bridge.call('applyOperations', {
    baseFiles: [
      { path: 'main.tex', content: 'alpha delta gamma' }
    ],
    reviewingPolicy: 'no-trace-undo',
    operations: [
      {
        type: 'edit',
        path: 'main.tex',
        patches: [
          { from: 6, to: 11, expected: 'delta', insert: 'beta' }
        ]
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].result.code, 'editing_not_confirmed');
  assert.equal(bridge.getFile('main.tex'), 'alpha delta gamma');
});

test('page bridge does not treat a loose Editing button as confirmed no-trace undo mode', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    reviewingOk: true,
    reviewingClickBehavior: 'noop',
    exposeReviewingActiveState: false,
    includeLooseEditingButton: true,
    files: {
      'main.tex': 'alpha delta gamma'
    }
  });

  const result = await bridge.call('applyOperations', {
    baseFiles: [
      { path: 'main.tex', content: 'alpha delta gamma' }
    ],
    reviewingPolicy: 'no-trace-undo',
    operations: [
      {
        type: 'edit',
        path: 'main.tex',
        patches: [
          { from: 6, to: 11, expected: 'delta', insert: 'beta' }
        ]
      }
    ]
  });

  assert.equal(result.ok, false);
  assert.equal(result.applied.length, 0);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.skipped[0].result.code, 'editing_not_confirmed');
  assert.equal(bridge.getFile('main.tex'), 'alpha delta gamma');
});

test('page bridge probe reports capabilities for explicit degradation messages', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    files: {
      'main.tex': 'alpha'
    }
  });

  const result = await bridge.call('probe', {});

  assert.equal(result.ok, true, result.error || JSON.stringify(result));
  assert.equal(result.capabilities.editor.read, true);
  assert.equal(result.capabilities.editor.write, true);
  assert.equal(result.capabilities.fileTree.write, true);
  assert.equal(result.capabilities.compile.capture, false);
  assert.ok(Array.isArray(result.capabilities.warnings));
});

test('page bridge starts, drains, and stops the read-only OT observer', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    files: {
      'main.tex': 'alpha'
    }
  });

  const startStatus = await bridge.call('startOtObserver', { projectId: 'test-project' });

  assert.equal(startStatus.status, 'observing');
  assert.equal(startStatus.state, 'observing');
  assert.equal(startStatus.running, true);
  assert.equal(startStatus.activePath, 'main.tex');

  bridge.setFile('main.tex', 'alpha beta');
  bridge.fireDocumentEvent('input');

  const activeStatus = await bridge.call('getOtStatus', {});
  assert.equal(activeStatus.status, 'observing');
  assert.equal(activeStatus.state, 'observing');
  assert.equal(activeStatus.queuedEventCount, 1);

  const drained = await bridge.call('drainOtEvents', {});
  const drainedEvents = JSON.parse(JSON.stringify(drained.events));
  assert.equal(drained.ok, true);
  assert.equal(drainedEvents.length, 1);
  assert.equal(drainedEvents[0].path, 'main.tex');
  assert.equal(drainedEvents[0].nextContent, 'alpha beta');
  assert.equal(Object.prototype.hasOwnProperty.call(drainedEvents[0], 'ops'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(drainedEvents[0], 'previousContent'), false);

  const empty = await bridge.call('drainOtEvents', {});
  assert.equal(empty.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(empty.events)), []);

  const stopStatus = await bridge.call('stopOtObserver', {});
  assert.equal(stopStatus.status, 'off');
  assert.equal(stopStatus.state, 'off');
  assert.equal(stopStatus.running, false);
});

test('page bridge whitelists OT event fields before posting to content', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    files: {
      'main.tex': 'alpha'
    },
    realtimeObserverFactory() {
      return {
        start() {
          return { status: 'observing', state: 'observing', running: true };
        },
        stop() {
          return { status: 'off', state: 'off', running: false };
        },
        getStatus() {
          return { status: 'observing', state: 'observing', queuedEventCount: 1 };
        },
        drainEvents() {
          return [{
            path: 'main.tex',
            baseHash: 'base-hash',
            nextHash: 'next-hash',
            nextContent: 'alpha beta',
            previousContent: 'alpha secret',
            ops: [{ p: 5, d: ' secret' }],
            observedAt: '2026-05-05T00:00:00.000Z',
            observedVersion: 'doc-version-2',
            source: 'fake-observer',
            rawContent: 'raw secret',
            extraSensitiveField: 'do not expose'
          }];
        }
      };
    }
  });

  const drained = await bridge.call('drainOtEvents', {});
  const drainedEvents = JSON.parse(JSON.stringify(drained.events));

  assert.equal(drained.ok, true);
  assert.deepEqual(drainedEvents, [{
    path: 'main.tex',
    baseHash: 'base-hash',
    nextHash: 'next-hash',
    nextContent: 'alpha beta',
    observedAt: '2026-05-05T00:00:00.000Z',
    observedVersion: 'doc-version-2',
    source: 'fake-observer'
  }]);
});

test('page bridge remains available when OT observer factory throws', async () => {
  const bridge = createPageBridgeHarness({
    activePath: 'main.tex',
    saveIndicatorText: 'All changes saved',
    files: {
      'main.tex': 'alpha'
    },
    realtimeObserverFactory() {
      throw new Error('observer factory failed');
    }
  });

  const probe = await bridge.call('probe', {});
  assert.equal(probe.ok, true, probe.error || JSON.stringify(probe));

  const saveState = await bridge.call('waitForSaveState', { deadlineMs: 1, pollIntervalMs: 1 });
  assert.equal(saveState.ok, true);
  assert.equal(saveState.state, 'verified_saved');

  const status = await bridge.call('getOtStatus', {});
  assert.equal(status.status, 'unavailable');
  assert.equal(status.state, 'unavailable');
  assert.equal(status.running, false);
  assert.equal(status.lastErrorCode, 'ot_observer_create_failed');

  const stopped = await bridge.call('stopOtObserver', {});
  assert.equal(stopped.status, 'off');
  assert.equal(stopped.state, 'off');
  assert.equal(stopped.running, false);
});


function createPageBridgeHarness({
  activePath,
  files,
  reviewingOk = true,
  reviewingClickActivates = true,
  reviewingClickBehavior = 'activate',
  reviewingButtonShowsCurrentMode = false,
  exposeReviewingActiveState = true,
  includeLooseEditingButton = false,
  modeOptionRole = 'menuitem',
  modeOptionClassName = 'mode-option',
  internalReviewingState = undefined,
  saveIndicatorText = null,
  saveIndicatorAriaLabel = saveIndicatorText,
  saveIndicatorTitle = saveIndicatorAriaLabel,
  saveIndicatorNodes = null,
  dispatchApplies = true,
  trackChangesOnDispatch = false,
  realtimeObserverFactory = null,
  rerenderTrackedChangeIdsOnReject = false,
  editorUndoTargets = {},
  initialEditorPath = activePath,
  initialEditorCatchUpDelayMs = null,
  editorSwitchDelayMs = 0,
  basenameOnlyTreeLabels = false,
  exposeInternalDocTree = false
}) {
  const fileMap = new Map(Object.entries(files));
  const trackedChanges = [];
  let selectedPath = activePath;
  let editorPath = initialEditorPath;
  let listener = null;
  let pendingResult = null;
  let lastDispatchChanges = null;
  let lastSelection = null;
  let lastScrollIntoView = null;
  let dispatchCount = 0;
  let reviewingActive = reviewingOk;
  let reviewingClickCount = 0;
  let rejectClickCount = 0;
  let acceptClickCount = 0;
  let editorUndoClickCount = 0;
  const bridgeCapability = 'test-page-bridge-capability';
  let capabilityInitialized = false;
  const rejectedChangeIds = [];
  const acceptedChangeIds = [];
  let modeMenuOpen = false;
  let modeOptionClickCount = 0;
  const documentEventListeners = [];

  if (initialEditorPath !== activePath && Number.isFinite(Number(initialEditorCatchUpDelayMs))) {
    setTimeout(() => {
      editorPath = selectedPath;
    }, Math.max(0, Number(initialEditorCatchUpDelayMs)));
  }

  const document = {
    addEventListener(type, handler, optionsArg) {
      documentEventListeners.push({ type, handler, options: optionsArg });
    },
    removeEventListener(type, handler) {
      const index = documentEventListeners.findIndex(listenerItem =>
        listenerItem.type === type && listenerItem.handler === handler
      );
      if (index > -1) {
        documentEventListeners.splice(index, 1);
      }
    },
    body: {
      get innerText() {
        return reviewingActive ? 'Reviewing' : 'Editing';
      },
      get textContent() {
        return reviewingActive ? 'Reviewing' : 'Editing';
      }
    },
    querySelector(selector) {
      if (/\[aria-selected="true"\]|\.selected/.test(selector)) {
        return makeTreeNode(selectedPath);
      }
      return null;
    },
    querySelectorAll(selector) {
      if (/save|saving-status|save-status/i.test(selector)) {
        if (saveIndicatorNodes) {
          return saveIndicatorNodes.map(makeSaveIndicatorNode);
        }
        return saveIndicatorText == null
          ? []
          : [makeSaveIndicatorNode({
            text: saveIndicatorText,
            ariaLabel: saveIndicatorAriaLabel,
            title: saveIndicatorTitle
          })];
      }
      if (/treeitem|role="row"|file-tree|project-tree|data-entity-id|data-doc-id|data-id|data-file-id/.test(selector)) {
        return Array.from(fileMap.keys(), makeTreeNode);
      }
      if (/aria-label|title|review|track|button|\*/i.test(selector)) {
        return [
          makeEditorUndoButton(),
          makeReviewingButton(),
          ...trackedChanges.filter(change => change.path === selectedPath).map(makeTrackedChangeNode),
          ...(includeLooseEditingButton ? [makeLooseEditingButton()] : []),
          ...(modeMenuOpen ? [makeModeOption('Editing'), makeModeOption('Reviewing')] : [])
        ];
      }
      return [];
    },
    execCommand() {
      return false;
    }
  };

  const window = {
    location: {
      href: 'https://www.overleaf.com/project/test-project',
      origin: 'https://www.overleaf.com',
      pathname: '/project/test-project'
    },
    CodexOverleafProjectFiles: projectFiles,
    CodexOverleafReviewing: reviewing,
    CodexOverleafStaleGuard: staleGuard,
    _ide: {
      editorView: createEditorView(),
      fileTreeManager: createFileTreeManager(),
      ...(exposeInternalDocTree ? { rootFolder: buildInternalDocTree(Array.from(fileMap.keys())) } : {}),
      ...(internalReviewingState === undefined ? {} : { reviewing: internalReviewingState })
    },
    addEventListener(event, callback) {
      if (event === 'message') {
        listener = callback;
      }
    },
    postMessage(message) {
      if (message.source === 'codex-overleaf/page' && pendingResult) {
        pendingResult(message.result);
      }
    },
    setTimeout,
    clearTimeout
  };

  const context = vm.createContext({
    window,
    document,
    Node: class Node {},
    EventTarget: class EventTarget {},
    MouseEvent: class MouseEvent {},
    InputEvent: class InputEvent {},
    Event: class Event {},
    setTimeout,
    clearTimeout,
    console,
    globalThis: window
  });

  vm.runInContext(otTextSource, context, { filename: 'otText.js' });
  vm.runInContext(overleafCapabilitiesSource, context, { filename: 'overleafCapabilities.js' });
  vm.runInContext(compileBridgeSource, context, { filename: 'compileBridge.js' });
  vm.runInContext(overleafEditorSource, context, { filename: 'overleafEditor.js' });
  vm.runInContext(overleafProjectSnapshotSource, context, { filename: 'overleafProjectSnapshot.js' });
  vm.runInContext(treeOperationsSource, context, { filename: 'treeOperations.js' });
  vm.runInContext(snapshotRouterSource, context, { filename: 'snapshotRouter.js' });
  vm.runInContext(writebackRouterSource, context, { filename: 'writebackRouter.js' });
  if (realtimeObserverFactory) {
    window.CodexOverleafRealtimeObserver = { create: realtimeObserverFactory };
  } else {
    vm.runInContext(overleafRealtimeObserverSource, context, { filename: 'overleafRealtimeObserver.js' });
  }
  if (pageBridgeCapabilitySource) {
    vm.runInContext(pageBridgeCapabilitySource, context, { filename: 'pageBridgeCapability.js' });
  }
  vm.runInContext(pageBridgeSource, context, { filename: 'pageBridge.js' });

  return {
    async initializeCapability() {
      if (capabilityInitialized) {
        return { ok: true, alreadyInitialized: true };
      }
      const result = await sendPageBridgeRequest('initializeCapability', {}, {
        capability: bridgeCapability
      });
      capabilityInitialized = true;
      return result;
    },
    async call(method, params) {
      await this.initializeCapability();
      return sendPageBridgeRequest(method, params, {
        capability: bridgeCapability
      });
    },
    async spoofCall(method, params, options = {}) {
      return sendPageBridgeRequest(method, params, {
        capability: options.capability,
        includeCapability: options.includeCapability === true
      });
    },
    fireDocumentEvent(type, event = { target: {} }) {
      const listenerItems = documentEventListeners.filter(item => item.type === type);
      assert.ok(listenerItems.length, `${type} document listener should be registered`);
      for (const listenerItem of listenerItems) {
        listenerItem.handler(event);
      }
    },
    getFile(filePath) {
      return fileMap.get(filePath);
    },
    setFile(filePath, content) {
      fileMap.set(filePath, content);
    },
    getLastDispatchChanges() {
      return lastDispatchChanges == null ? null : JSON.parse(JSON.stringify(lastDispatchChanges));
    },
    getLastSelection() {
      return lastSelection == null ? null : JSON.parse(JSON.stringify(lastSelection));
    },
    getLastScrollIntoView() {
      return lastScrollIntoView;
    },
    getDispatchCount() {
      return dispatchCount;
    },
    getEditorPath() {
      return editorPath;
    },
    getReviewingClickCount() {
      return reviewingClickCount;
    },
    getModeOptionClickCount() {
      return modeOptionClickCount;
    },
    getRejectClickCount() {
      return rejectClickCount;
    },
    getAcceptClickCount() {
      return acceptClickCount;
    },
    getEditorUndoClickCount() {
      return editorUndoClickCount;
    },
    getRejectedChangeIds() {
      return rejectedChangeIds.slice();
    },
    getAcceptedChangeIds() {
      return acceptedChangeIds.slice();
    },
    getTrackedChangeCount() {
      return trackedChanges.length;
    },
    isReviewingActive() {
      return reviewingActive;
    }
  };

  async function sendPageBridgeRequest(method, params, options = {}) {
    assert.equal(typeof listener, 'function');
    const resultPromise = new Promise(resolve => {
      pendingResult = resolve;
    });
    const data = {
      source: 'codex-overleaf/content',
      id: `test-call-${method}`,
      method,
      params
    };
    if (options.includeCapability !== false && typeof options.capability === 'string') {
      data.capability = options.capability;
    }
    await listener({
      source: window,
      origin: window.location.origin,
      data
    });
    return resultPromise;
  }

  function createEditorView() {
    const stateByPath = new Map();
    function getState(filePath) {
      if (!stateByPath.has(filePath)) {
        const doc = {
          toString() {
            return fileMap.get(filePath) || '';
          },
          get length() {
            return (fileMap.get(filePath) || '').length;
          }
        };
        stateByPath.set(filePath, { doc });
      }
      return stateByPath.get(filePath);
    }
    return {
      get state() {
        return getState(editorPath);
      },
      focus() {},
      dispatch(transaction) {
        dispatchCount += 1;
        lastDispatchChanges = transaction.changes;
        lastScrollIntoView = Object.prototype.hasOwnProperty.call(transaction, 'scrollIntoView')
          ? transaction.scrollIntoView
          : null;
        if (transaction.selection) {
          lastSelection = transaction.selection;
        }
        if (dispatchApplies) {
          if (!transaction.changes) {
            return;
          }
          const before = fileMap.get(editorPath) || '';
          fileMap.set(editorPath, applyEditorChanges(fileMap.get(editorPath) || '', transaction.changes));
          if (reviewingActive && trackChangesOnDispatch) {
            trackedChanges.push({
              id: `change-${trackedChanges.length + 1}`,
              path: editorPath,
              before,
              after: fileMap.get(editorPath) || ''
            });
          }
        }
      }
    };
  }

  function applyEditorChanges(text, changes) {
    if (!changes) {
      return text;
    }
    if (!Array.isArray(changes)) {
      return text.slice(0, changes.from) + changes.insert + text.slice(changes.to);
    }
    return changes.slice().sort((a, b) => b.from - a.from).reduce((next, change) => {
      return next.slice(0, change.from) + change.insert + next.slice(change.to);
    }, text);
  }

  function createFileTreeManager() {
    return {
      createDoc(filePath, content) {
        fileMap.set(filePath, content);
      },
      renameEntity(filePath, to) {
        const content = fileMap.get(filePath);
        fileMap.delete(filePath);
        fileMap.set(to, content || '');
        if (selectedPath === filePath) {
          selectedPath = to;
        }
        if (editorPath === filePath) {
          editorPath = to;
        }
      },
      moveEntity(filePath, to) {
        this.renameEntity(filePath, to);
      },
      deleteEntity(filePath) {
        fileMap.delete(filePath);
      }
    };
  }

  function makeReviewingButton() {
    const label = reviewingButtonShowsCurrentMode
      ? (reviewingActive ? 'Reviewing' : 'Editing')
      : 'Reviewing';
    return {
      tagName: 'BUTTON',
      textContent: label,
      innerText: label,
      id: reviewingButtonShowsCurrentMode ? 'editor-mode-dropdown' : 'reviewing-mode',
      className: reviewingButtonShowsCurrentMode ? 'editor-mode-dropdown' : 'toolbar-reviewing-button',
      disabled: false,
      parentElement: null,
      getAttribute(attribute) {
        if (attribute === 'aria-label' || attribute === 'title') {
          return label;
        }
        if (attribute === 'aria-disabled') {
          return 'false';
        }
        if (attribute === 'aria-pressed' || attribute === 'aria-selected' || attribute === 'aria-current') {
          if (!exposeReviewingActiveState) {
            return '';
          }
          return reviewingActive ? 'true' : 'false';
        }
        return '';
      },
      click() {
        reviewingClickCount += 1;
        if (reviewingClickBehavior === 'toggle') {
          reviewingActive = !reviewingActive;
        } else if (reviewingClickBehavior === 'noop') {
          return;
        } else if (reviewingClickBehavior === 'menu') {
          modeMenuOpen = true;
        } else if (reviewingClickActivates) {
          reviewingActive = true;
        }
      },
      dispatchEvent() {
        this.click();
        return true;
      }
    };
  }

  function makeEditorUndoButton() {
    return {
      tagName: 'BUTTON',
      textContent: 'Undo',
      innerText: 'Undo',
      id: 'editor-undo',
      className: 'toolbar-undo-button',
      disabled: false,
      parentElement: null,
      getAttribute(attribute) {
        if (attribute === 'aria-label' || attribute === 'title') {
          return 'Undo';
        }
        if (attribute === 'aria-disabled') {
          return 'false';
        }
        return '';
      },
      click() {
        editorUndoClickCount += 1;
        if (Object.prototype.hasOwnProperty.call(editorUndoTargets, selectedPath)) {
          fileMap.set(selectedPath, editorUndoTargets[selectedPath]);
          trackedChanges.splice(0, trackedChanges.length);
        }
      },
      dispatchEvent() {
        this.click();
        return true;
      }
    };
  }

  function makeModeOption(label) {
    return {
      tagName: 'BUTTON',
      textContent: label,
      innerText: label,
      id: `${label.toLowerCase()}-mode-option`,
      className: modeOptionClassName,
      disabled: false,
      parentElement: null,
      getAttribute(attribute) {
        if (attribute === 'aria-label' || attribute === 'title') {
          return label;
        }
        if (attribute === 'role') {
          return modeOptionRole;
        }
        if (attribute === 'aria-disabled') {
          return 'false';
        }
        if (attribute === 'aria-pressed' || attribute === 'aria-selected' || attribute === 'aria-current') {
          return (label === 'Reviewing' && reviewingActive) || (label === 'Editing' && !reviewingActive)
            ? 'true'
            : 'false';
        }
        return '';
      },
      click() {
        modeOptionClickCount += 1;
        reviewingActive = label === 'Reviewing';
        modeMenuOpen = false;
      },
      dispatchEvent() {
        this.click();
        return true;
      }
    };
  }

  function makeLooseEditingButton() {
    return {
      tagName: 'BUTTON',
      textContent: 'Editing',
      innerText: 'Editing',
      id: 'format-editing-control',
      className: 'toolbar-button',
      disabled: false,
      parentElement: null,
      getAttribute(attribute) {
        if (attribute === 'aria-label' || attribute === 'title') {
          return 'Editing';
        }
        if (attribute === 'aria-disabled') {
          return 'false';
        }
        return '';
      },
      click() {
        return undefined;
      },
      dispatchEvent() {
        this.click();
        return true;
      }
    };
  }

  function makeSaveIndicatorNode(options) {
    const {
      text,
      ariaLabel = text,
      title = ariaLabel,
      hidden = false,
      ariaHidden = false,
      inert = false,
      display = '',
      visibility = ''
    } = typeof options === 'string' ? { text: options } : options;
    return {
      tagName: 'DIV',
      textContent: text,
      innerText: text,
      id: 'save-status',
      className: 'save-status',
      hidden,
      inert,
      style: { display, visibility },
      disabled: false,
      parentElement: null,
      hasAttribute(attribute) {
        if (attribute === 'hidden') {
          return hidden;
        }
        if (attribute === 'inert') {
          return inert;
        }
        return false;
      },
      getAttribute(attribute) {
        if (attribute === 'aria-label') {
          return ariaLabel;
        }
        if (attribute === 'title') {
          return title;
        }
        if (attribute === 'aria-hidden') {
          return ariaHidden ? 'true' : '';
        }
        if (attribute === 'hidden') {
          return hidden ? '' : null;
        }
        if (attribute === 'inert') {
          return inert ? '' : null;
        }
        if (attribute === 'data-testid') {
          return 'save-status';
        }
        return '';
      }
    };
  }

  function makeTrackedChangeNode(change) {
    return {
      tagName: 'DIV',
      textContent: `Tracked change ${change.id}`,
      innerText: `Tracked change ${change.id}`,
      id: `tracked-${change.id}`,
      className: 'review-change-row track-change',
      disabled: false,
      parentElement: null,
      getAttribute(attribute) {
        if (attribute === 'data-change-id' || attribute === 'data-review-id') {
          return change.id;
        }
        if (attribute === 'data-path') {
          return change.path;
        }
        if (attribute === 'aria-label' || attribute === 'title') {
          return `Tracked change ${change.id}`;
        }
        return '';
      },
      querySelectorAll(selector) {
        if (/button|role|aria-label|title|\*/i.test(selector)) {
          return [
            makeAcceptTrackedChangeButton(change),
            makeRejectTrackedChangeButton(change)
          ];
        }
        return [];
      },
      closest() {
        return null;
      }
    };
  }

  function makeAcceptTrackedChangeButton(change) {
    return {
      tagName: 'BUTTON',
      textContent: 'Accept',
      innerText: 'Accept',
      id: `accept-${change.id}`,
      className: 'review-accept-change',
      disabled: false,
      parentElement: null,
      getAttribute(attribute) {
        if (attribute === 'aria-label' || attribute === 'title') {
          return `Accept change ${change.id}`;
        }
        if (attribute === 'role') {
          return 'button';
        }
        if (attribute === 'aria-disabled') {
          return 'false';
        }
        return '';
      },
      click() {
        acceptClickCount += 1;
        acceptedChangeIds.push(change.id);
        fileMap.set(change.path, change.after);
        const index = trackedChanges.indexOf(change);
        if (index >= 0) {
          trackedChanges.splice(index, 1);
        }
      },
      dispatchEvent() {
        this.click();
        return true;
      }
    };
  }

  function makeRejectTrackedChangeButton(change) {
    return {
      tagName: 'BUTTON',
      textContent: 'Reject',
      innerText: 'Reject',
      id: `reject-${change.id}`,
      className: 'review-reject-change',
      disabled: false,
      parentElement: null,
      getAttribute(attribute) {
        if (attribute === 'aria-label' || attribute === 'title') {
          return `Reject change ${change.id}`;
        }
        if (attribute === 'role') {
          return 'button';
        }
        if (attribute === 'aria-disabled') {
          return 'false';
        }
        return '';
      },
      click() {
        rejectClickCount += 1;
        rejectedChangeIds.push(change.id);
        fileMap.set(change.path, change.before);
        const index = trackedChanges.indexOf(change);
        if (index >= 0) {
          trackedChanges.splice(index, 1);
        }
        if (rerenderTrackedChangeIdsOnReject) {
          trackedChanges.forEach((trackedChange, index) => {
            trackedChange.id = `rerendered-${rejectClickCount}-${index + 1}`;
          });
        }
      },
      dispatchEvent() {
        this.click();
        return true;
      }
    };
  }

  function makeTreeNode(filePath) {
    const label = basenameOnlyTreeLabels
      ? String(filePath || '').split('/').filter(Boolean).pop() || filePath
      : filePath;
    const docId = makeStableDocId(filePath);
    return {
      textContent: label,
      parentElement: null,
      getAttribute(attribute) {
        if (attribute === 'data-path' || attribute === 'aria-label' || attribute === 'title') {
          return label;
        }
        if (attribute === 'data-entity-id' || attribute === 'data-doc-id' || attribute === 'data-id') {
          return docId;
        }
        return '';
      },
      dispatchEvent() {
        selectedPath = filePath;
        if (editorSwitchDelayMs > 0) {
          setTimeout(() => {
            editorPath = filePath;
          }, editorSwitchDelayMs);
        } else {
          editorPath = filePath;
        }
        return true;
      }
    };
  }

  function buildInternalDocTree(paths) {
    const root = { name: '', folders: [], docs: [] };
    const folders = new Map([['', root]]);
    for (const filePath of paths) {
      const parts = String(filePath || '').split('/').filter(Boolean);
      const fileName = parts.pop();
      if (!fileName) {
        continue;
      }
      let folderPath = '';
      let parent = root;
      for (const folderName of parts) {
        folderPath = folderPath ? `${folderPath}/${folderName}` : folderName;
        if (!folders.has(folderPath)) {
          const folder = { name: folderName, folders: [], docs: [] };
          folders.set(folderPath, folder);
          parent.folders.push(folder);
        }
        parent = folders.get(folderPath);
      }
      parent.docs.push({
        name: fileName,
        _id: makeStableDocId(filePath)
      });
    }
    return root;
  }

  function makeStableDocId(filePath) {
    let hash = 0;
    for (const char of String(filePath || '')) {
      hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
    }
    return hash.toString(16).padStart(24, '0').slice(0, 24);
  }
}
