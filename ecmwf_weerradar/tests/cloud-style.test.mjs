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
    assert.deepEqual(cloudStyle(65,65,0,lon,lat,true,40),smooth);
    assert.deepEqual(smooth,cloudStyle(65,65,0,0,0,false));
    close.push(cloudStyle(65,65,0,lon,lat,true,.6)[1]);
    far.push(cloudStyle(65,65,0,lon,lat,true,20)[1]);
  }
  const variance=a=>{const mean=a.reduce((s,v)=>s+v,0)/a.length;return a.reduce((s,v)=>s+(v-mean)**2,0)/a.length;};
  assert.ok(variance(far)<variance(close)*.05);
});

test('cloud texture has no strong horizontal or vertical alignment',()=>{
  let horizontal=0,vertical=0;
  for(let y=0;y<100;y++)for(let x=0;x<100;x++){
    const lon=3+x*.03,lat=50+y*.03*70/111;
    const opacity=cloudStyle(65,65,0,lon,lat,true,.4)[1];
    horizontal+=(cloudStyle(65,65,0,lon+.006,lat,true,.4)[1]-opacity)**2;
    vertical+=(cloudStyle(65,65,0,lon,lat+.006*70/111,true,.4)[1]-opacity)**2;
  }
  assert.ok(horizontal/vertical>.75&&horizontal/vertical<1.33,`${horizontal/vertical}`);
});

test('closed decks are smooth and partial cloud has restrained broad shading',()=>{
  const shades=[],alphas=[];
  let smallStepEnergy=0,broadStepEnergy=0;
  for(let y=0;y<80;y++)for(let x=0;x<80;x++){
    const lon=2+x*.04,lat=49+y*.04*70/111;
    for(const cover of [94,97,100]){
      assert.deepEqual(cloudStyle(cover,cover,0,lon,lat,true,.4),cloudStyle(cover,cover,0,0,0,false));
    }
    const [shade,alpha]=cloudStyle(60,60,0,lon,lat,true,.4);
    shades.push(shade);alphas.push(alpha);
    smallStepEnergy+=(cloudStyle(60,60,0,lon+1/70,lat,true,.4)[1]-alpha)**2;
    broadStepEnergy+=(cloudStyle(60,60,0,lon+8/70,lat,true,.4)[1]-alpha)**2;
  }
  assert.ok(Math.max(...shades)-Math.min(...shades)<=8,'partial cloud must not look speckled');
  assert.ok(Math.max(...alphas)-Math.min(...alphas)<.04,'texture must not punch fake holes');
  assert.ok(smallStepEnergy<broadStepEnergy*.05,'variation must be broad rather than granular');
});

test('cloud transition is continuous and visible on bright and dark backgrounds',()=>{
  for(let cover=7;cover<=100;cover+=.1){
    const previous=cloudStyle(cover-.1,cover-.1,0,4.2,51.4,true,.5)[1];
    const next=cloudStyle(cover,cover,0,4.2,51.4,true,.5)[1];
    assert.ok(next>=previous&&next-previous<.002,'no opacity cutoff at thin or closed cloud');
  }
  const [shade,alpha]=cloudStyle(100,100,0,4.2,51.4,true,.5);
  for(const background of [40,250]){
    const composite=shade*alpha+background*(1-alpha);
    assert.ok(Math.abs(composite-background)>25,'closed cloud should remain legible');
  }
});
