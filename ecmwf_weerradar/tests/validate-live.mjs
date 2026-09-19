// Read the public native OM children independently, then compare the exact
// conversion/interpolation functions used by the map and point readouts.
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {getProtocolInstance,defaultOmProtocolSettings,domainOptions,GridFactory,getRanges} from '@openmeteo/weather-map-layer';
import {initWasm,OmHttpBackendPool,OmDataType,LruBlockCache} from '@openmeteo/file-reader';
import {HOUR,fileURL,normalizeFieldData,fmt,localDateKey} from '../core.mjs';
import {discoverForecastRuns,combinedForecastFrames} from '../forecast-runs.mjs';

const sourceDocs='https://github.com/open-meteo/open-meteo/blob/main/Sources/App/EcmwfEcpds/EcmwfEcpdsVariable.swift';
const now=Date.now();
async function json(url){const r=await fetch(url);assert.ok(r.ok,`${r.status}: ${url}`);return r.json();}
const metas=await discoverForecastRuns(json,now);
const frames=combinedForecastFrames(metas,now);
assert.ok(frames.at(-1).time-frames[0].time>=240*HOUR,'A full ten-day timeline is required');
const domain=domainOptions.find(x=>x.value==='ecmwf_ifs');
await initWasm();
const cache=new LruBlockCache(65536,1024),pool=new OmHttpBackendPool();
const reader=getProtocolInstance({...defaultOmProtocolSettings,fileReaderConfig:{useSAB:false,cache}}).omFileReader;
const bounds=[0,48,15,54],ranges=getRanges(domain.grid,bounds),grid=GridFactory.create(domain.grid,ranges);
const points=[
  {name:'Arnhem',lat:51.96,lon:5.94},{name:'Paris',lat:48.8566,lon:2.3522},{name:'Berlin',lat:52.52,lon:13.405},
  {name:'Brussels',lat:50.85,lon:4.35},{name:'Frankfurt',lat:50.1,lon:8.7},
  {name:'Hamburg',lat:53.55,lon:10},{name:'Groningen',lat:53.2,lon:6.6},
];
const midnight=frames.find((f,i)=>i&&localDateKey(f.time)!==localDateKey(frames[i-1].time));
const sourceChangeIndex=frames.findIndex(frame=>frame.sourceChanged);
const screenshotTime=Date.parse('2026-09-20T13:00:00Z');
const requested=[
  ['first',frames[0]],
  ['local-midnight',midnight],
  ['screenshot-20-september-15-cest',frames.find(frame=>frame.time===screenshotTime)],
  ['first-three-hour-interval',frames.find(frame=>frame.hours===3)],
  ['last-newest-run-frame',sourceChangeIndex>0?frames[sourceChangeIndex-1]:null],
  ['first-older-run-frame',sourceChangeIndex>0?frames[sourceChangeIndex]:null],
  ['last-six-hour-interval',frames.findLast(frame=>frame.hours===6)],
];
const selectedByTime=new Map();
for(const [reason,frame] of requested){
  if(!frame)continue;
  const selection=selectedByTime.get(frame.time)??{frame,reasons:[]};
  selection.reasons.push(reason);selectedByTime.set(frame.time,selection);
}
const selected=[...selectedByTime.values()].sort((a,b)=>a.frame.time-b.frame.time);
if(sourceChangeIndex>0){
  const before=frames[sourceChangeIndex-1],after=frames[sourceChangeIndex];
  assert.notEqual(before.reference_time,after.reference_time,'Source boundary must name different runs');
  assert.equal(before.time,after.time-after.hours*HOUR,'Source boundary cannot overlap or skip a precipitation period');
}
const rawVariables=['temperature_2m','cloud_cover','precipitation','snowfall_water_equivalent','wind_u_component_10m','wind_v_component_10m'];
const results=[];
const sample=values=>Object.fromEntries(points.map(p=>[p.name,grid.getInterpolatedValue(values,p.lat,p.lon,'monotone')]));
const close=(a,b,tolerance,message)=>assert.ok(Number.isNaN(a)&&Number.isNaN(b)||Math.abs(a-b)<=tolerance,`${message}: ${a} vs ${b}`);
for(const {frame,reasons} of selected){
  assert.equal(frame.url,fileURL(frame.modelMeta,frame.time),'All frame fields must use their declared model run');
  assert.equal(frame.lead,(frame.time-Date.parse(frame.reference_time))/HOUR,'Forecast lead must use the selected frame run');
  const raw=await pool.withReader(frame.url,cache,async root=>{
    const fields={};
    for(const variable of rawVariables){
      const child=await root.getChildByName(variable);assert.ok(child,variable);
      try{fields[variable]={values:await child.read({type:OmDataType.FloatArray,ranges,intoSAB:false}),scaleFactor:child.scaleFactor(),addOffset:child.addOffset()};}
      finally{child.dispose();}
    }
    return fields;
  });
  const fields={};
  for(const variable of rawVariables.filter(v=>v!=='wind_v_component_10m')){
    const displayed=normalizeFieldData(await reader.readVariable(frame.url,variable,ranges),variable,frame.hours);
    const input=raw[variable],wind=variable==='wind_u_component_10m',accumulation=variable==='precipitation'||variable==='snowfall_water_equivalent';
    const expected=new Float32Array(input.values.length);
    let min=Infinity,max=-Infinity,valid=0,maxValueError=0,maxDirectionError=0;
    for(let i=0;i<expected.length;i++){
      const v=input.values[i];
      expected[i]=wind?Math.hypot(v,raw.wind_v_component_10m.values[i])*3.6:accumulation?Math.max(0,v)/frame.hours:v;
      close(displayed.values[i],expected[i],wind?2e-5:1e-6,`${variable} node${i}`);
      if(Number.isFinite(v)){min=Math.min(min,v);max=Math.max(max,v);valid++;maxValueError=Math.max(maxValueError,Math.abs(displayed.values[i]-expected[i]));}
      if(wind&&expected[i]>.01){
        const degrees=(Math.atan2(v,raw.wind_v_component_10m.values[i])*180/Math.PI+180)%360;
        const error=Math.abs(((displayed.directions[i]-degrees+540)%360)-180);
        assert.ok(error<.002,`Wind direction node${i}: ${error}°`);maxDirectionError=Math.max(maxDirectionError,error);
      }
    }
    assert.equal(valid,input.values.length,`Missing values: ${variable}`);
    if(variable==='cloud_cover')assert.ok(min>=0&&max<=100);
    if(variable==='temperature_2m')assert.ok(min>-80&&max<65);
    if(accumulation)assert.ok(min>=0);
    const expectedPoints=sample(expected),displayedPoints=sample(displayed.values);
    for(const p of points)close(displayedPoints[p.name],expectedPoints[p.name],wind?2e-5:1e-6,`${variable} ${p.name}`);
    fields[variable]={rawMin:min,rawMax:max,count:valid,scaleFactor:input.scaleFactor,addOffset:input.addOffset,maxValueError,rawAtPoints:sample(input.values),displayedAtPoints:displayedPoints,...(wind?{maxDirectionErrorDegrees:maxDirectionError,directionAtPoints:Object.fromEntries(points.map(p=>[p.name,grid.getLinearInterpolatedDirection(displayed.directions,p.lat,p.lon)]))}:{})};
  }
  results.push({reasons,reference_time:frame.reference_time,olderRun:frame.olderRun,sourceChanged:frame.sourceChanged,valid:frame.iso,localTime:fmt(frame.time,{dateStyle:'short',timeStyle:'short'}),periodStart:new Date(frame.time-frame.hours*HOUR).toISOString(),intervalHours:frame.hours,leadHours:frame.lead,source:frame.url,fields});
  console.log('Raw OM verified:',frame.iso,`run ${frame.reference_time}`,`${frame.hours}h`,JSON.stringify(fields.precipitation.displayedAtPoints),reasons.join(', '));
}
const report={checkedAt:new Date().toISOString(),forecastFrom:new Date(now).toISOString(),sourceDocs,runs:[...new Set(frames.map(frame=>frame.reference_time))],discoveredRuns:metas.map(meta=>({reference_time:meta.reference_time,completed:meta.completed,lastValidTime:meta.valid_times?.at(-1)})),grid:domain.grid,interpolation:'monotone',bounds,points,frames:frames.length,horizonHours:(frames.at(-1).time-frames[0].time)/HOUR,results};
await writeFile(new URL('./live-validation.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log('Native ECMWF validation passed, including 1h/3h/6h sums, midnight, per-frame runs, source boundary and raw u/v');
// The upstream module creates a persistent worker pool in Node.
process.exit(0);
