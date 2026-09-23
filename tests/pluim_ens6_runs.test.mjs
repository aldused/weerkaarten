import test from 'node:test';
import assert from 'node:assert/strict';
import {RunController} from '../pluim_ens6_runs.mjs';
import {runId,runLabel,runToken,PARAMETERS,PANEL_TOTAL,panelCount,archivedDataset,publishedRuns,assertDataset} from '../pluim_ens6_data.mjs';
import {handleEns6} from '../cloudflare-worker/ens6-runs.mjs';

export const ids=['2026-09-20T00:00:00Z','2026-09-19T18:00:00Z','2026-09-19T12:00:00Z','2026-09-19T06:00:00Z','2026-09-19T00:00:00Z'];
export const manifest={complete:true,station_count:39,member_count:51,revision:'r1',runs:ids.map((run,i)=>({run,complete:true,fields:i===3?['cloud_cover','wind_direction_10m']:PARAMETERS,revision:'r1',data_sha256:'r1'}))};
export function archive() {
  return {lat:52.101,lon:5.178,runs:ids.map((run,i)=>({run,source:{run_initialisation:run,model:'ecmwf_ifs025',provider:'ECMWF'},times_ms:Array.from({length:9},(_,j)=>Date.parse(run)+j*10800000),members:Object.fromEntries(PARAMETERS.map(field=>[field,Array.from({length:51},()=>Array.from({length:9},(_,j)=>field==='wind_direction_10m'?i*60:field.includes('temperature')?i-j:20*i))]))}))};
}
export function dataset(id,location={lat:52.101,lon:5.178}) {
  return {...archivedDataset(archive(),manifest.runs.find(r=>r.run===id)),location:{latitude:location.lat,longitude:location.lon},revision:'r1'};
}
test('archived cloud layers retain sparse timestamps and member positions without zero fill',()=>{
  const doc=archive(),entry=manifest.runs[0];
  for(const field of ['cloud_cover_low','cloud_cover_mid'])for(const row of doc.runs[0].members[field])row[1]=null;
  doc.runs[0].members.cloud_cover_low[17][2]=null;
  const data=archivedDataset(doc,entry);
  assert.equal(data.ens.hourly.cloud_cover_low[1],null);
  assert.equal(data.ens.hourly.cloud_cover_low_member17[2],null);
  assert.equal(data.ens.hourly.cloud_cover_low_member18[2],0);
  assert.equal(data.ens.hourly.time.length,9);
  assert.equal(data.run,ids[0]);
});
function mock({delay=()=>0,badRun=false}={}) {
  const requests=[],aborted=[];
  const fetcher=async(url,{signal})=>{
    const u=new URL(url);requests.push(u);
    if(u.pathname==='/ens6-runs')return Response.json({runs:manifest.runs,revision:'r1'});
    const id=u.searchParams.get('run');
    await new Promise((resolve,reject)=>{
      const timer=setTimeout(resolve,delay(id));
      signal.addEventListener('abort',()=>{clearTimeout(timer);aborted.push(id);reject(new DOMException('Aborted','AbortError'));},{once:true});
    });
    return Response.json(dataset(badRun?ids[0]:id,{lat:Number(u.searchParams.get('latitude')),lon:Number(u.searchParams.get('longitude'))}));
  };
  return {fetcher,requests,aborted};
}
const location={lat:52.101,lon:5.178};
test('UTC IDs include date, reject impossible dates and round-trip URL tokens',()=>{
  for(const id of ids)assert.equal(runId(runToken(id)),id);
  for(const bad of ['20260230T12','20260919T13','not-a-run','2026-09-19T12:00:00+02:00'])assert.throws(()=>runId(bad));
});
test('UTC labels remain correct at midnight and across both DST transitions',()=>{
  for(const id of ['2026-03-29T00:00:00Z','2026-03-29T06:00:00Z','2026-10-25T00:00:00Z','2026-10-25T06:00:00Z',ids[0]]) {
    assert.match(runLabel(id),new RegExp(id.slice(11,13)+' UTC$'));
    assert.match(runLabel(id),new RegExp(Number(id.slice(8,10))+' '));
  }
});
test('published catalog sorts newest first and excludes unverified or incomplete entries',()=>{
  const m=structuredClone(manifest);m.runs.reverse();m.runs.push({run:'2026-09-20T06:00:00Z',complete:false,fields:PARAMETERS});
  assert.deepEqual(publishedRuns(m).map(r=>r.run),ids);
  m.runs[0].fields=[];assert.equal(publishedRuns(m).length,4);
});
test('all available hours, previous day and same hour on different dates remain distinct',async()=>{
  const io=mock(),control=new RunController(io);
  for(const id of ids){control.choose(id);const result=await control.load(location);assert.equal(result.data.run,id);assert(control.isCurrent(result));}
  const requested=io.requests.filter(u=>u.pathname==='/ens6-run');
  assert.deepEqual(requested.map(u=>u.searchParams.get('run')),ids);
  for(const u of requested){assert(u.searchParams.get('model'));assert(u.searchParams.get('hourly'));assert(u.searchParams.get('forecast'));assert.equal(u.searchParams.get('start_hour'),u.searchParams.get('run'));}
});
test('latest → older → latest reuses cached run; location and revision separate caches',async()=>{
  const io=mock(),control=new RunController(io);
  const latest=await control.load(location);control.choose(ids[2]);await control.load(location);control.choose(ids[0]);
  assert.equal((await control.load(location)).data,latest.data);
  await control.load({lat:51.9244,lon:4.4777});
  assert.equal(io.requests.filter(u=>u.pathname==='/ens6-run').length,3);
  assert.equal(control.selectedRun,ids[0]);
});
test('legacy hour links resolve once to a full timestamp; shared full IDs restore exactly',async()=>{
  for(const requested of ['12','20260919T12',ids[2]]) {
    const control=new RunController({...mock(),requested});assert.equal((await control.load(location)).data.run,ids[2]);
  }
});
test('missing run and invalid URL never fall back to latest',async()=>{
  const io=mock(),control=new RunController({...io,requested:'20260917T12'});
  await assert.rejects(control.load(location),/niet beschikbaar/);assert.equal(control.selectedRun,'2026-09-17T12:00:00Z');
  assert.equal(io.requests.filter(u=>u.pathname==='/ens6-run').length,0);
  const invalid=new RunController({...mock(),requested:'nonsense'});await assert.rejects(invalid.load(location),/Ongeldige/);
});
test('rapid switching aborts previous requests; stale data cannot commit',async()=>{
  const io=mock({delay:id=>id===ids[0]?80:5}),control=new RunController({...io,requested:ids[0]});
  const first=control.load(location);const rejection=assert.rejects(first,{name:'AbortError'});
  await new Promise(resolve=>setTimeout(resolve,5));control.choose(ids[2]);const chosen=await control.load(location);await rejection;
  assert(control.isCurrent(chosen));assert.equal(chosen.data.run,ids[2]);assert.deepEqual(io.aborted,[ids[0]]);
});
test('duplicate loads share one request and refreshing does not replace pinned selection',async()=>{
  const io=mock({delay:()=>10}),control=new RunController({...io,requested:ids[2]});
  const [a,b]=await Promise.all([control.load(location),control.load(location)]);assert.equal(a,b);
  await control.load(location,{refresh:true});assert.equal(control.selectedRun,ids[2]);
  assert.equal(io.requests.filter(u=>u.pathname==='/ens6-run').length,2);
});
test('response initialization mismatch is rejected, including wrong metadata',async()=>{
  const control=new RunController({...mock({badRun:true}),requested:ids[2]});await assert.rejects(control.load(location),/ontvangen gegevens/);
  const bad=dataset(ids[2]);bad.meta.last_run_initialisation_time+=21600;assert.throws(()=>assertDataset(bad,ids[2]));
});
test('archive only exposes published same-run fields and rejects incomplete core',()=>{
  const a=archive();const data=archivedDataset(a,manifest.runs[3]);
  assert(data.ens.weerlab_unavailable_variables.includes('cloud_cover_low'));assert.equal(data.ens.hourly.cloud_cover_low,undefined);
  a.runs[3].members.wind_direction_10m[0][0]=null;assert.throws(()=>archivedDataset(a,manifest.runs[3]),/onvolledig/);
});
test('backend returns only requested run and validates its source; unknown location does not fall back',async()=>{
  const calls=[];
  const fetcher=async url=>{
    calls.push(String(url));
    if(String(url).includes('meta.json') && !String(url).includes('pluim_archive'))return Response.json({last_run_initialisation_time:Date.parse(ids[0])/1000});
    if(String(url).includes('pluim_archive'))return Response.json(manifest);
    if(String(url).includes('pluim_trend_'))return Response.json(archive());
    return Response.json({}, {status:404});
  };
  const url=new URL('https://om.weerlab.nl/ens6-run?latitude=52.101&longitude=5.178&run=20260919T12');
  const res=await handleEns6(url,new Request(url),{},fetcher);assert.equal(res.status,200);
  const data=await res.json();assert.equal(data.run,ids[2]);assert.equal(data.ens.weerlab_run,ids[2]);assert.equal(data.ens.hourly.cloud_cover[0],40);
  assert(!('runs' in data));assert.equal(calls.filter(u=>u.includes('pluim_trend_')).length,1);
  url.searchParams.set('latitude','40');url.searchParams.set('longitude','-74');
  const missing=await handleEns6(url,new Request(url),{},fetcher);assert.equal(missing.status,404);
});
test('new live run before archive publication is offered only after all 51 core members pass',async()=>{
  const id='2026-09-20T06:00:00Z',start=Date.parse(id)/1000;
  const meta={last_run_initialisation_time:start,last_run_modification_time:start+24000,last_run_availability_time:start+24000,data_end_time:start+10800,temporal_resolution_seconds:10800};
  let partial=false,rollover=false,noArchive=false;
  const fetcher=async url=>{
    const u=String(url);
    if(u.includes('pluim_archive'))return noArchive?Response.json({}, {status:503}):Response.json(manifest);
    if(u.includes('/static/meta.json'))return Response.json({...meta,last_run_modification_time:meta.last_run_modification_time+(rollover?Math.random():0)});
    if(u.includes('/v1/ensemble')) {
      const hourly={time:[id,id.replace('06:00','09:00')]};
      for(const field of PARAMETERS)for(let i=0;i<51;i++)hourly[field+(i?`_member${String(i).padStart(2,'0')}`:'')]=[20,40];
      if(partial)hourly.wind_direction_10m_member50=[null,40];
      return Response.json({hourly});
    }
    return Response.json({}, {status:404});
  };
  const url=new URL('https://om.weerlab.nl/ens6-runs?latitude=52.101&longitude=5.178');
  const list=async()=> (await (await handleEns6(url,new Request(url),{},fetcher)).json()).runs;
  assert.equal((await list())[0].run,id);
  partial=true;assert(!(await list()).some(r=>r.run===id));partial=false;
  rollover=true;assert(!(await list()).some(r=>r.run===id));rollover=false;
  noArchive=true;assert.equal((await list())[0].run,id);
  url.pathname='/ens6-run';url.searchParams.set('run',id);
  const response=await handleEns6(url,new Request(url),{},fetcher);
  assert.equal(response.status,200);assert.equal((await response.json()).run,id);
});
test('sparse_fields publish early-run pressure levels only via their own capability; snowfall is requested',()=>{
  assert(PARAMETERS.includes('snowfall'));
  assert(!PARAMETERS.includes('cape'));
  const doc=archive();
  for(const row of doc.runs[0].members.temperature_850hPa)row[1]=null;
  const base={...manifest.runs[0],fields:manifest.runs[0].fields.filter(f=>f!=='temperature_850hPa')};
  assert(archivedDataset(doc,base).ens.weerlab_unavailable_variables.includes('temperature_850hPa'));
  const data=archivedDataset(doc,{...base,sparse_fields:['temperature_850hPa']});
  assert.equal(data.ens.hourly.temperature_850hPa[1],null);
  assert(Number.isFinite(data.ens.hourly.temperature_850hPa[2]));
  assert(!data.ens.weerlab_unavailable_variables.includes('temperature_850hPa'));
});
test('without an explicit choice the newest run with all six panels is selected; incomplete newer runs stay selectable',async()=>{
  const runs=[{run:'2026-09-23T00:00:00Z',fields:['cloud_cover','wind_direction_10m','snowfall'],revision:'r1'},...manifest.runs.slice(1)];
  const fetcher=async url=>new URL(url).pathname==='/ens6-runs'?Response.json({runs,revision:'r1'}):Response.json(dataset(ids[1]));
  const control=new RunController({fetcher});
  const result=await control.load(location);
  assert.equal(result.data.run,ids[1]);
  assert.equal(control.runs[0].run,'2026-09-23T00:00:00Z');
  assert.equal(panelCount(control.runs[0]),3);
  assert.equal(panelCount({fields:['cloud_cover','wind_direction_10m','snowfall','cloud_cover_low','cloud_cover_mid'],sparse_fields:['temperature_850hPa','temperature_500hPa']}),PANEL_TOTAL);
});
