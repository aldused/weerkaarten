import {createFrameCache,preloadPolicy,preloadTimes} from './frame-cache.js?v=20261127-kaartbuffer';
import {sunshineWindow,sunshineTotalLevels,sunshineTotalColors} from './sunshine.js?v=20261123-zonuren-geler';
import {elevationLabels,freezingLevels,freezingColors} from './height-levels.js';
import {readCatalog} from './data-source.js?v=20261125-gfs-iconeu';
import {cloudBaseLevels,cloudBaseColors,heightLabels} from './cloud-base.js?v=20261122-nulgradenniveau-voet';
import {cloudColor,cloudRgbLegend} from './clouds.js?v=20261123-wolkenlagen-rgb';
import {HOUR,dayKey,validateFeed,comparisonTimes,hasForecastTime,closestIndex} from './forecast-core.js?v=20261122-bereik';
'use strict';
const $ = id => document.getElementById(id);
const iconPaths = {
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  sliders:'<path d="M4 7h7m4 0h5M4 17h3m4 0h9"/><circle cx="13" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  maximize:'<path d="M9 4H4v5m11-5h5v5M4 15v5h5m11-5v5h-5"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  cloud:'<path d="M6 18a4.5 4.5 0 0 1-.3-9 6.5 6.5 0 0 1 12.2 1.8A3.7 3.7 0 1 1 18 18Z"/>',
  thermometer:'<path d="M9 14.5V5a3 3 0 0 1 6 0v9.5a5 5 0 1 1-6 0ZM12 8v9"/><circle cx="12" cy="18" r="1"/>',
  wind:'<path d="M3 8h12a3 3 0 1 0-3-3M3 12h16a2.5 2.5 0 1 1-2.5 2.5M3 16h6a2.5 2.5 0 1 1-2.5 2.5"/>',
  droplet:'<path d="M12 3C9 7 5 11 5 15a7 7 0 0 0 14 0c0-4-4-8-7-12Z"/>',
  link:'<path d="m10 14 4-4m-5 7-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m-2 10a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6l-1 1"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',minus:'<path d="M5 12h14"/>',
  locate:'<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/>',
  play:'<path d="m9 5 10 7-10 7Z" fill="currentColor" stroke="none"/>',
  pause:'<path d="M8 5v14M16 5v14" stroke-width="3"/>',
  previous:'<path d="m14 6-6 6 6 6"/>',next:'<path d="m10 6 6 6-6 6"/>'
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] || ''}</svg>`;
function paintIcons(root=document){root.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));}
paintIcons();
const cards = [
  {model:'harmonie',short:'H43',name:'HARMONIE 43',resolution:'2 km',color:'#147b86'},
  {model:'harmonie46',short:'H46',name:'HARMONIE 46',resolution:'2 km · exp.',color:'#6272b0'},
  {model:'icond2',short:'D2',name:'ICON-D2',resolution:'2,2 km',color:'#b18a39'},
  {model:'ecmwf',short:'IFS',name:'ECMWF IFS',resolution:'0,1°',color:'#3f8471'}
];
const definitions = {...Object.fromEntries(cards.map(c=>[c.model,{...c}])),arome:{model:'arome',short:'AROME',name:'AROME HD 1.3',resolution:'1,3 km',color:'#8b6bae'},ukv:{model:'ukv',short:'UKV',name:'UKMO UKV 2 km',resolution:'2 km',color:'#bb9338'},
 gfs:{model:'gfs',short:'GFS',name:'GFS',resolution:'0,25°',color:'#4673a0'},
 iconeu:{model:'iconeu',short:'EU',name:'ICON-EU',resolution:'ca. 7 km',color:'#9d6947'}
};
const cloudRamp=which=>Array.from({length:11},(_,i)=>'rgb('+cloudColor(...[0,1,2].map(n=>n===which?i*10:0)).join(',')+')');
const isCloudLayer=layer=>['clouds','cloudRgb','cloudHigh','cloudMiddle','cloudLow'].includes(layer);
const catalogModeFor=layer=>layer==='cloudBase'?'cloudbase':isCloudLayer(layer)?'clouds':'standard';
const layers={cloudBase:'Wolkenbasis',clouds:'Bewolking H/M/L',cloudRgb:'Wolkenlagen (RGB)',cloudHigh:'Hoge bewolking',cloudMiddle:'Middelbare bewolking',cloudLow:'Lage bewolking',vis:'Zicht',td2m:'Dauwpunt',windchill:'Gevoelstemperatuur',rate:'Neerslag',weather:'Significant weer',t2m:'Temperatuur',ws:'Wind',gust:'Windstoten',ptot:'Neerslagsom',ptypeMap:'Neerslagtype',t850:'Temperatuur 850 hPa',t500:'Temperatuur 500 hPa',frz:'0 °C-niveau',sdep:'Sneeuwhoogte',sun:'Zonduur',sunTotal:'Zonuren · dagsom'};
const units={cloudBase:'m / ft',clouds:'%',cloudRgb:'%',cloudHigh:'%',cloudMiddle:'%',cloudLow:'%',vis:'m / km',td2m:'°C',windchill:'°C',rate:'mm/u',weather:'°C / mm/u',t2m:'°C',t850:'°C',t500:'°C',ws:'Bft',gust:'km/u',ptot:'mm',frz:'m / ft',sdep:'cm',sun:'min/uur',sunTotal:'uur',ptypeMap:''};
const MODEL_KEYS=Object.keys(definitions);
const state={index:0,layer:'weather',sync:true,playing:false,catalogs:null,times:[],timeMode:'common',followNow:true,catalogMode:'standard'};
const timeFormatter=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const dateFormatter=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',weekday:'long',day:'numeric',month:'long'});
const shortDateFormatter=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',weekday:'short',day:'numeric',month:'short'});
const runFormatter=new Intl.DateTimeFormat('nl-NL',{timeZone:'UTC',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const currentTime=()=>new Date(state.times[state.index]??Date.now());
const details=()=>({values:$('show-values').checked,province:$('provinces').checked,direction:$('arrows').checked,pressure:$('pressure').checked,fog:$('fog').checked});
const actualLegends = new Map();
let lastLegend;
const policy=()=>preloadPolicy(navigator.connection,navigator.deviceMemory,matchMedia('(max-width: 700px)').matches);
const readAsset=createFrameCache((policy().limited?8:24)*1024**2,24,
 payload=>Object.values(payload).reduce((bytes,frame)=>bytes+2*frame.length,0),
 async (url,signal,priority)=>{
   const response=await fetch(url,{signal:AbortSignal.any([signal,AbortSignal.timeout(12000)]),priority});
   if(!response.ok)throw Error('Live modelbestand niet beschikbaar');
   return response.json();
 });
window.readVierluikAsset=(url,signal,priority)=>readAsset(url,url,signal,priority);
window.hasVierluikAsset=readAsset.has;
const frameReady=[];
let presented=null,selectionVersion=0,activeLoad=null,warmLoad=null,selectionTimer,warmTimer,busyTimer;
let direction=1;
const runDateFormatter=new Intl.DateTimeFormat('nl-NL',{timeZone:'UTC',day:'numeric',month:'short'});
function cancelWarm(){
 clearTimeout(warmTimer);warmLoad?.controller.abort();warmLoad=null;
}
function markBusy(){
 clearTimeout(busyTimer);
 busyTimer=setTimeout(()=>{$('maps').classList.add('updating');$('map-progress').hidden=false;},180);
}
function clearBusy(){
 clearTimeout(busyTimer);$('maps').classList.remove('updating');$('map-progress').hidden=true;
}
function stopSelection(){
 selectionVersion++;clearTimeout(selectionTimer);activeLoad?.abort();activeLoad=null;cancelWarm();
}
function warmFrames(selections){
 if(warmLoad)return;
 clearTimeout(warmTimer);
 const limit=policy();
 if(document.hidden||!limit.ahead)return;
 // Daily sums may need an entire day's source grids. Only prepare the next
 // sum, and only while playing.
 const times=preloadTimes(state.times,state.index,direction,limit,state.playing);
 const daily=selections[0].layer==='sunTotal';
 if(!times.length||(daily&&!state.playing))return;
 warmTimer=setTimeout(async ()=>{
   const controller=new AbortController(),start=state.index;
   const load={controller,selections,index:start};warmLoad=load;
   const signal=controller.signal;
   const ordered=selections.map((selection,i)=>({selection,i}));
   const maps=$('maps');
   ordered.sort((a,b)=>Math.abs($(`card-${a.i}`).offsetLeft-maps.scrollLeft-maps.offsetLeft)-
     Math.abs($(`card-${b.i}`).offsetLeft-maps.scrollLeft-maps.offsetLeft));
   try{
     if(!limit.limited&&!daily){
       await Promise.all(ordered.map(({selection,i})=>
         $(`frame-${i}`).contentWindow.preloadVierluikAssets(selection,times.slice(0,3),signal)));
     }
     for(const [offset,time] of (daily?times.slice(0,1):times).entries()){
       const decode=offset<(state.playing?4:3);
       // Native sources can need multiple range requests for one forecast hour.
       const serial=[], parallel=[];
       for(const {selection,i} of ordered){
         const map=$(`frame-${i}`).contentWindow;
         const warm=()=>map.preloadVierluikMap(selection,time,signal,decode);
         if(limit.limited||selection.feed.runs[0].native)serial.push(warm);
         else parallel.push(warm);
       }
       if(signal.aborted||activeLoad)return;
       await Promise.all(parallel.map(warm=>warm()));
       for(const warm of serial){if(signal.aborted||activeLoad)return;await warm();}
       await new Promise(resolve=>setTimeout(resolve,25));
     }
   }finally{
     if(warmLoad===load){
       warmLoad=null;
       if(!activeLoad&&presented&&state.index!==start)warmFrames(presented.selections);
     }
   }
 },state.playing?0:limit.delay);
}
function requestSelection(debounce=0){
 const version=++selectionVersion;
 clearTimeout(selectionTimer);clearTimeout(warmTimer);markBusy();
 if(catalogModeFor(state.layer)!==state.catalogMode||!state.catalogs)return;
 const cached=makeSelections().every((selection,i)=>
   $(`frame-${i}`)?.contentWindow?.isVierluikMapCached?.(selection));
 if(debounce&&!cached)selectionTimer=setTimeout(()=>prepareSelection(version),debounce);
 else prepareSelection(version,cached);
}
function makeSelections(){
 const stamp=currentTime().getTime();
 return cards.map(({model})=>({model,layer:state.layer,time:stamp,feed:state.catalogs[model],sunStart:state.sunStart}));
}
async function prepareSelection(version,cached=false){
 if(version!==selectionVersion||!state.times.length||!state.catalogs||catalogModeFor(state.layer)!==state.catalogMode)return;
 const oldLoad=activeLoad,oldWarm=warmLoad,controller=new AbortController(),signal=controller.signal;
 activeLoad=controller;
 const selections=makeSelections();
 const pending=selections.map(async (selection,i)=>{
   const frame=await frameReady[i];
   signal.throwIfAborted();
   return frame.prepareVierluikMap(selection,signal);
 });
 // Let identical forecast assets join the new selection before releasing the
 // preceding one, including assets serving several adjacent hours.
 const sameSource=oldWarm?.selections.every((prior,i)=>prior.feed===selections[i].feed&&prior.layer===selections[i].layer);
 if(oldWarm&&(!sameSource||(!cached&&Math.abs(state.index-oldWarm.index)>3))){
   warmLoad=null;
   setTimeout(()=>oldWarm.controller.abort(),0);
 }
 setTimeout(()=>oldLoad?.abort(),0);
 try{
   const ready=await Promise.all(pending);
   if(version!==selectionVersion)return;
   const results=ready.map((prepared,i)=>$(`frame-${i}`).contentWindow.presentVierluikMap(prepared));
   presented={selections,timeMode:state.timeMode};
   for(const [i,result] of results.entries())updatePresentedCard(i,selections[i],result);
   updateMobileTabs();
   const firstReady=results.find(result=>result.ready);
   if(firstReady)actualLegends.set(state.layer,firstReady.legend);
   else actualLegends.delete(state.layer);
   updatePresentedTime();
   const priorLayer=$('legend-title').dataset.layer;
   if(priorLayer!==state.layer||state.layer==='sunTotal'||lastLegend!==firstReady?.legend){
     lastLegend=firstReady?.legend;$('legend-title').dataset.layer=state.layer;
     renderLegend();
   }
   clearBusy();
   warmFrames(selections);
   if(state.playing)scheduleNext();
 }catch(error){
   if(version!==selectionVersion)return;
   clearBusy();showToast('De kaarten konden niet worden bijgewerkt. Probeer opnieuw te verversen.');
   console.error(error);
 }finally{if(activeLoad===controller)activeLoad=null;}
}
function updatePresentedTime(){
 const time=new Date(presented.selections[0].time);
 const date=dateFormatter.format(time),iso=time.toISOString();
 $('valid-clock').textContent=timeFormatter.format(time);$('valid-clock').dateTime=iso;
 $('valid-date').textContent=date[0].toUpperCase()+date.slice(1);
 $('time-scope').textContent=presented.timeMode==='all'?'GEKOZEN TIJD':'GELDIG OP ALLE KAARTEN';
 const count=presented.selections.filter(s=>hasForecastTime(s.feed,time.getTime())).length;
 $('time-range-summary').textContent=presented.timeMode==='all'?`${count}/4 modellen op dit tijdstip · ontbrekende uren blijven leeg`:'Alleen tijden die in alle gekozen modellen voorkomen';
}
function command(index,values){const frame=$(`frame-${index}`);frame?.contentWindow?.postMessage({type:'map-command',sunStart:state.sunStart,...values},location.origin);}
function broadcast(values,except=-1){cards.forEach((c,i)=>{if(i!==except)command(i,values);});}
function showToast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>$('toast').hidden=true,2800);}
function showInfo(title,html){$('info-title').textContent=title;$('info-body').innerHTML=html;$('info-dialog').showModal();}
function updatePresentedCard(index,selection,result){
 const d=definitions[selection.model],layer=selection.layer,run=new Date(selection.feed.runs[0].time);
 const card=$(`card-${index}`),time=card.querySelector('.card-time');
 card.style.setProperty('--model',d.color);card.querySelector('.model-mark').textContent=d.short;
 card.querySelector('.resolution').textContent=d.resolution;
 card.querySelector('.run-label').textContent=`Run ${runDateFormatter.format(run)} ${runFormatter.format(run)} UTC`;
 card.querySelector('iframe').title=d.name+': '+layers[layer];
 const period=layer==='gust'?result.period:null,baseKind=layer==='cloudBase'?result.cloudBaseKind:null;
 card.querySelector('.map-label-text').textContent=layers[layer]+(baseKind==='ceiling'?' · ceiling >50%':
   baseKind==='ukv_cbh'?' · ≥2,5 oktas':period?` · ${period} uur`:layer==='sun'&&result.sunSourceHours>1?' · uurgemiddelde':'');
 card.querySelector('.layer-unit').textContent=units[layer];
 card.querySelector('.lead-time').textContent=result.ready?`T+${Math.round((selection.time-run)/HOUR)} u`:'';
 if(!card.classList.contains('focused'))card.querySelector('.card-expand').setAttribute('aria-label',`${d.name} vergroten`);
 time.classList.remove('loading');
 time.classList.toggle('error',result.failed);time.classList.toggle('missing',result.missing&&!result.failed);
 time.textContent=result.failed?'Kaart tijdelijk niet beschikbaar':result.missing?'Geen gegevens voor dit tijdstip':
   `${shortDateFormatter.format(selection.time)} · ${timeFormatter.format(selection.time)}`;
}
function updateMobileTabs(){document.querySelectorAll('.mobile-models button').forEach((b,i)=>{const d=definitions[presented.selections[i].model];b.textContent=d.short;b.style.setProperty('--model',d.color);b.setAttribute('aria-label',`Spring naar kaart ${i+1}: ${d.name}`);b.setAttribute('aria-controls',`card-${i}`);});}
function setActive(i){const maps=$('maps'),card=$(`card-${i}`);maps.scrollTo({left:card.offsetLeft-maps.offsetLeft,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
function buildCards(){
 $('maps').innerHTML=cards.map((c,i)=>`<article class="map-card" id="card-${i}" style="--model:${c.color}" aria-label="Modelkaart ${i+1}"><header class="card-header"><span class="model-mark" aria-hidden="true">${c.short}</span><div class="model-picker"><label class="sr" for="model-${i}">Model voor kaart ${i+1}</label><select class="model-select" id="model-${i}">${Object.entries(definitions).map(([key,d])=>`<option value="${key}" ${key===c.model?'selected':''} ${state.catalogs[key]?'':'disabled'}>${d.name}</option>`).join('')}</select><div class="model-meta"><span class="resolution">${c.resolution}</span><span class="run-label"></span></div></div><button class="icon-button card-expand" aria-label="${c.name} vergroten" title="Deze kaart vergroten">${icon('maximize')}</button></header><div class="map-window"><iframe id="frame-${i}" title="${c.name}: ${layers[state.layer]}" src="map.html?v=20261127-neerslagtype&id=${i}&model=${c.model}#model=${c.model}&kaart=weather" loading="eager"></iframe><div class="map-label"><span class="map-label-text">Significant weer</span><span class="layer-unit"></span></div></div><div class="card-bottom"><span class="card-time loading">Kaart laden…</span><span class="lead-time"></span></div></article>`).join('');
 document.querySelector('.mobile-models').innerHTML=cards.map((c,i)=>`<button data-card="${i}">${c.short}</button>`).join('');
 cards.forEach((c,i)=>{
   const frame=$(`frame-${i}`);
   frameReady[i]=new Promise((resolve,reject)=>{
     const timeout=setTimeout(()=>reject(Error('Kaartweergave startte niet')),15000);
     const loaded=()=>{
       if(!frame.contentWindow.prepareVierluikMap)return;
       clearTimeout(timeout);frame.removeEventListener('load',loaded);
       frame.contentWindow.setVierluikOptions(details());
       resolve(frame.contentWindow);
     };
     frame.addEventListener('load',loaded);loaded();
   });
   $(`model-${i}`).addEventListener('change',e=>{const prior=currentTime().getTime();const previous=c.model;c.model=e.target.value;
     try{updateComparison(prior,false);if(refreshing){refreshing.controller.abort();refreshing=null;refreshCatalogs();}}
     catch(error){c.model=previous;e.target.value=previous;showToast(error.message);}});
   $(`card-${i}`).querySelector('.card-expand').addEventListener('click',()=>toggleFocus(i));
 });
 document.querySelectorAll('[data-card]').forEach(b=>b.onclick=()=>setActive(Number(b.dataset.card)));
 const resizeNavigation=()=>{document.querySelector('.mobile-models').hidden=$('maps').scrollWidth<=$('maps').clientWidth+2;};
 new ResizeObserver(resizeNavigation).observe($('maps'));resizeNavigation();
}
function toggleFocus(index){const card=$(`card-${index}`),active=card.classList.contains('focused');document.querySelectorAll('.map-card.focused').forEach(c=>c.classList.remove('focused'));card.classList.toggle('focused',!active);const b=card.querySelector('.card-expand');b.innerHTML=icon(active?'maximize':'close');b.setAttribute('aria-label',active?`${definitions[cards[index].model].name} vergroten`:'Vergrote kaart sluiten');if(!active){b.focus();showToast('Gebruik de kaart om te zoomen of lokale waarden te bekijken.');}}
function renderDays(){
 const days=[...new Set(state.times.map(dayKey))],today=dayKey(Date.now()),tomorrow=dayKey(Date.now()+HOUR*24),selected=dayKey(currentTime());
 document.querySelector('.day-switch').replaceChildren(...days.map(key=>{
  const date=new Date(state.times.find(t=>dayKey(t)===key)),b=document.createElement('button');b.type='button';
  const label=key===today?'Vandaag':key===tomorrow?'Morgen':new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',weekday:'short'}).format(date);
  b.dataset.date=key;b.textContent=label;const small=document.createElement('small');small.textContent=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',day:'numeric',month:'short'}).format(date);b.append(' ',small);
  b.setAttribute('aria-label',shortDateFormatter.format(date));b.classList.toggle('active',key===selected);b.setAttribute('aria-pressed',String(key===selected));b.onclick=()=>{stop();setTime(state.times.findIndex(t=>dayKey(t)===key));};return b;
 }));
}
function renderHours(){
 const selectedDay=dayKey(currentTime());
 $('hours').replaceChildren(...state.times.flatMap((stamp,i)=>{
  if(dayKey(stamp)!==selectedDay)return [];const date=new Date(stamp),b=document.createElement('button');b.type='button';b.textContent=timeFormatter.format(date);b.dataset.hour=i;b.setAttribute('aria-label',shortDateFormatter.format(date)+' '+timeFormatter.format(date));b.setAttribute('aria-pressed',String(i===state.index));b.classList.toggle('active',i===state.index);b.onclick=()=>{stop();setTime(i);};return [b];
 }));
 const current=$('hours').querySelector('.active');if(current){const left=current.offsetLeft-$('hours').offsetLeft,right=left+current.offsetWidth;if(left<$('hours').scrollLeft)$('hours').scrollLeft=left;else if(right>$('hours').scrollLeft+$('hours').clientWidth)$('hours').scrollLeft=right-$('hours').clientWidth;}
}
let dayButtonsFor,hourButtonsFor,hourDay,activeHour,activeDay;
function setTime(index,{followNow=false,send=true,debounce=0,move=0}={}){
 if(!state.times.length||!Number.isFinite(Number(index)))return;
 const target=Math.max(0,Math.min(state.times.length-1,Number(index))),previous=state.index;
 state.followNow=followNow;state.index=target;direction=move||Math.sign(target-previous)||direction;
 $('time-slider').max=state.times.length-1;$('time-slider').value=target;
 $('time-slider').style.setProperty('--progress',`${target/Math.max(1,state.times.length-1)*100}%`);
 const time=currentTime(),day=dayKey(time);
 $('time-slider').setAttribute('aria-valuetext',`${dateFormatter.format(time)} ${timeFormatter.format(time)}`);
 $('prev').disabled=target===0;$('next').disabled=target===state.times.length-1;
 if(dayButtonsFor!==state.times){
   renderDays();dayButtonsFor=state.times;
   activeDay=document.querySelector('.day-switch .active');
 }else if(day!==dayKey(state.times[previous])){
   const next=[...document.querySelectorAll('.day-switch button')].find(b=>b.dataset.date===day);
   activateTimeButton(activeDay,next);activeDay=next;
 }
 if(hourButtonsFor!==state.times||hourDay!==day){
   renderHours();hourButtonsFor=state.times;hourDay=day;
   activeHour=$('hours').querySelector('.active');
 }else{
   const next=$('hours').querySelector(`[data-hour="${target}"]`);
   activateTimeButton(activeHour,next);activeHour=next;
   const strip=$('hours');
   if(next){
     const left=next.offsetLeft-strip.offsetLeft,right=left+next.offsetWidth;
     if(left<strip.scrollLeft)strip.scrollLeft=left;
     else if(right>strip.scrollLeft+strip.clientWidth)strip.scrollLeft=right-strip.clientWidth;
   }
 }
 if(send&&(target!==previous||document.querySelector('.card-time.error')))requestSelection(debounce);
}
function activateTimeButton(previous,next){
 if(previous===next)return;
 previous?.classList.remove('active');previous?.setAttribute('aria-pressed','false');
 next?.classList.add('active');next?.setAttribute('aria-pressed','true');
}
function updateComparison(stamp=Date.now(),followNow=state.followNow){
 const times=comparisonTimes(state.catalogs,cards.map(c=>c.model),state.timeMode);if(!times.length)throw Error('Geen gezamenlijke actuele geldigheid beschikbaar.');
 state.sunStart=Math.max(...cards.map(c=>Date.parse(state.catalogs[c.model].runs[0].steps[0].valid)));
 state.times=times;if(!$('frame-0'))buildCards();setTime(closestIndex(times,stamp),{followNow,send:false});
 requestSelection();
}

function setLayer(layer){
 if(!layers[layer]||layer===state.layer)return;
 stop();state.layer=layer;$('layer-select').value=layer;
 $('values-explanation').textContent=['weather','ptypeMap'].includes(layer)?'Temperatuur °C · neerslag mm/u':layers[layer]+' · '+units[layer];
 const mode=catalogModeFor(layer);
 if(mode!==state.catalogMode||!state.catalogs){stopSelection();markBusy();refreshCatalogs();}
 else{
   if(refreshing&&refreshing.mode!==mode){refreshing.controller.abort();refreshing=null;$('refresh-data').disabled=false;}
   requestSelection();
 }
}
function scale(name,colors,ticks){return `<div class="scale-group"><div class="scale-name">${name}</div><div class="scale">${colors.map(c=>`<i style="background:${c}"></i>`).join('')}</div><div class="ticks">${ticks.map(t=>`<span>${t}</span>`).join('')}</div></div>`;}
function heightScale(name,colors,levels,format){
  const ticks=levels.map((level,i)=>{
    const [meters,feet]=format(level);
    const prefix=i===levels.length-1?'≥':'';
    return `<span>${prefix}${meters}<small>${prefix}${feet}</small></span>`;
  });
  return `<div class="scale-group height-legend"><div class="scale-name">${name}</div>
    <div class="scale">${colors.map(color=>`<i style="background:${color}"></i>`).join('')}</div>
    <div class="height-ticks" style="--height-tick-count:${ticks.length}">${ticks.join('')}</div></div>`;
}
function renderLegend(){
 const layer=presented?.selections[0].layer||state.layer;
 $('legend-title').textContent=layers[layer];let html='';
 const types='<div class="type-key"><span><i class="swatch" style="--swatch:rgb(26,155,102)"></i>Regen</span><span><i class="swatch" style="--swatch:rgb(86,100,225)"></i>Sneeuw</span><span><i class="swatch" style="--swatch:rgb(79,168,235)"></i>Natte sneeuw</span><span><i class="swatch" style="--swatch:rgb(128,63,196)"></i>Mix</span><span><i class="swatch" style="--swatch:rgb(224,35,113)"></i>IJzel</span><span><i class="swatch" style="--swatch:rgb(245,129,24)"></i>IJsregen</span><span><i class="swatch" style="--swatch:rgb(178,141,23)"></i>Korrelhagel</span><span><i class="swatch" style="--swatch:rgb(25,123,181)"></i>Type onbekend</span></div>';
 switch(layer){
 case 'cloudBase':html='<div class="scale-group height-legend"><div class="scale-name">Boven de grond · m / ft · gearceerd: geen diagnose</div><div class="scale">'+cloudBaseColors.map(c=>'<i style="background:'+c+'"></i>').join('')+'</div><div class="height-ticks">'+cloudBaseLevels.map(v=>{const labels=heightLabels(v);return '<span>'+labels[0]+'<small>'+labels[1]+'</small></span>';}).join('')+'</div></div>';break;
 case 'cloudRgb':
   html='<div class="type-key">'+cloudRgbLegend.map(([label,color])=>
     `<span><i class="swatch" style="--swatch:${color}"></i>${label}</span>`
   ).join('')+'</div>';
   break;
 case 'clouds':html=scale('Hoog · blauw',cloudRamp(0),['0%','50%','100%'])+scale('Midden · geel',cloudRamp(1),['0%','50%','100%'])+scale('Laag · rood',cloudRamp(2),['0%','50%','100%']);break;
 case 'cloudHigh':case 'cloudMiddle':case 'cloudLow':html=scale(layers[layer]+' · bedekking',cloudRamp(({cloudHigh:0,cloudMiddle:1,cloudLow:2})[layer]),['0%','50%','100%']);break;
 case 'weather':html=scale('Totale bewolking',['#faf7ef','#e5e6e4','#c5cbd1','#a9b0b9','#939da9'],['0%','25%','50%','75%','100%'])+scale('Neerslagintensiteit · mm/u',Array.from({length:7},(_,i)=>'rgb('+[26,155,102].map(c=>Math.round(c*.83+(1-i/6)*115)).join(',')+')'),['0,05','0,2','0,5','1','2','5','≥10'])+types;break;
 case 'ptypeMap':html=types;break;
 case 'vis':html=scale('Zicht · m / km',['#764f91','#ab779e','#ddb18c','#f2d58c','#c5dbb5','#94c7c7','#b5d9e8','#e7f1f7'],['0 m','200 m','500 m','1 km','2 km','5 km','10 km','≥20 km']);break;
 case 'rate':html=scale('Neerslagintensiteit · mm/u',['#eef2f5','#d4eefe','#a5e1f7','#6bcbf4','#32afe9','#258acb','#3269b7','#7851b2','#ca46a1'],['0','0,1','0,5','1','2','5','10','20','≥50']);break;
 case 'td2m':case 'windchill':case 't2m':case 't850':case 't500':html=scale('Temperatuur · °C',['#57258d','#397ad5','#99cefa','#d0edff','#c3ecae','#76c585','#50ad72','#d8dd71','#ffde64','#f2a443','#e5653b'],['−20','−5','0','5','10','15','20','25','30']);break;
 case 'ws':html=scale('Windkracht · Bft',['#edf4fc','#c5e5fa','#8bd4ed','#49b8be','#55b384','#98c15b','#d4cc54','#f3bb54','#f3914f','#e55d4a','#c84362','#ac267a','#7c236f'],Array.from({length:13},(_,i)=>String(i)));break;
 case 'gust':html=scale('Windsnelheid · km/u',['#edf4fc','#c5e5fa','#8bd4ed','#49b8be','#55b384','#98c15b','#d4cc54','#f3bb54','#f3914f','#e55d4a','#ac267a'],['0','10','20','30','40','50','60','70','80','100','130']);break;
 case 'ptot':html=scale('Neerslagsom sinds de eigen modelstart · mm',['#eef2f5','#d4eefe','#a5e1f7','#6bcbf4','#32afe9','#258acb','#3269b7','#7851b2','#ca46a1','#e76465','#faba62'],['0','0,5','1','2','5','10','20','50','100','200']);break;
 case 'sdep':html=scale('Sneeuwhoogte · cm',['#f3f5f6','#e1f4ff','#c4ebff','#9fddfc','#76c5f2','#4d9bdf','#3672ca','#7851b2'],['0','0,5','1','2','5','10','20','50']);break;
 case 'frz':html=heightScale('Boven zeeniveau · m / ft',freezingColors,freezingLevels,elevationLabels);break;
 case 'sunTotal':{
   const window=sunshineWindow(presented?.selections[0].time,presented?.selections[0].sunStart);
   const since=window?' vanaf '+window.clock:'';
   html=scale('Zonuren'+since+' tot gekozen tijd · uur',sunshineTotalColors,sunshineTotalLevels.map(String));
   break;
 }
 case 'sun':html=scale('Zonduur · minuten per uur',['#697889','#a2a7a7','#c1b995','#ddc58a','#f3d17e','#ffdd70','#ffeb61'],['0','10','20','30','40','50','60']);break;
 }
 $('legend-content').classList.remove('native-summary');
 if(!['weather','ptypeMap','sun','sunTotal','clouds','cloudRgb','cloudHigh','cloudMiddle','cloudLow','cloudBase','frz'].includes(layer)&&actualLegends.has(layer)){
   const holder=document.createElement('div');holder.innerHTML=actualLegends.get(layer);
   const bar=holder.querySelector('.scale'),ticks=holder.querySelector('.scale-ticks');
   if(bar&&ticks)html=`<div class="scale-group"><div class="scale-name">${layers[layer]} · ${units[layer]}</div>${bar.outerHTML}${ticks.outerHTML}</div>`;
   else {html=holder.innerHTML;$('legend-content').classList.add('native-summary');}
 }
 $('legend-content').innerHTML=html;
}
let animation,animationStarted=0;
function stop(){clearTimeout(animation);animation=null;animationStarted=0;state.playing=false;$('play').innerHTML=icon('play');$('play').setAttribute('aria-label','Animatie starten');}
function advance(){
 if(!state.playing)return;
 if(state.times.length<2){stop();return;}
 animation=null;animationStarted=performance.now();
 setTime((state.index+1)%state.times.length,{move:1});
}
function scheduleNext(){
 clearTimeout(animation);
 const interval=Number($('speed').value);
 const elapsed=animationStarted?performance.now()-animationStarted:0;
 animation=setTimeout(advance,Math.max(interval/2,interval-elapsed));
}
function togglePlay(){
 if(state.playing){stop();return;}
 if(!presented||state.times.length<2)return;
 state.playing=true;direction=1;$('play').innerHTML=icon('pause');$('play').setAttribute('aria-label','Animatie pauzeren');
 if(!activeLoad&&presented.selections[0].time===currentTime().getTime()&&presented.selections[0].layer===state.layer){
   warmFrames(presented.selections);scheduleNext();
 }
}
let lastView='',viewTimer;
window.addEventListener('message',e=>{
 if(e.origin!==location.origin)return;
 const id=cards.findIndex((_,i)=>$(`frame-${i}`)?.contentWindow===e.source);if(id<0)return;
 const d=e.data;
 if(d.type==='map-view'&&state.sync){
   const k=JSON.stringify(d.view);if(k===lastView)return;lastView=k;clearTimeout(viewTimer);viewTimer=setTimeout(()=>broadcast({view:d.view},id),30);
 }else if(d.type==='map-step'){stop();setTime(state.index+d.delta,{debounce:24});}
 else if(d.type==='map-play')togglePlay();
 else if(d.type==='map-close'){if($(`card-${id}`).classList.contains('focused'))toggleFocus(id);}
});
$('time-mode').onchange=e=>{
 const previous=state.timeMode,stamp=currentTime().getTime();stop();state.timeMode=e.target.value;
 if(state.catalogs)try{updateComparison(stamp,false);}catch(error){state.timeMode=previous;e.target.value=previous;showToast(error.message);}
};
$('layer-select').onchange=e=>setLayer(e.target.value);$('show-values').onchange=()=>broadcast({details:details()});
$('prev').onclick=()=>{stop();setTime(state.index-1);};$('next').onclick=()=>{stop();setTime(state.index+1);};$('time-slider').oninput=e=>{stop();setTime(e.target.value,{debounce:33});};$('play').onclick=togglePlay;$('speed').onchange=()=>{if(state.playing&&animation)scheduleNext();};
$('zoomout').onclick=()=>broadcast({zoom:1/1.25});$('zoomin').onclick=()=>broadcast({zoom:1.25});$('reset').onclick=()=>broadcast({reset:true});
$('sync').onclick=()=>{state.sync=!state.sync;$('sync').classList.toggle('active',state.sync);$('sync').setAttribute('aria-pressed',String(state.sync));$('sync').querySelector('span:last-child').textContent=state.sync?'Gekoppeld':'Los';if(state.sync){lastView='';broadcast({reset:true});}showToast(state.sync?'Zoomen en verschuiven zijn gekoppeld.':'Elke kaart kan nu afzonderlijk worden verschoven.');};
$('settings').onclick=()=>$('options-dialog').showModal();['provinces','arrows','pressure','fog'].forEach(id=>$(id).onchange=()=>broadcast({details:details()}));
$('fullscreen').onclick=async()=>{if(parent!==window){parent.postMessage({type:'weerlab-fullscreen-toggle'},location.origin);return;}try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{showToast('Gebruik de beeldvullende modus van je browser.');}};
const demoInfo='<p>Zonuren telt de zonduur in Nederlandse tijd op tot het gekozen uur. Op een dag met beperkte dekking begint de som op het eerste tijdstip dat alle gekozen runs bestrijken. Een deel van een meeruursvak wordt naar tijdsduur meegerekend op basis van het gemiddelde van dat vak.</p><p>Wolkenbasis wordt getoond in meters en voeten boven de grond. ICON-D2 toont ceiling bij meer dan 50% laagbedekking; UKV de basis vanaf 2,5 oktas. De eigen bronrun staat boven de kaart. Diagnosecodes en de bovengrenswaarde 20.000 m worden zonder hoogte weergegeven. Gearceerd betekent geen bruikbare diagnose; mist is daarbij niet uitgesloten. ICON-EU gebruikt de ceiling van DWD. AROME en GFS leveren hier geen wolkenbasis.</p><p>Wolkenlagen (RGB) mengt lage bewolking in rood, middelbare in groen en hoge in blauw. Helder is zwart. Volledige bedekking in alle drie de lagen is wit.</p><p>Bewolking H/M/L gebruikt de afzonderlijke bronvelden: hoog in blauw, midden in geel en laag in rood. De drie percentages staan als H/M/L op vaste locaties. Kies Hoge, Middelbare of Lage bewolking om één laag los te bekijken. Deze kaarten gebruiken de nieuwste wolkenrun; de run staat boven iedere kaart. ECMWF-tussenuren zijn geïnterpoleerd.</p><p>Extra modellen: AROME HD 1.3 (Météo-France, Licence Ouverte 2.0) en UKMO UKV 2 km (British Crown copyright, Met Office, CC BY-SA 4.0). Bronvelden worden naar hetzelfde kaartrooster als de overige modellen vertaald. UKV gebruikt schermtemperatuur op 1,5 meter. AROME levert geen zichtveld aan; ook andere ontbrekende bronlagen krijgen een melding.</p><p>GFS gebruikt NOAA-data op 0,25°. ICON-EU gebruikt DWD-data op het Europese rooster van circa 7 km. Voor ICON-EU worden velden met drie-uurlijkse stappen na +78 uur per uur geïnterpoleerd. De neerslag uit een drie-uursvak wordt daarbij gelijk over de uren verdeeld.</p><p>De compacte bediening geeft de kaarten meer ruimte. Bij significant weer staan temperatuur en neerslag als getallen op vaste locaties; bij andere kaartlagen zie je de waarde van die laag. De uurknoppen onder de slider werken zoals in het oude vierluik.</p><p>Dit vierluik gebruikt de <b>oorspronkelijke kaartweergave van Modelkaarten Benelux</b>: dezelfde geografische ondergrond, kleuren, windpijlen en modelberekeningen. Plaatsnamen zijn weggelaten.</p><p>Dit vierluik haalt bij openen de nieuwste modelruns op en controleert elke 90 seconden opnieuw zolang de pagina zichtbaar is. Kies Gelijke tijden voor de gezamenlijke geldige uren, of Volledig bereik · HARMONIE voor alle beschikbare uren van de gekozen modellen. Buiten het bereik van een model blijft die kaart leeg; er wordt geen ander tijdstip getoond. Bij een tijdelijke storing blijven reeds geladen kaarten staan en wordt de fout vermeld. ECMWF-velden tussen bronstappen worden volgens de bestaande kaartcode geïnterpoleerd.</p><p>Alle kaarten volgen dezelfde lokale tijd. De modelruns en verwachtingstermijnen kunnen verschillen. De vier kaarten staan altijd naast elkaar. Op een smal scherm schuif je horizontaal of gebruik je de modelknoppen om naar een kaart te springen. De kaarten blijven daarbij groot en leesbaar.</p><p>Sleep om te verschuiven, gebruik + en − om te zoomen, of tik op een plek voor lokale waarden.</p>';
$('help').onclick=$('snapshot-info').onclick=()=>showInfo('Jouw live vierluik',demoInfo);$('close-info').onclick=()=>$('info-dialog').close();
$('legend-info').onclick=()=>showInfo(layers[presented?.selections[0].layer||state.layer],'<p>Dezelfde kleur betekent op alle vier de kaarten dezelfde waarde. Bij significant weer toont grijs de bewolking; de neerslagkleur geeft het type aan en de tint de intensiteit. De volledige type- en kleurschaal staat hieronder.</p><div id="native-legend"></div><p>Windstoten hebben de bronperiode van het model. Neerslagsommen beginnen bij de eigen modelstart. Zonduur wordt altijd getoond in minuten per uur (0–60). Bij een bronperiode van 3 of 6 uur staat er een uurgemiddelde; de bron geeft dan geen exacte verdeling per uur. Vergelijk deze sommen en maxima daarom met hun tijdvak in gedachten.</p>');
// Neem de legenda en bronuitleg van de eerste kaart over.
$('legend-info').addEventListener('click',()=>{
  try {
    const map = $('frame-0').contentDocument;
    const target = $('native-legend');
    target.innerHTML = map.getElementById('legend').innerHTML;
    target.append(map.getElementById('legend-note').cloneNode(true));
  } catch {}
});
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
document.addEventListener('keydown',e=>{if(['SELECT','INPUT','TEXTAREA'].includes(e.target.tagName)||document.querySelector('dialog[open]'))return;if(e.key==='Escape'){const card=document.querySelector('.map-card.focused');if(card)toggleFocus(Number(card.id.split('-')[1]));}else if(e.key==='ArrowLeft'){e.preventDefault();stop();setTime(state.index-1,{debounce:24});}else if(e.key==='ArrowRight'){e.preventDefault();stop();setTime(state.index+1,{debounce:24});}else if(e.code==='Space'&&e.target.tagName!=='BUTTON'){e.preventDefault();togglePlay();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();cancelWarm();}});

let refreshing=null,lastSignature='',optionalLoad=null,optionalTimer;
function fetchFeeds(keys,mode,signal){
 return Promise.allSettled(keys.map(async key=>{
   const input=AbortSignal.any([signal,AbortSignal.timeout(15000)]);
   return [key,validateFeed(await readCatalog(key,mode,input),key)];
 }));
}
function refreshOptions(mode,selected,controller){
 clearTimeout(optionalTimer);
 const load=async ()=>{
   if(controller.signal.aborted||state.catalogMode!==mode)return;
   if(activeLoad||!presented){optionalTimer=setTimeout(load,350);return;}
   const results=await fetchFeeds(MODEL_KEYS.filter(key=>!selected.includes(key)),mode,controller.signal);
   if(controller.signal.aborted||state.catalogMode!==mode||optionalLoad!==controller)return;
   const feeds=Object.fromEntries(results.filter(r=>r.status==='fulfilled').map(r=>r.value));
   const chosen=[...new Set(cards.map(c=>c.model))];
   state.catalogs={...feeds,...Object.fromEntries(chosen.map(key=>[key,state.catalogs[key]]))};
   document.querySelectorAll('.model-select option').forEach(option=>{option.disabled=!state.catalogs[option.value];});
 };
 optionalTimer=setTimeout(load,350);
}
async function refreshCatalogs(){
 const mode=catalogModeFor(state.layer);
 if(refreshing?.mode===mode)return refreshing.promise;
 refreshing?.controller.abort();optionalLoad?.abort();clearTimeout(optionalTimer);
 const controller=new AbortController();
 const selected=[...new Set(cards.map(c=>c.model))];
 $('refresh-data').disabled=true;
 const promise=(async()=>{
  try{
   const results=await fetchFeeds(selected,mode,controller.signal);
   if(controller.signal.aborted||mode!==catalogModeFor(state.layer))return;
   const unavailable=results.findIndex(r=>r.status==='rejected');
   if(unavailable>=0)throw Error(definitions[selected[unavailable]].name+': '+results[unavailable].reason?.message);
   const catalogs=Object.fromEntries(results.map(r=>r.value));
   const signature=mode+JSON.stringify(selected.map(k=>[k,catalogs[k].updated,catalogs[k].runs[0].id]));
   const stamp=state.followNow?Math.floor(Date.now()/HOUR)*HOUR:currentTime().getTime();
   const nextTimes=comparisonTimes(catalogs,cards.map(c=>c.model),state.timeMode);
   if(!nextTimes.length)throw Error('Geen gezamenlijke actuele geldigheid beschikbaar.');
   if(signature!==lastSignature||JSON.stringify(nextTimes)!==JSON.stringify(state.times)
     ||presented?.selections[0].layer!==state.layer||document.querySelector('.card-time.error')){
    const previous=state.catalogMode===mode?state.catalogs:null;
    state.catalogMode=mode;state.catalogs={...previous,...catalogs};lastSignature=signature;
    updateComparison(stamp,state.followNow);
    document.querySelectorAll('.model-select option').forEach(option=>{option.disabled=!state.catalogs[option.value];});
   }
   optionalLoad=controller;
   refreshOptions(mode,selected,controller);
   $('snapshot-info').dataset.checkedAt=new Date().toISOString();$('snapshot-info').textContent='Live · gecontroleerd '+timeFormatter.format(new Date());$('snapshot-info').classList.remove('error');$('snapshot-info').title='Automatische controle elke 90 seconden; modelruns staan boven de kaarten.';
  }catch(error){
   if(controller.signal.aborted)return;
   clearBusy();
   $('snapshot-info').textContent='Verversen mislukt · probeer opnieuw';$('snapshot-info').classList.add('error');$('snapshot-info').title=error.message;
   if(!state.catalogs)$('maps').innerHTML='<p class="feed-error">De actuele modelgegevens zijn tijdelijk niet bereikbaar. Gebruik de verversknop om opnieuw te proberen.</p>';
  }finally{
   if(refreshing?.controller===controller){$('refresh-data').disabled=false;refreshing=null;}
  }
 })();
 refreshing={mode,controller,promise};return promise;
}
$('refresh-data').onclick=()=>refreshCatalogs();
renderLegend();
$('maps').innerHTML='<p class="feed-error">Nieuwste modelruns ophalen…</p>';
refreshCatalogs();
setInterval(()=>{if(!document.hidden)refreshCatalogs();},90000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshCatalogs();});

