const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const test = require('node:test');

const {
  buildAnthropicRequest,
  decodeAnthropicThinkingBlock
} = require('../native-host/src/anthropicBridgeRequest');
const {
  convertAnthropicResponse,
  streamAnthropicResponse
} = require('../native-host/src/anthropicBridgeResponse');
const {
  buildAnthropicHeaders,
  buildAnthropicMessagesUrl
} = require('../native-host/src/anthropicMessagesBridge');
const { normalizeProviderDraft } = require('../native-host/src/providerProfile');

test('provider profiles accept the native Anthropic Messages protocol', () => {
  const profile = normalizeProviderDraft({
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    wireApiPreference: 'anthropic',
    models: [{ id: 'claude-sonnet', label: 'Claude Sonnet' }],
    defaultModelId: 'claude-sonnet',
    authMode: 'x-api-key'
  });
  assert.equal(profile.wireApiPreference, 'anthropic');
  assert.equal(profile.anthropicVersion, '2023-06-01');
});

test('Responses requests become Anthropic system, tools, results, and thinking budgets', () => {
  const translated = buildAnthropicRequest({
    requestBody: {
      model: 'claude-sonnet',
      instructions: 'Work carefully.',
      reasoning: { effort: 'high' },
      tools: [{ type: 'custom', name: 'shell', description: 'Run shell.' }],
      input: [{ role: 'user', type: 'message', content: [{ type: 'input_text', text: 'Read the project.' }] }]
    },
    launch: { modelId: 'claude-sonnet', maxOutputTokens: 40000 }
  });
  assert.equal(translated.body.system, 'Work carefully.');
  assert.equal(translated.body.messages[0].role, 'user');
  assert.equal(translated.body.tools[0].name, 'shell');
  assert.equal(translated.body.thinking.type, 'enabled');
  assert.equal(translated.body.thinking.budget_tokens, 16384);
});

test('Anthropic tool disabling omits unsupported tool_choice none and tool declarations', () => {
  const translated = buildAnthropicRequest({
    requestBody: {
      model: 'claude-sonnet',
      input: 'Answer directly.',
      tool_choice: 'none',
      tools: [{ type: 'function', name: 'read_file', parameters: { type: 'object' } }]
    },
    launch: { modelId: 'claude-sonnet' }
  });
  assert.equal(translated.body.tool_choice, undefined);
  assert.equal(translated.body.tools, undefined);
});

test('signed Anthropic thinking survives a tool round through encrypted_content', () => {
  const converted = convertAnthropicResponse({
    id: 'msg_one',
    model: 'claude-sonnet',
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 5 },
    content: [
      { type: 'thinking', thinking: 'Need a file.', signature: 'signed-value' },
      { type: 'tool_use', id: 'call_one', name: 'shell', input: { input: 'cat main.tex' } }
    ]
  }, {
    requestBody: {},
    toolContext: { byUpstreamName: new Map([['shell', { kind: 'custom', name: 'shell', upstreamName: 'shell' }]]) }
  });
  const reasoning = converted.response.output[0];
  assert.equal(decodeAnthropicThinkingBlock(reasoning.encrypted_content).signature, 'signed-value');

  const replay = buildAnthropicRequest({
    requestBody: {
      model: 'claude-sonnet',
      tools: [{ type: 'custom', name: 'shell' }],
      input: [
        reasoning,
        converted.response.output[1],
        { type: 'custom_tool_call_output', call_id: 'call_one', output: 'file contents' }
      ]
    },
    launch: { modelId: 'claude-sonnet' }
  });
  const assistant = replay.body.messages.find(message => message.role === 'assistant');
  const toolResult = replay.body.messages.find(message => (
    message.role === 'user' && message.content.some(block => block.type === 'tool_result')
  ));
  assert.equal(assistant.content[0].type, 'thinking');
  assert.equal(assistant.content[1].type, 'tool_use');
  assert.equal(toolResult.content[0].type, 'tool_result');
});

test('Anthropic stop reasons and cache usage map to Responses semantics', () => {
  const converted = convertAnthropicResponse({
    id: 'msg_two',
    model: 'claude-sonnet',
    stop_reason: 'max_tokens',
    usage: { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 5, output_tokens: 7 },
    content: [{ type: 'text', text: 'Partial' }]
  }, { requestBody: {} });
  assert.equal(converted.response.status, 'incomplete');
  assert.equal(converted.response.incomplete_details.reason, 'max_output_tokens');
  assert.equal(converted.response.usage.input_tokens, 35);
  assert.equal(converted.response.usage.input_tokens_details.cached_tokens, 20);
});

test('Anthropic SSE streams text and tool JSON as Responses events', async () => {
  const source = [
    'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-sonnet","usage":{"input_tokens":3}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n'
  ];
  const writes = [];
  const res = { writeHead() {}, write(value) { writes.push(value); }, end() {} };
  const converted = await streamAnthropicResponse({
    upstream: { body: Readable.from(source) },
    res,
    context: { model: 'claude-sonnet', requestBody: {} }
  });
  assert.equal(converted.response.status, 'completed');
  assert.equal(converted.response.output[0].content[0].text, 'Hello');
  assert.match(writes.join(''), /response\.output_text\.delta/);
});

test('Anthropic streaming cache usage is not counted twice', async () => {
  const source = [
    'event: message_start\ndata: {"type":"message_start","message":{"model":"claude-sonnet","usage":{"input_tokens":10,"cache_read_input_tokens":20,"cache_creation_input_tokens":5}}}\n\n',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"ok"}}\n\n',
    'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n'
  ];
  const res = { writeHead() {}, write() {}, end() {} };
  const converted = await streamAnthropicResponse({
    upstream: { body: Readable.from(source) },
    res,
    context: { model: 'claude-sonnet', requestBody: {} }
  });
  assert.equal(converted.response.usage.input_tokens, 35);
  assert.equal(converted.response.usage.total_tokens, 42);
});

test('Anthropic routing handles official headers and full endpoint suffixes', () => {
  const launch = {
    baseUrl: 'https://api.anthropic.com',
    authMode: 'x-api-key',
    apiKey: 'secret',
    anthropicVersion: '2023-06-01'
  };
  assert.equal(buildAnthropicMessagesUrl(launch.baseUrl, launch), 'https://api.anthropic.com/v1/messages');
  assert.equal(buildAnthropicMessagesUrl('https://api.anthropic.com/v1', launch), 'https://api.anthropic.com/v1/messages');
  assert.equal(buildAnthropicMessagesUrl('https://gateway.example/api/v1/messages', launch), 'https://gateway.example/api/v1/messages');
  const headers = buildAnthropicHeaders(launch);
  assert.equal(headers['x-api-key'], 'secret');
  assert.equal(headers['anthropic-version'], '2023-06-01');
});
