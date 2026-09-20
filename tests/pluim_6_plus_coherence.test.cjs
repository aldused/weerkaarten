const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../pluim_6_plus.html'),'utf8');
function extract(name) {
  const start=source.indexOf('function '+name+'(');assert(start>=0,name);
  let depth=0;const brace=source.indexOf('{',start);
  for(let i=brace;i<source.length;i++){if(source[i]==='{')depth++;if(source[i]==='}'&&--depth===0)return source.slice(start,i+1);}
  throw Error(name);
}
const context={Date,Number,Object,Array,Set,Map,Intl,console,
  HOUR_MS:3600000,DAY_MS:86400000,currentStation:{name:'De Bilt'},
  WeerlabCloudProbability:require('../pluim_cloud_probability.js'),
  WINDDIR_SECTORS:['N','NO','O','ZO','Z','ZW','W','NW'],
  WINDDIR_COLORS:{N:'#1',NO:'#2',O:'#3',ZO:'#4',Z:'#5',ZW:'#6',W:'#7',NW:'#8'}};
vm.runInNewContext(['fillNaN','membersOf','boundedMembersOf','pairedLayerMembers','trimTrailingMissing','requireMemberMatrix','availableMemberMatrix','exactEnsembleMembers','optionalMemberMatrix','addLegacyFieldAliases','alignHresSeries','percentile','rangeOf','pad','windDirStackSeries','cutoffLengthForDataEnd','buildModel'].map(extract).join('\n'),context);
const start=Date.parse('2026-09-19T06:00:00Z'),times=Array.from({length:4},(_,i)=>new Date(start+i*10800000).toISOString());
function ensemble(fields) {
  const hourly={time:times.slice()};
  for(const field of fields)for(let i=0;i<51;i++)hourly[field+(i?'_member'+String(i).padStart(2,'0'):'')]=[20,40,60,80];
  return {weerlab_run:times[0],hourly};
}
const core=ensemble(['cloud_cover','wind_direction_10m']);
const early=context.buildModel(structuredClone(core),null,start,Date.parse(times.at(-1)));
assert.equal(early.panels.length,6);
assert.equal(early.panels.filter(p=>p.unavailable).length,4);
assert.match(early.panelStatus,/2 van 6/);
const full=ensemble(['cloud_cover','cloud_cover_low','cloud_cover_mid','wind_direction_10m','cape','temperature_850hPa','temperature_500hPa']);
assert.equal(context.buildModel(structuredClone(full),null,start,Date.parse(times.at(-1))).panelStatus,'6 van 6 panelen');
const sparse=structuredClone(core);sparse.hourly.cloud_cover_member17[2]=null;
const sparseModel=context.buildModel(sparse,null,start,Date.parse(times.at(-1)));
assert.equal(sparseModel.panels[1].stacked.validCounts[2],50);
const partial=structuredClone(full);partial.hourly.temperature_850hPa_member17[2]=null;
assert(context.buildModel(partial,null,start,Date.parse(times.at(-1))).panels[4].unavailable);
assert.throws(()=>context.buildModel({...core,weerlab_run:'2026-09-19T00:00:00Z'},null,start,Date.parse(times.at(-1))),/andere ECMWF-run/);
assert.throws(()=>context.buildModel(structuredClone(core),{weerlab_run:'2026-09-19T00:00:00Z',hourly:{}},start,Date.parse(times.at(-1))),/andere ECMWF-initialisatie/);
assert.throws(()=>context.buildModel(structuredClone(core),null,start+3600000,Date.parse(times.at(-1))));
assert.deepEqual(Array.from(context.alignHresSeries(times.map(t=>new Date(t)),times.slice(0,2).map(t=>new Date(t)),[1,2],'CAPE',false)),[1,2,null,null]);
assert.throws(()=>context.alignHresSeries(times.map(t=>new Date(t)),[new Date(times[0]),new Date(times[2])],[1,2],'CAPE',false),/mist een ENS-tijdstip/);
console.log('ENS6plus-coherentie: volledige en gedeeltelijke runs, ontbrekende leden/velden en exacte HRES-uitlijning gecontroleerd.');
