'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { scanSensitiveText } = require('../../extension/src/shared/sensitiveScan');
const { getProjectMirror } = require('./mirrorWorkspace');

const MAX_SCANNED_FILE_BYTES = 512 * 1024;
const MAX_FINDINGS = 100;

function scanMirrorSensitiveFiles(options = {}) {
  const mirror = getProjectMirror(options.projectId || 'unknown', { rootDir: options.rootDir });
  const findings = [];
  const skippedFiles = [];
  let scannedFiles = 0;

  for (const filePath of listMirrorFiles(mirror.workspacePath)) {
    if (!isSensitiveScanTextPath(filePath)) {
      continue;
    }
    const target = resolveWorkspacePath(mirror.workspacePath, filePath);
    const stat = fs.statSync(target);
    if (stat.size > MAX_SCANNED_FILE_BYTES) {
      skippedFiles.push({
        path: filePath,
        reason: 'file_too_large',
        size: stat.size
      });
      continue;
    }
    const content = fs.readFileSync(target, 'utf8');
    scannedFiles += 1;
    findings.push(...scanSensitiveText('mirror-file', content, { path: filePath }));
    if (findings.length >= MAX_FINDINGS) {
      break;
    }
  }

  const redactedFindings = collapseRedundantFindings(findings);
  return {
    findings: redactedFindings.slice(0, MAX_FINDINGS),
    scannedFiles,
    skippedFiles
  };
}

function listMirrorFiles(workspacePath) {
  if (!fs.existsSync(workspacePath)) {
    return [];
  }
  const files = [];
  walk(workspacePath, '');
  return files.sort();

  function walk(dir, prefix) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.DS_Store') {
        continue;
      }
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute, relative);
      } else if (entry.isFile()) {
        files.push(normalizeRelativePath(relative));
      }
    }
  }
}

function isSensitiveScanTextPath(filePath) {
  const normalized = normalizeRelativePath(filePath).toLowerCase();
  const basename = path.posix.basename(normalized);
  if (basename === '.latexmkrc') {
    return true;
  }
  return /\.(tex|bib|bst|cls|sty|clo|cfg|def|bbx|cbx|lbx|ist|tikz|pgf|asy|txt|md|csv|tsv|dat|json|ya?ml|py|r|m|sh)$/i.test(normalized);
}

function resolveWorkspacePath(workspacePath, filePath) {
  const target = path.resolve(workspacePath, normalizeRelativePath(filePath));
  const root = path.resolve(workspacePath);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Unsafe project path: ${filePath}`);
  }
  return target;
}

function normalizeRelativePath(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').some(part => part === '..' || part === '.')) {
    throw new Error(`Unsafe project path: ${filePath}`);
  }
  return normalized;
}

function collapseRedundantFindings(findings = []) {
  const specificKeys = new Set(
    findings
      .filter(finding => finding?.detectorId !== 'secret-assignment')
      .map(finding => findingKey(finding))
  );
  return findings.filter(finding => (
    finding?.detectorId !== 'secret-assignment' ||
    !specificKeys.has(findingKey(finding))
  ));
}

function findingKey(finding = {}) {
  return [
    finding.source || '',
    finding.path || '',
    finding.preview || ''
  ].join('\u0000');
}

module.exports = {
  scanMirrorSensitiveFiles
};
