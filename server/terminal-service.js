import { spawn } from 'node:child_process';
import os from 'node:os';

const MAX_TERMINALS_PER_SOCKET = 4;
const DETACH_TERMINAL_PROCESS = process.platform !== 'win32';

function serialize(payload) {
  return JSON.stringify(payload);
}

function send(ws, payload) {
  if (ws.readyState === 1) {
    ws.send(serialize(payload));
  }
}

function terminalError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function safeTerminalId(value) {
  return String(value || '').trim().slice(0, 80);
}

function terminalShell() {
  if (process.platform === 'win32') {
    return { command: process.env.ComSpec || 'cmd.exe', args: [] };
  }
  return { command: process.env.SHELL || '/bin/bash', args: ['-i'] };
}

function signalTerminalProcess(child, signal) {
  if (!child?.pid) {
    return;
  }
  if (DETACH_TERMINAL_PROCESS) {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch (error) {
      if (error?.code === 'ESRCH') {
        return;
      }
    }
  }
  try {
    child.kill(signal);
  } catch {
    // Ignore process cleanup errors.
  }
}

export function createTerminalService({ getProject, getTarget } = {}) {
  if (typeof getProject !== 'function') {
    throw new Error('createTerminalService requires getProject');
  }

  const socketTerminals = new WeakMap();

  function requireTarget(projectId, options = {}) {
    const project = typeof getTarget === 'function'
      ? getTarget(projectId, options)
      : getProject(projectId);
    if (!project?.path) {
      throw terminalError('Project not found', 404);
    }
    return project;
  }

  function terminalsFor(ws) {
    let terminals = socketTerminals.get(ws);
    if (!terminals) {
      terminals = new Map();
      socketTerminals.set(ws, terminals);
    }
    return terminals;
  }

  function closeTerminal(ws, terminalId, { notify = true } = {}) {
    const terminals = terminalsFor(ws);
    const terminal = terminals.get(terminalId);
    if (!terminal) {
      return;
    }
    terminals.delete(terminalId);
    terminal.closed = true;
    try {
      if (terminal.process.stdin?.writable) {
        terminal.process.stdin.end('exit\n');
      }
    } catch {
      // Ignore stdin cleanup errors.
    }
    signalTerminalProcess(terminal.process, 'SIGTERM');
    const forceKillTimer = setTimeout(() => {
      if (terminal.process.exitCode === null && terminal.process.signalCode === null) {
        signalTerminalProcess(terminal.process, 'SIGKILL');
      }
    }, 800);
    if (typeof forceKillTimer.unref === 'function') {
      forceKillTimer.unref();
    }
    terminal.process.once('close', () => clearTimeout(forceKillTimer));
    if (notify) {
      send(ws, { type: 'terminal-exit', terminalId, code: null, signal: 'closed' });
    }
  }

  function openTerminal(ws, payload = {}) {
    const terminals = terminalsFor(ws);
    if (terminals.size >= MAX_TERMINALS_PER_SOCKET) {
      throw terminalError('Too many terminals are open', 429);
    }
    const terminalId = safeTerminalId(payload.terminalId);
    if (!terminalId) {
      throw terminalError('terminalId is required', 400);
    }
    closeTerminal(ws, terminalId, { notify: false });

    const project = requireTarget(payload.projectId, {
      sessionId: payload.sessionId,
      cwd: payload.cwd
    });
    const { command, args } = terminalShell();
    const child = spawn(command, args, {
      cwd: project.path,
      env: {
        ...process.env,
        TERM: process.env.TERM || 'xterm-256color',
        COLUMNS: String(Number(payload.cols) || 100),
        LINES: String(Number(payload.rows) || 28),
        CODEXMOBILE_TERMINAL: '1'
      },
      detached: DETACH_TERMINAL_PROCESS,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    terminals.set(terminalId, { process: child, closed: false });
    send(ws, {
      type: 'terminal-ready',
      terminalId,
      projectId: project.id,
      cwd: project.path,
      shell: command
    });
    send(ws, {
      type: 'terminal-output',
      terminalId,
      data: `CodexMobile terminal on ${os.hostname()}\n${project.path}\n`
    });

    child.stdout.on('data', (chunk) => {
      send(ws, { type: 'terminal-output', terminalId, data: chunk.toString('utf8') });
    });
    child.stderr.on('data', (chunk) => {
      send(ws, { type: 'terminal-output', terminalId, data: chunk.toString('utf8') });
    });
    child.stdin.on('error', () => {
      // The browser can disconnect while the shell is already exiting.
    });
    child.stdout.on('error', () => {
      // Ignore stream cleanup errors from detached terminal children.
    });
    child.stderr.on('error', () => {
      // Ignore stream cleanup errors from detached terminal children.
    });
    child.on('error', (error) => {
      send(ws, { type: 'terminal-error', terminalId, message: error.message || 'Terminal failed' });
    });
    child.on('close', (code, signal) => {
      const terminal = terminals.get(terminalId);
      if (terminal?.closed) {
        return;
      }
      terminals.delete(terminalId);
      send(ws, { type: 'terminal-exit', terminalId, code, signal });
    });
  }

  function writeTerminal(ws, payload = {}) {
    const terminalId = safeTerminalId(payload.terminalId);
    const terminal = terminalsFor(ws).get(terminalId);
    if (!terminal?.process?.stdin?.writable) {
      throw terminalError('Terminal is not connected', 409);
    }
    terminal.process.stdin.write(String(payload.data || ''));
  }

  function handleSocketMessage(ws, raw) {
    let payload = null;
    try {
      payload = JSON.parse(String(raw || '{}'));
    } catch {
      return false;
    }
    if (!String(payload?.type || '').startsWith('terminal-')) {
      return false;
    }
    try {
      if (payload.type === 'terminal-open') {
        openTerminal(ws, payload);
      } else if (payload.type === 'terminal-input') {
        writeTerminal(ws, payload);
      } else if (payload.type === 'terminal-close') {
        closeTerminal(ws, safeTerminalId(payload.terminalId));
      } else if (payload.type === 'terminal-resize') {
        send(ws, {
          type: 'terminal-resized',
          terminalId: safeTerminalId(payload.terminalId),
          cols: Number(payload.cols) || null,
          rows: Number(payload.rows) || null
        });
      }
    } catch (error) {
      send(ws, {
        type: 'terminal-error',
        terminalId: safeTerminalId(payload?.terminalId),
        message: error.message || 'Terminal request failed'
      });
    }
    return true;
  }

  function closeSocket(ws) {
    for (const terminalId of terminalsFor(ws).keys()) {
      closeTerminal(ws, terminalId, { notify: false });
    }
    socketTerminals.delete(ws);
  }

  return { handleSocketMessage, closeSocket };
}
