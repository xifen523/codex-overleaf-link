'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  compareSemver,
  isNewerStableVersion,
  parseSemver,
  updateError,
  verifySignedReleaseManifest
} = require('./updateTrust');
const { extractVerifiedUpdateBundle } = require('./updateArchive');

const GITHUB_LATEST_URL = 'https://github.com/Ghqqqq/codex-overleaf-link/releases/latest';
const GITHUB_RELEASE_DOWNLOAD_ROOT = 'https://github.com/Ghqqqq/codex-overleaf-link/releases/download';
const EXTENSION_MARKER = '.codex-overleaf-managed-extension.json';
const NATIVE_MARKER = '.codex-overleaf-managed-native.json';
const JOURNAL_FILE = 'transaction.json';
const CANDIDATE_FILE = 'candidate.json';
const COOLDOWN_FILE = 'cooldowns.json';
const UPDATE_METHODS = new Set([
  'update.status',
  'update.check',
  'update.stage',
  'update.canApply',
  'update.apply',
  'update.confirm',
  'update.rollback'
]);
const RELEASE_ASSET_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com'
]);

function isUpdateMethod(method) {
  return UPDATE_METHODS.has(method);
}

async function handleUpdateRequest(request, options = {}) {
  if (!request || !isUpdateMethod(request.method)) {
    return errorResponse(request?.id, 'unknown_update_method', 'Unknown managed update method.');
  }
  try {
    const context = getManagedContext(options);
    if (!context.managed) {
      throw updateError('update_not_managed', 'Run install-managed once to enable coordinated automatic updates.');
    }
    switch (request.method) {
      case 'update.status':
        return okResponse(request.id, recoverAndReadStatus(context));
      case 'update.check':
        return okResponse(request.id, await checkForUpdate(context, request.params || {}, options));
      case 'update.stage':
        return okResponse(request.id, await stageCandidate(context, options));
      case 'update.canApply':
        return okResponse(request.id, getApplyGate(options));
      case 'update.apply':
        return okResponse(request.id, applyStagedUpdate(context, request.params || {}, options));
      case 'update.confirm':
        return okResponse(request.id, confirmUpdate(context, request.params || {}));
      case 'update.rollback':
        return okResponse(request.id, rollbackUpdate(context, request.params || {}));
      default:
        throw updateError('unknown_update_method', 'Unknown managed update method.');
    }
  } catch (error) {
    return errorResponse(request.id, safeErrorCode(error), safeErrorMessage(error));
  }
}

