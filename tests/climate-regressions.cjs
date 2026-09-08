/* Run with node tests/climate-regressions.cjs. No browser or network required. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const pages=['records_debilt','dagrecords_6dagen','dagrecords_jaar','hittegolven','extremen','stationsanalyse','feestdagen_weer','normalen','normalen_vergelijk','p13_records'];
for(const name of pages){
 const html=fs.readFileSync(path.join(root,name+'.html'),'utf8');
 for(const [,attrs,body]of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi))if(!/\bsrc=|application\/ld\+json/.test(attrs))new vm.Script(body,{filename:name+'.html'});
 assert(html.includes('klimaat.css?v='));assert(html.includes('id="climate-title"'));
}
// A fresh export must not make old observations look current.
const status={dataset:{},setAttribute(){}};
const doc={querySelector:()=>({append(){}}),getElementById:()=>status,addEventListener(){}};
class TestDate extends Date{constructor(...args){super(...(args.length?args:['2026-09-08T12:00:00Z']));}static now(){return new Date('2026-09-08T12:00:00Z').getTime();}}
const ctx=vm.createContext({document:doc,window:{},Date:TestDate,Intl});
vm.runInContext(fs.readFileSync(path.join(root,'klimaat.js'),'utf8'),ctx);
ctx.window.weerlabClimateStatus({through:'2026-08-10',generated:'2026-09-08',maxAgeDays:7});
assert.equal(status.dataset.state,'delayed');assert.match(status.textContent,/10 augustus 2026/);
ctx.window.weerlabClimateStatus({through:'20260907'});assert.equal(status.dataset.state,'info');
ctx.window.weerlabClimateStatus({through:'1970-01-01',historical:true});assert.equal(status.dataset.state,'info');
ctx.window.weerlabClimateStatus({fixed:'Normaalperiode 1991–2020'});assert.equal(status.dataset.state,'info');
const html=fs.readFileSync(path.join(root,'feestdagen_weer.html'),'utf8');
const bft=html.slice(html.indexOf('function msToBft('),html.indexOf('const PARAMS'));
const helpers=html.slice(html.indexOf('function paramWaarde('),html.indexOf('// ── Jaarwisseling middernacht'));
const wind=vm.createContext({});vm.runInContext(bft+helpers,wind);
assert.equal(wind.fmtWindstoot(140),'50');assert.equal(wind.fmtWindstoot(null),'–');
assert.equal(wind.fmtFG(50),'3');assert.equal(wind.fmtFG(null),'–');
assert.equal(wind.paramWaarde({factor:.1,kmh:true},100),36);
assert.equal(wind.paramWaarde({factor:.1,bft:true},50),3);
assert.equal(wind.fmtRH(-1),'0.0');assert.equal(wind.fmtRH(null),'–');assert.equal(wind.fmtSQ(0),'0.0');
assert(html.includes('fmtWindstoot(r.FX)')&&html.includes('fmtWindstoot(rij.FX)'),'Tables must show gusts in km/h');
assert(!html.includes('Wind <small>Bft</small>'));
// Gust formatting in the extremes finder uses the same km/h conversion.
const extremes=fs.readFileSync(path.join(root,'extremen.html'),'utf8');
const valueFn=extremes.slice(extremes.indexOf('function valueText('),extremes.indexOf('function metricById('));
const units=vm.createContext({});vm.runInContext(valueFn,units);
assert.equal(units.valueWithUnit(25,{field:'FXX',unit:'km/u'}),'90,0 km/u');
assert.equal(units.valueText(25,{field:'TX'}),'25,0');
// Stations with different column order must retain their own schema when cached.
const stationHTML=fs.readFileSync(path.join(root,'stationsanalyse.html'),'utf8');
const loader=stationHTML.slice(stationHTML.indexOf('const IS_LOCAL'),stationHTML.indexOf('// ── Analyseer één station'));
const stationConfig=stationHTML.slice(stationHTML.indexOf('const KOLOM_INFO ='),stationHTML.indexOf('// ── Globals'));
const config=vm.createContext({});vm.runInContext(stationConfig+';this.windInfo=KOLOM_INFO.wind;',config);
assert.equal(config.windInfo.eenheid,'km/u');
assert(Math.abs(90*config.windInfo.factor-250)<1e-8,'90 km/h must match 250 tenths m/s');
const analysis=stationHTML.slice(stationHTML.indexOf('function analyseerStation('),stationHTML.indexOf('// ── Analyse uitvoeren'));
const analysisCtx=vm.createContext({Date:TestDate,kolomIndex:{YYYYMMDD:0,FXX:1},MND:['jan'],inSeizoen:()=>true,seizoensJaar:y=>y,seizoensJaarLabel:y=>y,seizoensDag:(y,m,d)=>d,getVal:(row)=>row[1]});
vm.runInContext(analysis,analysisCtx);
const period={maanden:[1],lengte:31};
const series=analysisCtx.analyseerStation([['20260101',250],['20260102',null],['20260103',250],['20260105',250]],period,2026,2026,config.windInfo,'boven',250);
assert.equal(series.resultaten[0].aantal,3);assert.equal(series.resultaten[0].langsteReeks,1,'Missing dates and measurements break consecutive runs');
assert.equal(analysisCtx.analyseerStation([['20260101',null]],period,2026,2026,config.windInfo,'boven',250).resultaten.length,0,'Missing gust measurements cannot become a zero-event year');
let requests=0;
const cacheContext=vm.createContext({location:{hostname:'127.0.0.1',protocol:'http:'},csvCache:{},kolomIndex:{},document:{getElementById:()=>({value:'260'})},window:{weerlabClimateStatus(){}},fetch:async url=>{requests++;return{ok:true,json:async()=>url.includes('_260.')?{kolommen:['YYYYMMDD','TX'],data:[['20260907',200]]}:{kolommen:['TX','YYYYMMDD'],data:[[300,'20260907']]}}}});
vm.runInContext(loader,cacheContext);
(async()=>{
 await cacheContext.laadCSV('260');await cacheContext.laadCSV('380');
 const again=await cacheContext.laadCSV('260');assert.equal(cacheContext.getVal(again[0],'TX'),200);assert.equal(requests,2);
 console.log('OK: 10 pages parse; observation freshness, historical/fixed dates, wind units, trace amounts and station cache verified.');
})().catch(e=>{console.error(e);process.exitCode=1});
