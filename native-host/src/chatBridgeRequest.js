'use strict';

const {
  applyReasoningControl,
  requiresReasoningContentReplay,
  supportsToolChoice
} = require('./providerReasoning');

function buildChatRequest({ requestBody = {}, launch = {}, historyMessages = [] } = {}) {
  const messages = cloneMessages(historyMessages);
  const instructions = normalizeText(requestBody.instructions);
  if (instructions && !messages.some(message => message.role === 'system')) {
    messages.unshift({ role: 'system', content: instructions });
  }
  const model = normalizeText(requestBody.model) || launch.modelId;
  const replayReasoning = requiresReasoningContentReplay(launch, model);
  appendResponsesInput(messages, requestBody.input, { replayReasoning });
  const { tools, toolKinds } = translateTools(requestBody.tools);
  const body = {
    model,
    messages,
    stream: requestBody.stream !== false
  };
  if (body.stream) {
    body.stream_options = { include_usage: true };
  }
  if (tools.length) {
    body.tools = tools;
  }
  const toolChoice = translateToolChoice(requestBody.tool_choice);
  if (toolChoice && supportsToolChoice(launch, model)) body.tool_choice = toolChoice;
  copyNumber(requestBody, body, 'temperature');
  copyNumber(requestBody, body, 'top_p');
  if (Number.isFinite(Number(requestBody.max_output_tokens))) {
    body.max_tokens = Math.max(1, Math.floor(Number(requestBody.max_output_tokens)));
  }
  if (typeof requestBody.parallel_tool_calls === 'boolean') {
    body.parallel_tool_calls = requestBody.parallel_tool_calls;
  }
  applyReasoningControl(body, requestBody, launch);
  return { body, messages, toolKinds };
}

function appendResponsesInput(messages, input, { replayReasoning = false } = {}) {
  if (typeof input === 'string') {
    if (input) messages.push({ role: 'user', content: input });
    return;
  }
  if (!Array.isArray(input)) return;
  let pendingToolCalls = [];
  let pendingReasoning = '';
  const flushToolCalls = () => {
    if (!pendingToolCalls.length) return;
    const assistant = {
      role: 'assistant',
      content: replayReasoning ? '' : null,
      tool_calls: pendingToolCalls
    };
    if (replayReasoning) assistant.reasoning_content = pendingReasoning || ' ';
    messages.push(assistant);
    pendingToolCalls = [];
    pendingReasoning = '';
  };
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    if (item.type === 'reasoning') {
      flushToolCalls();
      pendingReasoning = extractReasoningText(item);
      continue;
    }
    if (item.type === 'function_call' || item.type === 'custom_tool_call') {
      pendingToolCalls.push(toChatToolCall(item));
      continue;
    }
    flushToolCalls();
    if (item.type === 'function_call_output' || item.type === 'custom_tool_call_output' || item.type === 'computer_call_output') {
      messages.push({
        role: 'tool',
        tool_call_id: normalizeText(item.call_id) || normalizeText(item.id),
        content: normalizeToolOutput(item.output)
      });
      continue;
    }
    if (item.type === 'message' || item.role) {
      const role = normalizeRole(item.role);
      const content = translateMessageContent(item.content);
      if (content !== '' && content !== null) {
        const message = { role, content };
        if (role === 'assistant' && replayReasoning && pendingReasoning) {
          message.reasoning_content = pendingReasoning;
        }
        messages.push(message);
      }
      pendingReasoning = '';
    }
  }
  flushToolCalls();
}

function extractReasoningText(item) {
  const direct = normalizeText(item.reasoning_content || item.reasoning || item.content);
  if (direct) return direct;
  return (Array.isArray(item.summary) ? item.summary : [])
    .map(part => normalizeText(part?.text || part?.content))
    .filter(Boolean)
    .join('\n');
}

function toChatToolCall(item) {
  const isCustom = item.type === 'custom_tool_call';
  const rawArguments = isCustom
    ? JSON.stringify({ input: normalizeText(item.input) })
    : normalizeArguments(item.arguments);
  return {
    id: normalizeText(item.call_id) || normalizeText(item.id),
    type: 'function',
    function: {
      name: normalizeText(item.name),
      arguments: rawArguments
    }
  };
}

function translateMessageContent(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return normalizeToolOutput(content);
  const parts = [];
  let hasStructuredPart = false;
  for (const part of content) {
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'input_text' || part.type === 'output_text' || part.type === 'text') {
      parts.push({ type: 'text', text: normalizeText(part.text) });
    } else if (part.type === 'input_image' || part.type === 'image_url') {
      const url = normalizeText(part.image_url?.url || part.image_url || part.url);
      if (url) {
        hasStructuredPart = true;
        parts.push({ type: 'image_url', image_url: { url } });
      }
    }
  }
  if (!parts.length) return '';
  if (!hasStructuredPart) return parts.map(part => part.text).join('');
  return parts;
}

function translateTools(values) {
  const tools = [];
  const toolKinds = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const name = normalizeText(value?.name || value?.function?.name);
    if (!name || toolKinds.has(name)) continue;
    const kind = value.type === 'custom' ? 'custom' : 'function';
    toolKinds.set(name, kind);
    tools.push({
      type: 'function',
      function: {
        name,
        description: normalizeText(value.description || value.function?.description),
        parameters: kind === 'custom'
          ? {
              type: 'object',
              properties: { input: { type: 'string' } },
              required: ['input'],
              additionalProperties: false
            }
          : normalizeParameters(value.parameters || value.function?.parameters)
      }
    });
  }
  return { tools, toolKinds };
}

function translateToolChoice(value) {
  if (value === 'auto' || value === 'required' || value === 'none') return value;
  const name = normalizeText(value?.name || value?.function?.name);
  return name ? { type: 'function', function: { name } } : '';
}

function normalizeParameters(value) {
  return value && typeof value === 'object'
    ? value
    : { type: 'object', properties: {}, additionalProperties: true };
}

function normalizeArguments(value) {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '{}';
  try { return JSON.stringify(value); } catch (_error) { return '{}'; }
}

function normalizeToolOutput(value) {
  if (typeof value === 'string') return value;
  if (value === undefined || value === null) return '';
  try { return JSON.stringify(value); } catch (_error) { return String(value); }
}

function normalizeRole(value) {
  const role = normalizeText(value).toLowerCase();
  if (role === 'assistant' || role === 'tool' || role === 'system') return role;
  if (role === 'developer') return 'system';
  return 'user';
}

function cloneMessages(messages) {
  try { return JSON.parse(JSON.stringify(Array.isArray(messages) ? messages : [])); } catch (_error) { return []; }
}

function copyNumber(source, target, key) {
  const value = Number(source?.[key]);
  if (Number.isFinite(value)) target[key] = value;
}

function normalizeText(value) {
  return typeof value === 'string' ? value : '';
}

module.exports = { buildChatRequest };
