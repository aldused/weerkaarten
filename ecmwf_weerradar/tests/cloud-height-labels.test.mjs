import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudHeightLabels} from '../cloud-height-labels.mjs';
test('height labels sample nearest real base and exclude missing and cloud-free points',()=>{
 const field={cloudBase:new Float32Array([73]),grid:{getNearestNeighborValue:(values,lat,lon)=>lon<100?73:lon<200?9999:NaN}};
 const labels=cloudHeightLabels(field,([lng,lat])=>({lng,lat}),400,180);
 assert.equal(labels.length,2);assert.ok(labels.every(l=>l.text==='73m'));
 assert.equal(cloudHeightLabels(field,([lng,lat])=>({lng,lat}),400,180,{exclude:[[0,0,100,180]]}).length,0);
 assert.deepEqual(cloudHeightLabels(null,()=>{},400,180),[]);
 field.grid.getNearestNeighborValue=()=>11001;assert.ok(cloudHeightLabels(field,([lng,lat])=>({lng,lat}),400,180).every(l=>l.text==='11001m'));
 field.grid.getNearestNeighborValue=()=>-1;assert.deepEqual(cloudHeightLabels(field,([lng,lat])=>({lng,lat}),400,180),[]);
});
