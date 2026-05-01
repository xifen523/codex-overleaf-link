process.stdin.resume();
process.stdin.on('end', () => {
  process.stdout.write('x'.repeat(2048));
});
