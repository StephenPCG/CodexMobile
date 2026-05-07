import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applySessionRenameToProjectSessions,
  desktopThreadHasAssistantAfterLocalSend,
  desktopThreadHasAssistantAfterPendingSend,
  mergeLiveSelectedThreadMessages,
  shouldPollSelectedSessionMessages
} from './session-live-refresh.js';

test('shouldPollSelectedSessionMessages keeps normal running sessions protected', () => {
  assert.equal(
    shouldPollSelectedSessionMessages({
      hasSelectedRunning: true,
      desktopBridge: { connected: true, mode: 'desktop-proxy' }
    }),
    false
  );
});

test('shouldPollSelectedSessionMessages allows desktop-ipc running sessions to refresh', () => {
  assert.equal(
    shouldPollSelectedSessionMessages({
      hasSelectedRunning: true,
      desktopBridge: { connected: true, mode: 'desktop-ipc' },
      hasExternalThreadRefresh: true
    }),
    true
  );
});

test('shouldPollSelectedSessionMessages protects local streaming runs when desktop-ipc is only a global bridge', () => {
  assert.equal(
    shouldPollSelectedSessionMessages({
      hasSelectedRunning: true,
      desktopBridge: { connected: true, mode: 'desktop-ipc' },
      hasExternalThreadRefresh: false
    }),
    false
  );
});

test('mergeLiveSelectedThreadMessages preserves local pending send until desktop thread contains it', () => {
  const current = [
    { id: 'old-user', role: 'user', content: '之前的问题', timestamp: '2026-05-07T06:00:00.000Z' },
    { id: 'old-assistant', role: 'assistant', content: '之前的回答', timestamp: '2026-05-07T06:00:01.000Z' },
    { id: 'local-1', role: 'user', content: '手机刚发的新消息', timestamp: '2026-05-07T06:01:00.000Z' },
    { id: 'status-1', role: 'activity', status: 'running', content: '已交给桌面端处理', timestamp: '2026-05-07T06:01:00.000Z' }
  ];
  const loaded = current.slice(0, 2);

  const merged = mergeLiveSelectedThreadMessages(current, loaded);

  assert.deepEqual(merged.map((message) => message.id), ['old-user', 'old-assistant', 'local-1', 'status-1']);
});

test('mergeLiveSelectedThreadMessages switches to desktop messages once the desktop thread catches up', () => {
  const current = [
    { id: 'old-user', role: 'user', content: '之前的问题', timestamp: '2026-05-07T06:00:00.000Z' },
    { id: 'local-1', role: 'user', content: '手机刚发的新消息', timestamp: '2026-05-07T06:01:00.000Z' },
    { id: 'status-1', role: 'activity', status: 'running', content: '已交给桌面端处理', timestamp: '2026-05-07T06:01:00.000Z' }
  ];
  const loaded = [
    { id: 'old-user', role: 'user', content: '之前的问题', timestamp: '2026-05-07T06:00:00.000Z' },
    { id: 'desktop-user', role: 'user', content: '手机刚发的新消息', timestamp: '2026-05-07T06:01:00.000Z' },
    { id: 'desktop-activity', role: 'activity', status: 'running', content: '正在处理本地任务', timestamp: '2026-05-07T06:01:01.000Z' }
  ];

  const merged = mergeLiveSelectedThreadMessages(current, loaded);

  assert.deepEqual(merged.map((message) => message.id), ['old-user', 'desktop-user', 'desktop-activity']);
});

test('desktopThreadHasAssistantAfterLocalSend detects final desktop output for the pending mobile send', () => {
  const current = [
    { id: 'local-1', role: 'user', content: '手机刚发的新消息', timestamp: '2026-05-07T06:01:00.000Z' },
    { id: 'status-1', role: 'activity', status: 'running', content: '已交给桌面端处理', timestamp: '2026-05-07T06:01:00.000Z' }
  ];
  const loaded = [
    { id: 'desktop-user', role: 'user', content: '手机刚发的新消息', timestamp: '2026-05-07T06:01:00.000Z' },
    { id: 'desktop-assistant', role: 'assistant', content: '桌面端实时结果', timestamp: '2026-05-07T06:01:05.000Z' }
  ];

  assert.equal(desktopThreadHasAssistantAfterLocalSend(current, loaded), true);
});

test('desktopThreadHasAssistantAfterPendingSend still detects completion after local pending UI was replaced', () => {
  const pending = {
    message: '我退出重进了 现在再测试一下',
    startedAt: '2026-05-07T06:48:00.000Z'
  };
  const loaded = [
    { id: 'previous-assistant', role: 'assistant', content: '之前的回答', timestamp: '2026-05-07T06:47:00.000Z' },
    { id: 'desktop-user', role: 'user', content: '我退出重进了 现在再测试一下', timestamp: '2026-05-07T06:48:00.000Z' },
    { id: 'desktop-activity', role: 'activity', status: 'completed', content: '已处理 23s', timestamp: '2026-05-07T06:48:10.000Z' },
    { id: 'desktop-assistant', role: 'assistant', content: '后台正常', timestamp: '2026-05-07T06:48:23.000Z' }
  ];

  assert.equal(desktopThreadHasAssistantAfterPendingSend(pending, loaded), true);
});

test('applySessionRenameToProjectSessions patches the loaded sidebar session in place', () => {
  const current = {
    projectA: [
      { id: 'thread-1', projectId: 'projectA', title: '旧标题', titleLocked: false, messageCount: 2 },
      { id: 'thread-2', projectId: 'projectA', title: '别的线程', titleLocked: false, messageCount: 1 }
    ]
  };

  const next = applySessionRenameToProjectSessions(current, {
    type: 'session-renamed',
    projectId: 'projectA',
    sessionId: 'thread-1',
    title: '新标题',
    titleLocked: true
  });

  assert.deepEqual(next.projectA.map((session) => session.title), ['新标题', '别的线程']);
  assert.equal(next.projectA[0].messageCount, 2);
  assert.equal(next.projectA[0].titleLocked, true);
});

test('applySessionRenameToProjectSessions can insert a renamed session from a full payload', () => {
  const next = applySessionRenameToProjectSessions({}, {
    type: 'session-renamed',
    projectId: 'projectA',
    sessionId: 'thread-1',
    title: '新标题',
    session: { id: 'thread-1', projectId: 'projectA', title: '新标题', messageCount: 3 }
  });

  assert.deepEqual(next.projectA, [
    { id: 'thread-1', projectId: 'projectA', title: '新标题', messageCount: 3, titleLocked: true }
  ]);
});
