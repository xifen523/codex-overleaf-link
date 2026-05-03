const assert = require('node:assert/strict');
const test = require('node:test');

const I18n = require('../extension/src/shared/i18n');

test('i18n defaults to English and toggles between English and Chinese', () => {
  assert.equal(I18n.normalizeLocale(), 'en');
  assert.equal(I18n.normalizeLocale('en'), 'en');
  assert.equal(I18n.normalizeLocale('zh'), 'zh');
  assert.equal(I18n.normalizeLocale('fr'), 'en');
  assert.equal(I18n.getOppositeLocale('en'), 'zh');
  assert.equal(I18n.getOppositeLocale('zh'), 'en');
});

test('language switch label describes the target language', () => {
  assert.equal(I18n.t('en', 'switchLanguage'), 'Switch to Chinese');
  assert.equal(I18n.t('zh', 'switchLanguage'), '切换为英文');
});

test('i18n keeps internal mode ids while translating labels', () => {
  assert.equal(I18n.t('en', 'modeAsk'), 'Ask');
  assert.equal(I18n.t('en', 'modeConfirm'), 'Suggest');
  assert.equal(I18n.t('en', 'modeAuto'), 'Auto');
  assert.equal(I18n.t('zh', 'modeAsk'), '只问不改');
  assert.equal(I18n.t('zh', 'modeConfirm'), '建议修改');
  assert.equal(I18n.t('zh', 'modeAuto'), '自动写入');
});
