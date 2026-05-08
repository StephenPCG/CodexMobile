import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_GIT_OUTPUT = 1024 * 1024;
const MAX_DIFF_CHARS = 80_000;

function serviceError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function basenameWithoutExtension(filePath = '') {
  const name = String(filePath || '').split('/').filter(Boolean).pop() || 'changes';
  return name.replace(/\.[^.]+$/, '') || name;
}

function titleWord(value = '') {
  const base = basenameWithoutExtension(value);
  return base
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .join(' ') || 'changes';
}

function gitError(error, fallback = 'Git 操作失败') {
  const message = String(error?.stderr || error?.stdout || error?.message || fallback).trim();
  const wrapped = serviceError(message || fallback, 500);
  wrapped.cause = error;
  return wrapped;
}

function directoryName(filePath = '') {
  const dir = path.posix.dirname(String(filePath || '').replace(/\\/g, '/'));
  return dir === '.' ? '' : dir;
}

function fileName(filePath = '') {
  return path.posix.basename(String(filePath || '').replace(/\\/g, '/')) || filePath || 'file';
}

function statusKind(value = '') {
  const status = String(value || '').trim();
  if (!status || status === '?') {
    return 'modified';
  }
  if (status.includes('U') || status === 'AA' || status === 'DD' || status === 'AU' || status === 'UD' || status === 'DU') {
    return 'conflicted';
  }
  if (status.includes('R')) {
    return 'renamed';
  }
  if (status.includes('D')) {
    return 'deleted';
  }
  if (status.includes('A')) {
    return 'added';
  }
  return 'modified';
}

function normalizeNumstatPath(rawPath = '') {
  const value = String(rawPath || '').trim().replace(/\\/g, '/');
  if (!value.includes(' => ')) {
    return value;
  }
  const braced = value.match(/^(.*)\{(.+)\s+=>\s+(.+)\}(.*)$/);
  if (braced) {
    return `${braced[1]}${braced[3]}${braced[4]}`.replace(/\/+/g, '/');
  }
  return value.split(' => ').pop().trim();
}

function parseNumstat(output = '') {
  const stats = new Map();
  for (const line of String(output || '').split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const parts = line.split('\t');
    if (parts.length < 3) {
      continue;
    }
    const added = parts[0] === '-' ? 0 : Number(parts[0]) || 0;
    const removed = parts[1] === '-' ? 0 : Number(parts[1]) || 0;
    const filePath = normalizeNumstatPath(parts.slice(2).join('\t'));
    stats.set(filePath, { added, removed });
  }
  return stats;
}

function toGitFileStatus(file, { staged, statusCode, stats }) {
  const relativePath = String(file.path || '').replace(/\\/g, '/');
  const lineStats = stats.get(relativePath) || { added: 0, removed: 0 };
  return {
    fileName: fileName(relativePath),
    filePath: directoryName(relativePath),
    fullPath: relativePath,
    originalPath: file.originalPath,
    rawStatus: file.raw,
    status: statusKind(statusCode),
    linesAdded: lineStats.added,
    linesRemoved: lineStats.removed,
    isStaged: Boolean(staged)
  };
}

async function untrackedPatch(cwd, relativePath) {
  const normalizedPath = String(relativePath || '').replace(/\\/g, '/');
  const absolutePath = path.resolve(cwd, normalizedPath);
  const relative = path.relative(cwd, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw serviceError('Invalid file path', 400);
  }
  const stat = await fs.stat(absolutePath);
  if (!stat.isFile()) {
    return '';
  }
  if (stat.size > MAX_DIFF_CHARS) {
    return `diff --git a/${normalizedPath} b/${normalizedPath}\nnew file mode 100644\n--- /dev/null\n+++ b/${normalizedPath}\n@@ -0,0 +1 @@\n+[new file too large to preview: ${stat.size} bytes]`;
  }
  const content = await fs.readFile(absolutePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const body = lines.map((line) => `+${line}`).join('\n');
  return [
    `diff --git a/${normalizedPath} b/${normalizedPath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${normalizedPath}`,
    `@@ -0,0 +1,${Math.max(1, lines.length)} @@`,
    body
  ].join('\n');
}

async function runGit(cwd, args, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: MAX_GIT_OUTPUT,
      env: process.env
    });
    return {
      stdout: String(result.stdout || ''),
      stderr: String(result.stderr || '')
    };
  } catch (error) {
    throw gitError(error);
  }
}

