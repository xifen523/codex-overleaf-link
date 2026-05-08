#!/usr/bin/env node
'use strict';

const { decodeFrames, encodeMessage } = require('./nativeMessaging');
const { logDebug } = require('./debugLog');
const { handleRequest } = require('./taskRunner');
const { buildNativeRuntimeEnv, summarizeNativeEnvironment } = require('./nativeEnvironment');

let buffered = Buffer.alloc(0);
const runtimeEnv = buildNativeRuntimeEnv(process.env);
Object.assign(process.env, runtimeEnv);
logDebug('environment.ready', summarizeNativeEnvironment(runtimeEnv));

process.stdin.on('data', chunk => {
  logDebug('stdin.data', { bytes: chunk.length, bufferedBytes: buffered.length });
  buffered = Buffer.concat([buffered, chunk]);

  let decoded;
  try {
    decoded = decodeFrames(buffered);
  } catch (error) {
    writeResponse({
      ok: false,
      error: {
        code: 'invalid_native_message',
        message: error.message
      }
    });
    buffered = Buffer.alloc(0);
    return;
  }

  buffered = decoded.remainder;
  for (const message of decoded.messages) {
    handleDecodedMessage(message);
  }
});

async function handleDecodedMessage(message) {
  try {
    logDebug('request.received', summarizeRequest(message));
    const response = await handleRequest(message, runtimeEnv, event => {
      writeResponse({
        id: message?.id,
        ok: true,
        event
      });
    });
    logDebug('response.ready', summarizeResponse(response));
    writeResponse(response);
  } catch (error) {
    const response = {
      id: message?.id,
      ok: false,
      error: {
        code: 'internal_error',
        message: error.message
      }
    };
    logDebug('response.internal_error', summarizeResponse(response));
    writeResponse(response);
  }
}

process.stdin.on('error', error => {
  logDebug('stdin.error', { message: error.message });
  console.error(`stdin error: ${error.message}`);
});

process.on('uncaughtException', error => {
  logDebug('process.uncaught_exception', {
    message: error.message,
    stack: error.stack
  });
  process.exit(1);
});

process.on('unhandledRejection', reason => {
  logDebug('process.unhandled_rejection', {
    message: reason?.message || String(reason),
    stack: reason?.stack
  });
  process.exit(1);
});

function writeResponse(response) {
  const frame = encodeMessage(response);
  logDebug('stdout.write', { bytes: frame.length, ok: response?.ok, code: response?.error?.code });
  process.stdout.write(frame);
}

function summarizeRequest(message) {
  const params = message?.params || {};
  return {
    id: message?.id,
    method: message?.method,
    mode: params.mode,
    model: params.model,
    reasoningEffort: params.reasoningEffort,
    taskLength: String(params.task || '').length,
    reviewingOk: params.reviewing?.ok,
    checkpointOk: params.checkpoint?.ok,
    activePath: params.project?.activePath,
    fileCount: Array.isArray(params.project?.files) ? params.project.files.length : 0,
    fileSummary: summarizeProjectFiles(params.project?.files)
  };
}

function summarizeProjectFiles(files) {
  return (Array.isArray(files) ? files : []).slice(0, 50).map(file => ({
    path: file?.path,
    kind: file?.kind || (file?.contentBase64 ? 'binary' : 'text'),
    size: Number(file?.size || file?.byteLength || 0) || stringByteLength(file?.content)
  }));
}

function stringByteLength(value) {
  return typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0;
}

function summarizeResponse(response) {
  return {
    id: response?.id,
    ok: response?.ok,
    code: response?.error?.code,
    message: response?.error?.message,
    status: response?.result?.status,
    operationCount: Array.isArray(response?.result?.operations) ? response.result.operations.length : 0,
    hasDeletePlan: Boolean(response?.result?.deletePlan),
    hasPlanId: Boolean(response?.result?.planId)
  };
}