async function checkForUpdate(context, params = {}, options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw updateError('update_network_unavailable', 'This Node runtime cannot check GitHub Releases.');
  }
  const currentVersion = normalizeCurrentVersion(params.currentVersion, context);
  const headers = {
    Accept: 'text/html,application/xhtml+xml',
    'User-Agent': 'codex-overleaf-link-updater'
  };
  if (params.etag && typeof params.etag === 'string' && params.etag.length < 300) {
    headers['If-None-Match'] = params.etag;
  }
  const releaseResponse = await fetchWithTimeout(fetchImpl, GITHUB_LATEST_URL, {
    headers,
    method: 'HEAD',
    redirect: 'follow'
  }, 12000);
  if (releaseResponse.status === 304) {
    return { managed: true, available: false, reason: 'not_modified', currentVersion, etag: params.etag || '' };
  }
  if (!releaseResponse.ok) {
    throw updateError('update_github_http_error', 'GitHub update check failed with HTTP ' + releaseResponse.status + '.');
  }
  const releaseTag = parseStableReleaseTag(releaseResponse.url);
  if (!releaseTag) {
    throw updateError('update_github_response_invalid', 'GitHub latest release did not resolve to a stable semantic-version tag.');
  }
  const latestVersion = releaseTag.slice(1);
  if (!isNewerStableVersion(latestVersion, currentVersion)) {
    return {
      managed: true,
      available: false,
      reason: compareSemver(latestVersion, currentVersion) === 0 ? 'up_to_date' : 'downgrade_rejected',
      currentVersion,
      latestVersion,
      etag: releaseResponse.headers.get('etag') || ''
    };
  }
  const cooldowns = readJsonSafe(path.join(context.updatesRoot, COOLDOWN_FILE), {});
  if (Number(cooldowns[latestVersion]?.until || 0) > Date.now()) {
    return { managed: true, available: false, reason: 'cooldown', currentVersion, latestVersion, etag: releaseResponse.headers.get('etag') || '' };
  }

  const manifestBytes = await fetchReleaseAsset(
    fetchImpl,
    buildReleaseAssetUrl(releaseTag, 'release-manifest.json'),
    256 * 1024
  );
  const signatureBytes = await fetchReleaseAsset(
    fetchImpl,
    buildReleaseAssetUrl(releaseTag, 'release-manifest.sig'),
    16 * 1024
  );
  const manifest = verifySignedReleaseManifest(manifestBytes, signatureBytes);
  if (manifest.version !== latestVersion || manifest.tag !== releaseTag) {
    throw updateError('update_release_manifest_mismatch', 'GitHub release tag does not match the signed update manifest.');
  }
  const candidate = {
    checkedAt: new Date().toISOString(),
    currentVersion,
    latestVersion,
    etag: releaseResponse.headers.get('etag') || '',
    manifestBase64: manifestBytes.toString('base64'),
    signatureBase64: signatureBytes.toString('base64'),
    bundleUrl: buildReleaseAssetUrl(releaseTag, manifest.updateBundle.name)
  };
  atomicWriteJson(path.join(context.updatesRoot, CANDIDATE_FILE), candidate);
  return { managed: true, available: true, currentVersion, latestVersion, etag: candidate.etag };
}

function parseStableReleaseTag(value) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.hostname !== 'github.com') return '';
    const match = url.pathname.match(/^\/Ghqqqq\/codex-overleaf-link\/releases\/tag\/(v\d+\.\d+\.\d+)\/?$/i);
    return match?.[1] || '';
  } catch (_error) {
    return '';
  }
}

function buildReleaseAssetUrl(tag, assetName) {
  if (!/^v\d+\.\d+\.\d+$/.test(String(tag || '')) ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(String(assetName || ''))) {
    throw updateError('update_release_asset_invalid', 'Stable release asset metadata is invalid.');
  }
  return GITHUB_RELEASE_DOWNLOAD_ROOT + '/' + tag + '/' + encodeURIComponent(assetName);
}

