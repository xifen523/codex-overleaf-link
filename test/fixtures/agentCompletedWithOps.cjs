process.stdin.resume();
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({
    status: 'completed',
    notes: 'Completed with edits.',
    operations: [
      { type: 'edit', path: 'main.tex', find: 'old', replace: 'new' }
    ]
  }));
});
