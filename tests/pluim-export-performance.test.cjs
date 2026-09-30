const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
function setup(){
 const ctx={window:{},location:{protocol:'http:',hostname:'localhost'},TextEncoder,Date,console,URL,URLSearchParams,AbortController,setTimeout,clearTimeout};
 vm.runInNewContext(fs.readFileSync(path.join(root,'pluim_math.js'),'utf8'),ctx);
 ctx.window.WeerlabPlumeMath=ctx.WeerlabPlumeMath;
 const src=fs.readFileSync(path.join(root,'weerbewaking_pluim_export.js'),'utf8').replace('window.WBPluimExport = {', 'window.testExport={buildModels,fieldsForParams,makeDailyMaxStats}; window.WBPluimExport = {');
 vm.runInNewContext(src,ctx);return ctx.window.testExport;
}
test('echte temperatuurmodellen werken met Date-tijdas en alle 51 leden',()=>{
 const api=setup();const time=Array.from({length:13},(_,i)=>new Date(Date.UTC(2026,8,30,i*6)).toISOString());
 const hourly={time};for(let m=0;m<51;m++)hourly[m?'temperature_2m_member'+String(m).padStart(2,'0'):'temperature_2m']=time.map((_,i)=>10+i%4+m/10);
 const models=api.buildModels({hourly},'2026-09-30','2026-10-02',{},['temp']);
 assert.equal(models.length,1);assert.equal(models[0].param,'temp');assert.equal(models.unavailable.length,0);assert(models[0].stats.dailyMax.length>0);
});
test('Ridderkerk vraagt uitsluitend velden voor geselecteerde pluimen op',()=>{
 const fields=setup().fieldsForParams(['temp','cloud','wind','rainmm']).split(',');
 assert.deepEqual(fields.sort(),['temperature_2m','cloud_cover','wind_speed_10m','precipitation'].sort());
 assert(setup().fieldsForParams(['thunder']).includes('precipitation'));
});