async function stageCandidate(context, options = {}) {
  const candidate = readJsonSafe(path.join(context.updatesRoot, CANDIDATE_FILE), null);
  if (!candidate) {
    throw updateError('update_candidate_missing', 'Check for an update before staging it.');
  }
  const manifestBytes = Buffer.from(candidate.manifestBase64 || '', 'base64');
  const signatureBytes = Buffer.from(candidate.signatureBase64 || '', 'base64');
  const manifest = verifySignedReleaseManifest(manifestBytes, signatureBytes);
  const activeVersion = readVersionPointer(context.nativeRoot, 'active-version');
  if (!isNewerStableVersion(manifest.version, activeVersion)) {
    throw updateError('update_candidate_stale', 'The staged update is no longer newer than the active version.');
  }
  const transactionId = crypto.randomUUID();
  const stageRoot = path.join(context.updatesRoot, 'staging-' + transactionId);
  fs.mkdirSync(stageRoot, { recursive: true, mode: 0o700 });
  const archivePath = path.join(stageRoot, manifest.updateBundle.name);
  const fetchImpl = options.fetch || globalThis.fetch;
  const bundleBytes = await fetchReleaseAsset(fetchImpl, candidate.bundleUrl, manifest.updateBundle.size + 1);
  if (bundleBytes.length !== manifest.updateBundle.size) {
    throw updateError('update_bundle_size_mismatch', 'Downloaded update bundle size does not match the signed manifest.');
  }
  const hash = crypto.createHash('sha256').update(bundleBytes).digest('hex');
  if (hash !== manifest.updateBundle.sha256) {
    throw updateError('update_bundle_hash_mismatch', 'Downloaded update bundle hash does not match the signed manifest.');
  }
  fs.writeFileSync(archivePath, bundleBytes, { mode: 0o600 });
  const payloadRoot = path.join(stageRoot, 'payload');
  extractVerifiedUpdateBundle({ archivePath, destinationRoot: payloadRoot });
  verifyStagedPair(payloadRoot, manifest.version);
  const journal = {
    id: transactionId,
    state: 'staged',
    sourceVersion: activeVersion,
    sourcePreviousVersion: readVersionPointer(context.nativeRoot, 'previous-version'),
    targetVersion: manifest.version,
    stageRoot,
    payloadRoot,
    manifestSha256: crypto.createHash('sha256').update(manifestBytes).digest('hex'),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  writeJournal(context, journal);
  return { transactionId, targetVersion: manifest.version, state: journal.state };
}

function getApplyGate(options = {}) {
  const state = typeof options.getWorkState === 'function'
    ? options.getWorkState()
    : { projectLocks: 0, runControllers: 0 };
  const blockers = [];
  if (Number(state.projectLocks || 0) > 0) blockers.push('native_project_locked');
  if (Number(state.runControllers || 0) > 0) blockers.push('native_run_active');
  return { idle: blockers.length === 0, blockers, workState: state };
}

function applyStagedUpdate(context, params = {}, options = {}) {
  const gate = getApplyGate(options);
  if (!gate.idle) {
    throw updateError('update_native_busy', 'Native host is still processing a Codex task.');
  }
  const journal = readJournal(context);
  if (!journal || journal.state !== 'staged') {
    throw updateError('update_not_staged', 'No verified update is ready to apply.');
  }
  if (params.transactionId && params.transactionId !== journal.id) {
    throw updateError('update_transaction_mismatch', 'Update transaction id does not match the staged update.');
  }
  assertManagedMarkers(context);
  const extensionRuntime = path.join(context.extensionRoot, 'runtime');
  const previousRuntime = path.join(context.extensionRoot, 'slots', 'previous', 'runtime');
  const stagedExtension = path.join(journal.payloadRoot, 'extension-runtime');
  const stagedNative = path.join(journal.payloadRoot, 'native-runtime');
  const targetNative = path.join(context.nativeRoot, 'versions', journal.targetVersion);
  const manifestPath = path.join(context.extensionRoot, 'manifest.json');
  const previousManifest = fs.readFileSync(manifestPath, 'utf8');
  writeJournal(context, { ...journal, state: 'applying', previousManifest, updatedAt: new Date().toISOString() });

  try {
    fs.rmSync(path.dirname(previousRuntime), { recursive: true, force: true });
    fs.mkdirSync(path.dirname(previousRuntime), { recursive: true });
    fs.renameSync(extensionRuntime, previousRuntime);
    fs.renameSync(stagedExtension, extensionRuntime);
    fs.rmSync(targetNative, { recursive: true, force: true });
    fs.renameSync(stagedNative, targetNative);
    atomicWriteText(path.join(context.nativeRoot, 'previous-version'), journal.sourceVersion + '\n');
    atomicWriteText(path.join(context.nativeRoot, 'active-version'), journal.targetVersion + '\n');
    rewriteManagedManifestVersion(manifestPath, journal.targetVersion);
  } catch (error) {
    rollbackFiles(context, { ...journal, previousManifest });
    throw updateError('update_apply_failed', 'Managed update could not be applied atomically.', { cause: error });
  }
  const awaiting = {
    ...journal,
    previousManifest,
    state: 'awaiting_health',
    appliedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  writeJournal(context, awaiting);
  return { transactionId: journal.id, targetVersion: journal.targetVersion, state: awaiting.state };
}

function confirmUpdate(context, params = {}) {
  const journal = readJournal(context);
  if (!journal || journal.state !== 'awaiting_health') {
    throw updateError('update_confirmation_unexpected', 'No update is waiting for health confirmation.');
  }
  if (params.transactionId !== journal.id || params.extensionVersion !== journal.targetVersion || params.nativeVersion !== journal.targetVersion) {
    throw updateError('update_health_version_mismatch', 'Extension and native host did not confirm the same target version.');
  }
  const manifest = readJsonSafe(path.join(context.extensionRoot, 'manifest.json'), null);
  if (readVersionPointer(context.nativeRoot, 'active-version') !== journal.targetVersion || manifest?.version !== journal.targetVersion) {
    throw updateError('update_health_version_mismatch', 'Managed files do not match the confirmed target version.');
  }
  writeJournal(context, {
    ...journal,
    state: 'committed',
    confirmedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  pruneNativeVersions(context.nativeRoot, new Set([journal.targetVersion, journal.sourceVersion]));
  cleanupStage(journal.stageRoot);
  return { version: journal.targetVersion, state: 'committed' };
}

function rollbackUpdate(context, params = {}) {
  const journal = readJournal(context);
  if (!journal || !['applying', 'awaiting_health', 'committed'].includes(journal.state)) {
    throw updateError('update_rollback_unavailable', 'No applied update is available for rollback.');
  }
  rollbackFiles(context, journal);
  const cooldowns = readJsonSafe(path.join(context.updatesRoot, COOLDOWN_FILE), {});
  cooldowns[journal.targetVersion] = {
    until: Date.now() + 24 * 60 * 60 * 1000,
    reasonCode: normalizeReasonCode(params.reasonCode)
  };
  atomicWriteJson(path.join(context.updatesRoot, COOLDOWN_FILE), cooldowns);
  writeJournal(context, {
    ...journal,
    state: 'rolled_back',
    reasonCode: normalizeReasonCode(params.reasonCode),
    rolledBackAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    previousManifest: undefined
  });
  cleanupStage(journal.stageRoot);
  return { version: journal.sourceVersion, state: 'rolled_back' };
}

function rollbackFiles(context, journal) {
  const runtime = path.join(context.extensionRoot, 'runtime');
  const previousRuntime = path.join(context.extensionRoot, 'slots', 'previous', 'runtime');
  if (fs.existsSync(previousRuntime)) {
    fs.rmSync(runtime, { recursive: true, force: true });
    fs.renameSync(previousRuntime, runtime);
    fs.rmSync(path.dirname(previousRuntime), { recursive: true, force: true });
  }
  if (journal.previousManifest) {
    atomicWriteText(path.join(context.extensionRoot, 'manifest.json'), journal.previousManifest);
  }
  if (parseSemver(journal.sourceVersion)) {
    atomicWriteText(path.join(context.nativeRoot, 'active-version'), journal.sourceVersion + '\n');
  }
  const sourcePrevious = parseSemver(journal.sourcePreviousVersion) ? journal.sourcePreviousVersion : '';
  if (sourcePrevious && fs.existsSync(path.join(context.nativeRoot, 'versions', sourcePrevious))) {
    atomicWriteText(path.join(context.nativeRoot, 'previous-version'), sourcePrevious + '\n');
  } else {
    fs.rmSync(path.join(context.nativeRoot, 'previous-version'), { force: true });
  }
}

function recoverAndReadStatus(context) {
  let journal = readJournal(context);
  if (journal?.state === 'applying') {
    rollbackFiles(context, journal);
    journal = { ...journal, state: 'rolled_back', reasonCode: 'update_interrupted', updatedAt: new Date().toISOString() };
    writeJournal(context, journal);
  }
  if (journal?.state === 'rolled_back') {
    pruneNativeVersions(context.nativeRoot, new Set([
      readVersionPointer(context.nativeRoot, 'active-version'),
      readVersionPointer(context.nativeRoot, 'previous-version')
    ]));
  }
  return {
    managed: true,
    activeVersion: readVersionPointer(context.nativeRoot, 'active-version'),
    previousVersion: readVersionPointer(context.nativeRoot, 'previous-version'),
    transaction: journal ? publicTransaction(journal) : null
  };
}

function pruneNativeVersions(nativeRoot, retainedVersions) {
  const versionsRoot = path.join(nativeRoot, 'versions');
  let entries = [];
  try {
    entries = fs.readdirSync(versionsRoot, { withFileTypes: true });
  } catch (_error) {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && parseSemver(entry.name) && !retainedVersions.has(entry.name)) {
      fs.rmSync(path.join(versionsRoot, entry.name), { recursive: true, force: true });
    }
  }
}

function getManagedContext(options = {}) {
  const env = options.env || process.env;
  const nativeRoot = path.resolve(options.nativeRoot || env.CODEX_OVERLEAF_MANAGED_NATIVE_ROOT || '');
  const extensionRoot = path.resolve(options.extensionRoot || env.CODEX_OVERLEAF_MANAGED_EXTENSION_ROOT || '');
  const managed = env.CODEX_OVERLEAF_MANAGED === '1'
    && Boolean(nativeRoot)
    && Boolean(extensionRoot)
    && isManagedMarker(readJsonSafe(path.join(nativeRoot, NATIVE_MARKER), null), 'native')
    && isManagedMarker(readJsonSafe(path.join(extensionRoot, EXTENSION_MARKER), null), 'extension');
  const updatesRoot = managed ? path.join(nativeRoot, 'updates') : '';
  if (managed) fs.mkdirSync(updatesRoot, { recursive: true, mode: 0o700 });
  return { env, managed, nativeRoot, extensionRoot, updatesRoot };
}

function assertManagedMarkers(context) {
  if (!context.managed) throw updateError('update_not_managed', 'Managed installation markers are missing.');
}

function isManagedMarker(marker, kind) {
  return marker?.managedBy === 'codex-overleaf-link' && marker?.kind === kind && marker?.bootstrapProtocol === 1;
}

function verifyStagedPair(payloadRoot, targetVersion) {
  const nativePackage = readJsonSafe(path.join(payloadRoot, 'native-runtime', 'package.json'), null);
  if (nativePackage?.version !== targetVersion) {
    throw updateError('update_native_version_mismatch', 'Staged native runtime version does not match the signed release.');
  }
  const compatibilityPath = path.join(payloadRoot, 'extension-runtime', 'src', 'shared', 'compatibility.js');
  const compatibility = fs.readFileSync(compatibilityPath, 'utf8');
  const match = compatibility.match(/BUILD_TARGET_VERSION\s*=\s*['"]([^'"]+)['"]/);
  if (match?.[1] !== targetVersion) {
    throw updateError('update_extension_version_mismatch', 'Staged extension runtime version does not match the signed release.');
  }
}

function normalizeCurrentVersion(value, context) {
  const requested = String(value || '');
  const active = readVersionPointer(context.nativeRoot, 'active-version');
  if (parseSemver(requested) && requested === active) return requested;
  if (parseSemver(active)) return active;
  throw updateError('update_current_version_invalid', 'Managed installation has no valid active version.');
}

function readVersionPointer(root, name) {
  try {
    const value = fs.readFileSync(path.join(root, name), 'utf8').trim();
    return parseSemver(value) ? value : '';
  } catch (_error) {
    return '';
  }
}

function rewriteManagedManifestVersion(manifestPath, version) {
  const manifest = readJsonSafe(manifestPath, null);
  if (!manifest || manifest.manifest_version !== 3 || !manifest.background?.service_worker?.startsWith('bootstrap/')) {
    throw updateError('update_bootstrap_manifest_invalid', 'Managed Bootstrap manifest cannot be rewritten safely.');
  }
  manifest.version = version;
  atomicWriteText(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

async function fetchReleaseAsset(fetchImpl, url, limit) {
  const parsed = new URL(String(url || ''));
  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || !parsed.pathname.startsWith('/Ghqqqq/codex-overleaf-link/releases/download/')) {
    throw updateError('update_asset_url_forbidden', 'Release asset URL is outside the trusted repository.');
  }
  const response = await fetchWithTimeout(fetchImpl, parsed.href, { redirect: 'follow' }, 20000);
  if (!response.ok) throw updateError('update_asset_http_error', 'Release asset download failed with HTTP ' + response.status + '.');
  const finalUrl = new URL(response.url || parsed.href);
  if (finalUrl.protocol !== 'https:' || !RELEASE_ASSET_HOSTS.has(finalUrl.hostname)) {
    throw updateError('update_asset_redirect_forbidden', 'Release asset redirected to an untrusted host.');
  }
  return readResponseBytes(response, limit);
}

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (error) {
    throw updateError('update_network_failed', 'Update network request failed.', { cause: error });
  } finally {
    clearTimeout(timer);
  }
}

async function readResponseBytes(response, limit) {
  const declared = Number(response.headers?.get?.('content-length') || 0);
  if (declared > limit) throw updateError('update_download_limit', 'Update response exceeds its size limit.');
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > limit) throw updateError('update_download_limit', 'Update response exceeds its size limit.');
  return buffer;
}

function findReleaseAsset(assets, name) {
  const matches = assets.filter(asset => asset?.name === name && typeof asset.browser_download_url === 'string');
  if (matches.length !== 1) throw updateError('update_asset_missing', 'Release must contain exactly one ' + name + ' asset.');
  return matches[0];
}

function publicTransaction(journal) {
  return {
    id: journal.id,
    state: journal.state,
    sourceVersion: journal.sourceVersion,
    targetVersion: journal.targetVersion,
    createdAt: journal.createdAt,
    appliedAt: journal.appliedAt,
    confirmedAt: journal.confirmedAt,
    rolledBackAt: journal.rolledBackAt,
    reasonCode: journal.reasonCode || ''
  };
}

function readJournal(context) {
  return readJsonSafe(path.join(context.updatesRoot, JOURNAL_FILE), null);
}

function writeJournal(context, journal) {
  atomicWriteJson(path.join(context.updatesRoot, JOURNAL_FILE), journal);
}

function atomicWriteJson(target, value) {
  atomicWriteText(target, JSON.stringify(value, null, 2) + '\n');
}

function atomicWriteText(target, value) {
  const temp = target + '.tmp-' + process.pid + '-' + Date.now();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(temp, value, { mode: 0o600 });
  fs.renameSync(temp, target);
}

function readJsonSafe(target, fallback) {
  try {
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (_error) {
    return fallback;
  }
}

function cleanupStage(stageRoot) {
  if (stageRoot && path.basename(stageRoot).startsWith('staging-')) {
    fs.rmSync(stageRoot, { recursive: true, force: true });
  }
}

function normalizeReasonCode(value) {
  return /^[a-z0-9_]{1,80}$/.test(String(value || '')) ? String(value) : 'update_health_failed';
}

function safeErrorCode(error) {
  return /^[a-z0-9_]{1,80}$/.test(String(error?.code || '')) ? error.code : 'update_internal_error';
}

function safeErrorMessage(error) {
  return String(error?.message || 'Managed update failed.').replace(/(?:file:\/\/)?(?:[A-Za-z]:[\\/]|\/Users\/|\/home\/)[^\s]*/g, '[local path]').slice(0, 500);
}

function okResponse(id, result) {
  return { id, ok: true, result };
}

function errorResponse(id, code, message) {
  return { id, ok: false, error: { code, message } };
}

module.exports = {
  GITHUB_LATEST_URL,
  applyStagedUpdate,
  checkForUpdate,
  confirmUpdate,
  getApplyGate,
  getManagedContext,
  handleUpdateRequest,
  isUpdateMethod,
  rollbackUpdate
};
