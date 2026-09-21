import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionRect} from '../area-selection.mjs';
import {cropMapCanvas} from '../png-export.mjs';
test('selection stays exactly square in every drag direction',()=>{
  for(const dx of [-100,100])for(const dy of [-60,60])assert.deepEqual(selectionRect({x:200,y:200},{x:200+dx,y:200+dy},500,400),{x:dx<0?100:200,y:dy<0?100:200,width:100,height:100});
});
test('square remains bounded at every edge and uses exact integer dimensions',()=>{
  assert.deepEqual(selectionRect({x:-10,y:-20},{x:600,y:500},500,400),{x:0,y:0,width:400,height:400});
  assert.deepEqual(selectionRect({x:20.2,y:30.4},{x:120.8,y:90.1},500,400),{x:20,y:30,width:101,height:101});
  for(const start of [{x:5,y:5},{x:495,y:395},{x:250.4,y:200.6}])for(const end of [{x:-100,y:-100},{x:700,y:600},{x:0,y:600},{x:700,y:0}]){
    const r=selectionRect(start,end,500,400);assert.equal(r.width,r.height);assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=500&&r.y+r.height<=400);
  }
});
test('horizontal and vertical drags produce squares; a click stays empty',()=>{
  for(const end of [{x:180,y:100},{x:100,y:180}])assert.deepEqual(selectionRect({x:100,y:100},end,500,400),{x:100,y:100,width:80,height:80});
  assert.equal(selectionRect({x:100,y:100},{x:100,y:100},500,400).width,0);
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
