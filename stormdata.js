'use strict';
(()=>{
 const primary='https://data.weerlab.nl/stormdagen/current.json';let pending=null,cached=null,lastFetch=0;
 const date=value=>new Date(value.length===10?value+'T12:00:00Z':value).toLocaleString('nl-NL',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric',...(value.length===10?{}:{hour:'2-digit',minute:'2-digit'})});
 let rollingData=null;
 const number=v=>v.toLocaleString('nl-NL',{minimumFractionDigits:1,maximumFractionDigits:2});
 function topFive(data){
  const body=document.getElementById('rolling-top-rows'),note=document.getElementById('rolling-top-note');if(!body)return;
  const rows=StormWindCore.top(data.rolling_wind);body.replaceChildren();
  note.textContent=rows.length?`${rows.length} hoogste complete complete klokuurgemiddelden · metingen maximaal 100 minuten oud · tijden UTC.`:'Geen complete, recente metingen beschikbaar voor de top 5. Verouderde metingen tellen niet mee.';
  rows.forEach((r,i)=>{
   const tr=document.createElement('tr'),name=data.stations.find(s=>s.station===r.station)?.name||String(r.station),trend=Number.isFinite(r.previous_mean_ms)?r.mean_ms-r.previous_mean_ms:null;
   const cells=[String(i+1),name,number(r.mean_ms)+' m/s',number(r.mean_ms*3.6)+' km/u',r.storm_reached?'Stormgrens bereikt':number(Math.max(0,20.5-r.mean_ms))+' m/s onder grens',trend===null?'—':Math.abs(trend)<.05?'→ Gelijk':(trend>0?'↑ +':'↓ −')+number(Math.abs(trend))+' m/s',date(r.end_utc)];
   cells.forEach((text,index)=>{const td=document.createElement('td');if(index===1){const button=document.createElement('button');button.type='button';button.textContent=text;button.onclick=()=>{document.getElementById('rolling-station').value=String(r.station);rolling(data);};td.append(button);}else td.textContent=text;tr.append(td);});
   body.append(tr);
  });
 }
 function rolling(data){
  topFive(data);
  rollingData=data;
  const menu=document.getElementById('rolling-station'),value=document.getElementById('rolling-value'),windowLabel=document.getElementById('rolling-window');
  if(!menu||!value)return;
  const chosen=menu.value||'225';
  menu.replaceChildren(...data.stations.filter(s=>s.last_fhx).sort((a,b)=>a.name.localeCompare(b.name,'nl')).map(s=>new Option(s.name,String(s.station))));
  menu.value=chosen;if(!menu.value)menu.selectedIndex=0;
  menu.onchange=()=>rolling(rollingData);
  const row=data.rolling_wind?.find(r=>String(r.station)===menu.value);
  if(!row){value.textContent='Geen klokuurgemiddelde beschikbaar voor dit station.';windowLabel.textContent='Er worden geen ontbrekende metingen ingevuld.';return;}
  const stale=Date.now()-Date.parse(row.end_utc)>100*60000;
  windowLabel.textContent=`Uurvak ${date(row.start_utc)} – ${date(row.end_utc)} UTC · ${row.samples}/6 metingen${stale?' · verouderd':''}.`;
  if(row.samples!==6||!Number.isFinite(row.mean_ms)){value.textContent='Onvolledig uurvak: geen klokuurgemiddelde berekend.';return;}
  const delta=20.5-row.mean_ms,trend=Number.isFinite(row.previous_mean_ms)?row.mean_ms-row.previous_mean_ms:null;
  value.textContent=`${stale?'Laatste beschikbare meting: ':''}${number(row.mean_ms)} m/s · ${number(row.mean_ms*3.6)} km/u. ${!row.storm_reached?number(Math.max(0,delta))+' m/s onder de stormgrens.':'Stormgrens bereikt in dit vaste uurvak.'}${trend===null?'':' Ten opzichte van het vorige klokuur: '+(Math.abs(trend)<.05?'vrijwel gelijk':(trend>0?'stijgend met ':'dalend met ')+number(Math.abs(trend))+' m/s')+'.'}`;
 }
 function status(data){
  rolling(data);
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
