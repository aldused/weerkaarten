const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(process.argv[2]||require('node:path').join(__dirname,'../demo_vierluik_neerslag.html'),'utf8');
function extract(name){const start=source.indexOf('function '+name+'(');assert.ok(start>=0);return source.slice(start,source.indexOf('\n}',start)+2);}
test('An explicit ECMWF choice loads its immutable metadata and preserves the shared valid time',async()=>{
 const cfg={id:'ecmwf_global',metaFile:'ecmwf_om_canvas_meta.json'},select={value:'ecmwf-runs/2026102000/meta.json'},calls=[];
 const c={document:{getElementById:()=>select},MODELS:[cfg],modelData:{ecmwf_global:{metaFile:cfg.metaFile}},playTimer:null,ecmwfRunChoice:'latest',ecmwfRunLoading:false,activeGlobalTime:'2026-10-20T15:00:00Z',panelVoorModel:()=>3,updateAllPanelHeaders(){},getGlobalTimes(){},requestRender(){},loadModel:async m=>{calls.push(m.metaFile);c.modelData[m.id]={metaFile:m.metaFile};}};
 vm.createContext(c);vm.runInContext(extract('ecmwfConfig')+'\n'+extract('kiesEcmwfRun'),c);await c.kiesEcmwfRun();
 assert.deepEqual(calls,['ecmwf-runs/2026102000/meta.json']);assert.equal(c.activeGlobalTime,'2026-10-20T15:00:00Z');assert.equal(select.disabled,false);
 select.value='latest';await c.kiesEcmwfRun();assert.equal(cfg.metaFile,'ecmwf_om_canvas_meta.json');
});
test('A failed run change restores the previous choice instead of relabelling old data',async()=>{
 const cfg={id:'ecmwf_global',metaFile:'ecmwf_om_canvas_meta.json'},select={value:'ecmwf-runs/2026102000/meta.json'};
 const c={document:{getElementById:()=>select},MODELS:[cfg],modelData:{ecmwf_global:{metaFile:cfg.metaFile}},playTimer:null,ecmwfRunChoice:'latest',ecmwfRunLoading:false,panelVoorModel:()=>3,updateAllPanelHeaders(){},getGlobalTimes(){},requestRender(){},loadModel:async()=>{}};
 vm.createContext(c);vm.runInContext(extract('ecmwfConfig')+'\n'+extract('kiesEcmwfRun'),c);await c.kiesEcmwfRun();assert.equal(select.value,'latest');assert.equal(cfg.metaFile,'ecmwf_om_canvas_meta.json');
});
