import {test} from 'node:test';
import assert from 'node:assert/strict';
import {temperatureTimeline} from '../temperature-timeline.mjs';
const run='2026-09-26T00:00:00Z';
const frames=(modelId,leads)=>leads.map(lead=>({time:Date.parse(run)+lead*3600000,url:'test/'+lead,modelMeta:{modelId,reference_time:run}}));
test('ECMWF pressure levels skip absent hours and switch to six-hour steps after +144',()=>{
 const full=frames('ecmwf_ifs',[1,2,3,4,6,141,144,147,150]);
 for(const v of ['temperature_850hPa','temperature_500hPa']){
  const selected=temperatureTimeline(full,v);assert.deepEqual(selected.map(f=>(f.time-Date.parse(run))/3600000),[3,6,141,144,150]);assert.equal(temperatureTimeline(full,v),selected);
 }
 assert.equal(temperatureTimeline(full,'temperature_2m'),full);assert.equal(temperatureTimeline(full,null),full);assert.equal(full.length,9);
});
test('GFS keeps all available hourly and three-hour temperature steps',()=>{
 const full=frames('ncep_gfs013',[1,2,3,119,120,123,126,240]);assert.deepEqual(temperatureTimeline(full,'temperature_850hPa'),full);assert.deepEqual(temperatureTimeline(full,'temperature_500hPa'),full);
});
