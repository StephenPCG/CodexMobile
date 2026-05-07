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

  return { status, createBranch, diff, commit, push, pull, sync, commitPush };
}
