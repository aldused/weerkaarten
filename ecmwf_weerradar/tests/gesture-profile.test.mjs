import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installGestureProfile} from '../gesture-profile.mjs';
test('gesture diagnostics record frame gaps only during a gesture',()=>{
 const events={},element={dataset:{}};let next,time=0,cancelled=0;
 installGestureProfile({on:(name,fn)=>events[name]=fn},element,{raf:fn=>(next=fn,1),caf:()=>cancelled++,now:()=>time});
 events.movestart();next(16);next(32);next(96);time=100;events.moveend();
 assert.deepEqual(JSON.parse(element.dataset.gestureProfile),{durationMs:100,frames:3,p95FrameMs:64,maxFrameMs:64,framesOver50ms:1});
 assert.equal(cancelled,1);
 events.moveend();assert.equal(cancelled,1);
});
