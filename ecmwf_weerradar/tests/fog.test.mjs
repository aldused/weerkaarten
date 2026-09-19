import test from 'node:test';
import assert from 'node:assert/strict';
import {FOG_BANDS,fogBand,visibilityText,writeFogColor} from '../fog-style.mjs';
import {renderTile} from '../tile-renderer.mjs';
import {normalizeFieldData} from '../core.mjs';

test('mistkleur volgt uitsluitend het zicht, met exacte grenzen in meters',()=>{
  for(const value of [null,undefined,NaN,Infinity,-1,500,501,1000,10000])assert.equal(fogBand(value),null);
  for(const [value,id] of [[0,'dense'],[49.999,'dense'],[50,'thick'],[199.999,'thick'],[200,'fog'],[499.999,'fog']])assert.equal(fogBand(value)?.id,id);
  assert.equal(visibilityText(49.999),'<50 m');assert.equal(visibilityText(199.999),'<200 m');assert.equal(visibilityText(499.999),'<500 m');assert.equal(visibilityText(50),'50 m');assert.equal(visibilityText(null),'Zicht niet beschikbaar');
});
test('kaart gebruikt dezelfde kleuren als legenda en tooltip; alleen dichte mist heeft arcering',()=>{
  for(const [value,band] of [[20,FOG_BANDS[0]],[100,FOG_BANDS[1]],[300,FOG_BANDS[2]]]){
    const out=new Uint8ClampedArray(8);writeFogColor(value,out,0,3,3);writeFogColor(value,out,4,0,0);
    assert.deepEqual([...out.slice(0,3)],band.rgb);
    assert.equal(out[3],218);
    assert.equal(out[7]===235,band.hatch);
  }
  const left=new Uint8ClampedArray(4),right=new Uint8ClampedArray(4);
  writeFogColor(20,left,0,256,12);writeFogColor(20,right,0,0,12+256);assert.deepEqual(left,right);
});
test('echte tegelrenderer tekent geen mist bij ontbrekend zicht of boven de grens',()=>{
  for(const value of [NaN,-1,500,5000]){
    const tile=renderTile({variable:'visibility',data:{values:new Float32Array([value])},grid:{getInterpolatedValue:()=>value}},{z:6,x:32,y:21});
    assert.ok(tile.every(v=>v===0));
  }
  for(const value of [20,100,300]){
    const data={values:new Float32Array([value])},before=data.values.slice();
    const tile=renderTile({variable:'visibility',data,grid:{getInterpolatedValue:()=>value}},{z:6,x:32,y:21});
    assert.ok(tile.some(v=>v===218));assert.deepEqual(data.values,before);
  }
});
test('zicht wordt nooit als neerslag omgerekend, voor alle tijdvakken',()=>{
  for(const hours of [1,3,6]){
    const data={values:new Float32Array([0,49,50,199,200,499,500,10000,NaN])},before=data.values.slice();
    normalizeFieldData(data,'visibility',hours);assert.deepEqual(data.values,before);
  }
});
