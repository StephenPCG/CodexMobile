import { spawn } from 'node:child_process';
import fsSync from 'node:fs';
import readline from 'node:readline';

const DEFAULT_CODEX_APP_BINARY = '/Applications/Codex.app/Contents/Resources/codex';
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function resolveCodexBinary() {
  const candidates = [
    process.env.CODEXMOBILE_CODEX_BINARY,
    process.env.CODEX_BINARY,
    DEFAULT_CODEX_APP_BINARY,
    'codex'
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (candidate === 'codex' || fsSync.existsSync(candidate)) {
      return candidate;
    }
  }
  return 'codex';
}

function responseError(message, method = '') {
  const error = new Error(message || `Codex app-server request failed${method ? `: ${method}` : ''}`);
  error.method = method;
  return error;
}

function defaultServerRequestResult(message) {
  switch (message?.method) {
    case 'item/commandExecution/requestApproval':
      return { decision: 'decline' };
    case 'item/fileChange/requestApproval':
      return { decision: 'decline' };
    case 'item/permissions/requestApproval':
      return { permissions: {}, scope: 'turn' };
    case 'applyPatchApproval':
    case 'execCommandApproval':
      return { decision: 'denied' };
    case 'item/tool/requestUserInput':
      return { answers: {} };
    case 'mcpServer/elicitation/request':
      return { action: 'decline', content: null, _meta: null };
    case 'item/tool/call':
      return { contentItems: [], success: false };
    default:
      return null;
  }
}

export class CodexAppServerClient {
  constructor({
    env = process.env,
    cwd = process.cwd(),
    clientInfo = {},
    onNotification = null,
    onServerRequest = null
  } = {}) {
    this.env = env;
    this.cwd = cwd;
    this.clientInfo = {
      name: clientInfo.name || 'CodexMobile',
      title: clientInfo.title || null,
      version: clientInfo.version || '0.1.0'
    };
    this.onNotification = onNotification;
    this.onServerRequest = onServerRequest;
    this.child = null;
    this.readline = null;
    this.nextId = 1;
    this.pending = new Map();
    this.stderr = '';
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
  }

  start() {
    if (this.child) {
      return;
    }
    this.child = spawn(resolveCodexBinary(), ['app-server', '--listen', 'stdio://'], {
      cwd: this.cwd,
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    this.readline = readline.createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity
    });
    this.readline.on('line', (line) => this.handleLine(line));

    this.child.stderr.on('data', (chunk) => {
      this.stderr += chunk.toString();
      if (this.stderr.length > 24_000) {
        this.stderr = this.stderr.slice(-12_000);
      }
    });

    this.child.on('error', (error) => {
      this.rejectAll(error);
      this.resolveClosed?.({ code: null, signal: null, error });
    });
    this.child.on('close', (code, signal) => {
      const error = responseError(
        this.stderr.trim() || `Codex app-server exited with ${code ?? signal ?? 'unknown status'}`
      );
      this.rejectAll(error);
      this.resolveClosed?.({ code, signal, error: code === 0 ? null : error });
    });
  }

  async initialize() {
    this.start();
    await this.request('initialize', {
      clientInfo: this.clientInfo,
      capabilities: { experimentalApi: true }
    });
    this.notify('initialized');
    return this;
  }

  request(method, params, { timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS } = {}) {
    this.start();
    const id = this.nextId;
    this.nextId += 1;
    const payload = params === undefined ? { id, method } : { id, method, params };
    const promise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(responseError(`Codex app-server request timed out: ${method}`, method));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timeout });
    });
    this.write(payload);
    return promise;
  }

  notify(method, params) {
    const payload = params === undefined ? { method } : { method, params };
    this.write(payload);
  }

  respond(id, result) {
    this.write({ id, result });
  }

  respondError(id, message, code = -32603) {
    this.write({ id, error: { code, message } });
  }

  write(payload) {
    if (!this.child?.stdin?.writable) {
      throw responseError('Codex app-server stdin is not writable');
    }
    this.child.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  handleLine(line) {
    if (!line.trim()) {
      return;
    }
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (message.id !== undefined && message.method) {
      this.handleServerRequest(message);
      return;
    }

    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) {
        pending.reject(responseError(message.error.message, pending.method));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method && this.onNotification) {
      this.onNotification(message);
    }
  }

  async handleServerRequest(message) {
    try {
      const result = this.onServerRequest
        ? await this.onServerRequest(message)
        : defaultServerRequestResult(message);
      if (result === null || result === undefined) {
        this.respondError(message.id, `Unsupported Codex app-server request: ${message.method}`, -32601);
        return;
      }
      this.respond(message.id, result);
    } catch (error) {
      this.respondError(message.id, error.message || `Failed to handle ${message.method}`);
    }
  }

  rejectAll(error) {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  close() {
    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }
    if (this.child && !this.child.killed) {
      this.child.kill();
    }
  }
}

export async function createCodexAppServerClient(options = {}) {
  const client = new CodexAppServerClient(options);
  await client.initialize();
  return client;
}

export async function listDesktopThreads({ limit = 1000, pageSize = 100 } = {}) {
  const client = await createCodexAppServerClient({
    clientInfo: { name: 'CodexMobileList', title: null, version: '0.1.0' }
  });
  try {
    const threads = [];
    let cursor = null;
    while (threads.length < limit) {
      const response = await client.request('thread/list', {
        cursor,
        limit: Math.min(pageSize, limit - threads.length),
        sortKey: 'updated_at',
        sortDirection: 'desc',
        archived: false
      }, { timeoutMs: 20_000 });
      const data = Array.isArray(response?.data) ? response.data : [];
      threads.push(...data);
      cursor = response?.nextCursor || null;
      if (!cursor || !data.length) {
        break;
      }
    }
    return threads;
  } finally {
    client.close();
  }
}

export async function readDesktopThread(threadId, { includeTurns = true } = {}) {
  const client = await createCodexAppServerClient({
    clientInfo: { name: 'CodexMobileRead', title: null, version: '0.1.0' }
  });
  try {
    return await client.request('thread/read', {
      threadId,
      includeTurns
    }, { timeoutMs: 20_000 });
  } finally {
    client.close();
  }
}

export async function setDesktopThreadName(threadId, name) {
  const client = await createCodexAppServerClient({
    clientInfo: { name: 'CodexMobileRename', title: null, version: '0.1.0' }
  });
  try {
    return await client.request('thread/name/set', {
      threadId,
      name
    }, { timeoutMs: 20_000 });
  } finally {
    client.close();
  }
}
