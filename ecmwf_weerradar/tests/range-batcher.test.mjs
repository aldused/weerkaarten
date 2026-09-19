import test from 'node:test';
import assert from 'node:assert/strict';
import {RangeBatcher} from '../range-batcher.mjs';
const bytes=Uint8Array.from({length:256},(_,i)=>i);
function response(start,end,total=256){return new Response(bytes.slice(start,end),{status:206,headers:{'Content-Range':`bytes ${start}-${end-1}/${total}`}});}
function recorder(){const calls=[];return {calls,fetcher:async(url,{headers,signal})=>{const [start,last]=headers.Range.slice(6).split('-').map(Number);calls.push({url,start,end:last+1,signal});return response(start,last+1);}};}

test('native browser fetch keeps its required global receiver',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async function(){assert.equal(this,globalThis);return response(0,64);};
 try{
  const batch=new RangeBatcher({delayMs:1000,retries:0}),read=batch.read('run',0,64,256);
  batch.flush();assert.deepEqual(await read,bytes.slice(0,64));
 }finally{globalThis.fetch=original;}
});

test('adjacent blocks become one request and return exactly the original bytes',async()=>{
 const spy=recorder(),batch=new RangeBatcher({...spy,delayMs:1000});
 const a=batch.read('run-a',64,128,256),b=batch.read('run-a',0,64,256),c=batch.read('run-a',128,192,256);batch.flush();
 assert.deepEqual(await a,bytes.slice(64,128));assert.deepEqual(await b,bytes.slice(0,64));assert.deepEqual(await c,bytes.slice(128,192));
 assert.equal(spy.calls.length,1);assert.equal(spy.calls[0].end,192);
});
test('different runs, gaps and group byte budgets stay separate',async()=>{
 const spy=recorder(),batch=new RangeBatcher({...spy,delayMs:1000,maxBytes:80});
 const reads=[batch.read('run-a',0,64,256),batch.read('run-a',64,128,256),batch.read('run-a',192,200,256),batch.read('run-b',0,64,256)];batch.flush();await Promise.all(reads);
 assert.equal(spy.calls.length,4);
});
test('cancelling one member preserves the other, cancelling all aborts the shared fetch',async()=>{
 let resolveFetch,requestSignal;
 const batch=new RangeBatcher({delayMs:1000,fetcher:async(url,{signal})=>{requestSignal=signal;return new Promise(resolve=>{resolveFetch=resolve;});}});
 const ca=new AbortController(),cb=new AbortController();
 const a=batch.read('run',0,64,256,ca.signal),b=batch.read('run',64,128,256,cb.signal);const rejected=assert.rejects(a,{name:'AbortError'});batch.flush();ca.abort();
 assert.equal(requestSignal.aborted,false);resolveFetch(response(0,128));await rejected;assert.deepEqual(await b,bytes.slice(64,128));
 const cc=new AbortController(),cd=new AbortController();
 const c=batch.read('run',0,64,256,cc.signal),d=batch.read('run',64,128,256,cd.signal);const rejections=Promise.all([assert.rejects(c,{name:'AbortError'}),assert.rejects(d,{name:'AbortError'})]);batch.flush();cc.abort();cd.abort();
 assert.equal(requestSignal.aborted,true);resolveFetch(response(0,128));await rejections;
});
test('cancelled pending blocks make no request and cancelled queue entries release their slot',async()=>{
 const spy=recorder(),batch=new RangeBatcher({...spy,delayMs:1000,concurrency:1}),controller=new AbortController();
 const read=batch.read('run',0,64,256,controller.signal),rejected=assert.rejects(read,{name:'AbortError'});controller.abort();batch.flush();await rejected;assert.equal(spy.calls.length,0);
});
test('malformed ranges, ignored Range and truncated bytes can never enter the cache',async()=>{
 for(const fetcher of [async()=>new Response(bytes),async()=>response(1,64),async()=>new Response(bytes.slice(0,32),{status:206,headers:{'Content-Range':'bytes 0-63/256'}})]){
  const batch=new RangeBatcher({fetcher,retries:1,delayMs:1000}),read=batch.read('run',0,64,256);batch.flush();await assert.rejects(read,/ECMWF-deelantwoord/);
 }
});
test('a temporary network failure is retried without changing bytes',async()=>{
 let attempts=0;const batch=new RangeBatcher({delayMs:1000,fetcher:async()=>{if(!attempts++)throw new Error('offline');return response(0,64);}});
 const read=batch.read('run',0,64,256);batch.flush();assert.deepEqual(await read,bytes.slice(0,64));assert.equal(attempts,2);
});

test('cancelling a queued request while a fetch occupies the slot never downloads it',async()=>{
 let finish;const calls=[];
 const batch=new RangeBatcher({delayMs:1000,concurrency:1,fetcher:async(url,{headers})=>{
  calls.push(url);if(url==='busy')await new Promise(resolve=>{finish=resolve;});
  const [start,last]=headers.Range.slice(6).split('-').map(Number);return response(start,last+1);
 }});
 const busy=batch.read('busy',0,64,256);batch.flush();
 const cancelled=new AbortController(),queued=batch.read('cancelled',0,64,256,cancelled.signal);
 const rejection=assert.rejects(queued,{name:'AbortError'});batch.flush();cancelled.abort();
 const later=batch.read('later',64,128,256);batch.flush();finish();
 await Promise.all([busy,rejection,later]);assert.deepEqual(calls,['busy','later']);
});
test('edge range URLs are distinct without changing source file identity or other hosts',async()=>{
 const {EDGE_ORIGIN,rangeRequestURL}=await import('../data-transport.mjs');
 const url=EDGE_ORIGIN+'/data_spatial/ecmwf_ifs/run.om';
 assert.equal(rangeRequestURL(url,0,64),url+'?range=0-63');
 assert.equal(rangeRequestURL('https://openmeteo.s3.amazonaws.com/run.om',0,64),'https://openmeteo.s3.amazonaws.com/run.om');
});
test('foreground range requests prefer existing edge bytes and retain their run/file path',async()=>{
 const {EDGE_ORIGIN,rangeRequestURL,prioritizeSelectedFile}=await import('../data-transport.mjs');
 const url=EDGE_ORIGIN+'/data_spatial/ecmwf_ifs/selected.om';
 prioritizeSelectedFile(url);assert.equal(rangeRequestURL(url,64,128),url+'?range=64-127&cached=1');
 assert.equal(rangeRequestURL(EDGE_ORIGIN+'/data_spatial/ecmwf_ifs/next.om',64,128),EDGE_ORIGIN+'/data_spatial/ecmwf_ifs/next.om?range=64-127');
});
