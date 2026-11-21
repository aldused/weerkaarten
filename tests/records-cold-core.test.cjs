const test=require('node:test'),assert=require('node:assert/strict'),C=require('../records-cold-core.js');
function source(id,rows){const maanddetail={};for(const [date,tn,tx=1]of rows){const [year,month,day]=date.split('-').map(Number);((maanddetail[year]||={})[month]||={dagen:[]}).dagen.push({dag:day,tn,tx});}return {station:'Station '+id,station_nr:id,maanddetail};}
const options={today:'2026-11-21'};
test('moderate and severe cold thresholds include colder frost, with exact strict boundaries',()=>{
 const s=source('A',[-5,-5.1,-10,-10.1,-15,-15.1,-20,-25].map((tn,i)=>['1963-02-'+String(i+1).padStart(2,'0'),tn]));
 const c=C.compute([s],options);assert.deepEqual(c.perYear[1962],[8,0,1,7,5,3,2]);
});
test('winter year is August through July; calendar-year counts remain separately available',()=>{
 const s=source('A',[['1962-07-31',-6],['1962-08-01',-6],['1962-09-01',-6],['1963-01-01',-6],['1963-07-31',-6],['1963-08-01',-6]]);
 const winter=C.compute([s],options),calendar=C.compute([s],{...options,mode:'calendar'});
 assert.equal(winter.perYear[1962][3],4);assert.equal(C.label(1962),'1962/1963');
 assert.equal(calendar.perYear[1962][3],3);assert.equal(calendar.perYear[1963][3],3);
});
test('national counts merge dates while station records count one location at a time',()=>{
 const a=source('A',[['1963-01-01',-7],['1963-01-02',0]]),b=source('B',[['1963-01-01',-8],['1963-01-02',-8]]);
 assert.equal(C.compute([a,b],options).perYear[1962][3],2);
 const ranking=C.stationRecords([a,b],3,options);assert.equal(ranking[0].station,'Station B');assert.equal(ranking[0].count,2);assert.equal(ranking[1].count,1);
});
test('missing values are unknown, duplicate dates count once, and today/future days do not count',()=>{
 const s=source('A',[['1963-01-01',-7],['1963-01-01',-7],['1963-01-02',null],['1963-01-03',-9999],['2026-11-20',-6],['2026-11-21',-6],['2026-12-01',-6]]);
 const c=C.compute([s],options);assert.equal(c.perYear[1962][3],1);assert.equal(c.coverage[1962].valid[3],1);
 assert.equal(c.perYear[2026][3],1);assert.equal(c.coverage[2026].running,true);assert(C.rankYears(c,3).every(r=>r.year!==2026));
});
test('all tied station-record periods survive',()=>{
 const s=source('A',[['1963-01-01',-6],['1964-01-01',-6]]);const r=C.stationRecords([s],3,options)[0];assert.equal(r.count,1);assert.deepEqual(r.ties.map(r=>r.label),['1962/1963','1963/1964']);
});
test('published 1962/63 daily observations reproduce De Bilt 59, calendar 1963 56, Twenthe 72 and Eelde 70',()=>{
 const fs=require('node:fs'),zlib=require('node:zlib'),path=require('node:path');
 const data=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname,'fixtures/cold-day-records-1962-1963.json.gz'))));
 const winter=C.compute([data['260']],options),calendar=C.compute([data['260']],{...options,mode:'calendar'});
 assert.equal(winter.perYear[1962][3],59);assert.equal(winter.coverage[1962].valid[3],365);assert.equal(calendar.perYear[1963][3],56);
 const ranking=C.stationRecords(Object.values(data),3,options);assert.equal(ranking[0].station,'Twenthe');assert.equal(ranking[0].count,72);assert.equal(ranking[0].label,'1962/1963');assert.equal(ranking[1].station,'Eelde');assert.equal(ranking[1].count,70);
});
