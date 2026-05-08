'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Evaluate whether a skill-installer command is safe to execute.
 * @param {Object} command
 * @param {string} command.executable - The command executable (e.g., 'git').
 * @param {Array<string>} command.args - Command arguments.
 * @param {string} command.cwd - Working directory for the command.
 * @param {Object} options
 * @param {string} options.skillsRoot - Allowed write root for skill installation.
 * @returns {{ approved: boolean, reason: string, category: 'read-only'|'contained-write'|'blocked' }}
 */
function evaluateSkillCommand(command = {}, options = {}) {
  const normalized = normalizeSkillCommand(command);
  const context = normalizeApprovalOptions(options, normalized.cwd);
  if (!normalized.tokens.length || normalized.tokens.some(isUnsafeShellToken)) {
    return blocked('Skill installation commands must be recognized and write only under Codex Overleaf skill roots.');
  }
  if (normalized.rawString && hasUnsupportedShellSyntax(normalized.rawString)) {
    return blocked('Skill installation command uses unsupported shell syntax.');
  }

  const executable = pathBasename(normalized.tokens[0]);
  if (['bash', 'sh', 'zsh'].includes(executable)) {
    const inline = extractShellInlineCommand(normalized.tokens);
    return inline
      ? evaluateSkillCommand({ command: inline, cwd: normalized.cwd }, context)
      : blocked('Shell wrappers are allowed only for a single inline command.');
  }

  if (isAllowedInstallerInspectionCommand(executable, normalized.tokens.slice(1), context)) {
    return {
      approved: true,
      reason: 'Read-only inspection command is contained within allowed skill roots.',
      category: 'read-only'
    };
  }

  if (executable === 'git') {
    const gitClone = evaluateGitCloneInstallerCommand(normalized.tokens, context);
    if (gitClone.approved) {
      return gitClone;
    }
    return blocked(gitClone.reason);
  }

  return blocked('Skill installation commands must be recognized and write only under Codex Overleaf skill roots.');
}

/**
 * Check if a URL is a safe HTTPS git clone target.
 * @param {string} url
 * @returns {{ safe: boolean, reason: string }}
 */
function validateGitCloneUrl(url) {
  const text = String(url || '').trim();
  if (!text) {
    return { safe: false, reason: 'Git clone URL is empty.' };
  }
  if (/^ext::/i.test(text)) {
    return { safe: false, reason: 'Git ext transport is not allowed.' };
  }
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'https:') {
      return { safe: false, reason: 'Git clone URL must use HTTPS.' };
    }
    if (!parsed.hostname) {
      return { safe: false, reason: 'Git clone URL must include a hostname.' };
    }
    return { safe: true, reason: 'Git clone URL uses HTTPS.' };
  } catch {
    return { safe: false, reason: 'Git clone URL must be an absolute HTTPS URL.' };
  }
}

function normalizeApprovalOptions(options = {}, commandCwd = '') {
  const env = options.env || process.env;
  const skillsRoot = path.resolve(String(options.skillsRoot || path.join(String(env.CODEX_HOME || ''), 'skills') || ''));
  const workspacePath = String(options.workspacePath || commandCwd || '').trim();
  const codexHomeSkillsRoot = path.join(String(env.CODEX_HOME || ''), 'skills');
  return {
    ...options,
    env,
    skillsRoot,
    workspacePath,
    cwd: commandCwd || workspacePath,
    readRoots: Array.from(new Set([
      workspacePath,
      commandCwd,
      skillsRoot,
      codexHomeSkillsRoot
    ].filter(root => root && path.isAbsolute(root)).map(root => path.resolve(root)))),
    writeRoots: Array.from(new Set([
      skillsRoot,
      codexHomeSkillsRoot
    ].filter(root => root && path.isAbsolute(root)).map(root => path.resolve(root))))
  };
}

