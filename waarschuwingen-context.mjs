import {geometryPath} from './waarschuwingen-archief-kaart.mjs?v=20261122-herstel-2';

const NS='http://www.w3.org/2000/svg', ROOT='https://data.weerlab.nl/';
const ZONE='Europe/Amsterdam';
const DATE=new Intl.DateTimeFormat('nl-NL',{timeZone:ZONE,day:'numeric',month:'long',year:'numeric'});
const TIME=new Intl.DateTimeFormat('nl-NL',{timeZone:ZONE,hour:'2-digit',minute:'2-digit',timeZoneName:'short'});
const DAY=new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,year:'numeric',month:'2-digit',day:'2-digit'});
const FIELDS={VV:['Zicht','KNMI-zichtklasse'],T:['Temperatuur','°C'],TD:['Dauwpunt','°C'],U:['Luchtvochtigheid','%'],FX:['Windstoten','km/u'],FF:['Wind','km/u'],RH:['Neerslag voorafgaande uur','mm'],P:['Luchtdruk','hPa']};
const docCache=new Map(),radarCache=new Map();
let basePromise,indexPromise,indexChecked=0,corePromise;
const finite=value=>typeof value==='number'&&Number.isFinite(value);
const node=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const svgNode=(tag,attrs={},text)=>{const e=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;return e;};
const localDay=value=>{const p=Object.fromEntries(DAY.formatToParts(new Date(value)).map(part=>[part.type,part.value]));return `${p.year}-${p.month}-${p.day}`;};
const dateTime=value=>`${DATE.format(new Date(value))}, ${TIME.format(new Date(value))}`;
const project=([lon,lat])=>[36+(lon-3.2)*132,34+(53.6-lat)*215];
const number=(value,decimals=1)=>new Intl.NumberFormat('nl-NL',{maximumFractionDigits:decimals}).format(value);

