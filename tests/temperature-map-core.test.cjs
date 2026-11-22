const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../temperature-map-core.js');
test('missing values stay missing, valid zeroes and probabilities are preserved',()=>{
  assert.ok(Number.isNaN(M.decode16(-32768)));
  assert.ok(Number.isNaN(M.decode16(undefined)));
  assert.equal(M.decode16(0),0);
  assert.equal(M.percent(255),'–');assert.equal(M.percent(NaN),'–');
  assert.equal(M.percent(0),'0%');assert.equal(M.percent(100),'100%');
});
test('bilinear interpolation preserves a linear field and cell corners',()=>{
  assert.ok(Math.abs(M.interpolate(0,10,20,30,.2,.3)-8)<1e-12);
  assert.equal(M.interpolate(0,10,20,30,0,0),0);
  assert.equal(M.interpolate(0,10,20,30,1,1),30);
});
test('missing cells remain holes and finite neighbours retain their actual weights',()=>{
  assert.ok(Number.isNaN(M.interpolate(NaN,10,20,30,.1,.1)));
  assert.ok(Math.abs(M.interpolate(NaN,10,20,30,.8,.2)-12/.84)<1e-10);
});
test('contours of a linear plane have the analytical crossing positions',()=>{
  assert.deepEqual(M.contourSegments([-1,1,1,-1],0),[[[.5,0],[.5,1]]]);
  assert.deepEqual(M.contourSegments([NaN,1,1,-1],0),[]);
  assert.equal(M.contourPath(new Float32Array([-1,1,-1,1]),2,2,0,(y,x)=>[x,y]),'M0.5,0.0L0.5,1.0');
});
test('saddle topology changes with the bilinear asymptotic decider',()=>{
  const positive=M.contourSegments([2,-1,2,-1],0), negative=M.contourSegments([1,-2,1,-2],0);
  assert.equal(positive[0][0][1],0); assert.equal(positive[0][1][0],1);
  assert.equal(negative[0][0][1],0); assert.equal(negative[0][1][0],0);
});
test('area averages exclude missing data and weight the latitude-dependent cell area',()=>{
  const s=M.summary([0,1,2],c=>[0,10,NaN][c],c=>[0,60,0][c]);
  assert.ok(Math.abs(s.mean-10/3)<1e-10);
  assert.equal(s.minCell,0);assert.equal(s.maxCell,1);assert.equal(s.valid,2);
  assert.ok(Math.abs(s.coverage-200/3)<1e-10);
  assert.ok(Number.isNaN(M.summary([],()=>0,()=>0).mean));
});
