import test from 'node:test';
import assert from 'node:assert/strict';
import {PRECIPITATION,intervalRate,precipitationPeriod,cumulativeTPInterval} from '../precipitation.mjs';
import {precipitationColor,precipitationLegend} from '../precipitation-colors.mjs';
import {normalizeFieldData,fileURL,fmt} from '../core.mjs';
import {renderTile} from '../tile-renderer.mjs';
const record=(run,valid,cumulativeMetres)=>({run,valid,cumulativeMetres});
const run='2026-09-19T00:00:00Z';
test('tp includes all phases and convection; m-to-mm and backward interval amounts are distinct',()=>{
 assert.equal(PRECIPITATION.parameter,'tp');assert.equal(PRECIPITATION.paramId,228);
 assert.equal(PRECIPITATION.transportUnit,'mm');
 for(const hours of [1,3,6]){
  const result=cumulativeTPInterval(record(run,'2026-09-19T12:00:00Z',.012),record(run,`2026-09-19T${12+hours}:00:00Z`,.012+.002*hours));
  assert.ok(Math.abs(result.amountMm-2*hours)<1e-12);assert.ok(Math.abs(result.rateMmH-2)<1e-12);
  const om={values:Float32Array.of(2*hours)};normalizeFieldData(om,'precipitation',hours);
  assert.equal(om.values[0],2,'OM is already mm, not metres or cumulative');
  normalizeFieldData(om,'precipitation',hours);assert.equal(om.values[0],2,'no double division');
 }
});
test('do not deaccumulate across runs, conceal a reset as dry weather, or accept missing intervals',()=>{
 const old=record(run,'2026-09-19T12:00:00Z',.020);
 assert.throws(()=>cumulativeTPInterval(old,record('2026-09-19T12:00:00Z','2026-09-19T13:00:00Z',.001)),/modelruns/);
 assert.throws(()=>cumulativeTPInterval(old,record(run,'2026-09-19T13:00:00Z',.019)),/daalt/);
 assert.throws(()=>cumulativeTPInterval(old,record(run,'2026-09-19T14:00:00Z',.025)),/periode/);
 assert.ok(Number.isNaN(intervalRate(-2,1)));assert.ok(Number.isNaN(intervalRate(NaN,1)));
 assert.equal(intervalRate(-1e-8,1),0);
 assert.equal(cumulativeTPInterval(record(run,'2026-09-19T00:00:00Z',0),record(run,'2026-09-19T01:00:00Z',.001)).rateMmH,1);
 assert.throws(()=>precipitationPeriod(run,'2026-09-19T01:00:00Z',3),/periode/);
 const valid='2026-09-19T15:00:00Z';
 assert.notEqual(fileURL({reference_time:run},valid),fileURL({reference_time:'2026-09-18T12:00:00Z'},valid),'cache key includes run even at identical validity');
});
test('UTC duration survives local midnight and both DST transitions',()=>{
 for(const [start,end,expected] of [
 ['2026-09-19T21:00:00Z','2026-09-20T00:00:00Z',['19 sep','20 sep']],
 ['2026-03-29T00:00:00Z','2026-03-29T03:00:00Z',['29 mrt','29 mrt']],
 ['2026-10-25T00:00:00Z','2026-10-25T03:00:00Z',['25 okt','25 okt']],
 ]){
  const r=start.slice(0,10)+'T00:00:00Z';
  const result=cumulativeTPInterval(record(r,start,.003),record(r,end,.009));
  assert.ok(Math.abs(result.rateMmH-2)<1e-12);assert.equal(result.hours,3);
  assert.ok(fmt(result.start,{day:'numeric',month:'short'}).startsWith(expected[0]));
  assert.ok(fmt(result.end,{day:'numeric',month:'short'}).startsWith(expected[1]));
 }
});
test('rain and snow have an exact visibility threshold; no quantization halo or NaN color',()=>{
 for(const variable of ['precipitation','snowfall_water_equivalent']){
  for(const value of [-1,0,.01,.04762,.049,.049999,NaN,Infinity])assert.equal(precipitationColor(variable,value)[3],0);
  assert.ok(precipitationColor(variable,.05)[3]>0);
 }
 assert.deepEqual(precipitationColor('precipitation',1),[0,114,239,255]);
 assert.deepEqual(precipitationColor('precipitation',4),[238,218,28,255]);
 assert.deepEqual(precipitationColor('precipitation',30),[203,50,185,255]);
 assert.deepEqual(precipitationColor('precipitation',100),[203,50,185,255]);
});
test('each legend tick has exactly the same value and RGBA as an actual map pixel',()=>{
 const coords={z:6,x:33,y:21};
 for(const variable of ['precipitation','snowfall_water_equivalent']){
  const legend=precipitationLegend(variable);
  for(let i=0;i<legend.values.length;i++){
   const value=legend.values[i],stop=legend.stops.find(s=>s.value===value);
   assert.equal(stop.percent,i*25);
   const pixels=renderTile({variable,data:{values:[]},grid:{getInterpolatedValue:()=>value}},coords);
   assert.deepEqual([...pixels.slice(0,4)],stop.rgba);
  }
 }
 const below=renderTile({variable:'precipitation',data:{values:[]},grid:{getInterpolatedValue:()=>.049}},coords);
 assert.ok(below.every(v=>v===0));
});
test('total precipitation never adds snow or convective precipitation again',()=>{
 const tp={values:Float32Array.of(9)},sf={values:Float32Array.of(3)};
 normalizeFieldData(tp,'precipitation',3);normalizeFieldData(sf,'snowfall_water_equivalent',3);
 assert.equal(tp.values[0],3);assert.equal(sf.values[0],1);assert.equal(tp.values[0]*3,9);
});

test('recorded independent GRIB observations: two runs, wet/dry and 3/6h match same-grid OM within its 0.1 mm quantization',async()=>{
 const {readFile}=await import('node:fs/promises');
 const fixture=JSON.parse(await readFile(new URL('./precipitation-audit/reference-intervals.json',import.meta.url)));
 let wet=0,dry=0;
 for(const interval of fixture.intervals)for(const p of interval.samples){
  const valid=lead=>new Date(Date.parse(interval.run)+lead*3600000).toISOString();
  const result=cumulativeTPInterval(record(interval.run,valid(interval.startLead),p.previousCumulativeMetres),record(interval.run,valid(interval.endLead),p.cumulativeMetres));
  assert.equal(result.hours,interval.hours);
  assert.ok(Math.abs(result.amountMm-p.regularOMIntervalMm)<=.051,`${interval.run} ${p.name}`);
  assert.ok(Math.abs(result.amountMm-p.convertedIntervalMm)<1e-12);
  if(result.amountMm>0)wet++;else dry++;
 }
 assert.ok(wet>10&&dry>10);
});

test('recorded native point API matches OM at the SAME grid cell, run and backward interval',async()=>{
 const {readFile}=await import('node:fs/promises');
 const fixture=JSON.parse(await readFile(new URL('./precipitation-audit/pinned-api-comparison.json',import.meta.url)));
 for(const frame of fixture.results)for(const p of frame.samples){
  assert.ok(Math.abs(p.apiIntervalSumMm-p.omNodeIntervalMm)<=.0051*frame.hours);
  assert.ok(Math.abs(intervalRate(p.omNodeIntervalMm,frame.hours)-p.convertedNodeRate)<1e-7);
 }
 assert.equal(fixture.results.length,6);assert.ok(fixture.components.checked>2000);
});
