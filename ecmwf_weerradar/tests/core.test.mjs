import test from 'node:test';
import assert from 'node:assert/strict';
import { HOUR, REQUIRED, forecastFrames, hasFullHorizon, fileURL, hourlyRate, nearestIndex, localDateKey, inEurope } from '../core.mjs';

const run=Date.parse('2026-09-18T12:00:00Z');
const hours=[...Array.from({length:91},(_,i)=>i),...Array.from({length:18},(_,i)=>93+i*3),...Array.from({length:36},(_,i)=>150+i*6)];
const meta={completed:true,reference_time:new Date(run).toISOString(),valid_times:hours.map(h=>new Date(run+h*HOUR).toISOString()),variables:REQUIRED};
test('10 days cover a full 240h from the first future frame, all in one run',()=>{
  const frames=forecastFrames(meta,run+16.25*HOUR);
  assert.equal(frames[0].lead,17);
  assert.ok(frames.at(-1).time-frames[0].time>=240*HOUR);
  assert.ok(frames.every(f=>f.url.includes('/2026/09/18/1200Z/')));
  assert.equal(frames.find(f=>f.lead===90).hours,1);
  assert.equal(frames.find(f=>f.lead===93).hours,3);
  assert.equal(frames.find(f=>f.lead===144).hours,3);
  assert.equal(frames.find(f=>f.lead===150).hours,6);
});
test('reject incomplete, short and missing-field runs',()=>{
  assert.equal(hasFullHorizon({...meta,completed:false},run),false);
  assert.equal(hasFullHorizon({...meta,variables:['cloud_cover']},run),false);
  const short={...meta,valid_times:meta.valid_times.filter(t=>Date.parse(t)<=run+144*HOUR)};
  assert.equal(hasFullHorizon(short,run),false);
  assert.throws(()=>forecastFrames(short,run+HOUR));
});
test('1/3/6h backward sums have the same rain rate and conserve totals',()=>{
  for(const h of [1,3,6]){assert.equal(hourlyRate(2*h,h),2);assert.equal(hourlyRate(2*h,h)*h,2*h);}
  assert.ok(Number.isNaN(hourlyRate(NaN,3)));
  assert.ok(Number.isNaN(hourlyRate(3,0)));
});
test('URL and nearest-frame lookup use UTC without local-date drift',()=>{
  assert.equal(fileURL(meta,'2026-09-25T18:00Z'),'https://openmeteo.s3.amazonaws.com/data_spatial/ecmwf_ifs/2026/09/18/1200Z/2026-09-25T1800.om');
  const frames=forecastFrames(meta,run+HOUR);
  assert.equal(frames[nearestIndex(frames,run+149*HOUR)].lead,150);
  assert.equal(localDateKey('2026-09-19T23:00Z'),'2026-09-20');
});
test('grid stays in Europe and invalid input is rejected',()=>{
  assert.equal(inEurope(4.5,51.9),true);assert.equal(inEurope(-74,40),false);assert.equal(inEurope(NaN,50),false);
  assert.throws(()=>forecastFrames({...meta,valid_times:[meta.valid_times[1],meta.valid_times[0]]},run));
});
