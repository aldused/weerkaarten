const {test}=require('node:test'),assert=require('node:assert/strict');
const core=require('../vierluik-core.js');
test('Wind direction names the origin, not the destination',()=>{
 for(const [u,v,label,degrees] of [[0,-5,'N',0],[-5,-5,'NO',45],[-5,0,'O',90],[-5,5,'ZO',135],[0,5,'Z',180],[5,5,'ZW',225],[5,0,'W',270],[5,-5,'NW',315]]) {
  const d=core.windDirection(u,v);assert.equal(d.label,label);assert.equal(d.degrees,degrees);
 }
});
test('Calm and missing wind do not acquire a direction',()=>{
 for(const [u,v] of [[0,0],[.1,.1],[NaN,1],[1,NaN],[null,1],[Infinity,0]])assert.equal(core.windDirection(u,v),null);
 assert.equal(core.windDirection(0,-.3).label,'N');
});
test('North wraps correctly and opposing vectors cancel before direction is calculated',()=>{
 assert.equal(core.windDirection(.01,-5).label,'N');assert.equal(core.windDirection(-.01,-5).label,'N');
 const u=core.bilinear(-1,1,-1,1,.5,.5),v=core.bilinear(0,0,0,0,.5,.5);
 assert.equal(core.windDirection(u,v),null);
});
