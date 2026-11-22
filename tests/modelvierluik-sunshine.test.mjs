import test from 'node:test';
import assert from 'node:assert/strict';
import {sunshinePerHour} from '../vierluik/sunshine.js';
test('Zonduur per 1, 3 en 6 uur krijgt dezelfde schaal van 0 tot 60 min/uur',()=>{
 assert.deepEqual([...sunshinePerHour([0,30,60],1)],[0,30,60]);
 assert.deepEqual([...sunshinePerHour([0,90,180],3)],[0,30,60]);
 assert.deepEqual([...sunshinePerHour([0,180,360],6)],[0,30,60]);
});
test('Ontbrekende zonduur wordt geen nul; een ongeldige bronperiode wordt niet verzonnen',()=>{
 const source=new Float32Array([NaN,-1,200]);
 const out=sunshinePerHour(source,3);
 assert.ok(Number.isNaN(out[0])&&Number.isNaN(out[1]));assert.equal(out[2],60);assert.equal(source[2],200);
 assert.equal(sunshinePerHour(null,1),null);assert.equal(sunshinePerHour([30],0),null);
});
