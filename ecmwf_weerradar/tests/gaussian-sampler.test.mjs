import test from 'node:test';
import assert from 'node:assert/strict';
import {GridFactory,domainOptions,getRanges} from '@openmeteo/weather-map-layer';
import {createGaussianTileSampler,clearGaussianSamplerCache,gaussianSamplerCacheStats} from '../gaussian-sampler.mjs';

const native=domainOptions.find(domain=>domain.value==='ecmwf_ifs').grid;
function makeField(gridData=native,bounds=[-180,35,180,65]){
  const ranges=getRanges(gridData,bounds),grid=GridFactory.create(gridData,ranges);
  const values=new Float32Array(ranges[1].end-ranges[1].start);
  // Smooth transitions, abrupt fronts, local extrema, zero and negative values.
  for(let i=0;i<values.length;i++)values[i]=Math.sin(i*.019)*20+Math.cos(i*.0013)*7+(i%977<350?31:0);
  return {grid,values,ranges};
}
function compare(field,coords,size=64){
  const sampler=createGaussianTileSampler(field.grid,field.values,coords,size);
  assert.ok(sampler);
  let finite=0,missing=0;
  for(let y=0;y<size;y++){
    const row=sampler.row(y);
    for(let x=0;x<size;x++){
      const expected=field.grid.getInterpolatedValue(field.values,sampler.latitudes[y],sampler.longitudes[x],'monotone');
      assert.equal(row[x],expected,`exact sample at ${coords.z}/${coords.x}/${coords.y}, pixel ${x}/${y}`);
      if(Number.isFinite(expected))finite++;else missing++;
    }
  }
  return {finite,missing};
}

test('native O1280 cached rows exactly match upstream monotone at all tile pixels',()=>{
  const field=makeField();
  for(const coords of [{z:6,x:33,y:21},{z:7,x:63,y:42},{z:8,x:132,y:85}]){
    assert.equal(compare(field,coords,256).finite,256*256);
  }
});

test('longitude seams, missing points and the edges of loaded latitude bands match upstream',()=>{
  const field=makeField(native,[-180,48,180,56]);
  for(let i=13;i<field.values.length;i+=29)field.values[i]=NaN;
  for(let i=8;i<field.values.length;i+=113)field.values[i]=Infinity;
  for(const coords of [{z:6,x:0,y:21},{z:6,x:63,y:21},{z:6,x:64,y:21},{z:6,x:-1,y:21},{z:5,x:16,y:10}]){
    const result=compare(field,coords);
    assert.ok(result.finite>0);assert.ok(result.missing>0);
  }
});

test('polar linear fallbacks preserve upstream results',()=>{
  const lines=16,gridData={...native,gaussianGridLatitudeLines:lines,nx:4*lines*(lines+9)};
  const grid=GridFactory.create(gridData),values=Float32Array.from({length:gridData.nx},(_,i)=>Math.sin(i*.05));
  for(const coords of [{z:3,x:3,y:0},{z:3,x:4,y:7}])compare({grid,values},coords);
});

test('geometry cache shares variables and times but respects data ranges and bounded memory',()=>{
  clearGaussianSamplerCache();
  const field=makeField(),coords={z:7,x:65,y:42};
  const first=createGaussianTileSampler(field.grid,field.values,coords,32);
  const state=gaussianSamplerCacheStats();
  const nextValues=Float32Array.from(field.values,value=>value+5);
  const next=createGaussianTileSampler(GridFactory.create(native,field.ranges),nextValues,coords,32);
  assert.equal(first.longitudes,next.longitudes,'same geometry reused between variables/times');
  assert.deepEqual(gaussianSamplerCacheStats(),state);
  compare({...field,values:nextValues},coords,32);
  const other=makeField(native,[-180,40,180,62]);
  compare(other,coords,32);
  assert.equal(gaussianSamplerCacheStats().tiles,2,'range offsets need separate indices');
  for(let x=0;x<80;x++)createGaussianTileSampler(field.grid,field.values,{z:7,x,y:42},32);
  const bounded=gaussianSamplerCacheStats();
  assert.ok(bounded.tiles<=bounded.maxTiles&&bounded.bytes<=bounded.maxBytes);
  assert.equal(createGaussianTileSampler({},field.values,coords),null);
  clearGaussianSamplerCache();
  // Wide, zoomed-out tiles exceed the byte budget before the tile-count cap.
  for(let x=0;x<8;x++)createGaussianTileSampler(field.grid,field.values,{z:3,x,y:3},128);
  const byteBounded=gaussianSamplerCacheStats();
  assert.ok(byteBounded.tiles<8&&byteBounded.bytes<=byteBounded.maxBytes);
  clearGaussianSamplerCache();
  assert.equal(gaussianSamplerCacheStats().bytes,0);
});

test('precipitation interpolation does not create negative rain, overshoot maxima or paint a wholly dry field',()=>{
 const field=makeField(native,[-180,44,180,60]),coords={z:6,x:31,y:21};
 for(const max of [0,.1,8]){
  for(let i=0;i<field.values.length;i++)field.values[i]=(i%19<4)?max:0;
  const sampler=createGaussianTileSampler(field.grid,field.values,coords,128);
  for(let y=0;y<128;y++)for(const value of sampler.row(y))assert.ok(value>=0&&value<=max+1e-6,`${value} outside 0..${max}`);
 }
});
