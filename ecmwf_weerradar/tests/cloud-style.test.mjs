import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudStyle,cloudLayerStyle,cloudIconType,CLOUD_STYLES} from '../cloud-style.mjs';
import {renderTile} from '../tile-renderer.mjs';
import {createRegularGrid} from '../regular-grid.mjs';

test('100% high cloud remains a white veil; height sets distinct opacity bands',()=>{
  for(const type of ['high','mid','low'])for(let i=0;i<1000;i++){
    const rgba=cloudLayerStyle(type,100,2+i*.023,49+i*.017,true,.2),s=CLOUD_STYLES[type];
    assert.deepEqual(rgba.slice(0,3),s.rgb);
    assert.ok(rgba[3]>=s.opacity[0]&&rgba[3]<=s.opacity[1]);
    assert.equal(cloudLayerStyle(type,0,2,50,true,.2)[3],0);
  }
  for(const detail of [false,true])for(const km of [.1,1,3,20]){
    assert.ok(cloudStyle(0,0,100,5,52,detail,km)[3]<=.25);
    assert.ok(cloudStyle(0,100,0,5,52,detail,km)[3]<=.50);
    assert.ok(cloudStyle(100,0,0,5,52,detail,km)[3]>.60);
  }
});
test('model amount changes occupied area, not colour or opacity inside a cloud',()=>{
  for(const type of ['high','mid','low']){
    let area=0,identical=0;
    for(let i=0;i<10000;i++){
      const lon=-5+(i%100)*.14,lat=45+Math.floor(i/100)*.12;
      const part=cloudLayerStyle(type,30,lon,lat,true,.1),more=cloudLayerStyle(type,70,lon,lat,true,.1);
      const full=cloudLayerStyle(type,100,lon,lat,true,.1);
      // Integrate feathered edges by their fractional area instead of counting
      // every nearly transparent edge pixel as a completely covered pixel.
      area+=part[3]/full[3];
      if(Math.abs(part[3]-full[3])<1e-10)identical++;
      assert.ok(more[3]>=part[3]);assert.deepEqual(part.slice(0,3),more.slice(0,3));
    }
    assert.ok(area>2600&&area<3400,type+': '+area+'/10000 covered');
    assert.ok(identical>1600,type+': cloud fragments must keep their density');
  }
});
test('overlapping layers retain contributions and each can be inspected separately',()=>{
  const p=[5,52,false,1],combined=cloudStyle(100,100,100,...p);
  for(const mask of [1,2,4]){
    const single=cloudStyle(100,100,100,...p,mask);
    assert.notDeepEqual(single,combined);assert.ok(single[3]<combined[3]);
  }
  assert.deepEqual(cloudStyle(100,100,100,...p,0),[0,0,0,0]);
  assert.deepEqual(cloudStyle(100,100,100,...p,4),cloudStyle(0,0,100,...p));
  assert.deepEqual(cloudStyle(0,0,0,...p),[0,0,0,0]);
  assert.deepEqual(cloudStyle(NaN,0,100,...p),[0,0,0,0]);
});
test('coarse pixels and texture-off use area averaging with fixed per-height density',()=>{
  for(const type of ['high','mid','low']){
    const full=cloudLayerStyle(type,100,5,52,false),half=cloudLayerStyle(type,50,5,52,false);
    assert.equal(half[3],full[3]/2);
    assert.deepEqual(cloudLayerStyle(type,50,0,0,false),half);
    assert.deepEqual(cloudLayerStyle(type,50,5,52,true,80),half);
  }
});
test('illustrative low-cloud structure includes dense 85–95% cores without changing the input fraction',()=>{
 let dense=0;
 for(let i=0;i<1000;i++){
  const a=cloudLayerStyle('low',100,2+i*.023,49+i*.017,true,.2)[3];
  if(a>=.85){dense++;assert.ok(a<=.95);}
 }
 assert.ok(dense>50);
});
test('city icons keep sun/moon visible through a full high veil, unlike a low deck',()=>{
  assert.equal(cloudIconType(0,0,0),'clear');
  assert.equal(cloudIconType(0,0,100),'filtered');
  assert.equal(cloudIconType(0,100,0),'filtered');
  assert.equal(cloudIconType(100,0,0),'overcast');
  assert.equal(cloudIconType(100,100,100),'overcast');
  assert.equal(cloudIconType(NaN,0,100),null);
});
test('actual tile renderer uses all three model fields and preserves source values',()=>{
  const grid=createRegularGrid({n_lat:2,n_lon:2,lon_min:0,lon_max:12,lat_min:48,lat_max:57}),coords={z:6,x:32,y:21};
  const values=new Float32Array(4).fill(100),zero=new Float32Array(4),field={variable:'cloud_cover',data:{values},grid,texture:false};
  const high=renderTile({...field,cloudLow:zero,cloudMid:zero,cloudHigh:values},coords);
  const low=renderTile({...field,cloudLow:values,cloudMid:zero,cloudHigh:zero},coords);
  let valid=0;for(let p=0;p<high.length;p+=4)if(high[p+3]){valid++;assert.ok(high[p+3]<=64);assert.ok(high[p]>240);assert.ok(low[p+3]>=153);assert.ok(low[p]<150);}
  assert.ok(valid>10000);assert.ok(values.every(v=>v===100));assert.ok(zero.every(v=>v===0));
  assert.throws(()=>renderTile(field,coords),/wolkenlagen ontbreken/);
});
