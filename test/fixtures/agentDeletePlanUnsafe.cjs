process.stdin.resume();
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({
    status: 'delete_plan_required',
    notes: 'Unsafe delete plan fixture.',
    operations: [
      { type: 'delete', path: 'unused.tex', reason: 'not referenced' }
    ],
    deletePlan: [],
    pendingOperations: []
  }));
});
