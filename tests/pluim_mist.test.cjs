const assert=require('node:assert/strict'),f=require('../pluim_mist.js');
const now=Date.UTC(2026,8,29,8),feed={run:'2026-09-29T03:00:00Z',data:{'De Bilt':{tijden_utc:['2026-09-29T09:00:00Z','2026-09-29T10:00:00Z','2026-09-29T11:00:00Z','2026-09-29T12:00:00Z','2026-09-29T13:00:00Z'],wwM:[0,63,null,-1,101]}}};
const rows=f.points(feed,'De Bilt',now,now+86400000,now);assert.deepEqual(rows.map(p=>p.probability),[0,63,null,null,null]);assert.equal(f.dailyMax(rows)[0].value,63);
assert.throws(()=>f.points({...feed,run:'2026-09-26T03:00:00Z'},'De Bilt',now,now+86400000,now),/te oud/);
assert.throws(()=>f.points({...feed,runs:{'De Bilt':'2026-09-26T03:00:00Z'}},'De Bilt',now,now+86400000,now),/te oud/);
assert.throws(()=>f.points(feed,'Ontbreekt',now,now+86400000,now),/ontbreken/);
assert.deepEqual(f.points(feed,'De Bilt',now+3600000,now+7200000,now).map(p=>p.probability),[63]);
assert.equal(f.dailyMax([{time:Date.UTC(2026,8,29,22),probability:50}])[0].key,'2026-09-29'); // hour ending at midnight belongs to preceding day
const dst={run:'2026-10-25T00:00:00Z',data:{X:{tijden_utc:['2026-10-25T00:00:00Z','2026-10-25T01:00:00Z'],wwM:[20,40]}}};assert.equal(f.points(dst,'X',Date.UTC(2026,9,24,23),Date.UTC(2026,9,25,2),Date.UTC(2026,9,25,2)).length,2);
const svg=f.render(rows,'<Bilt>',feed.run,now,now+86400000);assert(svg.includes('&lt;Bilt&gt;'));assert(!svg.includes('NaN'));assert.equal((svg.match(/data-fog-bar=/g)||[]).length,1);assert.equal((svg.match(/data-fog-zero=/g)||[]).length,1);assert(svg.includes('niet de kans'));assert(!svg.includes('GFS'));
console.log('PASS direct DWD percentages, missing/invalid values, stale station runs, UTC/DST, hourly windows, daily maximum and SVG');
