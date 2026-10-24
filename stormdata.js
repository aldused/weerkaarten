'use strict';
(()=>{
 const primary='https://data.weerlab.nl/stormdagen/current.json';let pending=null,cached=null,lastFetch=0;
 const date=value=>new Date(value.length===10?value+'T12:00:00Z':value).toLocaleString('nl-NL',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric',...(value.length===10?{}:{hour:'2-digit',minute:'2-digit'})});
 function status(data){
  const checked=data.last_checked_utc||data.generated_utc,latest=data.latest_hour_utc;
  const words=[`Automatische controle iedere ${data.auto_refresh_minutes||15} minuten.`,`Dagarchief t/m ${date(data.archive_latest_date||data.latest_date)} (UTC).`];
  if(latest)words.push(`Recente complete uren t/m ${date(latest)} UTC; de recente aanvulling is voorlopig.`);
  words.push(`Laatste geslaagde controle: ${date(checked)} UTC.`);
  if(data._snapshot)words.unshift('De actuele bron is tijdelijk niet bereikbaar; dit is de opgeslagen kopie.');
  else if(Date.now()-Date.parse(checked)>90*60000)words.unshift('De automatische update loopt achter.');
  if(latest&&Date.now()-Date.parse(latest)>3*3600000)words.push('De nieuwste complete winduren in dit overzicht zijn ouder dan drie uur.');
  for(const id of ['live-status','updated']){const el=document.getElementById(id);if(el)el.textContent=words.join(' ')}
  const peak=document.getElementById('recent-peak'),r=data.recent_peak;
  if(peak){peak.textContent=r?`Hoogste uurgemiddelde in de laatste 24 beschikbare uren binnen de stationselectie: ${(r.value/10).toLocaleString('nl-NL',{maximumFractionDigits:1})} m/s · ${data.stations.find(s=>s.station===r.station)?.name||r.station} · uur eindigend ${date(r.end_utc)} UTC${r.source==='ten-minute-complete'?' (voorlopig berekend uit zes volledige tienminutenmiddelen)':''}. ${r.value>=205?'De stormgrens is bereikt.':'Onder de stormgrens van 20,5 m/s.'}`:''}
  const download=document.getElementById('data-download');if(download)download.href=data._snapshot?'stormdagen_data.json':primary;
 }
 async function json(url){const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('HTTP '+r.status);const data=await r.json();if(!data.stations?.length||!data.years?.length||!data.latest_date)throw Error('Onvolledig stormbestand');return data}
 window.loadStormData=async(force=false)=>{
  if(pending)return pending;if(cached&&!force&&Date.now()-lastFetch<60000)return cached;
  pending=(async()=>{let data;try{data=await json(primary+'?t='+Date.now())}catch{data=await json('stormdagen_data.json');data._snapshot=true}cached=data;lastFetch=Date.now();status(data);window.dispatchEvent(new CustomEvent('stormdata',{detail:data}));return data})();
  try{return await pending}finally{pending=null}
 };
 const refresh=()=>{if(!document.hidden)window.loadStormData(true).catch(()=>{const e=document.getElementById('live-status');if(e)e.textContent='Nieuwe gegevens konden niet worden geladen. De vorige metingen blijven zichtbaar.'})};
 setInterval(refresh,15*60000);document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastFetch>5*60000)refresh()});window.addEventListener('focus',()=>{if(Date.now()-lastFetch>5*60000)refresh()});
})();
