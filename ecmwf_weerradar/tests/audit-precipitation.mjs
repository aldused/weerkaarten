// Opt-in diagnostic. No audit logging or extra requests in the production page.
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {getProtocolInstance,defaultOmProtocolSettings,domainOptions,GridFactory,getRanges} from '@openmeteo/weather-map-layer';
import {initWasm,OmHttpBackendPool,OmDataType,LruBlockCache} from '@openmeteo/file-reader';
import {HOUR,DATA_ROOT,fileURL,nativeIntervalHours,normalizeFieldData,fmt} from '../core.mjs';
import {renderTile} from '../tile-renderer.mjs';
import {createGaussianTileSampler} from '../gaussian-sampler.mjs';
const output=process.argv[2]||'precipitation-audit/trace-before.json';
const source=JSON.parse(await readFile(new URL('./precipitation-audit/grib-source.json',import.meta.url)));
await initWasm();
const cache=new LruBlockCache(65536,4096),pool=new OmHttpBackendPool();
const reader=getProtocolInstance({...defaultOmProtocolSettings,fileReaderConfig:{useSAB:false,cache}}).omFileReader;
const fields=new Map();
async function read(domainName,run,lead,variable='precipitation'){
 const key=[domainName,run,lead,variable].join('|');if(fields.has(key))return fields.get(key);
 const promise=(async()=>{
  const domain=domainOptions.find(d=>d.value===domainName),ranges=getRanges(domain.grid,[-12,44,20,59]);
  const grid=GridFactory.create(domain.grid,ranges),time=Date.parse(run)+lead*HOUR;
  const url=fileURL({reference_time:run},time).replace('/ecmwf_ifs/','/'+domainName+'/');
  const raw=await pool.withReader(url,cache,async root=>{
   const child=await root.getChildByName(variable);assert.ok(child);
   try{return {values:await child.read({type:OmDataType.FloatArray,ranges,intoSAB:false}),scaleFactor:child.scaleFactor()};}finally{child.dispose();}
  });
  const hours=domainName==='ecmwf_ifs'?nativeIntervalHours(lead):lead<=144?3:6;
  const api=await reader.readVariable(url,variable,ranges);
  assert.deepEqual(api.values,raw.values,'transport decoding must match the independent OM reader');
  normalizeFieldData(api,variable,hours);
  let maxError=0,negative=0,max=0,wet=0;
  for(let i=0;i<raw.values.length;i++){
   const expected=Math.max(0,raw.values[i])/hours;
   maxError=Math.max(maxError,Math.abs(api.values[i]-expected));
   if(raw.values[i]<0)negative++;if(raw.values[i]>0)wet++;max=Math.max(max,raw.values[i]);
  }
  assert.ok(maxError<1e-5&&negative===0);
  return {raw,grid,data:api,variable,key,gridData:domain.grid,ranges,run,lead,hours,url,time,stats:{nodes:raw.values.length,maxError,negative,maxIntervalMm:max,wetNodes:wet}};
 })();fields.set(key,promise);return promise;
}
const results=[];
for(const run of ['2026-09-19T00:00:00Z','2026-09-18T12:00:00Z']){
 const code=run.slice(0,10).replaceAll('-','')+run.slice(11,13);
 for(const lead of [run.includes('19T')?14:26,run.includes('19T')?22:10,run.includes('19T')?24:12,93,150]){
  const field=await read('ecmwf_ifs',run,lead);
  const samples=source[0].samples.map(({name,lat,lon})=>{
   const raw=field.grid.getInterpolatedValue(field.raw.values,lat,lon,'monotone');
   const rate=field.grid.getInterpolatedValue(field.data.values,lat,lon,'monotone');
   const z=7,world=2**z,px=(lon+180)/360*world*256,py=(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*world*256;
   const coords={z,x:Math.floor(px/256),y:Math.floor(py/256)},x=Math.floor(px)%256,y=Math.floor(py)%256;
   const sampler=createGaussianTileSampler(field.grid,field.data.values,coords);
   const pixelValue=sampler.row(y)[x],pixel=renderTile(field,coords).slice((y*256+x)*4,(y*256+x)*4+4);
   assert.equal(pixelValue,field.grid.getInterpolatedValue(field.data.values,sampler.latitudes[y],sampler.longitudes[x],'monotone'));
   assert.ok(Math.abs(rate-raw/field.hours)<2e-6);
   return {name,lat,lon,omIntervalMm:raw,convertedRateMmH:raw/field.hours,apiDecodedRateMmH:rate,pointLabel:rate.toLocaleString('nl-NL',{maximumFractionDigits:2}),pixel:{lat:sampler.latitudes[y],lon:sampler.longitudes[x],value:pixelValue,rgba:[...pixel]}};
  });
  results.push({run,valid:new Date(field.time).toISOString(),local:fmt(field.time,{dateStyle:'short',timeStyle:'short'}),intervalHours:field.hours,url:field.url,stats:field.stats,samples});
  console.log('NATIVE',run,lead,samples.map(p=>p.name+':'+p.apiDecodedRateMmH).join(' '));
 }
}
const independent=[];
for(let i=0;i<source.length;i+=2){
 const a=source[i],b=source[i+1],run=`${b.run.slice(0,4)}-${b.run.slice(4,6)}-${b.run.slice(6,8)}T${b.run.slice(8)}:00:00Z`,hours=b.lead-a.lead;
 const regular=await read('ecmwf_ifs025',run,b.lead);
 const nativeSteps=Array.from({length:hours/nativeIntervalHours(b.lead)},(_,i)=>a.lead+(i+1)*nativeIntervalHours(b.lead));
 const native=await Promise.all(nativeSteps.map(lead=>read('ecmwf_ifs',run,lead)));
 const samples=b.samples.map((p,j)=>{
  const converted=(p.cumulativeMetres-a.samples[j].cumulativeMetres)*1000;
  const om=regular.grid.getInterpolatedValue(regular.raw.values,p.lat,p.lon,'nearest');
  const nativeSum=native.reduce((sum,f)=>sum+f.grid.getInterpolatedValue(f.raw.values,p.lat,p.lon,'monotone'),0);
  // OM compression is 0.1 mm; unlike native-vs-0.25°, this is the SAME grid.
  assert.ok(Math.abs(om-converted)<=.051,`${run} +${b.lead} ${p.name}: ${om} vs ${converted}`);
  return {...p,previousCumulativeMetres:a.samples[j].cumulativeMetres,convertedIntervalMm:converted,regularOMIntervalMm:om,regularOMErrorMm:om-converted,nativeIntervalMm:nativeSum,nativeRateMmH:nativeSum/hours};
 });
 independent.push({run,startLead:a.lead,endLead:b.lead,hours,samples});
 console.log('ECMWF GRIB',run,b.lead,'same-grid conversion verified; native-grid differences retained');
}
const field=await read('ecmwf_ifs','2026-09-19T00:00:00Z',14),coords={z:6,x:31,y:21};
const sampler=createGaussianTileSampler(field.grid,field.data.values,coords),pixels=renderTile(field,coords);
let visibleBelowThreshold=0,maxBelow=0,minVisible=Infinity,aboveInvisible=0;
for(let y=0;y<256;y++){const row=sampler.row(y);for(let x=0;x<256;x++){
 const value=row[x],alpha=pixels[(y*256+x)*4+3];
 if(alpha){minVisible=Math.min(minVisible,value);if(value<.05){visibleBelowThreshold++;maxBelow=Math.max(maxBelow,value);}}
 else if(value>=.05)aboveInvisible++;
}}
for(let i=0;i<3;i++)renderTile(field,coords);
const timings=[];for(let i=0;i<30;i++){const start=performance.now();renderTile(field,coords);timings.push(performance.now()-start);}timings.sort((a,b)=>a-b);
const report={checkedAt:new Date().toISOString(),rawSourceLimitation:'Original public GRIB is 0.25 degrees. The native O1280 ECPDS delivery is not accessible here; its pre-OM GRIB values are NOT fabricated or equated to the regular grid.',results,independent,pixels:{coords,visibleBelowThreshold,maxBelow,minVisible,aboveInvisible},renderMedianMs:timings[15]};
await writeFile(new URL('./'+output,import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log('RESULT',report.pixels,'median render',report.renderMedianMs);
process.exit(0);
