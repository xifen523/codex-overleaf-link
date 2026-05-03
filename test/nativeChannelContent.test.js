const assert = require('node:assert/strict');
const test = require('node:test');

const NativeChannel = require('../extension/src/content/nativeChannel');

test('tracked native requests expose active request id and clear it explicitly', async () => {
  const sent = [];
  let nextId = 0;
  const channel = NativeChannel.create({
    chrome: {
      runtime: {
        sendMessage(message) {
          sent.push(message);
          return Promise.resolve({ ok: true });
        }
      }
    },
    crypto: {
      randomUUID() {
        nextId += 1;
        return `request-${nextId}`;
      }
    }
  });

  const response = await channel.sendNative({ method: 'codex.run', params: { task: 'check' } });

  assert.deepEqual(response, { ok: true });
  assert.equal(channel.getActiveRequestId(), 'request-1');
  assert.equal(sent[0].payload.id, 'request-1');
  assert.equal(sent[0].payload.method, 'codex.run');
  assert.equal(channel.shouldHandleNativeEvent({ type: 'codex-overleaf/native-event', id: 'request-1' }), true);
  channel.clearActiveRequest();
  assert.equal(channel.getActiveRequestId(), null);
});

test('background native requests do not replace the active tracked request', async () => {
  const sent = [];
  let nextId = 0;
  const channel = NativeChannel.create({
    chrome: {
      runtime: {
        sendMessage(message) {
          sent.push(message);
          return Promise.resolve({ ok: true });
        }
      }
    },
    crypto: {
      randomUUID() {
        nextId += 1;
        return `request-${nextId}`;
      }
    }
  });

  await channel.sendNative({ method: 'codex.run' });
  await channel.sendBackgroundNative({ method: 'mirror.sync' });

  assert.equal(channel.getActiveRequestId(), 'request-1');
  assert.equal(sent[1].payload.id, 'request-2');
  assert.equal(sent[1].payload.method, 'mirror.sync');
  assert.equal(channel.shouldHandleNativeEvent({ type: 'codex-overleaf/native-event', id: 'request-2' }), false);
});
