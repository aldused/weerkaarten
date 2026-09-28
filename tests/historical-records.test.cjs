const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'), dataRoot=process.env.RECORDS_DATA_ROOT || root;
const core=require('../record-stations.js');
const registry=JSON.parse(fs.readFileSync(path.join(root,'record-stations.json')));
const fixtures=process.argv.includes('--fixture') ? JSON.parse(require('node:zlib').gunzipSync(fs.readFileSync(path.join(root,'tests/fixtures/historical-daily.json.gz')))) : null;
if (!fixtures) for (const name of fs.readdirSync(dataRoot)) {
 const match=/^records_(\d+)\.json$/.exec(name);
 if(match) assert(registry.sources.includes(match[1]),`Bron ontbreekt in stationsregister: ${name}`);
}
const sources=[]; const sourceSlots={}; let observations=0;
for (const id of [...registry.sources,'nl_extreme']) {
 const file=fixtures ? fixtures[id] : JSON.parse(fs.readFileSync(path.join(dataRoot,`records_${id}.json`)));
 core.validate(file,registry);
 if(id!=='nl_extreme') assert.equal(registry.stations[file.station].source,id,`Verkeerde stationskoppeling ${id}`);
 const source={station:file.station,dag:file.dag}; sources.push(source);
 sourceSlots[id] = {};
 for(const [m,month] of Object.entries(file.dag)) for(const [d,day] of Object.entries(month)) for(const [key,rows] of Object.entries(day)) {
  if(!rows.length) continue;
  const index=Math.round((Date.UTC(2000,+m-1,+d)-Date.UTC(2000,0,1))/86400000);
  (sourceSlots[id][key] ||= Array(366).fill('0'))[index]='1';
 }
 for(const key of Object.keys(sourceSlots[id])) sourceSlots[id][key]=sourceSlots[id][key].join('');
 for(const month of Object.values(source.dag)) for(const day of Object.values(month)) for(const rows of Object.values(day)) observations+=rows.length;
}
const national=core.national(sources);
assert.equal(Object.values(national).reduce((n,m)=>n+Object.keys(m).length,0),366);
for (const [day,value,date] of [['29',28,'1934-09-29'],['30',26.7,'1895-09-30']])
 assert(national[9][day].tx_hoog.some(r=>r[0]===value&&r[1]===date&&r[2]==='Winterswijk'));
// An unknown/retired station must survive aggregation; validation blocks publication until registered.
const unknown={station:'Voormalig station',dag:{1:{1:{tn_laag:[[-30,'1900-01-01']],rh_hoog:[[200,'1900-01-01']]}}}};
assert.equal(core.national([unknown])[1][1].tn_laag[0][2],'Voormalig station');
assert.throws(()=>core.validate(unknown,registry),/Onbekend/);
assert.throws(()=>core.national([null]),/Onvolledige/);
const tied=core.national([{station:'Bron',dag:{1:{1:{tx_hoog:[[20,'1900-01-01','A'],[20,'1901-01-01','B'],[20,'1900-01-01','A']]}}}}]);
assert.equal(tied[1][1].tx_hoog.length,2);
// Exercise the actual page entry point over every day and every available category.
for(const name of ['records_debilt','dagrecords_jaar']) {
 const html=fs.readFileSync(path.join(root,name+'.html'),'utf8');
 for(const [,attrs,body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) if(!/\bsrc=|application\/ld\+json/.test(attrs)) new vm.Script(body);
 const ctx=vm.createContext({RecordStations:core,natDagCache:null,natDagTag:null,multiData:sources.slice(0,-1),allData:{nl_extreme:sources.at(-1)},document:{getElementById:()=>({value:'alle'})}});
 const start=html.indexOf('function nationaalDagRecords()');
 vm.runInContext(html.slice(start,html.indexOf('\nfunction wisselJaarTab',start)),ctx);
 assert.equal(JSON.stringify(ctx.nationaalDagRecords()),JSON.stringify(national));
 // Actual ranking shown in the screenshot, including historical names and ties.
 ctx.huidigePeriode='dag';
 let day='29'; ctx.document.getElementById=id=>({value:id==='sel-station'?'alle':id==='sel-dag-maand'?'9':day});
 const rankingStart=html.indexOf('function samenvoegPeriodeRecords(');
 const rankingEnd=html.indexOf('\n}',rankingStart)+2;
 if(name==='dagrecords_jaar') { const a=html.indexOf('function laatsteTxJaar('); vm.runInContext(html.slice(a,html.indexOf('\n}',a)+2),ctx); }
 vm.runInContext(html.slice(rankingStart,rankingEnd),ctx);
 for(const date of ['29','30']) { day=date; const ranking=ctx.samenvoegPeriodeRecords(ctx.multiData,'tx_hoog'); assert.equal(ranking[0][2],'Winterswijk'); assert.equal(ranking.filter(r=>r[1]===ranking[0][1]&&r[2]==='Winterswijk').length,1); }
 assert(html.includes('GROEPEN.alle.stns = registry.sources'));
 assert(html.includes('Historische recordbron ontbreekt'));
}
const counts={};
for(const month of Object.values(national)) for(const day of Object.values(month)) for(const key of Object.keys(day)) counts[key]=(counts[key]||0)+1;
const winners=Object.fromEntries(Object.entries(national).flatMap(([m,month])=>Object.entries(month).flatMap(([d,day])=>Object.entries(day).map(([k,rows])=>[`${m}/${d}/${k}`,rows[0][0]]))));
const snapshot={sourceSlots,sources:registry.sources,stations:Object.keys(registry.stations).sort(),observations,counts,winners};
const baselinePath=path.join(root,'tests/historical-records-baseline.json');
if(process.argv.includes('--write-baseline')) fs.writeFileSync(baselinePath,JSON.stringify(snapshot,null,2)+'\n');
else {
 const baseline=JSON.parse(fs.readFileSync(baselinePath));
 for(const [id,coverage] of Object.entries(baseline.sourceSlots)) for(const [key,bits] of Object.entries(coverage)) {
  const current=sourceSlots[id]?.[key] || '';
  for(let day=0;day<366;day++) if(bits[day]==='1') assert.equal(current[day],'1',`Verdwenen bronrecord ${id}/${key}/dag${day+1}`);
 }
 for(const id of baseline.sources) assert(registry.sources.includes(id),`Verdwenen bron ${id}`);
 for(const name of baseline.stations) assert(registry.stations[name],`Verdwenen station ${name}`);
 for(const [key,value] of Object.entries(baseline.winners)) {
  assert(key in winners,`Verdwenen record ${key}`);
  assert(key.endsWith('_hoog')?winners[key]>=value:winners[key]<=value,`Record verslechterd ${key}`);
 }
}
console.log(JSON.stringify({stations:snapshot.stations.length,sources:sources.length,observations,counts,controls:national[9]['29'].tx_hoog.concat(national[9]['30'].tx_hoog)},null,2));
