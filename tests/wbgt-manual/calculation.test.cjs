const {test}=require('node:test');
const assert=require('node:assert/strict');
require('../../wbgt_core.js');
const base={method:'model',exposure:'outdoor',Ta:30,RH:60,S:700,wind:2,windHeight:10,elevation:45,pressure:1013.25,fdir:.8};
const calc=(a={})=>WBGT.calculateManual({...base,...a});
test('144 independent C reference cases: natural wet bulb, globe and WBGT',()=>{
 const {cases}=require('./liljegren-reference.json');let max=0;
 for(const a of cases){
  const c=calc({...a,windHeight:2,fdir:a.fd});
  for(const key of ['Tnw','Tg','WBGT']){const d=Math.abs(c[key]-a.expected[key]);max=Math.max(max,d);assert.ok(d<.04,`${key}, ${JSON.stringify(a)}: difference ${d}`);}
 }
 console.log('Maximum unrounded difference from C reference:',max.toFixed(5),'°C');
});
test('Measured weighted temperatures: exact sun and no-sun formula',()=>{
 assert.equal(calc({method:'measured',Ta:30,Tnw:25,Tg:40}).WBGT,28.5);
 assert.equal(calc({method:'measured',exposure:'shade',Ta:30,Tnw:25,Tg:40}).WBGT,29.5);
});
test('Shade uses globe temperature rather than silently substituting air temperature',()=>{
 const c=calc({exposure:'shade'});assert.equal(c.S,0);
 assert.equal(c.WBGT,.7*c.Tnw+.3*c.Tg);assert.notEqual(c.Tg,c.Ta);
 assert.equal(c.u2m,calc().u2m);
});
test('No arbitrary formula change around 50 W/m²',()=>{
 const a=calc({S:49.99}),b=calc({S:50.01});assert.ok(Math.abs(a.WBGT-b.WBGT)<.01);
 assert.deepEqual(a.weights,[.7,.2,.1]);assert.deepEqual(b.weights,[.7,.2,.1]);
});
test('10 m wind correction: day/night and KNMI minimum',()=>{
 assert.ok(Math.abs(calc().u2m-2*Math.pow(.2,.15))<1e-12);
 assert.equal(calc({wind:0}).WBGT,calc({wind:.62}).WBGT);
 assert.ok(Math.abs(calc({S:0,elevation:-10}).u2m-2*Math.pow(.2,.3))<1e-12);
 assert.equal(calc({wind:2,windHeight:2}).u2m,2);
});
test('Expected responses to radiation, humidity, wind and pressure',()=>{
 assert.ok(calc().WBGT>calc({S:0}).WBGT);
 assert.ok(calc({RH:80}).WBGT>calc({RH:40}).WBGT);
 assert.ok(calc({wind:8}).WBGT<calc({wind:1}).WBGT);
 assert.notEqual(calc({pressure:800}).Tnw,calc().Tnw);
 assert.notEqual(calc({elevation:25}).Tg,calc({elevation:65}).Tg);
});
test('Invalid or missing required inputs never produce plausible output',()=>{
 for(const a of [{Ta:NaN},{Ta:100},{RH:101},{RH:-1},{RH:0},{wind:-1},{S:-1},{pressure:0},{pressure:Infinity},{elevation:null},{S:700,elevation:0},{fdir:1},{method:'measured',Tnw:null,Tg:40}])assert.equal(calc(a),null,JSON.stringify(a));
});
test('Hittekracht boundary values are classified before rounding',()=>{
 for(const [x,y] of [[13.999,0],[14,1],[15.999,1],[16,2],[31.999,9],[32,10],[45,10]])assert.equal(WBGT.wbgtHittekracht(x),y);
});
