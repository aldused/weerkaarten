import test from 'node:test';
import assert from 'node:assert/strict';
import {createRegularGrid,createRegularTileSampler} from '../regular-grid.mjs';
import {fogBand} from '../fog-style.mjs';
const definition={n_lat:3,n_lon:4,lat_min:50,lat_max:54,lon_min:2,lon_max:8};
const grid=createRegularGrid(definition);

test('the map sampling argument never turns scalar HARMONIE values into angles',()=>{
 for(const value of [50000,10000,500,200,50,49,0,-5]){
  const values=new Float32Array(12).fill(value);
  assert.equal(grid.getInterpolatedValue(values,51,3,'monotone'),value);
  assert.equal(grid.getLinearInterpolatedValue(values,51,3,'linear'),value);
 }
});

test('actual visibility thresholds determine station fog, including exact boundaries',()=>{
 for(const [metres,expected] of [[50000,null],[10000,null],[500,null],[499,'fog'],[200,'fog'],[199,'thick'],[50,'thick'],[49,'dense'],[NaN,null]]){
  const actual=grid.getInterpolatedValue(new Float32Array(12).fill(metres),51,3,'monotone');
  assert.equal(fogBand(actual)?.id??null,expected,`${metres} metres`);
 }
});

test('station visibility uses the same scalar interpolation as painted raster pixels',()=>{
 const values=Float32Array.from([50000,45000,10000,20000,200,400,900,6000,50,180,10000,50000]);
 const sampler=createRegularTileSampler(grid,values,{z:6,x:32,y:21});
 let compared=0;
 for(let y=0;y<256;y+=9){const row=sampler.row(y);for(let x=0;x<256;x+=9){
  const point=grid.getInterpolatedValue(values,sampler.latitudes[y],sampler.longitudes[x],'monotone');
  assert.equal(point,row[x]);assert.equal(fogBand(point)?.id,fogBand(row[x])?.id);if(Number.isFinite(point))compared++;
 }}
 assert.ok(compared>100);
});

test('circular interpolation remains exclusive to wind direction',()=>{
 const directions=new Float32Array(12).fill(359);directions[1]=1;
 assert.equal(grid.getInterpolatedValue(directions,50,3,'monotone'),180);
 assert.ok(Math.abs(grid.getLinearInterpolatedDirection(directions,50,3))<1e-10);
 assert.ok(Number.isNaN(grid.getInterpolatedValue(directions,52,-1,'monotone')));
});
