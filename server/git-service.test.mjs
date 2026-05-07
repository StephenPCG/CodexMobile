import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createGitService,
  defaultCommitMessage,
  normalizeBranchName,
  parseGitStatusShort,
  truncateGitOutput
} from './git-service.js';

test('parseGitStatusShort reads branch, ahead/behind, and changed files', () => {
  const status = parseGitStatusShort([
    '## codex/mobile-git...origin/codex/mobile-git [ahead 2, behind 1]',
    ' M client/src/App.jsx',
    'A  server/git-service.js',
    'R  old-name.js -> new-name.js',
    '?? server/git-service.test.mjs'
  ].join('\n'));

  assert.equal(status.branch, 'codex/mobile-git');
  assert.equal(status.upstream, 'origin/codex/mobile-git');
  assert.equal(status.ahead, 2);
  assert.equal(status.behind, 1);
  assert.equal(status.clean, false);
  assert.deepEqual(status.files.map((file) => [file.status, file.path]), [
    ['M', 'client/src/App.jsx'],
    ['A', 'server/git-service.js'],
    ['R', 'new-name.js'],
    ['??', 'server/git-service.test.mjs']
  ]);
});

test('normalizeBranchName keeps codex prefix and sanitizes unsafe text', () => {
  assert.equal(normalizeBranchName('移动端 Git 操作'), 'codex/git');
  assert.equal(normalizeBranchName('codex/mobile git panel'), 'codex/mobile-git-panel');
  assert.equal(normalizeBranchName('../bad branch'), 'codex/bad-branch');
});

test('defaultCommitMessage summarizes a focused change set', () => {
  const status = parseGitStatusShort([
    '## main',
    ' M client/src/App.jsx',
    ' M client/src/styles.css'
  ].join('\n'));

  assert.equal(defaultCommitMessage(status), '更新 App 和 styles');
});

test('truncateGitOutput caps large diff payloads', () => {
  const result = truncateGitOutput('a'.repeat(1200), 1000);
  assert.equal(result.truncated, true);
  assert.equal(result.originalLength, 1200);
  assert.match(result.text, /diff truncated/);
});

test('git service returns truncated diff with status', async () => {
  const calls = [];
  const service = createGitService({
    getProject: () => ({ path: '/repo' }),
    runner: async (cwd, args) => {
      calls.push(args.join(' '));
      if (args[0] === 'rev-parse') {
        return { stdout: '/repo\n', stderr: '' };
      }
      if (args.join(' ') === 'diff HEAD --stat') {
        return { stdout: ' client/src/App.jsx | 4 ++--\n', stderr: '' };
      }
      if (args.join(' ') === 'diff HEAD --') {
        return { stdout: 'x'.repeat(90_000), stderr: '' };
      }
      if (args[0] === 'status') {
        return { stdout: '## codex/git-panel...origin/codex/git-panel [ahead 1]\n M client/src/App.jsx\n', stderr: '' };
      }
      throw new Error(`unexpected git ${args.join(' ')}`);
    }
  });

  const result = await service.diff('project-1');
  assert.equal(result.truncated, true);
  assert.match(result.summary, /App.jsx/);
  assert.equal(result.status.branch, 'codex/git-panel');
  assert.equal(calls.includes('diff HEAD --stat'), true);
});

test('git service pulls with fast-forward only', async () => {
  const calls = [];
  const service = createGitService({
    getProject: () => ({ path: '/repo' }),
    runner: async (cwd, args) => {
      calls.push(args);
      if (args[0] === 'rev-parse') {
        return { stdout: '/repo\n', stderr: '' };
      }
      if (args[0] === 'pull') {
        return { stdout: 'Already up to date.\n', stderr: '' };
      }
      if (args[0] === 'status') {
        return { stdout: '## codex/git-panel...origin/codex/git-panel\n', stderr: '' };
      }
      throw new Error(`unexpected git ${args.join(' ')}`);
    }
  });

  const result = await service.pull('project-1');
  assert.deepEqual(calls.find((args) => args[0] === 'pull'), ['pull', '--ff-only']);
  assert.equal(result.status.clean, true);
});

test('git service sync pulls then pushes only when ahead remains', async () => {
  const calls = [];
  let statusCount = 0;
  const service = createGitService({
    getProject: () => ({ path: '/repo' }),
    runner: async (cwd, args) => {
      calls.push(args.join(' '));
      if (args[0] === 'rev-parse') {
        return { stdout: '/repo\n', stderr: '' };
      }
      if (args[0] === 'pull') {
        return { stdout: 'Fast-forward\n', stderr: '' };
      }
      if (args[0] === 'push') {
        return { stdout: 'pushed\n', stderr: '' };
      }
      if (args[0] === 'status') {
        statusCount += 1;
        return {
          stdout: statusCount === 1
            ? '## codex/git-panel...origin/codex/git-panel [ahead 1]\n'
            : '## codex/git-panel...origin/codex/git-panel\n',
          stderr: ''
        };
      }
      throw new Error(`unexpected git ${args.join(' ')}`);
    }
  });

  const result = await service.sync('project-1');
  assert.equal(calls.includes('pull --ff-only'), true);
  assert.equal(calls.includes('push origin'), true);
  assert.equal(result.pushed.branch, 'codex/git-panel');
  assert.equal(result.status.ahead, 0);
});

test('git service commitPush commits and then pushes', async () => {
  const calls = [];
  let statusCount = 0;
  const service = createGitService({
    getProject: () => ({ path: '/repo' }),
    runner: async (cwd, args) => {
      calls.push(args.join(' '));
      if (args[0] === 'rev-parse' && args[1] === '--show-toplevel') {
        return { stdout: '/repo\n', stderr: '' };
      }
      if (args[0] === 'rev-parse' && args[1] === '--short') {
        return { stdout: 'abc123\n', stderr: '' };
      }
      if (args[0] === 'status') {
        statusCount += 1;
        return {
          stdout: statusCount === 1
            ? '## codex/git-panel...origin/codex/git-panel\n M client/src/App.jsx\n'
            : '## codex/git-panel...origin/codex/git-panel [ahead 1]\n',
          stderr: ''
        };
      }
      if (args[0] === 'add') {
        return { stdout: '', stderr: '' };
      }
      if (args[0] === 'commit') {
        return { stdout: '[codex/git-panel abc123] 更新 GitPanel\n', stderr: '' };
      }
      if (args[0] === 'push') {
        return { stdout: 'pushed\n', stderr: '' };
      }
      throw new Error(`unexpected git ${args.join(' ')}`);
    }
  });

  const result = await service.commitPush('project-1', '更新 GitPanel');
  assert.equal(calls.includes('add -A'), true);
  assert.equal(calls.includes('commit -m 更新 GitPanel'), true);
  assert.equal(calls.includes('push origin'), true);
  assert.equal(result.hash, 'abc123');
});
