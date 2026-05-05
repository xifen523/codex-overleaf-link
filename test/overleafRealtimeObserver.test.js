const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function loadObserverFactory() {
  return require('../extension/src/page/overleafRealtimeObserver');
}

function createHarness(options = {}) {
  const Observer = loadObserverFactory();
  const listeners = [];
  const removals = [];
  let activePath = options.activePath ?? 'main.tex';
  let editorText = options.editorText ?? 'hello';
  let now = options.now ?? Date.parse('2026-05-05T00:00:00.000Z');
  let dispatchCount = 0;
  let socketHookCount = 0;
  const normalizeCalls = [];

  const document = {
    addEventListener(type, handler, optionsArg) {
      listeners.push({ type, handler, options: optionsArg });
    },
    removeEventListener(type, handler, optionsArg) {
      removals.push({ type, handler, options: optionsArg });
    }
  };
  const window = options.window || {
    overleaf: {
      realtime: {
        socket: {
          on() {
            socketHookCount += 1;
          }
        },
        sourceText: 'SECRET_SOURCE_BODY'
      },
      editor: {
        doc: {
          text: 'SECRET_EDITOR_TEXT'
        }
      }
    },
    Overleaf: {
      SocketIoConnection: {},
      sourceText: 'SECRET_OVERLEAF_TEXT'
    },
    _ide: {
      project: {
        docs: []
      },
      collab: {
        channel: {}
      }
    },
    OL: {
      eventBus: {}
    }
  };
  const editorView = options.editorView || {
    state: {
      doc: {
        toString() {
          return editorText;
        }
      }
    },
    dispatch() {
      dispatchCount += 1;
    }
  };
  const deps = {
    document,
    window,
    otText: {
      normalizeObservedTextEvent(input) {
        normalizeCalls.push(input);
        return {
          ok: true,
          path: input.path,
          previousContent: input.previousContent,
          nextContent: input.nextContent,
          baseHash: `base:${input.previousContent.length}`,
          nextHash: `next:${input.nextContent.length}`,
          ops: [{ p: input.previousContent.length, i: input.nextContent.slice(input.previousContent.length) }],
          observedAt: input.observedAt,
          observedVersion: null,
          source: input.source
        };
      },
      applyTextOps() {
        throw new Error('observer must not apply text operations');
      }
    },
    getActiveFilePath() {
      return activePath;
    },
    readActiveEditorText() {
      return editorText;
    },
    getCodeMirrorEditorView() {
      return editorView;
    },
    collectDocRecords() {
      return [
        {
          path: 'main.tex',
          id: 'doc-1',
          content: 'SECRET_DOC_RECORD_TEXT'
        }
      ];
    },
    now() {
      return now;
    }
  };

  return {
    document,
    get dispatchCount() {
      return dispatchCount;
    },
    fireInput(event = { target: {} }) {
      const listener = listeners.find(item => item.type === 'input');
      assert.ok(listener, 'input listener should be registered');
      listener.handler(event);
    },
    get normalizeCalls() {
      return normalizeCalls;
    },
    observer: Observer.create(deps),
    removals,
    setActivePath(value) {
      activePath = value;
    },
    setEditorText(value) {
      editorText = value;
    },
    setNow(value) {
      now = value;
    },
    get socketHookCount() {
      return socketHookCount;
    },
    listeners
  };
}

test('start initializes active editor state and queues an event for same-file input changes', () => {
  const harness = createHarness();

  const startStatus = harness.observer.start({ projectId: 'project-123' });

  assert.equal(startStatus.status, 'observing');
  assert.equal(startStatus.running, true);
  assert.equal(startStatus.strategy, 'active-editor');
  assert.equal(startStatus.activePath, 'main.tex');
  assert.equal(startStatus.queuedEventCount, 0);
  assert.equal(harness.listeners.length, 1);
  assert.equal(harness.listeners[0].type, 'input');
  assert.equal(harness.listeners[0].options, true);

  harness.fireInput();
  assert.equal(harness.normalizeCalls.length, 0, 'unchanged input must not queue empty operations');

  harness.setEditorText('hello world');
  harness.fireInput();

  assert.deepEqual(harness.normalizeCalls, [
    {
      path: 'main.tex',
      previousContent: 'hello',
      nextContent: 'hello world',
      observedAt: '2026-05-05T00:00:00.000Z',
      source: 'active-editor'
    }
  ]);
  assert.equal(harness.observer.getStatus().queuedEventCount, 1);
  assert.equal(harness.observer.getStatus().lastEventAt, '2026-05-05T00:00:00.000Z');
});

