(function initOverleafEditor(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CodexOverleafEditorAdapter = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function overleafEditorFactory() {
  'use strict';

  function create(deps = {}) {
    function detectEditor() {
      if (deps.getCodeMirrorEditorView?.()) {
        return {
          ok: true,
          type: 'codemirror-view'
        };
      }
      if (deps.findEditorTextArea?.()) {
        return {
          ok: true,
          type: 'textarea'
        };
      }
      if (deps.findEditorContentNode?.('.cm-content')) {
        return {
          ok: true,
          type: 'codemirror'
        };
      }
      if (deps.findEditorContentNode?.('[contenteditable="true"]')) {
        return {
          ok: true,
          type: 'contenteditable'
        };
      }
      return {
        ok: false,
        type: 'unknown'
      };
    }

    function readActiveEditorText() {
      const editorView = deps.getCodeMirrorEditorView?.();
      if (editorView) {
        return deps.getCodeMirrorDocText(editorView);
      }

      const active = deps.getDeepActiveElement?.();
      if (active && active.tagName === 'TEXTAREA' && !deps.isInsideCodexPanel?.(active)) {
        return active.value;
      }

      const textarea = deps.findEditorTextArea?.();
      if (textarea) {
        return textarea.value;
      }

      const cm = deps.findEditorContentNode?.('.cm-content');
      if (cm) {
        return cm.innerText || cm.textContent || '';
      }

      const editable = deps.findEditorContentNode?.('[contenteditable="true"]');
      if (editable) {
        return editable.innerText || editable.textContent || '';
      }

      return '';
    }

    function replaceActiveEditorText(text) {
      const editorView = deps.getCodeMirrorEditorView?.();
      if (editorView) {
        const from = 0;
        const to = deps.getCodeMirrorDocLength(editorView);
        editorView.dispatch({
          changes: {
            from,
            to,
            insert: text
          }
        });
        return {
          ok: true,
          method: 'codemirror-view'
        };
      }

      const active = deps.getDeepActiveElement?.();
      const textarea = active?.tagName === 'TEXTAREA' && !deps.isInsideCodexPanel?.(active)
        ? active
        : deps.findEditorTextArea?.();

      if (textarea) {
        textarea.focus();
        textarea.value = text;
        textarea.dispatchEvent(new deps.InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: text }));
        textarea.dispatchEvent(new deps.Event('change', { bubbles: true }));
        return {
          ok: true,
          method: 'textarea'
        };
      }

      const editable = deps.findEditorContentNode?.('.cm-content') || deps.findEditorContentNode?.('[contenteditable="true"]');
      if (editable) {
        editable.focus();
        deps.document.execCommand('selectAll', false, null);
        deps.document.execCommand('insertText', false, text);
        editable.dispatchEvent(new deps.InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: text }));
        return {
          ok: true,
          method: 'contenteditable'
        };
      }

      return {
        ok: false,
        reason: 'No editable surface was detected'
      };
    }

    function replaceActiveEditorPatches(patches, nextContent) {
      const normalized = deps.normalizeTextPatches(patches, readActiveEditorText().length);
      if (!normalized.ok) {
        return normalized;
      }

      const editorView = deps.getCodeMirrorEditorView?.();
      if (editorView) {
        editorView.dispatch({
          changes: normalized.patches.map(patch => ({
            from: patch.from,
            to: patch.to,
            insert: patch.insert
          }))
        });
        return {
          ok: true,
          method: 'codemirror-view-patch'
        };
      }

      const active = deps.getDeepActiveElement?.();
      const textarea = active?.tagName === 'TEXTAREA' && !deps.isInsideCodexPanel?.(active)
        ? active
        : deps.findEditorTextArea?.();

      if (textarea && typeof textarea.setRangeText === 'function') {
        textarea.focus();
        for (const patch of normalized.patches.slice().sort((left, right) => right.from - left.from)) {
          textarea.setRangeText(patch.insert, patch.from, patch.to, 'end');
        }
        textarea.dispatchEvent(new deps.InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: '' }));
        textarea.dispatchEvent(new deps.Event('change', { bubbles: true }));
        return {
          ok: true,
          method: 'textarea-patch'
        };
      }

      const result = replaceActiveEditorText(nextContent);
      return result.ok
        ? {
          ...result,
          method: `${result.method}-patch-fallback`
        }
        : result;
    }

    return {
      detectEditor,
      readActiveEditorText,
      replaceActiveEditorPatches,
      replaceActiveEditorText
    };
  }

  return {
    create
  };
});
