#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { verifySignedReleaseManifest } = require('../native-host/src/updateTrust.js');
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY_ID = 'release-2026-01';

export function signReleaseManifest(options = {}) {
  const version = options.version || JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8')).version;
  const releaseDir = path.resolve(options.releaseDir || path.join(repoRoot, 'dist/releases', 'v' + version));
  const manifestPath = path.join(releaseDir, 'release-manifest.json');
  const signaturePath = path.join(releaseDir, 'release-manifest.sig');
  const manifestBytes = fs.readFileSync(manifestPath);
  const privateKey = options.privateKey || readPrivateKey();
  const signature = crypto.sign(null, manifestBytes, privateKey);
  const envelope = Buffer.from(JSON.stringify({
    keyId: KEY_ID,
    algorithm: 'Ed25519',
    signature: signature.toString('base64')
  }, null, 2) + '\n');
  verifySignedReleaseManifest(manifestBytes, envelope);
  fs.writeFileSync(signaturePath, envelope, { mode: 0o644 });
  rewriteChecksums(releaseDir);
  return { releaseDir, manifestPath, signaturePath, keyId: KEY_ID };
}

function readPrivateKey() {
  const encoded = process.env.CODEX_OVERLEAF_UPDATE_SIGNING_KEY_B64;
  if (encoded) {
    return Buffer.from(encoded, 'base64').toString('utf8');
  }
  const keyPath = process.env.CODEX_OVERLEAF_UPDATE_SIGNING_KEY_PATH
    || path.join(os.homedir(), '.codex-overleaf/release-signing/update-ed25519-private.pem');
  try {
    return fs.readFileSync(keyPath, 'utf8');
  } catch (_error) {
    throw new Error('Release signing key is unavailable. Set CODEX_OVERLEAF_UPDATE_SIGNING_KEY_B64.');
  }
}

function rewriteChecksums(releaseDir) {
  const names = fs.readdirSync(releaseDir)
    .filter(name => name !== '.codex-overleaf-release-output' && name !== 'SHA256SUMS')
    .sort();
  const rows = names.map(name => {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(path.join(releaseDir, name))).digest('hex');
    return hash + '  ' + name;
  });
  fs.writeFileSync(path.join(releaseDir, 'SHA256SUMS'), rows.join('\n') + '\n', 'utf8');
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--dir') {
      if (!argv[index + 1]) throw new Error('--dir requires a path.');
      parsed.releaseDir = argv[++index];
    } else {
      throw new Error('Unknown option: ' + argv[index]);
    }
  }
  return parsed;
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  try {
    const result = signReleaseManifest(parseArgs(process.argv.slice(2)));
    console.log('Signed release manifest with ' + result.keyId + '.');
  } catch (error) {
    console.error('Release signing failed: ' + error.message);
    process.exitCode = 1;
  }
}
