import path from 'node:path';

export function fileChangesFromItem(item, options = {}) {
  return normalizeFileChanges(item?.changes, options);
}

export function normalizeFileChanges(changes, { cwd = '' } = {}) {
  if (!changes) {
    return [];
  }

  if (Array.isArray(changes)) {
    return changes.map((change) => normalizeFileChange(change, { cwd })).filter(Boolean);
  }

  if (typeof changes === 'object') {
    return Object.entries(changes)
      .map(([filePath, change]) => normalizeFileChange({ path: filePath, ...change }, { cwd }))
      .filter(Boolean);
  }

  return [];
}

export function mergeFileChanges(existing = [], incoming = []) {
  const merged = new Map();
  for (const change of [...existing, ...incoming]) {
    const normalized = normalizeFileChange(change);
    if (!normalized) {
      continue;
    }
    const key = `${normalized.path}\n${normalized.kind}`;
    merged.set(key, {
      ...merged.get(key),
      ...normalized
    });
  }
  return [...merged.values()];
}

function normalizeFileChange(change, { cwd = '' } = {}) {
  if (!change || typeof change !== 'object') {
    return null;
  }
  const rawPath = change.path || change.file || change.name;
  if (!rawPath) {
    return null;
  }

  const unifiedDiff = change.unifiedDiff || change.unified_diff || change.diff || '';
  const stats = diffStats(unifiedDiff);
  return {
    path: normalizeDisplayPath(rawPath, cwd),
    oldPath: change.oldPath || change.old_path ? normalizeDisplayPath(change.oldPath || change.old_path, cwd) : null,
    movePath: change.movePath || change.move_path ? normalizeDisplayPath(change.movePath || change.move_path, cwd) : null,
    kind: change.kind || change.type || 'modified',
    additions: Number.isFinite(Number(change.additions)) ? Number(change.additions) : stats.additions,
    deletions: Number.isFinite(Number(change.deletions)) ? Number(change.deletions) : stats.deletions,
    unifiedDiff
  };
}

function normalizeDisplayPath(filePath, cwd) {
  const value = String(filePath || '').trim();
  if (!value) {
    return '';
  }
  if (cwd && path.isAbsolute(value)) {
    const relative = path.relative(cwd, value);
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      return relative.split(path.sep).join('/');
    }
  }
  return value.split(path.sep).join('/');
}

function diffStats(diff) {
  let additions = 0;
  let deletions = 0;
  for (const line of String(diff || '').split(/\r?\n/)) {
    if (line.startsWith('+++') || line.startsWith('---')) {
      continue;
    }
    if (line.startsWith('+')) {
      additions += 1;
    } else if (line.startsWith('-')) {
      deletions += 1;
    }
  }
  return { additions, deletions };
}
