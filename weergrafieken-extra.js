'use strict';
(()=>{
 const $=id=>document.getElementById(id),C=WeergrafiekenCore,H=3600000,TZ='Europe/Amsterdam',BASE='https://data.weerlab.nl/modelplaten/';
 const labels={harmonie:'HARMONIE 43',ecmwf:'ECMWF IFS',icond2:'ICON-D2',weather24:'MOS/ECMWF'},colors={harmonie:'#70cede',ecmwf:'#ffbc66',icond2:'#b8a5ff',weather24:'#72dfb7'};
 const params=new URLSearchParams(location.search);let view=['compare','feel','sun','pop'].includes(params.get('view'))?params.get('view'):'compare',place={name:params.get('plaats')||'Leiden',lat:Number(params.get('lat')),lon:Number(params.get('lon'))},state=null,request=0;
 const kind=()=>view==='compare'?$('metric').value:view;
 $('place').value=place.name;$('model').value=Object.hasOwn(labels,params.get('model'))?params.get('model'):'harmonie';if(['temp','wind','gust','rain'].includes(params.get('metric')))$('metric').value=params.get('metric');
 const date=t=>new Intl.DateTimeFormat('nl-NL',{timeZone:TZ,day:'numeric',month:'short'}).format(new Date(t)),hm=t=>new Intl.DateTimeFormat('nl-NL',{timeZone:TZ,hour:'2-digit',minute:'2-digit'}).format(new Date(t)),offset=t=>new Intl.DateTimeFormat('nl-NL',{timeZone:TZ,timeZoneName:'shortOffset'}).formatToParts(new Date(t)).find(p=>p.type==='timeZoneName').value;
 const stamp=t=>date(t)+' '+hm(t)+' '+offset(t),num=(v,d=1)=>Number.isFinite(v)?v.toLocaleString('nl-NL',{minimumFractionDigits:d,maximumFractionDigits:d}):'—';
 const metricNames={temp:'Temperatuur',wind:'Gemiddelde wind',gust:'Windstoten',rain:'Neerslag'},units={temp:'°C',wind:'km/u',gust:'km/u',rain:'mm/uur'};
 let preferredModel=$('model').value,restrictedSource=false;
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
   const d=await Weather24Platen.load(place),rows=d.rows.map(r=>({t:Date.parse(metric==='rain'||metric==='sun'||metric==='pop'?r.t:r.end),value:r[{temp:'temp',wind:'ws',gust:'wg',rain:'rain',sun:'sun',pop:'pop'}[metric]],...(metric==='sun'?{cloud:r.cloud===null?null:r.cloud*12.5}:{}),interval:1}));
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
 function layout(){const titles={compare:'Modelvergelijking',feel:'Gevoelstemperatuur',sun:'Zon en bewolking',pop:'Neerslagkans'};$('title').textContent=titles[view];document.title=titles[view]+' · Weerlab';$('intro').textContent={compare:'Verschillende verwachtingen naast elkaar, op dezelfde uren.',feel:'Hoe koud voelt het door de wind? Luchttemperatuur en winterse gevoelstemperatuur per uur.',sun:'Zonminuten per uur, met de bewolking erboven. Bron: MOS/ECMWF.',pop:'Hoe waarschijnlijk is neerslag in elk uur? Bron: MOS/ECMWF.'}[view];$('metric-label').hidden=view!=='compare';const restricted=view==='sun'||view==='pop';
  for(const option of $('model').options)option.disabled=restricted&&option.value!=='weather24';
  if(restricted)$('model').value='weather24';else if(restrictedSource)$('model').value=preferredModel;
  restrictedSource=restricted;$('model-label').hidden=view==='compare';$('model-choices').hidden=view!=='compare';
  $('model-panel-title').textContent=view==='compare'?'Kies de modellen die u wilt vergelijken':'Kies uw model';
  $('model-note').textContent=restricted?'Voor deze grafiek is momenteel alleen MOS/ECMWF als uurbron gekoppeld. De andere modellen zijn hier nog niet beschikbaar.':view==='compare'?'Schakel modellen in of uit. De kleuren en lijnpatronen blijven per model gelijk.':'De berekening gebruikt temperatuur en wind uit dezelfde bron en modelrun.';}
 async function load(){
  const id=++request,requestedView=view;layout();$('status').classList.remove('error');$('status').textContent='Nieuwste uurgegevens ophalen voor '+place.name+'…';$('download').disabled=true;
  try{
   const metric=kind(),models=(view==='sun'||view==='pop')?['weather24']:view==='feel'?[$('model').value]:[...document.querySelectorAll('#model-choices input:checked')].map(e=>e.value);
   if(!models.length)throw Error('Selecteer minstens één model.');
   let manifest=null;if(models.some(m=>m!=='weather24'))manifest=await json(BASE+'current.json?t='+Date.now());
   const settled=await Promise.allSettled(models.map(m=>dataFor(manifest,m,metric)));if(id!==request||requestedView!==view)return;
   const series=settled.flatMap(r=>r.status==='fulfilled'?[r.value]:[]),errors=settled.flatMap((r,i)=>r.status==='rejected'?[labels[models[i]]+': '+r.reason.message]:[]);
   if(!series.length)throw Error(errors.join(' · '));
   if(view==='sun'&&!series[0].rows.some(r=>Number.isFinite(r.value)&&Number.isFinite(r.cloud)))throw Error('De bron levert nog geen zon- en bewolkingswaarden.');
   if(view==='pop'&&!series[0].rows.some(r=>Number.isFinite(r.value)))throw Error('De bron levert geen geldige neerslagkansen.');
   const times=[...new Set(series.flatMap(s=>s.rows.map(r=>r.t)))].sort((a,b)=>a-b);if(!times.length)throw Error('Er zijn geen toekomstige uren beschikbaar');
   state={series,times,metric,place:{...place},view,generated:Date.now(),errors};await Promise.all([document.fonts.load('800 142px Display'),document.fonts.load('500 18px Body'),document.fonts.load('500 16px Mono')]);if(id!==request)return;render();sync();$('status').textContent='Bijgewerkt '+stamp(state.generated)+(errors.length?' · Niet geladen: '+errors.join(' · '):'');$('download').disabled=false;
  }catch(e){if(id===request){$('status').textContent=e.message+(state?' · De vorige grafiek blijft zichtbaar.':'');$('status').classList.add('error');$('download').disabled=!state}}
 }
 function summary(){const {series,view,metric}=state;
  if(view==='pop'){const valid=series[0].rows.filter(r=>Number.isFinite(r.value));if(!valid.length)return 'De bron levert geen geldige neerslagkansen.';const peak=valid.reduce((a,b)=>b.value>a.value?b:a);return `Hoogste uurkans ${num(peak.value,0)}% op ${stamp(peak.t)}. ${valid.filter(r=>r.value>=50).length} uurvakken met minstens 50% kans, over ${valid.length} beschikbare uurvakken. Neerslagkans is geen neerslaghoeveelheid.`;}
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
  p.textContent=state.view==='pop'?'De kans komt rechtstreeks uit het veld prrr van de uurfeed (0–100%). Dit is de kans voor het afzonderlijke uurvak en is niet afgeleid uit de voorspelde hoeveelheid. Uurkansen mogen niet bij elkaar worden opgeteld of als etmaalkans worden gelezen. Ontbrekende kansen blijven leeg; nul is alleen nul als de bron dat aangeeft.':state.view==='compare'?'Iedere lijn gebruikt de eigen modelrun en stopt zodra de bron ophoudt. Er worden geen modellen aan elkaar geplakt. Alleen gelijke UTC-tijdstippen worden vergeleken. De grafiek toont verschillen tussen deze bronnen; het is geen ensemble en geen berekende kans. ECMWF-temperatuur en wind zijn waar nodig uurlijks geïnterpoleerd; windstoten komen uit drie-uursmaxima. ECMWF-neerslag is waar nodig verdeeld uit de bronintervallen. MOS/ECMWF is de appverwachting en geen onafhankelijke ruwe modelrun.':state.view==='feel'?'Winterse windkou volgens de JAG/TI-formule, hier als benadering met de modeltemperatuur op 2 meter en gemiddelde wind op 10 meter. Toepassingsgebied: −46 tot +10 °C en 1,3–49 m/s wind. Daarbuiten ontbreekt de berekende lijn; de luchttemperatuur blijft zichtbaar. Dit is geen hitte-index en bevat geen correctie voor zon of luchtvochtigheid.':'De appfeed levert zonneschijnduur in minuten per uur en totale bewolking in achtsten. Bewolking is omgerekend naar procenten (1/8 = 12,5%). Zonstaafjes horen bij het uurvak; de bewolking erboven bij het einde van dat uurvak. Ontbrekende waarden blijven leeg, nooit nul. Dagsommen gelden alleen voor de getoonde uren.';
  e.append(p);if(state.view==='feel'){const a=document.createElement('a');a.href='https://www.knmi.nl/kennis-en-datacentrum/achtergrond/gevoelstemperatuur-in-de-winter';a.textContent='KNMI: methode en toepassingsgebied';a.target='_blank';a.rel='noopener';e.append(a)}
  for(const s of state.series){const line=document.createElement('p');line.className='muted';line.textContent=s.label+' · '+s.rows.length+' uur · '+(s.key==='weather24'?'opgehaald '+stamp(Date.parse(s.meta.generated)):'modelrun '+stamp(Date.parse(s.meta.run_utc)))+' · '+stamp(s.rows[0].t)+' – '+stamp(s.rows.at(-1).t);e.append(line)}
 }
 function table(){const {series,times,view,metric}=state,head=$('table-head'),body=$('table-body');head.replaceChildren();body.replaceChildren();const tr=document.createElement('tr');const names=['Tijd (Nederland)',...(view==='feel'?['Luchttemperatuur °C','Gevoelstemperatuur °C','Wind km/u']:view==='sun'?['Zon min/uur','Bewolking % (einde uur)']:view==='pop'?['Neerslagkans %']:series.map(s=>s.label+' · '+units[metric]))];for(const n of names){const th=document.createElement('th');th.scope='col';th.textContent=n;tr.append(th)}head.append(tr);$('table-caption').textContent=view==='sun'||view==='pop'||metric==='rain'?'Tijd is de start van het uurvak; neerslag en zon zijn uurhoeveelheden; neerslagkans geldt per afzonderlijk uurvak.':'Tijd is het tijdstip van de voorspelde waarde. Tijdzone staat bij ieder uur.';
  const maps=series.map(s=>new Map(s.rows.map(r=>[r.t,r])));for(const t of times){const row=document.createElement('tr'),r=maps[0].get(t),values=view==='feel'?[r?.temperature,r?.value,r?.wind]:view==='sun'?[r?.value,r?.cloud]:view==='pop'?[r?.value]:maps.map(m=>m.get(t)?.value);for(const value of [stamp(t),...values.map(v=>num(v))]){const td=document.createElement('td');td.textContent=value;row.append(td)}body.append(row)}
 }
 const canvas=$('chart'),g=canvas.getContext('2d'),L=98,R=1016,TOP=520,BASEY=930;let chartMap=null;
 function draw(){
  const {series,times,metric,view,place}=state;
  const bg=g.createLinearGradient(0,0,0,1080);bg.addColorStop(0,'#10283b');bg.addColorStop(1,'#0a1c2b');g.fillStyle=bg;g.fillRect(0,0,1080,1080);
  const text=(s,x,y,size=17,color='#8eabbe',align='left',font='Body')=>{g.fillStyle=color;g.font=`${font==='Display'?'800':'500'} ${size}px ${font},system-ui`;g.textAlign=align;g.fillText(String(s),x,y)};
  const rule=(a,b,c,d,color='#21435c',width=1)=>{g.strokeStyle=color;g.lineWidth=width;g.beginPath();g.moveTo(a,b);g.lineTo(c,d);g.stroke()};
  const good=series[0].rows.filter(r=>Number.isFinite(r.value)),common=view==='compare'?C.spread(series):[];
  const max=rows=>rows.length?rows.reduce((a,b)=>b.value>a.value?b:a):null,min=rows=>rows.length?rows.reduce((a,b)=>b.value<a.value?b:a):null;
  let cells=[];
  if(view==='compare'){
   const widest=common.length?common.reduce((a,b)=>b.range>a.range?b:a):null;
   cells=[['GROOTSTE VERSCHIL',widest?num(widest.range):'—',units[metric],widest?date(widest.t)+' '+hm(widest.t):'Geen gezamenlijke uren','#ff6b57'],['BRONNEN',series.length,'', 'Elke bron een eigen kleur','#6fc3da'],['GEZAMENLIJK',common.length,'uur','Alle gekozen bronnen beschikbaar','#f2c43d']];
  }else if(view==='feel'){
   const low=min(good),cold=good.length?good.reduce((a,b)=>(b.temperature-b.value)>(a.temperature-a.value)?b:a):null;
   cells=[['LAAGSTE GEVOEL',low?num(low.value):'—','°C',low?date(low.t)+' '+hm(low.t):'Buiten winterbereik','#6fc3da'],['EXTRA WINDKOU',cold?num(cold.temperature-cold.value):'—','°C',cold?date(cold.t)+' '+hm(cold.t):'Geen winterwaarde berekend','#ff6b57'],['WINTERBEREIK',good.length,'uur','Uren met geldige berekening','#f2c43d']];
  }else if(view==='sun'){
   const peak=max(good),cloud=series[0].rows.filter(r=>Number.isFinite(r.cloud));
   cells=[['ZON IN TOTAAL',num(good.reduce((n,r)=>n+r.value,0)/60),'uur','Over de getoonde uurvakken','#f2c43d'],['ZONNIGSTE UUR',peak?num(peak.value,0):'—','min',peak?date(peak.t)+' '+hm(peak.t):'Geen zonwaarden','#6fc3da'],['GEM. BEWOLKING',cloud.length?num(cloud.reduce((n,r)=>n+r.cloud,0)/cloud.length,0):'—','%', 'Gemiddelde van beschikbare uren','#c4d7e3']];
  }else{
   const peak=max(good);
   cells=[['HOOGSTE UURKANS',peak?num(peak.value,0):'—','%',peak?date(peak.t)+' '+hm(peak.t):'Geen kansen beschikbaar','#ff6b57'],['MINSTENS 50%',good.filter(r=>r.value>=50).length,'uur','Aantal afzonderlijke uurvakken','#f2c43d'],['BESCHIKBAAR',good.length,'uur','Rechtstreeks uit MOS/ECMWF','#49cfc0']];
  }
  g.fillStyle='#49cfc0';g.beginPath();g.arc(69,76,5,0,Math.PI*2);g.fill();
  const tag=view==='compare'?'MODELVERGELIJKING':view==='feel'?'GEVOELSTEMPERATUUR':view==='sun'?'ZON EN BEWOLKING':'NEERSLAGKANS';
  text(tag+' · KOMENDE '+times.length+' UUR',84,83,18,'#6fc3da','left','Mono');text((date(state.generated)+' · '+hm(state.generated)).toUpperCase(),1016,83,17,'#8eabbe','right','Mono');
  const title=view==='compare'?metricNames[metric].toUpperCase()+' IN':view==='feel'?'GEVOELSTEMPERATUUR IN':view==='sun'?'ZON EN BEWOLKING IN':'NEERSLAGKANS IN';
  text(title,64,150,40,'#ecf4f8','left','Display');
  let size=142;do{g.font=`800 ${size}px Display`;if(g.measureText(place.name.toUpperCase()).width<=952)break;size-=4}while(size>54);
  text(place.name.toUpperCase(),64,280,size,'#6fc3da','left','Display');
  rule(64,315,1016,315);rule(64,455,1016,455);
  cells.forEach(([label,value,unit,sub,color],i)=>{const left=64+i*952/3+(i?24:0);if(i)rule(64+i*952/3,332,64+i*952/3,438);text(label,left,350,15,'#8eabbe','left','Mono');text(value,left,417,70,color,'left','Display');g.font='800 70px Display';const width=g.measureText(String(value)).width;text(unit,left+width+8,415,18,'#8eabbe');text(sub,left,440,13,'#c4d7e3')});
  const lines=view==='feel'?[{key:'air',label:'Luchttemperatuur',color:'#f2c43d',rows:series[0].rows.map(r=>({t:r.t,value:r.temperature}))},{key:'feel',label:'Gevoelstemperatuur',color:'#6fc3da',rows:series[0].rows}]:series.map(s=>({...s,label:view==='pop'?'Neerslagkans per uur':s.label,color:colors[s.key]}));
  const values=lines.flatMap(s=>s.rows.map(r=>r.value)).filter(Number.isFinite);let low=0,high=view==='sun'?60:view==='pop'?100:Math.max(...values),top=view==='sun'?560:520;
  if(view==='compare'&&metric==='temp'||view==='feel'){low=Math.floor(Math.min(...values)-1);high=Math.ceil(Math.max(...values)+1)}else if(view!=='sun'&&view!=='pop')high=Math.ceil(Math.max(1,high)*1.1);
  if(!Number.isFinite(high)||!Number.isFinite(low)||high<=low){low=0;high=1}
  const x0=times[0],x1=times.at(-1)+((view==='sun'||view==='pop'||metric==='rain')?H:0),x=t=>L+(t-x0)/Math.max(H,x1-x0)*(R-L),yy=v=>BASEY-(v-low)/(high-low)*(BASEY-top);
  chartMap={x0,x1,times,x,y:yy};
  for(const t of times){const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:TZ,hour:'2-digit',hourCycle:'h23'}).format(new Date(t)));if(hour>=19||hour<8){g.fillStyle='#071925';g.fillRect(x(t),view==='sun'?520:top,Math.max(1,x(t+H)-x(t)),BASEY-(view==='sun'?520:top))}}
  const unit=view==='sun'?'MIN / UUR':view==='feel'?'°C':view==='pop'?'KANS (%)':units[metric].toUpperCase();text(unit,L-6,view==='sun'?554:488,12,'#8eabbe','right','Mono');
  for(let i=0;i<=5;i++){const v=low+(high-low)*i/5,y=yy(v);rule(L,y,R,y,'#243c4d');text(num(v,view==='pop'||view==='sun'?0:1),L-12,y+5,14,'#8eabbe','right','Mono')}
  const seen=new Set();for(const t of times){const day=date(t);if(!seen.has(day)){seen.add(day);rule(x(t),482,x(t),BASEY,'#2c5269',1.2);text(day.toUpperCase(),x(t)+4,500,19,'#e9f3fa','left','Display')}if(t/H%12===0)text(hm(t),x(t),BASEY+30,13,'#9bb8ca','center','Mono')}
  if(view==='sun'){
   for(const r of series[0].rows){const width=Math.max(1,x(r.t+H)-x(r.t)-1);if(Number.isFinite(r.cloud)){const a=r.cloud/100;g.fillStyle=`rgb(${Math.round(33+177*a)},${Math.round(67+153*a)},${Math.round(90+138*a)})`;g.fillRect(x(r.t),520,width,24)}if(Number.isFinite(r.value)){g.fillStyle=r.value>=40?'#ffd451':r.value>=15?'#f2c43d':'#6fc3da';g.fillRect(x(r.t),yy(r.value),width,BASEY-yy(r.value))}}
   text('BEWOLKING',R,515,11,'#a6c0d1','right','Mono');
  }else{
   if(view==='pop'){
    g.globalAlpha=.55;for(const r of good){g.fillStyle=r.value>=80?'#ff6b57':r.value>=50?'#f2c43d':r.value>=20?'#49cfc0':'#6fc3da';g.fillRect(x(r.t),yy(r.value),Math.max(1,x(r.t+H)-x(r.t)-1),BASEY-yy(r.value))}g.globalAlpha=1;
    g.setLineDash([5,6]);rule(L,yy(50),R,yy(50),'#e8bd43');g.setLineDash([]);text('50%',R-6,yy(50)-6,12,'#e8bd43','right','Mono');
   }else if(view==='feel'){
    const grad=g.createLinearGradient(0,top,0,BASEY);grad.addColorStop(0,'rgba(111,195,218,.25)');grad.addColorStop(1,'rgba(111,195,218,0)');g.fillStyle=grad;
    let segment=[];const fill=()=>{if(segment.length>1){g.beginPath();g.moveTo(x(segment[0].t),yy(segment[0].temperature));for(const r of segment)g.lineTo(x(r.t),yy(r.temperature));for(const r of [...segment].reverse())g.lineTo(x(r.t),yy(r.value));g.closePath();g.fill()}segment=[]};for(const r of series[0].rows){if(!Number.isFinite(r.value)){fill();continue}if(segment.length&&r.t-segment.at(-1).t>H*1.1)fill();segment.push(r)}fill();
   }
   if(low<=0&&high>=0&&view!=='pop'){g.setLineDash([4,5]);rule(L,yy(0),R,yy(0),'#587b92');g.setLineDash([])}
   lines.forEach((s,i)=>{g.strokeStyle=view==='pop'?'#ff8c76':s.color;g.lineWidth=view==='compare'?3:3.4;g.setLineDash(view==='pop'||view==='feel'?[]:[[],[9,5],[3,4],[12,4,3,4]][i%4]);g.beginPath();let last=null;for(const r of s.rows){if(!Number.isFinite(r.value)){last=null;continue}if(last===null||r.t-last>H*1.1)g.moveTo(x(r.t),yy(r.value));else g.lineTo(x(r.t),yy(r.value));last=r.t}g.stroke();g.setLineDash([])});
  }
  if(view==='pop'||view==='sun'||view==='feel'){
   const peak=view==='feel'?min(good):max(good);if(peak){const px=x(peak.t),py=yy(peak.value),color=view==='sun'?'#f2c43d':view==='feel'?'#6fc3da':'#ff8c76';g.fillStyle=color;g.beginPath();g.arc(px,py,6,0,Math.PI*2);g.fill();g.strokeStyle='#ecf4f8';g.lineWidth=2;g.stroke();text(num(peak.value,view==='feel'?1:0)+(view==='sun'?' min':view==='feel'?' °C':'%'),Math.max(L+8,Math.min(R-125,px+15)),Math.max(top+40,py-18),34,color,'left','Display')}
  }
  const legend=view==='sun'?[{label:'zonminuten per uur',color:'#f2c43d'},{label:'bewolking (blauw = helder, licht = bewolkt)',color:'#c4d7e3'}]:view==='pop'?[{label:'kans per uur · kleur van laag naar hoog',color:'#ff8c76'}]:lines;
  let lx=64;legend.forEach((s,i)=>{g.strokeStyle=s.color;g.lineWidth=3;g.setLineDash(view==='compare'?[[],[9,5],[3,4],[12,4,3,4]][i%4]:[]);g.beginPath();g.moveTo(lx,986);g.lineTo(lx+23,986);g.stroke();g.setLineDash([]);text(s.label,lx+30,992,14,s.color);lx+=view==='compare'?244:view==='sun'?270:320});
  const source=view==='sun'||view==='pop'?'MOS/ECMWF':series.map(s=>s.label).join(' / ');text('Bron: '+source,64,1032,12,'#7795a9');text('Ed Aldus WM · weerlab.nl',1016,1032,15,'#ecf4f8','right');
  text(view==='feel'?'JAG/TI-benadering · alleen winterbereik · modeltemperatuur op 2 m':view==='pop'?'Afzonderlijke uurkansen · geen etmaalkans':view==='sun'?'Zon: uurvak · bewolking: einde uurvak':'Eigen modelruns · modelspreiding is geen kansinterval',64,1056,12,'#6e8b9f');
  canvas.setAttribute('aria-label',`${$('title').textContent} ${place.name}. ${summary()}`);
 }
 function hover(event){if(!state||!chartMap)return;const r=canvas.getBoundingClientRect(),x=(event.clientX-r.left)/r.width*1080;if(x<L||x>R)return;const target=chartMap.x0+(x-L)/(R-L)*(chartMap.x1-chartMap.x0),t=state.times.reduce((a,b)=>Math.abs(b-target)<Math.abs(a-target)?b:a);let values;
  if(state.view==='sun'){const v=state.series[0].rows.find(r=>r.t===t);values=`zon ${num(v?.value)} min · bewolking einde uur ${num(v?.cloud)}%`}else if(state.view==='pop'){const v=state.series[0].rows.find(r=>r.t===t);values=`neerslagkans ${num(v?.value,0)}%`;}else if(state.view==='feel'){const v=state.series[0].rows.find(r=>r.t===t);values=`luchttemperatuur ${num(v?.temperature)} °C · gevoelstemperatuur ${num(v?.value)} °C · wind ${num(v?.wind)} km/u`}else values=state.series.map(s=>s.label+': '+num(s.rows.find(r=>r.t===t)?.value)+' '+units[state.metric]).join(' · ');$('detail').textContent=stamp(t)+(state.view==='sun'||state.view==='pop'||state.metric==='rain'?'–'+hm(t+H)+' '+offset(t+H):'')+' · '+values;
 }
 canvas.onpointermove=hover;canvas.onclick=hover;
 async function resolve(name){const d=await json('https://api.pdok.nl/bzk/locatieserver/search/v3_1/free?'+new URLSearchParams({q:name,fq:'type:woonplaats',rows:'8'}));return (d.response?.docs||[]).flatMap(p=>{const m=p.centroide_ll?.match(/^POINT\(\s*([\d.]+)\s+([\d.]+)\s*\)$/);return m?[{name:p.woonplaatsnaam,label:p.weergavenaam,lat:Number(m[2]),lon:Number(m[1])}]:[]})}
 $('place-form').onsubmit=async e=>{e.preventDefault();const name=$('place').value.trim();$('choices').replaceChildren();$('status').textContent='Plaats zoeken…';try{const found=await resolve(name),exact=found.filter(p=>p.name.toLowerCase()===name.toLowerCase());if(exact.length===1||found.length===1){place=exact[0]||found[0];await load();return}if(!found.length)throw Error('Geen woonplaats gevonden.');$('status').textContent='Kies de juiste woonplaats:';for(const p of found){const b=document.createElement('button');b.textContent=p.label;b.onclick=()=>{place=p;$('place').value=p.name;$('choices').replaceChildren();load()};$('choices').append(b)}}catch(e){$('status').textContent=e.message}};
 document.querySelectorAll('[data-view]').forEach(a=>a.onclick=e=>{e.preventDefault();view=a.dataset.view;load()});$('metric').onchange=load;$('model').onchange=()=>{preferredModel=$('model').value;load()};document.querySelectorAll('#model-choices input').forEach(e=>e.onchange=load);
 $('download').onclick=()=>{if(!state)return;const model=state.view==='compare'?state.series.map(s=>({harmonie:'harmonie43',ecmwf:'ecmwf',icond2:'icon_d2',weather24:'mos_ecmwf'}[s.key])).join('_'):(state.view==='sun'||state.view==='pop')?'mos_ecmwf':({harmonie:'harmonie43',ecmwf:'ecmwf',icond2:'icon_d2',weather24:'mos_ecmwf'}[state.series[0].key]);const name=state.place.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');const a=document.createElement('a');a.download=(state.view==='compare'?'vergelijking_'+state.metric:state.view==='feel'?'gevoelstemperatuur':state.view==='pop'?'neerslagkans':'zon_bewolking')+'_'+name+'_'+model+'.png';a.href=canvas.toDataURL('image/png');a.click()};
 (async()=>{layout();if(!params.has('lat')||!params.has('lon')||!Number.isFinite(place.lat)||!Number.isFinite(place.lon)){const found=await resolve(place.name),exact=found.filter(p=>p.name.toLowerCase()===place.name.toLowerCase());if(exact.length!==1)throw Error('Kies een woonplaats via het zoekveld');place=exact[0]}await load()})().catch(e=>{$('status').textContent=e.message});setInterval(()=>{if(!document.hidden)load()},15*60000);
})();