export function parseGitStatusShort(output = '') {
  const lines = String(output || '').split(/\r?\n/).filter(Boolean);
  const first = lines[0] || '';
  const branchMatch = first.match(/^##\s+([^.\s]+|\S+?)(?:\.\.\.(\S+))?(?:\s+\[(.+)\])?$/);
  const meta = branchMatch?.[3] || '';
  const ahead = Number(meta.match(/ahead\s+(\d+)/)?.[1] || 0);
  const behind = Number(meta.match(/behind\s+(\d+)/)?.[1] || 0);
  const files = lines
    .filter((line) => !line.startsWith('## '))
    .map((line) => {
      const rawStatus = line.slice(0, 2);
      const rawPath = line.slice(3).trim();
      const renamedPath = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop().trim() : rawPath;
      const status = rawStatus === '??' ? '??' : rawStatus.replace(/\s/g, '') || rawStatus.trim();
      return {
        raw: line,
        status,
        path: renamedPath,
        originalPath: rawPath.includes(' -> ') ? rawPath.split(' -> ')[0].trim() : null
      };
    });

  return {
    branch: branchMatch?.[1] || null,
    upstream: branchMatch?.[2] || null,
    ahead,
    behind,
    clean: files.length === 0,
    files,
    canCommit: files.length > 0,
    canPush: Boolean(branchMatch?.[1]) && (ahead > 0 || Boolean(branchMatch?.[2]))
  };
}

export function normalizeBranchName(value = '', prefix = 'codex/') {
  const normalizedPrefix = String(prefix || 'codex/').replace(/^\/+|\/+$/g, '') || 'codex';
  const raw = String(value || '')
    .trim()
    .replace(/^codex\//i, '')
    .replace(/\.\.+/g, ' ')
    .replace(/[^\w/.-]+/g, '-')
    .replace(/\/+/g, '/')
    .replace(/-+/g, '-')
    .replace(/^[./\-_]+|[./\-_]+$/g, '')
    .toLowerCase();
  const leaf = raw || 'git';
  return `${normalizedPrefix}/${leaf}`.replace(/\/+/g, '/');
}

export function defaultCommitMessage(status = {}) {
  const files = Array.isArray(status.files) ? status.files : [];
  if (!files.length) {
    return '更新项目';
  }
  const names = files.slice(0, 2).map((file) => titleWord(file.path));
  if (files.length === 1) {
    return `更新 ${names[0]}`;
  }
  if (files.length === 2) {
    return `更新 ${names[0]} 和 ${names[1]}`;
  }
  return `更新 ${names[0]} 等 ${files.length} 个文件`;
}

function sanitizeCommitMessage(value = '') {
  const message = String(value || '').replace(/\s+/g, ' ').trim();
  if (!message) {
    throw serviceError('提交信息不能为空', 400);
  }
  return message.slice(0, 200);
}

export function truncateGitOutput(value = '', maxChars = MAX_DIFF_CHARS) {
  const text = String(value || '');
  const limit = Math.max(1000, Number(maxChars) || MAX_DIFF_CHARS);
  if (text.length <= limit) {
    return {
      text,
      truncated: false,
      originalLength: text.length
    };
  }
  return {
    text: `${text.slice(0, limit)}\n\n[diff truncated: ${text.length - limit} characters hidden]`,
    truncated: true,
    originalLength: text.length
  };
}

export function createGitService({ getProject, runner = runGit } = {}) {
  if (typeof getProject !== 'function') {
    throw new Error('createGitService requires getProject');
  }

  async function projectCwd(projectId) {
    const project = getProject(projectId);
    if (!project?.path) {
      throw serviceError('Project not found', 404);
    }
    await runner(project.path, ['rev-parse', '--show-toplevel']);
    return project.path;
  }

  async function status(projectId) {
    const cwd = await projectCwd(projectId);
    const result = await runner(cwd, ['status', '--short', '--branch']);
    const parsed = parseGitStatusShort(result.stdout);
    return {
      ...parsed,
      defaultCommitMessage: defaultCommitMessage(parsed)
    };
  }

  async function createBranch(projectId, branchName) {
    const cwd = await projectCwd(projectId);
    const name = normalizeBranchName(branchName);
    await runner(cwd, ['switch', '-c', name]);
    return {
      branch: name,
      status: await status(projectId)
    };
  }

  async function diff(projectId) {
    const cwd = await projectCwd(projectId);
    const [summary, patch] = await Promise.all([
      runner(cwd, ['diff', 'HEAD', '--stat']),
      runner(cwd, ['diff', 'HEAD', '--'])
    ]);
    const truncated = truncateGitOutput(patch.stdout);
    return {
      summary: summary.stdout.trim(),
      patch: truncated.text,
      truncated: truncated.truncated,
      originalLength: truncated.originalLength,
      status: await status(projectId)
    };
  }

  async function statusFiles(projectId) {
    const cwd = await projectCwd(projectId);
    const [statusResult, stagedResult, unstagedResult] = await Promise.all([
      runner(cwd, ['status', '--short', '--branch']),
      runner(cwd, ['diff', '--cached', '--numstat']),
      runner(cwd, ['diff', '--numstat'])
    ]);
    const parsed = parseGitStatusShort(statusResult.stdout);
    const stagedStats = parseNumstat(stagedResult.stdout);
    const unstagedStats = parseNumstat(unstagedResult.stdout);
    const stagedFiles = [];
    const unstagedFiles = [];

    for (const file of parsed.files) {
      const raw = String(file.raw || '');
      const indexStatus = raw.slice(0, 1);
      const worktreeStatus = raw.slice(1, 2);
      if (raw.startsWith('??')) {
        unstagedFiles.push(toGitFileStatus(file, {
          staged: false,
          statusCode: '??',
          stats: unstagedStats
        }));
        continue;
      }
      if (indexStatus && indexStatus !== ' ') {
        stagedFiles.push(toGitFileStatus(file, {
          staged: true,
          statusCode: indexStatus,
          stats: stagedStats
        }));
      }
      if (worktreeStatus && worktreeStatus !== ' ') {
        unstagedFiles.push(toGitFileStatus(file, {
          staged: false,
          statusCode: worktreeStatus,
          stats: unstagedStats
        }));
      }
    }

    return {
      branch: parsed.branch,
      upstream: parsed.upstream,
      ahead: parsed.ahead,
      behind: parsed.behind,
      clean: parsed.clean,
      stagedFiles,
      unstagedFiles,
      totalStaged: stagedFiles.length,
      totalUnstaged: unstagedFiles.length
    };
  }

  async function diffFile(projectId, filePath, { staged = false } = {}) {
    const cwd = await projectCwd(projectId);
    const relativePath = String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
    if (!relativePath) {
      throw serviceError('File path is required', 400);
    }
    if (!staged) {
      const untracked = await runner(cwd, ['ls-files', '--others', '--exclude-standard', '--', relativePath]);
      if (untracked.stdout.split(/\r?\n/).some((line) => line.trim() === relativePath)) {
        const patch = await untrackedPatch(cwd, relativePath);
        const truncated = truncateGitOutput(patch);
        return {
          path: relativePath,
          staged: false,
          patch: truncated.text,
          truncated: truncated.truncated,
          originalLength: truncated.originalLength
        };
      }
    }
    const args = staged
      ? ['diff', '--cached', '--no-ext-diff', '--', relativePath]
      : ['diff', '--no-ext-diff', '--', relativePath];
    const result = await runner(cwd, args);
    const truncated = truncateGitOutput(result.stdout);
    return {
      path: relativePath,
      staged: Boolean(staged),
      patch: truncated.text,
      truncated: truncated.truncated,
      originalLength: truncated.originalLength
    };
  }

  async function commit(projectId, message) {
    const cwd = await projectCwd(projectId);
    const before = await status(projectId);
    if (before.clean) {
      throw serviceError('没有可提交的改动', 409);
    }
    const commitMessage = sanitizeCommitMessage(message || before.defaultCommitMessage);
    await runner(cwd, ['add', '-A']);
    const result = await runner(cwd, ['commit', '-m', commitMessage], { timeoutMs: 60_000 });
    const hash = (await runner(cwd, ['rev-parse', '--short', 'HEAD'])).stdout.trim();
    return {
      message: commitMessage,
      hash,
      output: result.stdout.trim() || result.stderr.trim(),
      status: await status(projectId)
    };
  }

  async function push(projectId, { remote = 'origin', branch = null } = {}) {
    const cwd = await projectCwd(projectId);
    const current = await status(projectId);
    const targetBranch = String(branch || current.branch || '').trim();
    if (!targetBranch) {
      throw serviceError('当前不在有效分支上', 409);
    }
    const args = current.upstream
      ? ['push', remote]
      : ['push', '-u', remote, targetBranch];
    const result = await runner(cwd, args, { timeoutMs: 120_000 });
    return {
      remote,
      branch: targetBranch,
      output: result.stdout.trim() || result.stderr.trim(),
      status: await status(projectId)
    };
  }

  async function pull(projectId, { remote = null, branch = null } = {}) {
    const cwd = await projectCwd(projectId);
    const args = ['pull', '--ff-only'];
    if (remote && branch) {
      args.push(String(remote), String(branch));
    }
    const result = await runner(cwd, args, { timeoutMs: 120_000 });
    return {
      output: result.stdout.trim() || result.stderr.trim(),
      status: await status(projectId)
    };
  }

  async function sync(projectId) {
    const pulled = await pull(projectId);
    const afterPull = pulled.status;
    let pushed = null;
    if (afterPull.ahead > 0) {
      pushed = await push(projectId);
    }
    return {
      pulled,
      pushed,
      output: [pulled.output, pushed?.output].filter(Boolean).join('\n\n'),
      status: pushed?.status || afterPull
    };
  }

  async function commitPush(projectId, message) {
    const committed = await commit(projectId, message);
    const pushed = await push(projectId);
    return {
      committed,
      pushed,
      message: committed.message,
      hash: committed.hash,
      output: [committed.output, pushed.output].filter(Boolean).join('\n\n'),
      status: pushed.status
    };
  }

  return { status, statusFiles, createBranch, diff, diffFile, commit, push, pull, sync, commitPush };
}
