import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..', '..', '..');
const outLog = path.join(root, '.codexmobile', 'server.out.log');
const errLog = path.join(root, '.codexmobile', 'server.err.log');
const args = new Set(process.argv.slice(2));

function loadDotEnv() {
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) {
    return;
  }
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match || process.env[match[1]] !== undefined) {
      continue;
    }
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    ...options
  });
  return result;
}

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

function fail(message, result) {
  console.error(`CodexMobile pair failed: ${message}`);
  if (result?.stdout) {
    console.error(result.stdout.trim());
  }
  if (result?.stderr) {
    console.error(result.stderr.trim());
  }
  console.error(`Logs: ${outLog}`);
  console.error(`Errors: ${errLog}`);
  process.exit(result?.status || 1);
}

async function waitForStatus(port) {
  const url = `http://127.0.0.1:${port}/api/status`;
  let lastError = null;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const { statusCode, data } = await getJson(url);
      if (statusCode >= 200 && statusCode < 300 && data?.connected) {
        return { url, data };
      }
      lastError = new Error(`HTTP ${statusCode}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw lastError || new Error('status timeout');
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 2000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          resolve({ statusCode: res.statusCode || 0, data: JSON.parse(body) });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('timeout', () => {
      req.destroy(new Error('status timeout'));
    });
    req.on('error', reject);
  });
}

function latestPairingCode() {
  const envCode = String(process.env.CODEXMOBILE_PAIRING_CODE || '').trim();
  if (/^\d{6}$/.test(envCode)) {
    return `${envCode} (fixed from env)`;
  }

  const fixedPath = path.join(root, '.codexmobile', 'state', 'pairing-code.txt');
  if (fs.existsSync(fixedPath)) {
    const code = fs.readFileSync(fixedPath, 'utf8').trim();
    if (/^\d{6}$/.test(code)) {
      return `${code} (fixed from file)`;
    }
  }

  if (!fs.existsSync(outLog)) {
    return '';
  }
  const text = fs.readFileSync(outLog, 'utf8');
  const matches = [...text.matchAll(/Pairing code:\s*(\d{6})/g)];
  return matches.length ? matches[matches.length - 1][1] : '';
}

function privateIpv4Addresses() {
  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) {
        continue;
      }
      addresses.push(entry.address);
    }
  }
  return [...new Set(addresses)];
}

function tailscaleAddresses() {
  const result = run('tailscale', ['ip', '-4']);
  if (result.status !== 0) {
    return [];
  }
  return String(result.stdout || '')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function configuredPublicUrl(port) {
  const raw = String(process.env.CODEXMOBILE_PUBLIC_URL || '').trim();
  if (raw) {
    return raw;
  }
  return `http://127.0.0.1:${port}`;
}

loadDotEnv();

const port = Number(process.env.PORT || 3321);
if (!Number.isInteger(port) || port <= 0) {
  fail(`invalid PORT: ${process.env.PORT}`);
}

if (args.has('--build') || !fs.existsSync(path.join(root, 'client', 'dist', 'index.html'))) {
  const build = run(npmCommand(), ['run', 'build']);
  if (build.status !== 0) {
    fail('build failed', build);
  }
}

const start = run(npmCommand(), ['run', 'start:bg']);
if (start.status !== 0) {
  fail('background start failed', start);
}

let status;
try {
  status = await waitForStatus(port);
} catch (error) {
  fail(`status check failed: ${error.message}`);
}

const code = latestPairingCode();
const urls = [
  configuredPublicUrl(port),
  ...tailscaleAddresses().map((ip) => `http://${ip}:${port}`),
  ...privateIpv4Addresses().map((ip) => `http://${ip}:${port}`)
];
const uniqueUrls = [...new Set(urls)];

console.log('CodexMobile pairing ready');
console.log(`Status: ${status.data.hostName || os.hostname()} ${status.data.provider || ''}/${status.data.model || ''}`);
console.log(`Pairing code: ${code || 'not found in log; check server.out.log'}`);
console.log('Phone URLs:');
for (const url of uniqueUrls) {
  console.log(`- ${url}`);
}
console.log(`Local status: ${status.url}`);
console.log(`Logs: ${outLog}`);
