'use strict';

function sanitizeProviderMessage(value, secrets = [], maxLength = 1200) {
  let text = String(value || 'Provider operation failed.');
  const exactSecrets = Array.from(new Set((Array.isArray(secrets) ? secrets : [secrets])
    .map(secret => String(secret || ''))
    .filter(Boolean)))
    .sort((left, right) => right.length - left.length);
  for (const secret of exactSecrets) {
    text = text.split(secret).join('[redacted]');
  }
  return text
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .replace(/(?:api[_ -]?key|token)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .slice(0, maxLength);
}

module.exports = { sanitizeProviderMessage };
