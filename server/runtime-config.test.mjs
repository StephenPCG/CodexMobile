import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadCodexMobileConfig, parseYamlConfig } from './runtime-config.js';

test('parseYamlConfig reads nested deployment config', () => {
  const parsed = parseYamlConfig(`
server:
  host: 127.0.0.1
  port: 4000
publicUrl: https://codex-mobile.example.test/
codex:
  path: ~/bin/codex
env:
  CODEXMOBILE_REALTIME_PROVIDER: dashscope
`);

  assert.equal(parsed.server.host, '127.0.0.1');
  assert.equal(parsed.server.port, 4000);
  assert.equal(parsed.publicUrl, 'https://codex-mobile.example.test/');
  assert.equal(parsed.codex.path, '~/bin/codex');
  assert.equal(parsed.env.CODEXMOBILE_REALTIME_PROVIDER, 'dashscope');
});

test('loadCodexMobileConfig maps yaml keys to env without overriding explicit env', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexmobile-config-'));
  const configPath = path.join(dir, 'config.yaml');
  fs.writeFileSync(configPath, `
server:
  port: 4000
paths:
  state: ${dir}/state
codex:
  path: ${dir}/codex
`, 'utf8');
  const env = {
    PORT: '9999'
  };

  const result = loadCodexMobileConfig({
    configPath,
    create: false,
    env
  });

  assert.equal(result.configPath, configPath);
  assert.equal(env.PORT, '9999');
  assert.equal(env.CODEXMOBILE_CONFIG_DIR, dir);
  assert.equal(env.CODEXMOBILE_HOME, path.join(dir, 'state'));
  assert.equal(env.CODEXMOBILE_CODEX_PATH, path.join(dir, 'codex'));
});
