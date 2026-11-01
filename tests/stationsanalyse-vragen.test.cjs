const {test}=require('node:test'),assert=require('node:assert/strict'),C=require('../stationsanalyse-vragen-core.js');
const iso=t=>new Date(t).toISOString().slice(0,10),today=C.day('2026-11-01');
function series(start,end,values={},field='TN',fallback=10){const rows=[];for(let t=C.day(start);t<=C.day(end);t+=C.DAY){const key=iso(t);rows.push([key.replaceAll('-',''),Object.hasOwn(values,key)?values[key]:fallback]);}return {kolommen:['YYYYMMDD',field],data:rows};}
function analyze(j,o={}){return C.analyze(j,{field:'TN',op:'lt',threshold:0,start:'09-01',end:'02-29',from:2020,to:2021,today,...o});}
test('cross-year season finds a January first hit and never January before summer',()=>{
 const j=series('2020-01-01','2022-03-01',{'2020-01-02':-50,'2021-01-03':-4,'2021-12-22':-8});const a=analyze(j);
 assert.equal(a.periods[0].label,'2020/2021');assert.equal(iso(a.periods[0].first.time),'2021-01-03');assert.equal(a.completeCount,2);assert.equal(iso(a.rank('first',true)[0].first.time),'2021-01-03');
});
test('no crossing differs from missing values and absent whole periods; gap breaks observed streak',()=>{
 const j=series('2020-09-01','2022-02-28',{'2020-10-01':-3,'2020-10-02':null,'2020-10-03':-3});const a=analyze(j);
 assert.equal(a.periods[0].complete,false);assert.equal(a.periods[0].longest,1);assert.equal(a.periods[0].hits,2);assert.equal(a.periods[1].hits,0);assert.equal(a.periods[1].complete,true);assert.equal(a.noEvent,1);assert.equal(a.meanFirst,null);
 j.data=j.data.filter(r=>r[0]<'20210901');const b=analyze(j);assert.equal(b.periods[1].status,'geen gegevens');assert.equal(b.noEvent,0);
});
test('running and partial-today measurements never become final records',()=>{
 const j=series('2025-09-01','2026-11-01',{'2025-11-05':-3,'2026-10-01':-20,'2026-11-01':-40});const a=analyze(j,{from:2025,to:2026});
 assert.equal(a.periods[1].status,'lopend');assert.equal(a.periods[1].hits,1);assert.equal(a.rank('first').length,1);assert.equal(a.rank('first')[0].label,'2025/2026');
});
test('leap years use a common calendar axis; actual expected coverage has 365/366 days',()=>{
 assert.equal(C.position(C.day('2020-03-01'),'01-01'),C.position(C.day('2021-03-01'),'01-01'));
 assert.equal(C.position(C.day('2020-03-01'),'09-01'),C.position(C.day('2021-03-01'),'09-01'));
 const j=series('2019-01-01','2020-12-31',{'2019-03-01':-1,'2020-03-01':-1});const a=analyze(j,{from:2019,to:2020,start:'01-01',end:'12-31'});assert.equal(a.meanFirst,'03-01');assert.deepEqual(a.periods.map(p=>p.expected),[365,366]);
 assert.equal(C.meanDate((C.position(C.day('2020-12-31'),'09-01')+C.position(C.day('2021-01-01'),'09-01'))/2,'09-01'),'01-01');
});
test('all ties at rank ten survive, including shared record places',()=>{
 const j=series('2000-01-01','2012-12-31',Object.fromEntries(Array.from({length:13},(_,i)=>[`${2000+i}-10-01`,-3])));const a=analyze(j,{from:2000,to:2012,start:'01-01',end:'12-31'});assert.equal(a.rank('first').length,13);assert(a.rank('first').every(p=>p.rank===1));
});
test('four date rankings are independent; a late last date is not a late first date',()=>{
 const j=series('2020-01-01','2021-12-31',{'2020-02-01':-1,'2020-12-31':-1,'2021-03-01':-1,'2021-04-01':-1});const a=analyze(j,{start:'01-01',end:'12-31'});assert.equal(a.rank('first',true)[0].year,2021);assert.equal(a.rank('last',true)[0].year,2020);assert.equal(a.rank('last')[0].year,2021);
});
test('all variables and comparison directions; wind conversion has no threshold rounding',()=>{
 for(const [field,raw,threshold]of [['TX',200,20],['TN',-1,-.1],['RH',100,10],['SQ',100,10],['FXX',250,90]]){
  const j=series('2020-01-01','2020-01-01',{},field,raw);
  for(const [op,hits]of [['lt',0],['le',1],['gt',0],['ge',1],['eq',1]])assert.equal(C.analyze(j,{field,threshold,op,start:'01-01',end:'01-01',from:2020,to:2020,today}).periods[0].hits,hits,field+op);
 }
 const j=series('2020-01-01','2020-01-01',{},'FXX',249);assert.equal(C.analyze(j,{field:'FXX',threshold:90,op:'ge',start:'01-01',end:'01-01',from:2020,to:2020,today}).periods[0].hits,0);
});
test('trace rain/sun is an interval, never negative or falsely exactly zero',()=>{
 for(const field of ['RH','SQ']){const j=series('2020-01-01','2020-01-01',{},field,-1),o={field,start:'01-01',end:'01-01',from:2020,to:2020,today};assert.equal(C.analyze(j,{...o,op:'lt',threshold:.1}).periods[0].hits,1);assert.equal(C.analyze(j,{...o,op:'ge',threshold:.1}).noEvent,1);assert.equal(C.analyze(j,{...o,op:'ge',threshold:.01}).periods[0].uncertain,1);assert.equal(C.analyze(j,{...o,op:'eq',threshold:0}).completeCount,0);}
});
test('missing rows, null, blank and leap boundaries are checked explicitly',()=>{
 assert.throws(()=>analyze(series('2020-01-01','2021-01-01'),{start:'02-30'}));assert.equal(iso(C.boundary(2021,'02-29')),'2021-02-28');
 const j=series('2020-09-01','2021-02-28',{'2020-09-01':'','2020-09-02':null});j.data=j.data.filter(r=>r[0]!=='20200903');const a=analyze(j,{to:2020});assert.equal(a.periods[0].missing,3);assert.equal(a.completeCount,0);
});

