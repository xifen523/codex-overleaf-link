const assert = require('node:assert/strict');
const test = require('node:test');

const {
  COMPILABLE_EXTENSIONS,
  MAX_LOG_BYTES,
  extractErrorBlocks,
  isCompilableFile,
  isCompileLogFresh,
  parseCompileResponse,
  parseLogErrors,
  truncateLogForContext
} = require('../extension/src/shared/compileAdapter');

test('parseCompileResponse extracts log URL from outputFiles', () => {
  const response = {
    status: 'success',
    outputFiles: [
      { path: 'output.pdf', type: 'pdf', url: 'https://example.com/output.pdf' },
      { path: 'output.log', type: 'log', url: 'https://example.com/output.log' }
    ]
  };

  const result = parseCompileResponse(response);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'success');
  assert.equal(result.logUrl, 'https://example.com/output.log');
  assert.equal(result.logPath, 'output.log');
});

test('parseCompileResponse handles missing log file', () => {
  const response = {
    status: 'success',
    outputFiles: [
      { path: 'output.pdf', type: 'pdf', url: 'https://example.com/output.pdf' }
    ]
  };

  const result = parseCompileResponse(response);
  assert.equal(result.ok, false);
  assert.match(result.reason, /No log file/);
});

test('parseCompileResponse handles compile failure status but still returns log URL', () => {
  const response = {
    status: 'failure',
    outputFiles: [
      { path: 'output.log', type: 'log', url: 'https://example.com/output.log' }
    ]
  };

  const result = parseCompileResponse(response);
  assert.equal(result.ok, true);
  assert.equal(result.status, 'failure');
  assert.equal(result.logUrl, 'https://example.com/output.log');
});

test('parseCompileResponse handles null/invalid response', () => {
  assert.equal(parseCompileResponse(null).ok, false);
  assert.equal(parseCompileResponse(undefined).ok, false);
  assert.equal(parseCompileResponse('string').ok, false);
  assert.equal(parseCompileResponse({}).ok, false);
  assert.equal(parseCompileResponse({ outputFiles: 'not-array' }).ok, false);
});

test('truncateLogForContext preserves short logs unchanged', () => {
  const shortLog = 'This is a short log.\nNo errors here.\n';
  assert.equal(truncateLogForContext(shortLog), shortLog);
});

test('truncateLogForContext keeps error blocks and tail within 32KB for large logs', () => {
  // Generate a large log with errors
  const errorLine = '! Undefined control sequence.\nl.42 \\badcommand\n\n';
  const filler = 'This is a normal log line with some information about compilation.\n';
  let largelog = errorLine;
  while (largelog.length < 100000) {
    largelog += filler;
  }
  largelog += '! Another error at the end.\nl.999 \\anotherBad\n\n';

  const result = truncateLogForContext(largelog);
  const resultSize = new Blob([result]).size;
  assert.ok(resultSize <= MAX_LOG_BYTES, `Result ${resultSize} should be <= ${MAX_LOG_BYTES}`);
  // Should contain error markers
  assert.ok(result.includes('!'), 'Should preserve error blocks');
});

test('truncateLogForContext handles empty/null input', () => {
  assert.equal(truncateLogForContext(null), '');
  assert.equal(truncateLogForContext(undefined), '');
  assert.equal(truncateLogForContext(''), '');
});

test('isCompileLogFresh returns true when source unchanged since compile', () => {
  const log = { sourceChangeTimestamp: 1000 };
  assert.equal(isCompileLogFresh(log, 1000), true);
  assert.equal(isCompileLogFresh(log, 999), true);
});

test('isCompileLogFresh returns false when source changed after compile', () => {
  const log = { sourceChangeTimestamp: 1000 };
  assert.equal(isCompileLogFresh(log, 1001), false);
});

test('isCompileLogFresh returns false for null/missing sourceChangeTimestamp', () => {
  assert.equal(isCompileLogFresh(null, 1000), false);
  assert.equal(isCompileLogFresh({}, 1000), false);
  assert.equal(isCompileLogFresh({ sourceChangeTimestamp: null }, 1000), false);
});

test('isCompilableFile returns true for .tex, .bib, .sty, .cls, .bst, .bbx, .cbx', () => {
  assert.equal(isCompilableFile('main.tex'), true);
  assert.equal(isCompilableFile('refs.bib'), true);
  assert.equal(isCompilableFile('custom.sty'), true);
  assert.equal(isCompilableFile('article.cls'), true);
  assert.equal(isCompilableFile('plain.bst'), true);
  assert.equal(isCompilableFile('biblatex.bbx'), true);
  assert.equal(isCompilableFile('citation.cbx'), true);
});

test('isCompilableFile returns false for .pdf, .png, .txt, .md', () => {
  assert.equal(isCompilableFile('output.pdf'), false);
  assert.equal(isCompilableFile('figure.png'), false);
  assert.equal(isCompilableFile('notes.txt'), false);
  assert.equal(isCompilableFile('README.md'), false);
});

test('isCompilableFile handles null/empty input', () => {
  assert.equal(isCompilableFile(null), false);
  assert.equal(isCompilableFile(''), false);
  assert.equal(isCompilableFile(undefined), false);
});

test('parseLogErrors extracts errors starting with !', () => {
  const log = [
    'This is pdfTeX, Version 3.14',
    '! Undefined control sequence.',
    'l.10 \\badcommand',
    '                 some context',
    'more context',
    '',
    '! Missing $ inserted.',
    'l.20 some math',
    'context1',
    'context2'
  ].join('\n');

  const result = parseLogErrors(log);
  assert.equal(result.errors.length, 2);
  assert.ok(result.errors[0].startsWith('! Undefined control sequence.'));
  assert.ok(result.errors[1].startsWith('! Missing $ inserted.'));
  // Each error should have up to 3 context lines
  assert.ok(result.errors[0].includes('l.10'));
});

