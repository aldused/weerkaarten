const assert=require('node:assert/strict');
const test=require('node:test');
const C=require('../vierluik-core');
const grid={lat_min:50,lat_max:54,lon_min:3,lon_max:7,n_lat:2,n_lon:2};
const t=h=>new Date(Date.UTC(2026,8,6,h)).toISOString();
function pd(values,extra={}){return {data:Float32Array.from(values.flatMap(v=>Array(4).fill(v))),nLat:2,nLon:2,nSteps:values.length,nComp:1,grid,schaal:1,...extra};}
function binary(dtype,values){
  const b=new ArrayBuffer(16+values.length*(dtype===0?4:1)),v=new DataView(b);
  [2,2,values.length/4,1].forEach((n,i)=>v.setUint16(i*2,n,true));v.setUint8(8,dtype);
  if(dtype===0)new Float32Array(b,16).set(values);else new Uint8Array(b,16).set(values);
  return b;
}
test('Amsterdam feed times are timezone independent, including winter and DST transitions',()=>{
  assert.equal(C.timeMs('2026-09-06T14:00:00'),Date.parse('2026-09-06T12:00:00Z'));
  assert.equal(C.timeMs('2026-01-06T14:00:00'),Date.parse('2026-01-06T13:00:00Z'));
  assert.equal(C.timeMs('2026-03-29T03:00:00')-C.timeMs('2026-03-29T01:00:00'),C.HOUR);
  assert.ok(Number.isNaN(C.timeMs('2026-03-29T02:00:00')));
  assert.equal(C.timeMs('2026-10-25T02:00:00+01:00')-C.timeMs('2026-10-25T02:00:00+02:00'),C.HOUR);
  assert.equal(C.dayKey('2026-09-06T22:30:00Z'),'2026-09-07');
});
test('Float32 and all published byte encodings preserve the physical scale',()=>{
  assert.equal(C.decode(binary(0,[1,2,3,4]),{}, {grid}).data[2],3);
  for(const power of [1,2,3])assert.equal(C.decode(binary(1,[0,16,32,48]),{scale:16,power},{grid}).data[2],2**power);
  const d=C.decode(binary(2,[0,85,170,255]),{},{grid});
  assert.equal(C.sample(d,0,54,7),1);
  assert.equal(C.sample(d,0,52,5),.5);
});
test('Corrupt, mismatched and unsupported binary files fail explicitly',()=>{
  const b=binary(0,[1,2,3,4]);
  assert.throws(()=>C.decode(b.slice(0,-1),{},{grid}),/databestand/);
  assert.throws(()=>C.decode(b,{components:3},{grid}),/componenten/);
  assert.throws(()=>C.decode(b,{}, {grid,tijden:[t(0),t(1)]}),/tijdstappen/);
  assert.throws(()=>C.decode(b,{}, {grid:{...grid,n_lon:3}}),/Rooster/);
  const invalid=b.slice(0);new DataView(invalid).setUint8(8,9);
  assert.throws(()=>C.decode(invalid,{},{grid}),/datatype/);
});
test('Bilinear sampling preserves gradients, missing data and exact domain boundaries',()=>{
  const d=pd([0],{data:Float32Array.from([0,10,20,30])});
  assert.equal(C.sample(d,0,52,5),15);
  assert.equal(C.sample(d,0,54,7),30);
  assert.equal(C.sample(d,0,54.001,7),null);
  d.data[3]=NaN;
  assert.equal(C.sample(d,0,52,5),null);
  assert.equal(C.sample(d,0,50,3),0);
  assert.equal(C.bilinear(0,10,20,NaN,0,0),0);
  assert.ok(Number.isNaN(C.bilinear(0,10,20,NaN,.5,.5)));
  assert.equal(C.sample(d,1,50,3),null);
  assert.equal(C.sample(d,0,50,3,1),null);
});
test('Wind gust magnitudes do not cancel across opposite source directions',()=>{
  const d=pd([0],{nComp:2,data:Float32Array.from([10,-10,10,-10,0,0,0,0])});
  assert.equal(C.sample(C.gustMagnitude(d),0,52,5),10);
  d.data[4]=NaN;
  assert.equal(C.sample(C.gustMagnitude(d),0,52,5),null);
});
test('Rain accumulations use the exact same baseline across different model run starts',()=>{
  const a=C.cumulative(pd([99,99,3,4]),[0,1,2,3].map(t),Date.parse(t(1)));
  const b=C.cumulative(pd([77,3,4]),[1,2,3].map(t),Date.parse(t(1)));
  assert.equal(C.sample(a,1,52,5),0);
  assert.equal(C.sample(a,3,52,5),7);
  assert.equal(C.sample(b,2,52,5),7);
  assert.equal(C.sample(a,0,52,5),null);
});
test('Rain totals preserve missing hours and missing grid cells through later steps',()=>{
  let d=C.cumulative(pd([0,2,4]),[0,1,3].map(t),Date.parse(t(0)));
  assert.equal(C.sample(d,2,52,5),null);
  d=C.cumulative(pd([0,NaN,4]),[0,1,2].map(t),Date.parse(t(0)));
  assert.equal(C.sample(d,2,52,5),null);
});
test('Decoded scales apply before rain and sunshine accumulation',()=>{
  const d=pd([0,2,4],{schaal:.5});
  assert.equal(C.sample(C.cumulative(d,[0,1,2].map(t),Date.parse(t(0))),2,52,5),3);
});
test('Sun intervals ending at midnight belong to the previous Dutch day',()=>{
  const times=['2026-09-06T21:00:00Z','2026-09-06T22:00:00Z','2026-09-06T23:00:00Z'];
  const d=C.cumulative(pd([30,30,30]),times,null,true);
  assert.equal(C.sample(d,1,52,5),1);
  assert.equal(C.sample(d,2,52,5),.5);
  assert.equal(d.dayStarts[0].day,'2026-09-06');
  assert.equal(d.dayStarts[1].day,'2026-09-07');
  assert.equal(d.dayStarts[0].start,Date.parse('2026-09-06T20:00:00Z'));
});
test('Sun gaps remain unknown within a day and recover at the next day',()=>{
  const d=C.cumulative(pd([30,30,30]),['2026-09-06T15:00:00+02:00','2026-09-06T17:00:00+02:00','2026-09-07T01:00:00+02:00'],null,true);
  assert.equal(C.sample(d,1,52,5),null);
  assert.equal(C.sample(d,2,52,5),.5);
});
test('Sunshine uses a shared partial-day start across models, then resets each day',()=>{
  const a=C.cumulative(pd([60,60,30,30]),[0,1,2,3].map(t),Date.parse(t(1)),true);
  const b=C.cumulative(pd([60,30,30]),[1,2,3].map(t),Date.parse(t(1)),true);
  assert.equal(C.sample(a,1,52,5),0);
  assert.equal(C.sample(a,3,52,5),1);
  assert.equal(C.sample(b,2,52,5),1);
  assert.equal(a.dayStarts[0].start,Date.parse(t(1)));
});
test('Physical scalar bounds are shared by map, labels and point values',()=>{
  assert.equal(C.scalarValue('cape',-10),0);
  assert.equal(C.scalarValue('zon',70),60);
  assert.equal(C.scalarValue('zon',-1),0);
  assert.equal(C.scalarValue('temp',-10),-10);
  assert.ok(Number.isNaN(C.scalarValue('cape',NaN)));
});
