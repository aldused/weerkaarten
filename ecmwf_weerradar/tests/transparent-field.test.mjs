import test from 'node:test';
import assert from 'node:assert/strict';
import {transparentField} from '../transparent-field.mjs';
import {renderTile} from '../tile-renderer.mjs';
const field=(variable,values)=>({variable,data:{values:new Float32Array(values)}});
test('transparent precipitation and fog fields skip every pixel but retain real weather at thresholds',()=>{
 for(const f of [field('precipitation',[0,.01,NaN]),field('snowfall_water_equivalent',[0,0]),field('visibility',[500,10000,NaN])]){
  assert.equal(transparentField(f),true);
  const pixels=renderTile(f,{x:65,y:42,z:7});assert.equal(pixels.length,256*256*4);assert.ok(pixels.every(v=>v===0));
 }
 for(const f of [field('precipitation',[0,.05]),field('snowfall_water_equivalent',[0,1]),field('visibility',[499,10000]),field('temperature_2m',[0,0])])assert.equal(transparentField(f),false);
});
test('clear clouds can skip interpolation but a single cloudy source point cannot',()=>{
 const f={...field('cloud_cover',[0,0]),cloudLow:new Float32Array([0,0]),cloudMid:new Float32Array([0,0]),cloudHigh:new Float32Array([0,0])};
 assert.equal(transparentField(f),true);
 assert.equal(transparentField({...f,cloudHigh:new Float32Array([0,1])}),false);
 assert.equal(transparentField({...f,cloudHigh:undefined}),false);
});
