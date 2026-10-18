import test from 'node:test';
import assert from 'node:assert/strict';
import {TimeNavigation} from '../time-navigation.mjs';
// Regression: the default timers must not be invoked as methods of the
// TimeNavigation instance (browsers throw "Illegal invocation").
test('hover scrubbing works with the default browser timers',async()=>{
 const picked=[];
 const nav=new TimeNavigation(i=>picked.push(i),{delayMs:1});
 const realSet=globalThis.setTimeout;
 globalThis.setTimeout=function(fn,ms){if(this!==undefined&&this!==globalThis)throw new TypeError('Illegal invocation');return realSet(fn,ms);};
 try{nav.hover(7,'mouse');}finally{globalThis.setTimeout=realSet;}
 await new Promise(r=>setTimeout(r,20));
 assert.deepEqual(picked,[7]);
 nav.hover(9,'mouse');nav.cancel();await new Promise(r=>setTimeout(r,20));assert.deepEqual(picked,[7]);
});
