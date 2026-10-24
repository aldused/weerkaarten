'use strict';
(()=>{
 const $=id=>document.getElementById(id),C=WeergrafiekenCore,H=3600000,TZ='Europe/Amsterdam',BASE='https://data.weerlab.nl/modelplaten/';
 const labels={harmonie:'HARMONIE 43',ecmwf:'ECMWF IFS',icond2:'ICON-D2',weather24:'MOS/ECMWF'},colors={harmonie:'#70cede',ecmwf:'#ffbc66',icond2:'#b8a5ff',weather24:'#72dfb7'};
 const params=new URLSearchParams(location.search);let view=['compare','feel','sun'].includes(params.get('view'))?params.get('view'):'compare',place={name:params.get('plaats')||'Leiden',lat:Number(params.get('lat')),lon:Number(params.get('lon'))},state=null,request=0;
 const kind=()=>view==='compare'?$('metric').value:view;
 $('place').value=place.name;$('model').value=Object.hasOwn(labels,params.get('model'))?params.get('model'):'harmonie';if(['temp','wind','gust','rain'].includes(params.get('metric')))$('metric').value=params.get('metric');
 const date=t=>new Intl.DateTimeFormat('nl-NL',{timeZone:TZ,day:'numeric',month:'short'}).format(new Date(t)),hm=t=>new Intl.DateTimeFormat('nl-NL',{timeZone:TZ,hour:'2-digit',minute:'2-digit'}).format(new Date(t)),offset=t=>new Intl.DateTimeFormat('nl-NL',{timeZone:TZ,timeZoneName:'shortOffset'}).formatToParts(new Date(t)).find(p=>p.type==='timeZoneName').value;
 const stamp=t=>date(t)+' '+hm(t)+' '+offset(t),num=(v,d=1)=>Number.isFinite(v)?v.toLocaleString('nl-NL',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
 const metricNames={temp:'Temperatuur',wind:'Gemiddelde wind',gust:'Windstoten',rain:'Neerslag'},units={temp:'°C',wind:'km/u',gust:'km/u',rain:'mm/uur'};
 const binary=new Map();
 async function json(url){const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('Bron niet bereikbaar (HTTP '+r.status+')');return r.json()}
 async function field(manifest,model,type){const m=manifest.models?.[model]?.[type];if(!m||m.schema!==2||!/^\w+_(wind|temp|rain)_[\da-f_]+\.bin$/.test(m.file))throw Error(labels[model]+': bron ontbreekt');
  if(Date.now()-Date.parse(m.generated)>24*H)throw Error(labels[model]+': bron is ouder dan 24 uur');
  if(type==='temp'&&(m.height_m!==2||m.units!=='degC'))throw Error('Onbekende temperatuurhoogte of eenheid');
  const expected=m.hours*m.grid.nx*m.grid.ny*(type==='wind'?3:4);let cube=binary.get(m.file);
  if(!cube){const r=await fetch(BASE+m.file,{signal:AbortSignal.timeout(25000)});if(!r.ok)throw Error('Modelrooster niet bereikbaar');const b=await r.arrayBuffer();if(b.byteLength!==expected)throw Error('Onvolledig modelrooster');cube=type==='wind'?new Uint8Array(b):new Float32Array(b);if(!cube.every(Number.isFinite))throw Error('Ongeldige modelwaarden');binary.set(m.file,cube)}
  return {meta:m,rows:C.at(m,cube,type,place)};
 }
 async function dataFor(manifest,model,metric){
  if(model==='weather24'){
   const d=await Weather24Platen.load(place),rows=d.rows.map(r=>({t:Date.parse(metric==='rain'||metric==='sun'?r.t:r.end),value:r[{temp:'temp',wind:'ws',gust:'wg',rain:'rain',sun:'sun'}[metric]],...(metric==='sun'?{cloud:r.cloud===null?null:r.cloud*12.5}:{}),interval:1}));
   if(metric==='feel')return {key:model,label:labels[model],meta:d,rows:d.rows.map(r=>({t:Date.parse(r.end),value:C.chill(r.temp,r.ws),temperature:r.temp,wind:r.ws}))};
   return {key:model,label:labels[model],meta:d,rows};
  }
  if(metric==='feel'){const [t,w]=await Promise.all([field(manifest,model,'temp'),field(manifest,model,'wind')]);if(t.meta.run_utc!==w.meta.run_utc)throw Error(labels[model]+': temperatuur en wind komen uit verschillende runs');return {key:model,label:labels[model],meta:t.meta,rows:C.feels(t.rows,w.rows)}}
  const type=metric==='wind'||metric==='gust'?'wind':metric,d=await field(manifest,model,type);return {key:model,label:labels[model],meta:d.meta,rows:d.rows.map(r=>({...r,value:metric==='gust'?r.gust:r.value}))};
 }
 function sync(){
  document.querySelectorAll('[data-view]').forEach(a=>{const q=new URLSearchParams({view:a.dataset.view,plaats:place.name,lat:place.lat,lon:place.lon,model:$('model').value,metric:$('metric').value});a.href='weergrafieken-extra.html?'+q;if(a.dataset.view===view)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current')});
  document.querySelectorAll('[data-old]').forEach(a=>a.href=a.dataset.old+'?'+new URLSearchParams({plaats:place.name,lat:place.lat,lon:place.lon,model:$('model').value}));
  const q=new URLSearchParams({view,plaats:place.name,lat:place.lat,lon:place.lon,model:$('model').value,metric:$('metric').value});history.replaceState(null,'','?'+q);
 }
 function layout(){const titles={compare:'Modelvergelijking',feel:'Gevoelstemperatuur',sun:'Zon en bewolking'};$('title').textContent=titles[view];document.title=titles[view]+' · Weerlab';$('intro').textContent={compare:'Verschillende verwachtingen naast elkaar, op dezelfde uren.',feel:'Hoe koud voelt het door de wind? Luchttemperatuur en winterse gevoelstemperatuur per uur.',sun:'Zonminuten per uur, met de bewolking erboven. Bron: MOS/ECMWF.'}[view];$('metric-label').hidden=view!=='compare';$('model-label').hidden=view!=='feel';$('model-choices').hidden=view!=='compare';}
 async function load(){
  const id=++request,requestedView=view;layout();$('status').classList.remove('error');$('status').textContent='Nieuwste uurgegevens ophalen voor '+place.name+'…';$('download').disabled=true;
  try{
   const metric=kind(),models=view==='sun'?['weather24']:view==='feel'?[$('model').value]:[...document.querySelectorAll('#model-choices input:checked')].map(e=>e.value);
   if(!models.length)throw Error('Selecteer minstens één model.');
   let manifest=null;if(models.some(m=>m!=='weather24'))manifest=await json(BASE+'current.json?t='+Date.now());
   const settled=await Promise.allSettled(models.map(m=>dataFor(manifest,m,metric)));if(id!==request||requestedView!==view)return;
   const series=settled.flatMap(r=>r.status==='fulfilled'?[r.value]:[]),errors=settled.flatMap((r,i)=>r.status==='rejected'?[labels[models[i]]+': '+r.reason.message]:[]);
   if(!series.length)throw Error(errors.join(' · '));
   if(view==='sun'&&!series[0].rows.some(r=>Number.isFinite(r.value)&&Number.isFinite(r.cloud)))throw Error('De bron levert nog geen zon- en bewolkingswaarden.');
   const times=[...new Set(series.flatMap(s=>s.rows.map(r=>r.t)))].sort((a,b)=>a-b);if(!times.length)throw Error('Er zijn geen toekomstige uren beschikbaar');
   state={series,times,metric,place:{...place},view,generated:Date.now(),errors};await document.fonts.load('800 72px Display');if(id!==request)return;render();sync();$('status').textContent='Bijgewerkt '+stamp(state.generated)+(errors.length?' · Niet geladen: '+errors.join(' · '):'');$('download').disabled=false;
  }catch(e){if(id===request){$('status').textContent=e.message+(state?' · De vorige grafiek blijft zichtbaar.':'');$('status').classList.add('error');$('download').disabled=!state}}
 }
 function summary(){const {series,view,metric}=state;
  if(view==='compare'){
   const common=C.spread(series);if(!common.length)return 'Geen gezamenlijke uren voor minstens twee modellen; de beschikbare verwachtingen staan afzonderlijk in de grafiek.';
   const widest=common.reduce((a,b)=>b.range>a.range?b:a);return `${series.length} bronnen · ${common.length} gezamenlijke uren. Grootste verschil op ${stamp(widest.t)}: ${num(widest.min)}–${num(widest.max)} ${units[metric]} (verschil ${num(widest.range)}). De spreiding toont modelverschillen en is geen kansinterval.`;
  }
  if(view==='feel'){const valid=series[0].rows.filter(r=>Number.isFinite(r.value));if(!valid.length)return 'In deze verwachting vallen geen uren binnen het toepassingsgebied voor winterse gevoelstemperatuur. De grafiek toont de luchttemperatuur; er wordt geen winterwaarde buiten dat bereik berekend.';const low=valid.reduce((a,b)=>b.value<a.value?b:a);return `Laagste berekende gevoelstemperatuur ${num(low.value)} °C op ${stamp(low.t)}. Luchttemperatuur ${num(low.temperature)} °C, wind ${num(low.wind)} km/u. ${valid.length} uren binnen het toepassingsgebied.`;}
  const r=series[0].rows,valid=r.filter(r=>Number.isFinite(r.value));return `${num(valid.reduce((n,r)=>n+r.value,0)/60)} zonuren over ${valid.length} beschikbare uurvakken. ${r.length-valid.length} uurvakken met ontbrekende zonwaarden. Bewolking: 0% is helder, 100% is geheel bewolkt.`;
 }
 function render(){
  $('summary').textContent=summary();draw();table();explain();
 }
 function explain(){
  const e=$('explanation');e.replaceChildren();const p=document.createElement('p');
  p.textContent=state.view==='compare'?'Iedere lijn gebruikt de eigen modelrun en stopt zodra de bron ophoudt. Er worden geen modellen aan elkaar geplakt. Alleen gelijke UTC-tijdstippen worden vergeleken. De grafiek toont verschillen tussen deze bronnen; het is geen ensemble en geen berekende kans. ECMWF-temperatuur en wind zijn waar nodig uurlijks geïnterpoleerd; windstoten komen uit drie-uursmaxima. ECMWF-neerslag is waar nodig verdeeld uit de bronintervallen. MOS/ECMWF is de appverwachting en geen onafhankelijke ruwe modelrun.':state.view==='feel'?'Winterse windkou volgens de JAG/TI-formule, hier als benadering met de modeltemperatuur op 2 meter en gemiddelde wind op 10 meter. Toepassingsgebied: −46 tot +10 °C en 1,3–49 m/s wind. Daarbuiten ontbreekt de berekende lijn; de luchttemperatuur blijft zichtbaar. Dit is geen hitte-index en bevat geen correctie voor zon of luchtvochtigheid.':'De appfeed levert zonneschijnduur in minuten per uur en totale bewolking in achtsten. Bewolking is omgerekend naar procenten (1/8 = 12,5%). Zonstaafjes horen bij het uurvak; de bewolking erboven bij het einde van dat uurvak. Ontbrekende waarden blijven leeg, nooit nul. Dagsommen gelden alleen voor de getoonde uren.';
  e.append(p);if(state.view==='feel'){const a=document.createElement('a');a.href='https://www.knmi.nl/kennis-en-datacentrum/achtergrond/gevoelstemperatuur-in-de-winter';a.textContent='KNMI: methode en toepassingsgebied';a.target='_blank';a.rel='noopener';e.append(a)}
  for(const s of state.series){const line=document.createElement('p');line.className='muted';line.textContent=s.label+' · '+s.rows.length+' uur · '+(s.key==='weather24'?'opgehaald '+stamp(Date.parse(s.meta.generated)):'modelrun '+stamp(Date.parse(s.meta.run_utc)))+' · '+stamp(s.rows[0].t)+' – '+stamp(s.rows.at(-1).t);e.append(line)}
 }
 function table(){const {series,times,view,metric}=state,head=$('table-head'),body=$('table-body');head.replaceChildren();body.replaceChildren();const tr=document.createElement('tr');const names=['Tijd (Nederland)',...(view==='feel'?['Luchttemperatuur °C','Gevoelstemperatuur °C','Wind km/u']:view==='sun'?['Zon min/uur','Bewolking % (einde uur)']:series.map(s=>s.label+' · '+units[metric]))];for(const n of names){const th=document.createElement('th');th.scope='col';th.textContent=n;tr.append(th)}head.append(tr);$('table-caption').textContent=view==='sun'||metric==='rain'?'Tijd is de start van het uurvak; neerslag en zon zijn uurhoeveelheden.':'Tijd is het tijdstip van de voorspelde waarde. Tijdzone staat bij ieder uur.';
  const maps=series.map(s=>new Map(s.rows.map(r=>[r.t,r])));for(const t of times){const row=document.createElement('tr'),r=maps[0].get(t),values=view==='feel'?[r?.temperature,r?.value,r?.wind]:view==='sun'?[r?.value,r?.cloud]:maps.map(m=>m.get(t)?.value);for(const value of [stamp(t),...values.map(v=>num(v))]){const td=document.createElement('td');td.textContent=value;row.append(td)}body.append(row)}
 }
 const canvas=$('chart'),g=canvas.getContext('2d'),L=92,R=1000,TOP=420,BASEY=880;let chartMap=null;
 function draw(){const {series,times,metric,view,place}=state;g.fillStyle='#0c2131';g.fillRect(0,0,1080,1080);
  const text=(s,x,y,size=17,color='#a6bdcc',align='left')=>{g.fillStyle=color;g.font=`${size>=32?'800':'600'} ${size}px ${size>=28?'Display':'system-ui'}`;g.textAlign=align;g.fillText(s,x,y)};
  text('WEERLAB · '+(view==='compare'?'MODELLEN NAAST ELKAAR':view==='feel'?'WINTERSE GEVOELSTEMPERATUUR':'ZON EN BEWOLKING'),64,65,17,'#72cadc');text(date(state.generated)+' · '+hm(state.generated),1015,65,16,'#a6bdcc','right');
  text(view==='compare'?metricNames[metric].toUpperCase()+' IN':view==='feel'?'GEVOELSTEMPERATUUR IN':'ZON EN BEWOLKING IN',64,123,28,'#eef6fb');text(place.name.toUpperCase(),64,205,Math.min(72,1250/Math.max(1,place.name.length)),'#72cadc');
  g.font='600 17px system-ui';const lineSummary=summary().split('. ');let y=250;for(const sentence of lineSummary.slice(0,2)){const words=sentence.split(' ');let line='';for(const w of words){if(g.measureText(line+w).width>910){text(line,64,y,17,'#d1e2eb');y+=26;line=''}line+=w+' '}if(line){text(line,64,y,17,'#d1e2eb');y+=26}}
  let lines=view==='feel'?[{key:'air',label:'Luchttemperatuur',color:'#ffbc66',rows:series[0].rows.map(r=>({t:r.t,value:r.temperature}))},{key:'feel',label:'Gevoelstemperatuur',color:'#73cfe6',rows:series[0].rows}]:series.map(s=>({...s,color:colors[s.key]}));
  const vals=lines.flatMap(s=>s.rows.map(r=>r.value)).filter(Number.isFinite);let min=view==='sun'?0:Math.min(...vals),max=view==='sun'?60:Math.max(...vals);if(!vals.length){min=0;max=1}if(metric!=='temp'&&view!=='feel')min=0;if(max-min<2){max+=1;min-=view==='sun'?0:1}const pad=(max-min)*.1;if(view!=='sun'){min=Math.floor(min-pad);max=Math.ceil(max+pad)}
  const x0=times[0],x1=times.at(-1)+(view==='sun'||metric==='rain'?H:0),x=t=>L+(t-x0)/Math.max(H,x1-x0)*(R-L),yy=v=>BASEY-(v-min)/(max-min)*(BASEY-TOP);
  chartMap={x0,x1,times,x,y:yy};
  for(const t of times){const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:TZ,hour:'2-digit',hourCycle:'h23'}).format(new Date(t)));if(hour>=19||hour<8){g.fillStyle='#081a27';g.fillRect(x(t),view==='sun'?355:TOP,Math.max(1,x(t+H)-x(t)),BASEY-(view==='sun'?355:TOP))}}
  g.lineWidth=1;for(let i=0;i<=5;i++){const v=min+(max-min)*i/5,yp=yy(v);g.strokeStyle='#284254';g.beginPath();g.moveTo(L,yp);g.lineTo(R,yp);g.stroke();text(num(v,view==='sun'?0:1),L-12,yp+5,14,'#90aebf','right')}
  text(view==='sun'?'ZONMINUTEN / UUR':view==='feel'?'°C':units[metric].toUpperCase(),L,TOP-(view==='sun'?20:50),14);
  const daySeen=new Set();for(const t of times){const d=date(t);if(!daySeen.has(d)){daySeen.add(d);g.strokeStyle='#365469';g.beginPath();g.moveTo(x(t),view==='sun'?350:TOP-10);g.lineTo(x(t),BASEY);g.stroke();text(d,x(t)+4,view==='sun'?335:TOP-18,14,'#d5e6ee')}if((t/H)%12===0)text(hm(t),x(t),BASEY+32,13,'#a6bdcc','center')}
  if(view==='sun'){
   const r=series[0].rows;for(const v of r){const width=Math.max(1,x(v.t+H)-x(v.t)-1);if(Number.isFinite(v.value)){g.fillStyle='#f5cc4f';g.fillRect(x(v.t),yy(v.value),width,BASEY-yy(v.value))}if(Number.isFinite(v.cloud)){const q=Math.round(220-v.cloud*1.7);g.fillStyle=`rgb(${q},${q+10},${q+15})`;g.fillRect(x(v.t),355,width,35)}}text('BEWOLKING · 0% LICHT / 100% DONKER',L,317,12,'#b8cbd6');
  }else{
   if(min<=0&&max>=0){g.strokeStyle='#6e8b9c';g.setLineDash([5,6]);g.beginPath();g.moveTo(L,yy(0));g.lineTo(R,yy(0));g.stroke();g.setLineDash([])}
   lines.forEach((s,index)=>{g.strokeStyle=s.color;g.lineWidth=2.8;g.setLineDash([[],[9,5],[3,4],[12,4,3,4]][index%4]);g.beginPath();let last=null;for(const r of s.rows){if(!Number.isFinite(r.value)){last=null;continue}if(last===null||r.t-last>H*1.1)g.moveTo(x(r.t),yy(r.value));else g.lineTo(x(r.t),yy(r.value));last=r.t}g.stroke();g.setLineDash([])})
  }
  let lx=64;const legend=view==='sun'?[{label:'Zonminuten per uur',color:'#f5cc4f'},{label:'Bewolking boven de grafiek',color:'#b5c5cc'}]:lines;
  legend.forEach((s,i)=>{g.strokeStyle=s.color;g.lineWidth=3;g.setLineDash(view==='sun'?[]:[[],[9,5],[3,4],[12,4,3,4]][i%4]);g.beginPath();g.moveTo(lx,946);g.lineTo(lx+27,946);g.stroke();g.setLineDash([]);text(s.label,lx+31,952,14,s.color);lx+=view==='feel'?290:245});
  const source=view==='sun'?'MOS/ECMWF':series.map(s=>s.label).join(' / ');text('Bron: '+source,64,1005,13,'#9bb3c3');text('Ed Aldus WM · weerlab.nl',1016,1005,14,'#e7f2f7','right');text(view==='feel'?'JAG/TI-benadering · alleen binnen winterbereik · modeltemperatuur op 2 m':view==='sun'?'Zon: uurvak · bewolking: einde uurvak · ontbrekend blijft leeg':'Eigen modelruns · geen extrapolatie · modelspreiding is geen kansinterval',64,1034,13,'#829eaf');text('Nederlandse tijd · nachten donker · eerste/laatste dag gedeeltelijk',64,1057,12,'#829eaf');
  canvas.setAttribute('aria-label',`${$('title').textContent} ${place.name}. ${summary()}`);
 }
 function hover(event){if(!state||!chartMap)return;const r=canvas.getBoundingClientRect(),x=(event.clientX-r.left)/r.width*1080;if(x<L||x>R)return;const target=chartMap.x0+(x-L)/(R-L)*(chartMap.x1-chartMap.x0),t=state.times.reduce((a,b)=>Math.abs(b-target)<Math.abs(a-target)?b:a);let values;
  if(state.view==='sun'){const v=state.series[0].rows.find(r=>r.t===t);values=`zon ${num(v?.value)} min · bewolking einde uur ${num(v?.cloud)}%`}else if(state.view==='feel'){const v=state.series[0].rows.find(r=>r.t===t);values=`luchttemperatuur ${num(v?.temperature)} °C · gevoelstemperatuur ${num(v?.value)} °C · wind ${num(v?.wind)} km/u`}else values=state.series.map(s=>s.label+': '+num(s.rows.find(r=>r.t===t)?.value)+' '+units[state.metric]).join(' · ');$('detail').textContent=stamp(t)+(state.view==='sun'||state.metric==='rain'?'–'+hm(t+H)+' '+offset(t+H):'')+' · '+values;
 }
 canvas.onpointermove=hover;canvas.onclick=hover;
 async function resolve(name){const d=await json('https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?'+new URLSearchParams({q:name,fq:'type:woonplaats',rows:'8'}));return (d.response?.docs||[]).flatMap(p=>{const m=p.centroide_ll?.match(/^POINT\(\s*([\d.]+)\s+([\d.]+)\s*\)$/);return m?[{name:p.woonplaatsnaam,label:p.weergavenaam,lat:Number(m[2]),lon:Number(m[1])}]:[]})}
 $('place-form').onsubmit=async e=>{e.preventDefault();const name=$('place').value.trim();$('choices').replaceChildren();$('status').textContent='Plaats zoeken…';try{const found=await resolve(name),exact=found.filter(p=>p.name.toLowerCase()===name.toLowerCase());if(exact.length===1||found.length===1){place=exact[0]||found[0];await load();return}if(!found.length)throw Error('Geen woonplaats gevonden.');$('status').textContent='Kies de juiste woonplaats:';for(const p of found){const b=document.createElement('button');b.textContent=p.label;b.onclick=()=>{place=p;$('place').value=p.name;$('choices').replaceChildren();load()};$('choices').append(b)}}catch(e){$('status').textContent=e.message}};
 document.querySelectorAll('[data-view]').forEach(a=>a.onclick=e=>{e.preventDefault();view=a.dataset.view;load()});$('metric').onchange=load;$('model').onchange=load;document.querySelectorAll('#model-choices input').forEach(e=>e.onchange=load);
 $('download').onclick=()=>{if(!state)return;const model=state.view==='compare'?state.series.map(s=>({harmonie:'harmonie43',ecmwf:'ecmwf',icond2:'icon_d2',weather24:'mos_ecmwf'}[s.key])).join('_'):state.view==='sun'?'mos_ecmwf':({harmonie:'harmonie43',ecmwf:'ecmwf',icond2:'icon_d2',weather24:'mos_ecmwf'}[state.series[0].key]);const name=state.place.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');const a=document.createElement('a');a.download=(state.view==='compare'?'vergelijking_'+state.metric:state.view==='feel'?'gevoelstemperatuur':'zon_bewolking')+'_'+name+'_'+model+'.png';a.href=canvas.toDataURL('image/png');a.click()};
 (async()=>{layout();if(!params.has('lat')||!params.has('lon')||!Number.isFinite(place.lat)||!Number.isFinite(place.lon)){const found=await resolve(place.name),exact=found.filter(p=>p.name.toLowerCase()===place.name.toLowerCase());if(exact.length!==1)throw Error('Kies een woonplaats via het zoekveld');place=exact[0]}await load()})().catch(e=>{$('status').textContent=e.message});setInterval(()=>{if(!document.hidden)load()},15*60000);
})();
