import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const moduleRequire = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

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

export function resolveCodexExecutable() {
  const pathCodex = findCodexOnPath();
  if (pathCodex) {
    return {
      path: pathCodex,
      source: 'path'
    };
  }
  const envPath = String(process.env.CODEXMOBILE_CODEX_PATH || '').trim();
  if (envPath) {
    return {
      path: envPath,
      source: 'env'
    };
  }
  return {
    path: bundledCodexPath(),
    source: 'bundled'
  };
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
      error: error.message || 'Codex executable not found'
    };
  }

  try {
    const { stdout, stderr } = await execFileAsync(executable.path, ['--version'], {
      timeout: 4000,
      windowsHide: true
    });
    return {
      ...executable,
      version: String(stdout || stderr || '').trim()
    };
  } catch (error) {
    return {
      ...executable,
      version: '',
      error: error.message || 'Failed to read Codex version'
    };
  }
}