function normalizeSkillCommand(command = {}) {
  const raw = extractCommandValue(command);
  if (Array.isArray(raw)) {
    return {
      tokens: raw.map(String),
      cwd: String(command.cwd || '').trim(),
      rawString: ''
    };
  }
  if (typeof raw === 'string' && raw.trim()) {
    return {
      tokens: tokenizeShellCommand(raw),
      cwd: String(command.cwd || '').trim(),
      rawString: raw
    };
  }
  const executable = String(command.executable || '').trim();
  const args = Array.isArray(command.args) ? command.args.map(String) : [];
  return {
    tokens: executable ? [executable, ...args] : [],
    cwd: String(command.cwd || '').trim(),
    rawString: ''
  };
}

function extractCommandValue(params = {}) {
  if (Array.isArray(params.command) || typeof params.command === 'string') {
    return params.command;
  }
  if (Array.isArray(params.cmd) || typeof params.cmd === 'string') {
    return params.cmd;
  }
  if (Array.isArray(params.argv)) {
    return params.argv;
  }
  if (typeof params.shellCommand === 'string') {
    return params.shellCommand;
  }
  return '';
}

function isAllowedInstallerInspectionCommand(executable, args = [], context = {}) {
  const allowed = new Set([
    'rg', 'grep', 'cat', 'head', 'tail', 'nl', 'ls',
    'wc', 'diff', 'sort', 'tr', 'cut', 'uniq',
    'stat', 'file', 'basename', 'dirname', 'realpath',
    'shasum', 'md5', 'md5sum'
  ]);
  return allowed.has(executable)
    && !hasDisallowedInstallerInspectionArguments(executable, args)
    && areInstallerInspectionReadPathsContained(executable, args, context);
}

function hasDisallowedInstallerInspectionArguments(executable, args = []) {
  if (hasDisallowedCommandArguments(executable, args)) {
    return true;
  }
  const flags = args.map(String);
  if (executable === 'sort') {
    return flags.some((flag, index) => flag === '-o'
      || flag.startsWith('-o')
      || flags[index - 1] === '-o'
      || flag === '--output'
      || flag.startsWith('--output=')
      || flags[index - 1] === '--output');
  }
  if (executable === 'rg') {
    return flags.some(flag => flag === '--pre' || flag.startsWith('--pre='));
  }
  return false;
}

function areInstallerInspectionReadPathsContained(executable, args = [], context = {}) {
  const parsed = parseInstallerInspectionReadPaths(executable, args);
  return parsed.valid
    && parsed.paths.every(target => isInstallerReadPathInsideAllowedRoot(target, context));
}

function parseInstallerInspectionReadPaths(executable, args = []) {
  if (executable === 'tr') {
    return { valid: true, paths: [] };
  }
  if (executable === 'rg' || executable === 'grep') {
    return parseSearchInspectionReadPaths(executable, args);
  }
  const parsed = collectInstallerInspectionArguments(executable, args);
  return parsed.valid
    ? { valid: true, paths: parsed.optionPathValues.concat(parsed.positionals) }
    : { valid: false, paths: [] };
}

function parseSearchInspectionReadPaths(executable, args = []) {
  const parsed = collectInstallerInspectionArguments(executable, args);
  if (!parsed.valid) {
    return { valid: false, paths: [] };
  }

  const paths = [...parsed.optionPathValues];
  if (parsed.noPatternMode || parsed.usesPatternOption) {
    paths.push(...parsed.positionals);
  } else if (parsed.positionals.length > 1) {
    paths.push(...parsed.positionals.slice(1));
  }

  return { valid: true, paths };
}

function collectInstallerInspectionArguments(executable, args = []) {
  const spec = getInstallerInspectionOptionSpec(executable);
  const result = {
    valid: true,
    positionals: [],
    optionPathValues: [],
    usesPatternOption: false,
    noPatternMode: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = String(args[index] || '');
    if (!token) {
      return { ...result, valid: false };
    }

    if (token === '--') {
      result.positionals.push(...args.slice(index + 1).map(String));
      break;
    }

    if (token !== '-' && token.startsWith('--')) {
      const handled = collectLongInstallerInspectionOption(token, args, index, spec, result);
      if (!handled.valid) {
        return { ...result, valid: false };
      }
      if (handled.consumed) {
        index += handled.consumed;
      }
      continue;
    }

    if (token !== '-' && token.startsWith('-')) {
      const handled = collectShortInstallerInspectionOption(token, args, index, spec, result);
      if (!handled.valid) {
        return { ...result, valid: false };
      }
      if (handled.consumed) {
        index += handled.consumed;
      }
      continue;
    }

    result.positionals.push(token);
  }

  return result;
}

