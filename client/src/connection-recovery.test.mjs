import assert from 'node:assert/strict';
import test from 'node:test';
import { connectionRecoveryState } from './connection-recovery.js';

test('connectionRecoveryState maps connection states to recovery cards', () => {
  assert.equal(connectionRecoveryState({ authenticated: false }).state, 'pairing');
  assert.equal(connectionRecoveryState({ connectionState: 'connecting' }).state, 'reconnecting');
  assert.equal(connectionRecoveryState({ connectionState: 'disconnected' }).state, 'disconnected');
});

test('connectionRecoveryState stays quiet for background sync and desktop bridge state', () => {
  assert.deepEqual(
    connectionRecoveryState({
      connectionState: 'connected',
      desktopBridge: { mode: 'desktop-ipc', connected: true }
    }),
    null
  );
  assert.equal(
    connectionRecoveryState({
      connectionState: 'connected',
      desktopBridge: { mode: 'desktop-ipc', connected: false, reason: 'not open' }
    }),
    null
  );
  assert.equal(connectionRecoveryState({ connectionState: 'connected', syncing: true }), null);
});
