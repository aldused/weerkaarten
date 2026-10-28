import test from 'node:test';import assert from 'node:assert/strict';
import worker from '../edge-native/worker.mjs';
test('native endpoint adds browser access and caches immutable field bytes',async()=>{
 const old=globalThis.fetch,oldCaches=globalThis.caches,stored=new Map(),jobs=[];let reads=0;
 globalThis.caches={default:{match:async k=>stored.get(k.url)?.clone(),put:async(k,v)=>{stored.set(k.url,v);}}};
 globalThis.fetch=async url=>{reads++;assert.equal(url,'https://data.weerlab.nl/ifs-interactive/0p1/2026102800-direct-1/078_precipitation_total.bin.gz');return new Response('gzip-packet',{headers:{'Content-Type':'application/gzip'}});};
 try{const req=new Request('https://edge/ifs-interactive/0p1/2026102800-direct-1/078_precipitation_total.bin.gz'),ctx={waitUntil:p=>jobs.push(p)};
 const first=await worker.fetch(req,{},ctx);assert.equal(first.headers.get('Access-Control-Allow-Origin'),'*');assert.match(first.headers.get('Cache-Control'),/immutable/);assert.equal(await first.text(),'gzip-packet');await Promise.all(jobs);const second=await worker.fetch(req,{},ctx);assert.equal(await second.text(),'gzip-packet');assert.equal(reads,1);
 }finally{globalThis.fetch=old;globalThis.caches=oldCaches;}
});
test('native endpoint cannot proxy unrelated files and does not accept writes',async()=>{
 for(const [url,method,status] of [['https://edge/private.json','GET',404],['https://edge/ifs-interactive/0p25/current.json','POST',405]])assert.equal((await worker.fetch(new Request(url,{method}),{},{})).status,status);
 assert.equal((await worker.fetch(new Request('https://edge/',{method:'OPTIONS'}),{},{})).status,204);
});
