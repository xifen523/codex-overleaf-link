const assert = require('node:assert/strict');
const test = require('node:test');

const nativeQuotas = require('../native-host/src/nativeQuotas');

const EXPECTED_EXPORTS = [
  'NATIVE_REQUEST_QUOTAS',
  'validateNativeRequestQuotas',
  'firstQuotaViolation',
  'validateProjectSnapshotQuota',
  'validateFilePayloadQuota',
  'validatePatchFileTextQuota',
  'validateOperationListQuota',
  'validateOperationPayloadQuota',
  'measureOperationPayloads',
  'validateCompileLogQuota',
  'validateAttachmentQuota',
  'validateSkillContentQuota',
  'estimateBase64DecodedBytes',
  'quotaViolation'
];

test('nativeQuotas exposes the native request quota boundary API', () => {
  assert.equal(typeof nativeQuotas.NATIVE_REQUEST_QUOTAS, 'object');
  for (const name of EXPECTED_EXPORTS.filter(name => name !== 'NATIVE_REQUEST_QUOTAS')) {
    assert.equal(typeof nativeQuotas[name], 'function', `${name} should be exported`);
  }
});

test('native quota helpers preserve violation shape and base64 byte estimates', () => {
  const violation = nativeQuotas.quotaViolation('content', 10, 11, 'too large');

  assert.deepEqual(violation, {
    field: 'content',
    limit: 10,
    actual: 11,
    reason: 'too large'
  });
  assert.equal(nativeQuotas.firstQuotaViolation([null, violation]), violation);
  assert.equal(nativeQuotas.estimateBase64DecodedBytes(' YWJjZA==\n'), 4);
});

test('native request quota validation keeps stable fields for oversized skill content', () => {
  const violation = nativeQuotas.validateNativeRequestQuotas({
    id: 'skill-content-quota',
    method: 'skills.install',
    params: {
      content: 'x'.repeat(nativeQuotas.NATIVE_REQUEST_QUOTAS.maxSkillContentBytes + 1)
    }
  });

  assert.deepEqual(violation, {
    field: 'content',
    limit: nativeQuotas.NATIVE_REQUEST_QUOTAS.maxSkillContentBytes,
    actual: nativeQuotas.NATIVE_REQUEST_QUOTAS.maxSkillContentBytes + 1,
    reason: 'skill content is too large'
  });
});

test('operation payload measurement ignores base64 text and counts shared binary payloads once', () => {
  const asset = {
    contentBase64: 'YWJjZA==',
    size: 3
  };
  const payloads = nativeQuotas.measureOperationPayloads([{
    content: 'abc',
    asset,
    duplicate: asset
  }]);

  assert.deepEqual(payloads, {
    textBytes: 3,
    binaryBytes: 4
  });
});

test('operation payload quota reports binary payload violations with existing field shape', () => {
  const violation = nativeQuotas.validateOperationPayloadQuota([{
    asset: {
      kind: 'binary',
      size: nativeQuotas.NATIVE_REQUEST_QUOTAS.maxProjectBinaryBytes + 1
    }
  }], 'operations');

  assert.deepEqual(violation, {
    field: 'operations.contentBase64',
    limit: nativeQuotas.NATIVE_REQUEST_QUOTAS.maxProjectBinaryBytes,
    actual: nativeQuotas.NATIVE_REQUEST_QUOTAS.maxProjectBinaryBytes + 1,
    reason: 'operations binary payload is too large'
  });
});
