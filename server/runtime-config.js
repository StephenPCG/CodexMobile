import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.codex-mobile');
export const DEFAULT_CONFIG_PATH = path.join(DEFAULT_CONFIG_DIR, 'config.yaml');
export const DEFAULT_LOG_DIR = path.join(DEFAULT_CONFIG_DIR, 'logs');
export const DEFAULT_STATE_DIR = path.join(DEFAULT_CONFIG_DIR, 'state');
export const DEFAULT_UPLOAD_DIR = path.join(DEFAULT_CONFIG_DIR, 'uploads');
export const DEFAULT_GENERATED_DIR = path.join(DEFAULT_CONFIG_DIR, 'generated');

export const DEFAULT_CONFIG_YAML = `# CodexMobile config
# Environment variables still override values in this file.

server:
  host: 0.0.0.0
  port: 3321
  httpsPort: 3443

# publicUrl: https://your-device.your-tailnet.ts.net/
# pairingCode: "123456"

codex:
  home: ~/.codex
  # path: /opt/homebrew/bin/codex
  # transport: auto
  # worktreeRoot: ~/.codex/worktrees/codexmobile

paths:
  state: ~/.codex-mobile/state
  uploads: ~/.codex-mobile/uploads
  generated: ~/.codex-mobile/generated
  logs: ~/.codex-mobile/logs

# feishu:
#   appId: cli_xxx
#   appSecret: ""
#   redirectUri: https://your-device.your-tailnet.ts.net/api/feishu/auth/callback
#   docsUrl: https://docs.feishu.cn/

# cliproxy:
#   config: ~/.cli-proxy-api/config.yaml
#   apiKey: ""
#   managementUrl: http://127.0.0.1:8317
#   managementKey: ""

# Extra legacy env names can live here when no friendly key exists yet.
# env:
#   CODEXMOBILE_REALTIME_PROVIDER: dashscope
#   CODEXMOBILE_REALTIME_API_KEY: ""
`;

