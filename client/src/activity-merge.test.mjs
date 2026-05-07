import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeActivityStep } from './activity-merge.js';

test('mergeActivityStep collapses duplicate thinking labels for one turn', () => {
  const current = mergeActivityStep([], {
    id: 'status-turn-1-reasoning-正在思考中',
    kind: 'reasoning',
    label: '正在思考中',
    status: 'running'
  });
  const next = mergeActivityStep(current, {
    id: 'status-turn-1-reasoning-正在思考',
    kind: 'reasoning',
    label: '正在思考',
    status: 'running'
  });

  assert.equal(next.length, 1);
  assert.equal(next[0].label, '正在思考');
});

test('mergeActivityStep keeps only the latest narrative commentary step', () => {
  const current = mergeActivityStep([], {
    id: 'message-1',
    kind: 'agent_message',
    label: '我先检查当前状态。',
    status: 'running'
  });
  const next = mergeActivityStep(current, {
    id: 'message-2',
    kind: 'agent_message',
    label: '当前已经进入后台执行。',
    status: 'running'
  });

  assert.equal(next.length, 1);
  assert.equal(next[0].label, '当前已经进入后台执行。');
});
