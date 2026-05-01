process.stdin.resume();
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({
    status: 'delete_plan_required',
    notes: 'Pending operation fixture.',
    operations: [],
    pendingOperations: [
      { type: 'edit', path: 'main.tex', find: 'old', replace: 'new' }
    ],
    deletePlan: []
  }));
});
