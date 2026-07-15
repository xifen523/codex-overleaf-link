'use strict';

function classifyResponsesRoute(method, pathname) {
  if (String(method || '').toUpperCase() !== 'POST') return '';
  const path = String(pathname || '');
  if (/\/responses\/compact\/?$/.test(path)) return 'compact';
  if (/\/responses\/?$/.test(path)) return 'responses';
  return '';
}

module.exports = { classifyResponsesRoute };
