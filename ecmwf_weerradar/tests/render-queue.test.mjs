import test from 'node:test';
import assert from 'node:assert/strict';
import { SharedRenderQueue } from '../render-queue.mjs';
const next=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('cancelled queued tiles never reach the renderer, with only one active tile',async()=>{
  const first=deferred(),calls=[];
  const queue=new SharedRenderQueue(async payload=>{calls.push(payload);return payload==='a'?first.promise:payload;});
  const a=queue.request('a','a');await next();
  const obsolete=new AbortController();
  const b=queue.request('b','b',obsolete.signal);const rejected=assert.rejects(b,{name:'AbortError'});
  const c=queue.request('c','c');obsolete.abort();await rejected;await next();
  assert.deepEqual(calls,['a']);assert.equal(queue.pending.has('b'),false);
  first.resolve('a');assert.deepEqual(await Promise.all([a,c]),['a','c']);assert.deepEqual(calls,['a','c']);
});

test('one subscriber cancelling does not cancel a shared tile needed by another layer',async()=>{
  const result=deferred();let sharedSignal,calls=0;
  const queue=new SharedRenderQueue((payload,signal)=>{calls++;sharedSignal=signal;return result.promise;});
  const controller=new AbortController();
  const a=queue.request('shared',{},controller.signal);const rejected=assert.rejects(a,{name:'AbortError'});
  const b=queue.request('shared',{});await next();controller.abort();await rejected;
  assert.equal(sharedSignal.aborted,false);result.resolve('pixels');assert.equal(await b,'pixels');
  assert.equal(await queue.request('shared',{}),'pixels');assert.equal(calls,1);
});

test('abandoned running work waits for its reply and cannot delete a replacement request',async()=>{
  const first=deferred();let calls=0,firstSignal;
  const queue=new SharedRenderQueue((payload,signal)=>{calls++;if(calls===1){firstSignal=signal;return first.promise;}return 'replacement';});
  const controller=new AbortController();
  const old=queue.request('same',{},controller.signal);const rejected=assert.rejects(old,{name:'AbortError'});await next();
  controller.abort();await rejected;assert.equal(firstSignal.aborted,true);
  const replacement=queue.request('same',{});await next();assert.equal(calls,1);
  first.resolve('obsolete');assert.equal(await replacement,'replacement');
  assert.equal(await queue.request('same',{}),'replacement');assert.equal(calls,2);
});

test('completed tile cache is bounded LRU and errors do not poison the queue',async()=>{
  const calls=[];let fail=true;
  const queue=new SharedRenderQueue(payload=>{calls.push(payload);if(payload==='bad'&&fail){fail=false;throw new Error('render failure');}return payload;},{maxEntries:2});
  await queue.request('a','a');await queue.request('b','b');await queue.request('a','a');await queue.request('c','c');
  assert.deepEqual([...queue.cache.keys()],['a','c']);
  await queue.request('b','b');assert.deepEqual(calls,['a','b','c','b']);
  await assert.rejects(queue.request('bad','bad'),/render failure/);
  assert.equal(await queue.request('bad','bad'),'bad');
  assert.equal(queue.cache.size,2);
});

test('already aborted and same-turn abandoned tiles are skipped before dispatch',async()=>{
  let calls=0;const queue=new SharedRenderQueue(()=>++calls);
  const a=new AbortController();a.abort();await assert.rejects(queue.request('a',{},a.signal),{name:'AbortError'});
  const b=new AbortController();const pending=queue.request('b',{},b.signal);const rejected=assert.rejects(pending,{name:'AbortError'});b.abort();await rejected;await next();
  assert.equal(calls,0);assert.equal(queue.pending.size,0);assert.equal(queue.queue.length,0);
});

test('a worker pool renders several tiles at once and queues the rest',async()=>{
  const active=[],finish=[];
  const queue=new SharedRenderQueue((payload)=>new Promise(resolve=>{active.push(payload);finish.push(()=>resolve(payload));}),{concurrency:3});
  const jobs=['a','b','c','d'].map(key=>queue.request(key,key));
  await next();
  assert.deepEqual(active,['a','b','c'],'drie tegels tegelijk, de vierde wacht');
  finish.shift()();await next();
  assert.deepEqual(active,['a','b','c','d']);
  finish.forEach(fn=>fn());
  assert.deepEqual(await Promise.all(jobs),['a','b','c','d']);
});

test('a shrinking pool lowers the number of parallel tiles without a new queue',async()=>{
  let workers=2;const active=[],finish=[];
  const queue=new SharedRenderQueue(payload=>new Promise(resolve=>{active.push(payload);finish.push(()=>resolve(payload));}),{concurrency:()=>workers});
  const first=['a','b','c'].map(key=>queue.request(key,key));
  await next();assert.deepEqual(active,['a','b']);
  workers=1;finish.shift()();await next();
  assert.deepEqual(active,['a','b'],'met nog één werker komt er niets bij zolang die bezet is');
  finish.shift()();await next();
  assert.deepEqual(active,['a','b','c']);
  finish.forEach(fn=>fn());await Promise.all(first);
});

test('primary tiles overtake queued refinements without changing running work or equal-priority FIFO',async()=>{
 const first=deferred(),calls=[];
 const queue=new SharedRenderQueue(async p=>{calls.push(p.id);return p.id==='active'?first.promise:p.id;},{priority:p=>p.optional?1:0});
 const active=queue.request('active',{id:'active',optional:true});await next();
 const fog=queue.request('fog',{id:'fog',optional:true});
 const rain=queue.request('rain',{id:'rain'}),cloud=queue.request('cloud',{id:'cloud'});
 first.resolve('active');await Promise.all([active,fog,rain,cloud]);
 assert.deepEqual(calls,['active','rain','cloud','fog']);
});
