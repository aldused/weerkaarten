// Compare local or deployed packets against the original immutable ICON-D2 bytes.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {decodeRegularPacket} from '../regular-grid.mjs';
const directory=process.argv[2];
const origin=process.env.ICON_AUDIT_ORIGIN||'http://127.0.0.1:8794';
if(!directory)throw Error('Pass the immutable ICON-D2 export directory');
const meta=JSON.parse(await readFile(join(directory,'meta.json'),'utf8'));
assert.equal(meta.model,'icond2');assert.equal(meta.source,'DWD via Weerlab');
const step=meta.valid_times.findIndex(t=>Date.parse(t)>=Date.now());assert.ok(step>=0,'Snapshot must still have future steps');
const file=String(step).padStart(3,'0')+'.bin',frame=await readFile(join(directory,file));
const source=`/harmonie/icond2/${meta.version}/${file}`,bounds=[2,49,9,55],reports=[];
for(const variable of ['cloud_layers','precipitation','temperature_2m','wind_u_component_10m','wind_gusts_10m','visibility']){
 const response=await fetch(origin+source+'?'+new URLSearchParams({v:'1',variable,bounds:bounds.join(',')}));assert.equal(response.status,200);
 const packet=decodeRegularPacket(await response.arrayBuffer(),{source,variable,bounds});
 const info=meta.fields[variable==='cloud_layers'?'cloud_cover':variable],g=packet.metadata.grid,s=info.grid;
 const sample=(x,y,c=0)=>{const offset=info.offset+((c*s.n_lat+y)*s.n_lon+x)*info.bytes;const raw=info.dtype===0?frame.readFloatLE(offset):frame.readUInt8(offset);return Math.fround(info.dtype===1?(raw/info.scale)**info.power:info.dtype===2?raw/255:raw);};
 let points=0;
 for(let y=0;y<g.n_lat;y++)for(let x=0;x<g.n_lon;x++){
  const lon=g.lon_min+x*(g.lon_max-g.lon_min)/(g.n_lon-1),lat=g.lat_min+y*(g.lat_max-g.lat_min)/(g.n_lat-1);
  const sx=Math.round((lon-s.lon_min)*(s.n_lon-1)/(s.lon_max-s.lon_min)),sy=Math.round((lat-s.lat_min)*(s.n_lat-1)/(s.lat_max-s.lat_min)),i=y*g.n_lon+x;
  if(variable==='cloud_layers'){
   const values=[sample(sx,sy,0),sample(sx,sy,1),sample(sx,sy,2)];
   for(const [c,key] of ['cloudHigh','cloudMid','cloudLow'].entries())assert.equal(packet[key][i],Math.fround(values[c]*100),key);
   assert.equal(packet.values[i],Math.fround(100*Math.max(...values)));assert.equal(packet.cloudBase,undefined);
  }else if(variable.startsWith('wind_')){
   const u=sample(sx,sy,0),v=sample(sx,sy,1);assert.equal(packet.values[i],Math.fround(Math.hypot(u,v)*3.6),variable);
   if(packet.directions)assert.equal(packet.directions[i],Math.fround((Math.atan2(-u,-v)*180/Math.PI+360)%360));
  }else assert.equal(packet.values[i],sample(sx,sy),variable);
  points++;
 }
 reports.push({variable,points,exactSourceMatch:true});
}
const result={origin,model:meta.model,version:meta.version,run:meta.reference_time,validTime:meta.valid_times[step],horizon:meta.valid_times.length,reports};
await writeFile(process.env.ICON_AUDIT_OUTPUT||new URL('./icon-d2-live-audit.json',import.meta.url),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
