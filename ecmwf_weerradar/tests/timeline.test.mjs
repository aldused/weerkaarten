import test from 'node:test';
import assert from 'node:assert/strict';
import {groupForecastDays,forecastLabel,chooseDayEntry} from '../timeline.mjs';
import {forecastFrames,HOUR,REQUIRED,localDateKey} from '../core.mjs';
function hours(start,count){return Array.from({length:count},(_,index)=>{const time=Date.parse(start)+index*HOUR;return {time,iso:new Date(time).toISOString()};});}
test('every day/hour button references exactly one original UTC frame, including native 3/6h steps',()=>{
 const run=Date.parse('2026-09-19T00:00Z'),leads=[];for(let h=0;h<=360;h+=h<90?1:h<144?3:6)leads.push(h);
 const frames=forecastFrames({reference_time:new Date(run).toISOString(),completed:true,variables:REQUIRED,valid_times:leads.map(h=>new Date(run+h*HOUR).toISOString())},run+11*HOUR);
 const days=groupForecastDays(frames,run+10*HOUR),entries=days.flatMap(d=>d.entries);
 assert.equal(entries.length,frames.length);assert.equal(new Set(entries.map(e=>e.index)).size,frames.length);
 for(const day of days)for(const e of day.entries){assert.equal(e.time,frames[e.index].time);assert.equal(e.iso,frames[e.index].iso);assert.equal(localDateKey(e.time),day.key);}
 assert.deepEqual(days.slice(0,3).map(d=>d.label),['Vandaag','Morgen','Overmorgen']);
 assert.deepEqual(days.filter(d=>d.hoursVisible).map(d=>d.distance),[0,1,2]);
 assert.equal(days[0].entries[0].clock,'13:00');assert.equal(days[1].entries.length,24);
 assert.equal(days.at(-1).entries.at(-1).index,frames.length-1);
});
test('spring transition offers 23 actual hours without inventing 02:00',()=>{
 const days=groupForecastDays(hours('2026-03-28T23:00Z',23),Date.parse('2026-03-28T23:00Z'));
 assert.equal(days.length,1);assert.equal(days[0].entries.length,23);assert.equal(days[0].entries.some(e=>e.clock==='02:00'),false);
 assert.equal(days[0].entries.at(-1).clock,'23:00');
});
test('autumn transition preserves both repeated hours and disambiguates their controls and selected label',()=>{
 const day=groupForecastDays(hours('2026-10-24T22:00Z',25),Date.parse('2026-10-24T22:00Z'))[0];
 assert.equal(day.entries.length,25);const twice=day.entries.filter(e=>e.clock==='02:00');assert.equal(twice.length,2);
 assert.notEqual(twice[0].label,twice[1].label);assert.notEqual(forecastLabel(twice[0].time).text,forecastLabel(twice[1].time).text);
 assert.equal(twice[1].time-twice[0].time,HOUR);
});
test('today/morrow are local calendar dates and relabel correctly across midnight',()=>{
 const frames=hours('2026-09-19T21:00Z',50);
 const before=groupForecastDays(frames,Date.parse('2026-09-19T21:59Z'));
 assert.equal(before[0].label,'Vandaag');assert.equal(before[1].label,'Morgen');assert.equal(before[1].entries[0].clock,'00:00');
 const after=groupForecastDays(frames,Date.parse('2026-09-19T22:01Z'));
 assert.equal(after[0].hoursVisible,false);assert.equal(after[1].label,'Vandaag');assert.equal(after[2].label,'Morgen');
});
test('first forecast after local midnight is named Morgen when today has no future model frame',()=>{
 const days=groupForecastDays(hours('2026-09-19T22:00Z',72),Date.parse('2026-09-19T21:59Z'));
 assert.equal(days[0].label,'Morgen');assert.equal(days[1].label,'Overmorgen');assert.equal(days[2].hoursVisible,false);
});
test('switching day preserves the selected Amsterdam hour instead of resetting to noon',()=>{
 const days=groupForecastDays(hours('2026-09-19T13:00Z',57),Date.parse('2026-09-19T13:00Z'));
 const selected=days[0].entries[0];
 assert.equal(selected.clock,'15:00');
 for(const day of days.slice(1)){
  const entry=chooseDayEntry(day,selected.time);
  assert.equal(entry.clock,'15:00');assert.equal(localDateKey(entry.time),day.key);
  assert.equal(day.entries.includes(entry),true);
  assert.equal(day.target.clock,'12:00'); // Keep the existing default API intact.
 }
});
test('day selection falls back to the nearest actual frame on limited and coarse days',()=>{
 const days=groupForecastDays(hours('2026-09-19T14:00Z',40),Date.parse('2026-09-19T13:00Z'));
 assert.equal(chooseDayEntry(days[0],Date.parse('2026-09-20T07:00Z')).clock,'16:00');
 const coarse=groupForecastDays(hours('2026-09-21T00:00Z',24).filter((_,i)=>i%6===0),Date.parse('2026-09-19T13:00Z'))[0];
 assert.deepEqual(coarse.entries.map(entry=>entry.clock),['02:00','08:00','14:00','20:00']);
 assert.equal(chooseDayEntry(coarse,Date.parse('2026-09-19T13:00Z')).clock,'14:00');
 assert.equal(chooseDayEntry(coarse,Date.parse('2026-09-19T21:00Z')).clock,'20:00');
 assert.equal(chooseDayEntry(coarse,Date.parse('2026-09-19T09:00Z')).clock,'08:00'); // 11:00 is equally near 08:00 and 14:00.
 const threeHourly=groupForecastDays(hours('2026-09-21T00:00Z',24).filter((_,i)=>i%3===0),Date.parse('2026-09-19T13:00Z'))[0];
 assert.equal(chooseDayEntry(threeHourly,Date.parse('2026-09-19T13:00Z')).clock,'14:00');
 assert.equal(chooseDayEntry(threeHourly,Date.parse('2026-09-19T14:00Z')).clock,'17:00');
 assert.equal(chooseDayEntry(coarse,undefined),coarse.target);
 assert.equal(chooseDayEntry({entries:[]},Date.parse('2026-09-19T13:00Z')),undefined);
});
test('day selection keeps wall clock time across both DST changes without adding 24 hours',()=>{
 for(const [start,count,selectedISO,targetDate,expectedISO] of [
  ['2026-03-27T23:00Z',47,'2026-03-28T14:00Z','2026-03-29','2026-03-29T13:00:00.000Z'],
  ['2026-10-23T22:00Z',49,'2026-10-24T13:00Z','2026-10-25','2026-10-25T14:00:00.000Z'],
 ]){
  const day=groupForecastDays(hours(start,count),Date.parse(start)).find(entry=>entry.key===targetDate);
  const target=chooseDayEntry(day,Date.parse(selectedISO));
  assert.equal(target.clock,'15:00');assert.equal(target.iso,expectedISO);
 }
});
test('selecting the same autumn day preserves the exact second 02:00 frame',()=>{
 const day=groupForecastDays(hours('2026-10-24T22:00Z',25),Date.parse('2026-10-24T22:00Z'))[0];
 const twice=day.entries.filter(entry=>entry.clock==='02:00');
 for(const entry of twice)assert.equal(chooseDayEntry(day,entry.time),entry);
 assert.equal(chooseDayEntry(day,Date.parse('2026-10-24T00:00Z')),twice[0]);
});
test('missing spring hour selects an existing nearest frame without inventing or crossing dates',()=>{
 const day=groupForecastDays(hours('2026-03-28T23:00Z',23),Date.parse('2026-03-28T23:00Z'))[0];
 const entry=chooseDayEntry(day,Date.parse('2026-03-28T01:00Z'));
 assert.equal(entry.clock,'01:00');assert.equal(entry.iso,'2026-03-29T00:00:00.000Z');
 assert.equal(localDateKey(entry.time),day.key);
});

