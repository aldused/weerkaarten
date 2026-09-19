import test from 'node:test';
import assert from 'node:assert/strict';
import {GridFactory,domainOptions,getRanges} from '@openmeteo/weather-map-layer';
import {fieldWindow} from '../field-window.mjs';
const native=domainOptions.find(d=>d.value==='ecmwf_ifs').grid;
const valueAt=i=>Math.sin(i*.03)*10+(i%91<20?30:0);

test('visible tile windows include the full monotone interpolation stencil at every boundary',()=>{
 for(const [bounds,z] of [[[-2,48,14,56],6],[[5,51,6,52],9],[[-26,29,46,73],2],[[4,51.9,5,52],11]]){
  const window=fieldWindow(bounds,z),ranges=getRanges(native,window.readBounds),grid=GridFactory.create(native,ranges);
  const values=Float32Array.from({length:ranges[1].end-ranges[1].start},(_,i)=>valueAt(i+ranges[1].start));
  const referenceRanges=getRanges(native,[-180,window.bounds[1]-1,180,window.bounds[3]+1]);
  const reference=GridFactory.create(native,referenceRanges);
  const referenceValues=Float32Array.from({length:referenceRanges[1].end-referenceRanges[1].start},(_,i)=>valueAt(i+referenceRanges[1].start));
  const [w,s,e,n]=window.bounds;
  for(let y=0;y<=20;y++)for(let x=0;x<=20;x++){
   const lat=s+(n-s)*y/20,lon=w+(e-w)*x/20;
   const actual=grid.getInterpolatedValue(values,lat,lon,'monotone');
   assert.ok(Number.isFinite(actual));assert.equal(actual,reference.getInterpolatedValue(referenceValues,lat,lon,'monotone'));
  }
 }
});

test('a small pan inside the same weather tiles reuses the exact window and zoom is bounded',()=>{
 assert.deepEqual(fieldWindow([5,51,6,52],6),fieldWindow([5.01,51.01,6.01,52.01],6));
 assert.deepEqual(fieldWindow([5,51,6,52],11),fieldWindow([5,51,6,52],9));
 const {bounds,readBounds}=fieldWindow([-40,20,70,80],2);
 assert.deepEqual(bounds,[-26,29,46,73]);
 assert.ok(readBounds[1]<29&&readBounds[3]>73,'real points beyond the Europe clipping boundary remain available');
});
