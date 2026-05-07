import assert from 'node:assert/strict';
import test from 'node:test';
import { isThinkingActivityStep, thinkingActivityText } from './activity-display.js';

test('isThinkingActivityStep exposes running reasoning as a visible step', () => {
  assert.equal(isThinkingActivityStep({ kind: 'reasoning', status: 'running', label: '正在思考' }), true);
});

test('thinkingActivityText falls back to mobile thinking label', () => {
  assert.equal(thinkingActivityText({ kind: 'reasoning', status: 'running' }), '正在思考');
});
