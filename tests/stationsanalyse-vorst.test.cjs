const assert=require('node:assert/strict');
const C=require('../stationsanalyse-vragen-core.js');
const today=C.day('20260101'), opts={field:'TN',op:'between',threshold:-10,upper:-5.1,start:'10-01',end:'04-30',from:2024,to:2024,today};
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
assert.throws(()=>C.analyze(json([['20241010',-60]]),{...opts,upper:-11}));
const a=C.analyzeNetwork([
 {id:'De Bilt',json:json([['20241010',-50],['20241011',-51],['20250301',-100],['20250731',-101]])},
 {id:'Valkenburg',json:json([['20241010',-60],['20241011',-80],['20250301',-55]])}
],[{station:'Historisch dorp',datum:'20241001',parameter:'TN',waarde:-6},{station:'De Bilt',datum:'20241011',parameter:'TN',waarde:-5.1}],opts);
const p=a.periods[0];assert.equal(p.first.time,C.day('20241001'));assert.equal(p.first.observations[0].station,'Historisch dorp');
assert.equal(p.last.time,C.day('20250301'));assert.equal(p.last.observations.length,2);assert.equal(p.hits,4,'Count dates, not station-days');assert.equal(p.complete,false);assert.equal(a.meanFirst,null);assert.equal(a.rank('first').length,1,'National rankings show observed dates, including gaps, without certifying completeness');
const none=C.analyzeNetwork([{id:'A',json:json([['20241001',0]])}],[],opts);assert.equal(none.periods[0].first,null);assert.equal(none.rank('first').length,0);
const future=C.analyzeNetwork([{id:'A',json:json([['20260101',-60]])}],[],{...opts,from:2025,to:2025});assert.equal(future.periods[0].hits,0,'Today excluded');
// A complete single-station period retains definitive records and mean dates.
const rows=[];for(let t=C.day('20240101');t<=C.day('20241231');t+=C.DAY)rows.push([new Date(t).toISOString().slice(0,10).replaceAll('-',''),t===C.day('20240229')?-60:0]);
const single=C.analyze(json(rows),{...opts,from:2024,to:2024,start:'01-01',end:'12-31'});assert.equal(single.completeCount,1);assert.equal(single.meanFirst,'02-29');assert.equal(single.periods[0].hits,1);
console.log('PASS: frost boundaries, historical dates, tied stations, unique national days, missing data, today exclusion, single-station completeness');

const seasonalHits=[['20201205',-60],['20210301',-60],['20211101',-60],['20220115',-60],['20220930',-60],['20221001',-60],['20230430',-60],['20230501',-60],['20231020',-60]];
const hitMap=new Map(seasonalHits),daily=[];
for(let t=C.day('20201001');t<C.day('20231119');t+=C.DAY){const raw=new Date(t).toISOString().slice(0,10).replaceAll('-','');daily.push([raw,hitMap.get(raw)??0]);}
const seasonOptions={...opts,from:2020,to:2023,today:C.day('20231119')};
const seasons=C.analyzeNetwork([{id:'A',json:json(daily)}],[],seasonOptions);
assert.equal(seasons.rank('first')[0].first.time,C.day('20221001'));
assert.equal(seasons.rank('first',true)[0].first.time,C.day('20201205'));
assert.equal(seasons.rank('last')[0].last.time,C.day('20220115'));
assert.equal(seasons.rank('last',true)[0].last.time,C.day('20230430'));
assert.equal(seasons.periods.find(p=>p.year===2022).hits,2,'September and May are outside the winter year');
assert(seasons.rank('last').every(p=>!p.running),'Running winter cannot set a record for earliest last frost');
const met=C.analyze(json([['20231130',-60],['20231201',-60],['20240229',-60],['20240301',-60]]),{...opts,from:2023,to:2023,start:'12-01',end:'02-29',today:C.day('20250101')});
assert.equal(met.periods[0].first.time,C.day('20231201'));assert.equal(met.periods[0].last.time,C.day('20240229'));assert.equal(met.periods[0].hits,2);
console.log('PASS: all-year calendar records, winter year October–April, meteorological winter December–February, running winter excluded from records');

assert.equal(seasons.recordPeriodCount,3);
const gap=C.analyzeNetwork([{id:'A',json:json(daily)},{id:'B',json:json([['20211101',0],['20211103',0]])}],[],seasonOptions);
assert.equal(gap.recordPeriodCount,2,'A gap in one active station cannot be hidden by complete observations elsewhere');
assert.equal(gap.periods.find(p=>p.year===2021).dailyComplete,false);
assert.equal(gap.comparisonPeriodCount,3,'Station gaps remain visible but do not silently remove national observed dates');
assert(gap.rank('first').some(p=>p.year===2021));
