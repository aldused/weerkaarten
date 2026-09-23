// Opt-in integration audit: pressure-level temperature transport through the
// field worker handler against the native OM source and the Open-Meteo API.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {initWasm,LruBlockCache} from '@openmeteo/file-reader';
import {getProtocolInstance,defaultOmProtocolSettings} from '@openmeteo/weather-map-layer';
import {createFieldHandler} from '../edge-fields/handler.mjs';
import {decodeRegularPacket,createRegularGrid} from '../regular-grid.mjs';
import {decodeProjectedPacket,createProjectedGrid} from '../projected-grid.mjs';
await initWasm();
const reader=getProtocolInstance({...defaultOmProtocolSettings,fileReaderConfig:{cache:new LruBlockCache(65536,1024),useSAB:false}}).omFileReader;
const store=new Map(),cache={match:async k=>store.get(k.url)?.clone(),put:async(k,r)=>{store.set(k.url,r);}};
const handle=createFieldHandler({readField:(u,v,r)=>reader.readVariable(u,v,r),getCache:()=>cache});
const ROOT='https://openmeteo.s3.us-west-2.amazonaws.com',bounds=[2,49,9,55],records=[];
const api={ecmwf_ifs025:'ecmwf_ifs025',dwd_icon_d2:'icon_d2',knmi_harmonie_arome_europe:'knmi_harmonie_arome_europe'};
const places=[['De Bilt',52.1,5.18],['Maastricht',50.85,5.69],['Noordzee',54,4]];
for(const model of Object.keys(api)){
 const latest=await (await fetch(`${ROOT}/data_spatial/${model}/latest.json`)).json();
 const time=latest.valid_times.map(t=>t.replace('Z',':00Z').replace(/:00:00Z$/,':00Z')).find(t=>Date.parse(t)>Date.parse(latest.reference_time)+11*3600e3);
 const iso=new Date(Date.parse(time)).toISOString(),run=latest.reference_time;
 const source=`/data_spatial/${model}/${run.slice(0,4)}/${run.slice(5,7)}/${run.slice(8,10)}/${run.slice(11,13)}00Z/${iso.slice(0,13)}00.om`;
 const point=await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${places.map(p=>p[1])}&longitude=${places.map(p=>p[2])}&hourly=temperature_850hPa,temperature_500hPa&models=${api[model]}&start_hour=${iso.slice(0,16)}&end_hour=${iso.slice(0,16)}`)).json();
 for(const variable of ['temperature_850hPa','temperature_500hPa']){
  const response=await handle(new Request(`https://x${source}?`+new URLSearchParams({v:'1',variable,bounds:bounds.join(',')})),{},{waitUntil(){}});
  assert.equal(response.status,200,model+variable);
  const buffer=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  const projected=model==='knmi_harmonie_arome_europe',packet=projected?decodeProjectedPacket(buffer,{source,variable,bounds}):decodeRegularPacket(buffer,{source,variable,bounds});
  const grid=projected?createProjectedGrid(packet.metadata):createRegularGrid(packet.metadata.grid);
  const samples=places.map(([name,lat,lon],i)=>{const map=grid.getInterpolatedValue(packet.values,lat,lon,'monotone'),ref=(Array.isArray(point)?point[i]:point).hourly[variable][0];return {name,map:+map.toFixed(2),openMeteoPoint:ref,diff:+(map-ref).toFixed(2)};});
  for(const s of samples)assert(Math.abs(s.diff)<1.2,`${model} ${variable} ${s.name} wijkt ${s.diff} K af`);
  records.push({model,run,time:iso,variable,grid:packet.metadata.grid??'native rotated',nodes:packet.values.length,samples});
  console.log(model,iso,variable,JSON.stringify(samples));
 }
}
await writeFile(new URL('upper-air-live-audit.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),bounds,records},null,2)+'\n');
console.log('Upper-air audit OK:',records.length,'fields');process.exit(0);