test('published Rotterdam Airport observations reproduce the four supplied first-frost dates',()=>{
 const j=require('./fixtures/rotterdam-first-frost.json'),a=analyze(j,{from:1970,to:2021});
 const expected={1970:['1970-12-22',-.4],1971:['1971-10-06',-.4],2006:['2006-12-19',-1.1],2021:['2021-12-20',-1.1]};
 for(const [year,[date,value]]of Object.entries(expected)){const p=a.periods.find(p=>p.year===Number(year));assert(p.complete);assert.equal(iso(p.first.time),date);assert.equal(p.first.value,value);}
 assert.equal(a.completeCount,4);assert.equal(iso(a.rank('first')[0].first.time),'1971-10-06');assert.equal(iso(a.rank('first',true)[0].first.time),'1970-12-22');
});

test('ties at the tenth place and multiple equally long runs within a year remain visible',()=>{
 const values={};for(let i=0;i<14;i++)values[`${2000+i}-01-${String(Math.min(i+1,10)+(i===13?1:0)).padStart(2,'0')}`]=-1;
 let a=analyze(series('2000-01-01','2013-12-31',values),{from:2000,to:2013,start:'01-01',end:'12-31'});
 assert.equal(a.rank('first').length,13);assert.equal(a.rank('first').filter(p=>p.rank===10).length,4);
 a=analyze(series('2020-01-01','2020-12-31',{'2020-01-01':-1,'2020-01-02':-1,'2020-03-01':-1,'2020-03-02':-1}),{from:2020,to:2020,start:'01-01',end:'12-31'});
 assert.equal(a.periods[0].longestRuns.length,2);assert.equal(a.periods[0].longest,2);
});
