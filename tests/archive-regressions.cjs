const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const pages=['beta_landelijk_maand','maandoverzicht','zomerstatistieken','droogtemonitor','neerslag_records','historisch'];
for(const file of pages){
 const html=fs.readFileSync(file+'.html','utf8');
 for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g))new vm.Script(match[1],{filename:file+'.html'});
 assert(html.includes('terugkijken.css'));
}
const hist=fs.readFileSync('historisch.html','utf8');
const hctx=vm.createContext({});
vm.runInContext(hist.slice(hist.indexOf('const PARAM_COL ='),hist.indexOf('const NL_MAANDEN')),hctx);
vm.runInContext(hist.slice(hist.indexOf('function validArchiveDate'),hist.indexOf('async function laadDag')),hctx);
vm.runInContext(hist.slice(hist.indexOf('function displayObservation'),hist.indexOf('function tekstKleur')),hctx);
for(const [raw,param,expected] of [[100,'FXX',36],[250,'FXX',90],[100,'FG',10],[-1,'RH',0],[-1,'SQ',0],[-50,'TN',-5],[null,'FXX',null],['','FXX',null],[9,'NG',null]]){
 assert.equal(vm.runInContext(`observationValue(${JSON.stringify(raw)},'${param}')`,hctx),expected);
}
assert.equal(vm.runInContext("validArchiveDate('20240229')",hctx),true);
assert.equal(vm.runInContext("validArchiveDate('20230229')",hctx),false);
assert.equal(vm.runInContext("validArchiveDate('20990101')",hctx),false);
assert.equal(vm.runInContext("displayObservation(56,'VVN')",hctx),'6–7 km');
assert.equal(vm.runInContext("displayObservation(89,'VVN')",hctx),'>70 km');
const monthly=fs.readFileSync('maandoverzicht.html','utf8');
const mctx=vm.createContext({D:{},J:2026,M:9});
vm.runInContext(monthly.slice(monthly.indexOf('function rang('),monthly.indexOf('function ds(')),mctx);
vm.runInContext(monthly.slice(monthly.indexOf('function rglAgg('),monthly.indexOf('function rglRangUitleg(')),mctx);
mctx.D={'2026-09-01':{rr:10},'2026-09-03':{rr:10}};
assert.equal(vm.runInContext("rang(20,'rr',true,{2025:{rr:Array(30).fill(2)}})",mctx),'');
assert.equal(vm.runInContext("rglJaarwaarde(2026,'rr','sum',3)",mctx),null);
mctx.D['2026-09-02']={rr:5};
assert.equal(vm.runInContext("rglJaarwaarde(2026,'rr','sum',3)",mctx),25);
const beta=fs.readFileSync('beta_landelijk_maand.html','utf8');
assert(!beta.includes('DEMO'));
// Simulate requests completing out of order and a source failure.
const queue=[],nodes={};
const bctx=vm.createContext({DATA:{},monthRequest:0,MND:[],DATA_BASE:'',Date,document:{getElementById:id=>nodes[id]??=( {textContent:''})},sync(){},renderLeeg(){},render(){bctx.rendered=bctx.DATA.maand;},weerlabClimateStatus(){},fetch:()=>new Promise((resolve,reject)=>queue.push({resolve,reject}))});
vm.runInContext(beta.slice(beta.indexOf('function laad(jaar,maand)'),beta.indexOf('function f1(')),bctx);
(async()=>{
 vm.runInContext('laad(2026,8);laad(2026,9)',bctx);
 queue[1].resolve({ok:true,json:async()=>({jaar:2026,maand:9,kaart:[]})});
 await new Promise(setImmediate);
 queue[0].resolve({ok:true,json:async()=>({jaar:2026,maand:8,kaart:[]})});
 await new Promise(setImmediate);
 assert.equal(bctx.rendered,9);
 vm.runInContext('laad(2026,6)',bctx);queue[2].reject(new Error('offline'));await new Promise(setImmediate);
 assert.equal(bctx.DATA.leeg,true);assert.equal(bctx.DATA.maand,6);
 console.log('OK: six pages parse; gusts, trace codes, dates, visibility, complete periods and request ordering verified.');
})().catch(e=>{console.error(e);process.exitCode=1;});
