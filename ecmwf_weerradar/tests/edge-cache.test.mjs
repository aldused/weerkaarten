import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../edge-cache/worker.mjs';
const path='/data_spatial/ecmwf_ifs/2026/09/19/0600Z/2026-09-20T0400.om';
const bytes=Uint8Array.from({length:32},(_,i)=>i);
function cache(){const entries=new Map();return {entries,match:async key=>entries.get(key.url)?.clone(),put:async(key,value)=>{assert.equal(value.status,200);entries.set(key.url,value.clone());}};}
const request=(suffix=path,options={})=>new Request('https://example.com'+suffix,options);
const range=(start=0,end=15)=>({headers:{Range:`bytes=${start}-${end}`}});
test('edge cache preserves exact bytes, range, CORS and source identity across visitors',async()=>{
 let calls=0;const store=cache();const handle=createHandler({getCache:()=>store,fetcher:async(url,options)=>{
  calls++;assert.equal(options.redirect,'manual');assert.equal(options.cache,'no-store');assert.equal(options.cf,undefined);assert.equal(url,'https://openmeteo.s3.amazonaws.com'+path);assert.deepEqual(Object.keys(options.headers),['Range']);
  return new Response(bytes.slice(0,16),{status:206,headers:{'Content-Range':'bytes 0-15/32',ETag:'test'}});
 }});
 for(const state of ['MISS','HIT']){const r=await handle(request(path,range()));assert.equal(r.status,206);assert.equal(r.headers.get('X-Weerlab-Cache'),state);assert.equal(r.headers.get('Content-Range'),'bytes 0-15/32');assert.equal(r.headers.get('Access-Control-Allow-Origin'),'*');assert.deepEqual(new Uint8Array(await r.arrayBuffer()),bytes.slice(0,16));}
 assert.equal(calls,1);
});
test('ranges and model runs never collide, concurrent identical misses are deduplicated',async()=>{
 let calls=0;const store=cache();const handle=createHandler({getCache:()=>store,fetcher:async(url,{headers})=>{calls++;const [start,end]=headers.Range.slice(6).split('-').map(Number);return new Response(bytes.slice(start,end+1),{status:206,headers:{'Content-Range':`bytes ${start}-${end}/32`}});}});
 const results=await Promise.all([handle(request(path,range())),handle(request(path,range())),handle(request(path,range(16,31))),handle(request(path.replace('0600Z','0000Z'),range()))]);
 assert.equal(calls,3);assert.equal(store.entries.size,4);assert.deepEqual(new Uint8Array(await results[2].arrayBuffer()),bytes.slice(16));
});
test('cold HEAD redirects to the fixed source; a validated footer populates HEAD without a full-file fetch',async()=>{
 let calls=0;const store=cache();const handle=createHandler({getCache:()=>store,fetcher:async()=>{calls++;return new Response(bytes.slice(16),{status:206,headers:{'Content-Range':'bytes 16-31/32'}});}});
 const cold=await handle(request(path,{method:'HEAD'}));assert.equal(cold.status,307);assert.equal(cold.headers.get('Location'),'https://openmeteo.s3.amazonaws.com'+path);assert.equal(calls,0);
 await handle(request(path,range(16,31)));
 const warm=await handle(request(path,{method:'HEAD'}));assert.equal(warm.status,200);assert.equal(warm.headers.get('Content-Length'),'32');assert.equal((await warm.arrayBuffer()).byteLength,0);assert.equal(calls,1);
});
test('metadata uses a short latest/incomplete TTL and never caches source failures',async()=>{
 for(const [file,completed,ttl] of [['latest.json',true,30],['2026/09/19/0600Z/meta.json',false,30],['2026/09/19/0600Z/meta.json',true,3600]]){
  const store=cache(),handle=createHandler({getCache:()=>store,fetcher:async()=>Response.json({completed})});
  const r=await handle(request('/data_spatial/ecmwf_ifs/'+file));assert.equal(r.headers.get('Cache-Control'),`public, max-age=${ttl}`);
 }
 for(const response of [new Response(null,{status:302,headers:{Location:'https://other.example'}}),new Response('missing',{status:404}),new Response('bad',{status:500}),new Response(bytes),new Response(bytes.slice(0,15),{status:206,headers:{'Content-Range':'bytes 0-15/32'}}),new Response(bytes.slice(0,16),{status:206,headers:{'Content-Range':'bytes 1-16/32'}})]){
  const store=cache(),handle=createHandler({getCache:()=>store,fetcher:async()=>response});
  assert.ok((await handle(request(path,range()))).status>=400);assert.equal(store.entries.size,0);
 }
});
test('only bounded immutable ECMWF requests are permitted and no arbitrary proxying is possible',async()=>{
 let calls=0;const handle=createHandler({getCache:()=>cache(),fetcher:async()=>{calls++;throw Error('must not fetch');}});
 for(const req of [request('/https://other.example'),request(path+'?url=other'),request(path),request(path,{method:'POST'}),request(path,range(0,524288)),request(path,range(8,7)),request(path,{headers:{Range:'bytes=0-1,4-5'}})])assert.ok((await handle(req)).status>=400);
 assert.equal(calls,0);assert.equal((await handle(request(path,{method:'OPTIONS'}))).status,204);
});
test('range-specific URLs are validated and share the same canonical edge cache',async()=>{
 let calls=0;const store=cache(),handle=createHandler({getCache:()=>store,fetcher:async()=>{calls++;return new Response(bytes.slice(0,16),{status:206,headers:{'Content-Range':'bytes 0-15/32'}});}});
 const first=await handle(request(path+'?range=0-15',range()));assert.equal(first.status,206);assert.equal(first.headers.get('Cache-Control'),'no-store');
 const next=await handle(request(path,range()));assert.equal(next.headers.get('X-Weerlab-Cache'),'HIT');assert.equal(calls,1);
 assert.equal((await handle(request(path+'?range=1-16',range()))).status,400);
 assert.ok((await handle(request(path+'?range=0-15',{method:'HEAD'}))).status>=400);
});
test('foreground misses redirect with no duplicate origin fetch; prepared ranges serve the same bytes',async()=>{
 let calls=0;const store=cache(),handle=createHandler({getCache:()=>store,fetcher:async()=>{calls++;return new Response(bytes.slice(0,16),{status:206,headers:{'Content-Range':'bytes 0-15/32'}});}});
 const foreground=request(path+'?range=0-15&cached=1',range());
 const miss=await handle(foreground);assert.equal(miss.status,307);assert.equal(calls,0);assert.equal(miss.headers.get('Location'),'https://openmeteo.s3.amazonaws.com'+path);
 await handle(request(path+'?range=0-15',range()));assert.equal(calls,1);
 const hit=await handle(foreground);assert.equal(hit.status,206);assert.equal(hit.headers.get('X-Weerlab-Cache'),'HIT');assert.deepEqual(new Uint8Array(await hit.arrayBuffer()),bytes.slice(0,16));assert.equal(calls,1);
 assert.equal((await handle(request(path+'?range=0-15&cached=other',range()))).status,404);
});
