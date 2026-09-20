import test from 'node:test';
import assert from 'node:assert/strict';
import {BootstrapFiles} from '../file-bootstrap.mjs';
import {FastBrowserBlockCache} from '../fast-block-cache.mjs';
const url='https://example.com/run/file.om';
const response=()=>new Response(Uint8Array.from({length:32},(_,i)=>i),{status:206,headers:{'Content-Range':'bytes 0-31/32'}});
function mockCache(){return {size:async()=>undefined,seeds:[],async seedTail(...args){this.seeds.push(args);}};}
test('concurrent fields share a single suffix request and reuse the known immutable file length',async()=>{
 const cache=mockCache();let calls=0;
 const pool=new BootstrapFiles(cache,{fetcher:async(u,options)=>{calls++;assert.ok(u.endsWith('/file.om?tail=262144'));assert.equal(options.headers.Range,'bytes=-262144');return response();}});
 const [a,b]=await Promise.all([pool.open(url),pool.open(url)]);assert.equal(a,b);assert.equal(await a.count(),32);assert.equal(calls,1);assert.equal(cache.seeds.length,1);
 await pool.open(url);assert.equal(calls,1);
 await pool.open(url.replace('run','other'));assert.equal(calls,2);
});
test('the persisted footer supplies length without a network HEAD or another suffix',async()=>{
 const pool=new BootstrapFiles({size:async()=>123456},{fetcher:()=>{throw Error('unnecessary fetch');}});
 assert.equal(await (await pool.open(url)).count(),123456);
});
test('malformed suffixes, incomplete data and HTTP failures are never seeded and can be retried',async()=>{
 for(const bad of [new Response(new Uint8Array(32)),new Response(new Uint8Array(3),{status:206,headers:{'Content-Range':'bytes 0-31/32'}}),new Response(new Uint8Array(16),{status:206,headers:{'Content-Range':'bytes 0-15/32'}})]){
  const cache=mockCache();let calls=0;
  const pool=new BootstrapFiles(cache,{fetcher:async()=>calls++?response():bad});
  await assert.rejects(pool.open(url),/ECMWF/);assert.equal(cache.seeds.length,0);
  await pool.open(url);assert.equal(calls,2);assert.equal(cache.seeds.length,1);
 }
});
test('cancelling one consumer does not discard another field; the last consumer aborts the source',async()=>{
 const controllers=[];let finish;
 const pool=new BootstrapFiles(mockCache(),{fetcher:async(u,{signal})=>{controllers.push(signal);await new Promise(resolve=>{finish=resolve;});signal.throwIfAborted();return response();}});
 const a=new AbortController(),b=new AbortController();
 const first=pool.open(url,a.signal),second=pool.open(url,b.signal);const rejection=assert.rejects(first,{name:'AbortError'});
 await new Promise(resolve=>setImmediate(resolve));a.abort();await rejection;assert.equal(controllers[0].aborted,false);
 finish();await second;
 const c=new AbortController(),third=pool.open(url+'-next',c.signal);const rejectThird=assert.rejects(third,{name:'AbortError'});
 await new Promise(resolve=>setImmediate(resolve));c.abort();await rejectThird;await new Promise(resolve=>setImmediate(resolve));assert.equal(controllers[1].aborted,true);finish();
});
test('tail seed uses end-anchored original block identities and never refetches seeded bytes',async t=>{
 const prior=globalThis.caches,entries=new Map();
 globalThis.caches={open:async()=>({match:async u=>entries.get(u)?.clone(),put:async(u,r)=>entries.set(u,r.clone()),keys:async()=>[],delete:async()=>true})};t.after(()=>{globalThis.caches=prior;});
 const cache=new FastBrowserBlockCache({blockSize:8,batchRanges:false});
 await assert.rejects(cache.seedTail(url,new Uint8Array(7),21),/cacheblokken/);
 const data=Uint8Array.from({length:21},(_,i)=>i);
 await cache.seedTail(url,data,21);
 for(const [index,expected] of [[0,data.slice(13)],[1,data.slice(5,13)],[2,data.slice(0,5)]])assert.deepEqual(await cache.get(`${url}/block/${index}`,()=>{throw Error('duplicate fetch');},21),expected);
});
