import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
const MAX_FILE_BYTES = Math.max(64 * 1024, Number(process.env.CODEXMOBILE_MAX_FILE_BYTES) || DEFAULT_MAX_FILE_BYTES);
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', '.codexmobile', '.cache', '.next', 'coverage']);

function serviceError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function normalizeRelativePath(value = '') {
  const raw = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!raw) {
    return '';
  }
  const normalized = path.posix.normalize(raw);
  if (normalized === '.' || normalized === '/') {
    return '';
  }
  if (normalized === '..' || normalized.startsWith('../')) {
    throw serviceError('Invalid path', 400);
  }
  return normalized;
}

function relativeSlash(root, absolutePath) {
  return path.relative(root, absolutePath).replace(/\\/g, '/');
}

function resolveProjectPath(project, value = '') {
  const root = path.resolve(project?.path || '');
  if (!root || root === path.parse(root).root && !project?.path) {
    throw serviceError('Project path is unavailable', 404);
  }
  const relativePath = normalizeRelativePath(value);
  const absolutePath = path.resolve(root, relativePath);
  const relative = path.relative(root, absolutePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw serviceError('Path escapes project root', 403);
  }
  return { root, relativePath, absolutePath };
}

function isIgnoredEntry(name) {
  return IGNORED_DIRS.has(name);
}

function isLikelyBinary(buffer) {
  if (!buffer.length) {
    return false;
  }
  if (buffer.includes(0)) {
    return true;
  }
  let control = 0;
  for (const byte of buffer) {
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) {
      control += 1;
    }
  }
  return control / buffer.length > 0.1;
}

function sortEntries(left, right) {
  if (left.type !== right.type) {
    return left.type === 'directory' ? -1 : 1;
  }
  return left.name.localeCompare(right.name, 'zh-CN', { sensitivity: 'base' });
}

export function createWorkspaceService({ getProject, getTarget } = {}) {
  if (typeof getProject !== 'function') {
    throw new Error('createWorkspaceService requires getProject');
  }

  function requireTarget(projectId, options = {}) {
    const project = typeof getTarget === 'function'
      ? getTarget(projectId, options)
      : getProject(projectId);
    if (!project?.path) {
      throw serviceError('Project not found', 404);
    }
    return project;
  }

  async function listDirectory(projectId, requestedPath = '', options = {}) {
    const project = requireTarget(projectId, options);
    const { root, relativePath, absolutePath } = resolveProjectPath(project, requestedPath);
    const stat = await fs.stat(absolutePath);
    if (!stat.isDirectory()) {
      throw serviceError('Path is not a directory', 400);
    }

    const dirents = await fs.readdir(absolutePath, { withFileTypes: true });
    const entries = [];
    for (const dirent of dirents) {
      if (dirent.isDirectory() && isIgnoredEntry(dirent.name)) {
        continue;
      }
      if (!dirent.isDirectory() && !dirent.isFile() && !dirent.isSymbolicLink()) {
        continue;
      }
      const fullPath = path.join(absolutePath, dirent.name);
      let entryStat = null;
      try {
        entryStat = await fs.stat(fullPath);
      } catch {
        continue;
      }
      if (!entryStat.isDirectory() && !entryStat.isFile()) {
        continue;
      }
      entries.push({
        name: dirent.name,
        path: relativeSlash(root, fullPath),
        type: entryStat.isDirectory() ? 'directory' : 'file',
        size: entryStat.isFile() ? entryStat.size : null,
        mtime: entryStat.mtime.toISOString()
      });
    }

    return {
      path: relativePath,
      root: project.path,
      entries: entries.sort(sortEntries)
    };
  }

  async function readFile(projectId, requestedPath = '', options = {}) {
    const project = requireTarget(projectId, options);
    const { relativePath, absolutePath } = resolveProjectPath(project, requestedPath);
    if (!relativePath) {
      throw serviceError('File path is required', 400);
    }
    const stat = await fs.stat(absolutePath);
    if (!stat.isFile()) {
      throw serviceError('Path is not a file', 400);
    }
    const handle = await fs.open(absolutePath, 'r');
    try {
      const length = Math.min(stat.size, MAX_FILE_BYTES + 1);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, 0);
      const chunk = buffer.subarray(0, bytesRead);
      const binary = isLikelyBinary(chunk);
      const truncated = stat.size > MAX_FILE_BYTES;
      return {
        path: relativePath,
        name: path.basename(relativePath),
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        binary,
        truncated,
        maxBytes: MAX_FILE_BYTES,
        content: binary ? '' : chunk.subarray(0, Math.min(chunk.length, MAX_FILE_BYTES)).toString('utf8')
      };
    } finally {
      await handle.close();
    }
  }

  return { listDirectory, readFile };
}
