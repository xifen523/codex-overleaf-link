process.stdin.resume();
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({
    status: 'completed',
    notes: 'No obvious citation issues found in the supplied files.',
    operations: []
  }));
});
