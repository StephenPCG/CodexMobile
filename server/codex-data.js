import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { imageMarkdownFromCodexImageGeneration } from './codex-native-images.js';
import { statusLabel } from './codex-runner.js';
import { promisify } from 'node:util';
import { archiveDesktopThread, listDesktopThreads, readDesktopThread, setDesktopThreadName } from './codex-app-server.js';
import {
  CODEX_HOME,
  CODEX_SESSIONS_DIR,
  CODEX_SESSION_INDEX,
  CODEX_STATE_DB,
  readCodexConfig,
  readCodexWorkspaceState
} from './codex-config.js';
import {
  readMobileSessionIndex,
  renameMobileSession
} from './mobile-session-index.js';
import { fileChangesFromItem, mergeFileChanges } from './file-changes.js';

const execFileAsync = promisify(execFile);
const DELETED_MESSAGES_PATH = path.join(process.cwd(), '.codexmobile', 'state', 'deleted-messages.json');
const HIDDEN_SESSIONS_PATH = path.join(process.cwd(), '.codexmobile', 'state', 'hidden-sessions.json');
const DESKTOP_IMAGE_ROOT = path.join(process.cwd(), '.codexmobile', 'desktop-images');
const PROJECTLESS_PROJECT_ID = '__codexmobile_projectless__';
const PROJECTLESS_PROJECT_NAME = '普通对话';
const INCLUDE_MISSING_SUBAGENT_THREADS = process.env.CODEXMOBILE_INCLUDE_MISSING_SUBAGENT_THREADS === '1';
const ENABLE_DESKTOP_THREAD_SYNC = process.env.CODEXMOBILE_DESKTOP_THREAD_SYNC === '1';
const INCLUDE_LOCAL_SESSION_LOGS = process.env.CODEXMOBILE_INCLUDE_LOCAL_SESSION_LOGS === '1';
const SHOW_PROJECTLESS_SESSIONS = process.env.CODEXMOBILE_SHOW_PROJECTLESS_SESSIONS === '1';
const DESKTOP_THREAD_LIST_FAILURE_CACHE_MS = Math.max(
  5000,
  Number(process.env.CODEXMOBILE_DESKTOP_THREAD_LIST_FAILURE_CACHE_MS) || 60_000
);
const LOCAL_SESSION_CACHE_MS = Math.max(
  1000,
  Number(process.env.CODEXMOBILE_LOCAL_SESSION_CACHE_MS) || 10_000
);
const LOCAL_SESSION_SCAN_LIMIT = Math.max(
  100,
  Number(process.env.CODEXMOBILE_LOCAL_SESSION_SCAN_LIMIT) || 2500
);
const STALE_RUNNING_TURN_MS = Math.max(
  60_000,
  Number(process.env.CODEXMOBILE_STALE_RUNNING_TURN_MS) || 2 * 60 * 60 * 1000
);
const ROLLOUT_CONTEXT_READ_BYTES = Math.max(
  64 * 1024,
  Number(process.env.CODEXMOBILE_ROLLOUT_CONTEXT_READ_BYTES) || 1024 * 1024
);
let desktopThreadListFailure = null;
let localThreadsCache = {
  expiresAt: 0,
  threads: []
};
let cache = {
  syncedAt: null,
  config: null,
  projects: [],
  projectById: new Map(),
  sessionsByProject: new Map(),
  sessionById: new Map()
};

function emptyDeletedMessagesState() {
  return { version: 1, sessions: {} };
}

function emptyHiddenSessionsState() {
  return { version: 1, sessions: {} };
}

async function readDeletedMessagesState() {
  try {
    const raw = await fs.readFile(DELETED_MESSAGES_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      sessions: parsed && typeof parsed.sessions === 'object' && !Array.isArray(parsed.sessions)
        ? parsed.sessions
        : {}
    };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[sessions] Failed to read deleted message state:', error.message);
    }
    return emptyDeletedMessagesState();
  }
}

async function writeDeletedMessagesState(state) {
  await fs.mkdir(path.dirname(DELETED_MESSAGES_PATH), { recursive: true });
  await fs.writeFile(
    DELETED_MESSAGES_PATH,
    JSON.stringify({ version: 1, sessions: state.sessions || {} }, null, 2),
    'utf8'
  );
}

async function readHiddenSessionsState() {
  try {
    const raw = await fs.readFile(HIDDEN_SESSIONS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      version: 1,
      sessions: parsed && typeof parsed.sessions === 'object' && !Array.isArray(parsed.sessions)
        ? parsed.sessions
        : {}
    };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[sessions] Failed to read hidden session state:', error.message);
    }
    return emptyHiddenSessionsState();
  }
}

async function writeHiddenSessionsState(state) {
  await fs.mkdir(path.dirname(HIDDEN_SESSIONS_PATH), { recursive: true });
  await fs.writeFile(
    HIDDEN_SESSIONS_PATH,
    JSON.stringify({ version: 1, sessions: state.sessions || {} }, null, 2),
    'utf8'
  );
}

async function readHiddenSessionIds() {
  const state = await readHiddenSessionsState();
  return new Set(Object.keys(state.sessions || {}));
}

async function hideSessionInMobile(session) {
  const id = String(session?.id || '').trim();
  if (!id) {
    const error = new Error('Session id is required');
    error.statusCode = 400;
    throw error;
  }

  const state = await readHiddenSessionsState();
  const existing = state.sessions[id];
  state.sessions[id] = {
    hiddenAt: existing?.hiddenAt || new Date().toISOString(),
    projectId: session.projectId || existing?.projectId || null,
    projectPath: session.cwd || existing?.projectPath || null,
    title: session.title || existing?.title || null
  };
  await writeHiddenSessionsState(state);
  return { sessionId: id, hiddenAt: state.sessions[id].hiddenAt };
}

async function readDeletedMessageIds(sessionId) {
  const id = String(sessionId || '').trim();
  if (!id) {
    return new Set();
  }
  const state = await readDeletedMessagesState();
  return new Set(Object.keys(state.sessions?.[id] || {}));
}

function filterDeletedMessages(messages, deletedIds) {
  if (!deletedIds.size) {
    return messages;
  }
  return messages.filter((message) => !deletedIds.has(String(message.id || '')));
}

export function normalizeComparablePath(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }
  const normalized = path.resolve(value);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isSameOrChildPath(childPath, parentPath) {
  const child = normalizeComparablePath(childPath);
  const parent = normalizeComparablePath(parentPath);
  if (!child || !parent) {
    return false;
  }
  if (child === parent) {
    return true;
  }
  const parentWithSep = parent.endsWith(path.sep) ? parent : `${parent}${path.sep}`;
  return child.startsWith(parentWithSep);
}

function visibleRootForPath(projectPath, visibleProjects) {
  return visibleProjects.find((project) => isSameOrChildPath(projectPath, project.path)) || null;
}

function isInternalCodexProjectPath(projectPath) {
  return isSameOrChildPath(projectPath, path.join(CODEX_HOME, 'memories'));
}

async function gitCommonDir(projectPath) {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
      cwd: projectPath,
      timeout: 8000,
      maxBuffer: 256 * 1024,
      windowsHide: true
    });
    return normalizeComparablePath(String(stdout || '').trim());
  } catch {
    return '';
  }
}

async function cachedGitCommonDir(projectPath, cacheMap) {
  const key = normalizeComparablePath(projectPath);
  if (!key) {
    return '';
  }
  if (!cacheMap.has(key)) {
    cacheMap.set(key, await gitCommonDir(projectPath));
  }
  return cacheMap.get(key);
}

function visibleProjectNameMatch(projectPath, projectById, visibleProjects) {
  const parts = path.normalize(projectPath).split(path.sep).filter(Boolean);
  const worktreesIndex = parts.lastIndexOf('worktrees');
  if (worktreesIndex < 0) {
    return null;
  }
  const tail = parts.slice(worktreesIndex + 1);
  const candidates = visibleProjects
    .map((project) => ({
      project,
      name: path.basename(project.path)
    }))
    .filter((entry) => entry.name && !isSameOrChildPath(entry.project.path, path.join(CODEX_HOME, 'worktrees')))
    .sort((a, b) => b.name.length - a.name.length);

  for (const { project, name } of candidates) {
    if (tail.includes(name) || tail.some((segment) => segment.startsWith(`${name}-`))) {
      return projectById.get(projectIdFor(project.path)) || null;
    }
  }
  return null;
}

