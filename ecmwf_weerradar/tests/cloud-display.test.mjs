import test from 'node:test';
import assert from 'node:assert/strict';
import {writeCloudDisplay,BASE_COLORS} from '../cloud-display.mjs';
import {renderTile} from '../tile-renderer.mjs';
import {transparentField} from '../transparent-field.mjs';
import {exportLegends} from '../png-export.mjs';
const color=(style,l,m,h,mask=7,base=NaN)=>{const p=new Uint8ClampedArray(4);writeCloudDisplay(style,l,m,h,mask,base,p,0);return [...p];};
test('four-panel colors distinguish high, mid and low, preserving layer switches',()=>{
 const h=color('layers',0,0,100),m=color('layers',0,100,0),l=color('layers',100,0,0);
 assert.ok(h[2]>h[0]);assert.ok(m[0]>m[2]);assert.ok(l[0]>l[2]);
 assert.deepEqual(color('layers',100,100,100,4),h);
 assert.deepEqual(color('layers',0,0,0),[236,244,247,255]);
 assert.deepEqual(color('layers',NaN,0,100),[0,0,0,0]);
});
test('base uses real meters, preserves missing values and cloud-free sentinel',()=>{
 assert.deepEqual(color('base',0,0,0,7,73),[...BASE_COLORS[0],255]);
 assert.deepEqual(color('base',0,0,0,7,100),[...BASE_COLORS[1],255]);
 assert.deepEqual(color('base',0,0,0,7,9999),[236,244,247,255]);
 for(const v of [NaN,-1])assert.deepEqual(color('base',100,100,100,7,v),[0,0,0,0]);
});
test('height tiles use nearest source value even with cloud-free fractions',()=>{
 const field={variable:'cloud_cover',cloudDisplay:'base',data:{values:new Float32Array([0])},cloudLow:new Float32Array([0]),cloudMid:new Float32Array([0]),cloudHigh:new Float32Array([0]),cloudBase:new Float32Array([73]),grid:{getInterpolatedValue:()=>0,getNearestNeighborValue:()=>73}};
 assert.equal(transparentField(field),false);
 const pixels=renderTile(field,{x:16,y:10,z:5},4);
 assert.deepEqual([...pixels.slice(0,4)],[...BASE_COLORS[0],255]);
 field.cloudBase=null;assert.ok(renderTile(field,{x:16,y:10,z:5},4).every(v=>v===0));
});
test('PNG legends follow selected colors and report unavailable height',()=>{
 const args={mode:'weather',variables:['cloud_cover'],cloudVisible:7,hasBase:true};
 assert.equal(exportLegends({...args,cloudDisplay:'layers'})[0].color,'rgb(101,194,238)');
 const base=exportLegends({...args,cloudDisplay:'base'});assert.equal(base.length,10);assert.match(base[0].label,/0 m/);
 assert.match(exportLegends({...args,cloudDisplay:'base',hasBase:false})[0].label,/niet beschikbaar/);
});
