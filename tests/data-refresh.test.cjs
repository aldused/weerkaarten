const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=n=>fs.readFileSync(__dirname+'/../'+n,'utf8');
test('Full station refresh updates sunshine/rain and preserves the last good snapshot on failure',async()=>{
 const source=read('records_debilt.html'),code=source.slice(source.indexOf('async function laadStation('),source.indexOf('function samenvoegPeriodeRecords('));
 const old={station_nr:344,sq:1,rh:2},fresh={station_nr:344,sq:5,rh:7};let calls=0,fail=false;
 const ctx=vm.createContext({allData:{344:old},laadPromises:{},HIST_STATIONS:{},HIST_MERGE:{},RECBASE:'/',Date,AbortSignal,console:{warn(){}},RecordStations:{normalize:x=>x,load:async()=>({})},voegLopendeMaanddetailTxToe(){},fetch:async()=>{calls++;if(fail)throw Error('offline');return{ok:true,json:async()=>fresh};}});
 vm.runInContext(code,ctx);
 assert.equal(await ctx.laadStation('344'),old);assert.equal(calls,0);
 assert.equal(await ctx.laadStation('344',true),fresh);assert.equal(calls,1);
 fail=true;assert.equal(await ctx.laadStation('344',true),fresh);assert.equal(ctx.allData[344],fresh);
});
test('A station change during a refresh cannot replace the newly selected view',async()=>{
 const source=read('records_debilt.html'),start=source.indexOf('let recordsRefreshBusy ='),end=source.indexOf('window.setInterval(verversRecordBronnen',start);
 let selection='344',finish,renders=0;
 const old={station_nr:344},ctx=vm.createContext({document:{hidden:false,getElementById:()=>({get value(){return selection;}})},data:old,multiData:null,natDagCache:null,HIST_STATIONS:{},GROEPEN:{},Promise,huidigeHoofdtab:'records',hertekenNaActueleTx(){renders++;},laadStation:()=>new Promise(resolve=>{finish=resolve;})});
 vm.runInContext(source.slice(start,end),ctx);const pending=ctx.verversRecordBronnen();selection='260';finish({station_nr:344,sq:5});await pending;
 assert.equal(ctx.data,old);assert.equal(renders,0);
});
test('Dutch month/year rollover is independent of browser timezone',()=>{
 const source=read('maandoverzicht.html'),start=source.indexOf('function nederlandseMaand('),end=source.indexOf('var liveMaand=',start),ctx=vm.createContext({Intl,Date});
 vm.runInContext(source.slice(start,end),ctx);
 const result=ctx.nederlandseMaand(new Date('2026-12-31T23:30:00Z'));assert.equal(result.jaar,2027);assert.equal(result.maand,1);
});