function collectLongInstallerInspectionOption(token, args, index, spec, result) {
  const equalsIndex = token.indexOf('=');
  const name = equalsIndex >= 0 ? token.slice(0, equalsIndex) : token;
  const inlineValue = equalsIndex >= 0 ? token.slice(equalsIndex + 1) : null;
  if (spec.noPatternModeOptions.has(name)) {
    result.noPatternMode = true;
  }

  if (inlineValue !== null) {
    collectInstallerInspectionOptionValue(name, inlineValue, spec, result);
    return { valid: true, consumed: 0 };
  }

  if (optionRequiresValue(name, spec)) {
    if (index + 1 >= args.length) {
      return { valid: false, consumed: 0 };
    }
    collectInstallerInspectionOptionValue(name, String(args[index + 1] || ''), spec, result);
    return { valid: true, consumed: 1 };
  }

  return { valid: true, consumed: 0 };
}

function collectShortInstallerInspectionOption(token, args, index, spec, result) {
  const attached = findAttachedShortInstallerInspectionOption(token, spec);
  if (attached) {
    collectInstallerInspectionOptionValue(attached.name, attached.value, spec, result);
    return { valid: true, consumed: 0 };
  }

  if (spec.noPatternModeOptions.has(token)) {
    result.noPatternMode = true;
  }
  if (optionRequiresValue(token, spec)) {
    if (index + 1 >= args.length) {
      return { valid: false, consumed: 0 };
    }
    collectInstallerInspectionOptionValue(token, String(args[index + 1] || ''), spec, result);
    return { valid: true, consumed: 1 };
  }

  return { valid: true, consumed: 0 };
}

function findAttachedShortInstallerInspectionOption(token, spec) {
  const options = [
    ...spec.pathValueOptions,
    ...spec.patternValueOptions,
    ...spec.valueOptions
  ].filter(option => /^-[A-Za-z]$/.test(option));
  const option = options.find(candidate => token.startsWith(candidate) && token.length > candidate.length);
  return option ? { name: option, value: token.slice(option.length) } : null;
}

function collectInstallerInspectionOptionValue(name, value, spec, result) {
  if (spec.pathValueOptions.has(name)) {
    result.optionPathValues.push(value);
  }
  if (spec.patternValueOptions.has(name) || spec.patternPathValueOptions.has(name)) {
    result.usesPatternOption = true;
  }
}

function optionRequiresValue(name, spec) {
  return spec.pathValueOptions.has(name)
    || spec.patternValueOptions.has(name)
    || spec.valueOptions.has(name);
}

