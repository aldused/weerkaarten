import test from 'node:test';
import assert from 'node:assert/strict';
import {visibilityMinima} from '../vierluik/visibility-labels.js';
const grid={w:40,h:30,lon0:0,lat0:0,dx:1,dy:1};
const project=(x,y)=>[x*10,y*10];
const view={width:400,height:300,font:16};
test('Smalle mistgebieden tussen vaste ankers leveren hun werkelijke minimum, laagste eerst',()=>{
 const v=new Float32Array(grid.w*grid.h).fill(25000);
 v[10*grid.w+10]=800;v[10*grid.w+11]=200;v[20*grid.w+28]=500;
 const points=visibilityMinima(v,grid,project,view);
 assert.deepEqual(points.map(p=>p.value),[200,500]);
 assert.deepEqual([points[0].lon,points[0].lat],[11,10]);
});
test('Niet zichtbare minima en ontbrekende waarden verdringen geen zichtbare mistlabels',()=>{
 const v=new Float32Array(grid.w*grid.h).fill(NaN);
 v[0]=0;v[10*grid.w+10]=-1;v[20*grid.w+28]=900;
 assert.deepEqual(visibilityMinima(v,grid,project,view).map(p=>p.value),[900]);
 assert.deepEqual(visibilityMinima(null,grid,project,view),[]);
});
