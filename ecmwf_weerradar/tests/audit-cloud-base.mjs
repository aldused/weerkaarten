// Run against the local review server with original immutable source exports.
// Binary source comparisons are independent of the server crop/read helpers.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {decodeRegularPacket} from '../regular-grid.mjs';
import assert from 'node:assert/strict';
const reports=[];
for(const path of process.argv.slice(2)){
 const meta=JSON.parse(await readFile(join(path,'meta.json'),'utf8'));
 const first=Math.max(0,meta.valid_times.findIndex(t=>Date.parse(t)>=Date.now())),step=String(first).padStart(3,'0');
 const frame=await readFile(join(path,step+'.bin')),source=`/harmonie/${meta.model}/${meta.version}/${step}.bin`,bounds=[2,49,9,55],variable='cloud_layers';
 const response=await fetch('http://127.0.0.1:8794'+source+'?'+new URLSearchParams({v:'1',variable,bounds:bounds.join(',')}));
 assert.equal(response.status,200);const packet=decodeRegularPacket(await response.arrayBuffer(),{source,variable,bounds}),g=packet.metadata.grid,b=meta.fields.cloud_base,c=meta.fields.cloud_cover;
 assert.equal(packet.metadata.hasCloudBase,true);let compared=0,veryLow=0,example;
 const samples=[['cloudHigh',0],['cloudMid',1],['cloudLow',2]];
 for(let y=0;y<g.n_lat;y++)for(let x=0;x<g.n_lon;x++){
  const i=y*g.n_lon+x,lat=g.lat_min+y*(g.lat_max-g.lat_min)/(g.n_lat-1),lon=g.lon_min+x*(g.lon_max-g.lon_min)/(g.n_lon-1);
  const bx=(lon-b.grid.lon_min)*(b.grid.n_lon-1)/(b.grid.lon_max-b.grid.lon_min),by=(lat-b.grid.lat_min)*(b.grid.n_lat-1)/(b.grid.lat_max-b.grid.lat_min);
  const expected=bx<-1e-9||bx>b.grid.n_lon-1+1e-9||by<-1e-9||by>b.grid.n_lat-1+1e-9?NaN:frame.readFloatLE(b.offset+(Math.floor(by+.5+1e-9)*b.grid.n_lon+Math.floor(bx+.5+1e-9))*4);
  assert.ok(Object.is(packet.cloudBase[i],expected),`cloud base differs: ${JSON.stringify({i,lat,lon,bx,by,actual:packet.cloudBase[i],expected})}`);
  const cx=Math.round((lon-c.grid.lon_min)*(c.grid.n_lon-1)/(c.grid.lon_max-c.grid.lon_min)),cy=Math.round((lat-c.grid.lat_min)*(c.grid.n_lat-1)/(c.grid.lat_max-c.grid.lat_min));
  for(const [key,component] of samples){
   const offset=c.offset+((component*c.grid.n_lat+cy)*c.grid.n_lon+cx)*c.bytes;
   const raw=c.dtype===0?frame.readFloatLE(offset):c.dtype===2?Math.fround(frame.readUInt8(offset)/255):NaN;
   assert.equal(packet[key][i],Math.fround(raw*100),key+' differs from source');
  }
  compared++;
  if(expected>=0&&expected<150&&packet.cloudLow[i]>0){veryLow++;if(!example&&lon>=3&&lon<=7&&lat>=50&&lat<=54&&packet.cloudLow[i]>=70)example={lat,lon,base:expected,low:packet.cloudLow[i],high:packet.cloudHigh[i],mid:packet.cloudMid[i]};}
 }
 reports.push({model:meta.model,version:meta.version,validTime:meta.valid_times[first],comparedGridPoints:compared,veryLowPoints:veryLow,example});
}
await writeFile(new URL('./cloud-base-live-audit.json',import.meta.url),JSON.stringify(reports,null,2)+'\n');
console.log(JSON.stringify(reports,null,2));
