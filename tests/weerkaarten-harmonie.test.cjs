const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(require('node:path').join(__dirname,'../weerkaarten_europa.html'),'utf8');
const source=html.slice(html.indexOf('function validHarmonieData('),html.indexOf('async function refreshMeta('));
const valid=vm.runInNewContext(source+';validHarmonieData');
function data(){
 const run_utc='2026-10-24T22:00:00Z';
 const frames=Array.from({length:6},(_,i)=>({lead:i+1,valid_utc:new Date(Date.parse(run_utc)+(i+1)*3600000).toISOString()}));
 return {cycles:['22'],runs:{'22':{run_utc,frames,files:Object.fromEntries(['mslp_bft','t2m','wind','gust'].map(k=>[k,frames.map(f=>k+'_'+f.lead+'.png')]))}}};
}
test('All hourly maps are accepted through the Dutch wintertime transition',()=>assert.equal(valid(data()),true));
test('Three-hour steps and mislabeled valid times cannot be advertised as hourly',()=>{
 const d=data();d.runs['22'].frames[2].lead+=2;assert.equal(valid(d),false);
 const e=data();e.runs['22'].frames[2].valid_utc=e.runs['22'].frames[1].valid_utc;assert.equal(valid(e),false);
});
test('All four elements must have a complete matching hourly series',()=>{
 const d=data();d.runs['22'].files.gust.pop();assert.equal(valid(d),false);
 assert.equal(valid(null),false);
});