test('the selected heading spells out the date, year, zone and real elapsed run lead',()=>{
 const summer=forecastLabel('2026-09-19T13:00:00Z','2026-09-19T00:00:00Z');
 assert.equal(summer.text,'Zaterdag 19 september 2026 • 15:00 uur');
 assert.equal(summer.zone,'Nederlandse zomertijd (UTC+2)');
 assert.equal(summer.runClock,'00:00');assert.equal(summer.lead,13);
 assert.equal(summer.runLabel,'ECMWF-run 19 september 2026 • 00:00 UTC');
 const winter=forecastLabel('2026-12-31T23:00:00Z','2026-12-31T18:00:00Z');
 assert.equal(winter.date,'Vrijdag 1 januari 2027');assert.equal(winter.clock,'00:00');
 assert.equal(winter.zone,'Nederlandse wintertijd (UTC+1)');assert.equal(winter.lead,5);
 assert.equal(winter.runDate,'31 december 2026');
 const a=forecastLabel('2026-10-25T00:00Z','2026-10-24T18:00Z'),b=forecastLabel('2026-10-25T01:00Z','2026-10-24T18:00Z');
 assert.equal(a.clock,b.clock);assert.notEqual(a.full,b.full);assert.equal(a.lead,6);assert.equal(b.lead,7);
 const spring=forecastLabel('2026-03-29T01:00Z','2026-03-28T18:00Z');assert.equal(spring.clock,'03:00');assert.equal(spring.lead,7);
});

test('Nu selects an available frame and clamps correctly at both forecast ends',async()=>{
 const {nowFrameIndex}=await import('../timeline.mjs');const frames=hours('2026-09-19T13:00Z',4);
 assert.equal(nowFrameIndex([],frames[0].time),-1);
 assert.equal(nowFrameIndex(frames,frames[0].time-HOUR),0);
 assert.equal(nowFrameIndex(frames,frames[0].time+1.8*HOUR),2);
 assert.equal(nowFrameIndex(frames,frames.at(-1).time+10*HOUR),3);
});
