import test from 'node:test';
import assert from 'node:assert/strict';
import {MODEL_CONFIG,modelView,viewZoom,upperAirFile,isRegional} from '../forecast-models.mjs';
import {temperatureLegend,scales} from '../core.mjs';

const NL=[[3.36,50.75],[7.23,53.56]];
const inside=(inner,outer)=>inner[0][0]>=outer[0][0]&&inner[0][1]>=outer[0][1]&&inner[1][0]<=outer[1][0]&&inner[1][1]<=outer[1][1];
test('every model has a complete, explicit configuration',()=>{
 for(const [id,c] of Object.entries(MODEL_CONFIG)){
  for(const key of ['label','type','projection','nativeResolutionKm','extent','timestep','interpolation','units','view'])assert.ok(c[key]!==undefined,`${id}.${key}`);
  assert.equal(c.type==='regional',isRegional(id),id);
  assert.ok(inside(c.view.core,c.view.context),id+' core within context');
  // The default view must show data: the core lies inside the model domain.
  assert.ok(c.view.core[0][0]>=c.extent[0]&&c.view.core[1][0]<=c.extent[2]&&c.view.core[0][1]>=c.extent[1]&&c.view.core[1][1]<=c.extent[3],id+' core inside extent');
 }
});
test('regional views centre on the Netherlands, European views on the Benelux',()=>{
 for(const id of ['harmonie','harmonie46','icond2']){const v=modelView(id);assert.ok(inside(NL,v.core));assert.ok(v.core[1][0]-v.core[0][0]<4.5);}
 for(const id of ['ecmwf_ifs','knmi_harmonie_arome_europe','dmi_harmonie_arome_europe']){const v=modelView(id);assert.ok(inside(NL,v.core));assert.ok(v.context[0][0]<0&&v.context[1][0]>10,'S-Engeland t/m W-Duitsland');}
});
test('viewZoom keeps the core, adds context only within maxOut, quarter steps',()=>{
 const v=modelView('ecmwf_ifs');
 assert.equal(viewZoom(v,b=>b===v.core?6:5.9),5.75);   // context almost free
 assert.equal(viewZoom(v,b=>b===v.core?6:4),5.5);      // context too wide: limit
 assert.equal(viewZoom(v,b=>b===v.core?1:0),v.minZoom);
});
test('upper-air files keep model, run and valid time',()=>{
 const run='2026-09-23T06:00:00Z',t=h=>Date.parse(run)+h*3600e3;
 const f=h=>({time:t(h),url:'https://x/data_spatial/ecmwf_ifs/2026/09/23/0600Z/a.om',modelMeta:{modelId:'ecmwf_ifs',reference_time:run}});
 assert.match(upperAirFile(f(12),'ecmwf_ifs','temperature_850hPa'),/\/data_spatial\/ecmwf_ifs025\/2026\/09\/23\/0600Z\/2026-09-23T1800\.om$/);
 assert.equal(upperAirFile(f(13),'ecmwf_ifs','temperature_850hPa'),null,'no hourly 0.25° levels');
 assert.equal(upperAirFile(f(147),'ecmwf_ifs','temperature_500hPa'),null,'6-hourly after +144');
 assert.equal(upperAirFile(f(13),'harmonie','temperature_850hPa'),null);
 const k=f(5);k.url='https://x/knmi.om';assert.equal(upperAirFile(k,'knmi_harmonie_arome_europe','temperature_850hPa'),k.url);
 assert.match(upperAirFile({time:t(3),url:'u',modelMeta:{reference_time:run}},'icond2','temperature_500hPa'),/dwd_icon_d2\/2026\/09\/23\/0600Z\/2026-09-23T0900\.om$/);
});
test('temperature legends come from the renderer palettes',()=>{
 for(const v of ['temperature_2m','temperature_850hPa','temperature_500hPa']){const l=temperatureLegend(v);assert.equal(l.labels.length,5);assert.ok(l.stops.length>=4);assert.ok(scales[v]);}
 assert.deepEqual(temperatureLegend('temperature_850hPa').labels,['−20','−10','0','10','20+']);
});
