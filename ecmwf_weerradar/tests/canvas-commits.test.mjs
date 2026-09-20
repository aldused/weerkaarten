import test from 'node:test';
import assert from 'node:assert/strict';
import {CanvasCommits} from '../canvas-commits.mjs';
test('cached tile commits yield between small batches without changing their order',async()=>{
 let clock=0,id=0;const frames=new Map(),drawn=[],q=new CanvasCommits({now:()=>clock,schedule:fn=>{frames.set(++id,fn);return id;},cancel:id=>frames.delete(id),budgetMs:6});
 const signals=Array.from({length:9},()=>new AbortController()),promises=signals.map((c,i)=>q.commit(()=>{drawn.push(i);clock+=3;},c.signal));
 const advance=()=>{const [id,fn]=frames.entries().next().value;frames.delete(id);fn();};
 advance();assert.deepEqual(drawn,[0,1]);assert.equal(frames.size,1);
 while(frames.size)advance();await Promise.all(promises);assert.deepEqual(drawn,[0,1,2,3,4,5,6,7,8]);assert.equal(q.queue.length,0);
});
test('an obsolete cached tile never paints over a newer selection',async()=>{
 const frames=new Map();let id=0,painted=0;
 const q=new CanvasCommits({schedule:fn=>{frames.set(++id,fn);return id;},cancel:id=>frames.delete(id)}),old=new AbortController();
 const promise=q.commit(()=>painted++,old.signal);old.abort();await assert.rejects(promise,{name:'AbortError'});
 assert.equal(painted,0);assert.equal(frames.size,0);assert.equal(q.queue.length,0);
 const fresh=q.commit(()=>painted++,new AbortController().signal);frames.values().next().value();await fresh;assert.equal(painted,1);
});
