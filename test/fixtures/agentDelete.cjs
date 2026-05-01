process.stdin.resume();
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({
    operations: [
      { type: 'edit', path: 'main.tex', find: 'a', replace: 'b' },
      { type: 'delete', path: 'unused.tex', reason: 'not referenced' }
    ]
  }));
});
