const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  markMirrorDirty,
  collectMirrorChangesDetailed,
  collectMirrorChanges,
  getProjectMirror,
  getMirrorStatus,
  syncOverleafToMirror
} = require('../native-host/src/mirrorWorkspace');

test('maps the same Overleaf project to a stable local mirror workspace', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-mirror-'));
  try {
    const first = getProjectMirror('https://www.overleaf.com/project/aabbccddeeff001122334455', { rootDir });
    const second = getProjectMirror('aabbccddeeff001122334455', { rootDir });

    assert.equal(first.workspacePath, second.workspacePath);
    assert.equal(first.projectKey, 'aabbccddeeff001122334455');
    assert.equal(first.workspacePath.startsWith(rootDir), true);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('syncs Overleaf text files to the mirror and removes files missing from the next snapshot', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-mirror-'));
  try {
    const first = await syncOverleafToMirror({
      projectId: 'project-a',
      rootDir,
      project: {
        files: [
          { path: 'main.tex', content: 'hello' },
          { path: 'sections/old.tex', content: 'old' }
        ]
      }
    });

    assert.equal(fs.readFileSync(path.join(first.workspacePath, 'main.tex'), 'utf8'), 'hello');
    assert.equal(fs.existsSync(path.join(first.workspacePath, 'sections/old.tex')), true);

    const second = await syncOverleafToMirror({
      projectId: 'project-a',
      rootDir,
      project: {
        files: [
          { path: 'main.tex', content: 'hello again' }
        ]
      }
    });

    assert.equal(fs.readFileSync(path.join(second.workspacePath, 'main.tex'), 'utf8'), 'hello again');
    assert.equal(fs.existsSync(path.join(second.workspacePath, 'sections/old.tex')), false);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('partial Overleaf snapshots update provided files without deleting the full mirror', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-mirror-'));
  try {
    const first = await syncOverleafToMirror({
      projectId: 'project-partial-overlay',
      rootDir,
      project: {
        capabilities: { fullProjectSnapshot: true },
        files: [
          { path: 'main.tex', content: 'before' },
          { path: 'refs.bib', content: '@article{a}' }
        ]
      }
    });
    const firstBaseline = JSON.parse(fs.readFileSync(path.join(first.metadataPath, 'baseline.json'), 'utf8'));

    const second = await syncOverleafToMirror({
      projectId: 'project-partial-overlay',
      rootDir,
      project: {
        capabilities: { fullProjectSnapshot: false },
        files: [
          { path: 'main.tex', content: 'live unsaved editor text' }
        ]
      }
    });

    assert.equal(fs.readFileSync(path.join(second.workspacePath, 'main.tex'), 'utf8'), 'live unsaved editor text');
    assert.equal(fs.readFileSync(path.join(second.workspacePath, 'refs.bib'), 'utf8'), '@article{a}');

    const secondBaseline = JSON.parse(fs.readFileSync(path.join(second.metadataPath, 'baseline.json'), 'utf8'));
    assert.equal(secondBaseline.lastFullSyncAt, firstBaseline.lastFullSyncAt);
    assert.equal(typeof secondBaseline.lastPartialSyncAt, 'string');
    assert.deepEqual(secondBaseline.files.map(file => file.path).sort(), ['main.tex', 'refs.bib']);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('legacy capturedAt-only baselines are not reusable as verified full mirrors', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-mirror-'));
  try {
    const mirror = getProjectMirror('legacy-captured-only', { rootDir });
    fs.mkdirSync(mirror.metadataPath, { recursive: true });
    fs.writeFileSync(mirror.baselinePath, JSON.stringify({
      capturedAt: new Date().toISOString(),
      files: [{ path: 'main.tex', kind: 'text', content: 'legacy', hash: 'legacy' }]
    }, null, 2), 'utf8');

    const status = getMirrorStatus('legacy-captured-only', { rootDir });

    assert.equal(status.exists, false);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('invalid lastFullSyncAt baselines are not reusable as verified full mirrors', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-mirror-'));
  try {
    const mirror = getProjectMirror('invalid-full-sync-time', { rootDir });
    fs.mkdirSync(mirror.metadataPath, { recursive: true });
    fs.writeFileSync(mirror.baselinePath, JSON.stringify({
      lastFullSyncAt: 'not-a-date',
      files: [{ path: 'main.tex', kind: 'text', content: 'corrupt', hash: 'corrupt' }]
    }, null, 2), 'utf8');

    const status = getMirrorStatus('invalid-full-sync-time', { rootDir });

    assert.equal(status.exists, false);
    assert.equal(status.ageMs, Infinity);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('syncs binary Overleaf assets to the mirror without treating them as editable text changes', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-mirror-'));
  try {
    const binary = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);
    const mirror = await syncOverleafToMirror({
      projectId: 'project-assets',
      rootDir,
      project: {
        files: [
          { path: 'main.tex', content: '\\includegraphics{Figures/plot.pdf}' },
          {
            path: 'Figures/plot.pdf',
            kind: 'binary',
            contentBase64: binary.toString('base64')
          }
        ]
      }
    });

    assert.deepEqual(fs.readFileSync(path.join(mirror.workspacePath, 'Figures/plot.pdf')), binary);
    assert.equal(fs.existsSync(path.join(mirror.workspacePath, 'Figures')), true);

    fs.writeFileSync(path.join(mirror.workspacePath, 'main.tex'), '\\includegraphics{Figures/plot.pdf}\n% note', 'utf8');
    fs.writeFileSync(path.join(mirror.workspacePath, 'Figures/plot.pdf'), Buffer.from([0x00, 0x01]));

    const changes = await collectMirrorChanges({ projectId: 'project-assets', rootDir });
    assert.deepEqual(changes.map(change => [change.type, change.path]), [
      ['write', 'main.tex']
    ]);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('collects local mirror writes and deletes as sync changes, not Codex operation JSON', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-mirror-'));
  try {
    const mirror = await syncOverleafToMirror({
      projectId: 'project-b',
      rootDir,
      project: {
        files: [
          { path: 'main.tex', content: 'before' },
          { path: 'refs.bib', content: '@article{x}' }
        ]
      }
    });

    fs.writeFileSync(path.join(mirror.workspacePath, 'main.tex'), 'after', 'utf8');
    fs.writeFileSync(path.join(mirror.workspacePath, 'new.tex'), 'new file', 'utf8');
    fs.rmSync(path.join(mirror.workspacePath, 'refs.bib'));

    const changes = await collectMirrorChanges({ projectId: 'project-b', rootDir });

    assert.deepEqual(changes.map(change => [change.type, change.path]), [
      ['write', 'main.tex'],
      ['write', 'new.tex'],
      ['delete', 'refs.bib']
    ]);
    assert.equal(changes[0].content, 'after');
    assert.equal(changes[0].previousContent, 'before');
    assert.equal(changes[0].previousExists, true);
    assert.equal(changes[1].previousExists, false);
    assert.equal(changes[2].previousExists, true);
    assert.equal(Object.hasOwn(changes[0], 'find'), false);
    assert.equal(Object.hasOwn(changes[0], 'replace'), false);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('delete changes preserve baseline existence for empty existing files', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-mirror-'));
  try {
    const mirror = await syncOverleafToMirror({
      projectId: 'project-empty-delete',
      rootDir,
      project: {
        files: [
          { path: 'empty.tex', content: '' }
        ]
      }
    });

    fs.rmSync(path.join(mirror.workspacePath, 'empty.tex'));
    const changes = await collectMirrorChanges({ projectId: 'project-empty-delete', rootDir });

    assert.deepEqual(changes.map(change => [change.type, change.path]), [
      ['delete', 'empty.tex']
    ]);
    assert.equal(changes[0].previousContent, '');
    assert.equal(changes[0].previousExists, true);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('mirror status is not reusable when workspace content differs from baseline', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-mirror-'));
  try {
    const mirror = await syncOverleafToMirror({
      projectId: 'project-dirty-status',
      rootDir,
      project: {
        capabilities: { fullProjectSnapshot: true },
        files: [{ path: 'main.tex', content: 'overleaf' }]
      }
    });
    fs.writeFileSync(path.join(mirror.workspacePath, 'main.tex'), 'local dirty edit', 'utf8');

    const status = getMirrorStatus('project-dirty-status', { rootDir });

    assert.equal(status.exists, false);
    assert.equal(status.dirty, true);
    assert.equal(status.dirtyReason, 'workspace_mismatch');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('mirror status is not reusable when workspace contains extra managed text files', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-mirror-'));
  try {
    const mirror = await syncOverleafToMirror({
      projectId: 'project-extra-file-status',
      rootDir,
      project: {
        capabilities: { fullProjectSnapshot: true },
        files: [{ path: 'main.tex', content: 'overleaf' }]
      }
    });
    fs.writeFileSync(path.join(mirror.workspacePath, 'new.tex'), 'local only', 'utf8');

    const status = getMirrorStatus('project-extra-file-status', { rootDir });

    assert.equal(status.exists, false);
    assert.equal(status.dirty, true);
    assert.equal(status.dirtyReason, 'workspace_extra_file');
    assert.equal(status.dirtyPath, 'new.tex');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('mirror status is not reusable when workspace contains an extra latexmkrc file', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-mirror-'));
  try {
    const mirror = await syncOverleafToMirror({
      projectId: 'project-extra-latexmkrc-status',
      rootDir,
      project: {
        capabilities: { fullProjectSnapshot: true },
        files: [{ path: 'main.tex', content: 'overleaf' }]
      }
    });
    fs.writeFileSync(path.join(mirror.workspacePath, '.latexmkrc'), '$pdf_mode = 1;', 'utf8');

    const status = getMirrorStatus('project-extra-latexmkrc-status', { rootDir });

    assert.equal(status.exists, false);
    assert.equal(status.dirty, true);
    assert.equal(status.dirtyReason, 'workspace_extra_file');
    assert.equal(status.dirtyPath, '.latexmkrc');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('full mirror sync rewrites files whose workspace content was dirtied despite matching baseline hash', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-mirror-'));
  try {
    const mirror = await syncOverleafToMirror({
      projectId: 'project-full-clean',
      rootDir,
      project: {
        capabilities: { fullProjectSnapshot: true },
        files: [{ path: 'main.tex', content: 'overleaf clean' }]
      }
    });
    fs.writeFileSync(path.join(mirror.workspacePath, 'main.tex'), 'local dirty edit', 'utf8');

    const result = await syncOverleafToMirror({
      projectId: 'project-full-clean',
      rootDir,
      project: {
        capabilities: { fullProjectSnapshot: true },
        files: [{ path: 'main.tex', content: 'overleaf clean' }]
      }
    });

    assert.equal(fs.readFileSync(path.join(mirror.workspacePath, 'main.tex'), 'utf8'), 'overleaf clean');
    assert.equal(result.writtenCount, 1);
    assert.equal(getMirrorStatus('project-full-clean', { rootDir }).exists, true);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('explicit dirty marker makes mirror status non-reusable until the next full sync', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-mirror-'));
  try {
    await syncOverleafToMirror({
      projectId: 'project-dirty-marker',
      rootDir,
      project: {
        capabilities: { fullProjectSnapshot: true },
        files: [{ path: 'main.tex', content: 'overleaf' }]
      }
    });

    markMirrorDirty({ projectId: 'project-dirty-marker', rootDir, reason: 'codex_run_local_changes' });
    const dirtyStatus = getMirrorStatus('project-dirty-marker', { rootDir });

    assert.equal(dirtyStatus.exists, false);
    assert.equal(dirtyStatus.dirty, true);
    assert.equal(dirtyStatus.dirtyReason, 'codex_run_local_changes');

    await syncOverleafToMirror({
      projectId: 'project-dirty-marker',
      rootDir,
      project: {
        capabilities: { fullProjectSnapshot: true },
        files: [{ path: 'main.tex', content: 'overleaf' }]
      }
    });

    const cleanStatus = getMirrorStatus('project-dirty-marker', { rootDir });
    assert.equal(cleanStatus.exists, true);
    assert.equal(cleanStatus.dirty, false);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('removes and ignores unmanaged LaTeX build artifacts in the local mirror', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-mirror-'));
  try {
    const mirror = await syncOverleafToMirror({
      projectId: 'project-generated-artifacts',
      rootDir,
      project: {
        files: [
          { path: 'main.tex', content: '\\documentclass{article}\n' }
        ]
      }
    });

    fs.writeFileSync(path.join(mirror.workspacePath, 'main.pdf'), '%PDF-1.7 generated', 'utf8');
    fs.writeFileSync(path.join(mirror.workspacePath, 'main.aux'), '\\relax\n', 'utf8');
    fs.writeFileSync(path.join(mirror.workspacePath, 'main.log'), 'latex log\n', 'utf8');
    fs.writeFileSync(path.join(mirror.workspacePath, 'new.tex'), 'new source', 'utf8');

    const changes = await collectMirrorChanges({ projectId: 'project-generated-artifacts', rootDir });
    assert.deepEqual(changes.map(change => change.path), ['new.tex']);

    await syncOverleafToMirror({
      projectId: 'project-generated-artifacts',
      rootDir,
      project: {
        files: [
          { path: 'main.tex', content: '\\documentclass{article}\n' }
        ]
      }
    });

    assert.equal(fs.existsSync(path.join(mirror.workspacePath, 'main.pdf')), false);
    assert.equal(fs.existsSync(path.join(mirror.workspacePath, 'main.aux')), false);
    assert.equal(fs.existsSync(path.join(mirror.workspacePath, 'main.log')), false);
    assert.equal(fs.existsSync(path.join(mirror.workspacePath, 'new.tex')), false);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('reports local files that cannot be synchronized back to Overleaf', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-mirror-'));
  try {
    const mirror = await syncOverleafToMirror({
      projectId: 'project-unsupported-local-files',
      rootDir,
      project: {
        files: [
          { path: 'main.tex', content: '\\documentclass{article}\n' }
        ]
      }
    });

    fs.writeFileSync(path.join(mirror.workspacePath, 'diagram.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    fs.writeFileSync(path.join(mirror.workspacePath, 'main.pdf'), '%PDF-1.7 generated', 'utf8');

    const result = await collectMirrorChangesDetailed({ projectId: 'project-unsupported-local-files', rootDir });

    assert.deepEqual(result.changes, []);
    assert.deepEqual(result.unsupportedChanges.map(change => [change.path, change.reason]), [
      ['diagram.png', 'unsupported_non_text_file'],
      ['main.pdf', 'generated_artifact']
    ]);
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('skips oversized binary assets instead of mirroring them into the local workspace', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-mirror-'));
  try {
    const oversized = Buffer.alloc(11 * 1024 * 1024, 1);
    const mirror = await syncOverleafToMirror({
      projectId: 'project-large-assets',
      rootDir,
      project: {
        files: [
          { path: 'main.tex', content: '\\includegraphics{Figures/huge.png}' },
          {
            path: 'Figures/huge.png',
            kind: 'binary',
            size: oversized.length,
            contentBase64: oversized.toString('base64')
          }
        ]
      }
    });

    assert.equal(fs.existsSync(path.join(mirror.workspacePath, 'Figures/huge.png')), false);
    assert.equal(mirror.fileCount, 1);
    assert.equal(mirror.skippedFiles[0].path, 'Figures/huge.png');
    assert.equal(mirror.skippedFiles[0].reason, 'binary_file_too_large');
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test('rejects project paths that would escape the local mirror', async () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-overleaf-mirror-'));
  try {
    await assert.rejects(
      syncOverleafToMirror({
        projectId: 'project-c',
        rootDir,
        project: {
          files: [
            { path: '../outside.tex', content: 'bad' }
          ]
        }
      }),
      /Unsafe project path/
    );
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