test('drainEvents returns queued events and empties the queue', () => {
  const harness = createHarness();
  harness.observer.start({ projectId: 'project-123' });
  harness.setEditorText('hello world');
  harness.fireInput();

  const events = harness.observer.drainEvents();

  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    ok: true,
    path: 'main.tex',
    previousContent: 'hello',
    nextContent: 'hello world',
    baseHash: 'base:5',
    nextHash: 'next:11',
    ops: [{ p: 5, i: ' world' }],
    observedAt: '2026-05-05T00:00:00.000Z',
    observedVersion: null,
    source: 'active-editor'
  });
  assert.deepEqual(harness.observer.drainEvents(), []);
  assert.equal(harness.observer.getStatus().queuedEventCount, 0);
});

test('active file switches update the baseline without queueing an event', () => {
  const harness = createHarness();
  harness.observer.start({ projectId: 'project-123' });

  harness.setActivePath('sections/intro.tex');
  harness.setEditorText('intro baseline');
  harness.fireInput();

  assert.equal(harness.observer.getStatus().activePath, 'sections/intro.tex');
  assert.equal(harness.observer.getStatus().queuedEventCount, 0);
  assert.equal(harness.normalizeCalls.length, 0);

  harness.setEditorText('intro baseline plus edit');
  harness.fireInput();

  assert.equal(harness.normalizeCalls.length, 1);
  assert.equal(harness.normalizeCalls[0].path, 'sections/intro.tex');
  assert.equal(harness.normalizeCalls[0].previousContent, 'intro baseline');
  assert.equal(harness.normalizeCalls[0].nextContent, 'intro baseline plus edit');
});

test('missing active path reports unavailable status with a stable reason', () => {
  const harness = createHarness({ activePath: '' });

  const status = harness.observer.start({ projectId: 'project-123' });

  assert.equal(status.status, 'unavailable');
  assert.equal(status.running, true);
  assert.equal(status.reason, 'missing_active_path');
  assert.equal(status.lastErrorCode, 'missing_active_path');
  assert.equal(status.activePath, '');
});

test('observer remains read-only and diagnostics expose only channel key names', () => {
  const harness = createHarness();

  harness.observer.start({ projectId: 'project-123' });
  harness.setEditorText('hello world');
  harness.fireInput();

  assert.equal(harness.dispatchCount, 0);
  assert.equal(harness.socketHookCount, 0);

  const status = harness.observer.getStatus();
  const candidateKeys = status.channelCandidates.flatMap(candidate =>
    candidate.keyPaths.map(keyPath => `${candidate.root}:${keyPath}`)
  );
  assert.ok(candidateKeys.includes('overleaf:realtime'));
  assert.ok(candidateKeys.includes('overleaf:realtime.socket'));
  assert.ok(candidateKeys.includes('overleaf:editor.doc'));
  assert.ok(candidateKeys.includes('Overleaf:SocketIoConnection'));
  assert.ok(candidateKeys.includes('_ide:collab.channel'));
  assert.ok(candidateKeys.includes('OL:eventBus'));
  assert.doesNotMatch(JSON.stringify(status.channelCandidates), /SECRET_/);
});

test('stop removes the active-editor input listener and returns off status', () => {
  const harness = createHarness();
  harness.observer.start({ projectId: 'project-123' });

  const status = harness.observer.stop();

  assert.equal(harness.removals.length, 1);
  assert.equal(harness.removals[0].type, 'input');
  assert.equal(harness.removals[0].options, true);
  assert.equal(status.status, 'off');
  assert.equal(status.running, false);
});

test('exposes a browser global and CommonJS factory', () => {
  const Observer = loadObserverFactory();
  assert.equal(typeof Observer.create, 'function');

  const source = fs.readFileSync(
    path.join(__dirname, '../extension/src/page/overleafRealtimeObserver.js'),
    'utf8'
  );
  const context = {};
  context.window = context;
  context.globalThis = context;

  vm.runInNewContext(source, context);

  assert.equal(typeof context.CodexOverleafRealtimeObserver.create, 'function');
});
