import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { MAX_RETRY_DELAY_MS, recoveryAction, waitForRetry, type FailureContext } from '../src/core/resilience.js';
const base: FailureContext = { definitive: true, transient: true, sideEffects: false, pendingReview: false, approvalResume: false, retries: 0, fallbackUsed: false, currentModel: 'a/model', fallbackModel: 'b/model' };
test('unknown delivery and any completed command/write block retries and fallback', () => {
  for (const state of [{ definitive: false }, { sideEffects: true }, { pendingReview: true }, { approvalResume: true }]) assert.deepEqual(recoveryAction({ ...base, ...state }), { type: 'stop' });
});
test('transient terminal failures back off twice then use one independently configured model', () => {
  assert.deepEqual(recoveryAction(base), { type: 'retry', delay: 1000 });
  assert.deepEqual(recoveryAction({ ...base, retries: 1 }), { type: 'retry', delay: 3000 });
  assert.deepEqual(recoveryAction({ ...base, retries: 2 }), { type: 'fallback', model: 'b/model' });
  assert.deepEqual(recoveryAction({ ...base, retries: 2, fallbackUsed: true }), { type: 'stop' });
});
test('authentication/configuration failures are not retried and never fall back to the same model', () => {
  assert.deepEqual(recoveryAction({ ...base, transient: false, fallbackModel: '' }), { type: 'stop' });
  assert.deepEqual(recoveryAction({ ...base, transient: false, fallbackModel: base.currentModel }), { type: 'stop' });
});

test('provider minimum controls both bounded retries and fallback without weakening replay guards', () => {
  const minimumDelayMs = 55_857;
  for (const retries of [0, 1]) assert.deepEqual(recoveryAction({ ...base, minimumDelayMs, retries }), { type: 'retry', delay: minimumDelayMs });
  assert.deepEqual(recoveryAction({ ...base, minimumDelayMs, retries: 2 }), { type: 'fallback', model: 'b/model', delay: minimumDelayMs });
  assert.deepEqual(recoveryAction({ ...base, minimumDelayMs, retries: 2, fallbackUsed: true }), { type: 'stop' });
  assert.deepEqual(recoveryAction({ ...base, minimumDelayMs: 0, retries: 1 }), { type: 'retry', delay: 3000 });
  assert.deepEqual(recoveryAction({ ...base, minimumDelayMs: 3000.1, retries: 1 }), { type: 'retry', delay: 3001 });
  for (const unsafe of [{ definitive: false }, { sideEffects: true }, { pendingReview: true }, { approvalResume: true }]) {
    assert.deepEqual(recoveryAction({ ...base, ...unsafe, minimumDelayMs }), { type: 'stop' });
    assert.deepEqual(recoveryAction({ ...base, ...unsafe, retries: 2, minimumDelayMs }), { type: 'stop' });
  }
});

test('long and invalid delays stop instead of overflowing timers, clamping down or bypassing via fallback', () => {
  assert.deepEqual(recoveryAction({ ...base, minimumDelayMs: MAX_RETRY_DELAY_MS }), { type: 'retry', delay: MAX_RETRY_DELAY_MS });
  for (const minimumDelayMs of [-1, Number.NaN, Number.POSITIVE_INFINITY, MAX_RETRY_DELAY_MS + 1, Number.MAX_SAFE_INTEGER]) {
    for (const retries of [0, 2]) assert.deepEqual(recoveryAction({ ...base, retries, minimumDelayMs }), { type: 'stop' });
  }
  for (const retries of [0, 2]) assert.deepEqual(recoveryAction({ ...base, retries, minimumDelayMs: 1000, retryAfterTooLong: true }), { type: 'stop' });
  for (const retries of [-1, Number.NaN, 0.5]) assert.deepEqual(recoveryAction({ ...base, retries }), { type: 'stop' });
});

test('a known quota refusal preserves its session only before effects or review, with the same retry cap', () => {
  assert.deepEqual(recoveryAction({ ...base, rateLimited:true, minimumDelayMs:22260 }), {type:'retry',delay:22260,continueSession:true});
  for (const unsafe of [{definitive:false},{sideEffects:true},{pendingReview:true},{approvalResume:true}]) assert.deepEqual(recoveryAction({...base,...unsafe,rateLimited:true}),{type:'stop'});
  assert.deepEqual(recoveryAction({...base,rateLimited:true,retries:2,fallbackModel:''}),{type:'stop'});
  assert.deepEqual(recoveryAction({...base,rateLimited:true,retries:2}),{type:'fallback',model:'b/model'});
});

test('retry wait yields to the event loop and does not resolve before the fractional hint deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  let complete = false;
  const waiting = waitForRetry(55_857, controller.signal).then(() => { complete = true; });
  await Promise.resolve(); assert.equal(complete, false);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
  t.mock.timers.tick(55_856); await Promise.resolve(); assert.equal(complete, false);
  t.mock.timers.tick(1); await waiting; assert.equal(complete, true);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('Stop cancels a long retry immediately and releases its timer/listener', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  const waiting = waitForRetry(MAX_RETRY_DELAY_MS, controller.signal);
  const rejected = assert.rejects(waiting, /Run cancelled/);
  controller.abort(); await rejected;
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  t.mock.timers.tick(MAX_RETRY_DELAY_MS);
  await assert.rejects(waitForRetry(1000, controller.signal), /Run cancelled/);
  await assert.rejects(waitForRetry(Number.POSITIVE_INFINITY, new AbortController().signal), /automatic wait limit/);
});
