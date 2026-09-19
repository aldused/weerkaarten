import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {GridFactory,domainOptions,getRanges} from '@openmeteo/weather-map-layer';
import {initWasm,OmHttpBackendPool,OmDataType,LruBlockCache} from '@openmeteo/file-reader';
import {HOUR,fileURL,nativeIntervalHours,normalizeFieldData} from '../core.mjs';
await initWasm();
const domain=domainOptions.find(x=>x.value==='ecmwf_ifs'),ranges=getRanges(domain.grid,[-12,44,20,59]),grid=GridFactory.create(domain.grid,ranges),pool=new OmHttpBackendPool(),cache=new LruBlockCache(65536,2048),results=[];
for(const run of ['2026-09-19T00:00','2026-09-18T12:00']){
 const code=run.replaceAll('-','').replaceAll(':','');
 const api=JSON.parse(await readFile(new URL(`./precipitation-audit/single-run-${code}-ecmwf_ifs.json`,import.meta.url)));
 for(const lead of [run.includes('19T')?14:26,93,150]){
  const hours=nativeIntervalHours(lead),time=Date.parse(run+'Z')+lead*HOUR,valid=new Date(time).toISOString().slice(0,16),url=fileURL({reference_time:run+'Z'},time);
  const raw=await pool.withReader(url,cache,async root=>{const child=await root.getChildByName('precipitation');try{return await child.read({type:OmDataType.FloatArray,ranges,intoSAB:false});}finally{child.dispose();}});
  const data=normalizeFieldData({values:raw.slice()},'precipitation',hours);
  const samples=api.data.map((p,i)=>{
   const apiIndex=p.hourly.time.indexOf(valid);assert.ok(apiIndex>=0);
   const omNodeMm=grid.getNearestNeighborValue(raw,p.latitude,p.longitude);
   const rate=grid.getNearestNeighborValue(data.values,p.latitude,p.longitude);
   const sum=p.hourly.precipitation.slice(apiIndex-hours+1,apiIndex+1).reduce((a,b)=>a+b,0);
   assert.ok(Math.abs(sum-omNodeMm)<=.0051*hours,`${run}+${lead} ${i}: API ${sum} vs OM ${omNodeMm}`);
   const requested=api.requestedPoints[i],interpolatedRate=grid.getInterpolatedValue(data.values,requested.lat,requested.lon,'monotone');
   return {name:requested.name,requested,apiGridPoint:{lat:p.latitude,lon:p.longitude},omNodeIntervalMm:omNodeMm,convertedNodeRate:rate,apiHourlyMm:p.hourly.precipitation[apiIndex],apiIntervalSumMm:sum,interpolatedMapRate:interpolatedRate};
  });
  results.push({run:run+'Z',valid:valid+'Z',hours,url,samples});
  console.log(run,valid,samples.map(p=>`${p.name}: OMnode=${p.convertedNodeRate}, API=${p.apiHourlyMm}, map=${p.interpolatedMapRate}`).join(' | '));
 }
}
let checkedComponents=0,maxExcess=0;
for(const run of ['20260919T0000','20260918T1200']){
 const a=JSON.parse(await readFile(new URL(`./precipitation-audit/single-run-${run}-ecmwf_ifs.json`,import.meta.url)));
 for(const p of a.data)for(let i=0;i<p.hourly.time.length;i++){
  const total=p.hourly.precipitation[i],snow=p.hourly.snowfall_water_equivalent[i],showers=p.hourly.showers[i];
  if([total,snow,showers].some(x=>x==null))continue;
  maxExcess=Math.max(maxExcess,snow+showers-total);assert.ok(snow+showers<=total+.150001);checkedComponents++;
 }
}
const report={checkedAt:new Date().toISOString(),results,components:{checked:checkedComponents,maxExcessMm:maxExcess,note:'Total includes showers and snow; components never added to total. API rounds each component independently.'}};
await writeFile(new URL('./precipitation-audit/pinned-api-comparison.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log('Pinned API verified',report.components);process.exit(0);
