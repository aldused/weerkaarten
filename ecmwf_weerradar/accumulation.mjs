import {HOUR,nativeIntervalHours,normalizeFieldData} from './core.mjs';
import {modelFor,isRegional} from './forecast-models.mjs';
export const accumulationSource={precipitation_total:'precipitation',snowfall_total:'snowfall_water_equivalent'};
export const isAccumulation=v=>Object.hasOwn(accumulationSource,v);
export function accumulationPlan(frame,anchor,variable){
 const meta=frame.modelMeta,model=modelFor(meta),run=Date.parse(meta.reference_time),end=frame.time;
 if(!meta.variables.includes(accumulationSource[variable]))throw Error('Dit model levert geen afzonderlijke sneeuwgegevens');
 const times=(meta.valid_times||meta.source?.valid_times||[]).map(Date.parse).sort((a,b)=>a-b);
 if(!Number.isFinite(anchor)||!Number.isFinite(run)||!times.length)throw Error('Cumulatieve tijdreeks ontbreekt');
 const plan=[];let previous=run;
 for(let i=0;i<times.length;i++){
  const time=times[i];if(time===run)continue;
  if(!Number.isFinite(time)||time<=previous)throw Error('Ongeldige cumulatieve tijdreeks');
  const hours=model==='ecmwf_ifs'?nativeIntervalHours((time-run)/HOUR):model==='ncep_gfs013'?time-run<=120*HOUR?1:3:1;
  if(time-previous!==hours*HOUR)throw Error('Een neerslaginterval ontbreekt');
  const start=time-hours*HOUR;previous=time;
  if(time<=anchor||time>end)continue;
  const url=isRegional(model)?frame.url.replace(/\d{3}\.bin$/,String(i).padStart(3,'0')+'.bin'):frame.url.replace(/\d{4}-\d{2}-\d{2}T\d{4}\.om$/,new Date(time).toISOString().slice(0,13)+'00.om');
  plan.push({url,time,start,hours});
 }
 if(!plan.length||plan.at(-1).time!==end)throw Error('Cumulatieve periode niet volledig beschikbaar');
 return {steps:plan,start:plan[0].start,end,run,variable:accumulationSource[variable]};
}
export function addInterval(sum,data,variable,hours){
 // Regional packets already contain mm/h; native OM packets contain interval mm.
 if(data.metadata.kind!=='regular'||data.metadata.source.includes('/data_spatial/ncep_gfs'))normalizeFieldData(data,variable,hours);
 if(sum.length!==data.values.length)throw Error('Cumulatieve roosters verschillen');
 for(let i=0;i<sum.length;i++){
  const rate=data.values[i];sum[i]=Number.isFinite(rate)&&rate>=0&&Number.isFinite(sum[i])?sum[i]+rate*hours:NaN;
 }
}
export function gridIdentity(metadata){return JSON.stringify([metadata.kind,metadata.grid,metadata.model,metadata.rows,metadata.ranges,metadata.bounds]);}
// Cache a few immutable prefix sums. Adjacent time steps read only new intervals.
// All bytes in a sum come from one model run and exactly the same native crop.
export class AccumulationFields{
 constructor(read,{maxEntries=12}={}){this.read=read;this.cache=new Map();this.maxEntries=maxEntries;}
 async get(plan,variable,bounds,signal,onProgress=()=>{}){
  signal?.throwIfAborted();
  const base=JSON.stringify([plan.steps[0].url,plan.start,variable,bounds]);
  const key=base+'|'+plan.end;
  if(this.cache.has(key))return this.cache.get(key);
  let result,done=0;
  for(let i=plan.steps.length-1;i>=0;i--){const prefix=this.cache.get(base+'|'+plan.steps[i].time);if(prefix){result={...prefix,values:Float32Array.from(prefix.values)};done=i+1;break;}}
  for(let batch=done;batch<plan.steps.length;batch+=3){
   signal?.throwIfAborted();
   const steps=plan.steps.slice(batch,batch+3);
   const packets=await Promise.all(steps.map(step=>this.read(step.url,plan.variable,bounds,signal)));
   signal?.throwIfAborted();
   for(let j=0;j<steps.length;j++){
    const step=steps[j],data=packets[j];
    if(!result)result={metadata:data.metadata,values:new Float32Array(data.values.length)};
    if(gridIdentity(result.metadata)!==gridIdentity(data.metadata))throw Error('Cumulatieve bronroosters verschillen');
    addInterval(result.values,data,plan.variable,step.hours);onProgress(batch+j+1,plan.steps.length);
   }
  }
  const output={...result,metadata:{...result.metadata,variable},start:plan.start,end:plan.end,run:plan.run};
  this.cache.set(key,output);while(this.cache.size>this.maxEntries)this.cache.delete(this.cache.keys().next().value);
  return output;
 }
}
