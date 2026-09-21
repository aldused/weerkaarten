import test from 'node:test';
import assert from 'node:assert/strict';
import {gunzipSync} from 'node:zlib';
import {GridFactory} from '@openmeteo/weather-map-layer';
import {europeanHarmonieFrames,discoverEuropeanHarmonie,modelView,BENELUX_VIEW,MODELS} from '../forecast-models.mjs';
import {projectedGridData,projectedRanges,createProjectedGrid,projectedPacket,encodeProjectedPacket,decodeProjectedPacket} from '../projected-grid.mjs';
import {normalizeFieldData} from '../core.mjs';
import {createFieldHandler} from '../edge-fields/handler.mjs';
import {FieldPackets} from '../field-packets.mjs';
const models=['knmi_harmonie_arome_europe','dmi_harmonie_arome_europe'],run='2026-09-21T00:00Z',now=Date.parse('2026-09-21T01:00Z'),bounds=[3,50,7,54];
const raw=()=>({completed:true,reference_time:run,variables:['cloud_cover','precipitation','temperature_2m','wind_speed_10m','wind_direction_10m','wind_gusts_10m','visibility'],valid_times:Array.from({length:61},(_,i)=>new Date(Date.parse(run)+i*3600000).toISOString())});
for(const model of models){
 test(model+' sorts real hourly instants; one source run owns every forecast time',()=>{
  const r=raw();r.valid_times.reverse();const f=europeanHarmonieFrames(r,model,now);assert.equal(f.length,60);assert.equal(f[0].lead,1);assert.equal(f.at(-1).lead,60);assert(f.every(f=>f.hours===1&&f.url.includes('/'+model+'/2026/09/21/0000Z/')&&f.modelMeta.modelId===model));assert(f[0].modelMeta.variables.includes('wind_u_component_10m'));assert.equal(f[0].iso,'2026-09-21T01:00:00.000Z');
 });
 test(model+' rejects holes, duplicates, incomplete runs, invalid cycle and absent wind direction',()=>{
  for(const alter of [r=>r.valid_times.splice(12,1),r=>r.valid_times.push(r.valid_times[5]),r=>r.completed=false,r=>r.reference_time='2026-09-21T00:30Z',r=>r.variables=r.variables.filter(v=>v!=='wind_direction_10m')]){const r=raw();alter(r);assert.throws(()=>europeanHarmonieFrames(r,model,now));}
 });
 test(model+' exact projected packet preserves source samples, units, angles and missing domain',()=>{
  const ranges=projectedRanges(model,bounds),g=GridFactory.create(projectedGridData(model),ranges),count=g.nx*g.ny,values=Float32Array.from({length:count},(_,i)=>5000+i%1000),directions=new Float32Array(count).fill(359),source='/data_spatial/'+model+'/2026/09/21/0000Z/2026-09-21T1200.om',identity={source,variable:'visibility',bounds};
  const b=encodeProjectedPacket(projectedPacket({values,directions,scaleFactor:.05},model,ranges,bounds,identity)),p=decodeProjectedPacket(b,identity),pg=createProjectedGrid(p.metadata);
  assert.deepEqual(p.values,values);assert.deepEqual(p.directions,directions);
  for(const [lat,lon] of [[52.1,5.18],[51,4],[53,6]])assert.equal(pg.getInterpolatedValue(p.values,lat,lon,'monotone'),g.getInterpolatedValue(values,lat,lon,'monotone'));
  assert.ok(pg.getInterpolatedValue(p.values,52.1,5.18,'monotone')>5000,'visibility is not folded into 0–360 degrees');assert(Math.abs(pg.getLinearInterpolatedDirection(directions,52.1,5.18)-359)<1e-3);assert(Number.isNaN(pg.getInterpolatedValue(values,30,35,'monotone')));
  assert.throws(()=>decodeProjectedPacket(b,{...identity,source:source.replace('0000Z','0300Z')}));assert.throws(()=>decodeProjectedPacket(b,{...identity,variable:'precipitation'}));assert.throws(()=>decodeProjectedPacket(b.slice(0,-4),identity));
 });
}
test('HARMONIE incomplete latest falls back by provider cadence and never uses ECMWF',async()=>{
 const calls=[],latest={...raw(),completed:false,reference_time:'2026-09-21T03:00Z'};
 const frames=await discoverEuropeanHarmonie(async u=>{calls.push(u);return u.endsWith('latest.json')?latest:raw();},models[1],now);
 assert.equal(calls.length,2);assert(calls[1].includes('/2026/09/21/0000Z/'));assert.equal(frames[0].modelMeta.reference_time,run);
});
test('Benelux fits countries rather than the entire regional data export',()=>{
 assert.deepEqual(modelView('harmonie'),BENELUX_VIEW);assert.deepEqual(modelView('harmonie46'),BENELUX_VIEW);assert(BENELUX_VIEW[1][0]-BENELUX_VIEW[0][0]<5.1);assert(BENELUX_VIEW[1][1]-BENELUX_VIEW[0][1]<4.3);assert(MODELS.harmonie.label.endsWith('Benelux'));assert.notDeepEqual(modelView(models[0]),BENELUX_VIEW);
});
test('projected field service and browser transport isolate both providers, runs and parameters',async()=>{
 const entries=new Map(),cache={match:async r=>entries.get(r.url||r)?.clone(),put:async(r,v)=>entries.set(r.url||r,v.clone())},reads=[],pending=[],ctx={waitUntil:p=>pending.push(p)};
 const handle=createFieldHandler({getCache:()=>cache,now:()=>now,readField:async(source,variable,ranges)=>{reads.push({source,variable});const n=(ranges[0].end-ranges[0].start)*(ranges[1].end-ranges[1].start);return {values:new Float32Array(n).fill(variable==='wind_speed_10m'?5:50000),scaleFactor:10,...(variable==='wind_speed_10m'?{directions:new Float32Array(n).fill(270)}:{})};}});
 const client=new FieldPackets({storage:undefined,fetcher:async u=>{const r=await handle(new Request(u),{},ctx);assert.equal(r.status,200);return new Response(gunzipSync(Buffer.from(await r.arrayBuffer())));}});
 for(const model of models){const path='https://test/data_spatial/'+model+'/2026/09/21/0000Z/2026-09-21T1200.om';const wind=await client.read(path,'wind_u_component_10m',bounds);assert(wind.directions.every(x=>x===270));normalizeFieldData(wind,'wind_u_component_10m',1);assert(wind.values.every(x=>x===18));const vis=await client.read(path,'visibility',bounds);assert(vis.values.every(x=>x===50000));await Promise.all(pending);await client.read(path,'visibility',bounds);}
 assert.equal(reads.length,4);assert.equal(reads[0].variable,'wind_speed_10m');assert.equal(entries.size,4);
});
test('fallback metadata cannot substitute a different model cycle',async()=>{
 const latest={...raw(),completed:false,reference_time:'2026-09-21T06:00Z'};
 await assert.rejects(discoverEuropeanHarmonie(async u=>u.endsWith('latest.json')?latest:{...raw(),reference_time:'2026-09-21T06:00Z'},models[1],now),/Geen volledige/);
});
