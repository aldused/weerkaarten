import test from 'node:test';
import assert from 'node:assert/strict';
import {MovingOverlay} from '../moving-overlay.mjs';
test('a complete drag reuses painted pixels and redraws only once on release',()=>{
 let x=100,y=200,zoom=6,draws=0;
 const map={getCenter:()=>({lng:5,lat:52}),project:()=>({x,y}),getZoom:()=>zoom};
 const canvas={style:{}},overlay=new MovingOverlay(map,canvas,()=>draws++);
 overlay.start();
 for(let i=0;i<120;i++){x++;y+=2;overlay.move();}
 assert.equal(draws,0);assert.equal(overlay.moving,true);
 assert.equal(canvas.style.transform,'translate3d(120px,240px,0) scale(1)');
 overlay.finish();assert.equal(draws,1);assert.equal(canvas.style.transform,'');assert.equal(overlay.moving,false);
 overlay.start();zoom++;x=400;y=600;overlay.move();
 assert.equal(canvas.style.transform,'translate3d(-40px,-280px,0) scale(2)');
 overlay.finish();assert.equal(draws,2);
});
test('nested movement starts keep the original painted anchor',()=>{
 let x=100;const canvas={style:{}},map={getCenter:()=>({lng:5,lat:52}),project:()=>({x,y:100}),getZoom:()=>6};
 const overlay=new MovingOverlay(map,canvas,()=>{});overlay.start();x=120;overlay.start();overlay.move();
 assert.equal(canvas.style.transform,'translate3d(20px,0px,0) scale(1)');
});