function getInstallerInspectionOptionSpec(executable) {
  if (executable === 'rg') {
    return buildInstallerInspectionOptionSpec({
      pathValueOptions: ['-f', '--file', '--ignore-file'],
      patternPathValueOptions: ['-f', '--file'],
      patternValueOptions: ['-e', '--regexp'],
      valueOptions: [
        '-A', '--after-context', '-B', '--before-context', '-C', '--context',
        '-g', '--glob', '--iglob', '-j', '--threads', '-m', '--max-count',
        '-r', '--replace', '-t', '--type', '-T', '--type-not',
        '--color', '--colors', '--context-separator', '--encoding', '--engine',
        '--field-context-separator', '--field-match-separator', '--filter',
        '--max-depth', '--max-filesize', '--path-separator', '--pre-glob',
        '--sort', '--sortr'
      ],
      noPatternModeOptions: ['--files']
    });
  }
  if (executable === 'grep') {
    return buildInstallerInspectionOptionSpec({
      pathValueOptions: ['-f', '--file', '--exclude-from'],
      patternPathValueOptions: ['-f', '--file'],
      patternValueOptions: ['-e', '--regexp'],
      valueOptions: [
        '-A', '--after-context', '-B', '--before-context', '-C', '--context',
        '-D', '--devices', '-d', '--directories', '-m', '--max-count',
        '--binary-files', '--exclude', '--group-separator', '--include', '--label'
      ]
    });
  }
  if (executable === 'head' || executable === 'tail') {
    return buildInstallerInspectionOptionSpec({
      valueOptions: ['-c', '--bytes', '-n', '--lines']
    });
  }
  if (executable === 'cut') {
    return buildInstallerInspectionOptionSpec({
      valueOptions: [
        '-b', '--bytes', '-c', '--characters', '-d', '--delimiter',
        '-f', '--fields', '--output-delimiter'
      ]
    });
  }
  if (executable === 'sort') {
    return buildInstallerInspectionOptionSpec({
      pathValueOptions: ['-T', '--temporary-directory'],
      valueOptions: ['-k', '--key', '-S', '--buffer-size', '-t', '--field-separator']
    });
  }
  if (executable === 'shasum') {
    return buildInstallerInspectionOptionSpec({
      valueOptions: ['-a', '--algorithm']
    });
  }
  return buildInstallerInspectionOptionSpec();
}

function buildInstallerInspectionOptionSpec(input = {}) {
  return {
    pathValueOptions: new Set(input.pathValueOptions || []),
    patternPathValueOptions: new Set(input.patternPathValueOptions || []),
    patternValueOptions: new Set(input.patternValueOptions || []),
    valueOptions: new Set(input.valueOptions || []),
    noPatternModeOptions: new Set(input.noPatternModeOptions || [])
  };
}

function evaluateGitCloneInstallerCommand(tokens = [], context = {}) {
  const parsed = parseGitCloneInstallerCommand(tokens, context.cwd || context.workspacePath);
  if (!parsed) {
    return {
      approved: false,
      reason: 'Only contained git clone commands are allowed for skill installation.',
      category: 'blocked'
    };
  }
  const url = validateGitCloneUrl(parsed.url);
  if (!url.safe) {
    return {
      approved: false,
      reason: url.reason,
      category: 'blocked'
    };
  }
  if (!parsed.writeTargets.length || !parsed.writeTargets.every(target => isInstallerPathInsideAllowedSkillRoot(target, context))) {
    return {
      approved: false,
      reason: 'Git clone destination must stay inside the Codex Overleaf skill root.',
      category: 'blocked'
    };
  }
  return {
    approved: true,
    reason: 'HTTPS git clone destination is contained inside the Codex Overleaf skill root.',
    category: 'contained-write'
  };
}

function parseGitCloneInstallerCommand(tokens = [], cwd = '') {
  if (tokens[1] !== 'clone') {
    return null;
  }
  const writeTargets = [];
  const positionals = [];
  for (let index = 2; index < tokens.length; index += 1) {
    const token = String(tokens[index] || '');
    if (!token) {
      return null;
    }

    if (token === '--') {
      for (let positionalIndex = index + 1; positionalIndex < tokens.length; positionalIndex += 1) {
        positionals.push(String(tokens[positionalIndex] || ''));
      }
      break;
    }

    if (isDisallowedGitCloneOption(token)) {
      return null;
    }

    const separateGitDir = token.match(/^--separate-git-dir=(.+)$/);
    if (separateGitDir) {
      writeTargets.push(separateGitDir[1]);
      continue;
    }
    if (token === '--separate-git-dir') {
      if (index + 1 >= tokens.length) {
        return null;
      }
      writeTargets.push(tokens[index + 1]);
      index += 1;
      continue;
    }
    if (isAllowedGitCloneBooleanOption(token)) {
      continue;
    }
    const inlineOption = parseAllowedGitCloneInlineOption(token);
    if (inlineOption) {
      if (!isAllowedGitCloneOptionValue(inlineOption.name, inlineOption.value)) {
        return null;
      }
      continue;
    }
    if (isAllowedGitCloneValueOption(token)) {
      if (index + 1 >= tokens.length || !isAllowedGitCloneOptionValue(token, tokens[index + 1])) {
        return null;
      }
      index += 1;
      continue;
    }
    if (token.startsWith('-')) {
      return null;
    }
    positionals.push(token);
  }

  if (positionals.length < 1 || positionals.length > 2 || !positionals.every(Boolean)) {
    return null;
  }

  if (positionals.length === 2) {
    writeTargets.push(positionals[1]);
  } else {
    writeTargets.push(cwd || '.');
  }
  return {
    url: positionals[0],
    writeTargets
  };
}