async function projectForSessionPath(projectPath, { projectById, visibleProjects, gitProjectByCommonDir, gitCommonDirCache }) {
  const exactProject = projectById.get(projectIdFor(projectPath));
  if (exactProject) {
    return exactProject;
  }
  if (isInternalCodexProjectPath(projectPath)) {
    return null;
  }

  const commonDir = await cachedGitCommonDir(projectPath, gitCommonDirCache);
  if (commonDir && gitProjectByCommonDir.has(commonDir)) {
    return gitProjectByCommonDir.get(commonDir);
  }

  const nameMatchedProject = visibleProjectNameMatch(projectPath, projectById, visibleProjects);
  if (nameMatchedProject) {
    return nameMatchedProject;
  }

  const visibleRoot = visibleRootForPath(projectPath, visibleProjects);
  if (!visibleRoot) {
    return null;
  }
  return upsertProject(projectById, projectPath, visibleRoot.trustLevel, null);
}

function projectIdFor(projectPath) {
  return crypto.createHash('sha1').update(normalizeComparablePath(projectPath)).digest('hex').slice(0, 16);
}

function documentsCodexRoot() {
  return path.join(os.homedir(), 'Documents', 'Codex');
}

function pathSegmentsUnder(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return [];
  }
  return relative.split(path.sep).filter(Boolean);
}

function isDocumentsCodexConversationPath(projectPath) {
  const segments = pathSegmentsUnder(documentsCodexRoot(), projectPath);
  return segments.length >= 2 && /^\d{4}-\d{2}-\d{2}$/.test(segments[0]);
}

function displayNameFor(projectPath) {
  const parsed = path.parse(projectPath);
  return path.basename(projectPath) || parsed.root || projectPath;
}

function toPublicProject(entry) {
  return {
    id: entry.id,
    name: entry.name,
    path: entry.path,
    pathLabel: entry.pathLabel || null,
    projectless: Boolean(entry.projectless),
    trusted: entry.trusted,
    updatedAt: entry.updatedAt,
    sessionCount: entry.sessionCount || 0
  };
}

const INTERNAL_PROMPT_MARKERS = [
  'CodexMobile iOS/PWA 回复要求：',
  'CodexMobile 已接入飞书官方 lark-cli。',
  'CodexMobile 已接入飞书官方 lark-cli'
];

function sanitizeVisibleUserMessage(message) {
  const value = String(message || '').trim();
  if (!value) {
    return '';
  }
  let cutAt = value.length;
  for (const marker of INTERNAL_PROMPT_MARKERS) {
    const index = value.indexOf(marker);
    if (index > 0) {
      cutAt = Math.min(cutAt, index);
    }
  }
  return value.slice(0, cutAt).trim() || value;
}

function isArchivedOrDeletedDesktopThread(thread = null) {
  if (!thread || typeof thread !== 'object') {
    return true;
  }
  const status = String(thread.status || '').toLowerCase();
  const archivedAt = String(thread.archivedAt || thread.deletedAt || thread.archiveAt || thread.archived_at || thread.deleted_at || '').trim();
  const deletedAt = String(thread.deletedAt || thread.deleted_at || '').trim();
  const flaggedDeleted = Boolean(thread.deleted) || Boolean(thread.isDeleted) || status === 'deleted' || status === 'archived';
  const flaggedArchived = Boolean(thread.archived) || Boolean(thread.isArchived) || status === 'archived';
  return flaggedDeleted || flaggedArchived || Boolean(archivedAt) || Boolean(deletedAt);
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function publicContextState(state = {}, configContext = {}) {
  const contextWindow = state.contextWindow || configContext.modelContextWindow || null;
  const inputTokens = state.inputTokens || null;
  const autoCompactLimit = configContext.autoCompactTokenLimit || null;
  const percent =
    inputTokens && contextWindow
      ? Math.max(0, Math.min(100, Math.round((inputTokens / contextWindow) * 1000) / 10))
      : null;
  const compactDetected = Boolean(state.autoCompactDetected);
  return {
    sessionId: state.sessionId || null,
    model: state.model || null,
    inputTokens,
    totalTokens: state.totalTokens || null,
    contextWindow,
    percent,
    lastTokenUsage: state.lastTokenUsage || null,
    totalTokenUsage: state.totalTokenUsage || null,
    updatedAt: state.updatedAt || null,
    autoCompact: {
      enabled: Boolean(autoCompactLimit || configContext.autoCompactEnabled),
      tokenLimit: autoCompactLimit,
      detected: compactDetected,
      status: compactDetected ? 'detected' : (autoCompactLimit || configContext.autoCompactEnabled) ? 'watching' : 'unknown',
      lastCompactedAt: state.autoCompactLastAt || null,
      reason: state.autoCompactReason || ''
    }
  };
}

function tokenUsageFromPayload(payload) {
  const info = payload?.info && typeof payload.info === 'object' ? payload.info : {};
  const last = info.last_token_usage && typeof info.last_token_usage === 'object' ? info.last_token_usage : {};
  const total = info.total_token_usage && typeof info.total_token_usage === 'object' ? info.total_token_usage : {};
  return {
    inputTokens: positiveNumber(last.input_tokens ?? total.input_tokens),
    totalTokens: positiveNumber(total.total_tokens ?? last.total_tokens),
    contextWindow: positiveNumber(info.model_context_window ?? payload?.model_context_window),
    lastTokenUsage: last,
    totalTokenUsage: total
  };
}

function applyContextEntry(state, entry, sessionId) {
  const payload = entry?.payload || {};
  const timestamp = entry?.timestamp || new Date().toISOString();
  const type = payload.type || '';

  if (entry.type === 'turn_context') {
    const summary = String(payload.summary || '').trim();
    if (summary && summary !== 'none') {
      state.autoCompactDetected = true;
      state.autoCompactLastAt = timestamp;
      state.autoCompactReason = '会话已带摘要继续';
    }
    if (payload.model) {
      state.model = payload.model;
    }
    state.updatedAt = timestamp;
    return;
  }

  if (entry.type === 'compacted') {
    state.autoCompactDetected = true;
    state.autoCompactLastAt = timestamp;
    state.autoCompactReason = '上下文已自动压缩';
    state.updatedAt = timestamp;
    return;
  }

  if (entry.type !== 'event_msg') {
    return;
  }

  if (type === 'task_started') {
    state.contextWindow = positiveNumber(payload.model_context_window) || state.contextWindow || null;
    state.updatedAt = timestamp;
    return;
  }

  if (type !== 'token_count') {
    return;
  }

  const usage = tokenUsageFromPayload(payload);
  const previousInputTokens = state.inputTokens;
  state.sessionId = sessionId;
  state.inputTokens = usage.inputTokens || state.inputTokens || null;
  state.totalTokens = usage.totalTokens || state.totalTokens || null;
  state.contextWindow = usage.contextWindow || state.contextWindow || null;
  state.lastTokenUsage = usage.lastTokenUsage;
  state.totalTokenUsage = usage.totalTokenUsage;
  state.updatedAt = timestamp;

  if (
    previousInputTokens &&
    usage.inputTokens &&
    previousInputTokens > 20000 &&
    usage.inputTokens < previousInputTokens * 0.62
  ) {
    state.autoCompactDetected = true;
    state.autoCompactLastAt = timestamp;
    state.autoCompactReason = '上下文用量回落';
  }
}

async function readRolloutContextState(filePath, sessionId) {
  const state = { sessionId };
  if (!filePath) {
    return state;
  }

  let start = 0;
  try {
    const stats = await fs.stat(filePath);
    if (stats.size > ROLLOUT_CONTEXT_READ_BYTES) {
      start = stats.size - ROLLOUT_CONTEXT_READ_BYTES;
    }
  } catch {
    return state;
  }

  const stream = fsSync.createReadStream(filePath, { encoding: 'utf8', start });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }
      try {
        applyContextEntry(state, JSON.parse(line), sessionId);
      } catch {
        // Skip malformed or partial JSONL rows.
      }
    }
  } catch {
    return state;
  }
  return state;
}

function sourceToString(source) {
  if (typeof source === 'string') {
    return source;
  }
  if (source?.custom) {
    return source.custom;
  }
  if (source?.subAgent) {
    return 'subAgent';
  }
  return 'unknown';
}

function isStaleProjectlessDesktopSession(thread, session) {
  if (session?.projectless && !SHOW_PROJECTLESS_SESSIONS) {
    return true;
  }
  if (sourceToString(thread?.source) !== 'vscode' || !session?.projectless) {
    return false;
  }
  if (session.projectlessRegistered || session.mobileSessionKnown) {
    return false;
  }
  const cwd = String(thread?.cwd || '').trim();
  if (cwd && !pathSegmentsUnder(documentsCodexRoot(), cwd).length) {
    return true;
  }
  if (cwd && fsSync.existsSync(cwd)) {
    return false;
  }
  const updatedAtMs = Number(thread?.updatedAt || 0) * 1000;
  const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
  return !updatedAtMs || Date.now() - updatedAtMs > twoDaysMs;
}

