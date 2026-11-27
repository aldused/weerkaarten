import test from 'node:test';
import assert from 'node:assert/strict';
import {createFrameCache,preloadPolicy,preloadTimes} from '../vierluik/frame-cache.js';

test('only the last consumer can cancel a shared load', async () => {
  const background = new AbortController();
  const foreground = new AbortController();
  let reads = 0, signal, priority, finish;
  const load = createFrameCache(12, 3, () => 4, (_input, effective, requestedPriority) => {
    reads++;
    signal = effective;
    priority = requestedPriority;
    return new Promise(resolve => { finish = resolve; });
  });
  const speculative = load('run-a/hour-1', 'asset-a', background.signal, 'low');
  const selected = load('run-a/hour-1', 'asset-a', foreground.signal, 'high');
  background.abort();
  await assert.rejects(speculative, {name: 'AbortError'});
  assert.equal(reads, 1);
  assert.equal(priority, 'high');
  assert.equal(signal.aborted, false);
  finish('frame-a');
  assert.equal(await selected, 'frame-a');
  assert.equal(await load('run-a/hour-1', 'asset-a'), 'frame-a');
  assert.equal(reads, 1);
});

test('a cancelled load is discarded even if its transport resolves late', async () => {
  const old = new AbortController();
  const runners = [];
  const load = createFrameCache(12, 3, () => 4, input => new Promise(resolve => {
    runners.push(() => resolve(input));
  }));
  const stale = load('run-a/hour-1', 'old', old.signal);
  await Promise.resolve();
  old.abort();
  await assert.rejects(stale, {name: 'AbortError'});
  const fresh = load('run-a/hour-1', 'new');
  await Promise.resolve();
  runners[1]();
  assert.equal(await fresh, 'new');
  runners[0]();
  assert.equal(await load('run-a/hour-1', 'unused'), 'new');
});

test('byte limits evict the least recently used entry, keeping run versions distinct', async () => {
  const load = createFrameCache(8, 8, () => 4, input => input);
  await load('run-a/hour-1', 'a1');
  await load('run-a/hour-2', 'a2');
  await load('run-a/hour-1', 'unused');
  await load('run-b/hour-1', 'b1');
  assert.equal(load.has('run-a/hour-1'), true);
  assert.equal(load.has('run-a/hour-2'), false);
  assert.equal(await load('run-b/hour-1', 'unused'), 'b1');
});

test('preloads the selected direction, skips missing hours, and honours data saver', () => {
  const times = [0,1,3,7,9,11,12,18,19,20,22,25];
  const desktop = preloadPolicy({effectiveType:'4g'}, 8, false);
  assert.deepEqual(preloadTimes(times, 4, 1, desktop, false), [11,12,18,19,20,22,7,3,1]);
  assert.deepEqual(preloadTimes(times, 4, -1, desktop, false), [7,3,1,11,12,18,19,20,22]);
  assert.deepEqual(preloadTimes(times, 11, 1, desktop, true), [0,1,3,7,9,11,22,20,19]);
  assert.deepEqual(preloadTimes(times, 4, 1, preloadPolicy({saveData:true}, 16, false), false), []);
  assert.deepEqual(preloadTimes(times, 4, 1, preloadPolicy(undefined, 8, true), false), [11,12,7]);
});
