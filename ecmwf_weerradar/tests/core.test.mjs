import test from 'node:test';
import assert from 'node:assert/strict';
import { HOUR, REQUIRED, forecastFrames, hasFullHorizon, fileURL, hourlyRate, nearestIndex, localDateKey, fmt, inEurope, nativeIntervalHours, normalizeFieldData } from '../core.mjs';

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
  assert.ok(Number.isNaN(hourlyRate(Infinity,3)));
  assert.ok(Number.isNaN(hourlyRate(3,Infinity)));
  assert.ok(Number.isNaN(hourlyRate(-.001,1)));
});
test('reject missing native steps instead of changing precipitation accumulation hours',()=>{
  for(const missingLead of [16,91,93,147,150]){
    // 91 and 147 are deliberately unscheduled steps, the others are gaps.
    const times=meta.valid_times.filter(t=>Date.parse(t)!==run+missingLead*HOUR);
    if(missingLead===91||missingLead===147)times.push(new Date(run+missingLead*HOUR).toISOString());
    times.sort();
    const changed={...meta,valid_times:times};
    assert.throws(()=>forecastFrames(changed,run+HOUR),/tijdstap|voorspeltijd/);
    assert.equal(hasFullHorizon(changed,run+HOUR),false);
  }
  assert.equal(nativeIntervalHours(90),1);
  assert.equal(nativeIntervalHours(93),3);
  assert.equal(nativeIntervalHours(144),3);
  assert.equal(nativeIntervalHours(150),6);
});
test('horizon requires 240h from the first actual frame, not just from wall clock',()=>{
  const atBoundary={...meta,valid_times:meta.valid_times.filter(t=>Date.parse(t)<=run+336*HOUR)};
  assert.equal(hasFullHorizon(atBoundary,run+95.2*HOUR),true);
  // First frame becomes lead99; lead336 is now only 237h from it.
  assert.equal(hasFullHorizon(atBoundary,run+96.2*HOUR),false);
  assert.equal(forecastFrames(meta,run)[0].lead,1);
  assert.throws(()=>forecastFrames({...meta,reference_time:'invalid'},run),/modelrun/);
  assert.throws(()=>forecastFrames({...meta,valid_times:meta.valid_times.slice(1)},run),/modelrun/);
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
test('Amsterdam labels observe both DST transitions without shifting UTC frame URLs',()=>{
  const clock=t=>fmt(t,{hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  assert.equal(clock('2026-03-29T00:00:00Z'),'01:00');
  assert.equal(clock('2026-03-29T01:00:00Z'),'03:00');
  assert.equal(clock('2026-10-25T00:00:00Z'),'02:00');
  assert.equal(clock('2026-10-25T01:00:00Z'),'02:00');
  assert.notEqual(fmt('2026-10-25T00:00:00Z',{timeZoneName:'shortOffset'}),fmt('2026-10-25T01:00:00Z',{timeZoneName:'shortOffset'}));
  assert.equal(localDateKey('2026-03-28T23:00:00Z'),'2026-03-29');
  assert.equal(localDateKey('2026-10-25T23:00:00Z'),'2026-10-26');
  const springRun=Date.parse('2026-03-28T12:00:00Z');
  const springMeta={...meta,reference_time:new Date(springRun).toISOString(),valid_times:hours.map(h=>new Date(springRun+h*HOUR).toISOString())};
  const frames=forecastFrames(springMeta,springRun+HOUR);
  const jump=frames.filter(f=>f.time>=Date.parse('2026-03-29T00:00:00Z')&&f.time<=Date.parse('2026-03-29T02:00:00Z'));
  assert.deepEqual(jump.map(f=>f.hours),[1,1,1]);
  assert.ok(jump[1].url.endsWith('2026-03-29T0100.om'));
});
test('native cloud percent and Celsius are not rescaled, and missing values remain missing',()=>{
  for(const [variable,values] of [['cloud_cover',[0,1,50,100,NaN]],['temperature_2m',[-12.5,0,18.2,NaN]]]){
    const data={values:Float32Array.from(values),scaleFactor:10};
    const expected=data.values.slice();
    assert.equal(normalizeFieldData(data,variable),data);
    assert.deepEqual(data.values,expected);
    assert.equal(data.scaleFactor,10);
  }
});
test('rain, snow and derived wind convert once with matching quantization and unchanged directions',()=>{
  for(const variable of ['precipitation','snowfall_water_equivalent'])for(const hours of [1,3,6]){
    const data={values:Float32Array.from([0,hours*2,NaN]),scaleFactor:10};
    normalizeFieldData(data,variable,hours);
    assert.deepEqual([...data.values],[0,2,NaN]);
    assert.equal(data.scaleFactor,10*hours);
    normalizeFieldData(data,variable,hours);
    assert.equal(data.values[1],2,'cached value must not be converted twice');
    assert.throws(()=>normalizeFieldData(data,variable,hours===3?6:3),/eenheid|tijdstap/);
  }
  assert.throws(()=>normalizeFieldData({values:new Float32Array([4])},'precipitation',2),/interval/);
  const wind={values:Float32Array.from([0,5,NaN]),directions:Float32Array.from([180,233.13,NaN]),scaleFactor:10};
  const directions=wind.directions.slice();
  normalizeFieldData(wind,'wind_u_component_10m');
  assert.deepEqual([...wind.values],[0,18,NaN]);
  assert.deepEqual(wind.directions,directions);
  assert.equal(wind.scaleFactor,10/3.6);
  normalizeFieldData(wind,'wind_u_component_10m');
  assert.equal(wind.values[1],18);
});
