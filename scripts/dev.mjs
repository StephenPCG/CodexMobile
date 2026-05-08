import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

loadDotEnv(path.join(root, '.env'));

const backendPort = String(process.env.PORT || 3321);
const clientPort = String(process.env.CODEXMOBILE_CLIENT_PORT || process.env.VITE_PORT || 5173);
const clientHost = String(process.env.CODEXMOBILE_CLIENT_HOST || '0.0.0.0');
const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');

if (!fs.existsSync(viteBin)) {
  console.error('Vite is not installed. Run npm install first.');
  process.exit(1);
}

const env = normalizeEnv({
  ...process.env,
  FORCE_COLOR: process.env.FORCE_COLOR || '1',
  CODEXMOBILE_API_PORT: backendPort,
  CODEXMOBILE_CLIENT_PORT: clientPort
});

const children = [
  startProcess('server', process.execPath, ['--watch', 'server/index.js'], env),
  startProcess('client', process.execPath, [
    viteBin,
    '--host',
    clientHost,
    '--config',
    'client/vite.config.js'
  ], env)
];

console.log(`Dev server: http://127.0.0.1:${clientPort}`);
console.log(`API server: http://127.0.0.1:${backendPort}`);

let shuttingDown = false;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(0));
}

process.on('exit', () => {
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
});

function startProcess(name, command, args, childEnv) {
  const child = spawn(command, args, {
    cwd: root,
    env: childEnv,
    stdio: ['inherit', 'pipe', 'pipe'],
    windowsHide: false
  });

  pipeWithPrefix(child.stdout, name);
  pipeWithPrefix(child.stderr, name);

  child.on('exit', (code, signal) => {
    if (shuttingDown) {
      return;
    }
    const suffix = signal ? `signal ${signal}` : `code ${code}`;
    console.error(`[${name}] exited with ${suffix}`);
    shutdown(code || 1);
  });

  child.on('error', (error) => {
    if (shuttingDown) {
      return;
    }
    console.error(`[${name}] ${error.message}`);
    shutdown(1);
  });

  return child;
}

function pipeWithPrefix(stream, name) {
  let buffered = '';
  stream.on('data', (chunk) => {
    buffered += chunk.toString();
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() || '';
    for (const line of lines) {
      if (line) {
        console.log(`[${name}] ${line}`);
      }
    }
  });
  stream.on('end', () => {
    if (buffered) {
      console.log(`[${name}] ${buffered}`);
    }
  });
}

function shutdown(code) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
  setTimeout(() => process.exit(code), 250);
}

function loadDotEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) {
      continue;
    }
    process.env[match[1]] = parseDotEnvValue(match[2]);
  }
}

function parseDotEnvValue(value) {
  const trimmed = String(value || '').trim();
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.endsWith(quote)) {
    const inner = trimmed.slice(1, -1);
    return quote === '"' ? inner.replace(/\\n/g, '\n').replace(/\\"/g, '"') : inner;
  }
  return trimmed.replace(/\s+#.*$/, '');
}

function normalizeEnv(source) {
  if (process.platform !== 'win32') {
    return source;
  }

  const env = {};
  const seen = new Set();
  for (const [key, value] of Object.entries(source)) {
    const normalized = key.toLowerCase();
    if (normalized === 'path' || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    env[key] = value;
  }
  env.Path = [source.Path, source.PATH].filter(Boolean).join(path.delimiter);
  return env;
}
