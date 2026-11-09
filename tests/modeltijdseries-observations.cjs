const assert=require('node:assert/strict');
const O=require('../modeltijdseries/ts-observations.js');
const now=Date.parse('2026-11-09T16:00Z');
const feed={stations:{Eindhoven:{naam:'Eindhoven',lat:51.451,lon:5.377,historie:[
 {t:'2026-11-09T15:50Z',ta:8,td:null,ff:2,dd:350,fx:4},
 {t:'2026-11-09T15:40Z',ta:9,td:4,ff:0,dd:0,fx:3},
 {t:'2026-11-09T15:50Z',ta:8.3,td:4,ff:2.3,dd:10,fx:4},
 {t:'2026-11-09T16:00Z',ta:null,td:null,ff:null,dd:null,fx:null},
 {t:'2026-11-10T00:00Z',ta:99}
]}}};
let station=O.select(feed,{lat:51.45,lon:5.377},now);
assert.equal(station.name,'Eindhoven'); assert.ok(station.km<0.2);
assert.equal(station.rows.length,3); assert.equal(station.rows[0].t,now-20*60000);
assert.equal(O.select(feed,{lat:52.1,lon:5.18},now),null);
let series=O.series(station,['t2m','td2m','wspd','gust','wdir','vis','cbh']);
assert.equal(series.length,5); assert.equal(series[0].v[1],8.3);
assert.ok(Number.isNaN(series[0].v[2]));
assert.ok(Number.isNaN(series.find(s=>s.param==='wdir').v[0]));
assert.equal(series.find(s=>s.param==='wspd').v[1],2.3);
assert.ok(series.every(s=>s.color==='#111111' && s.observation && s.maxGap===1200000));
console.log('PASS stationafstand, chronologie, dubbele meettijden, toekomstige metingen, ontbrekende waarden, windstilte en interne windeenheden');
const fs=require('node:fs');
const live=JSON.parse(fs.readFileSync(process.env.TS_OBS_FIXTURE || require('node:path').join(__dirname,'../actueel.json'),'utf8'));
station=O.select(live,{lat:51.45,lon:5.377},Date.now());
assert.equal(station.name,'Eindhoven'); assert.ok(station.rows.length>20);
assert.equal(O.series(station,['t2m','td2m','wdir','wspd','gust']).length,5);
console.log('PASS echte KNMI-feed Eindhoven: '+station.rows.length+' tienminutenmetingen');
