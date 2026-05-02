(function initReviewing(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafReviewing = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function reviewingFactory() {
  'use strict';

  const CONTROL_REVIEW_PATTERNS = [
    /\breviewing\b/i,
    /\btrack(?:ed)? changes?\s*(?:on|enabled)\b/i,
    /\bsuggest(?:ing|ions?)\s*(?:on|enabled)\b/i
  ];

  const INTERNAL_ACTIVE_REVIEW_PATTERNS = [
    /\b(?:reviewing|track(?:ed)?Changes?|suggest(?:ing|ions?))\s*:\s*true\b/i,
    /\b(?:mode|editingMode|reviewMode)\s*:\s*(?:reviewing|suggesting|track(?:ed)? changes?)\b/i
  ];

  const GENERIC_REVIEW_PATTERNS = [
    /\breview panel\b/i,
    /^\s*review\s*$/i
  ];

  function detectReviewingFromSignals(signals = {}) {
    if (signals.manualOverride === true) {
      return {
        ok: true,
        status: 'manual-override',
        source: 'user-confirmed'
      };
    }

    for (const control of signals.controls || []) {
      const controlText = normalize([
        control.text,
        control.innerText,
        control.ariaLabel,
        control.title,
        control.value,
        control.role,
        control.id,
        control.className,
        control.dataTestId,
        control.dataQa,
        control.dataOlName,
        control.ariaSelected,
        control.ariaCurrent,
        control.htmlSnippet,
        control.ariaPressed === 'true' ? 'pressed' : ''
      ].filter(Boolean).join(' '));

      if (matchesControlReview(controlText) && !isGenericReviewOnly(controlText)) {
        return {
          ok: true,
          status: 'detected',
          source: 'control-text'
        };
      }
    }

    for (const stateText of signals.internalStates || []) {
      const normalized = normalize(stateText);
      if (matchesInternalActiveReview(normalized)) {
        return {
          ok: true,
          status: 'detected',
          source: 'internal-state'
        };
      }
    }

    return {
      ok: false,
      status: 'not-detected',
      source: 'none'
    };
  }

  function matchesControlReview(text) {
    return CONTROL_REVIEW_PATTERNS.some(pattern => pattern.test(text));
  }

  function matchesInternalActiveReview(text) {
    return INTERNAL_ACTIVE_REVIEW_PATTERNS.some(pattern => pattern.test(text));
  }

  function isGenericReviewOnly(text) {
    return GENERIC_REVIEW_PATTERNS.some(pattern => pattern.test(text)) && !/\breviewing\b/i.test(text);
  }

  function normalize(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  return {
    detectReviewingFromSignals
  };
});
