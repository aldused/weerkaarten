// Opt-in integration audit against the current native Open-Meteo OM source.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {initWasm,LruBlockCache} from '@openmeteo/file-reader';
import {getProtocolInstance,defaultOmProtocolSettings,GridFactory} from '@openmeteo/weather-map-layer';
import {decodeProjectedPacket,createProjectedGrid,projectedGridData} from '../projected-grid.mjs';
import {FIELD_ORIGIN} from '../field-packets.mjs';
import {normalizeFieldData} from '../core.mjs';
import {discoverEuropeanHarmonie} from '../forecast-models.mjs';
await initWasm();
const reader=getProtocolInstance({...defaultOmProtocolSettings,fileReaderConfig:{cache:new LruBlockCache(65536,1024),useSAB:false}}).omFileReader;
const bounds=[2,48,12,56],records=[],locations=[['De Bilt',52.1,5.18],['Hamburg',53.55,9.99],['Noordzee',55,3],['Parijs',48.86,2.35]];
for(const model of ['knmi_harmonie_arome_europe','dmi_harmonie_arome_europe']){
 const frames=await discoverEuropeanHarmonie(async u=>{const r=await fetch(u);assert(r.ok);return r.json();},model);
 const selected=[frames[0],frames[Math.min(24,frames.length-2)],frames.at(-1)];
 for(const frame of selected)for(const variable of ['precipitation','cloud_cover','temperature_2m','visibility','wind_u_component_10m','wind_gusts_10m','snowfall_water_equivalent']){
  const source=new URL(frame.url).pathname,start=performance.now(),response=await fetch(frame.url+'?'+new URLSearchParams({v:'1',variable,bounds:bounds.join(',')}));assert.equal(response.status,200,source+' '+variable);
  const buffer=await response.arrayBuffer(),elapsedMs=performance.now()-start,packet=decodeProjectedPacket(buffer,{source,variable,bounds});
  const native=await reader.readVariable('https://openmeteo.s3.us-west-2.amazonaws.com'+source,variable==='wind_u_component_10m'?'wind_speed_10m':variable,packet.metadata.ranges);
  assert.deepEqual(packet.values,native.values);assert.deepEqual(packet.directions,native.directions);assert.equal(packet.scaleFactor,native.scaleFactor);
  const grid=GridFactory.create(projectedGridData(model),packet.metadata.ranges),packed=createProjectedGrid(packet.metadata),raw=locations.map(([,lat,lon])=>grid.getInterpolatedValue(native.values,lat,lon,'monotone'));
  normalizeFieldData(packet,variable,1);normalizeFieldData(native,variable,1);
  const samples=locations.map(([name,lat,lon],i)=>{const expected=grid.getInterpolatedValue(native.values,lat,lon,'monotone'),actual=packed.getInterpolatedValue(packet.values,lat,lon,'monotone');assert.equal(actual,expected);return {name,raw:raw[i],map:actual,...(packet.directions?{direction:packed.getLinearInterpolatedDirection(packet.directions,lat,lon)}:{})};});
  let min=Infinity,max=-Infinity,positive=0;for(const v of packet.values)if(Number.isFinite(v)){min=Math.min(min,v);max=Math.max(max,v);if(v>0)positive++;}
  records.push({model,run:frame.modelMeta.reference_time,time:frame.iso,lead:frame.lead,variable,bytes:buffer.byteLength,elapsedMs,serverTiming:response.headers.get('Server-Timing'),cache:response.headers.get('X-Weerlab-Cache'),nodes:packet.values.length,maxTransportError:0,min,max,positive,samples});
  console.log(model,frame.iso,variable,Math.round(elapsedMs)+'ms',min,max);
 }
}
await writeFile(new URL('harmonie-europe-live-audit.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),bounds,records},null,2)+'\n');
console.log('All',records.length,'native fields match transport and map interpolation exactly.');process.exit(0);
