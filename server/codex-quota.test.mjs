import assert from 'node:assert/strict';
import test from 'node:test';
import { quotaTestHooks } from './codex-quota.js';

test('quota error messages distinguish common network and auth failures', () => {
  assert.equal(
    quotaTestHooks.safeErrorMessage({ cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }),
    '网络超时，稍后重试'
  );
  assert.equal(
    quotaTestHooks.safeErrorMessage({ cause: { code: 'ECONNREFUSED' } }),
    '本地代理或管理服务未启动'
  );
  assert.equal(
    quotaTestHooks.safeErrorMessage({ statusCode: 401 }),
    '凭证已过期，请重新登录 Codex'
  );
  assert.equal(
    quotaTestHooks.safeErrorMessage({ statusCode: 429 }),
    '额度接口限流，稍后重试'
  );
});

test('quota proxy helpers read macOS HTTPS proxy settings', () => {
  assert.equal(quotaTestHooks.normalizeProxyUrl('127.0.0.1:10900'), 'http://127.0.0.1:10900');
  assert.equal(quotaTestHooks.normalizeProxyUrl('direct'), '');
  assert.equal(
    quotaTestHooks.proxyUrlFromScutilOutput(`
      HTTPSEnable : 1
      HTTPSProxy : 127.0.0.1
      HTTPSPort : 10900
    `),
    'http://127.0.0.1:10900'
  );
  assert.equal(
    quotaTestHooks.proxyUrlFromScutilOutput(`
      HTTPSEnable : 0
      HTTPSProxy : 127.0.0.1
      HTTPSPort : 10900
    `),
    ''
  );
});

test('quota result falls back to recent successful data when all accounts fail', () => {
  quotaTestHooks.resetQuotaCache();
  const fresh = quotaTestHooks.finalizeQuotaResult({
    provider: 'codex',
    source: 'local-auth',
    accounts: [
      {
        id: 'account-1',
        label: 'C***',
        status: 'ok',
        windows: [{ id: 'weekly', label: '周限额', remainingPercent: 80 }]
      }
    ]
  });
  assert.equal(fresh.stale, false);

  const fallback = quotaTestHooks.finalizeQuotaResult({
    provider: 'codex',
    source: 'local-auth',
    accounts: [
      {
        id: 'account-1',
        label: 'C***',
        status: 'failed',
        error: '网络超时，稍后重试',
        windows: []
      }
    ]
  });
  assert.equal(fallback.stale, true);
  assert.equal(fallback.source, 'local-auth-cache');
  assert.equal(fallback.staleReason, '网络超时，稍后重试');
  assert.equal(fallback.accounts[0].status, 'ok');
});

test('quota cache decoration exposes update metadata', () => {
  const result = quotaTestHooks.decorateCachedQuotaResult({
    provider: 'codex',
    source: 'local-auth',
    fetchedAt: '2026-05-08T10:00:00.000Z',
    accounts: []
  }, 'scheduled');
  assert.equal(result.updatedAt, '2026-05-08T10:00:00.000Z');
  assert.equal(result.cacheReason, 'scheduled');
  assert.match(result.cacheUpdatedAt, /^\d{4}-\d{2}-\d{2}T/);
});
