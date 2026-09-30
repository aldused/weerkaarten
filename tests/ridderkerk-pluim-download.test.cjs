const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'weerbewaking_ridderkerk_rhoon_dekuip.html'),'utf8');
const exporter=fs.readFileSync(path.join(root,'weerbewaking_pluim_export.js'),'utf8');
const defaultCode=html.match(/<script>\s*\/\/ Deze weerbewaking[\s\S]*?<\/script>/)[0].replace(/<\/?script>/g,'');
test('Ridderkerk kiest 12 UTC, behoudt expliciete run en overige URL-velden',()=>{
 for(const search of ['', '?foo=bar', '?run=00&foo=bar']){
  let next='https://example.test/weerbewaking.html'+search+'#opties';
  vm.runInNewContext(defaultCode,{URL,URLSearchParams,location:{search,href:next},history:{replaceState(a,b,url){next=String(url)}}});
  assert.equal(new URL(next).searchParams.get('run'),search.includes('run=')?'00':'12');
  assert.equal(new URL(next).hash,'#opties');
 }
});
test('oude temperatuurvoorkeur wordt gemigreerd naar aangevinkt',()=>{
 const checkbox=html.match(/<input[^>]*id="pluim-type-temp"[^>]*>/)[0];
 assert.match(checkbox,/checked/);assert.match(checkbox,/data-save="pluim-type-temp-v2"/);
 const restore=html.slice(html.indexOf("if(d[k]!=null) el.checked"),html.indexOf('} else if(el.matches',html.indexOf("if(d[k]!=null) el.checked")));
 for(const [d,expected] of [[{'pluim-type-temp':false},true],[{'pluim-type-temp-v2':false},false]]){
  const el={checked:false};vm.runInNewContext(restore,{d,k:'pluim-type-temp-v2',el});assert.equal(el.checked,expected);
 }
});
test('download gebruikt de gekozen run en vraagt temperatuur verplicht op',async()=>{
 const code=html.slice(html.indexOf('async function genereerPluimNaast'),html.indexOf('/* Default pluim-periode'));
 let options;
 const fields={'plaats-in':{value:'Ridderkerk'},'pluim-start':{value:'2026-09-30'},'pluim-eind':{value:'2026-10-10'},'save-status':{}};
 const api={genereerLossePluimenPNGs:async o=>{options=o;return {count:4,unavailable:[]}}};
 const selector={ready:Promise.resolve(),state:{selectedHour:12}};
 const ctx={window:{WBPluimExport:api,WeerlabPlumeRuns:selector},WBPluimExport:api,PLAATS_COORDS:{Ridderkerk:{lat:51.8722,lon:4.6075}},document:{getElementById:id=>fields[id],querySelectorAll:()=>['temp','cloud','wind','rainmm'].map(param=>({dataset:{pluimParam:param,pluimLabel:param}}))}};
 vm.runInNewContext(code,ctx);await ctx.genereerPluimNaast();
 assert.equal(options.runHour,12);assert.deepEqual(Array.from(options.params),['temp','cloud','wind','rainmm']);assert.deepEqual(Array.from(options.requiredParams),['temp']);
 selector.state.requestedUnavailableHour=12;selector.state.selectedHour=0;
 await assert.rejects(ctx.genereerPluimNaast(),/12 UTC-run is nog niet beschikbaar/);
});
test('export downloadt temperatuur en stopt vóór downloads als die ontbreekt',async()=>{
 const code=exporter.slice(exporter.indexOf('  async function genereerLossePluimenPNGs'),exporter.indexOf('  window.WBPluimExport ='));
 let models=[{param:'temp'},{param:'cloud'}],downloads=[];
 const ctx={validateInput:()=>({naam:'Ridderkerk',startIso:'2026-09-30',endIso:'2026-10-10'}),withRequestedRun:async()=>({value:{},runMeta:{}}),buildModels:()=>models,slug:s=>s,renderInParallel:async(ms,fn)=>Promise.all(ms.map(fn)),renderBlob:async()=>({size:1}),pluimFilename:(folder,param)=>folder+'_'+param+'.png',downloadBlob:(b,name)=>downloads.push(name),setTimeout:fn=>fn()};
 vm.runInNewContext(code,ctx);
 await ctx.genereerLossePluimenPNGs({naam:'Ridderkerk',requiredParams:['temp']});assert(downloads.includes('Ridderkerk_temp.png'));
 downloads=[];models=[{param:'cloud'}];await assert.rejects(ctx.genereerLossePluimenPNGs({naam:'Ridderkerk',requiredParams:['temp']}),/temperatuur-pluim ontbreekt/);assert.equal(downloads.length,0);
});
