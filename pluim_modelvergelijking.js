/* Ensemblevergelijking: UTC-as, volledige 6-uurs neerslagvakken, geen opvulling van ontbrekende waarden. */
(function(root){
'use strict';
const PM=typeof module!=='undefined'&&module.exports?require('./pluim_math.js'):root.WeerlabPlumeMath;
const HOUR=3600000, DAY=24*HOUR;
const MODELS=[{id:'ecmwf_ifs025',name:'ECMWF',sources:[['IFS','ecmwf_ifs025_ensemble']]},{id:'gfs_seamless',name:'GFS',sources:[['0,25°','ncep_gefs025'],['0,5°','ncep_gefs05']]},{id:'icon_seamless',name:'ICON',sources:[['Global','dwd_icon_eps'],['EU','dwd_icon_eu_eps']]}];
const FIELDS={cloud_cover:{title:'Totale bewolking',unit:'%'},cloud_cover_high:{title:'Hoge bewolking',unit:'%'},cloud_cover_mid:{title:'Middelbare bewolking',unit:'%'},cloud_cover_low:{title:'Lage bewolking',unit:'%'},temperature_2m:{title:'Temperatuur',unit:'°C'},precipitation:{title:'Neerslag',unit:'mm / 6 uur'},wind_speed_10m:{title:'Wind',unit:'Bft'},wind_gusts_10m:{title:'Windstoten',unit:'km/u'}};
const finite=v=>typeof v==='number'&&Number.isFinite(v);
const utc=t=>Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(t)?t:t+'Z');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function beaufort(kmh){if(!finite(kmh)||kmh<0)return null;const ms=kmh/3.6;return [0.3,1.6,3.4,5.5,8,10.8,13.9,17.2,20.8,24.5,28.5,32.7].filter(n=>ms>=n).length;}
// Beaufort-axis positions from v = 0.836 B^(3/2) m/s; member values stay in km/h.
function bftSpeed(bft){return 3.6*.836*Math.pow(bft,1.5);}
function runLabel(sources){
 if(!sources?.length)return 'Runtijd niet beschikbaar';
 const format=stamp=>{const d=new Date(stamp*1000);return date(+d)+' '+d.toISOString().slice(11,16)+' UTC';};
 if(sources.every(s=>s.meta?.last_run_initialisation_time===sources[0].meta?.last_run_initialisation_time))return 'ENS-run '+format(sources[0].meta.last_run_initialisation_time);
 return 'Bronruns: '+sources.map(s=>s.label+' '+format(s.meta.last_run_initialisation_time)).join(' · ');
}
function metaSignature(sources){return JSON.stringify(sources.map(s=>[s.domain,s.meta.last_run_initialisation_time,s.meta.last_run_modification_time,s.meta.data_end_time]));}
function median(values){const a=values.filter(finite).sort((a,b)=>a-b);if(!a.length)return null;const m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2;}
function series(data,field,start,end){
 const h=data?.hourly||{},times=(h.time||[]).map(utc),keys=Object.keys(h).filter(k=>(k===field||new RegExp('^'+field+'_member\\d+$').test(k))&&Array.isArray(h[k]));
 if(field==='precipitation'){
  const agg=PM.aggregatePrecedingHours(times.map(t=>new Date(t)),keys.map(k=>h[k]),6,{keepInitialZero:false});
  const indices=agg.endDates.map((t,i)=>+t>start&&+t<=end?i:-1).filter(i=>i>=0);
  return {times:indices.map(i=>+agg.endDates[i]),keys,members:agg.members.map(a=>indices.map(i=>a[i]))};
 }
 const indices=times.map((t,i)=>t>=start&&t<=end?i:-1).filter(i=>i>=0);
 return {times:indices.map(i=>times[i]),keys,members:keys.map(k=>indices.map(i=>finite(h[k][i])?h[k][i]:null))};
}
function limits(rows,field){
 if(field.startsWith('cloud_cover'))return [0,100];
 let min=Infinity,max=-Infinity;for(const r of rows)for(const a of r.members)for(const n of a)if(finite(n)){min=Math.min(min,n);max=Math.max(max,n);}
 if(!finite(min))return field==='temperature_2m'?[0,20]:[0,field==='wind_speed_10m'?bftSpeed(4):10];
 if(field==='wind_speed_10m')return [0,Math.max(bftSpeed(4),Math.ceil(max/10)*10)];
 const step=field==='temperature_2m'?5:field==='wind_gusts_10m'?20:[1,2,5,10,20,50,100,200].find(n=>n>=max/5)||Math.ceil(max/5);
 return [field==='temperature_2m'?Math.floor((min-1)/step)*step:0,Math.max(step,Math.ceil((max+(field==='temperature_2m'?1:0))/step)*step)];
}
function path(times,values,x,y){let d='',pen=false;for(let i=0;i<times.length;i++){if(!finite(values[i])){pen=false;continue;}d+=(pen?'L':'M')+x(times[i]).toFixed(1)+','+y(values[i]).toFixed(1);pen=true;}return d;}
const date=t=>new Date(t).toLocaleDateString('nl-NL',{day:'2-digit',month:'2-digit',timeZone:'UTC'});
function panel(r,field,domain,scale,ox,oy,index){
 const w=744,h=278,left=46,top=47,pw=652,ph=160,x=t=>left+(t-domain[0])/(domain[1]-domain[0])*pw,y=v=>top+ph-(v-scale[0])/(scale[1]-scale[0])*ph;
 const cloud=field.startsWith('cloud_cover');
 const info=FIELDS[field],has=r.members.some(a=>a.some(finite)),control=r.keys.indexOf(field);
 let s=`<g transform="translate(${ox},${oy})"><rect width="${w}" height="${h}" fill="#fff" stroke="#aaa"/><text x="${w/2}" y="21" text-anchor="middle" font-size="18" font-weight="700" fill="#1a1a1a">${esc(r.name)} · ${info.title} (${info.unit})</text><text x="${w/2}" y="37" text-anchor="middle" font-size="11" fill="#444">${esc(r.place)} · ${esc(r.runLabel||'Runtijd niet beschikbaar')}</text>`;
 // Same fixed 18–06 local-time shading as the existing six-panel plume;
 // this is a reading aid, not an astronomical sunrise/sunset calculation.
 const localHour=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',hour:'2-digit',hourCycle:'h23'});
 for(let t=domain[0];t<domain[1];t+=HOUR){const hour=Number(localHour.format(new Date(t)));if(hour>=18||hour<6)s+=`<rect x="${x(t)}" y="${top}" width="${x(Math.min(t+HOUR,domain[1]))-x(t)+.05}" height="${ph}" fill="#f0f1f2"/>`;}
 const tickStep=field==='wind_speed_10m'?1:field==='temperature_2m'?5:field==='wind_gusts_10m'?20:([1,2,5,10,20,50,100,200].find(n=>n>=scale[1]/5)||Math.ceil(scale[1]/5));
 const ticks=Math.max(1,Math.round((scale[1]-scale[0])/tickStep));
 const tickValues=field==='wind_speed_10m'?Array.from({length:13},(_,i)=>({v:bftSpeed(i),label:i})).filter(t=>t.v<=scale[1]):Array.from({length:ticks+1},(_,j)=>({v:scale[0]+j/ticks*(scale[1]-scale[0]),label:Number((scale[0]+j/ticks*(scale[1]-scale[0])).toFixed(1))}));
 for(const {v,label} of tickValues){s+=`<path d="M${left},${y(v)}H${left+pw}" stroke="#dfe3e7" stroke-width=".6"/>`;for(const [px,anchor] of [[left-7,'end'],[left+pw+7,'start']])s+=`<text x="${px}" y="${y(v)+4}" text-anchor="${anchor}" font-size="11" fill="#333">${label}</text>`;}

 for(let t=domain[0];t<=domain[1];t+=6*HOUR){const day=new Date(t).getUTCHours()===0;s+=`<path d="M${x(t)},${top}V${top+ph}" stroke="${day?'#9aa6b0':'#e4e7eb'}" stroke-width="${day?'.9':'.4'}"/>`;}
 const days=(domain[1]-domain[0])/DAY,step=days>10?2:1;
 for(let t=domain[0];t<domain[1];t+=step*DAY){const d=new Date(t),px=x(t+DAY/2);s+=`<text x="${px}" y="${top+ph+14}" text-anchor="middle" font-size="12" fill="#333">${['zo','ma','di','wo','do','vr','za'][d.getUTCDay()]}</text><text x="${px}" y="${top+ph+27}" text-anchor="middle" font-size="11" fill="#333">${date(t)}</text>`;}
 if(has){
  s+=`<defs><clipPath id="clip${index}"><rect x="${left}" y="${top}" width="${pw}" height="${ph}"/></clipPath></defs><g clip-path="url(#clip${index})">`;
  if(cloud){
   const interval=r.times.length>1?Math.min(...r.times.slice(1).map((t,i)=>t-r.times[i])):3*HOUR;
   const bw=Math.max(.5,(x(domain[0]+interval)-x(domain[0]))*.72);
   r.times.forEach((t,i)=>{const values=r.members.map(a=>a[i]).filter(finite);if(!values.length)return;
    const med=median(values),lo=PM.quantile(values,.1),hi=PM.quantile(values,.9),px=x(t);
    s+=`<rect data-cloud-bar="${med}" x="${px-bw/2}" y="${y(med)}" width="${bw}" height="${Math.max(.5,y(0)-y(med))}" fill="#688da8"><title>${new Date(t).toISOString().slice(0,16)} UTC · mediaan ${med.toFixed(0)}% · P10–P90 ${lo.toFixed(0)}–${hi.toFixed(0)}%</title></rect><path d="M${px},${y(lo)}V${y(hi)}" stroke="#293f52" stroke-opacity=".65" stroke-width=".7"/>`;
   });
  }else{
  r.members.forEach((a,i)=>{if(i!==control)s+=`<path data-line="member" d="${path(r.times,a,x,y)}" fill="none" stroke="#228b22" stroke-opacity=".62" stroke-width=".65"/>`;});
  const med=r.times.map((_,i)=>median(r.members.map(a=>a[i]))),mean=r.times.map((_,i)=>PM.mean(r.members.map(a=>a[i])));
  s+=`<path data-line="mean" d="${path(r.times,mean,x,y)}" fill="none" stroke="#222" stroke-dasharray="2 3" stroke-width="1.5"/><path data-line="median" d="${path(r.times,med,x,y)}" fill="none" stroke="#df00df" stroke-dasharray="7 4" stroke-width="1.5"/>`;
  if(control>=0)s+=`<path data-line="control" d="${path(r.times,r.members[control],x,y)}" fill="none" stroke="#1515c4" stroke-width="1.5"/>`;
  if(field==='temperature_2m')for(const v of [0,25,30])if(v>=scale[0]&&v<=scale[1])s+=`<path d="M${left},${y(v)}H${left+pw}" stroke="${v===0?'#298ac4':'#cc0000'}" stroke-dasharray="5 3" stroke-width=".9"/><text x="${left+pw-4}" y="${y(v)-4}" font-size="10" font-weight="700" text-anchor="end" fill="${v===0?'#298ac4':'#cc0000'}">${v}°</text>`;
  }
  s+='</g>';
  const last=r.times.reduce((end,t,i)=>r.members.some(a=>finite(a[i]))?t:end,null);
  s+=`<text x="14" y="${h-7}" font-size="9" fill="#666">${r.members.filter(a=>a.some(finite)).length} leden · t/m ${date(last)} ${new Date(last).toISOString().slice(11,16)} UTC</text>`;
  const items=cloud?[['#688da8','','Staaf: mediaan'],['#293f52','','Lijn: P10–P90']]:[...(control>=0?[['#1515c4','',r.name==='ICON'?'Lid 0':'Controle']]:[]),['#228b22','','Verstoorde leden'],['#222','2 3','Gemiddelde'],['#df00df','7 4','Mediaan (P50)']];
  items.forEach(([c,d,label],i)=>{const lx=30+i*178;s+=`<path d="M${lx} 249h24" stroke="${c}" stroke-width="1.4" stroke-dasharray="${d}"/><text x="${lx+30}" y="253" font-size="10" fill="#333">${label}</text>`;});
 }else s+=`<text x="${w/2}" y="${top+ph/2}" text-anchor="middle" font-size="15" fill="#667">${esc(r.error||'Geen ensemblegegevens beschikbaar')}</text>`;
 s+=`<rect x="${left}" y="${top}" width="${pw}" height="${ph}" fill="none" stroke="#444" stroke-width=".8"/>`;
 return s+'</g>';
}
function renderClouds(results,place,start,days){
 const end=start+days*DAY,ecmwf=results.find(r=>r.id==='ecmwf_ifs025'||r.name==='ECMWF')||{name:'ECMWF'},layers=['cloud_cover_high','cloud_cover_mid','cloud_cover_low'];
 let s=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1580 1080" role="img" aria-labelledby="chart-title chart-description" font-family="Arial,sans-serif"><title id="chart-title">${esc(place)} · Bewolking</title><desc id="chart-description">Links totale bewolking van ECMWF, GFS en ICON. Rechts hoge, middelbare en lage bewolking van ECMWF. Staafjes tonen de mediaan, lijnen P10–P90.</desc><rect width="1580" height="1080" fill="white"/><text x="38" y="46" font-size="27" font-weight="700" fill="#20394d">${esc(place)} · Bewolking</text><text x="38" y="73" font-size="13" fill="#617789">${date(start)} – ${date(end)} · ${days} dagen · tijdas UTC · staafjes: mediaan · lijnen: P10–P90</text><text x="38" y="112" font-size="17" font-weight="700" fill="#20394d">Totale bewolking · drie modellen</text><text x="798" y="112" font-size="17" font-weight="700" fill="#20394d">Wolkenlagen · ECMWF</text>`;
 for(let row=0;row<3;row++){
  const model=results[row]||{name:MODELS[row].name};
  for(const [col,r,field] of [[0,model,'cloud_cover'],[1,ecmwf,layers[row]]]){
   const data={...series(r.data,field,start,end),name:r.name,place,runLabel:r.runLabel,error:r.error};
   s+=panel(data,field,[start,end],[0,100],38+col*760,130+row*296,row*2+col);
  }
 }
 return s+'<text x="38" y="1040" font-size="12" fill="#617789">Weerlab · ECMWF / NOAA / DWD via Open-Meteo · alle assen 0–100% bedekkingsgraad</text><text x="38" y="1061" font-size="11" fill="#617789">Hoge bewolking omvat sluierbewolking. De wolkenlagen rechts horen uitsluitend bij ECMWF.</text></svg>';
}
function render(results,view,place,start,days,cloudMode='layers'){
 if(view==='wolken')return renderClouds(results,place,start,days);
 const fields=view==='wolken'?(cloudMode==='total'?['cloud_cover']:['cloud_cover_high','cloud_cover_mid','cloud_cover_low']):view==='wind'?['wind_speed_10m','wind_gusts_10m']:['temperature_2m','precipitation'],end=start+days*DAY;
 const columns=fields.map(f=>results.map(r=>({...series(r.data,f,start,end),name:r.name,place,runLabel:r.runLabel,error:r.error})));
 const width=60+fields.length*760;
 const scales=columns.map((r,i)=>limits(r,fields[i]));
 let s=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} 1080" role="img" aria-labelledby="chart-title chart-description" font-family="Arial,sans-serif"><title id="chart-title">${esc(place)} — ${view==='wolken'?'Bewolking':view==='wind'?'Wind en windstoten':'Temperatuur en neerslag'}: ECMWF, GFS en ICON</title><desc id="chart-description">Drie modelrijen met ${fields.length} grafieken per rij. Groene lijnen zijn verstoorde leden, blauw is controle, zwart gestippeld het gemiddelde en magenta gestreept de mediaan. Ontbrekende waarden blijven leeg.</desc><rect width="${width}" height="1080" fill="white"/><text x="38" y="46" font-size="27" font-weight="700" fill="#20394d">${esc(place)} <tspan font-weight="400" fill="#617789">· ${view==='wolken'?(cloudMode==='total'?'Totale bewolking':'Hoge, middelbare &amp; lage bewolking'):view==='wind'?'Wind &amp; windstoten':'Temperatuur &amp; neerslag'}</tspan></text><text x="38" y="73" font-size="13" fill="#617789">ECMWF · GFS · ICON  |  ${date(start)} – ${date(end)}  |  ${days} dagen · tijdas UTC</text><text x="38" y="101" font-size="12" fill="#555">${view==='wolken'?'Staafjes: mediaan · dunne lijnen: P10–P90 (middelste 80% van de leden)':'Controle · verstoorde leden · gemiddelde · mediaan (P50)'}</text>`;
 for(let row=0;row<3;row++)for(let col=0;col<fields.length;col++)s+=panel(columns[col][row],fields[col],[start,end],scales[col],38+col*760,130+row*296,row*fields.length+col);
 s+='<text x="38" y="1040" font-size="12" fill="#617789">Weerlab · Bron: ECMWF / NOAA / DWD via Open-Meteo · laatst beschikbare gegevens per model</text><text x="38" y="1061" font-size="11" fill="#617789">Gelijke assen · oorspronkelijke modelstappen · ontbrekende gegevens blijven leeg.</text></svg>';
 return s;
}
const api={beaufort,bftSpeed,runLabel,metaSignature,median,series,limits,path,render,utc};
if(typeof module!=='undefined'&&module.exports){module.exports=api;return;}root.PlumeComparison=api;
const cloudMode='overview';
const $=id=>document.getElementById(id),view=['wind','winter','wolken','mist'].includes(new URLSearchParams(location.search).get('view'))?new URLSearchParams(location.search).get('view'):'weer';
document.title=(view==='mist'?'Mistkans':view==='wolken'?'Bewolking':view==='winter'?'Winterpluim':view==='wind'?'Wind & windstoten':'Temperatuur & neerslag')+' · Weerlab';
document.querySelector(`[data-view="${view}"]`).setAttribute('aria-current','page');
let place={name:'De Bilt',lat:52.101,lon:5.178},generation=0,controller,svg='',searchGeneration=0;
try{const p=JSON.parse(sessionStorage.getItem('weerlab-modelpluim-plaats'));if(p&&finite(p.lat)&&finite(p.lon)&&typeof p.name==='string')place=p;}catch{}
function syncPlace(){let o=[...$('station').options].find(o=>o.textContent===place.name&&o.value===`${place.lat},${place.lon}`);if(!o){o=new Option(place.name,`${place.lat},${place.lon}`);$('station').add(o);}$('station').value=o.value;}
async function json(url,signal){const r=await fetch(url,{signal,cache:'no-store'});if(!r.ok)throw new Error('Bron tijdelijk niet bereikbaar');const d=await r.json();if(d.error)throw new Error('Bron levert deze gegevens niet');return d;}
async function modelMetadata(m,signal){
 return Promise.all(m.sources.map(async ([label,domain])=>{
  const meta=await json('https://ensemble-api.open-meteo.com/data/'+domain+'/static/meta.json?_weerlab_meta='+Date.now(),signal);
  if(!Number.isFinite(meta.last_run_initialisation_time)||meta.last_run_initialisation_time<=0||!Number.isFinite(meta.data_end_time)||meta.data_end_time<=meta.last_run_initialisation_time)throw new Error('Runmetadata ontbreekt');
  return {label,domain,meta};
 }));
}
async function modelData(m,base,fields,days,signal){
 for(let attempt=0;attempt<2;attempt++){
  const before=await modelMetadata(m,signal).catch(()=>null);
  const q=new URLSearchParams({latitude:place.lat,longitude:place.lon,models:m.id,hourly:fields,forecast_days:view==='winter'?Math.min(16,days+1):days,wind_speed_unit:'kmh',timezone:'GMT',temporal_resolution:view==='winter'?'hourly':'native',...(view==='winter'?{daily:'temperature_2m_min,temperature_2m_max'}:{}),_weerlab_request:String(Date.now())});
  const data=await json(base+'?'+q,signal);if(!data.hourly?.time?.length)throw new Error('Geen gegevens ontvangen');
  const after=before?await modelMetadata(m,signal).catch(()=>null):null;
  if(before&&after&&metaSignature(before)!==metaSignature(after))continue;
  const available=view==='mist'?root.FogPlume.probabilities(data,-Infinity,Infinity).some(p=>p.n>=2):fields.split(',').some(field=>Object.entries(data.hourly).some(([key,values])=>(key===field||key.startsWith(field+'_member'))&&Array.isArray(values)&&values.some(finite)));
  return {...m,data,available,error:available?null:(view==='mist'?'Geen zicht per ensemblelid beschikbaar in deze bron':view==='wolken'?'Wolkenlagen niet beschikbaar in deze ensemblebron':'Geen geldige modelwaarden beschikbaar'),runLabel:before&&after?runLabel(after):'Runtijd niet beschikbaar'};
 }
 throw new Error('Modelrun wisselt; vernieuw de pluim');
}
async function load(){
 const id=++generation;controller?.abort();controller=new AbortController();const {signal}=controller;const controllerForLoad=controller,timeout=setTimeout(()=>controllerForLoad.abort(),45000);
 $('status').textContent=`Ensembles laden voor ${place.name}…`;$('download').disabled=true;svg='';$('chart').replaceChildren();document.querySelector('.comparison-card').setAttribute('aria-busy','true');
 const days=Number($('days').value),start=Math.floor(Date.now()/DAY)*DAY;
 try{
  const base=location.protocol==='https:'&&/(^|\.)weerlab\.nl$/.test(location.hostname)?'https://om.weerlab.nl/om/ensemble':'https://ensemble-api.open-meteo.com/v1/ensemble';
  const fields=view==='mist'?'visibility':view==='wolken'?'cloud_cover':view==='winter'?'temperature_2m,snowfall,snow_depth':view==='wind'?'wind_speed_10m,wind_gusts_10m':'temperature_2m,precipitation';
  const results=await Promise.all((view==='winter'?MODELS.slice(0,1):MODELS).map(async m=>{
   try{return await modelData(m,base,view==='wolken'&&m.id==='ecmwf_ifs025'?'cloud_cover,cloud_cover_high,cloud_cover_mid,cloud_cover_low':fields,days,signal);}catch(e){return {...m,error:e.name==='AbortError'?'Laden duurde te lang':e.message};}
  }));
  if(id!==generation)return;
  svg=view==='mist'?root.FogPlume.render(results,place.name,start,days):view==='winter'?root.WinterPlume.render(results[0],place.name,start,days):render(results,view,place.name,start,days,cloudMode);$('chart').innerHTML=svg;
  const missing=results.filter(r=>r.error).map(r=>r.name),loaded=results.filter(r=>r.data&&r.available!==false).length;
  $('status').textContent=`${place.name} · ${loaded}/${view==='winter'?1:3} modellen geladen · opgehaald ${new Date().toLocaleTimeString('nl-NL',{hour:'2-digit',minute:'2-digit'})} · ${results.filter(r=>r.data).map(r=>r.name+': '+r.runLabel).join(' | ')}${missing.length?' · Niet beschikbaar: '+missing.join(', ')+(view==='mist'?'. Geen ensemblezicht beschikbaar; geen kans berekend.':view==='wolken'?'. Geen wolkenlaaggegevens ontvangen.':'. Probeer Vernieuw.'):''}`;
  $('download').disabled=!loaded;
 }finally{clearTimeout(timeout);if(id===generation)document.querySelector('.comparison-card').setAttribute('aria-busy','false');}
}
$('station').addEventListener('change',()=>{const [lat,lon]=$('station').value.split(',').map(Number);place={lat,lon,name:$('station').selectedOptions[0].textContent};save();load();});
function save(){try{sessionStorage.setItem('weerlab-modelpluim-plaats',JSON.stringify(place));}catch{}}
$('days').addEventListener('change',load);$('refresh').addEventListener('click',load);
$('controls').addEventListener('submit',async e=>{
 e.preventDefault();const name=$('search').value.trim();if(!name)return;const id=++searchGeneration;$('search-results').replaceChildren();$('search-results').hidden=false;$('search-results').textContent='Plaatsen zoeken…';
 try{const d=await json('https://geocoding-api.open-meteo.com/v1/search?'+new URLSearchParams({name,count:5,language:'nl',format:'json'}),AbortSignal.timeout(15000));if(id!==searchGeneration)return;$('search-results').replaceChildren();if(!d.results?.length)$('search-results').textContent='Geen plaats gevonden.';
 for(const r of d.results||[]){const b=document.createElement('button');b.type='button';b.textContent=[r.name,r.admin1,r.country].filter(Boolean).join(' · ');b.onclick=()=>{place={name:r.name,lat:r.latitude,lon:r.longitude};syncPlace();save();$('search-results').hidden=true;load();};$('search-results').append(b);}}
 catch(e){if(id===searchGeneration)$('search-results').textContent='Plaats zoeken lukt nu niet. Kies een station of probeer opnieuw.';}
});
$('download').onclick=async()=>{
 if(!svg)return;const source=svg,label=place.name,blob=new Blob([source],{type:'image/svg+xml'}),url=URL.createObjectURL(blob);$('download').disabled=true;
 try{const im=new Image();im.src=url;await im.decode();const canvas=document.createElement('canvas');canvas.width=2*Number(/viewBox="0 0 (\d+) 1080"/.exec(source)?.[1]||1580);canvas.height=2160;canvas.getContext('2d').drawImage(im,0,0,canvas.width,canvas.height);const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!png)throw new Error('Export mislukt');const link=document.createElement('a'),downloadURL=URL.createObjectURL(png);link.href=downloadURL;link.download=`weerlab-${view}-${label.replace(/[^a-z0-9-]/gi,'-')}.png`;link.click();setTimeout(()=>URL.revokeObjectURL(downloadURL),1000);}catch(e){$('status').textContent='Download mislukt. Probeer opnieuw.';}finally{URL.revokeObjectURL(url);$('download').disabled=!svg;}
};
if(view==='wolken')document.querySelector('.comparison-note').textContent='Links: totale bewolking van ECMWF, GFS en ICON. Rechts: hoge, middelbare en lage bewolking van ECMWF. Staafjes tonen de mediaan; lijntjes de middelste 80% van de ensembleleden (P10–P90). Alle assen 0–100%.';
if(view==='winter')document.querySelector('.comparison-note').textContent='Etmalen 00–24 UTC. Sneeuw vanaf 0,1 cm; sneeuwdek vanaf 1 cm op enig moment. Vorstkansen tellen koudere temperaturen mee. Alleen volledige etmalen en geldige leden tellen mee.';
if(view==='mist'){document.querySelector('.comparison-card').setAttribute('aria-label','Mistkansen ECMWF, GFS en ICON');document.querySelector('.comparison-note').textContent='Zicht < 1000, < 500, < 250 en < 50 meter. Per tijdstip tellen alleen geldige zichtwaarden in meters mee (minimaal twee leden). De vier kansen overlappen en worden over elkaar getekend. Dit zijn ruwe zichtkansen, geen gevalideerde mistkansen: ook neerslag kan het zicht beperken. ECMWF en ICON leveren momenteel geen ensemblezicht via deze bron.';}
syncPlace();load();
})(typeof window==='undefined'?globalThis:window);
