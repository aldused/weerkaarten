// Opt-in live audit: node tests/audit-fog.mjs [report.json]
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {initWasm,OmHttpBackendPool,OmDataType,LruBlockCache} from '@openmeteo/file-reader';
import {domainOptions,GridFactory,getRanges} from '@openmeteo/weather-map-layer';
import {fogBand,FOG_BANDS,writeFogColor} from '../fog-style.mjs';
import {normalizeFieldData,fileURL} from '../core.mjs';
import {createGaussianTileSampler} from '../gaussian-sampler.mjs';
import {renderTile} from '../tile-renderer.mjs';
await initWasm();
const pool=new OmHttpBackendPool(),cache=new LruBlockCache(65536,2048);
const domain=domainOptions.find(d=>d.value==='ecmwf_ifs');
const ranges=getRanges(domain.grid,[-10,43,22,61]),grid=GridFactory.create(domain.grid,ranges);
const reports=[];
for(const run of ['2026-09-19T00:00:00Z','2026-09-19T06:00:00Z']){
 const valid='2026-09-20T04:00:00Z',url=fileURL({reference_time:run},valid);
 await pool.withReader(url,cache,async root=>{
  const child=await root.getChildByName('visibility');assert.ok(child);
  try{
   const values=await child.read({type:OmDataType.FloatArray,ranges,intoSAB:false});
   const raw=values.slice();normalizeFieldData({values},'visibility',1);assert.deepEqual(values,raw);
   const counts={dense:0,thick:0,fog:0,clear:0},examples={};
   grid.forEachPoint(p=>{const v=values[p.index],id=fogBand(v)?.id??'clear';counts[id]++;if(!examples[id])examples[id]={...p,metres:v};},[-8,46,18,59]);
   const points=[['De Bilt',52.1,5.18],['Parijs',48.86,2.35],['Berlijn',52.52,13.41]].map(([name,lat,lon])=>{const metres=grid.getInterpolatedValue(values,lat,lon,'monotone');return {name,lat,lon,metres,category:fogBand(metres)?.id??'clear'};});
   let checkedPixels=0;
   for(const coords of [{z:6,x:32,y:21},{z:6,x:33,y:21}]){
    const sampler=createGaussianTileSampler(grid,values,coords),pixels=renderTile({variable:'visibility',grid,data:{values}},coords);
    for(let y=0;y<256;y++){const row=sampler.row(y);for(let x=0;x<256;x++){const expected=new Uint8ClampedArray(4);writeFogColor(row[x],expected,0,coords.x*256+x,coords.y*256+y);assert.deepEqual(pixels.slice((y*256+x)*4,(y*256+x)*4+4),expected);checkedPixels++;}}
   }
   reports.push({run,valid,url,scaleFactor:child.scaleFactor(),counts,examples,points,checkedPixels});
  }finally{child.dispose();}
 });
}
const report={parameter:'visibility',unit:'m',thresholds:FOG_BANDS.map(({id,max,color,hatch})=>({id,max,color,hatch})),reports};
await writeFile(process.argv[2]??'tests/fog-audit-2026-09-19.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
