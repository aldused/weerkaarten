'use strict';
const $=id=>document.getElementById(id),layers=['temp','cloud','rain','snow','pressure','fronts','wind','values'];
let manifest,assetRoot='',days=[],current=0,selection=0;
const localTime=date=>new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',hour:'2-digit',minute:'2-digit'}).format(date);
const validDate=day=>new Date(manifest.frames.find(f=>f.day===day).valid);
const dateText=d=>new Date(d).toLocaleDateString('nl-NL',{timeZone:'Europe/Amsterdam',day:'numeric',month:'long'});
const runText=()=>dateText(manifest.run)+' '+new Date(manifest.run).getUTCHours()+' UTC';
for(const [id,colors] of [['raincolors',['#8fd4ef','#4da9df','#3186d1','#3658b4','#35a88d','#83bd59','#d8cc44','#e99439','#cf4b47']],['snowcolors',['#fbd2e5','#f5a1cc','#ed6eb0','#d63c91','#ad2077','#77115a']]])$(id).innerHTML=colors.map(c=>`<i style="background:${c}"></i>`).join('');
function layerFile(day,k){return assetRoot+day+(['temp','cloud','rain','snow','pressure'].includes(k)?'-ukmo-':'-')+k+(['pressure','fronts','wind','values'].includes(k)?'.svg':'.png');}
async function show(i){
 const token=++selection,frame=manifest.frames[i],day=frame.day,date=new Date(frame.valid),time=localTime(date);
 $('note').textContent='Kaartlagen laden…';$('download').disabled=true;
 // Preload every layer before changing the displayed day. Never show mixed dates.
 try{
  const paths=layers.filter(k=>k!=='snow'||manifest.snowAvailable).map(k=>[k,layerFile(day,k)]);
  await Promise.all(paths.map(([,src])=>new Promise((resolve,reject)=>{const image=new Image();image.onload=resolve;image.onerror=()=>reject(Error('Ontbrekende kaartlaag'));image.src=src;})));
  if(token!==selection)return;
  current=i;
  for(const [k,src] of paths){$('layer-'+k).src=src;$('layer-'+k).hidden=!$(k).checked;if(['temp','cloud','rain','snow'].includes(k))$('layer-'+k).srcset=src+' 1x, '+src.replace('.png','@2x.png')+' 2x';}
  $('snow').disabled=!manifest.snowAvailable;if(!manifest.snowAvailable){$('snow').checked=false;$('layer-snow').hidden=true;}
  document.querySelectorAll('nav button').forEach((b,j)=>b.setAttribute('aria-pressed',String(i===j)));
  $('valid').textContent=date.toLocaleDateString('nl-NL',{timeZone:'Europe/Amsterdam',weekday:'long',day:'numeric',month:'long'})+' · '+time+' uur';
  $('model-stamp').textContent='Weerlagen: UKMO Global · '+runText();
  $('front-stamp').textContent='Fronten: Met Office / Bracknell · 12 UTC';
  $('values-key').textContent='Rood: temperatuur om '+time+' uur · °C';
  $('precip-title').textContent=manifest.snowAvailable?'Regen · mm/uur':'Totale neerslag · mm/uur';
  $('pressure-key').textContent='Isobaren: 4 hPa · H/L: gesloten drukcentrum';
  $('note').textContent=`UKMO Global · ${time} uur (12 UTC) · run ${runText()}. Neerslag: gemiddelde per uur over ${frame.rainInterval}. `+(manifest.snowAvailable?'Sneeuw in roze: water-equivalent.':'Neerslag bevat alle neerslagsoorten; betrouwbare sneeuwuitsplitsing ontbreekt.')+' Fronten en troggen: '+manifest.frontMethod;
  $('frontimage').src=assetRoot+day+'-front-reference.png';
  $('source-description').textContent=`Bronkaart geldig ${dateText(date)} om 12 UTC. ${manifest.frontMethod} Model- en frontencyclus: ${runText()}. Fronten zijn een meteorologische interpretatie en hoeven niet precies op het modelveld te liggen.`;
  $('source-credit').textContent='Met Office / Bracknell · © Crown Copyright. Modeldata: UK Met Office via Open-Meteo · CC BY-SA 4.0.';
  $('download').disabled=false;
 }catch(error){if(token===selection)$('note').textContent='Deze kaart kon niet volledig worden geladen. De vorige kaart blijft staan. Kies de dag opnieuw om te proberen.';}
}
for(const k of layers)$(k).onchange=()=>{$('layer-'+k).hidden=!$(k).checked};
$('front').onclick=()=>{const open=$('reference').hidden;$('reference').hidden=!open;$('front').setAttribute('aria-expanded',String(open));if(open)$('reference').scrollIntoView({behavior:'smooth',block:'start'})};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('map-card').requestFullscreen();}catch{$('download-status').textContent='Open deze kaart in een apart venster voor volledig scherm.';}};
document.addEventListener('fullscreenchange',()=>{$('fullscreen').textContent=document.fullscreenElement?'Verkleinen ⛶':'Volledig scherm ⛶';$('fullscreen').setAttribute('aria-pressed',String(!!document.fullscreenElement));});
async function init(){
 try{
  let response;try{response=await fetch('https://data.weerlab.nl/synoptic/current.json',{cache:'no-store',signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('Geen online set');}catch{response=await fetch('current.json',{cache:'no-store'});}if(!response.ok)throw Error('Geen kaartset');manifest=await response.json();
  if(!Array.isArray(manifest.frames)||manifest.frames.length!==5)throw Error('Onvolledige kaartset');
  assetRoot=manifest.assetRoot;days=manifest.frames.map(f=>f.day);
  const staticImages=document.querySelectorAll('.map>img:not([id])');staticImages[0].src=assetRoot+'base.svg';staticImages[1].src=assetRoot+'geography.svg';
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam'}).format(new Date());
  manifest.frames.forEach((f,i)=>{const d=new Date(f.valid),b=document.createElement('button');const label=f.valid.slice(0,10)===today?'Vandaag':d.toLocaleDateString('nl-NL',{timeZone:'Europe/Amsterdam',weekday:'long'});b.innerHTML=`<b>${label}</b><span>${dateText(d)} · ${localTime(d)}</span>`;b.onclick=()=>show(i);document.querySelector('nav').append(b)});
  $('localBadge').textContent='/ '+localTime(validDate(days[0]))+' UUR';
  const old=Date.now()-Date.parse(manifest.run)>36*3600e3;$('freshness').classList.toggle('stale',old);
  $('freshness').textContent=(old?'Let op: oudere modelrun. ':'')+'Kaartset bijgewerkt '+dateText(manifest.updated)+' om '+localTime(new Date(manifest.updated))+'. Modelrun: '+runText()+'.';
  await show(0);
 }catch(error){$('freshness').textContent='De kaartset is niet beschikbaar. Vernieuw de pagina om opnieuw te proberen.';$('download').disabled=true;}
}
init();
