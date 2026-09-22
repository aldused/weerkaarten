import test from 'node:test';
import assert from 'node:assert/strict';
import {weatherSymbol} from '../weather-symbols.mjs';
import {PRECIPITATION_THRESHOLD,precipitationColor} from '../precipitation-colors.mjs';
import {normalizeFieldData} from '../core.mjs';

test('rain takes precedence over every cloud presentation, including filtered sunshine',()=>{
 for(const cloud of ['clear','filtered','overcast',null])for(const precipitation of [.05,.075,.1,.11,.8,4,30]){
  assert.equal(weatherSymbol({cloud,precipitation}),'rain');
  if(precipitation>PRECIPITATION_THRESHOLD)assert(precipitationColor('precipitation',precipitation)[3]>0);
 }
});
test('symbols and overlay share the exact unrounded precipitation threshold',()=>{
 for(const precipitation of [0,.047619,PRECIPITATION_THRESHOLD-1e-9]){
  assert.equal(precipitationColor('precipitation',precipitation)[3],0);
  assert.equal(weatherSymbol({precipitation,cloud:'clear'}),'clear');
  assert.equal(weatherSymbol({precipitation,cloud:'filtered'}),'filtered');
 }
 assert.equal(weatherSymbol({precipitation:PRECIPITATION_THRESHOLD,cloud:'filtered'}),'rain');
});
test('one-, three- and six-hour amounts are classified after the existing conversion',()=>{
 for(const hours of [1,3,6]){
  const f={values:new Float32Array([.08*hours]),scaleFactor:10};normalizeFieldData(f,'precipitation',hours);
  assert.equal(weatherSymbol({precipitation:f.values[0],cloud:'filtered'}),'rain');
  assert(Math.abs(f.values[0]-.08)<1e-7);
 }
});
test('snow is already part of total precipitation, not added to it again',()=>{
 assert.equal(weatherSymbol({precipitation:.4,snowfall:.4,cloud:'clear'}),'snow');
 assert.equal(weatherSymbol({precipitation:.7,snowfall:.4,cloud:'filtered'}),'mixed');
 assert.equal(weatherSymbol({precipitation:1,snowfall:0,cloud:'overcast'}),'rain');
 assert.equal(weatherSymbol({precipitation:.03,snowfall:.03,cloud:'clear'}),'clear');
});
test('missing/invalid rainfall never generates sunshine; dry fog is preserved',()=>{
 for(const precipitation of [NaN,undefined,-1,Infinity])for(const cloud of ['clear','filtered'])assert.equal(weatherSymbol({precipitation,cloud}),null);
 assert.equal(weatherSymbol({precipitation:0,cloud:'clear',fog:{}}),'fog');
 assert.equal(weatherSymbol({precipitation:.5,cloud:'clear',fog:{}}),'rain');
 assert.equal(weatherSymbol({precipitation:0,cloud:null}),null);
});
test('classification has no previous frame or model state',()=>{
 for(const model of ['ecmwf_ifs','harmonie','harmonie46','knmi_harmonie_arome_europe','dmi_harmonie_arome_europe','icond2']){
  const sequence=[{cloud:'filtered',precipitation:.8},{cloud:'clear',precipitation:0},{cloud:'filtered',precipitation:.08},{cloud:'filtered',precipitation:NaN}];
  assert.deepEqual(sequence.map(weatherSymbol),['rain','clear','rain',null],model);
 }
});
