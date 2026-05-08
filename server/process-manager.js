const managedProcesses = new Map();
let nextManagedProcessId = 1;
let shutdownInProgress = false;

function processPid(target) {
  return Number(target?.pid || 0) || 0;
}

function killPid(pid, signal, { group = false } = {}) {
  if (!pid) {
    return;
  }
  const targetPid = group && process.platform !== 'win32' ? -pid : pid;
  try {
    process.kill(targetPid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') {
      throw error;
    }
  }
}

function safeKill(entry, signal) {
  try {
    if (typeof entry.kill === 'function') {
      entry.kill(signal);
      return;
    }
    killPid(entry.pid, signal, { group: entry.killGroup });
  } catch (error) {
    console.warn(`[process] Failed to send ${signal} to ${entry.name} pid=${entry.pid}: ${error.message}`);
  }
}

export function registerManagedProcess(target, {
  name = 'child-process',
  killGroup = false,
  kill
} = {}) {
  const pid = processPid(target);
  if (!pid) {
    return () => {};
  }

  const id = nextManagedProcessId;
  nextManagedProcessId += 1;
  const entry = {
    id,
    pid,
    name,
    killGroup,
    kill,
    startedAt: new Date().toISOString()
  };
  managedProcesses.set(id, entry);

  const unregister = () => {
    managedProcesses.delete(id);
  };
  if (typeof target.once === 'function') {
    target.once('exit', unregister);
    target.once('close', unregister);
  }
  return unregister;
}

export function managedProcessSnapshot() {
  return [...managedProcesses.values()].map((entry) => ({
    id: entry.id,
    pid: entry.pid,
    name: entry.name,
    startedAt: entry.startedAt
  }));
}

export async function shutdownManagedProcesses({ timeoutMs = 1500 } = {}) {
  const entries = [...managedProcesses.values()];
  if (!entries.length) {
    return;
  }
  for (const entry of entries) {
    safeKill(entry, 'SIGTERM');
  }
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
  for (const entry of [...managedProcesses.values()]) {
    safeKill(entry, 'SIGKILL');
    managedProcesses.delete(entry.id);
  }
}

export function installManagedProcessShutdown({ beforeShutdown, timeoutMs = 1500 } = {}) {
  async function shutdown(signal) {
    if (shutdownInProgress) {
      return;
    }
    shutdownInProgress = true;
    console.log(`[process] Received ${signal}, shutting down CodexMobile...`);
    try {
      if (typeof beforeShutdown === 'function') {
        await beforeShutdown(signal);
      }
      await shutdownManagedProcesses({ timeoutMs });
    } catch (error) {
      console.warn('[process] Shutdown cleanup failed:', error.message);
    } finally {
      process.exit(signal === 'SIGINT' ? 130 : 143);
    }
  }

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      shutdown(signal);
    });
  }
}
