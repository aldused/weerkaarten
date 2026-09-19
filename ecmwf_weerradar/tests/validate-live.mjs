// Numerical checks against the native OM source, independently of the UI.
import {writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {getProtocolInstance,defaultOmProtocolSettings,domainOptions,GridFactory,getRanges} from '@openmeteo/weather-map-layer';
import {HOUR,DATA_ROOT,forecastFrames,runPath,hourlyRate} from '../core.mjs';
const latest=await (await fetch(`${DATA_ROOT}/latest.json`)).json();
let ref=new Date(latest.reference_time);ref.setUTCHours(Math.floor(ref.getUTCHours()/12)*12,0,0,0);
const meta=await (await fetch(`${DATA_ROOT}/${runPath(ref)}/meta.json`)).json();
const frames=forecastFrames(meta,Date.now());
const domain=domainOptions.find(x=>x.value==='ecmwf_ifs');
const reader=getProtocolInstance(defaultOmProtocolSettings).omFileReader;
const ranges=getRanges(domain.grid,[-5,48,14,56]),grid=GridFactory.create(domain.grid,ranges);
const results=[];
for(const frame of [frames[0],frames.find(f=>f.hours===3),frames.at(-1)]){
  const fields={};
  for(const variable of ['temperature_2m','cloud_cover','precipitation','snowfall_water_equivalent']){
    const data=await reader.readVariable(frame.url,variable,ranges);
    let min=Infinity,max=-Infinity,valid=0;
    for(const v of data.values)if(Number.isFinite(v)){min=Math.min(min,v);max=Math.max(max,v);valid++;}
    assert.equal(valid,data.values.length,`Missing values: ${variable}`);
    if(variable==='cloud_cover'){assert.ok(min>=0&&max<=100);}
    if(variable==='temperature_2m'){assert.ok(min>-80&&max<65);}
    if(variable.includes('precipitation')||variable.includes('snowfall'))assert.ok(min>=0);
    const point=grid.getInterpolatedValue(data.values,51.96,5.94,'linear');
    fields[variable]={min,max,count:valid,arnhem:point,...(variable==='precipitation'?{arnhem_mm_h:hourlyRate(point,frame.hours)}:{})};
  }
  results.push({valid:frame.iso,intervalHours:frame.hours,leadHours:frame.lead,source:frame.url,fields});
  console.log('Checked',frame.iso,frame.hours+'h',fields.precipitation.arnhem_mm_h,'mm/h');
}
const report={checkedAt:new Date().toISOString(),run:meta.reference_time,grid:domain.grid,frames:frames.length,horizonHours:(frames.at(-1).time-frames[0].time)/HOUR,results};
await writeFile('tests/live-validation.json',JSON.stringify(report,null,2));
console.log('Native ECMWF validation passed');
process.exit(0);
