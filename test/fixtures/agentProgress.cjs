process.stdin.resume();
process.stdin.on('end', () => {
  process.stderr.write('CODEX_OVERLEAF_EVENT {"type":"codex.exec.started","title":"Codex exec started","status":"running","detail":{"pid":1234}}\n');
  process.stdout.write(JSON.stringify({
    status: 'completed',
    notes: 'Progress fixture completed.',
    operations: []
  }));
});
