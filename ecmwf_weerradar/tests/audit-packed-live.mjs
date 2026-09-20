// Optional actual-source audit, independent of packField/encodePacket.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {initWasm,LruBlockCache} from '@openmeteo/file-reader';
import {getProtocolInstance,defaultOmProtocolSettings,GridFactory} from '@openmeteo/weather-map-layer';
import {decodePacket,createPackedGrid} from '../packed-grid.mjs';
import {FIELD_ORIGIN} from '../field-packets.mjs';
import {normalizeFieldData,nativeIntervalHours} from '../core.mjs';
await initWasm();
const reference=getProtocolInstance({...defaultOmProtocolSettings,fileReaderConfig:{cache:new LruBlockCache(65536,1024),useSAB:false}}).omFileReader;
const bounds=[-1,49,10,56],results=[];
for(const [run,time] of [['2026/09/19/1800Z','2026-09-20T0800'],['2026/09/20/0000Z','2026-09-20T1000'],['2026/09/20/0000Z','2026-09-24T0900'],['2026/09/20/0000Z','2026-09-29T0000']]){
 const source=`/data_spatial/ecmwf_ifs/${run}/${time}.om`;
 const runISO=run.slice(0,10).replaceAll('/','-')+'T'+run.slice(11,13)+':00Z',validISO=time.slice(0,13)+':'+time.slice(13)+'Z';
 const interval=nativeIntervalHours((Date.parse(validISO)-Date.parse(runISO))/3600000);
 for(const variable of ['cloud_cover','precipitation','temperature_2m','visibility','snowfall_water_equivalent','wind_u_component_10m']){
  const t=performance.now(),r=await fetch(FIELD_ORIGIN+source+'?'+new URLSearchParams({v:'3',variable,bounds:bounds.join(',')}));assert.ok(r.ok,`${r.status}: ${source} ${variable}`);
  const packet=decodePacket(await r.arrayBuffer(),{source,variable,bounds});
  const native=await reference.readVariable('https://openmeteo.s3.us-west-2.amazonaws.com'+source,variable,packet.metadata.ranges);
  assert.equal(packet.scaleFactor,native.scaleFactor);
  const expected=new Float32Array(packet.values.length);
  for(const row of packet.metadata.rows)for(let x=0;x<row.len;x++){
   const index=row.start+((row.x+x)%row.n+row.n)%row.n,to=row.offset+x;
   expected[to]=native.values[index];
   if(packet.directions)assert.equal(packet.directions[to],native.directions[index]);
  }
  assert.deepEqual(packet.values,expected,'Every transported native value is exact');
  const digest=v=>createHash('sha256').update(new Uint8Array(v.buffer,v.byteOffset,v.byteLength)).digest('hex');
  const rawSHA256=digest(expected),transportSHA256=digest(packet.values);
  normalizeFieldData(native,variable,interval);normalizeFieldData(packet,variable,interval);
  const grid=GridFactory.create(packet.metadata.gridData,packet.metadata.ranges),packed=createPackedGrid(packet.metadata);
  const points=[];
  for(const [name,lat,lon] of [['De Bilt',52.1,5.18],['London',51.5,-.12],['Hamburg',53.55,9.99],['North Sea',55,3]]){
   const a=grid.getInterpolatedValue(native.values,lat,lon,'monotone'),b=packed.getInterpolatedValue(packet.values,lat,lon,'monotone');
   assert.equal(b,a);points.push({name,lat,lon,sourceConverted:a,mapValue:b});
  }
  results.push({run,time,variable,interval,sourcePoints:native.values.length,transportPoints:packet.values.length,rawSHA256,transportSHA256,directionsExact:!!packet.directions,points,ms:Math.round(performance.now()-t)});
 }
 console.log('Source exact:',run,time,interval+'h');
}
await writeFile('tests/packed-live-audit.json',JSON.stringify({checkedAt:new Date().toISOString(),bounds,results},null,2)+'\n');
console.log('All 24 real fields exactly match original native source');process.exit(0);
