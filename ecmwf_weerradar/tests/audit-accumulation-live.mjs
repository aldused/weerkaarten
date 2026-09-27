// Opt-in live audit: read three native intervals per model and compare each
// cumulative grid point with an independent sum of the source interval values.
import assert from 'node:assert/strict';
import {FieldPackets} from '../field-packets.mjs';
import {AccumulationFields,accumulationPlan} from '../accumulation.mjs';
import {availableForecastFrames,normalizeFieldData} from '../core.mjs';
import {regionalFrames,europeanHarmonieFrames,latestModelURL,isRegional,isEuropeanHarmonie} from '../forecast-models.mjs';
import {discoverGFS} from '../gfs-runs.mjs';
const packets=new FieldPackets({storage:null}),bounds=[3,50,8,54];
const load=async url=>{const r=await fetch(url);assert.ok(r.ok);return r.json();};
for(const model of ['ecmwf_ifs','ncep_gfs013','knmi_harmonie_arome_europe','dmi_harmonie_arome_europe','harmonie','harmonie46','icond2']){
 const raw=model==='ncep_gfs013'?null:await load(latestModelURL(model));
 const frames=model==='ncep_gfs013'?await discoverGFS(load):isRegional(model)?regionalFrames(raw,model):isEuropeanHarmonie(model)?europeanHarmonieFrames(raw,model):availableForecastFrames(raw).map(f=>({...f,modelMeta:raw}));
 for(const variable of ['precipitation_total',...(frames[0].modelMeta.variables.includes('snowfall_water_equivalent')?['snowfall_total']:[])]){
  const plan=accumulationPlan(frames[2],frames[0].time-frames[0].hours*3600000,variable),original=[];
  const sums=new AccumulationFields(async(...args)=>{const data=await packets.read(...args);original.push({url:args[0],raw:Float32Array.from(data.values),metadata:data.metadata});return data;});
  const result=await sums.get(plan,variable,bounds);let maxError=0,finite=0;
  for(let i=0;i<result.values.length;i++){
   let expected=0;for(const part of original){const hours=plan.steps.find(s=>s.url===part.url).hours;expected+=part.raw[i]*(isRegional(model)?hours:1);}
   if(Number.isFinite(expected)){assert.ok(Number.isFinite(result.values[i]));finite++;maxError=Math.max(maxError,Math.abs(expected-result.values[i]));}else assert.ok(Number.isNaN(result.values[i]));
  }
  assert.ok(finite>0&&maxError<1e-4);console.log(JSON.stringify({model,variable,intervals:plan.steps.length,hours:(plan.end-plan.start)/3600000,finite,maxError}));
 }
}
