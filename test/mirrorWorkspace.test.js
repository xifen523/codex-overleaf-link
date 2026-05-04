const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  collectMirrorChangesDetailed,
  collectMirrorChanges,
  getProjectMirror,
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
    assert.equal(Object.hasOwn(changes[0], 'find'), false);
    assert.equal(Object.hasOwn(changes[0], 'replace'), false);
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
