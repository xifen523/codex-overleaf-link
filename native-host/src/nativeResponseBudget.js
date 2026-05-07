'use strict';

const { MAX_NATIVE_OUTPUT_MESSAGE_BYTES } = require('./nativeMessaging');

const NATIVE_OK_RESPONSE_BUDGET_BYTES = MAX_NATIVE_OUTPUT_MESSAGE_BYTES - (64 * 1024);
const NATIVE_RESPONSE_ESTIMATE_ID = 'response-budget-estimate';

function enforceNativeOkResponseBudget(result) {
  const next = {
    ...result,
    syncChanges: Array.isArray(result.syncChanges) ? [...result.syncChanges] : [],
    unsupportedChanges: Array.isArray(result.unsupportedChanges) ? [...result.unsupportedChanges] : []
  };

  while (estimateNativeOkResponseBytes(next) > NATIVE_OK_RESPONSE_BUDGET_BYTES) {
    const textIndex = findLargestInlineTextChangeIndex(next.syncChanges);
    if (textIndex >= 0) {
      const [change] = next.syncChanges.splice(textIndex, 1);
      next.unsupportedChanges.push(buildOversizedTextPayloadChange(change));
      continue;
    }

    const binaryIndex = findLargestInlineBinaryChangeIndex(next.syncChanges);
    if (binaryIndex >= 0) {
      const [change] = next.syncChanges.splice(binaryIndex, 1);
      next.unsupportedChanges.push(buildOversizedBinaryPayloadChange(change));
      continue;
    }

    if (typeof next.assistantMessage === 'string' && next.assistantMessage) {
      next.assistantMessage = shrinkAssistantMessageForNativeResponse(next.assistantMessage, next);
      continue;
    }

    return compactNativeResponseForBudget(next);
  }

  next.unsupportedChanges.sort((left, right) => String(left.path || '').localeCompare(String(right.path || '')));
  return next;
}

function estimateNativeOkResponseBytes(result) {
  return Buffer.byteLength(JSON.stringify({
    id: NATIVE_RESPONSE_ESTIMATE_ID,
    ok: true,
    result
  }), 'utf8');
}

function findLargestInlineTextChangeIndex(changes = []) {
  let largestIndex = -1;
  let largestBytes = -1;
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    if (!hasInlineTextPayload(change)) {
      continue;
    }
    const bytes = Buffer.byteLength(JSON.stringify(change), 'utf8');
    if (bytes > largestBytes) {
      largestBytes = bytes;
      largestIndex = index;
    }
  }
  return largestIndex;
}

function hasInlineTextPayload(change) {
  return change
    && change.type !== 'binary-create'
    && change.type !== 'overwrite-binary'
    && (
      typeof change.content === 'string'
      || typeof change.previousContent === 'string'
      || Array.isArray(change.diff)
      || Array.isArray(change.patches)
    );
}

function findLargestInlineBinaryChangeIndex(changes = []) {
  let largestIndex = -1;
  let largestBytes = -1;
  for (let index = 0; index < changes.length; index += 1) {
    const change = changes[index];
    if (
      (change?.type !== 'binary-create' && change?.type !== 'overwrite-binary')
      || typeof change.contentBase64 !== 'string'
    ) {
      continue;
    }
    const bytes = Buffer.byteLength(change.contentBase64, 'utf8');
    if (bytes > largestBytes) {
      largestBytes = bytes;
      largestIndex = index;
    }
  }
  return largestIndex;
}

function buildOversizedTextPayloadChange(change = {}) {
  const contentBytes = typeof change.content === 'string' ? Buffer.byteLength(change.content, 'utf8') : 0;
  const previousBytes = typeof change.previousContent === 'string' ? Buffer.byteLength(change.previousContent, 'utf8') : 0;
  return {
    type: 'unsupported-local-file',
    path: change.path || '',
    reason: 'text_payload_exceeds_native_message_limit',
    size: contentBytes,
    previousSize: previousBytes,
    attemptedChangeType: change.type || 'write',
    previousExists: change.previousExists === true,
    nativeOutputLimit: MAX_NATIVE_OUTPUT_MESSAGE_BYTES,
    responseBudget: NATIVE_OK_RESPONSE_BUDGET_BYTES,
    guidance: 'The text writeback payload is too large for native messaging after adding review diff and patch data. Apply the change in Overleaf directly, split the edit into smaller files, or rerun with a narrower focus.'
  };
}

function buildOversizedBinaryPayloadChange(change = {}) {
  return {
    type: 'unsupported-local-file',
    path: change.path || '',
    reason: 'binary_payload_exceeds_native_message_limit',
    size: Number.isFinite(Number(change.size)) ? Number(change.size) : estimateBase64Size(change.contentBase64),
    attemptedChangeType: change.type || 'binary-create',
    previousExists: change.previousExists === true,
    previousKind: change.previousKind || '',
    previousSize: change.previousSize,
    nativeOutputLimit: MAX_NATIVE_OUTPUT_MESSAGE_BYTES,
    responseBudget: NATIVE_OK_RESPONSE_BUDGET_BYTES,
    guidance: 'The binary writeback payload would exceed the native messaging response budget. Update the file in Overleaf directly or reduce the asset size before retrying.'
  };
}

function estimateBase64Size(value) {
  const clean = String(value || '').replace(/\s+/g, '');
  if (!clean) {
    return 0;
  }
  const padding = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(clean.length * 3 / 4) - padding);
}

function shrinkAssistantMessageForNativeResponse(message, result) {
  const currentBytes = Buffer.byteLength(message, 'utf8');
  const overflowBytes = estimateNativeOkResponseBytes(result) - NATIVE_OK_RESPONSE_BUDGET_BYTES;
  const targetBytes = Math.max(0, currentBytes - overflowBytes - 1024);
  return truncateUtf8Text(message, targetBytes, '\n...[truncated to fit native response budget]');
}

function truncateUtf8Text(value, maxBytes, suffix = '') {
  const text = String(value || '');
  if (maxBytes <= 0) {
    return '';
  }
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return text;
  }
  const suffixBytes = Buffer.byteLength(suffix, 'utf8');
  const suffixToUse = suffixBytes < maxBytes ? suffix : '';
  const bodyLimit = Math.max(0, maxBytes - Buffer.byteLength(suffixToUse, 'utf8'));
  let output = '';
  let outputBytes = 0;
  for (const char of text) {
    const charBytes = Buffer.byteLength(char, 'utf8');
    if (outputBytes + charBytes > bodyLimit) {
      break;
    }
    output += char;
    outputBytes += charBytes;
  }
  return `${output}${suffixToUse}`;
}

function compactNativeResponseForBudget(result) {
  return {
    ...result,
    assistantMessage: truncateUtf8Text(result.assistantMessage || '', 4096),
    syncChanges: [],
    unsupportedChanges: [{
      type: 'unsupported-local-file',
      path: '',
      reason: 'native_response_payload_exceeds_native_message_limit',
      nativeOutputLimit: MAX_NATIVE_OUTPUT_MESSAGE_BYTES,
      responseBudget: NATIVE_OK_RESPONSE_BUDGET_BYTES,
      guidance: 'The native response payload remained too large after inline payload degradation. Rerun with a narrower focus or apply the local changes directly in Overleaf.'
    }]
  };
}

module.exports = {
  NATIVE_OK_RESPONSE_BUDGET_BYTES,
  compactNativeResponseForBudget,
  enforceNativeOkResponseBudget,
  estimateNativeOkResponseBytes,
  truncateUtf8Text
};
