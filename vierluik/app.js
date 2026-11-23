import {elevationLabels,freezingLevels,freezingColors} from './height-levels.js';
import {readCatalog} from './data-source.js?v=20261122-bereik';
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
const definitions = {...Object.fromEntries(cards.map(c=>[c.model,{...c}])),arome:{model:'arome',short:'AROME',name:'AROME HD 1.3',resolution:'1,3 km',color:'#8b6bae'},ukv:{model:'ukv',short:'UKV',name:'UKMO UKV 2 km',resolution:'2 km',color:'#bb9338'}};
const cloudRamp=which=>Array.from({length:11},(_,i)=>'rgb('+cloudColor(...[0,1,2].map(n=>n===which?i*10:0)).join(',')+')');
const isCloudLayer=layer=>['clouds','cloudRgb','cloudHigh','cloudMiddle','cloudLow'].includes(layer);
const catalogModeFor=layer=>layer==='cloudBase'?'cloudbase':isCloudLayer(layer)?'clouds':'standard';
const layers={cloudBase:'Wolkenbasis',clouds:'Bewolking H/M/L',cloudRgb:'Wolkenlagen (RGB)',cloudHigh:'Hoge bewolking',cloudMiddle:'Middelbare bewolking',cloudLow:'Lage bewolking',vis:'Zicht',td2m:'Dauwpunt',windchill:'Gevoelstemperatuur',rate:'Neerslag',weather:'Significant weer',t2m:'Temperatuur',ws:'Wind',gust:'Windstoten',ptot:'Neerslagsom',ptypeMap:'Neerslagtype',t850:'Temperatuur 850 hPa',t500:'Temperatuur 500 hPa',frz:'0 °C-niveau',sdep:'Sneeuwhoogte',sun:'Zonduur'};
const units={cloudBase:'m / ft',clouds:'%',cloudRgb:'%',cloudHigh:'%',cloudMiddle:'%',cloudLow:'%',vis:'m / km',td2m:'°C',windchill:'°C',rate:'mm/u',weather:'°C / mm/u',t2m:'°C',t850:'°C',t500:'°C',ws:'Bft',gust:'km/u',ptot:'mm',frz:'m / ft',sdep:'cm',sun:'min/uur',ptypeMap:''};
const MODEL_KEYS=Object.keys(definitions);
const state={index:0,layer:'weather',sync:true,playing:false,models:null,catalogs:null,times:[],timeMode:'common',followNow:true,catalogMode:'standard'};
const timeFormatter=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const dateFormatter=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',weekday:'long',day:'numeric',month:'long'});
const shortDateFormatter=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',weekday:'short',day:'numeric',month:'short'});
const runFormatter=new Intl.DateTimeFormat('nl-NL',{timeZone:'UTC',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const currentTime=()=>new Date(state.times[state.index]??Date.now());
const details=()=>({values:$('show-values').checked,province:$('provinces').checked,direction:$('arrows').checked,pressure:$('pressure').checked,fog:$('fog').checked});
const actualLegends = new Map();
function command(index,values){const frame=$(`frame-${index}`);frame?.contentWindow?.postMessage({type:'map-command',...values},location.origin);}
function broadcast(values,except=-1){cards.forEach((c,i)=>{if(i!==except)command(i,values);});}
function showToast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>$('toast').hidden=true,2800);}
function showInfo(title,html){$('info-title').textContent=title;$('info-body').innerHTML=html;$('info-dialog').showModal();}
function updateCardHeader(index){
 const c=cards[index],d=definitions[c.model],m=state.models[c.model],card=$(`card-${index}`);
 card.style.setProperty('--model',d.color);card.querySelector('.model-mark').textContent=d.short;
 card.querySelector('.resolution').textContent=d.resolution;card.querySelector('.run-label').textContent=`Run ${new Intl.DateTimeFormat('nl-NL',{timeZone:'UTC',day:'numeric',month:'short'}).format(new Date(m.run))} ${runFormatter.format(new Date(m.run))} UTC`;
 card.querySelector('.model-select').value=c.model;card.querySelector('.map-label-text').textContent=layers[state.layer];
 card.querySelector('.layer-unit').textContent=units[state.layer];card.querySelector('.lead-time').textContent=`T+${Math.round((currentTime()-Date.parse(m.run))/3600000)} u`;
 card.querySelector('.card-expand').setAttribute('aria-label',`${d.name} vergroten`);
 updateMobileTabs();
}
function updateMobileTabs(){document.querySelectorAll('.mobile-models button').forEach((b,i)=>{const d=definitions[cards[i].model];b.textContent=d.short;b.style.setProperty('--model',d.color);b.setAttribute('aria-label',`Spring naar kaart ${i+1}: ${d.name}`);b.setAttribute('aria-controls',`card-${i}`);});}
function setActive(i){const maps=$('maps'),card=$(`card-${i}`);maps.scrollTo({left:card.offsetLeft-maps.offsetLeft,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}
function buildCards(){
 $('maps').innerHTML=cards.map((c,i)=>`<article class="map-card" id="card-${i}" style="--model:${c.color}" aria-label="Modelkaart ${i+1}"><header class="card-header"><span class="model-mark" aria-hidden="true">${c.short}</span><div class="model-picker"><label class="sr" for="model-${i}">Model voor kaart ${i+1}</label><select class="model-select" id="model-${i}">${Object.entries(definitions).map(([key,d])=>`<option value="${key}" ${key===c.model?'selected':''} ${state.catalogs[key]?'':'disabled'}>${d.name}</option>`).join('')}</select><div class="model-meta"><span class="resolution">${c.resolution}</span><span class="run-label"></span></div></div><button class="icon-button card-expand" aria-label="${c.name} vergroten" title="Deze kaart vergroten">${icon('maximize')}</button></header><div class="map-window"><iframe id="frame-${i}" title="${c.name}: ${layers[state.layer]}" src="map.html?v=20261123-wolkenlagen-rgb&id=${i}&model=${c.model}#model=${c.model}&kaart=weather" loading="eager"></iframe><div class="map-label"><span class="map-label-text">Significant weer</span><span class="layer-unit"></span></div></div><div class="card-bottom"><span class="card-time loading">Kaart laden…</span><span class="lead-time"></span></div></article>`).join('');
 document.querySelector('.mobile-models').innerHTML=cards.map((c,i)=>`<button data-card="${i}">${c.short}</button>`).join('');
 cards.forEach((c,i)=>{
   updateCardHeader(i);
   $(`frame-${i}`).addEventListener('load',()=>command(i,{catalogs:state.catalogs,model:c.model,time:currentTime().toISOString(),layer:state.layer,details:details()}));
   $(`model-${i}`).addEventListener('change',e=>{const prior=currentTime().getTime();c.model=e.target.value;updateComparison(prior,false);});
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
  b.textContent=label;const small=document.createElement('small');small.textContent=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',day:'numeric',month:'short'}).format(date);b.append(' ',small);
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
function setTime(index,{followNow=false,send=true}={}){
 if(!state.times.length)return;
 state.followNow=followNow;state.index=Math.max(0,Math.min(state.times.length-1,Number(index)));
 $('time-slider').max=state.times.length-1;$('time-slider').value=state.index;$('time-slider').style.setProperty('--progress',`${state.index/Math.max(1,state.times.length-1)*100}%`);
 const time=currentTime();$('valid-clock').textContent=timeFormatter.format(time);$('valid-clock').dateTime=time.toISOString();const date=dateFormatter.format(time);$('valid-date').textContent=date[0].toUpperCase()+date.slice(1);
 $('time-slider').setAttribute('aria-valuetext',`${date} ${timeFormatter.format(time)}`);$('prev').disabled=state.index===0;$('next').disabled=state.index===state.times.length-1;
 renderDays();renderHours();
 const count=cards.filter(c=>hasForecastTime(state.catalogs?.[c.model],time.getTime())).length;
 $('time-scope').textContent=state.timeMode==='all'?'GEKOZEN TIJD':'GELDIG OP ALLE KAARTEN';
 $('time-range-summary').textContent=state.timeMode==='all'?`${count}/4 modellen op dit tijdstip · ontbrekende uren blijven leeg`:'Alleen tijden die in alle gekozen modellen voorkomen';
 if(state.models)cards.forEach((_,i)=>{updateCardHeader(i);const t=$(`card-${i}`).querySelector('.card-time');t.classList.add('loading');t.textContent='Kaart laden…';loadingCards.add(i);});
 if(send)broadcast({time:time.toISOString()});
}
function updateComparison(stamp=Date.now(),followNow=state.followNow){
 const times=comparisonTimes(state.catalogs,cards.map(c=>c.model),state.timeMode);if(!times.length)throw Error('Geen gezamenlijke actuele geldigheid beschikbaar.');
 state.times=times;if(!$('frame-0'))buildCards();setTime(closestIndex(times,stamp),{followNow,send:false});
 cards.forEach((c,i)=>command(i,{catalogs:state.catalogs,model:c.model,time:currentTime().toISOString(),layer:state.layer,details:details()}));
}

function setLayer(layer){if(!layers[layer])return;state.layer=layer;$('layer-select').value=layer;$('values-explanation').textContent=['weather','ptypeMap'].includes(layer)?'Temperatuur °C · neerslag mm/u':layers[layer]+' · '+units[layer];if(state.models)cards.forEach((c,i)=>{updateCardHeader(i);$(`frame-${i}`).title=`${definitions[c.model].name}: ${layers[layer]}`;});const switching=catalogModeFor(layer)!==state.catalogMode;broadcast({layer,...(switching?{pending:true}:{time:currentTime().toISOString()})});renderLegend();if(switching){stop();refreshCatalogs();}}
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
 $('legend-title').textContent=layers[state.layer];let html='';
 const types='<div class="type-key"><span><i class="swatch" style="--swatch:rgb(26,155,102)"></i>Regen</span><span><i class="swatch" style="--swatch:rgb(86,100,225)"></i>Sneeuw</span><span><i class="swatch" style="--swatch:rgb(79,168,235)"></i>Natte sneeuw</span><span><i class="swatch" style="--swatch:rgb(128,63,196)"></i>Mix</span><span><i class="swatch" style="--swatch:rgb(224,35,113)"></i>IJzel</span><span><i class="swatch" style="--swatch:rgb(245,129,24)"></i>IJsregen</span><span><i class="swatch" style="--swatch:rgb(25,123,181)"></i>Type onbekend</span></div>';
 switch(state.layer){
 case 'cloudBase':html='<div class="scale-group height-legend"><div class="scale-name">Boven de grond · m / ft · gearceerd: geen diagnose</div><div class="scale">'+cloudBaseColors.map(c=>'<i style="background:'+c+'"></i>').join('')+'</div><div class="height-ticks">'+cloudBaseLevels.map(v=>{const labels=heightLabels(v);return '<span>'+labels[0]+'<small>'+labels[1]+'</small></span>';}).join('')+'</div></div>';break;
 case 'cloudRgb':
   html='<div class="type-key">'+cloudRgbLegend.map(([label,color])=>
     `<span><i class="swatch" style="--swatch:${color}"></i>${label}</span>`
   ).join('')+'</div>';
   break;
 case 'clouds':html=scale('Hoog · blauw',cloudRamp(0),['0%','50%','100%'])+scale('Midden · geel',cloudRamp(1),['0%','50%','100%'])+scale('Laag · rood',cloudRamp(2),['0%','50%','100%']);break;
 case 'cloudHigh':case 'cloudMiddle':case 'cloudLow':html=scale(layers[state.layer]+' · bedekking',cloudRamp(({cloudHigh:0,cloudMiddle:1,cloudLow:2})[state.layer]),['0%','50%','100%']);break;
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
 case 'sun':html=scale('Zonduur · minuten per uur',['#697889','#a2a7a7','#c1b995','#ddc58a','#f3d17e','#ffdd70','#ffeb61'],['0','10','20','30','40','50','60']);break;
 }
 $('legend-content').classList.remove('native-summary');
 if(!['weather','ptypeMap','sun','clouds','cloudRgb','cloudHigh','cloudMiddle','cloudLow','cloudBase','frz'].includes(state.layer)&&actualLegends.has(state.layer)){
   const holder=document.createElement('div');holder.innerHTML=actualLegends.get(state.layer);
   const bar=holder.querySelector('.scale'),ticks=holder.querySelector('.scale-ticks');
   if(bar&&ticks)html=`<div class="scale-group"><div class="scale-name">${layers[state.layer]} · ${units[state.layer]}</div>${bar.outerHTML}${ticks.outerHTML}</div>`;
   else {html=holder.innerHTML;$('legend-content').classList.add('native-summary');}
 }
 $('legend-content').innerHTML=html;
}
let animation,loadingCards=new Set();
function stop(){clearTimeout(animation);state.playing=false;$('play').innerHTML=icon('play');$('play').setAttribute('aria-label','Animatie starten');}
function advance(){if(!state.playing)return;if(loadingCards.size){animation=setTimeout(advance,150);return;}setTime(state.index===state.times.length-1?0:state.index+1);animation=setTimeout(advance,Number($('speed').value));}
function togglePlay(){if(state.playing){stop();return;}state.playing=true;$('play').innerHTML=icon('pause');$('play').setAttribute('aria-label','Animatie pauzeren');animation=setTimeout(advance,Number($('speed').value));}
let lastView='',viewTimer;
window.addEventListener('message',e=>{
 if(e.origin!==location.origin)return;
 const id=cards.findIndex((_,i)=>$(`frame-${i}`)?.contentWindow===e.source);if(id<0)return;
 const d=e.data;
 if(d.type==='map-status'){
  if(d.model!==cards[id].model||d.layer!==state.layer||((d.ready||d.missing)&&Date.parse(d.valid)!==currentTime().getTime()))return;
  const time=$(`card-${id}`).querySelector('.card-time');
  if(id===0&&d.layer){actualLegends.set(d.layer,d.legend);if(d.layer===state.layer)renderLegend();}
  if(d.ready&&d.layer===state.layer){const period=d.layer==='gust'?d.period:null;$(`card-${id}`).querySelector('.map-label-text').textContent=layers[state.layer]+(d.layer==='cloudBase'&&d.cloudBaseKind==='ceiling'?' · ceiling >50%':d.layer==='cloudBase'&&d.cloudBaseKind==='ukv_cbh'?' · ≥2,5 oktas':period?` · ${period} uur`:d.layer==='sun'&&d.sunSourceHours>1?' · uurgemiddelde':'');}
  if(d.missing){loadingCards.delete(id);time.classList.remove('loading','error');time.classList.add('missing');time.textContent='Geen gegevens voor dit tijdstip';}
  else if(d.failed){loadingCards.delete(id);time.classList.remove('missing');time.classList.remove('loading');time.classList.add('error');time.textContent='Kaart tijdelijk niet beschikbaar';}
  else if(d.ready){loadingCards.delete(id);time.classList.remove('error','missing');time.classList.remove('loading');time.textContent=`${shortDateFormatter.format(new Date(d.valid))} · ${timeFormatter.format(new Date(d.valid))}`;}
  else {loadingCards.add(id);time.classList.add('loading');time.textContent='Kaart laden…';}
 }else if(d.type==='map-view'&&state.sync){
   const k=JSON.stringify(d.view);if(k===lastView)return;lastView=k;clearTimeout(viewTimer);viewTimer=setTimeout(()=>broadcast({view:d.view},id),30);
 }else if(d.type==='map-step'){stop();setTime(state.index+d.delta);}
 else if(d.type==='map-play')togglePlay();
 else if(d.type==='map-close'){if($(`card-${id}`).classList.contains('focused'))toggleFocus(id);}
});
$('time-mode').onchange=e=>{
 const previous=state.timeMode,stamp=currentTime().getTime();stop();state.timeMode=e.target.value;
 if(state.catalogs)try{updateComparison(stamp,false);}catch(error){state.timeMode=previous;e.target.value=previous;showToast(error.message);}
};
$('layer-select').onchange=e=>setLayer(e.target.value);$('show-values').onchange=()=>broadcast({details:details()});
$('prev').onclick=()=>{stop();setTime(state.index-1);};$('next').onclick=()=>{stop();setTime(state.index+1);};$('time-slider').oninput=e=>{stop();setTime(e.target.value);};$('play').onclick=togglePlay;
$('zoomout').onclick=()=>broadcast({zoom:1/1.25});$('zoomin').onclick=()=>broadcast({zoom:1.25});$('reset').onclick=()=>broadcast({reset:true});
$('sync').onclick=()=>{state.sync=!state.sync;$('sync').classList.toggle('active',state.sync);$('sync').setAttribute('aria-pressed',String(state.sync));$('sync').querySelector('span:last-child').textContent=state.sync?'Gekoppeld':'Los';if(state.sync){lastView='';broadcast({reset:true});}showToast(state.sync?'Zoomen en verschuiven zijn gekoppeld.':'Elke kaart kan nu afzonderlijk worden verschoven.');};
$('settings').onclick=()=>$('options-dialog').showModal();['provinces','arrows','pressure','fog'].forEach(id=>$(id).onchange=()=>broadcast({details:details()}));
$('fullscreen').onclick=async()=>{if(parent!==window){parent.postMessage({type:'weerlab-fullscreen-toggle'},location.origin);return;}try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{showToast('Gebruik de beeldvullende modus van je browser.');}};
const demoInfo='<p>Wolkenbasis wordt getoond in meters en voeten boven de grond. ICON-D2 toont ceiling bij meer dan 50% laagbedekking; UKV de basis vanaf 2,5 oktas. De eigen bronrun staat boven de kaart. Diagnosecodes en de bovengrenswaarde 20.000 m worden zonder hoogte weergegeven. Gearceerd betekent geen bruikbare diagnose; mist is daarbij niet uitgesloten. AROME levert geen wolkenbasis.</p><p>Wolkenlagen (RGB) mengt lage bewolking in rood, middelbare in groen en hoge in blauw. Helder is zwart. Volledige bedekking in alle drie de lagen is wit.</p><p>Bewolking H/M/L gebruikt de afzonderlijke bronvelden: hoog in blauw, midden in geel en laag in rood. De drie percentages staan als H/M/L op vaste locaties. Kies Hoge, Middelbare of Lage bewolking om één laag los te bekijken. Deze kaarten gebruiken de nieuwste wolkenrun; de run staat boven iedere kaart. ECMWF-tussenuren zijn geïnterpoleerd.</p><p>Extra modellen: AROME HD 1.3 (Météo-France, Licence Ouverte 2.0) en UKMO UKV 2 km (British Crown copyright, Met Office, CC BY-SA 4.0). Bronvelden worden naar hetzelfde kaartrooster als de overige modellen vertaald. UKV gebruikt schermtemperatuur op 1,5 meter. AROME levert geen zichtveld aan; ook andere ontbrekende bronlagen krijgen een melding.</p><p>De compacte bediening geeft de kaarten meer ruimte. Bij significant weer staan temperatuur en neerslag als getallen op vaste locaties; bij andere kaartlagen zie je de waarde van die laag. De uurknoppen onder de slider werken zoals in het oude vierluik.</p><p>Dit vierluik gebruikt de <b>oorspronkelijke kaartweergave van Modelkaarten Benelux</b>: dezelfde geografische ondergrond, kleuren, windpijlen en modelberekeningen. Plaatsnamen zijn weggelaten.</p><p>Dit vierluik haalt bij openen de nieuwste modelruns op en controleert elke 90 seconden opnieuw zolang de pagina zichtbaar is. Kies Gelijke tijden voor de gezamenlijke geldige uren, of Volledig bereik · HARMONIE voor alle beschikbare uren van de gekozen modellen. Buiten het bereik van een model blijft die kaart leeg; er wordt geen ander tijdstip getoond. Bij een tijdelijke storing blijven reeds geladen kaarten staan en wordt de fout vermeld. ECMWF-velden tussen bronstappen worden volgens de bestaande kaartcode geïnterpoleerd.</p><p>Alle kaarten volgen dezelfde lokale tijd. De modelruns en verwachtingstermijnen kunnen verschillen. De vier kaarten staan altijd naast elkaar. Op een smal scherm schuif je horizontaal of gebruik je de modelknoppen om naar een kaart te springen. De kaarten blijven daarbij groot en leesbaar.</p><p>Sleep om te verschuiven, gebruik + en − om te zoomen, of tik op een plek voor lokale waarden.</p>';
$('help').onclick=$('snapshot-info').onclick=()=>showInfo('Jouw live vierluik',demoInfo);$('close-info').onclick=()=>$('info-dialog').close();
$('legend-info').onclick=()=>showInfo(layers[state.layer],'<p>Dezelfde kleur betekent op alle vier de kaarten dezelfde waarde. Bij significant weer toont grijs de bewolking; de neerslagkleur geeft het type aan en de tint de intensiteit. De volledige type- en kleurschaal staat hieronder.</p><div id="native-legend"></div><p>Windstoten hebben de bronperiode van het model. Neerslagsommen beginnen bij de eigen modelstart. Zonduur wordt altijd getoond in minuten per uur (0–60). Bij een bronperiode van 3 of 6 uur staat er een uurgemiddelde; de bron geeft dan geen exacte verdeling per uur. Vergelijk deze sommen en maxima daarom met hun tijdvak in gedachten.</p>');
// Use the renderer’s actual legend inside the explanation, including uncommon precipitation types.
$('legend-info').addEventListener('click',()=>{const frame=$('frame-0');try{$('native-legend').innerHTML=frame.contentDocument.getElementById('legend').innerHTML;}catch{}});
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
document.addEventListener('keydown',e=>{if(['SELECT','INPUT','TEXTAREA','BUTTON'].includes(e.target.tagName)||document.querySelector('dialog[open]'))return;if(e.key==='Escape'){const card=document.querySelector('.map-card.focused');if(card)toggleFocus(Number(card.id.split('-')[1]));}else if(e.key==='ArrowLeft'){e.preventDefault();stop();setTime(state.index-1);}else if(e.key==='ArrowRight'){e.preventDefault();stop();setTime(state.index+1);}else if(e.code==='Space'){e.preventDefault();togglePlay();}});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});

let refreshing=null,refreshingMode='',lastSignature='';
async function refreshCatalogs(){
 const mode=catalogModeFor(state.layer);
 if(refreshing)return refreshingMode===mode?refreshing:refreshing.then(()=>refreshCatalogs());
 refreshingMode=mode;
 $('refresh-data').disabled=true;
 refreshing=(async()=>{
  try{
   const results=await Promise.allSettled(MODEL_KEYS.map(async key=>{
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{return [key,validateFeed(await readCatalog(key,mode,controller.signal),key)];}finally{clearTimeout(timer);}
   }));
   if(mode!==(catalogModeFor(state.layer)))return;
   const catalogs=Object.fromEntries(results.filter(r=>r.status==='fulfilled').map(r=>r.value));
   const unavailable=cards.filter(c=>!catalogs[c.model]);
   if(unavailable.length){const key=unavailable[0].model,cause=results[MODEL_KEYS.indexOf(key)];throw Error(definitions[key].name+': '+(cause.reason?.message||'modelgegevens tijdelijk niet bereikbaar'));}
   const signature=mode+JSON.stringify(MODEL_KEYS.map(k=>[catalogs[k]?.updated,catalogs[k]?.runs[0]?.id]));
   const stamp=state.followNow?Math.floor(Date.now()/HOUR)*HOUR:currentTime().getTime();
   const nextTimes=comparisonTimes(catalogs,cards.map(c=>c.model),state.timeMode);if(!nextTimes.length)throw Error('Geen gezamenlijke actuele geldigheid beschikbaar.');
   if(signature!==lastSignature||JSON.stringify(nextTimes)!==JSON.stringify(state.times)){
    state.catalogMode=mode;state.catalogs=catalogs;state.models=Object.fromEntries(Object.keys(catalogs).map(key=>[key,{run:catalogs[key].runs[0].time,steps:catalogs[key].runs[0].steps}]));
    updateComparison(stamp,state.followNow);document.querySelectorAll('.model-select option').forEach(option=>{option.disabled=!catalogs[option.value];});lastSignature=signature;
   }else if(cards.some((_,i)=>$(`card-${i}`)?.querySelector('.card-time.error'))){updateComparison(stamp,state.followNow);}
   $('snapshot-info').dataset.checkedAt=new Date().toISOString();$('snapshot-info').textContent='Live · gecontroleerd '+timeFormatter.format(new Date());$('snapshot-info').classList.remove('error');$('snapshot-info').title='Automatische controle elke 90 seconden; modelruns staan boven de kaarten.';
  }catch(error){
   $('snapshot-info').textContent='Verversen mislukt · probeer opnieuw';$('snapshot-info').classList.add('error');$('snapshot-info').title=error.message;
   if(!state.models)$('maps').innerHTML='<p class="feed-error">De actuele modelgegevens zijn tijdelijk niet bereikbaar. Gebruik de verversknop om opnieuw te proberen.</p>';
  }finally{$('refresh-data').disabled=false;refreshing=null;}
 })();return refreshing;
}
$('refresh-data').onclick=()=>refreshCatalogs();
renderLegend();
$('maps').innerHTML='<p class="feed-error">Nieuwste modelruns ophalen…</p>';
refreshCatalogs();
setInterval(()=>{if(!document.hidden)refreshCatalogs();},90000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshCatalogs();});

