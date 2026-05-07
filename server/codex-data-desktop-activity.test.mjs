import assert from 'node:assert/strict';
import test from 'node:test';
import { messagesFromDesktopThread } from './codex-data.js';

test('messagesFromDesktopThread preserves running desktop file activity', () => {
  const messages = messagesFromDesktopThread({
    id: 'thread-1',
    turns: [
      {
        id: 'turn-1',
        status: 'running',
        startedAt: 1770000000,
        items: [
          { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: '修一下 UI' }] },
          {
            id: 'file-1',
            type: 'fileChange',
            status: 'running',
            changes: [{ path: '/tmp/App.jsx', kind: 'update', unified_diff: '+ok\n' }]
          }
        ]
      }
    ]
  }, { includeActivity: true });

  const activityMessage = messages.find((message) => message.role === 'activity');
  assert.equal(activityMessage.status, 'running');
  assert.equal(activityMessage.activities[0].kind, 'file_change');
  assert.equal(activityMessage.activities[0].status, 'running');
  assert.equal(activityMessage.activities[0].label, '正在更新文件');
});

test('messagesFromDesktopThread uses mobile labels for completed desktop command activity', () => {
  const messages = messagesFromDesktopThread({
    id: 'thread-1',
    turns: [
      {
        id: 'turn-1',
        status: 'completed',
        startedAt: 1770000000,
        completedAt: 1770000003,
        items: [
          { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: '跑测试' }] },
          {
            id: 'cmd-1',
            type: 'commandExecution',
            status: 'completed',
            command: 'npm test',
            aggregatedOutput: 'ok'
          },
          { id: 'answer-1', type: 'agentMessage', phase: 'final_answer', text: '测试通过' }
        ]
      }
    ]
  }, { includeActivity: true });

  const activityMessage = messages.find((message) => message.role === 'activity');
  assert.equal(activityMessage.status, 'completed');
  assert.equal(activityMessage.activities[0].kind, 'command_execution');
  assert.equal(activityMessage.activities[0].status, 'completed');
  assert.equal(activityMessage.activities[0].label, '本地任务已处理');
});
