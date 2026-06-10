#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Freeze-line ceilings for the large production files that don't yet have a
// proper "target" split — the rule is "must not grow further from here". The
// number is `current size + ~1%` so a true freeze; future growth requires
// raising the ceiling (which makes the growth deliberate + visible in diff).
// Files marked "split target" have an explicit lower aspirational ceiling
// (`maxLines`) the codebase should converge to; today they're frozen at
// `current + headroom` until the split lands.
export const ARCHITECTURE_FILE_BUDGETS = Object.freeze([
  {
    path: 'extension/src/contentScript.js',
    maxLines: 4500
  },
  {
    // v1.3.9 added cancelActiveWrite + writeCancellationSequence; bumped
    // 2200 → 2250 to fit (~26 lines). Still well under the 2400 v1.3.8 shim.
    path: 'extension/src/pageBridge.js',
    maxLines: 2250
  },
  {
    // Elephant. 12341 lines is unhealthy but a real split needs its own
    // multi-week refactor (panel renderer, run controller, settings, skills,
    // recent-projects, writeback orchestration are all interleaved here).
    // Bumped 12300 → 12400 (v1.3.9 cancel), 12400 → 12600 (v1.3.10 timeline),
    // 12600 → 12700 (v1.4.2 theme), 12700 → 12780 (v1.4.3 diagnostics run-all),
    // 12780 → 12850 (v1.4.4 session management). The split (task #69) is now
    // underway and the ceiling LOWERS with each phase to lock the gain:
    // v1.4.5 carved the markdown/assistant-text renderer + the diagnostics
    // controller (12850 → 11850); v1.4.6 carved the run-timeline render
    // pipeline (11850 → 11000); v1.4.7 carved session management + the
    // apply-result formatters (11000 → 10450); v1.4.8 carved the model picker
    // + the recent-projects dashboard (10450 → 9600); v1.4.9 carved the OT
    // warm-mirror glue (9600 → 8800). The split stops here: what remains is
    // the genuinely cohesive run-orchestration core.
    // + the recent-projects dashboard.
    // 8800 -> 8850 in v1.5.1: the hotfix moved the module-composition wiring
    // above its consumers and documents the hoisted-safe zone (+13 lines).
    path: 'extension/src/content/contentRuntime.js',
    maxLines: 8850
  },
  {
    // Carved from contentRuntime in v1.4.5: markdown/inline rendering, the
    // assistant-visible sanitizers, and line-reference resolution/buttons.
    path: 'extension/src/content/markdownText.js',
    maxLines: 700
  },
  {
    // Carved from contentRuntime in v1.4.5: the diagnostics check runners
    // (inspect*) and result formatters behind the diagnostics menu.
    path: 'extension/src/content/diagnosticsController.js',
    maxLines: 700
  },
  {
    // Carved from contentRuntime in v1.4.6: the run-timeline render pipeline
    // (scroll engine, run cards, stream events, completion report, run-card
    // Undo/Accept controls).
    path: 'extension/src/content/runTimelineView.js',
    maxLines: 950
  },
  {
    // Carved from contentRuntime in v1.4.7: the session lifecycle + list
    // surface (create/switch/rename/delete, header bar, running guards).
    // Raised 400 -> 460 in v1.5.0 for the header session dropdown switcher.
    path: 'extension/src/content/sessionManager.js',
    maxLines: 460
  },
  {
    // Carved from contentRuntime in v1.4.7: apply-result / failure-reason
    // formatters (skipped details, bilingual apply/bridge reasons).
    path: 'extension/src/content/applyResultFormatters.js',
    maxLines: 450
  },
  {
    // Carved from contentRuntime in v1.4.8: model/reasoning/speed catalog,
    // discovery, selects, and the config popover.
    path: 'extension/src/content/modelPicker.js',
    maxLines: 550
  },
  {
    // Carved from contentRuntime in v1.4.8: the cross-project recent-projects
    // dashboard (name cache, welcome/empty/degraded states, row rendering).
    path: 'extension/src/content/recentProjects.js',
    maxLines: 520
  },
  {
    // Carved from contentRuntime in v1.4.9: the experimental OT warm-mirror
    // glue (toggle flow, poll/flush timers, prefetch, warm-start, status).
    path: 'extension/src/content/otWarmMirror.js',
    maxLines: 1000
  },
  {
    // Writeback router: large but cohesive. v1.3.9 added the cross-world
    // cancel racer + per-op race wrapping (~80 lines). Freeze at +50 more.
    path: 'extension/src/page/writebackRouter.js',
    maxLines: 3300
  },
  {
    path: 'extension/src/page/treeOperations.js',
    maxLines: 1650
  },
  {
    path: 'extension/src/shared/storageDb.js',
    maxLines: 1350
  },
  {
    path: 'native-host/src/codexSessionRunner.js',
    maxLines: 1500
  },
  {
    path: 'native-host/src/taskRunner.js',
    maxLines: 1000
  }
]);

export function collectArchitectureBudgetResults(options = {}) {
  const rootDir = path.resolve(options.rootDir || getRepoRoot());
  return ARCHITECTURE_FILE_BUDGETS.map(budget => {
    const fullPath = path.join(rootDir, budget.path);
    const lineCount = fs.existsSync(fullPath) ? countLines(fs.readFileSync(fullPath, 'utf8')) : 0;
    const ceiling = budget.maxLines;
    return {
      path: budget.path,
      lineCount,
      maxLines: budget.maxLines,
      ceiling,
      ok: lineCount > 0 && lineCount <= ceiling,
      targetMet: lineCount > 0 && lineCount <= budget.maxLines
    };
  });
}

export function collectArchitectureBudgetErrors(options = {}) {
  const results = collectArchitectureBudgetResults(options);
  return results
    .filter(result => !result.ok)
    .map(result => {
      if (result.lineCount <= 0) {
        return `${result.path} must exist for architecture budget checks.`;
      }
      return `${result.path} has ${result.lineCount} lines; limit is ${result.ceiling}.`;
    });
}

function countLines(text) {
  if (!text) {
    return 0;
  }
  return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length;
}

function getRepoRoot() {
  const __filename = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(__filename), '..');
}

function runCli() {
  const results = collectArchitectureBudgetResults();
  for (const result of results) {
    const status = result.ok ? 'ok' : 'fail';
    console.log(`${status}\ttarget\t${result.lineCount}/${result.ceiling}\t${result.path}`);
  }
  const errors = collectArchitectureBudgetErrors();
  if (errors.length) {
    for (const error of errors) {
      console.error(error);
    }
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli();
}
