'use strict';

const MAX_NATIVE_OUTPUT_MESSAGE_BYTES = 1024 * 1024;
const MAX_NATIVE_INPUT_MESSAGE_BYTES = 128 * 1024 * 1024;
const MAX_NATIVE_BUFFER_BYTES = 160 * 1024 * 1024;

function encodeMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  if (payload.length > MAX_NATIVE_OUTPUT_MESSAGE_BYTES) {
    throw new Error(`Native message frame is too large: ${payload.length} bytes`);
  }
  const frame = Buffer.alloc(4 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

function decodeFrames(buffer) {
  if (buffer.length > MAX_NATIVE_BUFFER_BYTES) {
    throw new Error(`Native message buffer is too large: ${buffer.length} bytes`);
  }

  const messages = [];
  let offset = 0;

  while (buffer.length - offset >= 4) {
    const length = buffer.readUInt32LE(offset);
    if (length > MAX_NATIVE_INPUT_MESSAGE_BYTES) {
      throw new Error(`Native message frame is too large: ${length} bytes`);
    }
    const frameStart = offset + 4;
    const frameEnd = frameStart + length;

    if (buffer.length < frameEnd) {
      break;
    }

    const payload = buffer.subarray(frameStart, frameEnd).toString('utf8');
    try {
      messages.push(JSON.parse(payload));
    } catch (error) {
      throw new Error(`Invalid JSON in native message: ${error.message}`);
    }
    offset = frameEnd;
  }

  return {
    messages,
    remainder: buffer.subarray(offset)
  };
}

module.exports = {
  MAX_NATIVE_BUFFER_BYTES,
  MAX_NATIVE_INPUT_MESSAGE_BYTES,
  MAX_NATIVE_MESSAGE_BYTES: MAX_NATIVE_OUTPUT_MESSAGE_BYTES,
  MAX_NATIVE_OUTPUT_MESSAGE_BYTES,
  decodeFrames,
  encodeMessage
};
