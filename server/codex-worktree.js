import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { CODEX_HOME } from './codex-config.js';

const execFileAsync = promisify(execFile);
const WORKTREE_ROOT = process.env.CODEXMOBILE_WORKTREE_ROOT || path.join(CODEX_HOME, 'worktrees', 'codexmobile');

export function normalizeRunMode(runMode) {
  return runMode === 'newWorktree' ? 'newWorktree' : 'local';
}

async function git(args, cwd) {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: 30000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true
  });
  return String(stdout || '').trim();
}

function safeSegment(value, fallback = 'project') {
  const segment = String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return segment || fallback;
}

function timestampSegment() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}

function worktreeError(message, cause) {
  const error = new Error(message);
  error.cause = cause;
  error.statusCode = 400;
  return error;
}

export async function prepareCodexRunTarget({ projectPath, runMode, sessionId }) {
  const requestedMode = normalizeRunMode(runMode);
  const originalProjectPath = path.resolve(projectPath);

  if (requestedMode !== 'newWorktree' || sessionId) {
    return {
      requestedMode,
      effectiveMode: 'local',
      workingDirectory: originalProjectPath,
      originalProjectPath,
      worktree: null
    };
  }

  let gitRoot;
  let prefix;
  try {
    gitRoot = await git(['rev-parse', '--show-toplevel'], originalProjectPath);
    prefix = await git(['rev-parse', '--show-prefix'], originalProjectPath);
  } catch (error) {
    throw worktreeError('New worktree mode requires the selected project to be inside a git repository.', error);
  }

  const repoName = safeSegment(path.basename(gitRoot), 'repo');
  const suffix = `${timestampSegment()}-${crypto.randomBytes(2).toString('hex')}`;
  const branch = `codexmobile/${repoName}-${suffix}`;
  const worktreePath = path.join(WORKTREE_ROOT, `${repoName}-${suffix}`);

  await fs.mkdir(WORKTREE_ROOT, { recursive: true });
  try {
    await git(['worktree', 'add', '-b', branch, worktreePath, 'HEAD'], gitRoot);
  } catch (error) {
    throw worktreeError(`Failed to create git worktree for ${repoName}.`, error);
  }

  const relativePrefix = prefix ? prefix.replace(/[\\/]$/, '') : '';
  const workingDirectory = relativePrefix ? path.join(worktreePath, relativePrefix) : worktreePath;

  return {
    requestedMode,
    effectiveMode: 'newWorktree',
    workingDirectory,
    originalProjectPath,
    worktree: {
      branch,
      gitRoot,
      path: worktreePath
    }
  };
}
