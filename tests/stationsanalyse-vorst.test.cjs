const assert=require('node:assert/strict');
const C=require('../stationsanalyse-vragen-core.js');
const today=C.day('20260101'), opts={field:'TN',op:'between',threshold:-10,upper:-5.1,start:'08-01',end:'07-31',from:2024,to:2024,today};
const json=data=>({kolommen:['YYYYMMDD','TN'],data});
for(const [lower,upper,inside,outside] of [[-5,-.1,[-50,-1],[-51,0]],[-10,-5.1,[-100,-51],[-101,-50]],[-15,-10.1,[-150,-101],[-151,-100]]]){
 for(const raw of inside)assert.equal(C.match(C.decode(raw,C.variables.TN),'between',lower,upper),true);
 for(const raw of outside)assert.equal(C.match(C.decode(raw,C.variables.TN),'between',lower,upper),false);
}
assert.equal(C.match(C.decode(-150,C.variables.TN),'le',-15.1),false);
assert.equal(C.match(C.decode(-151,C.variables.TN),'le',-15.1),true);
assert.equal(C.match(C.decode(-250,C.variables.TN),'le',-15.1),true);
assert.equal(C.decode(null,C.variables.TN),null);
assert.equal(C.decode(-9999,C.variables.TN),null);
assert.throws(()=>C.analyze(json([['20241001',-60]]),{...opts,upper:-11}));
const a=C.analyzeNetwork([
 {id:'De Bilt',json:json([['20241001',-50],['20241002',-51],['20250301',-100],['20250731',-101]])},
 {id:'Valkenburg',json:json([['20241001',-60],['20241002',-80],['20250301',-55]])}
],[{station:'Historisch dorp',datum:'20240901',parameter:'TN',waarde:-6},{station:'De Bilt',datum:'20241002',parameter:'TN',waarde:-5.1}],opts);
const p=a.periods[0];assert.equal(p.first.time,C.day('20240901'));assert.equal(p.first.observations[0].station,'Historisch dorp');
assert.equal(p.last.time,C.day('20250301'));assert.equal(p.last.observations.length,2);assert.equal(p.hits,4,'Count dates, not station-days');assert.equal(p.complete,false);assert.equal(a.meanFirst,null);assert.equal(a.rank('first')[0].year,2024);
const none=C.analyzeNetwork([{id:'A',json:json([['20241001',0]])}],[],opts);assert.equal(none.periods[0].first,null);assert.equal(none.rank('first').length,0);
const future=C.analyzeNetwork([{id:'A',json:json([['20260101',-60]])}],[],{...opts,from:2025,to:2025});assert.equal(future.periods[0].hits,0,'Today excluded');
// A complete single-station period retains definitive records and mean dates.
const rows=[];for(let t=C.day('20240101');t<=C.day('20241231');t+=C.DAY)rows.push([new Date(t).toISOString().slice(0,10).replaceAll('-',''),t===C.day('20240229')?-60:0]);
const single=C.analyze(json(rows),{...opts,from:2024,to:2024,start:'01-01',end:'12-31'});assert.equal(single.completeCount,1);assert.equal(single.meanFirst,'02-29');assert.equal(single.periods[0].hits,1);
console.log('PASS: frost boundaries, historical dates, tied stations, unique national days, missing data, today exclusion, single-station completeness');
