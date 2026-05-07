import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createStaticService } from './static-service.js';

function req(headers = {}) {
  return { headers };
}

function res() {
  return {
    statusCode: null,
    headers: null,
    body: Buffer.alloc(0),
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = headers;
    },
    end(body = '') {
      this.body = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    }
  };
}

async function withTempService(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-static-'));
  const clientDist = path.join(root, 'dist');
  const generatedRoot = path.join(root, 'generated');
  const certPath = path.join(root, 'tls', 'root.cer');
  await fs.mkdir(clientDist, { recursive: true });
  await fs.mkdir(generatedRoot, { recursive: true });
  await fs.mkdir(path.dirname(certPath), { recursive: true });
  await fs.writeFile(path.join(clientDist, 'index.html'), '<h1>CodexMobile</h1>');
  await fs.writeFile(path.join(generatedRoot, 'image.png'), Buffer.from([137, 80, 78, 71]));
  await fs.writeFile(path.join(root, 'secret.txt'), 'secret');
  await fs.writeFile(certPath, 'cert');
  try {
    await fn(createStaticService({ clientDist, generatedRoot, httpsRootCaPath: certPath }));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test('serveStatic returns a normal PWA file', async () => {
  await withTempService(async (service) => {
    const response = res();
    await service.serveStatic(req(), response, new URL('http://local/'));

    assert.equal(response.statusCode, 200);
    assert.match(response.headers['content-type'], /text\/html/);
    assert.equal(response.body.toString('utf8'), '<h1>CodexMobile</h1>');
  });
});

test('serveStatic blocks traversal outside the PWA root', async () => {
  await withTempService(async (service) => {
    const response = res();
    await service.serveStatic(req(), response, new URL('http://local/..%2fsecret.txt'));

    assert.equal(response.statusCode, 403);
    assert.equal(response.body.toString('utf8'), 'Forbidden');
  });
});

test('serveStatic returns generated files from the generated root', async () => {
  await withTempService(async (service) => {
    const response = res();
    await service.serveStatic(req(), response, new URL('http://local/generated/image.png'));

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['content-type'], 'image/png');
    assert.deepEqual([...response.body], [137, 80, 78, 71]);
  });
});