async function readThreadSpawnEdges() {
  try {
    await fs.access(CODEX_STATE_DB);
    const query = `
      select
        parent_thread_id as parentSessionId,
        child_thread_id as childSessionId,
        status
      from thread_spawn_edges
    `;
    const { stdout } = await execFileAsync('sqlite3', ['-json', CODEX_STATE_DB, query], {
      maxBuffer: 1024 * 1024
    });
    const parsed = JSON.parse(stdout || '[]');
    return Array.isArray(parsed)
      ? parsed.filter((edge) => edge?.parentSessionId && edge?.childSessionId)
      : [];
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[sessions] Failed to read subagent thread edges:', error.message);
    }
    return [];
  }
}

function subAgentMetaFromThread(thread, spawnEdge = null) {
  const spawn = thread?.source?.subAgent?.thread_spawn || {};
  const parentSessionId = spawn.parent_thread_id || spawnEdge?.parentSessionId || null;
  if (!parentSessionId && !thread?.source?.subAgent && !spawnEdge) {
    return { parentSessionId: null, subAgent: null };
  }
  return {
    parentSessionId,
    subAgent: {
      nickname: thread?.agentNickname || spawn.agent_nickname || null,
      role: thread?.agentRole || spawn.agent_role || null,
      depth: Number.isFinite(Number(spawn.depth)) ? Number(spawn.depth) : null,
      status: spawnEdge?.status || null
    }
  };
}

async function sessionFromDesktopThread(
  thread,
  mobileSessionIndex,
  projectlessThreadIds,
  projectlessWorkdir,
  visibleProjectIds,
  configContext = {},
  spawnEdge = null,
  projectLookupContext = null
) {
  if (!thread?.id) {
    return null;
  }
  const mobileSession = mobileSessionIndex.get(thread.id);
  const hasDesktopCwd = typeof thread.cwd === 'string' && thread.cwd.trim();
  const projectlessRegistered = projectlessThreadIds.has(thread.id);
  const explicitProjectless = !hasDesktopCwd && (projectlessRegistered || Boolean(mobileSession?.projectless));
  const cwd = thread.cwd || mobileSession?.projectPath || (explicitProjectless ? projectlessWorkdir : '');
  if (!cwd && !explicitProjectless) {
    return null;
  }
  const resolvedCwd = path.resolve(cwd || projectlessWorkdir);
  const project = projectLookupContext && !explicitProjectless
    ? await projectForSessionPath(resolvedCwd, projectLookupContext)
    : null;
  const projectId = project?.id || projectIdFor(resolvedCwd);
  const projectless =
    explicitProjectless ||
    isDocumentsCodexConversationPath(resolvedCwd) ||
    (!project && !visibleProjectIds.has(projectId));
  const preview = sanitizeVisibleUserMessage(thread.preview || mobileSession?.summary || '');
  const mobileTitle = String(mobileSession?.title || '').trim();
  const mobileTitleCandidate = mobileTitle && mobileTitle !== '新对话' ? mobileTitle : '';
  const title = String(thread.name || mobileTitleCandidate || preview.slice(0, 52) || mobileTitle || '新对话').trim();
  const mobileMessages = Array.isArray(mobileSession?.messages) ? mobileSession.messages : [];
  const contextState = await readRolloutContextState(thread.path, thread.id);
  const subAgentMeta = subAgentMetaFromThread(thread, spawnEdge);
  return {
    id: thread.id,
    cwd: resolvedCwd,
    projectId: projectless ? PROJECTLESS_PROJECT_ID : projectId,
    title,
    titleLocked: Boolean(mobileSession?.titleLocked),
    titleAutoGenerated: mobileSession ? (mobileSession.titleLocked ? null : 'stored') : null,
    summary: preview || mobileSession?.summary || title || 'Codex 会话',
    model: mobileSession?.model || null,
    provider: thread.modelProvider || mobileSession?.provider || null,
    messageCount: mobileMessages.length,
    updatedAt: isoFromEpochSeconds(thread.updatedAt) || mobileSession?.updatedAt || null,
    source: sourceToString(thread.source),
    parentSessionId: subAgentMeta.parentSessionId,
    isSubAgent: Boolean(subAgentMeta.parentSessionId || subAgentMeta.subAgent),
    subAgent: subAgentMeta.subAgent,
    projectless,
    projectlessRegistered,
    mobileSessionKnown: Boolean(mobileSession),
    filePath: thread.path || null,
    context: publicContextState(contextState, configContext)
  };
}

function isoFromAnyTimestamp(value) {
  if (!value) {
    return null;
  }
  if (typeof value === 'number') {
    const millis = value > 10_000_000_000 ? value : value * 1000;
    const date = new Date(millis);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const text = String(value || '').trim();
  if (!text) {
    return null;
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function readSessionIndexTitles() {
  const entries = new Map();
  let stream;
  try {
    stream = fsSync.createReadStream(CODEX_SESSION_INDEX, { encoding: 'utf8' });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[sessions] Failed to read local session index:', error.message);
    }
    return entries;
  }

  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }
      try {
        const entry = JSON.parse(line);
        const id = String(entry?.id || '').trim();
        if (!id) {
          continue;
        }
        entries.set(id, {
          title: String(entry.thread_name || entry.title || '').trim(),
          updatedAt: isoFromAnyTimestamp(entry.updated_at || entry.updatedAt)
        });
      } catch {
        // Ignore malformed JSONL rows.
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[sessions] Failed to scan local session index:', error.message);
    }
  }
  return entries;
}

async function listLocalSessionFiles(root = CODEX_SESSIONS_DIR) {
  const files = [];

  async function walk(dir, depth = 0) {
    if (files.length >= LOCAL_SESSION_SCAN_LIMIT || depth > 8) {
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (depth === 0 && error.code !== 'ENOENT') {
        console.warn('[sessions] Failed to scan local sessions:', error.message);
      }
      return;
    }

    for (const entry of entries) {
      if (files.length >= LOCAL_SESSION_SCAN_LIMIT) {
        return;
      }
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath, depth + 1);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(entryPath);
      }
    }
  }

  await walk(root);
  return files;
}

