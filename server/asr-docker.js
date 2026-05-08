import { spawnSync } from 'node:child_process';
import path from 'node:path';

const DEFAULT_CONTAINER = 'codexmobile-sensevoice-asr';
const DEFAULT_IMAGE = 'codexmobile-sensevoice-asr:latest';
const DEFAULT_PORT = '8000';
const STATUS_CACHE_MS = 10_000;

let statusCache = null;

function docker(args, options = {}) {
  return spawnSync('docker', args, {
    encoding: 'utf8',
    windowsHide: true,
    ...options
  });
}

export function asrDockerConfig(env = process.env) {
  const port = String(env.CODEXMOBILE_ASR_PORT || DEFAULT_PORT);
  return {
    containerName: env.CODEXMOBILE_ASR_CONTAINER || DEFAULT_CONTAINER,
    legacyContainerName: env.CODEXMOBILE_ASR_LEGACY_CONTAINER || 'codexmobile-asr',
    image: env.CODEXMOBILE_ASR_IMAGE || DEFAULT_IMAGE,
    port,
    model: env.CODEXMOBILE_TRANSCRIBE_MODEL || 'iic/SenseVoiceSmall',
    device: env.CODEXMOBILE_ASR_DEVICE || 'cpu',
    modelCache: env.CODEXMOBILE_ASR_MODEL_CACHE || path.join(env.CODEXMOBILE_CONFIG_DIR || '', 'model-cache'),
    endpoint: `http://127.0.0.1:${port}/v1/audio/transcriptions`,
    healthUrl: `http://127.0.0.1:${port}/health`
  };
}

function dockerAvailable() {
  const result = docker(['info']);
  return {
    ok: result.status === 0,
    error: result.status === 0 ? '' : `${result.stderr || result.stdout || result.error?.message || 'Docker is not available'}`.trim()
  };
}

function containerExists(name) {
  const result = docker(['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.Names}}']);
  return result.status === 0 && result.stdout.trim() === name;
}

function containerRunning(name) {
  const result = docker(['ps', '--filter', `name=^/${name}$`, '--filter', 'status=running', '--format', '{{.Names}}']);
  return result.status === 0 && result.stdout.trim() === name;
}

async function healthReady(healthUrl) {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1500) });
    if (!response.ok) {
      return false;
    }
    const json = await response.json().catch(() => null);
    return Boolean(json?.ready ?? json?.ok ?? true);
  } catch {
    return false;
  }
}

export async function asrDockerStatus({ force = false } = {}) {
  const now = Date.now();
  if (!force && statusCache && now - statusCache.checkedAt < STATUS_CACHE_MS) {
    return statusCache.status;
  }

  const config = asrDockerConfig();
  const dockerInfo = dockerAvailable();
  let installed = false;
  let running = false;
  if (dockerInfo.ok) {
    installed = containerExists(config.containerName);
    running = installed && containerRunning(config.containerName);
  }
  const ready = running ? await healthReady(config.healthUrl) : false;
  const status = {
    provider: 'sensevoice-docker',
    containerName: config.containerName,
    image: config.image,
    endpoint: config.endpoint,
    healthUrl: config.healthUrl,
    dockerAvailable: dockerInfo.ok,
    installed,
    running,
    ready,
    configured: ready,
    error: dockerInfo.ok ? '' : dockerInfo.error
  };
  statusCache = { checkedAt: now, status };
  return status;
}