function isDisallowedGitCloneOption(token) {
  return token === '-c'
    || token.startsWith('-c')
    || token === '--config'
    || token.startsWith('--config=')
    || token === '--upload-pack'
    || token.startsWith('--upload-pack=')
    || token === '-u'
    || token.startsWith('-u');
}

function isAllowedGitCloneBooleanOption(token) {
  return new Set([
    '--quiet',
    '-q',
    '--verbose',
    '-v',
    '--progress',
    '--no-checkout',
    '-n',
    '--bare',
    '--mirror',
    '--single-branch',
    '--no-single-branch',
    '--no-tags'
  ]).has(token);
}

function parseAllowedGitCloneInlineOption(token) {
  const match = String(token || '').match(/^(--depth|--branch|--filter|--origin)=(.+)$/);
  return match ? { name: match[1], value: match[2] } : null;
}

function isAllowedGitCloneValueOption(token) {
  return new Set(['--depth', '--branch', '-b', '--filter', '--origin', '-o']).has(token);
}

function isAllowedGitCloneOptionValue(option, value) {
  const text = String(value || '');
  if (!text || text.startsWith('-') || /[\0\r\n]/.test(text)) {
    return false;
  }
  if (option === '--depth') {
    return /^[1-9][0-9]{0,5}$/.test(text);
  }
  if (option === '--branch' || option === '-b') {
    return isSafeGitRefName(text);
  }
  if (option === '--filter') {
    return /^(blob:none|tree:[0-9]+)$/.test(text);
  }
  if (option === '--origin' || option === '-o') {
    return /^[A-Za-z0-9._-]{1,64}$/.test(text) && !text.includes('..');
  }
  return false;
}

function isSafeGitRefName(value) {
  const text = String(value || '');
  return text.length <= 200
    && !text.includes('..')
    && !text.includes('//')
    && !text.includes('@{')
    && !text.endsWith('.')
    && !/[\\\s~^:?*[\]\0\r\n]/.test(text);
}

function isInstallerReadPathInsideAllowedRoot(value, context = {}) {
  if (!isReadablePathArgument(value)) {
    return true;
  }
  const expanded = expandInstallerPath(value, context);
  return Boolean(expanded) && isInsideAllowedInstallerReadRoot(expanded, context);
}

function isReadablePathArgument(value) {
  const text = String(value || '').trim();
  return Boolean(text) && text !== '-';
}

function isInstallerPathInsideAllowedSkillRoot(value, context = {}) {
  const expanded = expandInstallerPath(value, context);
  return Boolean(expanded) && isInsideAllowedSkillWriteRoot(expanded, context);
}

function expandInstallerPath(value, context = {}) {
  const text = String(value || '').trim();
  if (!text || isUrlLike(text)) {
    return '';
  }
  let expanded = text;
  const env = context.env || process.env;
  if (expanded === '~' || expanded.startsWith('~/')) {
    const home = String(env.HOME || '');
    if (!home || !path.isAbsolute(home)) {
      return '';
    }
    expanded = expanded === '~' ? home : path.join(home, expanded.slice(2));
  } else if (expanded.startsWith('~')) {
    return '';
  }
  expanded = expandInstallerEnvironmentVariables(expanded, env);
  if (expanded.includes('$')) {
    return '';
  }
  return path.isAbsolute(expanded)
    ? path.resolve(expanded)
    : path.resolve(context.cwd || context.workspacePath || process.cwd(), expanded);
}

