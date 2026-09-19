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

test('run rollover evicts obsolete bytes but retains latest and long-range fallback runs',async t=>{
 const saved=storage(t),cache=new FastBrowserBlockCache({blockSize:16,batchRanges:false});
 const key=run=>`https://openmeteo.s3.amazonaws.com/data_spatial/ecmwf_ifs/2026/09/19/${run}00Z/2026-09-20T0400.om/block/0`;
 for(const run of ['00','06','12'])await cache.get(key(run),async()=>new Uint8Array(16).fill(Number(run)),16);
 await settle();assert.equal(saved.entries.size,3);
 await cache.retainRuns(['2026/09/19/06'+'00Z','2026/09/19/12'+'00Z']);
 assert.equal(saved.entries.size,2);assert.equal(saved.entries.has(cache.resolveUrl(key('00'))),false);
 const never=()=>{throw Error('retained frame was downloaded again');};
 assert.equal((await cache.get(key('06'),never,16))[0],6);assert.equal((await cache.get(key('12'),never,16))[0],12);
 await cache.retainRuns([]);assert.equal(saved.entries.size,2,'empty metadata cannot wipe usable data');
 await cache.clear();
});

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

test('real cache combines adjacent misses and persists each exact block for reuse',async t=>{
  storage(t);
  const originalFetch=globalThis.fetch,requests=[];
  globalThis.fetch=async(url,{headers})=>{
    const [start,end]=headers.Range.slice(6).split('-').map(Number);requests.push({url,start,end});
    return new Response(Uint8Array.from({length:end-start+1},(_,i)=>start+i),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/64`}});
  };
  t.after(()=>{globalThis.fetch=originalFetch;});
  const cache=new FastBrowserBlockCache({blockSize:16}),url='https://example.test/run-00/frame.om';
  const fallback=()=>{throw new Error('Unbatched source path used');};
  const values=await Promise.all([0,1,2,1].map(i=>cache.get(`${url}/block/${i}`,fallback,64)));
  assert.equal(requests.length,1);assert.deepEqual(requests[0],{url,start:16,end:63});
  assert.deepEqual(values.map(v=>[v[0],v.at(-1)]),[[48,63],[32,47],[16,31],[32,47]]);
  await settle();cache.memCache.clear();
  assert.deepEqual(await cache.get(`${url}/block/1`,fallback,64),values[1]);
  assert.equal(requests.length,1,'returning to a previous frame reads its persistent cache');
  await cache.clear();
});
