// Optional source-to-map audit. Run while the documented ECMWF fixtures remain online.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {initWasm,LruBlockCache} from '@openmeteo/file-reader';
import {getProtocolInstance,defaultOmProtocolSettings,GridFactory} from '@openmeteo/weather-map-layer';
import {decodePacket,createPackedGrid} from '../packed-grid.mjs';
import {decodeRegularPacket,createRegularGrid} from '../regular-grid.mjs';
import {FIELD_ORIGIN,HARMONIE_ORIGIN} from '../field-packets.mjs';
import {normalizeFieldData,nativeIntervalHours} from '../core.mjs';
await initWasm();
const reference=getProtocolInstance({...defaultOmProtocolSettings,fileReaderConfig:{cache:new LruBlockCache(65536,1024),useSAB:false}}).omFileReader;
const bounds=[1,50,11,56],variable='wind_gusts_10m',records=[];
const locations=[['De Bilt',52.1,5.18],['Hamburg',53.55,9.99],['Noordzee',55,3]];
for(const time of ['2026-09-20T1500','2026-09-24T0900','2026-09-29T0000']){
 const run='2026/09/20/0000Z',source=`/data_spatial/ecmwf_ifs/${run}/${time}.om`,interval=nativeIntervalHours((Date.parse(time.slice(0,13)+':'+time.slice(13)+'Z')-Date.parse('2026-09-20T00:00Z'))/3600000);
 const response=await fetch(FIELD_ORIGIN+source+'?'+new URLSearchParams({v:'3',variable,bounds:bounds.join(',')}));assert.equal(response.status,200);
 const packet=decodePacket(await response.arrayBuffer(),{source,variable,bounds}),native=await reference.readVariable('https://openmeteo.s3.us-west-2.amazonaws.com'+source,variable,packet.metadata.ranges);
 for(const row of packet.metadata.rows)for(let x=0;x<row.len;x++)assert.equal(packet.values[row.offset+x],native.values[row.start+((row.x+x)%row.n+row.n)%row.n]);
 const grid=GridFactory.create(packet.metadata.gridData,packet.metadata.ranges),packed=createPackedGrid(packet.metadata),raw=locations.map(([,lat,lon])=>grid.getInterpolatedValue(native.values,lat,lon,'monotone'));
 normalizeFieldData(native,variable,interval);normalizeFieldData(packet,variable,interval);
 const samples=locations.map(([name,lat,lon],i)=>{const expected=grid.getInterpolatedValue(native.values,lat,lon,'monotone'),actual=packed.getInterpolatedValue(packet.values,lat,lon,'monotone');assert.equal(actual,expected);return {name,rawMs:raw[i],convertedKmh:expected,mapKmh:actual,mapLabel:Math.round(actual)};});
 records.push({model:'ecmwf_ifs',run,time,intervalHours:interval,nodes:packet.values.length,maxTransportError:0,samples});
 console.log('ECMWF gusts exact',time,interval+'h');
}
const project=process.env.WEERLAB_SOURCE_DIR||'/Users/aldus/KNMI_Project/weerlab';
for(const model of ['harmonie','harmonie46']){
 const metaPath=`${project}/${model}_canvas_meta.json`,metaText=await readFile(metaPath,'utf8'),original=JSON.parse(metaText),latest=await(await fetch(`${HARMONIE_ORIGIN}/harmonie/${model}/latest.json`)).json();
 assert.equal(latest.reference_time,original.run_utc,'Original and published runs must match');
 const info=original.parameters.windstoten,raw=await readFile(`${project}/${info.file}`),g=info.grid||original.grid,ny=raw.readUInt16LE(0),nx=raw.readUInt16LE(2);
 assert.equal(raw.readUInt16LE(6),2);assert.equal(raw[8],0);
 for(const step of [0,24,59]){
  const source=`/harmonie/${model}/${latest.version}/${String(step).padStart(3,'0')}.bin`,response=await fetch(HARMONIE_ORIGIN+source+'?'+new URLSearchParams({v:'1',variable,bounds:bounds.join(',')}));assert.equal(response.status,200);
  const packet=decodeRegularPacket(await response.arrayBuffer(),{source,variable,bounds}),p=packet.metadata.grid,x0=Math.round((p.lon_min-g.lon_min)/(g.lon_max-g.lon_min)*(nx-1)),y0=Math.round((p.lat_min-g.lat_min)/(g.lat_max-g.lat_min)*(ny-1));
  const expected=new Float32Array(p.n_lon*p.n_lat),component=(x,y,c)=>raw.readFloatLE(16+((step*2+c)*ny*nx+y*nx+x)*4);
  for(let y=0;y<p.n_lat;y++)for(let x=0;x<p.n_lon;x++){const i=y*p.n_lon+x;expected[i]=Math.hypot(component(x+x0,y+y0,0),component(x+x0,y+y0,1))*3.6;assert.equal(packet.values[i],expected[i]);}
  const grid=createRegularGrid(p),samples=locations.map(([name,lat,lon])=>{const a=grid.getInterpolatedValue(expected,lat,lon),b=grid.getInterpolatedValue(packet.values,lat,lon);assert.equal(a,b);return {name,sourceConvertedKmh:a,mapKmh:b,mapLabel:Math.round(b)};});
  records.push({model,run:latest.reference_time,version:latest.version,time:latest.valid_times[step],intervalHours:1,nodes:expected.length,maxTransportError:0,samples});
 }
 assert.equal(await readFile(metaPath,'utf8'),metaText,'Source changed during audit');
 console.log(model,'gusts exact against original Weerlab components, 3 time steps');
}
await writeFile(new URL('wind-live-audit.json',import.meta.url),JSON.stringify({checkedAt:new Date().toISOString(),bounds,records},null,2)+'\n');
console.log('All',records.length,'fields match original source after m/s to km/h conversion.');process.exit(0);
