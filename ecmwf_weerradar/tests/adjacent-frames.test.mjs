import test from 'node:test';
import assert from 'node:assert/strict';
import {AdjacentFrames,adjacentFrameIndices} from '../adjacent-frames.mjs';
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
test('only two neighbours, no speculative day sweep, and playback wraps at the last frame',()=>{
 assert.deepEqual(adjacentFrameIndices(0,240),[1]);assert.deepEqual(adjacentFrameIndices(14,240),[15,13]);assert.deepEqual(adjacentFrameIndices(239,240),[0,238]);assert.deepEqual(adjacentFrameIndices(0,1),[]);assert.deepEqual(adjacentFrameIndices(1,2),[0]);
});
test('playback is enabled only after the next frame is completely prepared',async()=>{
 const queue=new AdjacentFrames({delayMs:0}),calls=[],ready=[];let finish;
 queue.start(4,10,(index)=>{calls.push(index);return new Promise(resolve=>{finish=resolve;});},{ready:index=>ready.push(index)});
 await tick();assert.deepEqual(calls,[5]);assert.deepEqual(ready,[]);finish();await tick();assert.deepEqual(ready,[5]);assert.deepEqual(calls,[5,3]);finish();await tick();assert.deepEqual(calls,[5,3]);queue.cancel();
});
test('rapid choices cancel pending work and old completion never enables a new selection',async()=>{
 const queue=new AdjacentFrames({delayMs:0}),signals=[],ready=[];let finish;
 queue.start(0,10,(_,signal)=>{signals.push(signal);return new Promise(resolve=>{finish=resolve;});},{ready:()=>ready.push('old')});await tick();
 queue.start(6,10,async()=>{},{ready:()=>ready.push('new')});assert.equal(signals[0].aborted,true);finish();await tick();assert.deepEqual(ready,['new']);
 queue.cancel();queue.start(3,10,async()=>{throw Error('should not start');},{error:()=>assert.fail('cancelled work was dispatched')});queue.cancel();await tick();
});
test('failed prefetch does not enable playback or prefetch the previous frame',async()=>{
 const queue=new AdjacentFrames({delayMs:0}),calls=[],errors=[];
 queue.start(3,10,async i=>{calls.push(i);throw Error('offline');},{ready:()=>assert.fail('not ready'),error:e=>errors.push(e.message)});
 await tick();assert.deepEqual(calls,[4]);assert.deepEqual(errors,['offline']);queue.cancel();
});
test('a constrained connection fetches only the next frame after the configured idle delay',async()=>{
 const queue=new AdjacentFrames({delayMs:0}),calls=[];
 queue.start(4,10,async i=>calls.push(i),{previous:false,delayMs:20});
 await tick();assert.deepEqual(calls,[]);
 await new Promise(resolve=>setTimeout(resolve,30));assert.deepEqual(calls,[5]);queue.cancel();
});
