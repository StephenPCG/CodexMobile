import fs from 'node:fs/promises';
import { CODEX_CONFIG_PATH } from './codex-config.js';

export const DEFAULT_OPENAI_COMPATIBLE_BASE_URL = '';

function stripQuotes(value) {
  const trimmed = String(value || '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function normalizeBaseUrl(value, fallback = DEFAULT_OPENAI_COMPATIBLE_BASE_URL) {
  return String(value || fallback).replace(/\/+$/, '');
}

export async function readCodexProviderBaseUrl() {
  let raw = '';
  try {
    raw = await fs.readFile(CODEX_CONFIG_PATH, 'utf8');
  } catch {
    return null;
  }

  let provider = '';
  let currentProvider = null;
  const baseUrls = new Map();

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }
    const providerMatch = line.match(/^\[model_providers\.(?:'([^']+)'|"([^"]+)"|([^\]]+))\]$/);
    if (providerMatch) {
      currentProvider = stripQuotes(providerMatch[1] || providerMatch[2] || providerMatch[3]);
      continue;
    }
    if (line.startsWith('[')) {
      currentProvider = null;
      continue;
    }
    const assignment = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!assignment) {
      continue;
    }
    const key = assignment[1];
    const value = stripQuotes(assignment[2]);
    if (!currentProvider && key === 'model_provider') {
      provider = value;
    } else if (currentProvider && key === 'base_url') {
      baseUrls.set(currentProvider, value);
    }
  }

  return baseUrls.get(provider) || null;
}

export async function readOpenAICompatibleApiKeys(extraKeys = []) {
  const keys = [
    ...extraKeys,
    process.env.CODEXMOBILE_OPENAI_COMPATIBLE_API_KEY
  ].filter(Boolean);

  if (process.env.OPENAI_API_KEY && !keys.includes(process.env.OPENAI_API_KEY)) {
    keys.push(process.env.OPENAI_API_KEY);
  }

  return keys;
}

export async function openAICompatibleConfig({
  baseUrl,
  defaultBaseUrl = DEFAULT_OPENAI_COMPATIBLE_BASE_URL,
  apiKeys = []
} = {}) {
  const resolvedBaseUrl = baseUrl || (await readCodexProviderBaseUrl()) || defaultBaseUrl;
  return {
    baseUrl: normalizeBaseUrl(resolvedBaseUrl, defaultBaseUrl),
    apiKeys: await readOpenAICompatibleApiKeys(apiKeys)
  };
}
