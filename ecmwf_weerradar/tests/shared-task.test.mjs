import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedTask,consumeTask} from '../shared-task.mjs';
test('leaving one tile does not cancel the shared point or frame read',async()=>{
  let done,reads=0;const task=createSharedTask(()=>{reads++;return new Promise(r=>done=r);});
  const a=new AbortController(),b=new AbortController();
  const p=consumeTask(task,a.signal),q=consumeTask(task,b.signal);
  const rejected=assert.rejects(p,{name:'AbortError'});a.abort();await rejected;
  assert.equal(task.controller.signal.aborted,false);done(42);assert.equal(await q,42);assert.equal(reads,1);
  assert.equal(await consumeTask(task),42);
});
test('the last obsolete consumer cancels the underlying read',async()=>{
  const task=createSharedTask(signal=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})));
  const a=new AbortController();const p=consumeTask(task,a.signal);await Promise.resolve();
  a.abort();await assert.rejects(p,{name:'AbortError'});await Promise.resolve();assert.equal(task.controller.signal.aborted,true);
});
test('a synchronous replacement consumer keeps the read alive',async()=>{
  let done;const task=createSharedTask(()=>new Promise(r=>done=r));
  const a=new AbortController();const p=consumeTask(task,a.signal);p.catch(()=>{});await Promise.resolve();a.abort();
  const q=consumeTask(task);await Promise.resolve();assert.equal(task.controller.signal.aborted,false);done('same');assert.equal(await q,'same');
});
