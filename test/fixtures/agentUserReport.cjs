process.stdin.resume();
process.stdin.on('end', () => {
  process.stdout.write(JSON.stringify({
    status: 'completed',
    notes: 'No missing citation keys found.',
    userReport: {
      conclusion: '没有发现缺失 citation key，也没有修改文件。',
      checked: ['main.tex', 'references.bib'],
      findings: ['所有 citation key 都能在 .bib 中找到。'],
      plannedChanges: [],
      appliedChanges: [],
      unchangedReason: '这轮是只问不改。',
      nextStep: '如果 Overleaf 仍有 warning，请加入编译日志后再跑一次。'
    },
    operations: []
  }));
});
