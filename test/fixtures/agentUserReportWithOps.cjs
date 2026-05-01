process.stdin.resume();
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({
    status: 'completed',
    notes: 'Prepared one edit for main.tex.',
    userReport: {
      conclusion: '我准备修改 main.tex 中的一句话，让语法更自然。',
      checked: ['main.tex'],
      findings: ['摘要里有一句表达不够自然。'],
      plannedChanges: ['main.tex：编辑摘要中的一句话。'],
      appliedChanges: [],
      unchangedReason: '',
      nextStep: '请确认后写入 Overleaf。'
    },
    operations: [
      { type: 'edit', path: 'main.tex', find: 'old', replace: 'new' }
    ]
  }));
});
