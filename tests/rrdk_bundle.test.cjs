const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const root=require('node:path').resolve(__dirname,'..')+'/';
const html=fs.readFileSync(root+'weerbewaking_ridderkerk_rhoon_dekuip.html','utf8');
const start=html.indexOf('async function genereerPluimNaast('),end=html.indexOf('/* Default pluim',start);
async function check(hour,fail=false){
 let calls=[],download=0;const status={};
 const elements={'plaats-in':{value:'Ridderkerk'},'pluim-start':{value:'2026-10-02'},'pluim-eind':{value:'2026-10-15'},'save-status':status};
 const api={async genereerLossePluimenPNGs(o){calls.push(o);assert.deepEqual(Array.from(o.params),['temp','rainmm','wind','cloud']);assert.equal(o.download,false);if(fail&&o.runHour===12)throw Error('run ontbreekt');return {files:o.params.map(p=>({filename:p+'.png',blob:new Blob([p])}))};},async downloadPakket(files,name){download++;assert.equal(files.length,hour===12?5:9);assert.equal(files[0].filename,'test.pdf');assert.equal(name,'test_met_kleurenpluimen.zip');assert.equal(files.filter(f=>f.path?.startsWith('12UTC/')).length,4);}};
 const ctx={window:{WBPluimExport:api,WeerlabPlumeRuns:{ready:Promise.resolve(),state:{selectedHour:hour}}},WBPluimExport:api,document:{getElementById:id=>elements[id]},PLAATS_COORDS:{Ridderkerk:{lat:51.8722,lon:4.6075,folder:'ridderkerk'}},Date,Blob};
 vm.runInNewContext(html.slice(start,end),ctx);
 if(fail){await assert.rejects(ctx.genereerPluimNaast({pdf:new Blob(['pdf']),filename:'test.pdf'}),/run ontbreekt/);assert.equal(download,0);}else{await ctx.genereerPluimNaast({pdf:new Blob(['pdf']),filename:'test.pdf'});assert.deepEqual(calls.map(c=>c.runHour),hour===12?[12]:[hour,12]);assert.equal(download,1);}
}
(async()=>{await check(0);await check(12);await check(18,true);console.log('PASS: PDF + four charts, mandatory 12 UTC, no duplicates and no partial download on error');})().catch(e=>{console.error(e);process.exit(1);});
