const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'weerbewaking_pluim.html'), 'utf8');
const name = html.match(/src="(pluim_run_switcher_[a-f0-9]+\.js)"/)[1];
const source = fs.readFileSync(path.join(root, name), 'utf8');
assert.equal(name, `pluim_run_switcher_${crypto.createHash('sha256').update(source).digest('hex').slice(0,12)}.js`);
const fields = ['temperature_2m','precipitation','wind_speed_10m','wind_gusts_10m'];
function run(iso, value) {
  const start = Date.parse(iso);
  return {run:iso, n:2, times_ms:[start,start+10800000],
    members:Object.fromEntries(fields.map(f=>[f,Array.from({length:51},()=>[value,value+1])])),
    source:{access:'ecmwf_prescheduled_point_api',data_end:new Date(start+21600000).toISOString()}};
}
const old = run('2026-09-13T12:00:00Z',10), fresh = run('2026-09-14T00:00:00Z',20);
async function boot(search='') {
  let runs = [old];
  const events = {};
  const location = {search,pathname:'/weerbewaking_pluim.html',href:`https://weerlab.nl/weerbewaking_pluim.html${search}`,reload(){}};
  const fetch = async input => {
    const url=String(input);
    if(url.includes('/static/meta.json')) return new Response(JSON.stringify({last_run_initialisation_time:Date.parse(old.run)/1000,data_end_time:Date.parse(old.run)/1000+21600}));
    if(url.includes('pluim_direct_meta')) return new Response('{}',{status:404});
    if(url.includes('pluim_archive_meta')) return new Response(JSON.stringify({complete:true,station_count:39,member_count:51,revision:runs[0].run,runs:runs.map(r=>({run:r.run,complete:true,fields,station_count:39,member_count:51}))}));
    if(url.includes('pluim_trend_debilt')) return new Response(JSON.stringify({lat:52.101,lon:5.178,runs}));
    throw Error(url);
  };
  const window = {fetch,addEventListener(){},dispatchEvent(){},setInterval(){},setTimeout(task){task();}};
  const document={currentScript:{dataset:{required:fields.join(',')}},readyState:'loading',hidden:false,addEventListener(n,f){events[n]=f;},getElementById(){return null;}};
  vm.runInNewContext(source,{window,document,location,history:{replaceState(_a,_b,url){location.href=String(url);}},URL,URLSearchParams,Request,Response,Date,console,setTimeout,CustomEvent:class{}});
  const api=window.WeerlabPlumeRuns;
  await api.state.archiveReady;
  return {api,fetch:window.fetch,publish(){runs=[fresh,old];}};
}
(async()=>{
  const auto=await boot();
  assert.equal(Date.parse(auto.api.selectedRunIso()),Date.parse(old.run));
  auto.publish();
  // Reproduction: re-fetching metadata without reselecting stays on yesterday.
  let meta=await (await auto.fetch('https://ensemble-api.open-meteo.com/data/ecmwf_ifs025_ensemble/static/meta.json')).json();
  assert.equal(meta.last_run_initialisation_time,Date.parse(old.run)/1000);
  await auto.api.refreshSelection();
  assert.equal(Date.parse(auto.api.selectedRunIso()),Date.parse(fresh.run));
  meta=await (await auto.fetch('https://ensemble-api.open-meteo.com/data/ecmwf_ifs025_ensemble/static/meta.json')).json();
  const data=await (await auto.fetch('https://ensemble-api.open-meteo.com/v1/ensemble?models=ecmwf_ifs025&latitude=52.101&longitude=5.178&hourly=temperature_2m')).json();
  assert.equal(meta.last_run_initialisation_time,Date.parse(fresh.run)/1000);
  assert.equal(Date.parse(data.weerlab_run),Date.parse(fresh.run));
  assert.equal(data.hourly.temperature_2m[0],20);
  const chosen=await boot('?run=12');chosen.publish();await chosen.api.refreshSelection();
  assert.equal(Date.parse(chosen.api.selectedRunIso()),Date.parse(old.run),'explicit older cycle preserved');
  await auto.api.selectRunHour(12);await auto.api.refreshSelection();
  assert.equal(Date.parse(auto.api.selectedRunIso()),Date.parse(old.run),'button selection preserved');
  assert.match(html,/await runs.refreshSelection\(\)/);
  assert.match(html,/else await runs.state.archiveReady/);
  assert.match(html,/plumeLoadQueue.*then\(\(\) => renderCurrentPlume/);
  console.log('PASS: old timestamp reproduced; refresh selects published 00 UTC with matching data; explicit 12 UTC remains selected; missing CAPE does not delay the new run.');
})().catch(e=>{console.error(e);process.exitCode=1;});
