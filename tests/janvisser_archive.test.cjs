const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require('node:path').join(__dirname,'../pluim_run_switcher_7547452ecdc3.js'),'utf8');
function extract(name){const start=source.indexOf('async function '+name+'('),open=source.indexOf('{',start);let depth=0;for(let i=open;i<source.length;i++){if(source[i]==='{')depth++;if(source[i]==='}'&&!--depth)return source.slice(start,i+1);}}
(async()=>{
 let fail=true,calls=0;
 const context={URL,Date,AbortSignal,HOUR_MS:3600000,DATA_ROOTS:['https://example.test'],archiveCache:new Map(),archiveVersionTag:()=>1,originalFetch:async()=>{calls++;if(fail)throw Error('temporary');return {ok:true,json:async()=>({runs:[]})};}};
 vm.createContext(context);vm.runInContext(extract('loadArchive'),context);
 await assert.rejects(context.loadArchive('debilt'));
 fail=false;await context.loadArchive('debilt');await context.loadArchive('debilt');assert.equal(calls,2);
 context.archiveForRequest=async()=>({runs:['2026-09-25T12:00Z','2026-09-25T18:00Z','2026-09-26T00:00Z','2026-09-26T06:00Z','2026-09-26T12:00Z'].map(run=>({run}))});
 context.completeMemberMatrix=()=>true;context.archiveEnsembleResponse=(_,run)=>run.run;
 vm.runInContext(extract('previousMainEnsemble'),context);
 for(const [h,expected]of [[0,'2026-09-25T12:00Z'],[6,'2026-09-26T00:00Z'],[12,'2026-09-26T00:00Z'],[18,'2026-09-26T12:00Z']])assert.equal(await context.previousMainEnsemble(52,5,`2026-09-26T${String(h).padStart(2,'0')}:00Z`),expected);
 assert.equal(await context.previousMainEnsemble(52,5,'2026-10-01T12:00Z'),null);
 console.log('PASS: failed archives recover, previous 00/12 runs selected for all cycles, stale runs excluded');
})().catch(e=>{console.error(e);process.exitCode=1;});
