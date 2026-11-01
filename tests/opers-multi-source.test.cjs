const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync('demo_multimodel_temp.html','utf8');
const code=html.slice(html.indexOf('const SOURCE_MODELS ='),html.indexOf('\nasync function laad('));
const calls=[],now=new Date();now.setHours(1,0,0,0);
const time=[new Date(+now-10*864e5).toISOString(),now.toISOString(),new Date(+now+10*864e5).toISOString()];
const ctx={URLSearchParams,Date,Number,Promise,FORECAST_DAYS:7,fetchJSON:async url=>{
 const u=new URL(url),model=u.searchParams.get('models');calls.push(model);
 assert(!model.includes(','),'each model must have its own request');
 if(model==='gfs_seamless')throw Error('source unavailable');
 return {run_utc:now.toISOString(),source:'Own model',hourly:{time,temperature_2m:[8,0,9],precipitation:[3,null,5],wind_speed_10m:[10,14,15]}};
}};vm.createContext(ctx);vm.runInContext(code,ctx);
(async()=>{
 const results=await ctx.haalBatch([{slug:'dwd_icon'},{slug:'dwd_icon_d2'},{slug:'ecmwf_aifs025_single'},{slug:'gfs_seamless'},{slug:'jma_seamless'},{slug:'knmi_harmonie_arome_europe'}],52.1,5.1);
 assert.equal(results.length,3);assert.deepEqual(calls.sort(),['ecmwf_aifs_single','gfs_seamless','icon_d2','icon_global'].sort());
 for(const r of results){assert.equal(r.time.length,1);assert.equal(r.temp[0],0);assert.equal(r.precip[0],null);assert.equal(r.wind[0],14);}
 console.log('PASS individual model aliases, isolated failure, unsuffixed native fields, zero vs missing, seven-day window, no duplicate HARMONIE');
})().catch(e=>{console.error(e);process.exitCode=1;});
