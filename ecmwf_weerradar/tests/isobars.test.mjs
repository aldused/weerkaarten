import test from 'node:test';
import assert from 'node:assert/strict';
import {contours,hasIsobars,fieldContours} from '../isobars.mjs';
test('planar pressure gradient has correctly located, joined 4 hPa contours',()=>{
 const lines=contours([1002,1006,1010,1002,1006,1010,1002,1006,1010],3,3);
 assert.deepEqual(lines.map(l=>l.level),[1004,1008]);
 for(const l of lines){assert.equal(l.points.length,3);assert.ok(l.points.every(p=>p[0]===(l.level-1002)/4));assert.deepEqual(l.points.map(p=>p[1]).sort(),[0,1,2]);}
});
test('closed pressure centre produces a closed contour',()=>{
 const lines=contours([1000,1000,1000,1000,1010,1000,1000,1000,1000],3,3);
 const line=lines.find(l=>l.level===1004);assert.deepEqual(line.points[0],line.points.at(-1));
});
test('missing data never produces artificial contours; a flat field is empty',()=>{
 assert.deepEqual(contours([NaN,1010,1000,1010],2,2),[]);
 assert.deepEqual(contours([1004,1004,1004,1004],2,2),[]);
});
test('saddle cells produce two separate branches at the intermediate level',()=>{
 const lines=contours([1001,1010,1010,1001],2,2).filter(l=>l.level===1004);
 assert.equal(lines.length,2);assert.ok(lines.every(l=>l.points.length===2));
});
test('pressure overlay is only offered for ECMWF with actual sea-level pressure',()=>{
 assert.equal(hasIsobars({variables:['pressure_msl']}),true);
 assert.equal(hasIsobars({variables:[]}),false);
 assert.equal(hasIsobars({modelId:'harmonie',variables:['pressure_msl']}),false);
});
test('field geometry is cached per immutable field and remains in geographic coordinates',()=>{
 let calls=0;const field={packed:{bounds:[4,50,5,51]},data:{values:[]},grid:{getInterpolatedValue:(_v,lat,lon)=>{calls++;return 1000+(lon-4)*8;}}};
 const a=fieldContours(field),n=calls,b=fieldContours(field);assert.equal(a,b);assert.equal(calls,n);
 assert.ok(a.find(l=>l.level===1004).points.every(p=>p[0]===4.5&&p[1]>=50&&p[1]<=51));
});

import {normalizeFieldData} from '../core.mjs';
test('native ECMWF pressure in Pa converts to hPa exactly once',()=>{
 const data={values:new Float32Array([102190,100000,NaN]),scaleFactor:.01};
 normalizeFieldData(data,'pressure_msl');normalizeFieldData(data,'pressure_msl');
 assert.equal(data.values[0],1021.9000244140625);assert.equal(data.values[1],1000);assert.ok(Number.isNaN(data.values[2]));assert.equal(data.scaleFactor,1);
});
