import test from 'node:test';
import assert from 'node:assert/strict';
import {GridFactory,domainOptions,getRanges} from '@openmeteo/weather-map-layer';
import {packField,createPackedGrid} from '../packed-grid.mjs';
import {buildSignificantField} from '../significant-weather.mjs';

test('batched significant interpolation preserves every category, missing values and crop edges',()=>{
 const bounds=[3,50,7,54],gridData=domainOptions.find(d=>d.value==='ecmwf_ifs').grid,ranges=getRanges(gridData,bounds);
 const values=Float32Array.from({length:ranges[1].end-ranges[1].start},(_,i)=>i%97===0?NaN:Math.sin(i*.03)*.7+.3);
 const packet=packField({values,scaleFactor:1},gridData,ranges,bounds);
 const grid=createPackedGrid(packet.metadata),field=(factor,offset=0)=>({data:{values:Float32Array.from(packet.values,v=>v*factor+offset)},grid});
 const fields={precipitation:field(1),snowfall_water_equivalent:field(.3),visibility:field(5000,1000),cloud_cover:field(100)};
 Object.assign(fields.cloud_cover,{cloudLow:fields.cloud_cover.data.values,cloudMid:field(60).data.values,cloudHigh:field(80,20).data.values});
 const reference=Object.fromEntries(Object.entries(fields).map(([key,f])=>[key,{...f,grid:{getInterpolatedValue:f.grid.getInterpolatedValue}}]));
 const t0=performance.now(),expected=buildSignificantField(reference,[2.9,49.9,7.1,54.1],9),t1=performance.now();
 const actual=buildSignificantField(fields,[2.9,49.9,7.1,54.1],9),t2=performance.now();
 assert.deepEqual(actual,expected);
 console.log(JSON.stringify({referenceMs:Math.round(t1-t0),optimizedMs:Math.round(t2-t1),cells:actual.values.length}));
});
