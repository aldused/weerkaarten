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

test('a custom period starting 29 February correctly anchors the clamped 28 February in ordinary years',()=>{
 const j=series('2021-02-28','2021-02-28',{},'TN',-1),a=analyze(j,{from:2021,to:2021,start:'02-29',end:'02-29'});
 assert.equal(a.completeCount,1);assert.equal(a.meanFirst,'02-28');assert.equal(a.rank('first')[0].first.position,-1);
});

test('Castricum 9 May 1944 remains visible as historical moderate frost in the full frost season',()=>{
 const H=require('../stationsanalyse-records.js');
 const historic=H.historicalRecords({waarnemingen:[{datum:'1944-05-09',station:'Castricum',parameter:'TN',waarde:-5.4}]});
 const daily=series('1943-08-01','1944-07-31',{'1943-09-27':-60,'1944-03-06':-60});
 const options={field:'TN',op:'between',threshold:-10,upper:-5.1,from:1943,to:1943,today,start:'08-01',end:'07-31'};
 const full=C.analyzeNetwork([{id:'De Bilt',json:daily}],historic,options),last=full.periods[0].last;
 assert.equal(iso(full.periods[0].first.time),'1943-09-27','September frost is included');
 assert.equal(iso(last.time),'1944-05-09');assert.equal(last.observations[0].station,'Castricum');assert.equal(last.observations[0].value,-5.4);assert.equal(last.observations[0].historical,true);
 assert.equal(iso(full.rank('last',true)[0].last.time),'1944-05-09');
 const winter=C.analyzeNetwork([{id:'De Bilt',json:daily}],historic,{...options,start:'10-01',end:'04-30'});
 assert.equal(iso(winter.periods[0].last.time),'1944-03-06','October–April remains an explicit narrower selection');
});

test('the August–July frost season includes September and both boundary days',()=>{
 const j=series('2023-07-31','2024-08-01',{'2023-07-31':-60,'2023-08-01':-60,'2023-09-27':-60,'2024-07-31':-60,'2024-08-01':-60});
 const a=analyze(j,{field:'TN',op:'between',threshold:-10,upper:-5.1,from:2023,to:2023,start:'08-01',end:'07-31'});
 assert.equal(a.periods[0].expected,366);assert.equal(a.periods[0].hits,3);
 assert.equal(iso(a.periods[0].first.time),'2023-08-01');assert.equal(iso(a.periods[0].last.time),'2024-07-31');
});

test('full historical daily feed includes Winterswijk 3 December 1903 in national moderate frost',()=>{
 const feed=require('../historische-dagwaarden.json'),sources=C.historicalSources(feed);
 assert.deepEqual(sources.map(s=>s.id).sort(),['Epen','Oost-Maarland','Winterswijk']);
 const modern=series('1903-08-01','1904-07-31',{'1903-12-06':-60});
 const result=C.analyzeNetwork([{id:'De Bilt',json:modern},...sources],[],{field:'TN',op:'between',threshold:-10,upper:-5.1,start:'08-01',end:'07-31',from:1903,to:1903,today});
 const first=result.periods[0].first;
 assert.equal(iso(first.time),'1903-12-03');assert.equal(first.observations[0].station,'Winterswijk');assert.equal(first.observations[0].value,-5.6);assert.equal(first.observations[0].historical,true);
 assert.equal(feed.days['19031203']['20'].TN,first.observations[0].value,'The map and analysis share the same physical observation');
});

test('historical physical units, daily-series coverage and sparse curated measurements stay distinct',()=>{
 const feed={units:'physical',stations:{a:{naam:'Volledige historie',dailySeries:true},b:{naam:'Los historisch record',dailySeries:false}},days:{'20240101':{a:{TN:-5.6,TX:1.3,TG:null},b:{TN:-20}}}};
 const sources=C.historicalSources(feed);assert.equal(sources.length,1);assert.equal(sources[0].id,'Volledige historie');
 assert.equal(sources[0].json.data[0][sources[0].json.kolommen.indexOf('TN')],-56);assert(!sources[0].json.kolommen.includes('TG'));
 const options={field:'TN',op:'between',threshold:-10,upper:-5.1,start:'01-01',end:'01-01',from:2024,to:2024,today};
 const result=C.analyzeNetwork(sources,[],options);assert.equal(result.periods[0].dailyComplete,true);assert.equal(result.periods[0].first.value,-5.6);
 const precedence=C.analyzeNetwork([{id:'Volledige historie',json:{kolommen:['YYYYMMDD','TN'],data:[['20240101',-70]]}},...sources],[],options);
 assert.equal(precedence.periods[0].first.value,-7,'KNMI daily value precedes the supplemental historical value for the same station/day');
 assert.throws(()=>C.historicalSources({...feed,units:'KNMI-tenths'}));
});

