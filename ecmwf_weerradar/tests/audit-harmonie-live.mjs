import {readFile,writeFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {decodeRegularPacket,createRegularGrid} from '../regular-grid.mjs';
import {beaufort} from '../wind-style.mjs';
const root=new URL('../../harmonie-switch-qa/',import.meta.url),origin='https://weerlab-harmonie-fields.dawn-term-a69f.workers.dev',bounds=[-5.625,47.04018214480665,16.875,55.77657301866768],records=[];
for(const [model,folder] of [['harmonie','export43'],['harmonie46','export46']]){
 const latest=await (await fetch(`${origin}/harmonie/${model}/latest.json`)).json(),version=latest.version,path=new URL(folder+'/'+version+'/',root),manifest=JSON.parse(await readFile(new URL('meta.json',path)));
 assert.equal(manifest.reference_time,latest.reference_time);
 for(const step of [0,24,59]){
  const raw=await readFile(new URL(`${String(step).padStart(3,'0')}.bin`,path));
  for(const [variable,info] of Object.entries(manifest.fields)){
   const source=`/harmonie/${model}/${version}/${String(step).padStart(3,'0')}.bin`,url=origin+source+'?'+new URLSearchParams({v:'1',variable,bounds:bounds.join(',')}),start=performance.now(),response=await fetch(url);assert.equal(response.status,200);const packet=decodeRegularPacket(await response.arrayBuffer(),{source,variable,bounds}),ms=performance.now()-start;
   const g=info.grid,p=packet.metadata.grid,x0=Math.round((p.lon_min-g.lon_min)/(g.lon_max-g.lon_min)*(g.n_lon-1)),y0=Math.round((p.lat_min-g.lat_min)/(g.lat_max-g.lat_min)*(g.n_lat-1));let maxError=0;
   const val=(x,y,c=0)=>{const i=info.offset+((c*g.n_lat+y)*g.n_lon+x)*info.bytes,q=info.dtype===0?raw.readFloatLE(i):raw[i];return Math.fround(info.dtype===1?(q/info.scale)**info.power:info.dtype===2?q/255:q);};
   for(let y=0;y<p.n_lat;y++)for(let x=0;x<p.n_lon;x++){
    let expected=val(x+x0,y+y0);
    if(variable==='cloud_cover')expected=Math.fround(100*Math.max(expected,val(x+x0,y+y0,1),val(x+x0,y+y0,2)));
    if(variable==='wind_u_component_10m'||variable==='wind_gusts_10m')expected=Math.fround(Math.hypot(expected,val(x+x0,y+y0,1))*3.6);
    const actual=packet.values[y*p.n_lon+x];if(Number.isNaN(expected)&&Number.isNaN(actual))continue;
    maxError=Math.max(maxError,Math.abs(expected-actual));assert.equal(actual,expected,`${model} ${step} ${variable} ${x},${y}`);
   }
   const grid=createRegularGrid(p),samples=[[52.1,5.18],[53.55,10],[54,4]].map(([lat,lon])=>{const value=grid.getInterpolatedValue(packet.values,lat,lon);return {lat,lon,value,...(variable==='wind_u_component_10m'?{bft:beaufort(value)}:{})};});
   records.push({model,run:manifest.reference_time,validTime:manifest.valid_times[step],variable,points:packet.values.length,maxError,ms:Math.round(ms),cache:response.headers.get('X-Weerlab-Cache'),samples});
  }
 }
}
await writeFile(new URL('harmonie-live-audit.json',import.meta.url),JSON.stringify({at:new Date().toISOString(),result:`${records.length} fields identical to existing Weerlab source after documented presentation conversion`,records},null,2)+'\n');
console.log('Gecontroleerd:',records.length,'velden; alle waarden exact gelijk.');
