import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {createFieldHandler} from '../edge-fields/handler.mjs';
import {decodePacket} from '../packed-grid.mjs';
import {FieldPackets} from '../field-packets.mjs';
const path='/data_spatial/ecmwf_ifs/2026/09/20/0000Z/2026-09-24T0900.om',bounds=[5,51,6,52];
const url=(variable='precipitation',source=path)=>'https://test.example'+source+'?'+new URLSearchParams({v:'3',variable,bounds:bounds.join(',')});
function fixture(){
 const entries=new Map(),cache={match:async key=>entries.get(typeof key==='string'?key:key.url)?.clone(),put:async(key,value)=>entries.set(typeof key==='string'?key:key.url,value.clone()),delete:async key=>entries.delete(typeof key==='string'?key:key.url),keys:async()=>[...entries.keys()].map(url=>({url}))};
 const reads=[],pending=[],handler=createFieldHandler({getCache:()=>cache,now:()=>Date.parse('2026-09-20T12:00Z'),readField:async(source,variable,ranges)=>{reads.push({source,variable,ranges});return {values:new Float32Array(ranges[1].end-ranges[1].start).fill(variable==='precipitation'?1.25:80),scaleFactor:10};}});
 return {cache,entries,reads,handler,pending,ctx:{waitUntil:p=>pending.push(p)}};
}
test('source service cold and cached responses decode identically with one gzip layer',async()=>{
 const f=fixture(),read=async u=>{const r=await f.handler(new Request(u),{},f.ctx);const bytes=gunzipSync(Buffer.from(await r.arrayBuffer()));return {r,packet:decodePacket(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),{source:new URL(u).pathname,variable:new URL(u).searchParams.get('variable'),bounds})};};
 const first=await read(url());await Promise.all(f.pending);const cached=await read(url());
 assert.equal(first.r.headers.get('X-Weerlab-Cache'),'MISS');assert.equal(cached.r.headers.get('X-Weerlab-Cache'),'HIT');assert.equal(f.reads.length,1);assert.deepEqual(cached.packet.values,first.packet.values);assert.ok(first.packet.values.every(v=>v===1.25));
 assert.ok([...f.entries.values()].every(r=>!r.headers.has('Content-Encoding')),'cache stores plain packets');
 await read(url('cloud_cover'));await read(url('precipitation',path.replace('0000Z','0600Z')));assert.equal(f.reads.length,3,'run and variable never share a cache entry');
});
test('public service rejects arbitrary sources, fields, non-Europe bounds and invalid model times',async()=>{
 const f=fixture();
 for(const u of [url('arbitrary'),url().replace('bounds=5%2C51%2C6%2C52','bounds=1%2C-90%2C6%2C90'),url().replace('/2026/09/20/','/2026/09/21/'),url().replace('T0900.om','T9900.om'),url()+'&bounds=5,51,6,52',url().replace('/data_spatial/','/secrets/'),url().replace('v=3','v=999')])assert.ok((await f.handler(new Request(u),{},f.ctx)).status>=400,u);
 assert.equal(f.reads.length,0);
});
test('browser packet cache avoids repeat requests and rejects obsolete requests and mismatched identities',async()=>{
 const f=fixture();let calls=0;
 const client=new FieldPackets({storage:{open:async()=>f.cache},fetcher:async u=>{calls++;const r=await f.handler(new Request(u),{},f.ctx);const plain=gunzipSync(Buffer.from(await r.arrayBuffer()));return new Response(plain);}});
 const file='https://native.example'+path,a=await client.read(file,'precipitation',bounds);await new Promise(r=>setTimeout(r,5));const b=await client.read(file,'precipitation',bounds);assert.deepEqual(a.values,b.values);assert.equal(calls,1);
 const controller=new AbortController();controller.abort();await assert.rejects(client.read(file,'precipitation',bounds,controller.signal),{name:'AbortError'});assert.equal(calls,1);
 const bad=new FieldPackets({storage:undefined,fetcher:async()=>new Response(new Uint8Array([1,2,3,4,5,6,7,8]))});await assert.rejects(bad.read(file,'precipitation',bounds));
});
test('packet persistence has an enforced byte and entry budget',async()=>{
 const f=fixture(),client=new FieldPackets({maxEntries:2,maxBytes:15});
 for(let i=0;i<4;i++)await f.cache.put('https://test/'+i,new Response(new Uint8Array(10),{headers:{'X-Stored-At':String(Date.now()+i),'Content-Length':'10'}}));
 await client.trim(f.cache);assert.equal(f.entries.size,1);assert.ok(f.entries.has('https://test/3'));
});
test('unavailable browser storage never prevents a valid network field from loading',async()=>{
 const f=fixture();let calls=0;
 const fetcher=async u=>{calls++;const r=await f.handler(new Request(u),{},f.ctx);return new Response(gunzipSync(Buffer.from(await r.arrayBuffer())));};
 for(const storage of [{open:async()=>{throw Error('Storage disabled');}},{open:async()=>({match:async()=>{throw Error('Cache read failed');}})}]){
  const client=new FieldPackets({storage,fetcher}),field=await client.read('https://native.example'+path,'precipitation',bounds);
  assert.ok(field.values.every(v=>v===1.25));
 }
 assert.equal(calls,2);
});
test('model discovery keeps source metadata exact with a short cache for latest and unfinished runs',async()=>{
 const f=fixture();let calls=0,complete=true;
 const handler=createFieldHandler({getCache:()=>f.cache,fetcher:async()=>{calls++;return Response.json({completed:complete,reference_time:'2026-09-20T00:00Z',valid_times:['2026-09-20T00:00Z']});}});
 for(const [tail,ttl] of [['latest.json',30],['2026/09/20/0000Z/meta.json',3600],['2026/09/20/0600Z/meta.json',30]]){
  if(tail.includes('0600Z'))complete=false;
  const req=new Request('https://test/data_spatial/ecmwf_ifs/'+tail),r=await handler(req,{},f.ctx);
  const body=JSON.parse(gunzipSync(Buffer.from(await r.arrayBuffer())));
  assert.equal(body.completed,complete);assert.equal(r.headers.get('Cache-Control'),`public, max-age=${ttl}`);
  await Promise.all(f.pending);const again=await handler(req,{},f.ctx);assert.equal(again.headers.get('X-Weerlab-Cache'),'HIT');
 }
 assert.equal(calls,3);
});
test('an obsolete server request stops source work and cannot publish a cache entry',async()=>{
 const f=fixture(),controller=new AbortController();let began;
 const handler=createFieldHandler({getCache:()=>f.cache,now:()=>Date.parse('2026-09-20T12:00Z'),readField:async(_u,_v,_r,signal)=>{
  began=true;controller.abort();signal.throwIfAborted();
 }});
 const r=await handler(new Request(url(),{signal:controller.signal}),{},f.ctx);
 assert.equal(began,true);assert.equal(r.status,499);assert.equal(f.pending.length,0);assert.equal(f.entries.size,0);
});
