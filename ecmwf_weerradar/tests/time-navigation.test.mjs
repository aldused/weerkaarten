import test from 'node:test';
import assert from 'node:assert/strict';
import {TimeNavigation,isTimeNavigationKey} from '../time-navigation.mjs';
function clock(){let next=0;const jobs=new Map();return {setTimer:f=>{jobs.set(++next,f);return next;},clearTimer:id=>jobs.delete(id),flush:()=>{const pending=[...jobs.values()];jobs.clear();pending.forEach(f=>f());},jobs};}
test('scrubbing many hours dispatches only the last choice; touch remains click driven',()=>{
 const timers=clock(),seen=[],nav=new TimeNavigation(i=>seen.push(i),timers);
 for(let i=0;i<100;i++)nav.hover(i,'mouse');
 assert.equal(timers.jobs.size,1);assert.deepEqual(seen,[]);timers.flush();assert.deepEqual(seen,[99]);
 nav.hover(100,'touch');nav.hover(101,'pen');timers.flush();assert.deepEqual(seen,[99]);
});
test('cached hours show immediately and cannot be overwritten by a pending hover',()=>{
 const timers=clock(),seen=[],nav=new TimeNavigation(i=>seen.push(i),{...timers,cached:i=>i===4});
 nav.hover(3,'mouse');nav.hover(4,'mouse');assert.deepEqual(seen,[4]);assert.equal(timers.jobs.size,0);timers.flush();assert.deepEqual(seen,[4]);
});
test('leaving the hour strip or an explicit key/click cancels delayed mouse input',()=>{
 const timers=clock(),seen=[],nav=new TimeNavigation(i=>seen.push(i),timers);
 nav.hover(7,'mouse');nav.hover(7,'mouse');assert.equal(timers.jobs.size,1);nav.cancel();timers.flush();assert.deepEqual(seen,[]);
});
test('arrows work on the focused map/buttons, while editors, composition and shortcuts keep their keys',()=>{
 const plain={closest:()=>null};assert.equal(isTimeNavigationKey({key:'ArrowRight',target:plain}),true);
 assert.equal(isTimeNavigationKey({key:'ArrowLeft',target:plain}),true);
 for(const modifier of ['altKey','ctrlKey','metaKey','shiftKey','isComposing'])assert.equal(isTimeNavigationKey({key:'ArrowRight',target:plain,[modifier]:true}),false);
 for(const key of ['ArrowLeft','ArrowRight','Home','End'])assert.equal(isTimeNavigationKey({key,target:{closest:()=>({})}}),false);
 assert.equal(isTimeNavigationKey({key:'a',target:plain}),false);
});

test('the forecast slider advances real time steps while other range inputs retain native editing',()=>{
 assert.equal(isTimeNavigationKey({key:'ArrowRight',target:{closest:()=>({id:'time-slider'})}}),true);
 assert.equal(isTimeNavigationKey({key:'ArrowRight',target:{closest:()=>({id:'opacity'})}}),false);
});