function expandInstallerEnvironmentVariables(value, env = process.env) {
  return String(value || '').replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (_, bracedName, bareName) => String(env[bracedName || bareName] || '')
  );
}

function isInsideAllowedInstallerReadRoot(target, context = {}) {
  try {
    const approvedRootSymlinkTargets = getApprovedSkillRootSymlinkTargets(context);
    const roots = context.readRoots || [];
    return roots.some(root => isSafeContainedReadTarget(target, root, { approvedRootSymlinkTargets }));
  } catch {
    return false;
  }
}

function isInsideAllowedSkillWriteRoot(target, context = {}) {
  try {
    const approvedRootSymlinkTargets = getApprovedSkillRootSymlinkTargets(context);
    const roots = context.writeRoots || [];
    return roots.some(root => isSafeContainedWriteTarget(target, root, { approvedRootSymlinkTargets }));
  } catch {
    return false;
  }
}

function getApprovedSkillRootSymlinkTargets(context = {}) {
  const targets = new Set();
  const realRoot = safeRealpathNonSymlinkDirectory(context.skillsRoot);
  if (realRoot) {
    targets.add(realRoot);
  }
  return targets;
}

function isSafeContainedReadTarget(target, root, options = {}) {
  const resolvedTarget = path.resolve(String(target || ''));
  const resolvedRoot = path.resolve(String(root || ''));
  if (!isLexicallyInsideOrSame(resolvedTarget, resolvedRoot)) {
    return false;
  }

  const rootExists = fs.existsSync(resolvedRoot);
  const rootReal = safeRealpathDirectory(resolvedRoot, options.approvedRootSymlinkTargets);
  if (rootExists && !rootReal) {
    return false;
  }
  const relativeParts = path.relative(resolvedRoot, resolvedTarget).split(path.sep).filter(Boolean);
  let current = resolvedRoot;
  if (!rootExists) {
    return true;
  }

  for (let index = 0; index < relativeParts.length; index += 1) {
    current = path.join(current, relativeParts[index]);
    if (!fs.existsSync(current)) {
      return true;
    }
    const isFinalPart = index === relativeParts.length - 1;
    const safe = isFinalPart
      ? isSafeExistingReadPath(current, rootReal)
      : isSafeExistingDirectory(current, rootReal);
    if (!safe) {
      return false;
    }
  }
  return true;
}

function safeRealpathNonSymlinkDirectory(target) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      return '';
    }
    return fs.realpathSync.native(target);
  } catch {
    return '';
  }
}

function isSafeContainedWriteTarget(target, root, options = {}) {
  const resolvedTarget = path.resolve(String(target || ''));
  const resolvedRoot = path.resolve(String(root || ''));
  if (!isLexicallyInsideOrSame(resolvedTarget, resolvedRoot)) {
    return false;
  }

  const rootReal = safeRealpathDirectory(resolvedRoot, options.approvedRootSymlinkTargets);
  const relativeParts = path.relative(resolvedRoot, resolvedTarget).split(path.sep).filter(Boolean);
  let current = resolvedRoot;
  if (!isSafeExistingDirectory(current, rootReal)) {
    return !fs.existsSync(current);
  }

  for (const part of relativeParts) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) {
      return true;
    }
    if (!isSafeExistingDirectory(current, rootReal)) {
      return false;
    }
  }
  return true;
}

function isSafeExistingReadPath(target, rootReal) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) {
      if (!rootReal) {
        return false;
      }
      const realTarget = fs.realpathSync.native(target);
      return isLexicallyInsideOrSame(realTarget, rootReal);
    }
    if (!rootReal) {
      return true;
    }
    const realTarget = fs.realpathSync.native(target);
    return isLexicallyInsideOrSame(realTarget, rootReal);
  } catch (error) {
    return error.code === 'ENOENT';
  }
}

