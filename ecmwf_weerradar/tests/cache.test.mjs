import test from 'node:test';
import assert from 'node:assert/strict';
import { FastBrowserBlockCache } from '../fast-block-cache.mjs';

// Exercise the real reader's cache get/put path with an in-memory Cache API.
function storage(t) {
  const old = globalThis.caches;
  const entries = new Map();
  let scans = 0;
  const cache = {
    async match(request) { return entries.get(typeof request === 'string' ? request : request.url)?.clone(); },
    async put(url, response) { entries.set(url, response.clone()); },
    async keys() { scans++; return [...entries.keys()].map(url => ({ url })); },
    async delete(url) { return entries.delete(url); },
  };
  globalThis.caches = { async open() { return cache; }, async delete() { entries.clear(); return true; } };
  t.after(() => { globalThis.caches = old; });
  return { entries, get scans() { return scans; } };
}
const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };

test('a burst of block writes does not repeatedly scan the persistent cache', async t => {
  const saved = storage(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cache = new FastBrowserBlockCache({ blockSize: 16, maxBytes: 4096, evictionWriteBudgetBytes: 2048, evictionIntervalMs: 1000 });
  let fetches = 0;
  const fetchBlock = async () => { fetches++; return new Uint8Array(16).fill(7); };
  const [a, b] = await Promise.all([cache.get('same', fetchBlock, 16), cache.get('same', fetchBlock, 16)]);
  assert.deepEqual(a, b);
  assert.equal(fetches, 1, 'upstream inflight deduplication is preserved');
  await Promise.all(Array.from({ length: 30 }, (_, i) => cache.get(`block-${i}`, fetchBlock, 16)));
  await settle();
  assert.equal(saved.entries.size, 31);
  assert.equal(saved.scans, 0);
  t.mock.timers.tick(1000);
  await settle();
  assert.equal(saved.scans, 1, 'one trailing maintenance scan handles the burst');
  await cache.clear();
});

test('write budget triggers eviction and the trailing scan bounds persistent storage', async t => {
  const saved = storage(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cache = new FastBrowserBlockCache({ blockSize: 16, maxBytes: 64, evictionWriteBudgetBytes: 32, evictionIntervalMs: 1000 });
  for (let i = 0; i < 5; i++) {
    await cache.get(`block-${i}`, async () => new Uint8Array(16), 16);
    await settle();
  }
  assert.equal(saved.scans, 2, 'the byte budget forces scans even before the timer');
  assert.equal(saved.entries.size, 5, 'at most one pending write budget is deferred');
  t.mock.timers.tick(1000);
  await settle();
  const bytes = [...saved.entries.values()].reduce((n, response) => n + Number(response.headers.get('Content-Length')), 0);
  assert.ok(bytes <= 64);
  assert.equal(saved.entries.has(cache.resolveUrl('block-0')), false, 'upstream oldest-entry eviction is preserved');
  await cache.clear();
});

test('clearing cancels scheduled cache maintenance', async t => {
  const saved = storage(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cache = new FastBrowserBlockCache({ blockSize: 16, evictionIntervalMs: 1000 });
  await cache.get('block', async () => new Uint8Array(16), 16);
  await settle();
  await cache.clear();
  t.mock.timers.tick(2000);
  await settle();
  assert.equal(saved.entries.size, 0);
  assert.equal(saved.scans, 0);
});

test('cancelling one reader preserves a block shared with another reader', async t => {
  storage(t);
  const cache = new FastBrowserBlockCache({ blockSize: 16 });
  const controller = new AbortController();
  let finish, sharedSignal;
  const fetchBlock = signal => {
    sharedSignal = signal;
    return new Promise(resolve => { finish = resolve; });
  };
  const abandoned = cache.get('shared', fetchBlock, 16, controller.signal);
  const active = cache.get('shared', fetchBlock, 16);
  const rejected = assert.rejects(abandoned, { name: 'AbortError' });
  await settle();
  controller.abort();
  await rejected;
  assert.equal(sharedSignal.aborted, false);
  finish(new Uint8Array(16).fill(9));
  assert.equal((await active)[0], 9);
  await settle();
  await cache.clear();
});
