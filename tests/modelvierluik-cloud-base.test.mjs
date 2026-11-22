import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudBaseData,heightLabels,METERS_PER_FOOT} from '../vierluik/cloud-base.js';
import {cloudCatalog} from '../vierluik/cloud-catalog.js';
test('Diagnosecodes en ontbrekende waarden worden geen echte hoogtes; een basis aan de grond blijft geldig',()=>{
 const {values,status}=cloudBaseData([0,300,9999,NaN,-999,Infinity]);
 assert.equal(values[0],0);assert.equal(values[1],300);assert.ok([...values.slice(2)].every(Number.isNaN));assert.deepEqual([...status],[1,1,2,0,0,0]);
 assert.equal(cloudBaseData([9999],{clearSky:null}).values[0],9999);
 const high=cloudBaseData([9677.4,20000,30000]);assert.ok(high.values[0]>9600);assert.ok(Number.isNaN(high.values[1]));assert.ok(Number.isNaN(high.values[2]));
});
test('Meters en voeten gebruiken de exacte voetdefinitie en een herkenbare afronding',()=>{
 assert.equal(METERS_PER_FOOT,.3048);assert.deepEqual(heightLabels(304.8),['305 m','1.000 ft']);assert.deepEqual(heightLabels(5000,true),['≥5.000 m','≥16.400 ft']);assert.equal(heightLabels(NaN),null);
});
test('ECMWF-wolkenbasis krijgt de eigen bronrun en bewaart de oorspronkelijke bestandsindices',async()=>{
 const original=globalThis.fetch;
 const meta={run_utc:'2026-11-21T06:00Z',grid:{n_lat:2,n_lon:2},tijden:['2026-11-21T08:00+01:00','2026-11-21T09:00+01:00'],parameters:{wolkenbasis:{file:'ecmwf-native/2026112106/ecmwf_om_data_wolkenbasis_2026112100_9c47b3ed0418.bin',components:1,source_run_utc:'2026-11-21T00:00Z',valid_until:'2026-11-21T07:00Z',clear_sky_value:9999}}};
 globalThis.fetch=async()=>Response.json(meta);
 try{const feed=await cloudCatalog('ecmwf','wolkenbasis'),r=feed.runs[0];assert.equal(r.id,'2026112100');assert.equal(r.steps[0].lead,7);assert.equal(r.steps.length,1);assert.equal(r.steps[0].nativeIndex,0);assert.equal(r.native.meta.times.length,2);}finally{globalThis.fetch=original;}
});
test('Een model zonder wolkenbasis blijft selecteerbaar met een expliciet ontbrekend bronveld',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>Response.json({run_utc:'2026-11-21T09:00Z',grid:{n_lat:2,n_lon:2},tijden:['2026-11-21T10:00Z'],parameters:{}});
 try{const r=(await cloudCatalog('arome','wolkenbasis')).runs[0];assert.deepEqual(r.native.meta.parameters,{});assert.equal(r.steps[0].keys[0],'cloudBase');}finally{globalThis.fetch=original;}
});