function textFromLocalMessageContent(content = []) {
  return (Array.isArray(content) ? content : [])
    .map((part) => {
      if (!part || typeof part !== 'object') {
        return '';
      }
      if (['input_text', 'output_text', 'text'].includes(part.type)) {
        return part.text || '';
      }
      if (part.type === 'local_image' || part.type === 'localImage' || part.type === 'image') {
        return markdownImageInput(part);
      }
      if (part.type === 'mention' || part.type === 'skill') {
        return part.name || part.path || '';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function isInternalLocalUserContent(content) {
  const value = String(content || '').trim();
  return (
    value.startsWith('<environment_context>') ||
    value.startsWith('<permissions instructions>') ||
    value.startsWith('## Memory') ||
    value.startsWith('<collaboration_mode>') ||
    value.startsWith('<skills_instructions>')
  );
}

async function localThreadFromFile(filePath, sessionIndexTitles = new Map()) {
  const thread = {
    id: '',
    cwd: '',
    path: filePath,
    name: '',
    preview: '',
    messageCount: 0,
    updatedAt: null,
    model: null,
    modelProvider: null,
    source: 'jsonl'
  };
  let fallbackUpdatedAt = null;

  try {
    const stats = await fs.stat(filePath);
    fallbackUpdatedAt = stats.mtime?.toISOString?.() || null;
  } catch {
    // The file can disappear while we scan; parsing will fail below if so.
  }

  try {
    const stream = fsSync.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const timestamp = isoFromAnyTimestamp(entry.timestamp);
      if (timestamp) {
        thread.updatedAt = timestamp;
      }
      const payload = entry?.payload || {};
      if (entry.type === 'session_meta') {
        thread.id = String(payload.id || thread.id || '').trim();
        thread.cwd = String(payload.cwd || thread.cwd || '').trim();
        thread.source = payload.source || thread.source;
        thread.modelProvider = payload.model_provider || payload.modelProvider || thread.modelProvider;
        thread.updatedAt = thread.updatedAt || isoFromAnyTimestamp(payload.timestamp);
        continue;
      }
      if (entry.type === 'turn_context') {
        thread.cwd = String(payload.cwd || thread.cwd || '').trim();
        thread.model = payload.model || thread.model;
        continue;
      }
      if (entry.type !== 'response_item' || payload.type !== 'message') {
        continue;
      }
      if (!['user', 'assistant'].includes(payload.role)) {
        continue;
      }
      if (payload.role === 'assistant' && payload.phase === 'commentary') {
        continue;
      }
      let text = textFromLocalMessageContent(payload.content);
      if (payload.role === 'user') {
        if (isInternalLocalUserContent(text)) {
          continue;
        }
        text = sanitizeVisibleUserMessage(text);
        if (text && !thread.preview) {
          thread.preview = text;
        }
      }
      if (text) {
        thread.messageCount += 1;
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[sessions] Failed to read local session log:', filePath, error.message);
    }
    return null;
  }

  if (!thread.id) {
    return null;
  }
  const indexEntry = sessionIndexTitles.get(thread.id) || {};
  thread.name = String(indexEntry.title || '').trim();
  thread.updatedAt = indexEntry.updatedAt || thread.updatedAt || fallbackUpdatedAt;
  return thread;
}

async function listLocalThreadsFromJsonl(sessionIndexTitles = new Map()) {
  const now = Date.now();
  if (localThreadsCache.expiresAt > now) {
    return localThreadsCache.threads;
  }
  const files = await listLocalSessionFiles();
  const threads = [];
  for (const filePath of files) {
    const thread = await localThreadFromFile(filePath, sessionIndexTitles);
    if (thread) {
      threads.push(thread);
    }
  }
  threads.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
  localThreadsCache = {
    expiresAt: now + LOCAL_SESSION_CACHE_MS,
    threads
  };
  return threads;
}

async function sessionFromLocalThread(
  thread,
  mobileSessionIndex,
  projectlessThreadIds,
  projectlessWorkdir,
  visibleProjectIds,
  configContext = {},
  spawnEdge = null,
  projectLookupContext = null
) {
  if (!thread?.id) {
    return null;
  }
  const mobileSession = mobileSessionIndex.get(thread.id);
  const hasCwd = typeof thread.cwd === 'string' && thread.cwd.trim();
  const projectlessRegistered = projectlessThreadIds.has(thread.id);
  const explicitProjectless = !hasCwd && (projectlessRegistered || Boolean(mobileSession?.projectless));
  const cwd = thread.cwd || mobileSession?.projectPath || (explicitProjectless ? projectlessWorkdir : '');
  if (!cwd && !explicitProjectless) {
    return null;
  }
  const resolvedCwd = path.resolve(cwd || projectlessWorkdir);
  const project = projectLookupContext && !explicitProjectless
    ? await projectForSessionPath(resolvedCwd, projectLookupContext)
    : null;
  const projectId = project?.id || projectIdFor(resolvedCwd);
  const projectless =
    explicitProjectless ||
    isDocumentsCodexConversationPath(resolvedCwd) ||
    (!project && !visibleProjectIds.has(projectId));
  const preview = sanitizeVisibleUserMessage(thread.preview || mobileSession?.summary || '');
  const mobileTitle = String(mobileSession?.title || '').trim();
  const mobileTitleCandidate = mobileTitle && mobileTitle !== '新对话' ? mobileTitle : '';
  const threadTitle = ['新对话', 'Untitled', 'New chat'].includes(String(thread.name || '').trim())
    ? ''
    : String(thread.name || '').trim();
  const title = String(threadTitle || mobileTitleCandidate || preview.slice(0, 52) || mobileTitle || '新对话').trim();
  const contextState = await readRolloutContextState(thread.path, thread.id);
  const subAgentMeta = subAgentMetaFromThread(thread, spawnEdge);
  return {
    id: thread.id,
    cwd: resolvedCwd,
    projectId: projectless ? PROJECTLESS_PROJECT_ID : projectId,
    title,
    titleLocked: Boolean(mobileSession?.titleLocked),
    titleAutoGenerated: mobileSession ? (mobileSession.titleLocked ? null : 'stored') : null,
    summary: preview || mobileSession?.summary || title || 'Codex 会话',
    model: mobileSession?.model || thread.model || null,
    provider: thread.modelProvider || mobileSession?.provider || null,
    messageCount: Number(thread.messageCount) || 0,
    updatedAt: thread.updatedAt || mobileSession?.updatedAt || null,
    source: sourceToString(thread.source),
    parentSessionId: subAgentMeta.parentSessionId,
    isSubAgent: Boolean(subAgentMeta.parentSessionId || subAgentMeta.subAgent),
    subAgent: subAgentMeta.subAgent,
    projectless,
    projectlessRegistered,
    mobileSessionKnown: Boolean(mobileSession),
    filePath: thread.path || null,
    mobileOnly: true,
    localOnly: true,
    context: publicContextState(contextState, configContext)
  };
}

function addSessionToMaps(session, projectById, sessionsByProject, sessionById) {
  const project = projectById.get(session.projectId);
  if (!project) {
    return false;
  }
  if (!sessionsByProject.has(project.id)) {
    sessionsByProject.set(project.id, []);
  }
  sessionsByProject.get(project.id).push(session);
  sessionById.set(session.id, session);
  return true;
}

function projectlessWorkingDirectory(workspaceState) {
  const hints = workspaceState?.threadWorkspaceRootHints || {};
  const projectlessIds = new Set(workspaceState?.projectlessThreadIds || []);
  const counts = new Map();
  for (const [threadId, root] of Object.entries(hints)) {
    if (!projectlessIds.has(threadId) || typeof root !== 'string' || !root.trim()) {
      continue;
    }
    const resolved = path.resolve(root);
    counts.set(resolved, (counts.get(resolved) || 0) + 1);
  }
  const [mostUsedHint] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] || [];
  if (mostUsedHint) {
    return mostUsedHint;
  }
  const documentsCodex = documentsCodexRoot();
  return fsSync.existsSync(documentsCodex) ? documentsCodex : os.homedir();
}

function upsertProjectlessProject(projectMap, workspaceState) {
  const workdir = projectlessWorkingDirectory(workspaceState);
  const existing = projectMap.get(PROJECTLESS_PROJECT_ID);
  if (existing) {
    existing.path = workdir;
    return existing;
  }
  const entry = {
    id: PROJECTLESS_PROJECT_ID,
    name: PROJECTLESS_PROJECT_NAME,
    path: workdir,
    pathLabel: '无项目分类',
    projectless: true,
    trusted: true,
    updatedAt: null,
    sessionCount: 0
  };
  projectMap.set(PROJECTLESS_PROJECT_ID, entry);
  return entry;
}

function upsertProject(projectMap, projectPath, trustLevel = null, label = null) {
  const normalized = normalizeComparablePath(projectPath);
  if (!normalized) {
    return null;
  }
  const id = projectIdFor(projectPath);
  const existing = projectMap.get(id);
  if (existing) {
    if (trustLevel) {
      existing.trusted = trustLevel === 'trusted';
    }
    if (label) {
      existing.name = label;
    }
    return existing;
  }
  const entry = {
    id,
    name: label || displayNameFor(projectPath),
    path: path.resolve(projectPath),
    trusted: trustLevel === 'trusted',
    updatedAt: null,
    sessionCount: 0
  };
  projectMap.set(id, entry);
  return entry;
}

async function listDesktopThreadsForRefresh() {
  if (!ENABLE_DESKTOP_THREAD_SYNC) {
    return { threads: [], error: null, skipped: true };
  }
  const now = Date.now();
  if (desktopThreadListFailure?.retryAt > now) {
    const error = new Error(desktopThreadListFailure.message || 'Desktop thread list unavailable');
    error.cached = true;
    return { threads: [], error };
  }

  try {
    const threads = await listDesktopThreads({ limit: 1000 });
    desktopThreadListFailure = null;
    return { threads, error: null };
  } catch (error) {
    desktopThreadListFailure = {
      retryAt: now + DESKTOP_THREAD_LIST_FAILURE_CACHE_MS,
      message: error.message || 'Desktop thread list unavailable'
    };
    console.warn('[sessions] Desktop thread list unavailable; using local session logs for now:', desktopThreadListFailure.message);
    return { threads: [], error };
  }
}

export async function refreshCodexCache() {
  const config = await readCodexConfig();
  const workspaceState = await readCodexWorkspaceState();
  const mobileSessionIndex = await readMobileSessionIndex();
  const hiddenSessionIds = await readHiddenSessionIds();
  const projectById = new Map();
  const sessionsByProject = new Map();
  const sessionById = new Map();
  const gitCommonDirCache = new Map();
  const gitProjectByCommonDir = new Map();

  const visibleProjects = workspaceState.projects.length
    ? workspaceState.projects.map((project) => ({
      path: project.path,
      trustLevel: config.projects.find(
        (entry) => normalizeComparablePath(entry.path) === normalizeComparablePath(project.path)
      )?.trustLevel || 'trusted',
      label: project.label
    }))
    : config.projects.map((project) => ({ ...project, label: null }));
  const visibleProjectIds = new Set();
  const projectlessThreadIds = new Set(workspaceState.projectlessThreadIds || []);
  const projectlessWorkdir = projectlessWorkingDirectory(workspaceState);
  const hasProjectlessSessions = SHOW_PROJECTLESS_SESSIONS && projectlessThreadIds.size > 0;
  const spawnEdges = INCLUDE_MISSING_SUBAGENT_THREADS ? await readThreadSpawnEdges() : [];
  const spawnEdgeByChildId = new Map(spawnEdges.map((edge) => [edge.childSessionId, edge]));

  for (const project of visibleProjects) {
    const entry = upsertProject(projectById, project.path, project.trustLevel, project.label);
    if (entry) {
      visibleProjectIds.add(entry.id);
    }
    const commonDir = entry ? await cachedGitCommonDir(entry.path, gitCommonDirCache) : '';
    if (commonDir && !gitProjectByCommonDir.has(commonDir)) {
      gitProjectByCommonDir.set(commonDir, entry);
    }
  }
  const projectLookupContext = { projectById, visibleProjects, gitProjectByCommonDir, gitCommonDirCache };
  if (hasProjectlessSessions) {
    upsertProjectlessProject(projectById, workspaceState);
    visibleProjectIds.add(PROJECTLESS_PROJECT_ID);
  }

  const { threads: desktopThreads, error: desktopListError, skipped: desktopListSkipped } = await listDesktopThreadsForRefresh();
  for (const thread of desktopThreads) {
    if (isArchivedOrDeletedDesktopThread(thread)) {
      continue;
    }
    const session = await sessionFromDesktopThread(
      thread,
      mobileSessionIndex,
      projectlessThreadIds,
      projectlessWorkdir,
      visibleProjectIds,
      config.context || {},
      spawnEdgeByChildId.get(thread.id) || null,
      projectLookupContext
    );
    if (isStaleProjectlessDesktopSession(thread, session)) {
      continue;
    }
    if (!session || hiddenSessionIds.has(session.id)) {
      continue;
    }
    if (session.projectless && !SHOW_PROJECTLESS_SESSIONS) {
      continue;
    }
    if (session.projectless) {
      upsertProjectlessProject(projectById, workspaceState);
      visibleProjectIds.add(PROJECTLESS_PROJECT_ID);
    } else if (!visibleProjectIds.has(session.projectId)) {
      continue;
    }
    addSessionToMaps(session, projectById, sessionsByProject, sessionById);
  }

  if (desktopListSkipped || desktopListError || INCLUDE_LOCAL_SESSION_LOGS) {
    const sessionIndexTitles = await readSessionIndexTitles();
    const localThreads = await listLocalThreadsFromJsonl(sessionIndexTitles);
    for (const thread of localThreads) {
      if (sessionById.has(thread.id) || hiddenSessionIds.has(thread.id)) {
        continue;
      }
      const session = await sessionFromLocalThread(
        thread,
        mobileSessionIndex,
        projectlessThreadIds,
        projectlessWorkdir,
        visibleProjectIds,
        config.context || {},
        spawnEdgeByChildId.get(thread.id) || null,
        projectLookupContext
      );
      if (!session || hiddenSessionIds.has(session.id)) {
        continue;
      }
      if (session.projectless && !SHOW_PROJECTLESS_SESSIONS) {
        continue;
      }
      if (session.projectless) {
        upsertProjectlessProject(projectById, workspaceState);
        visibleProjectIds.add(PROJECTLESS_PROJECT_ID);
      } else if (!visibleProjectIds.has(session.projectId)) {
        continue;
      }
      addSessionToMaps(session, projectById, sessionsByProject, sessionById);
    }
  }

  for (const edge of spawnEdges) {
    if (hiddenSessionIds.has(edge.childSessionId)) {
      continue;
    }
    const existing = sessionById.get(edge.childSessionId);
    if (!existing) {
      continue;
    }
    existing.parentSessionId = existing.parentSessionId || edge.parentSessionId;
    existing.isSubAgent = true;
    existing.subAgent = {
      ...(existing.subAgent || {}),
      status: existing.subAgent?.status || edge.status || null
    };
  }

  if (INCLUDE_MISSING_SUBAGENT_THREADS) {
    for (const edge of spawnEdges) {
      if (hiddenSessionIds.has(edge.childSessionId) || sessionById.has(edge.childSessionId)) {
        continue;
      }
      let childThread = null;
      try {
        childThread = (await readDesktopThread(edge.childSessionId, { includeTurns: false }))?.thread || null;
      } catch {
        continue;
      }
      if (isArchivedOrDeletedDesktopThread(childThread)) {
        continue;
      }
      const childSession = await sessionFromDesktopThread(
        childThread,
        mobileSessionIndex,
        projectlessThreadIds,
        projectlessWorkdir,
        visibleProjectIds,
        config.context || {},
        edge,
        projectLookupContext
      );
      if (isStaleProjectlessDesktopSession(childThread, childSession)) {
        continue;
      }
      if (!childSession || hiddenSessionIds.has(childSession.id)) {
        continue;
      }
      if (childSession.projectless && !SHOW_PROJECTLESS_SESSIONS) {
        continue;
      }
      if (childSession.projectless) {
        upsertProjectlessProject(projectById, workspaceState);
        visibleProjectIds.add(PROJECTLESS_PROJECT_ID);
      } else if (!visibleProjectIds.has(childSession.projectId)) {
        continue;
      }
      addSessionToMaps(childSession, projectById, sessionsByProject, sessionById);
    }
  }

  for (const [projectId, sessions] of sessionsByProject.entries()) {
    sessions.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    const project = projectById.get(projectId);
    if (project) {
      const sessionIds = new Set(sessions.map((session) => session.id));
      project.sessionCount = sessions.filter(
        (session) => !session.parentSessionId || !sessionIds.has(session.parentSessionId)
      ).length;
      project.updatedAt = sessions[0]?.updatedAt || project.updatedAt;
    }
  }

  for (const session of sessionById.values()) {
    session.childCount = 0;
    session.openChildCount = 0;
  }
  for (const session of sessionById.values()) {
    if (!session.parentSessionId) {
      continue;
    }
    const parent = sessionById.get(session.parentSessionId);
    if (!parent) {
      continue;
    }
    parent.childCount = (parent.childCount || 0) + 1;
    if (session.subAgent?.status === 'open') {
      parent.openChildCount = (parent.openChildCount || 0) + 1;
    }
  }

  const projectOrder = new Map(visibleProjects.map((project, index) => [projectIdFor(project.path), index]));
  const projects = [...projectById.values()].sort((a, b) => {
    if (a.projectless !== b.projectless) {
      return a.projectless ? -1 : 1;
    }
    const orderA = projectOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const orderB = projectOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    const updatedDelta = new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
    return orderA - orderB || updatedDelta || a.name.localeCompare(b.name, 'zh-Hans-CN');
  });

  cache = {
    syncedAt: new Date().toISOString(),
    config,
    projects,
    projectById,
    sessionsByProject,
    sessionById
  };

  return getCacheSnapshot();
}

export function getCacheSnapshot() {
  return {
    syncedAt: cache.syncedAt,
    config: cache.config,
    projects: cache.projects.map(toPublicProject)
  };
}

export function listProjects() {
  return cache.projects.map(toPublicProject);
}

export function getProject(projectId) {
  return cache.projectById.get(projectId) || null;
}

export function listProjectSessions(projectId) {
  return (cache.sessionsByProject.get(projectId) || []).map((session) => ({
    id: session.id,
    projectId: session.projectId,
    cwd: session.cwd,
    title: session.title,
    summary: session.summary,
    model: session.model,
    provider: session.provider,
    source: session.source,
    parentSessionId: session.parentSessionId || null,
    isSubAgent: Boolean(session.isSubAgent),
    subAgent: session.subAgent || null,
    childCount: session.childCount || 0,
    openChildCount: session.openChildCount || 0,
    messageCount: session.messageCount,
    updatedAt: session.updatedAt,
    context: session.context || null
  }));
}

export function getSession(sessionId) {
  return cache.sessionById.get(sessionId) || null;
}

export async function renameSession(sessionId, projectId, title, { auto = false } = {}) {
  const session = getSession(sessionId);
  if (!session) {
    const error = new Error('Session not found');
    error.statusCode = 404;
    throw error;
  }
  if (projectId && session.projectId !== projectId) {
    const error = new Error('Session not found in project');
    error.statusCode = 404;
    throw error;
  }

  const nextTitle = String(title || '').trim().slice(0, 52);
  if (!nextTitle) {
    const error = new Error('Title is required');
    error.statusCode = 400;
    throw error;
  }

  if (!session.mobileOnly) {
    await setDesktopThreadName(session.id, nextTitle);
  }
  await renameMobileSession({
    id: session.id,
    projectPath: session.cwd,
    projectless: session.projectless,
    title: nextTitle,
    titleLocked: !auto,
    updatedAt: session.updatedAt
  });

  return { ...session, title: nextTitle, titleLocked: !auto };
}

export async function deleteSession(sessionId, projectId) {
  const session = getSession(sessionId);
  if (!session) {
    const error = new Error('Session not found');
    error.statusCode = 404;
    throw error;
  }
  if (projectId && session.projectId !== projectId) {
    const error = new Error('Session not found in project');
    error.statusCode = 404;
    throw error;
  }

  let archivedDesktopThread = false;
  if (!session.mobileOnly) {
    await archiveDesktopThread(session.id);
    archivedDesktopThread = true;
  }

  const hidden = await hideSessionInMobile(session);

  return {
    deletedSessionId: sessionId,
    projectId: session.projectId,
    hiddenOnly: !archivedDesktopThread,
    archivedDesktopThread,
    hiddenAt: hidden.hiddenAt,
    deletedFile: false,
    deletedIndexRows: false,
    deletedMobileRecord: false
  };
}

export async function hideSessionMessage(sessionId, messageId) {
  const id = String(sessionId || '').trim();
  const itemId = String(messageId || '').trim();
  if (!id || !itemId) {
    const error = new Error('sessionId and messageId are required');
    error.statusCode = 400;
    throw error;
  }

  const state = await readDeletedMessagesState();
  if (!state.sessions[id] || typeof state.sessions[id] !== 'object' || Array.isArray(state.sessions[id])) {
    state.sessions[id] = {};
  }
  const existing = state.sessions[id][itemId];
  const deletedAt = existing?.deletedAt || new Date().toISOString();
  state.sessions[id][itemId] = { deletedAt };
  await writeDeletedMessagesState(state);
  return { sessionId: id, messageId: itemId, deletedAt };
}

function paginateMessages(messages, { limit = 120, offset = null, latest = true } = {}) {
  const total = messages.length;
  const count = Number(limit) || 0;
  const hasOffset = offset !== null && offset !== undefined;
  const start = hasOffset
    ? Math.max(0, Number(offset) || 0)
    : latest && count
      ? Math.max(0, total - count)
      : 0;
  const end = count ? start + count : undefined;
  return {
    messages: messages.slice(start, end),
    total,
    offset: start,
    hasMore: end ? end < total : false,
    hasMoreBefore: start > 0
  };
}

function diffStats(unifiedDiff = '') {
  let additions = 0;
  let deletions = 0;
  for (const line of String(unifiedDiff || '').split(/\r?\n/)) {
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

function normalizePatchChanges(changes) {
  if (Array.isArray(changes)) {
    return changes.map((change) => {
      const diff = change?.unified_diff || change?.diff || '';
      const stats = diffStats(diff);
      return {
        ...change,
        additions: Number(change?.additions) || stats.additions,
        deletions: Number(change?.deletions) || stats.deletions,
        unifiedDiff: diff,
        movePath: change?.move_path || change?.movePath || null
      };
    });
  }
  if (!changes || typeof changes !== 'object') {
    return [];
  }
  return Object.entries(changes).map(([filePath, change]) => {
    const stats = diffStats(change?.unified_diff || change?.diff || '');
    return {
      path: filePath,
      kind: change?.type || change?.kind || 'update',
      additions: Number(change?.additions) || stats.additions,
      deletions: Number(change?.deletions) || stats.deletions,
      unifiedDiff: change?.unified_diff || change?.diff || '',
      movePath: change?.move_path || null
    };
  });
}

function upsertMessage(messages, message) {
  const index = messages.findIndex((item) => item.id === message.id);
  if (index >= 0) {
    messages[index] = { ...messages[index], ...message };
    return;
  }
  messages.push(message);
}

function desktopActivityMessageId(turnId, segmentIndex = 0) {
  return segmentIndex > 0 ? `activity-${turnId}-${segmentIndex}` : `activity-${turnId}`;
}

function upsertDesktopActivity(messages, turnId, activity, segmentIndex = 0) {
  if (!activity) {
    return;
  }
  const id = desktopActivityMessageId(turnId, segmentIndex);
  const existing = messages.find((message) => message.id === id);
  if (existing) {
    const current = Array.isArray(existing.activities) ? existing.activities : [];
    if (activity.kind === 'context_compaction' && current.some((item) => item.kind === 'context_compaction')) {
      return;
    }
    if (!current.some((item) => item.id === activity.id)) {
      existing.activities = [...current, activity];
    }
    existing.timestamp = activity.timestamp || existing.timestamp;
    return;
  }
  messages.push({
    id,
    role: 'activity',
    turnId,
    segmentIndex,
    content: '正在处理',
    label: '正在处理',
    kind: 'desktop',
    status: 'running',
    timestamp: activity.timestamp || new Date().toISOString(),
    startedAt: activity.startedAt || activity.timestamp || null,
    activities: [activity]
  });
}

function normalizedActivityText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function isoFromEpochSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return new Date(seconds * 1000).toISOString();
}

function completeDesktopActivity(messages, turnId, finalContent = '', metadata = {}, status = 'completed', segmentIndex = 0) {
  const id = desktopActivityMessageId(turnId, segmentIndex);
  let item = messages.find((message) => message.id === id);
  if (!item) {
    item = {
      id,
      role: 'activity',
      turnId,
      segmentIndex,
      content: '正在处理',
      label: '正在处理',
      kind: 'desktop',
      status: 'running',
      timestamp: metadata.completedAt || new Date().toISOString(),
      startedAt: metadata.startedAt || null,
      activities: []
    };
    messages.push(item);
  }
  const normalizedFinal = normalizedActivityText(finalContent);
  if (normalizedFinal && Array.isArray(item.activities)) {
    item.activities = item.activities.filter((activity) => {
      if (!['agent_message', 'message'].includes(activity?.kind)) {
        return true;
      }
      return normalizedActivityText(activity.label || activity.content || activity.detail) !== normalizedFinal;
    });
  }
  item.status = status;
  item.label = status === 'failed' ? '过程已中止' : '过程已同步';
  item.content = item.label;
  item.startedAt = metadata.startedAt || item.startedAt || null;
  item.completedAt = metadata.completedAt || item.completedAt || null;
  item.durationMs = metadata.durationMs || item.durationMs || null;
}

function completeExistingDesktopActivity(messages, turnId, finalContent = '', metadata = {}, status = 'completed', segmentIndex = 0) {
  const item = messages.find((message) => message.id === desktopActivityMessageId(turnId, segmentIndex));
  if (!item || item.status !== 'running') {
    return;
  }
  completeDesktopActivity(messages, turnId, finalContent, metadata, status, segmentIndex);
}

function markdownImageDestination(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }
  if (/[\s<>()]/.test(raw)) {
    return `<${raw.replace(/>/g, '%3E')}>`;
  }
  return raw;
}

function localizeDesktopDataImageUrl(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^data:image\/([a-z0-9.+-]+);base64,([\s\S]+)$/i);
  if (!match) {
    return raw;
  }

  const type = match[1].toLowerCase();
  const extension = type === 'jpeg' ? 'jpg' : type;
  if (!['png', 'jpg', 'webp', 'gif'].includes(extension)) {
    return raw;
  }

  const base64 = match[2].replace(/\s+/g, '');
  if (!base64) {
    return raw;
  }

  try {
    const digest = crypto.createHash('sha256').update(base64).digest('hex');
    const filePath = path.join(DESKTOP_IMAGE_ROOT, `${digest}.${extension}`);
    if (!fsSync.existsSync(filePath)) {
      fsSync.mkdirSync(DESKTOP_IMAGE_ROOT, { recursive: true });
      fsSync.writeFileSync(filePath, Buffer.from(base64, 'base64'));
    }
    return filePath;
  } catch (error) {
    console.warn('[sessions] Failed to cache desktop data image:', error.message);
    return raw;
  }
}

function markdownImageInput(part) {
  const source = localizeDesktopDataImageUrl(part?.path || part?.url);
  if (!source) {
    return '[图片]';
  }
  const alt = String(part?.alt || '图片').replace(/[\[\]\n\r]/g, '').trim() || '图片';
  return `![${alt}](${markdownImageDestination(source)})`;
}

function textFromDesktopUserInput(content = []) {
  return (Array.isArray(content) ? content : [])
    .map((part) => {
      if (part?.type === 'text') {
        return part.text || '';
      }
      if (part?.type === 'localImage') {
        return markdownImageInput(part);
      }
      if (part?.type === 'image') {
        return markdownImageInput(part);
      }
      if (part?.type === 'mention' || part?.type === 'skill') {
        return part.name || part.path || '';
      }
      return '';
    })
    .filter(Boolean)
    .join('\n')
    .trim();
}

function hasFinalDesktopAssistantMessage(turn) {
  return (Array.isArray(turn?.items) ? turn.items : []).some(
    (item) => item?.type === 'agentMessage' && item.phase === 'final_answer' && String(item.text || '').trim()
  );
}

function desktopTurnRuntimeStatus(turn, { isLatestTurn = false } = {}) {
  const value = String(turn?.status || '').toLowerCase();
  if (['completed', 'success', 'succeeded'].includes(value)) {
    return 'completed';
  }
  const startedAtMs = Number(turn?.startedAt) > 0
    ? Number(turn.startedAt) * 1000
    : new Date(turn?.startedAt || 0).getTime();
  const isFresh = Number.isFinite(startedAtMs) && Date.now() - startedAtMs < STALE_RUNNING_TURN_MS;
  if (value === 'interrupted' && !turn?.completedAt && isLatestTurn && isFresh && !hasFinalDesktopAssistantMessage(turn)) {
    return 'running';
  }
  if (['failed', 'error', 'cancelled', 'canceled', 'interrupted', 'aborted'].includes(value)) {
    return 'failed';
  }
  if (turn?.completedAt) {
    return 'completed';
  }
  return 'running';
}

function normalizedDesktopItemStatus(status, fallback = 'running') {
  const value = String(status || '').toLowerCase();
  if (['completed', 'success', 'succeeded'].includes(value)) {
    return 'completed';
  }
  if (['failed', 'error', 'cancelled', 'canceled', 'interrupted', 'aborted'].includes(value)) {
    return 'failed';
  }
  return fallback;
}

function desktopActivityLabel(status, labels) {
  if (status === 'running') {
    return labels.running;
  }
  if (status === 'failed') {
    return labels.failed;
  }
  return labels.completed;
}

function desktopMobileStatusLabel(kind, status) {
  return statusLabel(kind, status);
}

function desktopActivityFallbackStatus(turnStatus) {
  return turnStatus === 'running' ? 'running' : turnStatus === 'failed' ? 'failed' : 'completed';
}

function agentStatusText(status = {}) {
  if (status.completed) {
    return '已完成';
  }
  if (status.failed || status.error) {
    return '失败';
  }
  if (status.running || status.queued || status.pending) {
    return '运行中';
  }
  return '打开';
}

function collabAgentSummary(agent) {
  return [agent.nickname, agent.role ? `(${agent.role})` : '', agent.statusText]
    .filter(Boolean)
    .join(' ');
}

async function readDesktopCollabActivities(filePath) {
  if (!filePath) {
    return [];
  }
  const activitiesByTurn = new Map();
  let currentTurnId = null;

  function ensureTurn(turnId, timestamp) {
    if (!turnId) {
      return null;
    }
    if (!activitiesByTurn.has(turnId)) {
      activitiesByTurn.set(turnId, {
        turnId,
        timestamp,
        agents: new Map()
      });
    }
    return activitiesByTurn.get(turnId);
  }

  try {
    const stream = fsSync.createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const payload = entry?.payload || {};
      if (payload.turn_id) {
        currentTurnId = payload.turn_id;
      }
      if (entry.type !== 'event_msg') {
        continue;
      }
      if (payload.type === 'task_started' && payload.turn_id) {
        currentTurnId = payload.turn_id;
        continue;
      }
      if (payload.type === 'collab_agent_spawn_end') {
        const state = ensureTurn(currentTurnId, entry.timestamp);
        if (!state || !payload.new_thread_id) {
          continue;
        }
        state.agents.set(payload.new_thread_id, {
          threadId: payload.new_thread_id,
          nickname: payload.new_agent_nickname || '',
          role: payload.new_agent_role || '',
          statusText: payload.status === 'pending_init' ? '运行中' : '打开',
          result: '',
          timestamp: entry.timestamp
        });
        continue;
      }
      if (payload.type === 'collab_waiting_end') {
        const state = ensureTurn(currentTurnId, entry.timestamp);
        if (!state) {
          continue;
        }
        const statuses = Array.isArray(payload.agent_statuses) ? payload.agent_statuses : [];
        for (const item of statuses) {
          const threadId = item.thread_id;
          if (!threadId) {
            continue;
          }
          const status = item.status || {};
          const previous = state.agents.get(threadId) || {};
          state.agents.set(threadId, {
            threadId,
            nickname: item.agent_nickname || previous.nickname || '',
            role: item.agent_role || previous.role || '',
            statusText: agentStatusText(status),
            result: status.completed || status.failed || status.error || '',
            timestamp: entry.timestamp
          });
        }
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[sessions] Failed to read collab agent activity:', error.message);
    }
    return [];
  }

  return [...activitiesByTurn.values()]
    .filter((state) => state.agents.size > 0)
    .map((state) => {
      const agents = [...state.agents.values()];
      const running = agents.some((agent) => /运行中|打开/.test(agent.statusText));
      const count = agents.length;
      return {
        turnId: state.turnId,
        activity: {
          id: `${state.turnId}-subagents`,
          kind: 'subagent_activity',
          label: `${count} 个后台智能体（使用 @ 标记智能体）`,
          status: running ? 'running' : 'completed',
          detail: agents.map(collabAgentSummary).join('\n'),
          subAgents: agents,
          timestamp: state.timestamp
        }
      };
    });
}

function desktopActivityFromThreadItem(item, turnId, index, timestamp, turnStatus = 'completed') {
  if (!item || item.type === 'userMessage') {
    return null;
  }
  const fallbackStatus = desktopActivityFallbackStatus(turnStatus);
  if (item.type === 'agentMessage') {
    if (item.phase !== 'commentary') {
      return null;
    }
    const content = String(item.text || '').trim();
    if (!content) {
      return null;
    }
    const status = normalizedDesktopItemStatus(item.status, fallbackStatus);
    return {
      id: `${turnId}-commentary-${item.id || index}`,
      kind: 'agent_message',
      label: content,
      content,
      status,
      detail: '',
      timestamp
    };
  }
  if (item.type === 'reasoning') {
    const status = normalizedDesktopItemStatus(item.status, fallbackStatus);
    return {
      id: `${turnId}-reasoning-${item.id || index}`,
      kind: 'reasoning',
      label: desktopActivityLabel(status, { running: '正在思考', completed: '思考完成', failed: '思考中止' }),
      status,
      detail: [...(item.summary || []), ...(item.content || [])].filter(Boolean).join('\n'),
      timestamp
    };
  }
  if (item.type === 'plan') {
    const status = normalizedDesktopItemStatus(item.status, fallbackStatus);
    return {
      id: `${turnId}-plan-${item.id || index}`,
      kind: 'plan',
      label: desktopActivityLabel(status, { running: '正在更新计划', completed: '计划已更新', failed: '计划更新中止' }),
      status,
      detail: item.text || '',
      timestamp
    };
  }
  if (item.type === 'commandExecution') {
    const status = normalizedDesktopItemStatus(item.status, item.exitCode ? 'failed' : fallbackStatus);
    return {
      id: `${turnId}-command-${item.id || index}`,
      kind: 'command_execution',
      label: desktopMobileStatusLabel('command_execution', status),
      status,
      detail: item.command || '',
      command: item.command || '',
      output: item.aggregatedOutput || '',
      exitCode: item.exitCode ?? item.exit_code ?? null,
      timestamp
    };
  }
  if (item.type === 'fileChange') {
    const status = normalizedDesktopItemStatus(item.status, fallbackStatus);
    return {
      id: `${turnId}-file-change-${item.id || index}`,
      kind: 'file_change',
      label: desktopMobileStatusLabel('file_change', status),
      status,
      detail: '',
      fileChanges: normalizePatchChanges(item.changes),
      timestamp
    };
  }
  if (item.type === 'mcpToolCall') {
    const status = normalizedDesktopItemStatus(item.status, fallbackStatus);
    return {
      id: `${turnId}-mcp-${item.id || index}`,
      kind: 'mcp_tool_call',
      label: desktopMobileStatusLabel('mcp_tool_call', status),
      status,
      detail: [item.server, item.tool].filter(Boolean).join(' / '),
      toolName: item.tool || '',
      error: item.error?.message || '',
      timestamp
    };
  }
  if (item.type === 'dynamicToolCall') {
    const status = item.success === false ? 'failed' : normalizedDesktopItemStatus(item.status, fallbackStatus);
    return {
      id: `${turnId}-tool-${item.id || index}`,
      kind: 'dynamic_tool_call',
      label: desktopMobileStatusLabel('dynamic_tool_call', status),
      status,
      detail: item.tool || '',
      toolName: item.tool || '',
      timestamp
    };
  }
  if (item.type === 'webSearch') {
    const status = normalizedDesktopItemStatus(item.status, fallbackStatus);
    return {
      id: `${turnId}-web-search-${item.id || index}`,
      kind: 'web_search',
      label: desktopMobileStatusLabel('web_search', status),
      status,
      detail: item.query || item.action?.query || '',
      timestamp
    };
  }
  if (item.type === 'imageGeneration') {
    const status = item.status === 'failed' ? 'failed' : normalizedDesktopItemStatus(item.status, fallbackStatus);
    return {
      id: `${turnId}-image-${item.id || index}`,
      kind: 'image_generation_call',
      label: desktopActivityLabel(status, { running: '正在生成图片', completed: '图片生成完成', failed: '图片生成失败' }),
      status,
      detail: item.revisedPrompt || item.result || '',
      timestamp
    };
  }
  if (item.type === 'contextCompaction') {
    const status = normalizedDesktopItemStatus(item.status, fallbackStatus);
    return {
      id: `${turnId}-context-compaction-${item.id || index}`,
      kind: 'context_compaction',
      label: desktopActivityLabel(status, { running: '正在自动压缩上下文', completed: '上下文已自动压缩', failed: '上下文压缩中止' }),
      status,
      detail: '',
      timestamp
    };
  }
  return null;
}

export function messagesFromDesktopThread(thread, { includeActivity = false } = {}) {
  const messages = [];
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];

  turns.forEach((turn, turnIndex) => {
    const turnId = turn.id || `${thread.id}-desktop-${turnIndex + 1}`;
    const startedAt = isoFromEpochSeconds(turn.startedAt) || new Date().toISOString();
    const turnStatus = desktopTurnRuntimeStatus(turn, { isLatestTurn: turnIndex === turns.length - 1 });
    const completedAt = isoFromEpochSeconds(turn.completedAt) || (turnStatus === 'running' ? null : startedAt);
    const items = Array.isArray(turn.items) ? turn.items : [];
    const lastUserItemIndex = items.reduce((latest, item, index) => (item?.type === 'userMessage' ? index : latest), -1);
    let segmentIndex = -1;
    let finalAssistantText = '';

    function completeCurrentSegment(status = 'completed', metadata = {}) {
      if (!includeActivity || segmentIndex < 0) {
        return;
      }
      completeExistingDesktopActivity(messages, turnId, finalAssistantText, {
        startedAt,
        completedAt: metadata.completedAt || completedAt || startedAt,
        durationMs: metadata.durationMs || null
      }, status, segmentIndex);
      finalAssistantText = '';
    }

    items.forEach((item, itemIndex) => {
      const timestamp = item.type === 'agentMessage' ? completedAt || startedAt : startedAt;
      if (item.type === 'userMessage') {
        completeCurrentSegment('completed', { completedAt: timestamp });
        segmentIndex += 1;
        finalAssistantText = '';
        const content = textFromDesktopUserInput(item.content);
        if (content) {
          messages.push({
            id: item.id || `${turnId}-user-${itemIndex}`,
            role: 'user',
            content: sanitizeVisibleUserMessage(content),
            timestamp,
            turnId,
            sessionId: thread.id
          });
        }
        return;
      }
      if (includeActivity) {
        if (segmentIndex < 0) {
          segmentIndex = 0;
        }
        const segmentStatus = itemIndex > lastUserItemIndex ? turnStatus : 'completed';
        upsertDesktopActivity(
          messages,
          turnId,
          desktopActivityFromThreadItem(item, turnId, itemIndex, timestamp, segmentStatus),
          segmentIndex
        );
      }
      if (item.type === 'agentMessage' && item.phase !== 'commentary') {
        const content = String(item.text || '').trim();
        if (content) {
          finalAssistantText = content;
          upsertMessage(messages, {
            id: item.id || `${turnId}-assistant`,
            role: 'assistant',
            content,
            timestamp,
            turnId,
            sessionId: thread.id
          });
        }
      }
      if (item.type === 'imageGeneration') {
        const content = imageMarkdownFromCodexImageGeneration(item);
        if (content) {
          finalAssistantText = content;
          upsertMessage(messages, {
            id: `${turnId}-image-result-${item.id || itemIndex}`,
            role: 'assistant',
            content,
            timestamp,
            turnId,
            sessionId: thread.id
          });
        }
      }
    });

    if (includeActivity && turnStatus !== 'running') {
      completeCurrentSegment(turnStatus === 'failed' ? 'failed' : 'completed', {
        startedAt,
        completedAt: completedAt || startedAt,
        durationMs: turn.durationMs || null
      });
    }
  });

  return messages;
}

export async function messagesFromLocalSessionFile(session, { includeActivity = false } = {}) {
  const messages = [];
  let currentTurnId = null;
  let localMessageIndex = 0;
  const pendingDiffMessages = new Map();

  if (!session?.filePath) {
    return messages;
  }

  function diffMessageTimestamp(timestamp) {
    const base = new Date(timestamp || new Date().toISOString()).getTime();
    return new Date((Number.isFinite(base) ? base : Date.now()) + 1).toISOString();
  }

  function upsertPendingDiffMessage(turnId, fileChanges, timestamp) {
    if (!fileChanges.length) {
      return;
    }
    const id = `diff-${turnId || session.id}`;
    const previous = pendingDiffMessages.get(id);
    pendingDiffMessages.set(id, {
      id,
      role: 'diff',
      content: '',
      turnId: turnId || null,
      sessionId: session.id,
      fileChanges: mergeFileChanges(previous?.fileChanges || [], fileChanges),
      timestamp: previous?.timestamp || diffMessageTimestamp(timestamp)
    });
  }

  function flushPendingDiffMessage(turnId, timestamp) {
    const id = `diff-${turnId || session.id}`;
    const diffMessage = pendingDiffMessages.get(id);
    if (!diffMessage) {
      return;
    }
    pendingDiffMessages.delete(id);
    messages.push({
      ...diffMessage,
      timestamp: diffMessageTimestamp(timestamp || diffMessage.timestamp)
    });
  }

  try {
    const stream = fsSync.createReadStream(session.filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) {
        continue;
      }
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const payload = entry?.payload || {};
      if (entry.type === 'turn_context' && payload.turn_id) {
        currentTurnId = payload.turn_id;
        continue;
      }
      if (entry.type === 'event_msg') {
        if (payload.turn_id) {
          currentTurnId = payload.turn_id;
        }
        if (payload.type === 'patch_apply_end') {
          const fileChanges = fileChangesFromItem({ changes: payload.changes }, { cwd: session.cwd || '' });
          upsertPendingDiffMessage(payload.turn_id || currentTurnId, fileChanges, entry.timestamp);
        }
        continue;
      }
      if (entry.type !== 'response_item' || payload.type !== 'message') {
        continue;
      }
      if (!['user', 'assistant'].includes(payload.role)) {
        continue;
      }
      if (payload.role === 'assistant' && payload.phase === 'commentary') {
        continue;
      }
      let content = textFromLocalMessageContent(payload.content);
      if (!content) {
        continue;
      }
      if (payload.role === 'user') {
        if (isInternalLocalUserContent(content)) {
          continue;
        }
        content = sanitizeVisibleUserMessage(content);
      }
      if (!content) {
        continue;
      }
      localMessageIndex += 1;
      messages.push({
        id: payload.id || `${session.id}-local-${localMessageIndex}`,
        role: payload.role,
        content,
        timestamp: isoFromAnyTimestamp(entry.timestamp) || session.updatedAt || new Date().toISOString(),
        turnId: payload.turn_id || currentTurnId || `${session.id}-local`,
        sessionId: session.id
      });
      if (payload.role === 'assistant') {
        flushPendingDiffMessage(payload.turn_id || currentTurnId, entry.timestamp);
      }
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[sessions] Failed to read local session messages:', session.filePath, error.message);
    }
  }

  for (const diffMessage of pendingDiffMessages.values()) {
    messages.push(diffMessage);
  }

  return messages;
}

