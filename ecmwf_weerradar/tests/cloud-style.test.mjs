import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudStyle} from '../cloud-style.mjs';

test('cloud illustration preserves clear sky, overcast and increasing model cover',()=>{
  for(let y=0;y<12;y++)for(let x=0;x<12;x++){
    const lon=4+x*.023,lat=51+y*.016;
    let previous=-1;
    for(let cover=0;cover<=100;cover+=5){
      const [shade,alpha]=cloudStyle(cover,cover,0,lon,lat,true,.6);
      assert.ok(shade>=193&&shade<=251);
      assert.ok(alpha>=previous&&alpha<=.92);
      previous=alpha;
      if(cover===0)assert.equal(alpha,0);
      if(cover===100)assert.equal(alpha,.92);
    }
  }
});

test('subpixel cloud structure fades out and smooth mode stays independent of coordinates',()=>{
  const far=[],close=[];
  for(let i=0;i<200;i++){
    const lon=4+i*.013,lat=51+i*.007;
    const smooth=cloudStyle(65,65,0,lon,lat,false);
    assert.deepEqual(cloudStyle(65,65,0,lon,lat,true,20),smooth);
    assert.deepEqual(smooth,cloudStyle(65,65,0,0,0,false));
    close.push(cloudStyle(65,65,0,lon,lat,true,.6)[1]);
    far.push(cloudStyle(65,65,0,lon,lat,true,6)[1]);
  }
  const variance=a=>{const mean=a.reduce((s,v)=>s+v,0)/a.length;return a.reduce((s,v)=>s+(v-mean)**2,0)/a.length;};
  assert.ok(variance(far)<variance(close)*.05);
});

test('cloud texture has no strong horizontal or vertical alignment',()=>{
  let horizontal=0,vertical=0;
  for(let y=0;y<100;y++)for(let x=0;x<100;x++){
    const lon=3+x*.006,lat=50+y*.006*70/111;
    const shade=cloudStyle(80,80,0,lon,lat,true,.4)[0];
    horizontal+=(cloudStyle(80,80,0,lon+.006,lat,true,.4)[0]-shade)**2;
    vertical+=(cloudStyle(80,80,0,lon,lat+.006*70/111,true,.4)[0]-shade)**2;
  }
  assert.ok(horizontal/vertical>.75&&horizontal/vertical<1.33,`${horizontal/vertical}`);
});