function safeRealpathDirectory(target, approvedRootSymlinkTargets = new Set()) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) {
      const realTarget = fs.realpathSync.native(target);
      return fs.statSync(realTarget).isDirectory() && approvedRootSymlinkTargets.has(realTarget)
        ? realTarget
        : '';
    }
    if (!stat.isDirectory()) {
      return '';
    }
    return fs.realpathSync.native(target);
  } catch {
    return '';
  }
}

function isSafeExistingDirectory(target, rootReal) {
  try {
    const stat = fs.lstatSync(target);
    if (stat.isSymbolicLink()) {
      if (!rootReal) {
        return false;
      }
      const realTarget = fs.realpathSync.native(target);
      return isLexicallyInsideOrSame(realTarget, rootReal);
    }
    if (!stat.isDirectory()) {
      return false;
    }
    if (!rootReal) {
      return true;
    }
    const realTarget = fs.realpathSync.native(target);
    return isLexicallyInsideOrSame(realTarget, rootReal);
  } catch (error) {
    return error.code === 'ENOENT';
  }
}

function isLexicallyInsideOrSame(target, root) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (relative && !relative.startsWith('..') && !path.isAbsolute(relative));
}

function isUrlLike(value) {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(String(value || ''));
}

function hasUnsupportedShellSyntax(command) {
  return hasAmbiguousShellEscape(command) || hasUnbalancedShellQuote(command);
}

function hasAmbiguousShellEscape(command) {
  return /\\["';&|<>`$(){}\n\r]/.test(command);
}

function hasUnbalancedShellQuote(command) {
  let quote = '';
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (char === '\\' && quote !== "'") {
      index += 1;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = '';
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    }
  }
  return Boolean(quote);
}

function isUnsafeShellToken(token) {
  return ['&&', '||', ';', '|', '>', '>>', '<', '<<', '`'].includes(token)
    || /\$\(/.test(token);
}

function hasDisallowedCommandArguments(executable, args = []) {
  const flags = args.map(String);
  if (executable === 'find') {
    return flags.some(flag => ['-exec', '-execdir', '-delete', '-ok', '-okdir'].includes(flag));
  }
  if (executable === 'sed') {
    return flags.some(flag => flag === '-i' || /^-i[^a-zA-Z0-9]?/.test(flag));
  }
  if (executable === 'awk') {
    return flags.some((flag, index) => flag === '-i' && flags[index + 1] === 'inplace');
  }
  if (executable === 'shasum' || executable === 'md5sum') {
    return flags.some(flag => flag === '-c' || flag === '--check');
  }
  return false;
}

function pathBasename(value) {
  return String(value || '').split(/[\\/]/).pop();
}

function extractShellInlineCommand(tokens = []) {
  const index = tokens.findIndex(token => token === '-c' || token === '-lc' || token === '-ilc');
  if (index < 0 || index + 1 >= tokens.length || tokens.length !== index + 2) {
    return '';
  }
  return tokens[index + 1];
}

function tokenizeShellCommand(command) {
  const tokens = [];
  let current = '';
  let quote = '';
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) {
        quote = '';
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    if (char === '&' && command[index + 1] === '&') {
      if (current) tokens.push(current);
      tokens.push('&&');
      current = '';
      index += 1;
      continue;
    }
    if (char === '|' && command[index + 1] === '|') {
      if (current) tokens.push(current);
      tokens.push('||');
      current = '';
      index += 1;
      continue;
    }
    if (';|<>`'.includes(char)) {
      if (current) tokens.push(current);
      tokens.push(char);
      current = '';
      continue;
    }
    current += char;
  }
  if (current) {
    tokens.push(current);
  }
  return tokens;
}

function blocked(reason) {
  return {
    approved: false,
    reason,
    category: 'blocked'
  };
}

module.exports = { evaluateSkillCommand, validateGitCloneUrl };
