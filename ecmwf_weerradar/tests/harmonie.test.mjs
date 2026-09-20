import test from 'node:test';
import assert from 'node:assert/strict';
import {harmonieFrames,preserveModelTime} from '../forecast-models.mjs';
import {forecastLabel} from '../timeline.mjs';
import {createRegularGrid,createRegularTileSampler,encodeRegularPacket,decodeRegularPacket} from '../regular-grid.mjs';
import {beaufort,BEAUFORT_MS,windLegend,windDirectionText} from '../wind-style.mjs';
import {harmonie} from '../edge-fields/harmonie.mjs';
import {renderTile} from '../tile-renderer.mjs';
const grid={n_lat:3,n_lon:4,lat_min:50,lat_max:54,lon_min:2,lon_max:8};
const bounds=[0,49,10,56],source='/harmonie/harmonie/2026092006-0123456789abcdef/000.bin';
const fields=Object.fromEntries(['cloud_cover','precipitation','temperature_2m','wind_u_component_10m','visibility'].map(v=>[v,{grid}]));
function meta(run='2026-09-20T06:00:00Z',model='harmonie'){return {schema:1,model,version:'2026092006-0123456789abcdef',reference_time:run,valid_times:Array.from({length:60},(_,i)=>new Date(Date.parse(run)+(i+1)*3600000).toISOString()),fields};}
test('all Beaufort boundaries, missing data and negative speeds',()=>{
 assert.equal(beaufort(0),0);assert.ok(Number.isNaN(beaufort(NaN)));assert.ok(Number.isNaN(beaufort(-1)));
 for(let i=1;i<13;i++){assert.equal(beaufort(BEAUFORT_MS[i]*3.6),i);assert.equal(beaufort(BEAUFORT_MS[i]*3.6-1e-6),i-1);}assert.equal(beaufort(200),12);assert.deepEqual(windLegend.labels,['0','3','6','9','12']);
});
test('Dutch wind directions wrap at north and retain their meteorological angle',()=>{
 for(const [degrees,label] of [[0,'N · 0°'],[90,'O · 90°'],[225,'ZW · 225°'],[360,'N · 0°'],[-45,'NW · 315°'],[NaN,'—']])assert.equal(windDirectionText(degrees),label);
});
test('HARMONIE exposes gusts only when that immutable source contains them',()=>{
 const old=meta();assert.ok(!harmonieFrames(old,'harmonie',Date.parse(old.reference_time))[0].modelMeta.variables.includes('wind_gusts_10m'));
 const next=meta();next.fields={...next.fields,wind_gusts_10m:{grid}};assert.ok(harmonieFrames(next,'harmonie',Date.parse(next.reference_time))[0].modelMeta.variables.includes('wind_gusts_10m'));
});
test('HARMONIE frames preserve original hour, model and run in every key',()=>{
 for(const id of ['harmonie','harmonie46']){const frames=harmonieFrames(meta(undefined,id),id,Date.parse('2026-09-20T09:23Z'));assert.equal(frames[0].iso,'2026-09-20T10:00:00.000Z');assert.equal(frames[0].lead,4);assert.equal(frames.at(-1).lead,60);assert.ok(frames[0].url.includes('/'+id+'/'));assert.equal(frames[0].hours,1);}
});
test('wrong model, truncated sequence and stale regional run are rejected',()=>{
 assert.throws(()=>harmonieFrames(meta(),'harmonie46'));
 const broken=meta();broken.valid_times.splice(4,1);assert.throws(()=>harmonieFrames(broken,'harmonie'));
 assert.throws(()=>harmonieFrames(meta(),'harmonie',Date.parse('2026-09-24T00:00Z')));
});
test('regional model switch preserves in-range time and explicitly resets unavailable dates',()=>{
 const f=harmonieFrames(meta(),'harmonie',Date.parse('2026-09-20T06:00Z'));
 assert.deepEqual(preserveModelTime(f,f[9].time),{time:f[9].time,outside:false});assert.deepEqual(preserveModelTime(f,Date.parse('2026-09-25')), {time:f[0].time,outside:true});
});
test('HARMONIE UTC sequence remains valid across both DST transitions and midnight',()=>{
 for(const run of ['2026-03-28T18:00Z','2026-10-24T18:00Z']){const f=harmonieFrames(meta(run),'harmonie',Date.parse(run));for(let i=1;i<f.length;i++)assert.equal(f[i].time-f[i-1].time,3600000);assert.match(forecastLabel(f[10].time,run,'HARMONIE 43').runLabel,/HARMONIE 43-run/);}
});
test('regular grid uses exact nodes, bounded bilinear values, missing outside coverage and circular wind direction',()=>{
 const g=createRegularGrid(grid),v=Float32Array.from({length:12},(_,i)=>i);assert.equal(g.getInterpolatedValue(v,52,4),5);assert.equal(g.getInterpolatedValue(v,51,3),2.5);assert.ok(Number.isNaN(g.getInterpolatedValue(v,51,-1)));
 const d=new Float32Array(12).fill(359);d[1]=1;assert.ok(Math.abs(g.getLinearInterpolatedDirection(d,50,3))<1e-10);
});
test('fast regular tile sampler and cursor interpolation return identical values',()=>{
 const g=createRegularGrid(grid),v=Float32Array.from({length:12},(_,i)=>i),s=createRegularTileSampler(g,v,{z:6,x:32,y:21});
 for(let y=0;y<256;y+=7){const row=s.row(y);for(let x=0;x<256;x+=7)assert.equal(row[x],g.getInterpolatedValue(v,s.latitudes[y],s.longitudes[x]));}
});
test('regular packet retains exact Float32s and rejects wrong source or truncation',()=>{
 const values=Float32Array.from({length:12},(_,i)=>i/3),m={schema:1,kind:'regular',source,variable:'precipitation',bounds,grid};const b=encodeRegularPacket(m,values),r=decodeRegularPacket(b,{source,variable:'precipitation',bounds});assert.deepEqual(r.values,values);
 assert.throws(()=>decodeRegularPacket(b.slice(0,-4),m));assert.throws(()=>decodeRegularPacket(b,{...m,source:source.replace('harmonie/','harmonie46/')}));
});
test('wind map colours classify the same Beaufort value as the point tooltip',()=>{
 const g=createRegularGrid(grid),coord={z:7,x:65,y:42};const a=renderTile({variable:'wind_u_component_10m',grid:g,data:{values:new Float32Array(12).fill(3.5*3.6)}},coord);const b=renderTile({variable:'wind_u_component_10m',grid:g,data:{values:new Float32Array(12).fill(5.3*3.6)}},coord);assert.deepEqual(a,b);assert.ok(a.some(v=>v>0));
});
test('R2 service reads one immutable selected step, decodes rainfall once and never sums it again',async()=>{
 const info={grid,offset:0,length:12,components:1,bytes:1,dtype:1,scale:50,power:3};const fixture={model:'harmonie',version:'2026092006-0123456789abcdef',fields:{precipitation:info},valid_times:['2026-09-20T07:00Z']};const raw=new Uint8Array(12).fill(50),reads=[];
 const bucket={get:async(key,opt)=>{reads.push({key,opt});return key.endsWith('meta.json')?{json:async()=>fixture}:key.endsWith('000.bin')?{arrayBuffer:async()=>raw.buffer}:null;}};
 const cache=new Map(),saved=globalThis.caches;globalThis.caches={default:{match:async k=>cache.get(k.url)?.clone(),put:async(k,v)=>cache.set(k.url,v)}};
 try{const pending=[];const r=await harmonie(new Request('https://test'+source+'?'+new URLSearchParams({v:'1',variable:'precipitation',bounds:bounds.join(',')})),{HARMONIE_MAPS:bucket},{waitUntil:p=>pending.push(p)});assert.equal(r.status,200);const packet=await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();const d=decodeRegularPacket(packet,{source,variable:'precipitation',bounds});assert.ok(d.values.every(v=>v===1));assert.equal(reads.length,2);assert.ok(reads.every(r=>r.key.includes(fixture.version)));await Promise.all(pending);
 }finally{globalThis.caches=saved;}
});
test('regional gusts decode both original m/s components and convert once to km/h',async()=>{
 const raw=new Float32Array(24);raw.fill(-5,0,12);raw.fill(12,12);
 const info={grid,offset:0,length:raw.byteLength,components:2,bytes:4,dtype:0};
 const fixture={model:'harmonie',version:'2026092006-0123456789abcdef',fields:{wind_gusts_10m:info},valid_times:['2026-09-20T07:00Z']};
 const reads=[],sourceStore={get:async(key,opt)=>{if(key.endsWith('meta.json'))return {json:async()=>fixture};reads.push(opt.range);return {arrayBuffer:async()=>raw.buffer.slice(opt.range.offset,opt.range.offset+opt.range.length)};}};
 const saved=globalThis.caches;globalThis.caches={default:{match:async()=>null,put:async()=>{}}};
 try{
  const response=await harmonie(new Request('https://test'+source+'?'+new URLSearchParams({v:'1',variable:'wind_gusts_10m',bounds:bounds.join(',')})),{HARMONIE_MAPS:sourceStore},{waitUntil:()=>{}});
  assert.equal(response.status,200);const packet=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const result=decodeRegularPacket(packet,{source,variable:'wind_gusts_10m',bounds});assert.ok(result.values.every(v=>v===Math.fround(46.8)));assert.equal(reads.length,2);assert.equal(result.directions,undefined);
 }finally{globalThis.caches=saved;}
});
