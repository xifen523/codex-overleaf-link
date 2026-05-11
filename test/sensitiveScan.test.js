const assert = require('node:assert/strict');
const test = require('node:test');

const sensitiveScan = require('../extension/src/shared/sensitiveScan');

test('scanSensitiveText detects tokens and redacts previews', () => {
  const sampleGithubToken = ['ghp', 'abcdefghijklmnopqrstuvwxyz123456'].join('_');
  const sampleApiToken = ['sk', 'abcdefghijklmnopqrstuvwxyz1234567890'].join('-');
  const findings = sensitiveScan.scanSensitiveText(
    'prompt',
    `Use Bearer ${sampleGithubToken} and ${sampleApiToken} and password = "hunter2"`
  );

  assert.ok(findings.some(finding => finding.detectorId === 'bearer-token'));
  assert.ok(findings.some(finding => finding.detectorId === 'api-token'));
  assert.ok(findings.some(finding => finding.detectorId === 'secret-assignment'));
  for (const finding of findings) {
    assert.equal(finding.source, 'prompt');
    assert.equal(finding.preview.includes('hunter2'), false);
    assert.equal(finding.preview.includes(sampleGithubToken), false);
    assert.equal(finding.preview.includes(sampleApiToken), false);
  }
});

test('scanSensitiveProjectFiles reports secret paths and never full secret content', () => {
  const findings = sensitiveScan.scanSensitiveProjectFiles([
    { path: 'main.tex', content: 'This confidential review must preserve anonymity.' },
    { path: 'keys.txt', content: ['-----BEGIN ', 'PRIVATE KEY-----\nabc\n-----END ', 'PRIVATE KEY-----'].join('') }
  ]);

  assert.deepEqual(findings.map(finding => finding.path).sort(), ['keys.txt']);
  assert.ok(findings.some(finding => finding.detectorId === 'private-key'));
  assert.equal(findings.some(finding => finding.detectorId === 'confidential-keyword'), false);
  assert.equal(findings.some(finding => String(finding.preview).includes('abc')), false);
});
