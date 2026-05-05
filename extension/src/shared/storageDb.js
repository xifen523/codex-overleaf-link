(function initStorageDb(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafStorageDb = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function storageDbFactory() {
  'use strict';

  var TARGET_SCHEMA_VERSION = 1;
  var DB_NAME = 'codex-overleaf';

  var STORES = {
    sessions: {
      keyPath: 'id',
      indexes: {
        projectId: { keyPath: 'projectId', unique: false },
        updatedAt: { keyPath: 'updatedAt', unique: false }
      }
    },
    turns: {
      keyPath: 'id',
      indexes: {
        sessionId: { keyPath: 'sessionId', unique: false },
        createdAt: { keyPath: 'createdAt', unique: false }
      }
    },
    events: {
      keyPath: 'id',
      indexes: {
        turnId: { keyPath: 'turnId', unique: false },
        index: { keyPath: 'index', unique: false }
      }
    },
    artifacts: {
      keyPath: 'id',
      indexes: {
        turnId: { keyPath: 'turnId', unique: false },
        type: { keyPath: 'type', unique: false }
      }
    }
  };

  // --- Database operations ---

  function openDb() {
    return new Promise(function (resolve, reject) {
      var request = indexedDB.open(DB_NAME, TARGET_SCHEMA_VERSION);
      request.onupgradeneeded = function (event) {
        var db = event.target.result;
        var storeNames = Object.keys(STORES);
        for (var i = 0; i < storeNames.length; i++) {
          var storeName = storeNames[i];
          var storeConfig = STORES[storeName];
          if (!db.objectStoreNames.contains(storeName)) {
            var objectStore = db.createObjectStore(storeName, { keyPath: storeConfig.keyPath });
            var indexNames = Object.keys(storeConfig.indexes);
            for (var j = 0; j < indexNames.length; j++) {
              var indexName = indexNames[j];
              var indexConfig = storeConfig.indexes[indexName];
              objectStore.createIndex(indexName, indexConfig.keyPath, { unique: indexConfig.unique });
            }
          }
        }
      };
      request.onsuccess = function (event) {
        resolve(event.target.result);
      };
      request.onerror = function (event) {
        reject(event.target.error);
      };
    });
  }

  function putRecord(storeName, record) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, 'readwrite');
        var store = tx.objectStore(storeName);
        var request = store.put(record);
        request.onsuccess = function () { resolve(record); };
        request.onerror = function (event) { reject(event.target.error); };
      });
    });
  }

  function putRecords(storeName, records) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, 'readwrite');
        var store = tx.objectStore(storeName);
        for (var i = 0; i < records.length; i++) {
          store.put(records[i]);
        }
        tx.oncomplete = function () { resolve(records); };
        tx.onerror = function (event) { reject(event.target.error); };
      });
    });
  }

  function getRecord(storeName, key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, 'readonly');
        var store = tx.objectStore(storeName);
        var request = store.get(key);
        request.onsuccess = function (event) { resolve(event.target.result || null); };
        request.onerror = function (event) { reject(event.target.error); };
      });
    });
  }

  function getAllByIndex(storeName, indexName, value) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, 'readonly');
        var store = tx.objectStore(storeName);
        var index = store.index(indexName);
        var request = index.getAll(IDBKeyRange.only(value));
        request.onsuccess = function (event) { resolve(event.target.result || []); };
        request.onerror = function (event) { reject(event.target.error); };
      });
    });
  }

  function deleteRecord(storeName, key) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, 'readwrite');
        var store = tx.objectStore(storeName);
        var request = store.delete(key);
        request.onsuccess = function () { resolve(); };
        request.onerror = function (event) { reject(event.target.error); };
      });
    });
  }

  function deleteByIndex(storeName, indexName, value) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, 'readwrite');
        var store = tx.objectStore(storeName);
        var index = store.index(indexName);
        var request = index.openCursor(IDBKeyRange.only(value));
        request.onsuccess = function (event) {
          var cursor = event.target.result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function (event) { reject(event.target.error); };
      });
    });
  }

  function clearStore(storeName) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeName, 'readwrite');
        var store = tx.objectStore(storeName);
        var request = store.clear();
        request.onsuccess = function () { resolve(); };
        request.onerror = function (event) { reject(event.target.error); };
      });
    });
  }

  function clearAllStores() {
    return openDb().then(function (db) {
      var storeNames = Object.keys(STORES);
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(storeNames, 'readwrite');
        for (var i = 0; i < storeNames.length; i++) {
          tx.objectStore(storeNames[i]).clear();
        }
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function (event) { reject(event.target.error); };
      });
    });
  }

  // --- Record builders ---

  function buildSessionRecord(input) {
    var now = new Date().toISOString();
    return {
      id: input.id || generateId('ses'),
      projectId: input.projectId || '',
      title: typeof input.title === 'string' ? input.title : '',
      titleSource: input.titleSource === 'manual' ? 'manual' : 'auto',
      codexThreadId: typeof input.codexThreadId === 'string' ? input.codexThreadId : '',
      status: typeof input.status === 'string' && input.status ? input.status : 'active',
      focusFiles: Array.isArray(input.focusFiles) ? input.focusFiles.slice() : [],
      history: Array.isArray(input.history) ? cloneJsonValue(input.history) : [],
      runs: Array.isArray(input.runs) ? cloneJsonValue(input.runs) : [],
      task: typeof input.task === 'string' ? input.task : '',
      mode: typeof input.mode === 'string' ? input.mode : '',
      model: typeof input.model === 'string' ? input.model : '',
      reasoningEffort: typeof input.reasoningEffort === 'string' ? input.reasoningEffort : '',
      speedTier: typeof input.speedTier === 'string' ? input.speedTier : '',
      requireReviewing: input.requireReviewing !== false,
      createdAt: typeof input.createdAt === 'string' ? input.createdAt : now,
      updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : now
    };
  }

  function buildTurnRecord(input) {
    var now = new Date().toISOString();
    return {
      id: input.id || generateId('turn'),
      sessionId: input.sessionId || '',
      task: typeof input.task === 'string' ? input.task : '',
      mode: typeof input.mode === 'string' ? input.mode : '',
      model: typeof input.model === 'string' ? input.model : '',
      reasoningEffort: typeof input.reasoningEffort === 'string' ? input.reasoningEffort : '',
      speedTier: typeof input.speedTier === 'string' ? input.speedTier : '',
      createdAt: typeof input.createdAt === 'string' ? input.createdAt : now,
      completedAt: typeof input.completedAt === 'string' ? input.completedAt : '',
      finalSummary: typeof input.finalSummary === 'string' ? input.finalSummary : ''
    };
  }

  function buildEventRecord(input) {
    var now = new Date().toISOString();
    return {
      id: input.id || generateId('evt'),
      turnId: input.turnId || '',
      index: typeof input.index === 'number' ? input.index : 0,
      kind: typeof input.kind === 'string' ? input.kind : '',
      text: typeof input.text === 'string' ? input.text : '',
      detail: input.detail !== undefined ? input.detail : null,
      createdAt: typeof input.createdAt === 'string' ? input.createdAt : now
    };
  }

  function buildArtifactRecord(input) {
    var now = new Date().toISOString();
    return {
      id: input.id || generateId('art'),
      turnId: input.turnId || '',
      type: typeof input.type === 'string' ? input.type : '',
      path: typeof input.path === 'string' ? input.path : '',
      payload: input.payload !== undefined ? input.payload : null,
      createdAt: typeof input.createdAt === 'string' ? input.createdAt : now
    };
  }

  // --- Helpers ---

  function extractLightweightPrefs(state, projectId) {
    var prefs = {
      storageSchemaVersion: TARGET_SCHEMA_VERSION,
      model: typeof state.model === 'string' ? state.model : '',
      reasoningEffort: typeof state.reasoningEffort === 'string' ? state.reasoningEffort : '',
      speedTier: typeof state.speedTier === 'string' ? state.speedTier : '',
      mode: typeof state.mode === 'string' ? state.mode : '',
      locale: typeof state.locale === 'string' ? state.locale : '',
      requireReviewing: state.requireReviewing !== false,
      autoRecompile: state.autoRecompile !== false,
      panelWidth: Number.isFinite(Number(state.panelWidth)) ? Math.round(Number(state.panelWidth)) : 0,
      activeSessionByProject: state.activeSessionByProject || {},
      experimentalOtByProject: normalizeBooleanMap(state.experimentalOtByProject)
    };
    return prefs;
  }

  function normalizeBooleanMap(value) {
    var result = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return result;
    }
    var keys = Object.keys(value);
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (!key) {
        continue;
      }
      result[key] = value[key] === true;
    }
    return result;
  }

  function buildActiveSessionByProject(existing, projectId, sessionId) {
    var result = {};
    if (existing && typeof existing === 'object') {
      var keys = Object.keys(existing);
      for (var i = 0; i < keys.length; i++) {
        result[keys[i]] = existing[keys[i]];
      }
    }
    if (typeof projectId === 'string' && projectId) {
      result[projectId] = sessionId || '';
    }
    return result;
  }

  function createEventBuffer(turnId, flushIntervalMs, maxBatchSize) {
    if (flushIntervalMs === undefined) { flushIntervalMs = 500; }
    if (maxBatchSize === undefined) { maxBatchSize = 20; }

    var buffer = [];
    var timer = null;

    function scheduleFlush() {
      if (timer !== null) { return; }
      timer = setTimeout(function () {
        timer = null;
        flush();
      }, flushIntervalMs);
    }

    function flush() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (buffer.length === 0) { return Promise.resolve([]); }
      var batch = buffer.splice(0);
      return putRecords('events', batch);
    }

    function add(event) {
      var record = buildEventRecord(Object.assign({}, event, { turnId: turnId }));
      buffer.push(record);
      if (buffer.length >= maxBatchSize) {
        flush();
      } else {
        scheduleFlush();
      }
      return record;
    }

    return { add: add, flush: flush };
  }

  // --- Utilities ---

  function generateId(prefix) {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  }

  function cloneJsonValue(value) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_error) {
      return Array.isArray(value) ? value.slice() : value;
    }
  }

  return {
    TARGET_SCHEMA_VERSION: TARGET_SCHEMA_VERSION,
    DB_NAME: DB_NAME,
    STORES: STORES,
    openDb: openDb,
    putRecord: putRecord,
    putRecords: putRecords,
    getRecord: getRecord,
    getAllByIndex: getAllByIndex,
    deleteRecord: deleteRecord,
    deleteByIndex: deleteByIndex,
    clearStore: clearStore,
    clearAllStores: clearAllStores,
    buildSessionRecord: buildSessionRecord,
    buildTurnRecord: buildTurnRecord,
    buildEventRecord: buildEventRecord,
    buildArtifactRecord: buildArtifactRecord,
    extractLightweightPrefs: extractLightweightPrefs,
    buildActiveSessionByProject: buildActiveSessionByProject,
    createEventBuffer: createEventBuffer
  };
});