export function contextDays(record,selected=null){
  if(selected)return[selected];
  if(record.dates)return [...new Set(record.dates)].sort();
  const days=[],first=localDay(record.onset),last=localDay(Date.parse(record.expires)-1);
  for(let day=first;day<=last;day=new Date(Date.parse(day+'T12:00Z')+86400000).toISOString().slice(0,10)){
    days.push(day);if(days.length>370)throw Error('Ongeldige waarschuwingsperiode');
  }
  return days;
}
export function defaultField(record){
  const text=String(record.phenomenon||'').toLowerCase();
  if(/mist|zicht/.test(text))return 'VV';
  if(/wind|storm|hozen/.test(text))return 'FX';
  if(/onweer|regen|neerslag/.test(text))return 'RH';
  return 'T';
}
export function visibility(code){
  if(!Number.isInteger(code)||code<0||code>89)return null;
  if(code===0)return {lower:0,upper:100,label:'<100 m'};
  if(code<50)return {lower:code*100,upper:(code+1)*100,label:`${code*100}–${(code+1)*100} m`};
  if(code===50)return {lower:5000,upper:6000,label:'5–6 km'};
  if(code>=56&&code<=79)return {lower:(code-50)*1000,upper:(code-49)*1000,label:`${code-50}–${code-49} km`};
  if(code===89)return {lower:70000,upper:null,label:'>70 km'};
  if(code>=80)return {lower:30000,upper:null,label:`≥30 km (code ${code})`};
  return null;
}
export function assertContext(data,day){
  if(data?.schema!==1||data.day!==day||!Array.isArray(data.times)||!data.times.length||!Array.isArray(data.stations)||!data.stations.length)throw Error('Geen meetkaarten voor deze dag');
  if(data.times.some(time=>!Number.isFinite(Date.parse(time))||localDay(time)!==day))throw Error('Meetkaart bevat een andere datum');
  if(data.stations.some(st=>!finite(st.lon)||!finite(st.lat)||st.lon<3||st.lon>7.5||st.lat<50.5||st.lat>53.8))throw Error('Onbekend meetstation');
  for(const field of Object.keys(FIELDS)){
    const frames=data.values?.[field];
    if(!Array.isArray(frames)||frames.length!==data.times.length||frames.some(frame=>!Array.isArray(frame)||frame.length!==data.stations.length||frame.some(v=>v!==null&&!finite(v))))throw Error('Onvolledige meetreeks');
  }
  return data;
}
function displayValue(field,value){
  if(!finite(value))return 'geen meting';
  if(field==='VV')return visibility(value)?.label||'onbekende zichtcode';
  if(field==='FX'||field==='FF')return number(value*3.6,0)+' km/u';
  if(field==='RH'&&value<0)return '<0,05 mm';
  return `${number(value,field==='U'?0:1)} ${FIELDS[field][1]}`;
}
export function validityEnd(record){
  const end=record.expires?Date.parse(record.expires):Infinity, withdrawn=record.status==='cancelled'?Date.parse(record.updated||record.revisions?.filter(item=>item.status==='cancelled').at(-1)?.issued):NaN;
  return Number.isFinite(withdrawn)?Math.min(end,withdrawn):end;
}
export function chooseFrame(data,record,field=defaultField(record),now=Date.now()){
  const start=record.onset?Date.parse(record.onset):-Infinity,end=validityEnd(record);
  let candidates=data.times.map((time,index)=>({index,time:Date.parse(time)})).filter(item=>item.time<=now&&item.time>=start&&item.time<end);
  if(!candidates.length)candidates=data.times.map((time,index)=>({index,time:Date.parse(time)})).filter(item=>item.time<=now);
  if(!candidates.length)return 0;
  const minimum=field==='VV'||field==='T'&&!/hitte|warm/.test(String(record.phenomenon).toLowerCase());
  let chosen=candidates[0].index,best=minimum?Infinity:-Infinity;
  for(const item of candidates){
    const values=data.values[field][item.index].filter(v=>finite(v)&&(field!=='VV'||visibility(v)));
    if(!values.length)continue;
    const score=minimum?Math.min(...values):Math.max(...values);
    if(minimum?score<best:score>best){chosen=item.index;best=score;}
  }
  return chosen;
}
export function describeFrame(data,index,field){
  const rows=data.values[field][index].map((value,i)=>({value,station:data.stations[i]})).filter(row=>finite(row.value)&&(field!=='VV'||visibility(row.value)));
  if(!rows.length)return `Voor ${TIME.format(new Date(data.times[index]))} zijn geen ${FIELDS[field][0].toLowerCase()}metingen beschikbaar.`;
  rows.sort((a,b)=>a.value-b.value);
  const low=rows[0],high=rows.at(-1),when=TIME.format(new Date(data.times[index]));
  if(field==='VV'){
    const fog=rows.filter(row=>row.value<10).length;
    const sites=rows.filter(row=>row.value===low.value).slice(0,3).map(row=>row.station.name).join(', ');
    const stationIndex=data.stations.indexOf(low.station),details=[];
    for(const key of ['T','TD','U']){const value=data.values[key]?.[index]?.[stationIndex];if(finite(value))details.push(FIELDS[key][0].toLowerCase()+' '+displayValue(key,value));}
    const extra=details.length?` Bij ${low.station.name}: ${details.join(', ')}.`:'';
    return `Om ${when} was de kleinste gemeten zichtklasse ${visibility(low.value).label}, bij ${sites}. ${fog} van de ${rows.length} meetstations rapporteerden een zichtklasse onder 1 km.${extra} Mist kan tussen meetstations sterk verschillen.`;
  }
  if(field==='RH')return `In het uur tot ${when} viel de meeste gemeten neerslag bij ${high.station.name}: ${displayValue(field,high.value)}. Dit zijn regenmetermetingen op ${rows.length} stations.`;
  if(field==='FX')return `De zwaarste gemeten windstoot in het uur tot ${when} was ${displayValue(field,high.value)}, bij ${high.station.name}. Er zijn windstootmetingen van ${rows.length} stations.`;
  return `Om ${when} varieerde ${field==='TD'?'het gemeten':'de gemeten'} ${FIELDS[field][0].toLowerCase()} van ${displayValue(field,low.value)} bij ${low.station.name} tot ${displayValue(field,high.value)} bij ${high.station.name}. Dit zijn puntmetingen bij ${rows.length} stations.`;
}
async function json(url){const response=await fetch(url,{cache:'no-cache'});if(!response.ok)throw Error('Bron niet beschikbaar');return response.json();}
async function context(day){
  if(docCache.has(day)&&Date.now()-docCache.get(day).checkedAt>300000)docCache.delete(day);
  if(!docCache.has(day)){
    if(docCache.size>12)docCache.delete(docCache.keys().next().value);
    docCache.set(day,{checkedAt:Date.now(),promise:json(`${ROOT}waarschuwingen-context/${day}.json?v=${Math.floor(Date.now()/300000)}`).then(data=>assertContext(data,day)).catch(error=>{docCache.delete(day);throw error;})});
  }
  return docCache.get(day).promise;
}
async function basemap(){if(!basePromise)basePromise=json(new URL('./waarschuwingen-archief-basiskaart.json?v=20261122-1',import.meta.url)).catch(error=>{basePromise=null;throw error;});return basePromise;}
function mapBase(geo,label){
  const svg=svgNode('svg',{viewBox:'0 0 590 665',class:'weather-context-map',role:'img','aria-label':label});
  svg.append(svgNode('rect',{width:590,height:665,fill:'#e4f1f7'}));
  for(const feature of geo.features)svg.append(svgNode('path',{d:geometryPath(feature.geometry),fill:feature.properties.name==='IJsselmeergebied'?'#e4f1f7':'#f7f9fb',stroke:'#8296a7','stroke-width':.7,'fill-rule':'evenodd'}));
  return svg;
}
function color(field,value){
  if(field==='VV')return value<=1?'#a92957':value<10?'#d65383':value<50?'#d5a139':'#3a8c8c';
  const stops=field==='U'?[0,50,80,95,100]:field==='FX'||field==='FF'?[0,5,10,20,30]:field==='RH'?[0,.1,1,5,15]:field==='P'?[970,990,1010,1030,1050]:[-15,0,10,20,35];
  const colors=['#3779ac','#65b7c3','#c0c986','#e39740','#b43742'];
  let index=0;while(index<stops.length-1&&value>=stops[index+1])index++;
  return colors[index];
}
function stationMap(geo,data,index,field,selection){
  const svg=mapBase(geo,`${FIELDS[field][0]} bij KNMI-meetstations · ${dateTime(data.times[index])}`),occupied=[];
  const observations=data.stations.map((station,i)=>({station,value:data.values[field][index][i]})).filter(item=>finite(item.value)&&(field!=='VV'||visibility(item.value)));
  observations.sort((a,b)=>field==='VV'?a.value-b.value:b.value-a.value);
  for(const{station,value}of observations){
    const[x,y]=project([station.lon,station.lat]),group=svgNode('g',{'aria-label':`${station.name}: ${displayValue(field,value)}`,role:'button',tabindex:0,class:'weather-station'});
    group.append(svgNode('circle',{cx:x,cy:y,r:7.5,fill:color(field,value),stroke:'#fff','stroke-width':1.5}),svgNode('title',{},`${station.name}: ${displayValue(field,value)}`));
    const short=field==='VV'?(value===0?'<100':visibility(value).lower>=1000?number(visibility(value).lower/1000,0)+'k':String(visibility(value).lower)):number((field==='FX'||field==='FF')?value*3.6:value,field==='U'?0:1);
    for(const[dx,dy]of[[12,-9],[12,24],[-short.length*14-12,-9],[-short.length*14-12,24]]){
      const box={x:x+dx,y:y+dy-20,w:short.length*14+5,h:24};
      if(box.x<4||box.x+box.w>585||box.y<4||box.y+box.h>660||occupied.some(other=>box.x<other.x+other.w&&box.x+box.w>other.x&&box.y<other.y+other.h&&box.y+box.h>other.y))continue;
      occupied.push(box);group.append(svgNode('text',{x:x+dx,y:y+dy,class:'weather-station-label'},short));break;
    }
    const select=()=>{selection.textContent=`${station.name} · ${displayValue(field,value)} · ${dateTime(data.times[index])}`;};
    group.addEventListener('click',select);group.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();select();}});
    svg.append(group);
  }
  return svg;
}
function stationLegend(field){
  const legend=node('p','weather-context-legend');
  if(field==='VV'){
    for(const[code,label]of[[1,'<200 m'],[5,'200 m–1 km'],[20,'1–5 km'],[60,'≥5 km']]){const item=node('span','weather-legend-item'),mark=node('span','weather-legend-mark');mark.style.background=color('VV',code);mark.setAttribute('aria-hidden','true');item.append(mark,document.createTextNode(label));legend.append(item);}
    legend.append(node('span','weather-legend-note','Labels tonen de ondergrens van de zichtklasse. Klik op een meetpunt voor de volledige klasse.'));
  }
  else legend.textContent=`${FIELDS[field][0]} in ${FIELDS[field][1]}. Klik op een meetpunt voor de stationsnaam en de gemeten waarde.`;
  return legend;
}
function card(title){
  const article=node('section','weather-context-card'),heading=node('h5','',title),subtitle=node('p','weather-context-subtitle'),plot=node('div','weather-context-plot'),description=node('p','weather-context-description');
  article.append(heading,subtitle,plot,description);return{article,heading,subtitle,plot,description};
}
async function radarCore(){if(!corePromise)corePromise=import('./accumulatie_core.js?v=20261122-context-1').then(()=>globalThis.AccuCore);return corePromise;}
async function radarField(time){
  const stamp=Date.parse(time),begin=stamp-3600000,key=new Date(begin).toISOString(),day=key.slice(0,10).replaceAll('-',''),hour=key.slice(11,13);
  if(!indexPromise||Date.now()-indexChecked>90000){indexChecked=Date.now();indexPromise=json(ROOT+'accumulatie/index.json?t='+Math.floor(Date.now()/90000)).catch(error=>{indexPromise=null;throw error;});}
  const index=await indexPromise;if(!index.dagen?.[day])throw Error('Voor deze datum staat geen radaruursom in dit archief.');
  const path=`accumulatie/uur/${day}/${hour}.bin.gz`;
  if(!radarCache.has(path)){
    if(radarCache.size>6)radarCache.delete(radarCache.keys().next().value);
    radarCache.set(path,(async()=>{
      const response=await fetch(ROOT+path);if(!response.ok)throw Error('Radaruursom ontbreekt');
      const buffer=await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer(),core=await radarCore(),field=core.decodeerVeld(buffer);
      if(field.nr!==core.NRIJ||field.nk!==core.NKOL||field.begin*60000!==begin||field.eind*60000!==stamp)throw Error('Radarbeeld hoort bij een ander tijdvak');
      return{field,core};
    })().catch(error=>{radarCache.delete(path);throw error;}));
  }
  return radarCache.get(path);
}
function radarMap(geo,field,core){
  const canvas=document.createElement('canvas');canvas.width=590;canvas.height=665;
  const ctx=canvas.getContext('2d'),image=ctx.createImageData(590,665),stops=[.1,1,2,5,10,20],colors=[[143,195,231],[67,142,202],[77,92,183],[161,63,174],[211,49,111],[237,132,45]];
  for(let y=0;y<665;y++)for(let x=0;x<590;x++){
    const cell=core.celVan(3.2+(x-36)/132,53.6-(y-34)/215),offset=(y*590+x)*4;
    if(!cell)continue;
    const index=cell[0]*field.nk+cell[1];
    if(field.tel[index]<field.verwacht){image.data.set([150,160,175,70],offset);continue;}
    const value=field.som[index]/100;if(value<.01)continue;
    let level=0;while(level<stops.length-1&&value>=stops[level+1])level++;
    image.data.set([...colors[level],210],offset);
  }
  ctx.putImageData(image,0,0);
  const svg=mapBase(geo,'KNMI-radarsom van het voorafgaande uur');svg.append(svgNode('image',{href:canvas.toDataURL('image/png'),x:0,y:0,width:590,height:665}));
  for(const feature of geo.features)svg.append(svgNode('path',{d:geometryPath(feature.geometry),fill:'none',stroke:'#758799','stroke-width':.6}));
  return svg;
}
export function analysisFor(time,now=Date.now()){
  const epoch=Math.floor(Math.min(Date.parse(time),now)/21600000)*21600000,stamp=new Date(epoch).toISOString();
  return {time:stamp,url:'https://cdn.knmi.nl/knmi/map/page/klimatologie/daggegevens/weerkaarten/analyse_'+stamp.slice(0,10).replaceAll('-','')+stamp.slice(11,13)+'.gif'};
}
export async function renderWeatherContext(host,record,{day:selected=null}={}){
  host.replaceChildren(node('h4','','Het weer tijdens deze waarschuwing'));
  host.append(node('p','weather-context-intro','Bekijk de weeranalyse en gemeten omstandigheden. Kies een dag en uur; de toelichting volgt het gekozen kaartmoment.'));
  const days=contextDays(record,selected),controls=node('div','weather-context-controls');
  const daySelect=node('select'),timeSelect=node('select'),fieldSelect=node('select');
  for(const[label,select]of[['Dag van de weerkaarten',daySelect],['Kaartmoment waarnemingen',timeSelect],['Meetkaart',fieldSelect]]){const item=node('label','',label);item.append(select);controls.append(item);}
  for(const day of days){const option=node('option','',DATE.format(new Date(day+'T12:00Z')));option.value=day;daySelect.append(option);}
  for(const[key,[name]]of Object.entries(FIELDS)){const option=node('option','',name);option.value=key;fieldSelect.append(option);}
  daySelect.value=days.filter(day=>day<=localDay(Date.now())).at(-1)||days[0];
  fieldSelect.value=defaultField(record);host.append(controls);
  const status=node('p','weather-context-status');status.setAttribute('role','status');host.append(status);
  const grid=node('div','weather-context-grid'),primary=card('Meetkaart'),temperature=card('Temperatuur'),synoptic=card('Weerkaart Europa'),radar=card('Radar: neerslag voorafgaande uur');
  grid.append(primary.article,temperature.article,synoptic.article,radar.article);host.append(grid);
  const source=node('p','source-note','Bron: KNMI KDP uurwaarnemingen, recente tienminutenmetingen en KNMI-analyse. Presentatie en toelichting bij de metingen: Weerlab. De meetkaarten tonen waarnemingen bij stations, geen vlakken met een gegarandeerd gelijke weersituatie.');host.append(source);
  let data=null,geo=null,revision=0;
  function drawAnalysis(time){
    const item=analysisFor(time),img=node('img');img.src=item.url;img.alt=`KNMI-weeranalyse ${dateTime(item.time)}`;img.loading='lazy';
    const link=node('a');link.href=item.url;link.target='_blank';link.rel='noopener';link.append(img);
    synoptic.plot.replaceChildren(link);synoptic.subtitle.textContent='Analyse '+dateTime(item.time);synoptic.description.textContent='Gronddruk, fronten en weersystemen. Dit is de KNMI-analyse op het vermelde tijdstip, vóór of op het gekozen meetmoment. Klik op de kaart om die te vergroten.';
    img.addEventListener('error',()=>{synoptic.plot.replaceChildren(node('p','weather-context-empty','Deze historische analyse is bij het KNMI niet beschikbaar.'));});
  }
  async function paint(){
    if(!data||!geo)return;
    const token=++revision,index=Number(timeSelect.value),field=fieldSelect.value,time=data.times[index];
    for(const[panel,key]of[[primary,field],[temperature,field==='T'?'TD':'T']]){
      panel.heading.textContent=FIELDS[key][0];panel.subtitle.textContent=dateTime(time);
      const selected=node('p','weather-station-selection','Klik op een meetpunt voor de stationsnaam.');
      const picker=node('label','weather-station-picker','Meetstation bekijken'),stationSelect=node('select'),empty=node('option','','Kies een meetstation');empty.value='';stationSelect.append(empty);
      data.stations.map((station,i)=>({station,i,value:data.values[key][index][i]})).filter(item=>finite(item.value)&&(key!=='VV'||visibility(item.value))).sort((a,b)=>a.station.name.localeCompare(b.station.name,'nl')).forEach(({station,i,value})=>{const option=node('option','',station.name+' · '+displayValue(key,value));option.value=String(i);stationSelect.append(option);});
      stationSelect.addEventListener('change',()=>{if(stationSelect.value==='')return;const i=Number(stationSelect.value);selected.textContent=data.stations[i].name+' · '+displayValue(key,data.values[key][index][i])+' · '+dateTime(time);});picker.append(stationSelect);
      panel.plot.replaceChildren(stationMap(geo,data,index,key,selected),stationLegend(key),picker,selected);
      panel.description.textContent=describeFrame(data,index,key);
    }
    status.textContent=(data.quality?.[index]==='provisional-ten-minute'?'Voorlopige KNMI-metingen op het hele uur, aangevuld uit de tienminutenbron':data.quality?.[index]==='provisional'?'Voorlopige KNMI-uurmetingen':'Gevalideerde KNMI-uurmetingen')+' · '+dateTime(time)+(record.onset&&(Date.parse(time)<Date.parse(record.onset)||Date.parse(time)>=validityEnd(record))?' · buiten de geldigheid van deze melding':'');
    drawAnalysis(time);radar.subtitle.textContent=`${TIME.format(new Date(Date.parse(time)-3600000))} – ${TIME.format(new Date(time))}`;
    radar.plot.replaceChildren(node('p','weather-context-empty','Radargegevens ophalen…'));radar.description.textContent='';
    try{
      const{field:rain,core}=await radarField(time);if(token!==revision)return;
      radar.plot.replaceChildren(radarMap(geo,rain,core));
      const complete=rain.aanwezig===rain.verwacht;
      let maximum=0;for(let i=0;i<rain.som.length;i++)if(rain.tel[i]===rain.verwacht)maximum=Math.max(maximum,rain.som[i]/100);
      radar.description.textContent=`KNMI-radarschatting voor het voorafgaande uur, in millimeters. ${complete?'Alle 12 vijfminutenbeelden zijn aanwezig.':'Dit uur is onvolledig: '+rain.aanwezig+' van '+rain.verwacht+' beelden; onvolledige cellen zijn grijs.'} Grootste som in complete rastercellen: ${number(maximum)} mm. Blauw: weinig neerslag; paars/roze/oranje: meer neerslag. Radar meet neerslag; mist lees je op de zichtkaart.`;
    }catch{
      if(token!==revision)return;
      const original=(record.factsheet_images||[]).find(item=>/radar/i.test(item.caption)&&/^https:\/\/cdn\.knmi\.nl\//.test(item.url));
      if(original){const img=node('img');img.src=original.thumbnail||original.url;img.alt=original.caption;img.loading='lazy';const link=node('a');link.href=original.url;link.target='_blank';link.rel='noopener';link.append(img);radar.plot.replaceChildren(link);radar.subtitle.textContent='Beeld uit de KNMI-terugblik';radar.description.textContent=original.caption+' Dit beeld heeft het tijdstip uit het bijschrift en volgt de uurkeuze hierboven niet.';}
      else{radar.plot.replaceChildren(node('p','weather-context-empty','Voor dit uur is geen historisch radarbeeld in dit archief beschikbaar.'));radar.description.textContent='De meetkaart Neerslag laat wel de beschikbare regenmetermetingen zien. Een ontbrekend radarbeeld betekent niet dat het droog was.';}
    }
  }
  async function loadDay(){
    const token=++revision,day=daySelect.value;data=null;
    if(day>localDay(Date.now())){grid.hidden=true;timeSelect.disabled=true;status.textContent='Voor deze toekomstige dag zijn nog geen waarnemingen beschikbaar. De meetkaarten verschijnen zodra de KNMI-metingen binnenkomen.';return;}
    grid.hidden=false;status.textContent='Historische KNMI-metingen ophalen…';timeSelect.disabled=true;
    for(const panel of[primary,temperature,radar])panel.plot.replaceChildren(node('p','weather-context-empty','Kaart laden…'));
    drawAnalysis(day+'T12:00Z');
    try{
      const[observations,base]=await Promise.all([context(day),basemap()]);if(token!==revision)return;
      data=observations;geo=base;timeSelect.replaceChildren();
      data.times.forEach((time,index)=>{const option=node('option','',TIME.format(new Date(time)));option.value=String(index);timeSelect.append(option);});
      timeSelect.value=String(chooseFrame(data,record,fieldSelect.value));timeSelect.disabled=false;await paint();
    }catch{
      if(token!==revision)return;
      status.textContent='Voor deze dag zijn de meetkaarten nog niet beschikbaar. De oorspronkelijke waarschuwing en eventuele KNMI-terugblik blijven hierboven te bekijken.';
      for(const panel of[primary,temperature,radar]){panel.plot.replaceChildren(node('p','weather-context-empty','Nog geen meetkaart voor deze dag.'));panel.description.textContent='';}
      const retry=node('button','weather-context-retry','Opnieuw ophalen');retry.type='button';retry.addEventListener('click',loadDay);status.append(document.createTextNode(' '),retry);
    }
  }
  daySelect.addEventListener('change',loadDay);timeSelect.addEventListener('change',paint);fieldSelect.addEventListener('change',paint);
  await loadDay();
}
