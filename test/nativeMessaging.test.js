const assert = require('node:assert/strict');
const test = require('node:test');

const {
  MAX_NATIVE_BUFFER_BYTES,
  MAX_NATIVE_INPUT_MESSAGE_BYTES,
  MAX_NATIVE_OUTPUT_MESSAGE_BYTES,
  decodeFrames,
  encodeMessage
} = require('../native-host/src/nativeMessaging');

test('encodes JSON messages with a 32-bit little-endian length prefix', () => {
  const frame = encodeMessage({ ok: true, value: 'hello' });
  const payload = frame.subarray(4);

  assert.equal(frame.readUInt32LE(0), payload.length);
  assert.deepEqual(JSON.parse(payload.toString('utf8')), { ok: true, value: 'hello' });
});

test('decodes complete frames and preserves a trailing partial frame', () => {
  const first = encodeMessage({ id: 'one' });
  const second = encodeMessage({ id: 'two' });
  const partial = second.subarray(0, 7);

  const decoded = decodeFrames(Buffer.concat([first, partial]));

  assert.deepEqual(decoded.messages, [{ id: 'one' }]);
  assert.deepEqual(decoded.remainder, partial);
});

test('throws a clear error when a decoded frame is not JSON', () => {
  const payload = Buffer.from('not-json', 'utf8');
  const frame = Buffer.alloc(4 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, 4);

  assert.throws(() => decodeFrames(frame), /Invalid JSON/);
});

test('decodes inbound native messages larger than the 1MB outbound Chrome limit', () => {
  const largeText = 'x'.repeat(MAX_NATIVE_OUTPUT_MESSAGE_BYTES + 1024);
  const payload = Buffer.from(JSON.stringify({ id: 'large-inbound', params: { largeText } }), 'utf8');
  const frame = Buffer.alloc(4 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, 4);

  const decoded = decodeFrames(frame);

  assert.equal(decoded.messages[0].id, 'large-inbound');
  assert.equal(decoded.messages[0].params.largeText.length, largeText.length);
});

test('rejects inbound native message frames larger than the allowed input size', () => {
  const frame = Buffer.alloc(4);
  frame.writeUInt32LE(MAX_NATIVE_INPUT_MESSAGE_BYTES + 1, 0);

  assert.throws(
    () => decodeFrames(frame),
    /Native message frame is too large/
  );
});

test('rejects outbound native messages larger than Chrome can receive', () => {
  assert.throws(
    () => encodeMessage({ ok: true, value: 'x'.repeat(MAX_NATIVE_OUTPUT_MESSAGE_BYTES + 1) }),
    /Native message frame is too large/
  );
});

test('rejects accumulated native input buffers larger than the allowed size', () => {
  const buffer = Buffer.alloc(MAX_NATIVE_BUFFER_BYTES + 1);
  buffer.writeUInt32LE(MAX_NATIVE_OUTPUT_MESSAGE_BYTES, 0);

  assert.throws(
    () => decodeFrames(buffer),
    /Native message buffer is too large/
  );
});

test('writeResponse degrades oversize frames instead of crashing the host (B1)', () => {
  // Review BLOCKER B1: an oversize Codex event made encodeMessage throw out of
  // the synchronous stdout handler -> uncaughtException -> process exit mid-run.
  // The fix wraps encodeMessage in a try/catch with a truncated-event fallback
  // and a final native_response_too_large error. Source-grep guard (writeResponse
  // is file-local to index.js with no export seam).
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'native-host', 'src', 'index.js'), 'utf8');
  assert.match(src, /function writeResponse[\s\S]*?try \{[\s\S]*?encodeMessage\(response\)[\s\S]*?catch/,
    'writeResponse must wrap encodeMessage in try/catch');
  assert.match(src, /buildOversizeResponseFallback/, 'must build a degraded fallback frame');
  assert.match(src, /native_response_too_large/, 'must have a final structured-error tier');
  assert.match(src, /native_event_truncated/, 'event payloads must degrade to a truncated event, not crash');
});