test('the partial opening winter stays visible but cannot set a national date record',()=>{
 const sources=C.historicalSources(require('../historische-dagwaarden.json'));
 sources.push({id:'Modern basisstation',json:series('2000-08-01','2001-07-31',{'2000-12-16':-14})});
 const olderRecord={datum:'1893-08-01',station:'Losse historische meting',parameter:'TN',waarde:1};
 const a=C.analyzeNetwork(sources,[olderRecord],{field:'TN',op:'lt',threshold:0,start:'08-01',end:'07-31',from:1893,to:2000,today});
 const opening=a.periods[0];
 assert.equal(opening.label,'1893/1894');
 assert.equal(opening.startsBeforeDailySeries,true);
 assert.equal(iso(opening.first.time),'1894-01-01');
 assert.equal(opening.first.value,-1.6);
 assert.equal(a.periods[1].startsBeforeDailySeries,false);
 for(const side of ['first','last'])for(const descending of [false,true]){
  assert(a.rank(side,descending,200).every(p=>p.year!==1893));
 }
 assert.equal(iso(a.rank('first',true,1)[0].first.time),'2000-12-16');
});

test('ground frost uses only available daily minima at 10 cm and excludes exact zero',()=>{
 const daily=series('2024-08-01','2025-07-31',{'2024-09-20':-4,'2025-05-05':-2,'2025-06-01':null},'T10N',0);
 const other=series('2024-08-01','2025-07-31',{'2024-09-01':-15,'2025-06-12':-12},'TN',0);
 const historic=[{datum:'2024-08-01',station:'Los record',parameter:'TN',waarde:-16}];
 const a=C.analyzeNetwork([{id:'Grasstation',json:daily},{id:'Luchtstation',json:other}],historic,
  {field:'T10N',op:'lt',threshold:0,start:'08-01',end:'07-31',from:2024,to:2024,today});
 const p=a.periods[0];
 assert.equal(p.hits,2);
 assert.equal(iso(p.first.time),'2024-09-20');
 assert.equal(iso(p.last.time),'2025-05-05');
 assert.equal(p.first.observations[0].station,'Grasstation');
 assert.equal(p.first.value,-0.4);
 assert.equal(p.missing,1);
});

test('the supplied Epen minimum fills the December 1987 gap with provenance',()=>{
 const H=require('../stationsanalyse-records.js');
 const sources=C.historicalSources(require('../historische-dagwaarden.json'));
 const records=H.historicalRecords(require('../historische-grenswaarnemingen.json'));
 const options={field:'TN',op:'lt',threshold:-10,start:'08-01',end:'07-31',from:1987,to:1987,today};
 const result=C.analyzeNetwork(sources,records,options);
 const first=result.periods[0].first;
 assert.equal(iso(first.time),'1987-12-09');
 assert.equal(first.observations[0].station,'Epen');
 assert.equal(first.observations[0].value,-11.6);
 assert.equal(first.observations[0].source,'aangeleverde waarneming');
 assert.equal(result.periods[0].dailyComplete,false);
});

test('every historical frost-class boundary agrees with the full day-map feed across all years',()=>{
 const feed=require('../historische-dagwaarden.json'),sources=C.historicalSources(feed);
 const ids=new Set(Object.entries(feed.stations).filter(([,s])=>s.dailySeries).map(([id])=>id));
 for(const [threshold,upper]of [[-5,-.1],[-10,-5.1],[-15,-10.1],[-100,-15.1]]){
  const result=C.analyzeNetwork(sources,[],{field:'TN',op:'between',threshold,upper,start:'08-01',end:'07-31',from:1893,to:2020,today});
  const matching=new Map();
  for(const [date,stations]of Object.entries(feed.days)){
   const hit=Object.entries(stations).some(([id,row])=>ids.has(id)&&typeof row.TN==='number'&&row.TN>=threshold&&row.TN<=upper);
   if(!hit)continue;const d=C.day(date),year=Number(date.slice(0,4))-(date.slice(4,6)<'08');
   const dates=matching.get(year)||[];dates.push(d);matching.set(year,dates);
  }
  for(const period of result.periods){const dates=matching.get(period.year)||[];assert.equal(period.first?.time??null,dates.length?Math.min(...dates):null);assert.equal(period.last?.time??null,dates.length?Math.max(...dates):null);}
 }
});


test('latest observed first moderate frost includes February 1975 and 1983 despite station gaps',()=>{
 const rows=[];
 for(const [start,end,first]of [['1974-08-01','1975-07-31','1975-02-09'],['1982-08-01','1983-07-31','1983-02-09'],['2019-08-01','2020-07-31','2020-01-21']])rows.push(...series(start,end,{[first]:-55}).data);
 const sources=[{id:'Leeuwarden',json:{kolommen:['YYYYMMDD','TN'],data:rows}},{id:'Hoek van Holland',json:series('1974-08-22','1974-08-24',{'1974-08-23':null})}];
 const a=C.analyzeNetwork(sources,[],{field:'TN',op:'between',threshold:-10,upper:-5.1,start:'08-01',end:'07-31',from:1974,to:2019,today});
 const ranking=a.rank('first',true,1);
 assert.deepEqual(ranking.map(p=>p.year),[1974,1982]);assert(ranking.every(p=>p.rank===1));
 assert.equal(a.periods.find(p=>p.year===1974).dailyComplete,false);
 assert.equal(iso(ranking[0].first.time),'1975-02-09');
 assert(a.rank('first',true).findIndex(p=>p.year===2019)>1);
 assert(a.periods.every(p=>!p.complete),'Observed comparisons do not certify a complete national series');
 assert.equal(a.meanFirst,null);
});
