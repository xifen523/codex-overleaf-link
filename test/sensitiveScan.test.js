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

test('counts multiple distinct secrets of the same type in one source', () => {
  // v1.4.1: the per-finding dedup key includes match.index, so two different
  // sk- tokens in the same source each count instead of collapsing to one —
  // the "found N item(s)" total and the confirm-dialog list were under-reporting.
  const tokenA = ['sk', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'].join('-');
  const tokenB = ['sk', 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'].join('-');
  const findings = sensitiveScan.scanSensitiveText('prompt', `first ${tokenA} then ${tokenB}`);
  const apiFindings = findings.filter(finding => finding.detectorId === 'api-token');
  assert.equal(apiFindings.length, 2, 'both distinct sk- tokens must be reported');
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

test('scanSensitiveText detects the v1.3.x modern token formats (AWS/Google/HF/GitLab/Stripe/JWT)', () => {
  // Locks in the six detectors added to stop these secrets passing the
  // preflight gate and reaching Codex (review BLOCKER B6). Each sample uses
  // a realistic shape for that provider's key format.
  const samples = {
    'aws-access-key': 'AKIA' + 'ABCDEFGHIJKLMNOP',                       // AKIA + 16 upper/digits
    'google-api-key': 'AIza' + 'a'.repeat(35),                          // AIza + 35
    'huggingface-token': 'hf_' + 'abcdefghijklmnopqrstuvwx',            // hf_ + 20+
    'gitlab-token': 'glpat-' + 'abcdefghijklmnopqrstuv',                // glpat- + 20+
    'stripe-live-secret': 'sk_live_' + 'abcdefghijklmnop1234',          // sk_live_ + 16+
    'jwt-token': ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'c'.repeat(20)].join('.')
  };
  for (const [detectorId, value] of Object.entries(samples)) {
    const findings = sensitiveScan.scanSensitiveText('prompt', `token: ${value}`);
    assert.ok(
      findings.some(f => f.detectorId === detectorId),
      `expected detector ${detectorId} to fire on ${value}`
    );
    // The raw secret must never appear in any preview.
    for (const f of findings) {
      assert.equal(String(f.preview).includes(value), false, `preview leaked ${detectorId}`);
    }
  }
});

test('scanSensitiveText does not flag ordinary LaTeX/bib prose as secrets', () => {
  // Guard against the new detectors over-firing on benign academic text.
  const benign = 'See \\cite{smith2021} and the equation E=mc^2. The token bearer of the grant is Dr. Smith.';
  const findings = sensitiveScan.scanSensitiveText('prompt', benign);
  const ids = findings.map(f => f.detectorId);
  for (const id of ['aws-access-key', 'google-api-key', 'huggingface-token', 'gitlab-token', 'stripe-live-secret', 'jwt-token']) {
    assert.equal(ids.includes(id), false, `false positive: ${id} fired on benign prose`);
  }
});
