const assert=require('node:assert/strict'),p=require('../pluim_modelvergelijking.js');
const start=Date.UTC(2026,8,28),hourly={time:['2026-09-28T00:00','2026-09-28T03:00']};
for(const field of ['cloud_cover','cloud_cover_high','cloud_cover_mid','cloud_cover_low']){hourly[field]=[0,100];hourly[field+'_member01']=[20,null];assert.deepEqual(p.limits([],field),[0,100]);}
const s=p.render(['ECMWF','GFS','ICON'].map(name=>({name,data:{hourly},runLabel:'28-09 00 UTC'})),'wolken','De Bilt',start,7);
assert.equal((s.match(/clipPath id=/g)||[]).length,6);assert(s.includes('viewBox="0 0 1580 1080"'));assert(!s.includes('NaN'));for(const f of ['Hoge bewolking','Middelbare bewolking','Lage bewolking'])assert.equal(s.split(f+' (%)').length-1,1);
console.log('PASS 6-panel cloud layout, all cloud axes 0–100%, zero vs missing values');

assert.equal(s.split("Totale bewolking (%)").length-1,3);
const aifsData={hourly:{time:Array.from({length:29},(_,i)=>new Date(Date.UTC(2026,9,4)+i*6*3600000).toISOString()),temperature_2m:Array(29).fill(10),temperature_2m_member01:Array(29).fill(12),precipitation:Array(29).fill(0),precipitation_member01:Array(29).fill(2),wind_speed_10m:Array(29).fill(15),wind_speed_10m_member01:Array(29).fill(25)}};
const comparison=p.render([{name:'ECMWF',data:aifsData},{name:'ECMWF AIFS',data:aifsData}],'aifs','De Bilt',Date.UTC(2026,9,4),7);
assert.equal((comparison.match(/clipPath id=/g)||[]).length,6);
assert(!comparison.includes('NaN'));
for(const label of ['Temperatuur (°C)','Neerslag (mm / 6 uur)','Wind (Bft)'])assert.equal(comparison.split(label).length-1,2);
assert(comparison.includes('translate(38,130)'));assert(comparison.includes('translate(798,130)'));
const missing=p.render([{name:'ECMWF',data:aifsData},{name:'ECMWF AIFS',error:'Bron tijdelijk niet bereikbaar'}],'aifs','De Bilt',Date.UTC(2026,9,4),7);
assert.equal(missing.split('Bron tijdelijk niet bereikbaar').length-1,3);assert(!missing.includes('NaN'));
console.log('PASS AIFS side-by-side temperature, precipitation, wind and partial failure');
