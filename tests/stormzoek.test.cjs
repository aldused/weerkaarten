const assert=require('node:assert/strict');
const C=require('../stormzoek-core.js');
const stations=[{station:225,name:'IJmuiden'},{station:310,name:'Vlissingen'}];
const events=C.flatten({years:[{year:2020,events:[
 {date:'2020-12-25',measurements:[[225,208],[310,250]],observations:[[225,208,300,12],[310,250,null,24]]},
 {date:'2020-12-26',measurements:[[225,245]],observations:[[225,245,400,14],[310,100,200,12]]},
 {date:'2020-09-10',measurements:[[310,244]],observations:[[310,244,350,10]]}
]}]});
assert.equal(C.bft(207),8);assert.equal(C.bft(208),9);assert.equal(C.bft(244),9);assert.equal(C.bft(245),10);assert.equal(C.bft(327),12);
assert.equal(C.filter(events,{stations:['225','310'],match:'all'},stations).length,1);
assert.equal(C.filter(events,{stations:['225','310'],match:'all',min:245},stations).length,0);
assert.equal(C.filter(events,{stations:['310'],min:245},stations).length,1);
assert.equal(C.filter(events,{stations:['310'],min:208,max:244},stations).length,1);
assert.equal(C.filter(events,{q:'ijmuiden 25-12',month:12,day:25,season:'winter'},stations).length,1);
assert.equal(C.filter(events,{from:'2020-12-26',to:'2020-12-26'},stations).length,1);
assert.equal(C.filter(events,{breadth:2},stations).length,1);
assert.equal(C.filter(events,{gust:400},stations).length,1);
assert.equal(C.filter(events,{season:'zomer'},stations).length,0);
assert.deepEqual(C.runs(events).map(g=>g.length),[1,2]);
assert.equal(C.sort(events,'peak')[0].date,'2020-12-25');
assert.equal(C.sort(events,'gust')[0].date,'2020-12-26');
const fs=require('node:fs');const data=JSON.parse(fs.readFileSync(__dirname+'/../stormdagen_data.json','utf8'));const all=C.flatten(data);
assert.equal(C.filter(all,{from:'2025-01-01',to:'2025-12-31'},data.stations).length,6);
assert.equal(C.filter(all,{from:'2025-01-01',to:'2025-12-31',season:'herfst'},data.stations).length,4);
assert.equal(C.filter(all,{from:'2025-01-01',to:'2025-12-31',min:245},data.stations).length,0);
assert.equal(C.sort(all,'oldest')[0].date,'1904-12-30');
for(const event of all){assert.equal(new Set(event.observations.map(m=>m[0])).size,event.observations.length);for(const [st,v] of event.measurements)assert.equal(event.observations.find(m=>m[0]===st)[1],v);}
console.log('Zoekfilters, grenswaarden, combinaties, sortering en bronconsistentie geslaagd. '+all.length+' stormdagen.');
