'use strict';
const $=id=>document.getElementById(id),layers=['temp','cloud','rain','snow','pressure','fronts','wind','values','maximum'];
let manifest,assetRoot='',days=[],current=0,selection=0;
const cloudNames={total:'Totale bewolking',low:'Lage bewolking',mid:'Middelbare bewolking',high:'Hoge bewolking'};
const cloudColors={total:'#fdfdfd',low:'#a6c9d1',mid:'#c7bddf',high:'#ffffff'};
const maximumFor=day=>manifest.maximumTemperature?.[String(day)]||{points:[],sources:[]};
const localTime=date=>new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',hour:'2-digit',minute:'2-digit'}).format(date);
const validDate=day=>new Date(manifest.frames.find(f=>f.day===day).valid);
const dateText=d=>new Date(d).toLocaleDateString('nl-NL',{timeZone:'Europe/Amsterdam',day:'numeric',month:'long'});
const runText=()=>dateText(manifest.run)+' '+new Date(manifest.run).getUTCHours()+' UTC';
for(const [id,colors] of [['raincolors',['#8fd4ef','#4da9df','#3186d1','#3658b4','#35a88d','#83bd59','#d8cc44','#e99439','#cf4b47']],['snowcolors',['#fbd2e5','#f5a1cc','#ed6eb0','#d63c91','#ad2077','#77115a']]])$(id).innerHTML=colors.map(c=>`<i style="background:${c}"></i>`).join('');
function layerFile(day,k){if(k==='cloud'&&$('cloud-level').value!=='total')return assetRoot+day+'-ukmo-cloud-'+$('cloud-level').value+'.png';return assetRoot+day+(['temp','cloud','rain','snow','pressure'].includes(k)?'-ukmo-':'-')+k+(['pressure','fronts','wind','values','maximum'].includes(k)?'.svg':'.png');}
async function show(i){
 const token=++selection,frame=manifest.frames[i],day=frame.day,date=new Date(frame.valid),time=localTime(date);
 $('note').textContent='Kaartlagen laden…';$('loading-map').hidden=false;$('loading-map').textContent='Kaartlagen laden…';$('download').disabled=true;
 // Preload every layer before changing the displayed day. Never show mixed dates.
 try{
  const paths=layers.filter(k=>(k!=='snow'||manifest.snowAvailable)&&(k!=='fronts'||manifest.frontsAvailable!==false)&&(k!=='maximum'||maximumFor(day).points.length>0)).map(k=>[k,layerFile(day,k)]);
  await Promise.all(paths.map(([,src])=>new Promise((resolve,reject)=>{const image=new Image();const timer=setTimeout(()=>reject(Error('Kaartlaag laden duurt te lang')),15000);image.onload=()=>{clearTimeout(timer);resolve();};image.onerror=()=>{clearTimeout(timer);reject(Error('Ontbrekende kaartlaag'));};image.src=src;})));
  if(token!==selection)return;
  current=i;
  for(const [k,src] of paths){$('layer-'+k).src=src;$('layer-'+k).hidden=!$(k).checked;if(['temp','cloud','rain','snow'].includes(k))$('layer-'+k).srcset=src+' 1x, '+src.replace('.png','@2x.png')+' 2x';}
  $('maximum').disabled=!maximumFor(day).points.length;$('layer-maximum').hidden=!maximumFor(day).points.length||!$('maximum').checked;
  $('fronts').disabled=manifest.frontsAvailable===false;if(manifest.frontsAvailable===false){$('fronts').checked=false;$('layer-fronts').hidden=true;}
  $('snow').disabled=!manifest.snowAvailable;if(!manifest.snowAvailable){$('snow').checked=false;$('layer-snow').hidden=true;}
  document.querySelectorAll('nav button').forEach((b,j)=>b.setAttribute('aria-pressed',String(i===j)));
  $('valid').textContent=date.toLocaleDateString('nl-NL',{timeZone:'Europe/Amsterdam',weekday:'long',day:'numeric',month:'long'})+' · '+time+' uur';
  $('model-stamp').textContent='Weerlagen: UKMO Global · '+runText();
  $('front-stamp').textContent=manifest.frontsAvailable===false?'Fronten: beschikbaar via actuele bronkaart':'Fronten: Met Office / Bracknell · 12 UTC';
  $('values-label').textContent='Temperatuur '+time+' uur';
  $('maximum-stamp').textContent=maximumFor(day).points.length?'Maxima: MOSMIX-stations · '+dateText(date):'MOSMIX-maxima niet beschikbaar voor deze datum';
  $('maximum-key').textContent=maximumFor(day).points.length?'Paars: maximumtemperatuur · MOSMIX-stations · °C':'Geen actuele MOSMIX-maxima voor deze datum';
  const cloud=$('cloud-level').value;
  $('cloud-key').textContent=cloudNames[cloud]+' · UKMO';
  const scale=document.querySelector('.cloud-scale i');scale.style.background='linear-gradient(90deg,#cad8d2,'+cloudColors[cloud]+')';
  $('values-key').textContent='Rood: temperatuur om '+time+' uur · °C';
  $('precip-title').textContent=manifest.snowAvailable?'Regen · mm/uur':'Totale neerslag · mm/uur';
  $('pressure-key').textContent='Isobaren: 4 hPa · H/L: gesloten drukcentrum';
  $('note').textContent=`UKMO Global · ${time} uur (12 UTC) · run ${runText()}. Neerslag: gemiddelde per uur over ${frame.rainInterval}. `+(manifest.snowAvailable?'Sneeuw in roze: water-equivalent.':'Neerslag bevat alle neerslagsoorten; betrouwbare sneeuwuitsplitsing ontbreekt.')+' Fronten en troggen: '+manifest.frontMethod+(maximumFor(day).points.length?' Maximumtemperaturen: DWD MOSMIX TX voor '+dateText(date)+', modelruns '+[...new Set(maximumFor(day).sources.map(s=>s.run.replace('T',' ').replace(':00:00Z',' UTC')))].join(', ')+'. Dit is een dagmaximum, geen temperatuur op 12 UTC.':' Geen actuele MOSMIX-maxima beschikbaar.');
  $('frontimage').src=assetRoot+day+'-front-reference.png';
  $('source-description').textContent=`Bronkaart geldig ${dateText(date)} om 12 UTC. ${manifest.frontMethod} Model- en frontencyclus: ${runText()}. Fronten zijn een meteorologische interpretatie en hoeven niet precies op het modelveld te liggen.`;
  $('source-credit').textContent='Met Office / Bracknell · © Crown Copyright. Modeldata: UK Met Office via Open-Meteo · CC BY-SA 4.0.';
  $('loading-map').hidden=true;$('download').disabled=false;
 }catch(error){if(token===selection){$('note').textContent='Deze kaart kon niet volledig worden geladen. Kies de dag opnieuw om te proberen.';$('loading-map').hidden=false;$('loading-map').textContent='De kaart kon niet worden geladen. Kies hierboven een dag om opnieuw te proberen.';}}
}
for(const k of layers)$(k).onchange=()=>{$('layer-'+k).hidden=!$(k).checked;};
$('cloud-level').onchange=()=>show(current);
$('front').onclick=()=>{const open=$('reference').hidden;$('reference').hidden=!open;$('front').setAttribute('aria-expanded',String(open));if(open)$('reference').scrollIntoView({behavior:'smooth',block:'start'})};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('map-card').requestFullscreen();}catch{$('download-status').textContent='Open deze kaart in een apart venster voor volledig scherm.';}};
document.addEventListener('fullscreenchange',()=>{$('fullscreen').textContent=document.fullscreenElement?'Verkleinen ⛶':'Volledig scherm ⛶';$('fullscreen').setAttribute('aria-pressed',String(!!document.fullscreenElement));});
async function init(){
 try{
  let response;try{response=await fetch('https://data.weerlab.nl/synoptic/current.json',{cache:'no-store',signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('Geen online set');}catch{response=await fetch('current.json',{cache:'no-store'});}if(!response.ok)throw Error('Geen kaartset');manifest=await response.json();
  if(!Array.isArray(manifest.frames)||manifest.frames.length!==5)throw Error('Onvolledige kaartset');
  for(const option of $('cloud-level').options)option.disabled=option.value!=='total'&&!(manifest.cloudLevels||[]).includes(option.value);
  assetRoot=manifest.assetRoot;days=manifest.frames.map(f=>f.day);
  const staticImages=document.querySelectorAll('.map>img:not([id])');staticImages[0].src=assetRoot+'base.svg';staticImages[1].src=assetRoot+'geography.svg';
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam'}).format(new Date());
  manifest.frames.forEach((f,i)=>{const d=new Date(f.valid),b=document.createElement('button');const label=f.valid.slice(0,10)===today?'Vandaag':d.toLocaleDateString('nl-NL',{timeZone:'Europe/Amsterdam',weekday:'long'});b.innerHTML=`<b>${label}</b><span>${dateText(d)} · ${localTime(d)}</span>`;b.onclick=()=>show(i);document.querySelector('nav').append(b)});
  const clockLabels=[...new Set(manifest.frames.map(f=>localTime(new Date(f.valid))))];
  $('localBadge').textContent='/ '+clockLabels.join(' / ')+' UUR';
  const old=Date.now()-Date.parse(manifest.run)>36*3600e3;$('freshness').classList.toggle('stale',old);
  $('freshness').textContent=(old?'Let op: oudere modelrun. ':'')+'Kaartset bijgewerkt '+dateText(manifest.updated)+' om '+localTime(new Date(manifest.updated))+'. Modelrun: '+runText()+'.';
  const todayIndex=manifest.frames.findIndex(f=>f.valid.slice(0,10)>=today);
  await show(Math.max(0,todayIndex));
 }catch(error){$('loading-map').textContent='De kaartset kon niet worden geladen. Vernieuw de pagina om opnieuw te proberen.';$('freshness').textContent='De kaartset is niet beschikbaar. Vernieuw de pagina om opnieuw te proberen.';$('download').disabled=true;}
}
init();
