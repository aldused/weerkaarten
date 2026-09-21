import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudStyle,cloudLayerStyle,VERY_LOW_CLOUD} from '../cloud-style.mjs';
import {renderTile} from '../tile-renderer.mjs';
import {createRegularGrid} from '../regular-grid.mjs';

const types=['high','mid','low'];
const luminance=rgb=>rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
const composite=(rgba,background)=>background.map((channel,i)=>rgba[i]*rgba[3]+channel*(1-rgba[3]));
const distance=(a,b)=>Math.hypot(...a.map((channel,i)=>channel-b[i]));
const fullLayer=type=>cloudLayerStyle(type,100,5,52,false);

test('cloud swatches on an identical light background separate a white veil, middle cloud and grey low deck',()=>{
  const background=[242,245,248];
  const [high,mid,low]=types.map(type=>composite(fullLayer(type),background));
  const upperDifference=luminance(high)-luminance(mid);
  const lowerDifference=luminance(mid)-luminance(low);
  assert.ok(upperDifference>=12,'high and middle cloud need a visible lightness step on the same background');
  assert.ok(lowerDifference>=60,'low cloud must be substantially darker than middle cloud');
  assert.ok(lowerDifference>upperDifference*3,'a low deck must not resemble a second pale veil');
  assert.ok(luminance(fullLayer('high'))>=254,'the high-cloud tint itself should be nearly pure white');
  assert.ok(luminance(fullLayer('low'))<=120,'the low-cloud tint itself should be clearly grey');
});

test('map detail stays legible through a full high veil, decreases under middle cloud and is largely covered by low cloud',()=>{
  // Representative adjacent land and sea colours; compare the remaining
  // map contrast rather than demanding exact rendered screenshot pixels.
  const surfaces={land:[[86,119,73],[149,165,112]],sea:[[69,113,139],[137,171,187]]};
  for(const [surface,[a,b]] of Object.entries(surfaces)){
    const original=distance(a,b);
    const [high,mid,low]=types.map(type=>distance(composite(fullLayer(type),a),composite(fullLayer(type),b))/original);
    assert.ok(high>=.85,`${surface}: a full high veil should preserve at least 85% of map contrast`);
    assert.ok(mid>=.50&&mid<=.70,`${surface}: middle cloud should leave an intermediate amount of map contrast`);
    assert.ok(low<=.20,`${surface}: a full low deck should cover most map contrast`);
    assert.ok(high>mid&&mid>low);
  }
});

test('simultaneous cloud layers remain independently switchable without washing a low deck white',()=>{
  const args=[100,100,100,5,52,false,1];
  const all=cloudStyle(...args,7);
  assert.ok(luminance(all)<135,'overlapping white high cloud must not turn the compact low deck pale');
  assert.ok(all[3]>=.85,'overlapping layers remain substantially opaque');
  for(const [type,bit] of [['high',4],['mid',2],['low',1]]){
    assert.deepEqual(cloudStyle(...args,bit),fullLayer(type),`${type} can be inspected alone`);
    const without=cloudStyle(...args,7^bit);
    assert.ok(without[3]<all[3],`${type} still contributes when all layers are visible`);
    assert.notDeepEqual(without,all);
  }
  assert.deepEqual(cloudStyle(...args,0),[0,0,0,0]);
});

test('very low cloud remains a uniform pale warm-grey layer even below higher clouds',()=>{
  const onlyLow=cloudStyle(100,0,0,5,52,false,1,7,100);
  assert.deepEqual(onlyLow,[...VERY_LOW_CLOUD.rgb,VERY_LOW_CLOUD.opacity]);
  assert.ok(onlyLow[0]>onlyLow[2]&&onlyLow[1]>onlyLow[2],'a subtle warm tint distinguishes the very low layer');
  const all=cloudStyle(100,100,100,5,52,false,1,7,100);
  assert.ok(all[0]>all[2]&&all[1]>all[2],'higher layers should not erase the warm very-low-cloud cue');
  assert.deepEqual(all,cloudStyle(100,100,100,9,54,false,1,7,100),'the normal mist style is uniform, not a texture');
});

test('tile compositing uses all original percentages unchanged and honours independent layer visibility',()=>{
  const grid=createRegularGrid({n_lat:2,n_lon:2,lon_min:0,lon_max:12,lat_min:48,lat_max:57});
  const coords={z:6,x:32,y:21};
  const source={values:new Float32Array(4).fill(93),low:new Float32Array(4).fill(100),mid:new Float32Array(4).fill(65),high:new Float32Array(4).fill(90)};
  const originals=Object.fromEntries(Object.entries(source).map(([name,values])=>[name,values.slice()]));
  const field={variable:'cloud_cover',data:{values:source.values},grid,texture:false,cloudLow:source.low,cloudMid:source.mid,cloudHigh:source.high};
  const all=renderTile({...field,cloudVisible:7},coords);
  const high=renderTile({...field,cloudVisible:4},coords);
  const low=renderTile({...field,cloudVisible:1},coords);
  let checked=0;
  for(let p=0;p<all.length;p+=4){
    if(!all[p+3])continue;
    checked++;
    assert.ok(luminance(all.subarray(p,p+3))<135,'the actual rendered overlap should stay grey');
    assert.ok(high[p+3]<=35,'a 90% high veil should remain very transparent');
    assert.ok(low[p+3]>=204,'the low layer should obscure most of the map');
    assert.ok(all[p+3]>low[p+3],'the higher source layers still contribute to the composite');
  }
  assert.ok(checked>10000,'test a substantial valid part of the rendered tile');
  for(const [name,values] of Object.entries(source))assert.deepEqual(values,originals[name],`${name} source percentages must not be changed by presentation`);
});
