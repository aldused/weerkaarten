import test from 'node:test';
import assert from 'node:assert/strict';
import {retryFetch} from '../retry-fetch.mjs';
const settings={delayMs:0,timeoutMs:1000};
test('temporary server and network failures recover without changing request identity',async()=>{
 let calls=0;
 const r=await retryFetch('https://same-run/field',{headers:{test:'same'}},async(u,o)=>{assert.equal(u,'https://same-run/field');assert.equal(o.headers.test,'same');if(++calls===1)throw new TypeError('network');return new Response('',{status:calls===2?502:200});},settings);
 assert.equal(r.status,200);assert.equal(calls,3);
});
test('missing runs fail immediately and permanent server failures have bounded retries',async()=>{
 for(const [status,count] of [[404,1],[400,1],[503,3]]){let calls=0;const r=await retryFetch('https://test',{},async()=>{calls++;return new Response('',{status});},settings);assert.equal(r.status,status);assert.equal(calls,count);}
});
test('an obsolete time step cancels a retry instead of loading the old run',async()=>{
 const c=new AbortController();let calls=0;
 await assert.rejects(retryFetch('https://test',{signal:c.signal},async()=>{calls++;c.abort();throw new TypeError('network');},settings),{name:'AbortError'});assert.equal(calls,1);
});

test('a timeout or interrupted response body retries the complete same-field request',async()=>{
 let calls=0;const bytes=await retryFetch('https://test',{},async()=>{calls++;return new Response('complete');},{...settings,readResponse:async r=>{if(calls===1)throw new DOMException('body timeout','TimeoutError');if(calls===2)throw new TypeError('body interrupted');return r.text();}});
 assert.equal(bytes,'complete');assert.equal(calls,3);
});

test('browser AbortError during a timed-out body is retried, while user cancellation is not',async()=>{
 let calls=0;const result=await retryFetch('https://test',{},async(u,{signal})=>{calls++;return {status:200,signal};},{...settings,timeoutMs:5,readResponse:async r=>{if(calls===1)await new Promise((resolve,reject)=>{r.signal.addEventListener('abort',()=>reject(new DOMException('body cancelled','AbortError')),{once:true});setTimeout(resolve,50);});return 'loaded';}});
 assert.equal(result,'loaded');assert.equal(calls,2);
});
