/* Exact archived winner: the overview renders these same 51-member matrices. */
(function () {
  'use strict';
  const query=new URLSearchParams(location.search);
  const point=query.get('top3_punt'),revision=query.get('top3_versie'),token=query.get('top3_run');
  const selectedMember=/^(?:[0-9]|[1-4][0-9]|50)$/.test(query.get('top3_lid')||'') ? Number(query.get('top3_lid')) : null;
  if (!point && !revision && !token) return;
  const valid=/^(?:o1280_\d+|ifs025_\d+_\d+)$/.test(point||'') && /^[a-f0-9]{64}$/.test(revision||'') && /^\d{8}T(?:00|06|12|18)$/.test(token||'');
  const originalFetch=window.fetch.bind(window);
  const required=['temperature_2m','precipitation','wind_speed_10m','wind_gusts_10m','snowfall'];
  const run=valid ? `${token.slice(0,4)}-${token.slice(4,6)}-${token.slice(6,8)}T${token.slice(9)}:00:00.000Z` : null;
  const root='https://data.weerlab.nl';
  let meta=null,ensemble=null,control=null;
  const state={archiveReady:null,archiveManifest:null,liveMeta:null};
  const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
  const ready=(async()=>{
    if (!valid) throw new Error('Ongeldige landelijke pluimlink.');
    const [response,manifestResponse]=await Promise.all([
      originalFetch(`${root}/pluim-top3/${token}/${revision}/${point}.json`),
      originalFetch(`${root}/pluim_top3_landelijk.json`,{cache:'no-cache'}),
    ]);
    if (!response.ok || !manifestResponse.ok) throw new Error('Deze exacte landelijke pluim is tijdelijk niet beschikbaar.');
    const doc=await response.json(),manifest=await manifestResponse.json();
    const times=doc.times_ms;
    if (doc.schema!==1 || Date.parse(doc.run)!==Date.parse(run) || doc.revision!==revision
      || !Array.isArray(times) || times[0]!==Date.parse(run) || times.length<2
      || times.some((t,i)=>!Number.isFinite(t)||(i && t<=times[i-1]))) throw new Error('De landelijke pluim hoort niet bij de gekozen modelrun.');
    for (const field of required) {
      const matrix=doc.members?.[field];
      if (!Array.isArray(matrix)||matrix.length!==51||matrix.some(row=>!Array.isArray(row)||row.length!==times.length||row.some(v=>!Number.isFinite(v)))) throw new Error('De landelijke pluim mist ensembleleden of tijdstappen.');
    }
    const hourly={time:times.map(t=>new Date(t).toISOString())};
    for (const field of required) doc.members[field].forEach((row,i)=>{hourly[field+(i?`_member${String(i).padStart(2,'0')}`:'')]=row;});
    const hres={run,aligned_to_ensemble:true,time:hourly.time};
    required.forEach(field=>{hres[field]=doc.members[field][0];});
    ensemble={weerlab_run:run,hourly,latitude:doc.latitude,longitude:doc.longitude,weerlab_hres:hres};
    control={weerlab_run:run,hourly:{time:hourly.time,...Object.fromEntries(required.map(field=>[field,doc.members[field][0]]))}};
    meta={last_run_initialisation_time:Date.parse(run)/1000,data_end_time:times.at(-1)/1000,
      last_run_availability_time:Date.parse(doc.source?.availability||manifest.updated)/1000,last_run_modification_time:Date.parse(manifest.updated)/1000,
      temporal_resolution_seconds:3600};
    state.liveMeta=meta;
    state.archiveManifest=manifest;
    return doc;
  })();
  state.archiveReady=ready;
  // Observe rejection through the page's normal loader, with no unhandled promise.
  ready.catch(()=>{});
  window.WeerlabPlumeRuns={state,
    selectedRunIso:()=>run,selectedMeta:()=>meta,
    refreshSelection:async()=>{await ready;return run;},
    ensureLocation:async(lat,lon)=>{
      await ready;
      if (Math.abs(lat-Number(query.get('lat')))>1e-5 || Math.abs(lon-Number(query.get('lon')))>1e-5) throw new Error('Open een andere plaats via de landelijke top 3.');
      return {archived:true};
    },
    ensureVariables:async fields=>{await ready;if(fields.some(f=>!required.includes(f)))throw new Error('Dit veld ontbreekt in deze landelijke pluim.');},
    fetchFreshMeta:async()=>{await ready;return meta;},
    assertRunResponse:data=>{if(Date.parse(data.weerlab_run)!==Date.parse(run))throw new Error('Modelruns verschillen.');return data;},
  };
  window.fetch=async function(input,init){
    const url=new URL(typeof input==='string'?input:input.url||String(input),location.href);
    if (url.hostname==='ensemble-api.open-meteo.com' && url.pathname.includes('/static/meta.json')) {await ready;return json(meta);}
    if ((url.hostname==='ensemble-api.open-meteo.com'&&url.pathname==='/v1/ensemble') || (url.hostname==='om.weerlab.nl'&&url.pathname==='/om/ensemble')) {await ready;return json(ensemble);}
    if (url.hostname==='single-runs-api.open-meteo.com'&&url.pathname==='/v1/forecast') {await ready;return json(control);}
    return originalFetch(input,init);
  };
  const showContext=()=>{
    const old=document.getElementById('weerlab-run-switcher');if(old)old.hidden=true;
    for (const id of ['stSel','plaatsInput','btnZoek']) {
      const el=document.getElementById(id);if(el){el.disabled=true;el.title='Deze pluim toont de exacte landelijke selectie.';}
    }
    if (document.querySelector('.pluim-top3-exactrun')) return;
    const bar=document.createElement('div');bar.className='pluim-top3-exactrun';
    const link=document.createElement('a'),url=new URL(location.href);
    ['top3_punt','top3_versie','top3_run','top3_lid'].forEach(key=>url.searchParams.delete(key));
    url.searchParams.set('station','De Bilt');url.searchParams.set('lat','52.101');url.searchParams.set('lon','5.178');
    link.href=url.href;link.textContent='Terug naar de landelijke top 3';
    const memberLabel=selectedMember===null ? '' : selectedMember===0 ? ' · uiterste waarde uit de controleberekening' : ` · uiterste waarde uit ensemblelid ${selectedMember}`;
    bar.append(document.createTextNode(`Exacte landelijke pluim · ${token.slice(9)} UTC${memberLabel} · `),link);
    document.querySelector('.toolbar')?.before(bar);
    ready.then(doc=>{const input=document.getElementById('plaatsInput');if(input)input.value=doc.name;}).catch(()=>{});
  };
  if (document.readyState==='loading')document.addEventListener('DOMContentLoaded',showContext,{once:true});else showContext();
  new MutationObserver(()=>{const bar=document.getElementById('weerlab-run-switcher');if(bar)bar.hidden=true;}).observe(document.body,{childList:true});
})();
