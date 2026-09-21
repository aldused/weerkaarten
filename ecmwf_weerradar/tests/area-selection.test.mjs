import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionRect} from '../area-selection.mjs';
import {cropMapCanvas} from '../png-export.mjs';
test('selection works in every drag direction',()=>{
  for(const [a,b] of [[{x:20,y:30},{x:120,y:90}],[{x:120,y:90},{x:20,y:30}],[{x:120,y:30},{x:20,y:90}],[{x:20,y:90},{x:120,y:30}]])assert.deepEqual(selectionRect(a,b,500,400),{x:20,y:30,width:100,height:60});
});
test('selection is bounded by the map and rounds fractional pixels outward',()=>{
  assert.deepEqual(selectionRect({x:-10,y:-20},{x:600,y:500},500,400),{x:0,y:0,width:500,height:400});
  assert.deepEqual(selectionRect({x:20.2,y:30.4},{x:120.8,y:90.1},500,400),{x:20,y:30,width:101,height:61});
});
test('cropping copies only the selected source pixels, not the full viewport',()=>{
  const previous=globalThis.document,calls=[],cropped={getContext:()=>({drawImage:(...args)=>calls.push(args)})};
  globalThis.document={createElement:()=>cropped};
  try{const source={width:800,height:600},rect={x:20,y:30,width:200,height:100};
    assert.equal(cropMapCanvas(source,null),source);assert.equal(cropMapCanvas(source,rect),cropped);
    assert.equal(cropped.width,200);assert.equal(cropped.height,100);assert.deepEqual(calls[0],[source,20,30,200,100,0,0,200,100]);
    assert.throws(()=>cropMapCanvas(source,{x:700,y:0,width:200,height:100}),/buiten/);
  }finally{globalThis.document=previous;}
});