const CONFIG_ENV_MAPPINGS = [
  ['server.host', 'HOST'],
  ['host', 'HOST'],
  ['server.port', 'PORT'],
  ['port', 'PORT'],
  ['server.httpsPort', 'HTTPS_PORT'],
  ['https.port', 'HTTPS_PORT'],
  ['httpsPort', 'HTTPS_PORT'],
  ['https.pfxPath', 'HTTPS_PFX_PATH'],
  ['https.rootCaPath', 'HTTPS_ROOT_CA_PATH'],
  ['https.pfxPassphrase', 'HTTPS_PFX_PASSPHRASE'],
  ['publicUrl', 'CODEXMOBILE_PUBLIC_URL'],
  ['pairingCode', 'CODEXMOBILE_PAIRING_CODE'],
  ['paths.state', 'CODEXMOBILE_HOME'],
  ['paths.uploads', 'CODEXMOBILE_UPLOAD_ROOT'],
  ['paths.generated', 'CODEXMOBILE_GENERATED_ROOT'],
  ['paths.logs', 'CODEXMOBILE_LOG_DIR'],
  ['codex.home', 'CODEX_HOME'],
  ['codex.path', 'CODEXMOBILE_CODEX_PATH'],
  ['codex.transport', 'CODEXMOBILE_CODEX_TRANSPORT'],
  ['codex.worktreeRoot', 'CODEXMOBILE_WORKTREE_ROOT'],
  ['codex.allowIsolated', 'CODEXMOBILE_ALLOW_ISOLATED_CODEX'],
  ['codex.preferHeadless', 'CODEXMOBILE_PREFER_HEADLESS_CODEX'],
  ['sessions.includeLocalLogs', 'CODEXMOBILE_INCLUDE_LOCAL_SESSION_LOGS'],
  ['sessions.showProjectless', 'CODEXMOBILE_SHOW_PROJECTLESS_SESSIONS'],
  ['sessions.includeMissingSubagents', 'CODEXMOBILE_INCLUDE_MISSING_SUBAGENT_THREADS'],
  ['feishu.appId', 'CODEXMOBILE_FEISHU_APP_ID'],
  ['feishu.appSecret', 'CODEXMOBILE_FEISHU_APP_SECRET'],
  ['feishu.redirectUri', 'CODEXMOBILE_FEISHU_REDIRECT_URI'],
  ['feishu.docsUrl', 'CODEXMOBILE_FEISHU_DOCS_URL'],
  ['cliproxy.config', 'CLIPROXYAPI_CONFIG'],
  ['cliproxy.apiKey', 'CLIPROXYAPI_API_KEY'],
  ['cliproxy.managementUrl', 'CODEXMOBILE_CLIPROXY_MANAGEMENT_URL'],
  ['cliproxy.managementKey', 'CODEXMOBILE_CLIPROXY_MANAGEMENT_KEY'],
  ['voice.transcribe.baseUrl', 'CODEXMOBILE_TRANSCRIBE_BASE_URL'],
  ['voice.transcribe.apiKey', 'CODEXMOBILE_TRANSCRIBE_API_KEY'],
  ['voice.transcribe.model', 'CODEXMOBILE_TRANSCRIBE_MODEL'],
  ['voice.speech.baseUrl', 'CODEXMOBILE_SPEECH_BASE_URL'],
  ['voice.speech.apiKey', 'CODEXMOBILE_SPEECH_API_KEY'],
  ['voice.speech.model', 'CODEXMOBILE_SPEECH_MODEL'],
  ['voice.speech.voice', 'CODEXMOBILE_SPEECH_VOICE'],
  ['voice.realtime.provider', 'CODEXMOBILE_REALTIME_PROVIDER'],
  ['voice.realtime.baseUrl', 'CODEXMOBILE_REALTIME_BASE_URL'],
  ['voice.realtime.apiKey', 'CODEXMOBILE_REALTIME_API_KEY'],
  ['voice.realtime.model', 'CODEXMOBILE_REALTIME_MODEL'],
  ['voice.realtime.voice', 'CODEXMOBILE_REALTIME_VOICE'],
  ['image.baseUrl', 'CODEXMOBILE_IMAGE_BASE_URL'],
  ['image.apiKey', 'CODEXMOBILE_IMAGE_API_KEY'],
  ['image.model', 'CODEXMOBILE_IMAGE_MODEL'],
  ['asr.port', 'CODEXMOBILE_ASR_PORT'],
  ['asr.model', 'CODEXMOBILE_TRANSCRIBE_MODEL'],
  ['asr.device', 'CODEXMOBILE_ASR_DEVICE']
];

function stripInlineComment(value) {
  let quote = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if ((char === '"' || char === "'") && value[index - 1] !== '\\') {
      quote = quote === char ? '' : quote || char;
    }
    if (!quote && char === '#' && /\s/.test(value[index - 1] || '')) {
      return value.slice(0, index).trimEnd();
    }
  }
  return value;
}

function parseScalar(value) {
  const raw = stripInlineComment(String(value || '').trim());
  if (!raw) {
    return '';
  }
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    return raw.slice(1, -1);
  }
  if (/^(true|false)$/i.test(raw)) {
    return /^true$/i.test(raw);
  }
  if (/^(null|~)$/i.test(raw)) {
    return '';
  }
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    return Number(raw);
  }
  if (raw.startsWith('[') && raw.endsWith(']')) {
    return raw
      .slice(1, -1)
      .split(',')
      .map((item) => parseScalar(item))
      .filter((item) => item !== '');
  }
  return raw;
}

export function parseYamlConfig(text) {
  const root = {};
  const stack = [{ indent: -1, value: root }];
  const lines = String(text || '').split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim() || line.trimStart().startsWith('#')) {
      continue;
    }
    const match = line.match(/^(\s*)([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!match) {
      continue;
    }
    const indent = match[1].replace(/\t/g, '  ').length;
    const key = match[2];
    const rawValue = match[3] || '';
    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].value;
    if (!rawValue.trim()) {
      const child = {};
      parent[key] = child;
      stack.push({ indent, value: child });
    } else {
      parent[key] = parseScalar(rawValue);
    }
  }

  return root;
}