test('parseLogErrors extracts warnings', () => {
  const log = [
    'This is pdfTeX',
    'LaTeX Warning: Reference `fig1` on page 2 undefined.',
    '  (indented line should be skipped)',
    'Package hyperref Warning: Token not allowed in a PDF string.',
    'Normal line'
  ].join('\n');

  const result = parseLogErrors(log);
  assert.equal(result.warnings.length, 2);
  assert.ok(result.warnings[0].includes('Reference'));
  assert.ok(result.warnings[1].includes('hyperref'));
});

test('parseLogErrors handles empty log', () => {
  const result = parseLogErrors('');
  assert.deepEqual(result, { errors: [], warnings: [] });
  assert.deepEqual(parseLogErrors(null), { errors: [], warnings: [] });
});

test('COMPILABLE_EXTENSIONS is a Set with 7 entries', () => {
  assert.ok(COMPILABLE_EXTENSIONS instanceof Set);
  assert.equal(COMPILABLE_EXTENSIONS.size, 7);
});

test('compile bridge invalidates cached compile logs after source edits', () => {
  const compileBridge = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../extension/src/page/compileBridge.js'),
    'utf8'
  );

  assert.match(compileBridge, /lastCompileSourceChangeTimestamp/);
  assert.match(compileBridge, /const compileLogFresh = CompileAdapter\.isCompileLogFresh/);
  assert.match(compileBridge, /\|\| !compileLogFresh/);
  assert.match(compileBridge, /typeof pageDocument\.addEventListener === 'function'/);
  assert.match(compileBridge, /pageDocument\.addEventListener\('input', markSourceEditFromInput, true\)/);
});

test('compile bridge stamps manual compile logs with request-start source timestamp', () => {
  const compileBridge = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '../extension/src/page/compileBridge.js'),
    'utf8'
  );

  assert.match(compileBridge, /const isCompileRequest = \/\\\/project\\\/\[\^\/\]\+\\\/compile\\b\/\.test\(url\) && method === 'POST'/);
  assert.match(compileBridge, /const compileSourceChangeTimestamp = isCompileRequest \? state\.lastKnownSourceEditTimestamp : 0/);
  assert.match(compileBridge, /lastCompileSourceChangeTimestamp = compileSourceChangeTimestamp/);
});

test('compile bridge install is idempotent for fetch interception and source listeners', async () => {
  const CompileBridge = require('../extension/src/page/compileBridge');
  let cloneCount = 0;
  let inputListenerCount = 0;
  const pageWindow = {
    location: { origin: 'https://www.overleaf.com' },
    CodexOverleafCompileAdapter: {
      parseCompileResponse(json) {
        return { ok: true, logUrl: json.outputFiles[0].url };
      }
    },
    fetch: async () => ({
      ok: true,
      clone() {
        cloneCount += 1;
        return {
          async json() {
            return { outputFiles: [{ path: 'output.log', url: '/output.log' }] };
          }
        };
      }
    })
  };
  const pageDocument = {
    addEventListener(type) {
      if (type === 'input') {
        inputListenerCount += 1;
      }
    }
  };

  const bridge = CompileBridge.create({
    document: pageDocument,
    getActiveFilePath: () => 'main.tex',
    waitForSaveState: async () => ({ ok: true }),
    window: pageWindow
  });
  bridge.install();
  bridge.install();

  await pageWindow.fetch('/project/abc/compile', { method: 'POST' });

  assert.equal(cloneCount, 1);
  assert.equal(inputListenerCount, 1);
});

test('compile bridge can click Overleaf Recompile before a request template is captured', async () => {
  const CompileBridge = require('../extension/src/page/compileBridge');
  let clicked = 0;
  let fetchCount = 0;
  const compileJson = { status: 'success', outputFiles: [{ path: 'output.log', url: '/output.log' }] };
  const pageWindow = {
    location: { origin: 'https://www.overleaf.com' },
    CodexOverleafCompileAdapter: {
      parseCompileResponse(json) {
        return { ok: true, status: json.status, logUrl: json.outputFiles[0].url };
      }
    },
    fetch: async () => {
      fetchCount += 1;
      return {
        ok: true,
        clone() {
          return {
            async json() {
              return compileJson;
            }
          };
        },
        async json() {
          return compileJson;
        }
      };
    }
  };
  const recompileButton = {
    textContent: 'Recompile',
    disabled: false,
    getAttribute(name) {
      return name === 'aria-label' ? 'Recompile' : null;
    },
    click() {
      clicked += 1;
      void pageWindow.fetch('/project/abc/compile', { method: 'POST' });
    }
  };
  const pageDocument = {
    addEventListener() {},
    querySelectorAll(selector) {
      return /button|\[role="button"\]/.test(selector) ? [recompileButton] : [];
    }
  };

  const bridge = CompileBridge.create({
    document: pageDocument,
    getActiveFilePath: () => 'main.tex',
    waitForSaveState: async () => ({ ok: true }),
    window: pageWindow
  });
  bridge.install();

  const result = await bridge.triggerCompile({ waitForSaveMs: 10, captureTimeoutMs: 200 });

  assert.equal(result.ok, true);
  assert.equal(clicked, 1);
  assert.equal(fetchCount, 1);
  assert.equal(result.compile.status, 'success');
});
