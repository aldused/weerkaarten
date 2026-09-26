import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fieldContours,drawIsotherms} from '../isobars.mjs';
test('Temperature contours include negative, zero and positive degrees without sharing pressure intervals',()=>{
 const field={packed:{bounds:[0,0,2,2]},data:{values:[]},grid:{getInterpolatedValue:(_,lat,lon)=>lon*4-4}};
 const pressure=fieldContours(field),temperature=fieldContours(field,1);
 assert.ok(temperature.length>pressure.length);assert.ok(temperature.some(l=>l.level===-1));assert.ok(temperature.some(l=>l.level===0));assert.ok(temperature.some(l=>l.level===1));assert.equal(fieldContours(field,1),temperature);
 const text=[],ctx={save(){},restore(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},strokeText(){},fillText(t){text.push(t);}};
 const audit=drawIsotherms(ctx,field,([x,y])=>({x:x*200+50,y:y*200+50}),600,600);
 assert.ok(audit.lines>0);assert.ok(audit.labels>0);assert.ok(text.every(t=>t.endsWith('°')));
});
