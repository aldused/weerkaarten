import test from 'node:test';
import assert from 'node:assert/strict';
import {warmOrder,WarmQueue} from '../warm-frames.mjs';
import {FieldPackets} from '../field-packets.mjs';
const tick=(ms=5)=>new Promise(resolve=>setTimeout(resolve,ms));
test('warm order: nearest first, forwards preferred, never the selection, within bounds',()=>{
 assert.deepEqual(warmOrder(5,20,{ahead:4,behind:2}),[6,7,4,8,9,3]);
 assert.deepEqual(warmOrder(0,4,{ahead:6,behind:6}),[1,2,3]);
 assert.deepEqual(warmOrder(3,4,{ahead:6,behind:2}),[2,1]);
 assert.deepEqual(warmOrder(2,10,{ahead:1,behind:0,extra:[2,9,9,40]}),[3,9]);
 assert.equal(new Set(warmOrder(50,120)).size,warmOrder(50,120).length);
});
test('queue respects concurrency and a new schedule replaces queued work',async()=>{
 const q=new WarmQueue({concurrency:2,delayMs:0}),started=[];const release=[];
 const job=i=>()=>{started.push(i);return new Promise(r=>release.push(r));};
 q.schedule([1,2,3,4].map(job));await tick();
 assert.deepEqual(started,[1,2]);
 q.schedule([7,8].map(job));await tick();
 release.shift()();release.shift()();await tick();
 assert.deepEqual(started,[1,2,7,8]);
 q.clear();release.forEach(r=>r());await tick();assert.equal(q.size,0);
});
test('failed warm-ups never throw and the queue keeps going',async()=>{
 const q=new WarmQueue({concurrency:1,delayMs:0}),seen=[];
 q.schedule([()=>{seen.push(1);throw Error('offline');},async()=>{seen.push(2);}]);await tick(20);
 assert.deepEqual(seen,[1,2]);assert.equal(q.failed,1);assert.equal(q.done,1);
});
function memoryCache(){
 const map=new Map();
 return {map,open:async()=>({match:async u=>map.has(u)?new Response(map.get(u)):undefined,put:async(u,r)=>{map.set(u,new Uint8Array(await r.arrayBuffer()));},delete:async u=>map.delete(u),keys:async()=>[...map.keys()].map(u=>new Request(u))})};
}
const file='https://openmeteo.s3.amazonaws.com/data_spatial/ecmwf_ifs/2026/10/18/0000Z/2026-10-18T1200.om';
test('warm stores bytes once; a visible read then joins or reuses it without a second transfer',async()=>{
 const storage=memoryCache();let calls=0,finish;
 const client=new FieldPackets({storage,fetcher:async()=>{calls++;await new Promise(r=>{finish=r;});return new Response(new Uint8Array([1,2,3]));}});
 const warm=client.warm(file,'precipitation',[1,2,3,4]);await tick();
 assert.equal(calls,1);assert.equal(await client.warm(file,'precipitation',[1,2,3,4]),'inflight');
 const read=client.read(file,'precipitation',[1,2,3,4]).catch(e=>e);await tick();
 assert.equal(calls,1,'visible read shares the running transfer');
 finish();assert.equal(await warm,'fetched');
 assert.ok(await read instanceof Error,'tiny fake packet is rejected by the decoder, proving the shared bytes arrived');
 await tick();assert.equal(storage.map.size,1);
 assert.equal(await client.warm(file,'precipitation',[1,2,3,4]),'cached');assert.equal(calls,1);
});
test('aborting the visible read does not cancel a background transfer',async()=>{
 const storage=memoryCache();let signalSeen,finish;
 const client=new FieldPackets({storage,fetcher:async(u,{signal})=>{signalSeen=signal;await new Promise(r=>{finish=r;});return new Response(new Uint8Array([9]));}});
 const warm=client.warm(file,'precipitation',[1,2,3,4]);await tick();
 const c=new AbortController();const read=client.read(file,'precipitation',[1,2,3,4],c.signal).catch(e=>e.name);await tick();
 c.abort();assert.equal(await read,'AbortError');assert.equal(signalSeen.aborted,false);
 finish();assert.equal(await warm,'fetched');
});
test('aborting the only visible reader cancels its own transfer',async()=>{
 let signalSeen;
 const client=new FieldPackets({storage:undefined,fetcher:(u,{signal})=>{signalSeen=signal;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason)));}});
 const c=new AbortController();const read=client.read(file,'precipitation',[1,2,3,4],c.signal).catch(e=>e.name);await tick();
 c.abort();assert.equal(await read,'AbortError');assert.equal(signalSeen.aborted,true);
});