export function expandHome(value) {
  const text = String(value || '');
  if (text === '~') {
    return os.homedir();
  }
  if (text.startsWith('~/') || text.startsWith('~\\')) {
    return path.join(os.homedir(), text.slice(2));
  }
  return text;
}

function configPathFromEnv(env = process.env) {
  return path.resolve(expandHome(env.CODEXMOBILE_CONFIG_PATH || DEFAULT_CONFIG_PATH));
}

function readPath(config, dottedPath) {
  let cursor = config;
  for (const part of dottedPath.split('.')) {
    if (!cursor || typeof cursor !== 'object' || !Object.prototype.hasOwnProperty.call(cursor, part)) {
      return undefined;
    }
    cursor = cursor[part];
  }
  return cursor;
}

function setEnvDefault(env, key, value) {
  if (env[key] !== undefined || value === undefined || value === null || value === '') {
    return;
  }
  env[key] = typeof value === 'boolean' ? (value ? '1' : '0') : String(value);
}

function setPathEnvDefault(env, key, value) {
  if (env[key] !== undefined || value === undefined || value === null || value === '') {
    return;
  }
  env[key] = path.resolve(expandHome(value));
}

export function ensureCodexMobileConfig({ configPath = configPathFromEnv(), create = false } = {}) {
  if (!create || fs.existsSync(configPath)) {
    return configPath;
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, DEFAULT_CONFIG_YAML, 'utf8');
  return configPath;
}

export function loadCodexMobileConfig({ configPath = configPathFromEnv(), create = false, env = process.env } = {}) {
  const resolvedConfigPath = ensureCodexMobileConfig({ configPath, create });
  let config = {};
  try {
    if (fs.existsSync(resolvedConfigPath)) {
      config = parseYamlConfig(fs.readFileSync(resolvedConfigPath, 'utf8'));
    }
  } catch (error) {
    console.warn(`[config] Failed to read ${resolvedConfigPath}: ${error.message}`);
  }

  setPathEnvDefault(env, 'CODEXMOBILE_CONFIG_PATH', resolvedConfigPath);
  setPathEnvDefault(env, 'CODEXMOBILE_CONFIG_DIR', path.dirname(resolvedConfigPath));
  setPathEnvDefault(env, 'CODEXMOBILE_LOG_DIR', readPath(config, 'paths.logs') || DEFAULT_LOG_DIR);
  setPathEnvDefault(env, 'CODEXMOBILE_HOME', readPath(config, 'paths.state') || DEFAULT_STATE_DIR);
  setPathEnvDefault(env, 'CODEXMOBILE_UPLOAD_ROOT', readPath(config, 'paths.uploads') || DEFAULT_UPLOAD_DIR);
  setPathEnvDefault(env, 'CODEXMOBILE_GENERATED_ROOT', readPath(config, 'paths.generated') || DEFAULT_GENERATED_DIR);

  for (const [configKey, envKey] of CONFIG_ENV_MAPPINGS) {
    const value = readPath(config, configKey);
    if (/_(PATH|ROOT|HOME|DIR)$/.test(envKey) || envKey === 'CLIPROXYAPI_CONFIG') {
      setPathEnvDefault(env, envKey, value);
    } else {
      setEnvDefault(env, envKey, value);
    }
  }

  const extraEnv = readPath(config, 'env');
  if (extraEnv && typeof extraEnv === 'object' && !Array.isArray(extraEnv)) {
    for (const [key, value] of Object.entries(extraEnv)) {
      if (/^[A-Z_][A-Z0-9_]*$/.test(key)) {
        setEnvDefault(env, key, value);
      }
    }
  }

  return {
    config,
    configPath: resolvedConfigPath,
    configDir: path.dirname(resolvedConfigPath),
    logDir: env.CODEXMOBILE_LOG_DIR
  };
}
