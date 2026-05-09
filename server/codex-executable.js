import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const moduleRequire = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
export const MIN_CODEX_CLI_VERSION = '0.130.0';

const PLATFORM_PACKAGE_BY_TARGET = {
  'x86_64-unknown-linux-musl': '@openai/codex-linux-x64',
  'aarch64-unknown-linux-musl': '@openai/codex-linux-arm64',
  'x86_64-apple-darwin': '@openai/codex-darwin-x64',
  'aarch64-apple-darwin': '@openai/codex-darwin-arm64',
  'x86_64-pc-windows-msvc': '@openai/codex-win32-x64',
  'aarch64-pc-windows-msvc': '@openai/codex-win32-arm64'
};

function targetTriple() {
  const { platform, arch } = process;
  if ((platform === 'linux' || platform === 'android') && arch === 'x64') {
    return 'x86_64-unknown-linux-musl';
  }
  if ((platform === 'linux' || platform === 'android') && arch === 'arm64') {
    return 'aarch64-unknown-linux-musl';
  }
  if (platform === 'darwin' && arch === 'x64') {
    return 'x86_64-apple-darwin';
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return 'aarch64-apple-darwin';
  }
  if (platform === 'win32' && arch === 'x64') {
    return 'x86_64-pc-windows-msvc';
  }
  if (platform === 'win32' && arch === 'arm64') {
    return 'aarch64-pc-windows-msvc';
  }
  throw new Error(`Unsupported Codex platform: ${platform} (${arch})`);
}

function bundledCodexPath() {
  const triple = targetTriple();
  const platformPackage = PLATFORM_PACKAGE_BY_TARGET[triple];
  const platformPackageJsonPath = moduleRequire.resolve(`${platformPackage}/package.json`);
  const binaryName = process.platform === 'win32' ? 'codex.exe' : 'codex';
  return path.join(path.dirname(platformPackageJsonPath), 'vendor', triple, 'codex', binaryName);
}

