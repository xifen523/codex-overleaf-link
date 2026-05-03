(function initStorageMigration(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafStorageMigration = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function storageMigrationFactory() {
  'use strict';

  var PREFS_KEY = 'codexOverleafPrefs';

  function runMigrationIfNeeded(projectId, legacyStorageKey) {
    var StorageDb = (typeof window !== 'undefined' && window.CodexOverleafStorageDb)
      ? window.CodexOverleafStorageDb
      : require('./storageDb');

    return chrome.storage.local.get([PREFS_KEY, legacyStorageKey]).then(function (stored) {
      var prefs = stored[PREFS_KEY] || {};
      var schemaVersion = prefs.storageSchemaVersion || 0;

      if (schemaVersion >= StorageDb.TARGET_SCHEMA_VERSION) {
        var activeSessionByProject = prefs.activeSessionByProject || {};
        var activeSessionId = activeSessionByProject[projectId] || '';
        return StorageDb.getAllByIndex('sessions', 'projectId', projectId).then(function (sessions) {
          return { prefs: prefs, sessions: sessions, activeSessionId: activeSessionId, migrated: false };
        });
      }

      // Migration v0 → v1
      var legacyBlob = stored[legacyStorageKey] || {};
      var legacySessions = Array.isArray(legacyBlob.sessions) ? legacyBlob.sessions : [];
      var migratedSessions = [];

      for (var i = 0; i < legacySessions.length; i++) {
        var legacy = legacySessions[i];
        if (!legacy || !legacy.id) { continue; }
        var record = StorageDb.buildSessionRecord({
          id: legacy.id,
          projectId: projectId,
          title: legacy.title || '',
          titleSource: legacy.titleSource === 'manual' ? 'manual' : 'auto',
          codexThreadId: '',
          status: 'active',
          focusFiles: Array.isArray(legacy.focusFiles) ? legacy.focusFiles : [],
          history: Array.isArray(legacy.history) ? legacy.history : [],
          runs: Array.isArray(legacy.runs) ? legacy.runs : [],
          task: typeof legacy.task === 'string' ? legacy.task : '',
          mode: typeof legacy.mode === 'string' ? legacy.mode : legacyBlob.mode || '',
          model: typeof legacy.model === 'string' ? legacy.model : legacyBlob.model || '',
          reasoningEffort: typeof legacy.reasoningEffort === 'string' ? legacy.reasoningEffort : legacyBlob.reasoningEffort || '',
          requireReviewing: legacy.requireReviewing !== false && legacyBlob.requireReviewing !== false,
          createdAt: legacy.createdAt,
          updatedAt: legacy.updatedAt
        });
        migratedSessions.push(record);
      }

      var putPromise = migratedSessions.length
        ? StorageDb.putRecords('sessions', migratedSessions)
        : Promise.resolve([]);

      return putPromise.then(function () {
        var newPrefs = StorageDb.extractLightweightPrefs(legacyBlob, projectId);
        newPrefs.activeSessionByProject = StorageDb.buildActiveSessionByProject(
          {},
          projectId,
          legacyBlob.activeSessionId || (migratedSessions.length ? migratedSessions[migratedSessions.length - 1].id : '')
        );

        return chrome.storage.local.set({ [PREFS_KEY]: newPrefs }).then(function () {
          return chrome.storage.local.remove(legacyStorageKey).catch(function () {});
        }).then(function () {
          return {
            prefs: newPrefs,
            sessions: migratedSessions,
            activeSessionId: newPrefs.activeSessionByProject[projectId] || '',
            migrated: true
          };
        });
      });
    });
  }

  function savePrefs(prefs) {
    return chrome.storage.local.set({ [PREFS_KEY]: prefs });
  }

  function loadPrefs() {
    return chrome.storage.local.get([PREFS_KEY]).then(function (stored) {
      return stored[PREFS_KEY] || {};
    });
  }

  return {
    PREFS_KEY: PREFS_KEY,
    runMigrationIfNeeded: runMigrationIfNeeded,
    savePrefs: savePrefs,
    loadPrefs: loadPrefs
  };
});
