import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { messagesFromDesktopThread, messagesFromLocalSessionFile } from './codex-data.js';

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

test('messagesFromDesktopThread hides synthetic AGENTS instructions user messages', () => {
  const messages = messagesFromDesktopThread({
    id: 'thread-1',
    turns: [
      {
        id: 'turn-1',
        status: 'completed',
        startedAt: 1770000000,
        completedAt: 1770000003,
        items: [
          {
            id: 'agents-1',
            type: 'userMessage',
            content: [
              {
                type: 'text',
                text: '# AGENTS.md instructions for /home/zhangcheng/Work/drpp\n\n本仓库使用分层 AGENTS.md。'
              }
            ]
          },
          { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: '测试一下' }] },
          { id: 'answer-1', type: 'agentMessage', phase: 'final_answer', text: '收到' }
        ]
      }
    ]
  });

  assert.deepEqual(messages.map((message) => message.content), ['测试一下', '收到']);
});

test('messagesFromLocalSessionFile exposes patch changes as a diff message after final answer', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-session-'));
  const filePath = path.join(dir, 'rollout.jsonl');
  const cwd = path.join(dir, 'project');
  await fs.mkdir(cwd);
  await fs.writeFile(filePath, [
    JSON.stringify({ timestamp: '2026-05-08T00:00:00.000Z', type: 'session_meta', payload: { id: 'session-1', cwd } }),
    JSON.stringify({ timestamp: '2026-05-08T00:00:01.000Z', type: 'turn_context', payload: { turn_id: 'turn-1', cwd } }),
    JSON.stringify({
      timestamp: '2026-05-08T00:00:02.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '修一下' }] }
    }),
    JSON.stringify({
      timestamp: '2026-05-08T00:00:03.000Z',
      type: 'event_msg',
      payload: {
        type: 'patch_apply_end',
        turn_id: 'turn-1',
        changes: {
          [path.join(cwd, 'server/index.js')]: {
            type: 'update',
            unified_diff: '@@ -1 +1 @@\n-old\n+new\n'
          }
        }
      }
    }),
    JSON.stringify({
      timestamp: '2026-05-08T00:00:04.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: '改好了' }] }
    })
  ].join('\n'), 'utf8');

  const messages = await messagesFromLocalSessionFile({ id: 'session-1', cwd, filePath });

  assert.deepEqual(messages.map((message) => message.role), ['user', 'assistant', 'diff']);
  assert.equal(messages[2].fileChanges[0].path, 'server/index.js');
  assert.equal(messages[2].fileChanges[0].additions, 1);
  assert.equal(messages[2].fileChanges[0].deletions, 1);
});

test('messagesFromLocalSessionFile hides synthetic AGENTS instructions user messages', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'codexmobile-session-'));
  const filePath = path.join(dir, 'rollout.jsonl');
  const cwd = path.join(dir, 'project');
  await fs.mkdir(cwd);
  await fs.writeFile(filePath, [
    JSON.stringify({ timestamp: '2026-05-08T00:00:00.000Z', type: 'session_meta', payload: { id: 'session-1', cwd } }),
    JSON.stringify({ timestamp: '2026-05-08T00:00:01.000Z', type: 'turn_context', payload: { turn_id: 'turn-1', cwd } }),
    JSON.stringify({
      timestamp: '2026-05-08T00:00:02.000Z',
      type: 'response_item',
      payload: {
        type: 'message',
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: '# AGENTS.md instructions for /home/zhangcheng/Work/drpp\n\n本仓库使用分层 AGENTS.md。'
          }
        ]
      }
    }),
    JSON.stringify({
      timestamp: '2026-05-08T00:00:03.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '测试一下' }] }
    }),
    JSON.stringify({
      timestamp: '2026-05-08T00:00:04.000Z',
      type: 'response_item',
      payload: { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: '收到' }] }
    })
  ].join('\n'), 'utf8');

  const messages = await messagesFromLocalSessionFile({ id: 'session-1', cwd, filePath });

  assert.deepEqual(messages.map((message) => message.content), ['测试一下', '收到']);
});
