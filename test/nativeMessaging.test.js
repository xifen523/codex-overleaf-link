const assert = require('node:assert/strict');
const test = require('node:test');

const { decodeFrames, encodeMessage } = require('../native-host/src/nativeMessaging');

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
