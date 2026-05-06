'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  getCodexOverleafHome,
  getNativeHostPlatform
} = require('./nativeHostPlatform');

const MAX_FIELD_LENGTH = 8000;

function getDebugLogDir(options = {}) {
  return getCodexOverleafHome(options);
}

function getDebugLogPath(options = {}) {
  const platformPath = getNativeHostPlatform(options) === 'win32' ? path.win32 : path.posix;
  return platformPath.join(getDebugLogDir(options), 'native-host.log');
}

function logDebug(event, detail = {}, options = {}) {
  try {
    const logDir = getDebugLogDir(options);
    const logPath = getDebugLogPath(options);
    fs.mkdirSync(logDir, { recursive: true });
    fs.appendFileSync(logPath, `${JSON.stringify({
      time: new Date().toISOString(),
      event,
      detail: sanitize(detail)
    })}\n`, 'utf8');
  } catch {
    // Debug logging must never break the native messaging host.
  }
}

function truncateText(value, limit = MAX_FIELD_LENGTH) {
  const text = String(value || '');
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}\n...[truncated ${text.length - limit} chars]`;
}

function sanitize(value) {
  if (typeof value === 'string') {
    return truncateText(value);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map(sanitize);
  }
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'content') {
      result[key] = `[${String(item || '').length} chars]`;
    } else if (key === 'files' && Array.isArray(item)) {
      result[key] = item.map(file => ({
        path: file?.path,
        contentLength: String(file?.content || '').length
      }));
    } else {
      result[key] = sanitize(item);
    }
  }
  return result;
}

module.exports = {
  getDebugLogDir,
  getDebugLogPath,
  get LOG_PATH() {
    return getDebugLogPath();
  },
  logDebug,
  truncateText
};
