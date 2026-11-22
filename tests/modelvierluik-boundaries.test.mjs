import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {boundaryLines} from '../vierluik/boundaries.js';
import {borderLines} from '../vierluik/border-lines.js';
const id=([a,b])=>[a.map(v=>Math.round(v*1e5)).join(','),b.map(v=>Math.round(v*1e5)).join(',')].sort().join('|');
test('Omgekeerde dubbele grenssegmenten worden één lijn, zonder andere grenzen te verliezen',()=>{
 const features=[{type:'LineString',coordinates:[[0,0],[1,1],[2,2]]},{type:'LineString',coordinates:[[1,1],[0,0],[0,1]]}];
 const all=boundaryLines(features)[0].coordinates,shared=boundaryLines(features,true)[0].coordinates;
 assert.equal(all.length,3);assert.deepEqual(shared,[[[0,0],[1,1]]]);assert.equal(new Set(all.map(id)).size,all.length);
});
test('Werkelijke Beneluxkaart houdt alleen interne provinciegrenzen over en tekent landen eenmaal',()=>{
 const html=readFileSync(new URL('../vierluik/map.html',import.meta.url),'utf8'),geo=JSON.parse(html.match(/<script id="bundle" type="application\/json">(.*?)<\/script>/s)[1]).map;
 const counts=new Map();geo.provinces.forEach((g,owner)=>{for(const line of g.type==='LineString'?[g.coordinates]:g.coordinates)for(let i=1;i<line.length;i++){const k=id([line[i-1],line[i]]);if(!counts.has(k))counts.set(k,new Set());counts.get(k).add(owner);}});
 const provinces=boundaryLines(geo.provinces,true)[0].coordinates,borders=boundaryLines(borderLines)[0].coordinates;
 assert.equal(provinces.length,[...counts.values()].filter(owners=>owners.size>1).length);
 assert.ok(provinces.length>500);assert.ok(provinces.every(edge=>counts.get(id(edge)).size>1));assert.equal(new Set(borders.map(id)).size,borders.length);
});
