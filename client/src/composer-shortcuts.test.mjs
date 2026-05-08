import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectComposerToken,
  replaceComposerToken
} from './composer-shortcuts.js';

test('detectComposerToken finds skill and file tokens', () => {
  assert.equal(detectComposerToken('/rev', 4), null);
  assert.deepEqual(detectComposerToken('请用 $frontend', 12), {
    type: 'skill',
    marker: '$',
    query: 'frontend',
    start: 3,
    end: 12
  });
  assert.deepEqual(detectComposerToken('看 @server', 9), {
    type: 'file',
    marker: '@',
    query: 'server',
    start: 2,
    end: 9
  });
});

test('replaceComposerToken removes selected skill token without leaking it into text', () => {
  const text = '请用 $frontend 优化';
  const token = detectComposerToken(text, 12);
  assert.equal(replaceComposerToken(text, token, ''), '请用 优化');
});
