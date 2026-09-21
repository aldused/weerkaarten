import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {createFieldHandler} from '../edge-fields/handler.mjs';
import {harmonie} from '../edge-fields/harmonie.mjs';
import {FieldPackets} from '../field-packets.mjs';
import {decodeRegularPacket} from '../regular-grid.mjs';
import {CLOUD_KEYS} from '../cloud-fields.mjs';
const bounds=[4,51,6,53];
function cache(){const entries=new Map();return {match:async k=>entries.get(k.url)?.clone(),put:async(k,v)=>entries.set(k.url,v.clone())};}
const plain=async response=>{assert.equal(response.status,200);const b=gunzipSync(Buffer.from(await response.arrayBuffer()));return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);};

for(const model of ['ecmwf_ifs','knmi_harmonie_arome_europe','dmi_harmonie_arome_europe'])test(model+': one immutable cloud packet preserves all original layers and total',async()=>{
  const source='/data_spatial/'+model+'/2026/09/21/0000Z/2026-09-21T0600.om',reads=[],pending=[];
  const values={cloud_cover:99,cloud_cover_low:13,cloud_cover_mid:47,cloud_cover_high:91};
  const handler=createFieldHandler({getCache:()=>cache(),now:()=>Date.parse('2026-09-21T06:00Z'),readField:async(file,variable,ranges)=>{
    reads.push({file,variable,ranges});return {values:new Float32Array((ranges[0].end-ranges[0].start)*(ranges[1].end-ranges[1].start)).fill(values[variable]),scaleFactor:1};
  }});
  const client=new FieldPackets({storage:null,fetcher:async u=>new Response(await plain(await handler(new Request(u),{},{waitUntil:p=>pending.push(p)})))});
  const packet=await client.read('https://native.example'+source,'cloud_cover',bounds);
  assert.equal(packet.metadata.variable,'cloud_layers');assert.equal(reads.length,4);
  assert.ok(reads.every(r=>r.file.endsWith(source)&&JSON.stringify(r.ranges)===JSON.stringify(reads[0].ranges)));
  assert.ok(packet.values.every(v=>v===99));
  for(const [i,key] of CLOUD_KEYS.entries())assert.ok(packet[key].every(v=>v===[13,47,91][i]),key);
  await Promise.all(pending);
});
test('regional HARMONIE cloud packet keeps high/middle/low order and converts fractions exactly once',async()=>{
  const source='/harmonie/harmonie/2026092100-0123456789abcdef/000.bin';
  const grid={n_lat:3,n_lon:4,lat_min:50,lat_max:54,lon_min:2,lon_max:8};
  const components=[.9,.4,.1].map(v=>new Float32Array(12).fill(v));
  const raw=new Float32Array(36);components.forEach((a,i)=>raw.set(a,i*12));
  const meta={model:'harmonie',version:'2026092100-0123456789abcdef',valid_times:['2026-09-21T01:00Z'],fields:{cloud_cover:{grid,offset:0,components:3,bytes:4,dtype:0}}};
  const bucket={get:async(key,opt)=>key.endsWith('meta.json')?{json:async()=>meta}:{arrayBuffer:async()=>raw.buffer.slice(opt.range.offset,opt.range.offset+opt.range.length)}};
  const previous=globalThis.caches;globalThis.caches={default:cache()};const pending=[];
  try{
    const variable='cloud_layers',response=await harmonie(new Request('https://test'+source+'?'+new URLSearchParams({v:'1',variable,bounds:bounds.join(',')})),{HARMONIE_MAPS:bucket},{waitUntil:p=>pending.push(p)});
    const bytes=await plain(response),packet=decodeRegularPacket(bytes,{source,variable,bounds});
    for(const [key,expected] of [['values',90],['cloudHigh',90],['cloudMid',40],['cloudLow',10]])assert.ok(packet[key].every(v=>Math.abs(v-expected)<.00001),key);
    assert.throws(()=>decodeRegularPacket(bytes.slice(0,-4),{source,variable,bounds}),/Afgekort/);await Promise.all(pending);
  }finally{globalThis.caches=previous;}
});
