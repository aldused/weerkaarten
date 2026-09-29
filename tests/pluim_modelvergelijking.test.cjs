const assert=require('node:assert/strict'),p=require('../pluim_modelvergelijking.js');
const start=Date.UTC(2026,8,28),hourly={time:['2026-09-28T00:00','2026-09-28T03:00']};
for(const field of ['cloud_cover_high','cloud_cover_mid','cloud_cover_low']){hourly[field]=[0,100];hourly[field+'_member01']=[20,null];assert.deepEqual(p.limits([],field),[0,100]);}
const s=p.render(['ECMWF','GFS','ICON'].map(name=>({name,data:{hourly},runLabel:'28-09 00 UTC'})),'wolken','De Bilt',start,7);
assert.equal((s.match(/clipPath id=/g)||[]).length,9);assert(s.includes('viewBox="0 0 2340 1080"'));assert(!s.includes('NaN'));for(const f of ['Hoge bewolking','Middelbare bewolking','Lage bewolking'])assert.equal(s.split(f).length-1,3);
console.log('PASS 9-panel layout, all cloud axes 0–100%, zero vs missing values');
