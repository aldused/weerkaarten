const assert = require('node:assert/strict');
const {modelTime,interpolate,loadNativeModels} = require('../modelcheck.js');
assert.equal(modelTime('2026-10-27T09:00'), Date.parse('2026-10-27T08:00Z'));
assert.equal(modelTime('2026-07-27T09:00'), Date.parse('2026-07-27T07:00Z'));
assert.equal(modelTime('2026-10-27T09:00Z'), Date.parse('2026-10-27T09:00Z'));
assert.ok(Number.isNaN(modelTime('ongeldig')));
(async()=>{
 const stations=[{name:'De Bilt',lat:52.1,lon:5.18},{name:'Vlissingen',lat:51.44,lon:3.6}],calls=[];
 const result=await loadNativeModels(stations,async raw=>{
  const url=new URL(raw);calls.push(url);
  assert.equal(url.pathname,'/model-point');assert.equal(url.searchParams.get('params'),'temp');assert.equal(url.searchParams.get('samples'),'1');
  return {model:url.searchParams.get('model'),tijden:['2026-10-27T09:00','2026-10-27T10:00'],data:{temp:[[0],[6]]}};
 });
 assert.equal(calls.length,4);assert.deepEqual(result.failures,[]);
 const series=result.output.harmonie['De Bilt'],t=Date.parse('2026-10-27T08:10Z');
 assert.equal(interpolate(series,t,3600000),1);assert.equal(interpolate(series,t-3600000,3600000),null);
 assert.equal(interpolate([{t:0,v:1},{t:7200000,v:2}],3600000,3600000),null);
 const failed=await loadNativeModels(stations.slice(0,1),async raw=>{
  const key=new URL(raw).searchParams.get('model');
  if(key==='icond2')throw Error('bron tijdelijk weg');
  return {model:key,tijden:['2026-10-27T09:00'],data:{temp:[[12]]}};
 });
 assert.deepEqual(failed.failures,['ICON-D2']);assert.equal(failed.output.harmonie['De Bilt'][0].v,12);
 console.log('PASS: eigen puntbronnen, lokale winter/zomertijd, uurinterpolatie, geen extrapolatie, onafhankelijke modeluitval.');
})().catch(e=>{console.error(e);process.exit(1)});