function candidateNames() {
  if (process.platform !== 'win32') {
    return ['codex'];
  }
  const pathExt = String(process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
    .split(';')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return ['codex', ...pathExt.map((ext) => `codex${ext}`)];
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function shellQuote(value) {
  if (process.platform === 'win32') {
    return `"${String(value).replace(/"/g, '\\"')}"`;
  }
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function realPathOrSelf(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function isBundledDependencyPath(filePath) {
  const resolved = realPathOrSelf(filePath);
  const nodeModulesPath = path.join(ROOT_DIR, 'node_modules');
  let bundledPath = '';
  try {
    bundledPath = realPathOrSelf(bundledCodexPath());
  } catch {
    bundledPath = '';
  }
  return (
    (bundledPath && resolved === bundledPath) ||
    resolved === path.resolve(ROOT_DIR, 'node_modules', '.bin', process.platform === 'win32' ? 'codex.cmd' : 'codex') ||
    resolved.startsWith(`${nodeModulesPath}${path.sep}`)
  );
}

function findCodexOnPath() {
  const entries = String(process.env.PATH || '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  for (const entry of entries) {
    for (const name of candidateNames()) {
      const candidate = path.resolve(entry, name);
      if (!isExecutable(candidate) || isBundledDependencyPath(candidate)) {
        continue;
      }
      return candidate;
    }
  }
  return '';
}

export function parseCodexCliVersion(output) {
  const match = String(output || '').match(/(?:codex-cli\s+)?v?(\d+)\.(\d+)\.(\d+)(?:[-+\s]|$)/i);
  if (!match) {
    return '';
  }
  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

export function compareVersions(left, right) {
  const leftParts = String(left || '').split('.').map((part) => Number(part) || 0);
  const rightParts = String(right || '').split('.').map((part) => Number(part) || 0);
  for (let index = 0; index < 3; index += 1) {
    if ((leftParts[index] || 0) > (rightParts[index] || 0)) {
      return 1;
    }
    if ((leftParts[index] || 0) < (rightParts[index] || 0)) {
      return -1;
    }
  }
  return 0;
}

export function isCodexVersionSupported(version) {
  return Boolean(version) && compareVersions(version, MIN_CODEX_CLI_VERSION) >= 0;
}

function readCodexVersionSync(filePath) {
  const output = execFileSync(filePath, ['--version'], {
    encoding: 'utf8',
    timeout: 4000,
    windowsHide: true
  });
  const rawVersion = String(output || '').trim();
  return {
    rawVersion,
    version: parseCodexCliVersion(rawVersion)
  };
}

function explicitCodexPath() {
  const value = String(
    process.env.CODEXMOBILE_CODEX_PATH ||
    process.env.CODEXMOBILE_CODEX_BINARY ||
    process.env.CODEX_BINARY ||
    ''
  ).trim();
  if (value === '~') {
    return os.homedir();
  }
  if (value.startsWith(`~${path.sep}`) || value.startsWith('~/')) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function codexCandidates() {
  const candidates = [];
  const envPath = explicitCodexPath();
  if (envPath) {
    candidates.push({ path: envPath, source: 'env', explicit: true });
  }
  try {
    candidates.push({ path: bundledCodexPath(), source: 'bundled', explicit: false });
  } catch (error) {
    candidates.push({ path: '', source: 'bundled', explicit: false, error: error.message });
  }
  const pathCodex = findCodexOnPath();
  if (pathCodex) {
    candidates.push({ path: pathCodex, source: 'path', explicit: false });
  }
  return candidates;
}

function candidateFailure(candidate, message) {
  const where = candidate.path ? `${candidate.source}:${candidate.path}` : candidate.source;
  return `${where} ${message}`;
}

function inspectCodexCandidate(candidate) {
  if (candidate.error) {
    return {
      ...candidate,
      supported: false,
      reason: candidate.error
    };
  }
  if (!candidate.path) {
    return {
      ...candidate,
      supported: false,
      reason: 'path is empty'
    };
  }
  if (!isExecutable(candidate.path)) {
    return {
      ...candidate,
      supported: false,
      reason: `not executable: ${candidate.path}`
    };
  }
  try {
    const versionInfo = readCodexVersionSync(candidate.path);
    const supported = isCodexVersionSupported(versionInfo.version);
    return {
      ...candidate,
      ...versionInfo,
      minVersion: MIN_CODEX_CLI_VERSION,
      supported,
      reason: supported
        ? ''
        : `requires codex-cli >= ${MIN_CODEX_CLI_VERSION}, found ${versionInfo.rawVersion || 'unknown version'}`
    };
  } catch (error) {
    return {
      ...candidate,
      minVersion: MIN_CODEX_CLI_VERSION,
      supported: false,
      reason: error.message || 'failed to read version'
    };
  }
}

export function resolveCodexExecutable() {
  const failures = [];
  for (const candidate of codexCandidates()) {
    const inspected = inspectCodexCandidate(candidate);
    if (inspected.supported) {
      return {
        path: inspected.path,
        source: inspected.source,
        version: inspected.rawVersion || inspected.version,
        parsedVersion: inspected.version,
        minVersion: MIN_CODEX_CLI_VERSION,
        supported: true
      };
    }
    failures.push(candidateFailure(inspected, inspected.reason));
    if (inspected.explicit) {
      throw new Error(`Configured Codex executable is not usable: ${inspected.reason}. Set codex.path to a ${MIN_CODEX_CLI_VERSION}+ binary, or remove it to use the bundled Codex.`);
    }
  }
  throw new Error(
    `No usable Codex CLI found. CodexMobile requires codex-cli >= ${MIN_CODEX_CLI_VERSION}. Checked: ${failures.join('; ') || 'no candidates'}.`
  );
}

export async function getCodexExecutableInfo() {
  let executable;
  try {
    executable = resolveCodexExecutable();
  } catch (error) {
    return {
      path: '',
      source: 'unavailable',
      version: '',
      minVersion: MIN_CODEX_CLI_VERSION,
      supported: false,
      error: error.message || `Failed to resolve Codex CLI. Install codex-cli >= ${MIN_CODEX_CLI_VERSION}.`,
      installHint: `Install or configure codex-cli >= ${MIN_CODEX_CLI_VERSION}. For a configured binary, check ${shellQuote('codex.path')} in ~/.codex-mobile/config.yaml.`
    };
  }

  return {
    ...executable,
    minVersion: MIN_CODEX_CLI_VERSION,
    supported: true,
    installHint: ''
  };
}
