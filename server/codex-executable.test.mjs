import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  MIN_CODEX_CLI_VERSION,
  compareVersions,
  getCodexExecutableInfo,
  isCodexVersionSupported,
  parseCodexCliVersion,
  resolveCodexExecutable
} from './codex-executable.js';

test('parses and compares codex-cli versions', () => {
  assert.equal(MIN_CODEX_CLI_VERSION, '0.130.0');
  assert.equal(parseCodexCliVersion('codex-cli 0.130.0'), '0.130.0');
  assert.equal(parseCodexCliVersion('codex-cli v0.131.2-linux-x64'), '0.131.2');
  assert.equal(compareVersions('0.130.0', '0.129.9'), 1);
  assert.equal(compareVersions('0.130.0', '0.130.0'), 0);
  assert.equal(compareVersions('0.129.9', '0.130.0'), -1);
  assert.equal(isCodexVersionSupported('0.130.0'), true);
  assert.equal(isCodexVersionSupported('0.129.9'), false);
});

test('explicit codex.path must satisfy the minimum version', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'codexmobile-codex-'));
  const fakeCodex = path.join(dir, process.platform === 'win32' ? 'codex.cmd' : 'codex');
  const script = process.platform === 'win32'
    ? '@echo off\r\necho codex-cli 0.129.0\r\n'
    : '#!/bin/sh\necho codex-cli 0.129.0\n';
  fs.writeFileSync(fakeCodex, script, 'utf8');
  fs.chmodSync(fakeCodex, 0o755);
  const previous = process.env.CODEXMOBILE_CODEX_PATH;
  process.env.CODEXMOBILE_CODEX_PATH = fakeCodex;
  try {
    assert.throws(
      () => resolveCodexExecutable(),
      /requires codex-cli >= 0\.130\.0|Configured Codex executable/
    );
  } finally {
    if (previous === undefined) {
      delete process.env.CODEXMOBILE_CODEX_PATH;
    } else {
      process.env.CODEXMOBILE_CODEX_PATH = previous;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('default resolved Codex is usable for app-server integration', async () => {
  const info = await getCodexExecutableInfo();
  assert.equal(info.supported, true);
  assert.match(info.version, /codex-cli 0\.13\d+\.\d+/);
  assert.ok(info.path);
});
