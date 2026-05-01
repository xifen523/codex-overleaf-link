'use strict';

function encodeMessage(message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  const frame = Buffer.alloc(4 + payload.length);
  frame.writeUInt32LE(payload.length, 0);
  payload.copy(frame, 4);
  return frame;
}

function decodeFrames(buffer) {
  const messages = [];
  let offset = 0;

  while (buffer.length - offset >= 4) {
    const length = buffer.readUInt32LE(offset);
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
  decodeFrames,
  encodeMessage
};
