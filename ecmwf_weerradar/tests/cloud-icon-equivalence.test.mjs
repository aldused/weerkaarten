import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cloudIconType,cloudStyle} from '../cloud-style.mjs';
test('fast cloud icons retain composited-opacity classification',()=>{
 for(let low=-5;low<=105;low+=5)for(let mid=-5;mid<=105;mid+=5)for(let high=-5;high<=105;high+=5){
  const opacity=cloudStyle(low,mid,high,0,0,false)[3];
  assert.equal(cloudIconType(low,mid,high),opacity<.08?'clear':opacity<.60?'filtered':'overcast');
 }
 assert.equal(cloudIconType(NaN,10,20),null);
});
