import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gfsFrames,gfsFieldFile,discoverGFS} from '../gfs-runs.mjs';
import {normalizeFieldData,HOUR} from '../core.mjs';
import {hasIsobars} from '../isobars.mjs';
const run=Date.parse('2026-09-26T00:00Z');
function metadata(){const valid_times=[];for(let h=0;h<=384;h+=h<120?1:3)valid_times.push(new Date(run+h*HOUR).toISOString());return {reference_time:new Date(run).toISOString(),completed:true,valid_times,variables:['temperature_2m','precipitation','cloud_cover','cloud_cover_low','cloud_cover_mid','cloud_cover_high','wind_u_component_10m','wind_v_component_10m','pressure_msl','visibility','wind_gusts_10m','temperature_850hPa','temperature_500hPa']};}
test('GFS spans ten days with hourly and three-hour accumulation intervals',()=>{const frames=gfsFrames(metadata(),metadata(),run+3*HOUR);assert.equal(frames.at(-1).time,frames[0].time+240*HOUR);assert.equal(frames.find(f=>f.lead===120).hours,1);assert.equal(frames.find(f=>f.lead===123).hours,3);assert.ok(hasIsobars(frames[0].modelMeta));assert.match(gfsFieldFile(frames.at(-1),'pressure_msl'),/ncep_gfs025.*2026-10-06T0300.om$/);assert.equal(gfsFieldFile(frames[0],'precipitation'),frames[0].url);});
test('GFS rejects mismatched runs, absent pressure times and incomplete horizon',()=>{const a=metadata(),b=metadata();assert.throws(()=>gfsFrames(a,{...b,reference_time:'2026-09-26T06:00Z'},run));assert.throws(()=>gfsFrames(a,{...b,valid_times:b.valid_times.slice(0,100)},run));assert.throws(()=>gfsFrames(a,b,run+200*HOUR));});
test('GFS preserves hPa pressure and converts wind and three-hour rain once',()=>{const data={values:new Float32Array([1012]),metadata:{source:'/data_spatial/ncep_gfs025/test'}};normalizeFieldData(data,'pressure_msl');assert.equal(data.values[0],1012);const rain={values:new Float32Array([6])};normalizeFieldData(rain,'precipitation',3);normalizeFieldData(rain,'precipitation',3);assert.equal(rain.values[0],2);const wind={values:new Float32Array([10])};normalizeFieldData(wind,'wind_u_component_10m');assert.equal(wind.values[0],36);});
test('GFS falls back to matching completed run when latest runs differ',async()=>{const a=metadata();const frames=await discoverGFS(async url=>url.includes('ncep_gfs025/latest')?{...a,reference_time:'2026-09-26T06:00Z'}:a,run+3*HOUR);assert.equal(frames[0].run,a.reference_time);});
test('GFS covers at least 240 hours when the first hour is not a three-hour boundary',()=>{const frames=gfsFrames(metadata(),metadata(),run+8*HOUR);assert.ok(frames.at(-1).time-frames[0].time>=240*HOUR);assert.ok(frames.at(-1).time-frames[0].time<243*HOUR);});
test('GFS regular packets preserve cloud layers and derived wind directions',async()=>{
 const {createFieldHandler}=await import('../edge-fields/handler.mjs');
 const {decodeRegularPacket}=await import('../regular-grid.mjs');
 const handler=createFieldHandler({now:()=>run+HOUR,getCache:()=>({match:async()=>null,put:async()=>{}}),readField:async(url,variable,ranges)=>{const count=ranges.reduce((n,r)=>n*(r.end-r.start),1);return {values:new Float32Array(count).fill(variable==='cloud_cover'?80:30),...(variable==='wind_u_component_10m'?{directions:new Float32Array(count).fill(270)}:{})};}});
 const source='/data_spatial/ncep_gfs013/2026/09/26/0000Z/2026-09-26T0100.om',bounds=[2,49,9,55];
 for(const variable of ['cloud_layers','wind_u_component_10m']){
  const response=await handler(new Request('https://test.invalid'+source+'?'+new URLSearchParams({v:'1',variable,bounds:bounds.join(',')})),{}, {waitUntil:()=>{}});
  assert.equal(response.status,200);
  const data=decodeRegularPacket(await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(),{source,variable,bounds});
  if(variable==='cloud_layers'){assert.equal(data.values[0],80);assert.equal(data.cloudLow[0],30);}else assert.equal(data.directions[0],270);
 }
});
