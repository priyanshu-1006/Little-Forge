import assert from 'node:assert/strict';
import test from 'node:test';
import { branchMessages, compareVerification, searchChats, shareRunSummary, shouldSendFollowUp } from '../src/core/chat-workflows.js';
import type { CheckRecord } from '../src/core/run-evidence.js';

function check(phase: CheckRecord['phase'], exitCode: number | null, cwd = '.'): CheckRecord {
  return {
    input: { task: 'pytest', args: ['tests/cli.py'], cwd }, phase, durationMs: 12,
    changedSource: [], detectionPartial: false,
    result: { exitCode, stdout: 'output is private', stderr: '', truncated: false, cleanupConfirmed: true, timedOut: false, cancelled: false },
  };
}

test('history indexes receipt paths, check inputs, and errors while branches copy only text through the selected message', () => {
  const messages = [
    { role: 'user' as const, text: 'Inspect config' },
    { role: 'assistant' as const, text: 'Done', attempt: {
      id: 'attempt', error: 'Rate limit reached', receipt: { reviews: [{ paths: ['src/config.py'] }], checks: [check('agent', 0)] },
    } },
    { role: 'user' as const, text: 'Later question' },
  ];
  const chats = [{ id: 'chat', title: 'Earlier chat', messages }];
  for (const query of ['src/config.py', 'Rate limit', 'tests/cli.py']) {
    assert.equal(searchChats(query, chats)[0]?.messageIndex, 1);
  }
  assert.deepEqual(searchChats('Earlier chat', chats), [{ id: 'chat' }]);
  assert.deepEqual(searchChats('output is private', chats), []);
  assert.deepEqual(branchMessages(messages, 1), [{ role: 'user', text: 'Inspect config' }, { role: 'assistant', text: 'Done' }]);
  assert.deepEqual(branchMessages(messages, -1), []);
});

test('verification pairs the same check and directory and treats unknown results as inconclusive', () => {
  assert.deepEqual(compareVerification([
    check('baseline', 1), check('after', 0), check('baseline', 0, 'other'), check('after', null, 'other'),
    check('baseline', 0, 'missing'), check('after', 0, 'unmatched'), check('agent', 0),
  ]), [
    { baseline: 0, after: 1, label: 'Now passing' },
    { baseline: 2, after: 3, label: 'Comparison inconclusive' },
    { baseline: 4, label: 'After check missing' },
    { after: 5, label: 'No baseline recorded' },
  ]);
  assert.deepEqual(compareVerification([check('after', 0), check('baseline', 1)]), [{ baseline: 1, label: 'After check missing' }]);
});

test('a queued follow-up auto-sends only after its successful run and while no other operation is active', () => {
  const queue = { status: 'queued' as const, waitingOn: 'run' };
  assert.equal(shouldSendFollowUp(queue, 'completed', 'run', false), true);
  assert.equal(shouldSendFollowUp(queue, 'completed', 'other', false), false);
  assert.equal(shouldSendFollowUp(queue, 'completed', 'run', true), false);
  for (const status of ['awaiting-review', 'running', 'failed', 'cancelled']) {
    assert.equal(shouldSendFollowUp(queue, status, 'run', false), false);
  }
  assert.equal(shouldSendFollowUp({ ...queue, status: 'held' }, 'completed', 'run', false), false);
});

test('share summary removes recognized credentials and excludes command output and local session links', () => {
  const content = shareRunSummary({
    prompt: 'OPENROUTER_API_KEY=sk-or-v1-12345678901234567890',
    reply: 'See http://127.0.0.1:8790/sessions/private-id.\n```\nAuthorization: Bearer AbCd1234567890\n```',
    paths: ['src/config.py'], checks: [check('baseline', 1), check('after', 0)],
  });
  assert.match(content, /OPENROUTER_API_KEY=\[redacted\]/);
  assert.match(content, /Now passing/);
  assert.match(content, /````text/);
  assert.doesNotMatch(content, /1234567890|private-id|output is private/);
});