export async function readSessionMessages(sessionId, { limit = 120, offset = null, latest = true, includeActivity = false } = {}) {
  const deletedIds = await readDeletedMessageIds(sessionId);
  const session = getSession(sessionId);

  let response = null;
  let desktopReadError = null;
  if (!session?.mobileOnly) {
    try {
      response = await readDesktopThread(sessionId, { includeTurns: true });
    } catch (error) {
      desktopReadError = error;
      if (!session?.filePath) {
        throw error;
      }
      console.warn('[sessions] Desktop thread read unavailable, using local session log:', error.message);
    }
  }

  if (response?.thread) {
    const messages = messagesFromDesktopThread(response.thread, { includeActivity });
    if (includeActivity) {
      const collabActivities = await readDesktopCollabActivities(response.thread.path);
      for (const item of collabActivities) {
        upsertDesktopActivity(messages, item.turnId, item.activity);
      }
    }
    messages.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
    const contextState = await readRolloutContextState(response.thread.path, sessionId);

    return {
      ...paginateMessages(filterDeletedMessages(messages, deletedIds), { limit, offset, latest }),
      context: publicContextState(contextState, cache.config?.context || {})
    };
  }

  if (session?.filePath) {
    const messages = await messagesFromLocalSessionFile(session, { includeActivity });
    messages.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));
    const contextState = await readRolloutContextState(session.filePath, sessionId);
    return {
      ...paginateMessages(filterDeletedMessages(messages, deletedIds), { limit, offset, latest }),
      context: publicContextState(contextState, cache.config?.context || {})
    };
  }

  if (desktopReadError) {
    throw desktopReadError;
  }
  if (!response?.thread) {
    const error = new Error('Desktop thread not found');
    error.statusCode = 404;
    throw error;
  }
}

export function getHostName() {
  return os.hostname();
}
