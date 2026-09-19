import * as mapEngine from './map.mjs';
import { defaultOmProtocolSettings, updateCurrentBounds, getProtocolInstance, domainOptions, GridFactory, getRanges } from '@openmeteo/weather-map-layer';
import { LruBlockCache, initWasm } from '@openmeteo/file-reader';
import { FastBrowserBlockCache } from './fast-block-cache.mjs';
import { DATA_ROOT, EUROPE, HOUR, FORECAST_DAYS, runPath, hasFullHorizon, forecastFrames, nearestIndex, hourlyRate, localDateKey, fmt, scales, inEurope } from './core.mjs';

const $ = id => document.getElementById(id);
$('app').dataset.moduleReadyMs=Math.round(performance.now());
// Upstream only caches the finished module. Share the IN-FLIGHT initialization
// too, otherwise six parallel variables can initialize six WASM instances.
const wasmReady=initWasm();
wasmReady.then(()=>{$('app').dataset.decoderReadyMs=Math.round(performance.now());}).catch(()=>{});
const paths = {
  search:'M21 21l-6-6M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  weather:'M4 6V3M1 9h3M6 5 4 3M10 4V1M14 5l2-2M5 11a5 5 0 0 1 8-5M5 20a5 5 0 1 1 1-10 6 6 0 0 1 12 1 4.5 4.5 0 0 1 0 9Z',
  rain:'M12 2c-2 4-7 9-7 13a7 7 0 0 0 14 0c0-4-5-9-7-13Z',
  temperature:'M9 15V5a3 3 0 0 1 6 0v10a5 5 0 1 1-6 0ZM12 8v10M15 6h3M15 10h3',
  wind:'M4 22V3m0 1 15 4-2 8L4 10m5-5v7m5-5-1 7',
  layers:'m2 8 10-6 10 6-10 6L2 8Zm0 5 10 6 10-6M2 18l10 6 10-6',
  plus:'M12 4v16M4 12h16', minus:'M4 12h16',
  europe:'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20ZM2 12h20M12 2c6 6 6 14 0 20-6-6-6-14 0-20Z',
  home:'m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7',
  expand:'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5', close:'m6 6 12 12M6 18 18 6',
  left:'m15 4-8 8 8 8', right:'m9 4 8 8-8 8', play:'m7 3 14 9-14 9Z', pause:'M8 4v16M16 4v16',
  info:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 10v7M12 6v1',
};
function icon(el, name) {
  el.innerHTML = `<svg viewBox="0 0 24 24" fill="${name === 'play' ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="${name === 'pause' ? 4 : 1.9}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
}
document.querySelectorAll('[data-icon]').forEach(el => icon(el, el.dataset.icon));

let meta, frames = [], current = null, wanted = 0, revision = 0, rendering = false;
let mode = 'weather', playing = false, playTimer, sourceCounter = 0, cities = [], selectedPoint = null;
let pendingSources = new Map(), cityDrawQueued = false, frameErrors = new Set();
const intervalByURL = new Map();
const options = {
  ...defaultOmProtocolSettings,
  fileReaderConfig: { useSAB: false, retries: 2, cache: typeof caches==='undefined'?new LruBlockCache(65536,768):new FastBrowserBlockCache({cacheName:'weerlab-ecmwf-om-v1',blockSize:65536,memCacheTtlMs:15000,maxBytes:192*1024*1024,maxConcurrentFetches:8}) },
  maxStatesWithData: 14,
  clippingOptions: { bounds: EUROPE },
  colorScales: { ...defaultOmProtocolSettings.colorScales, ...scales },
  postReadCallback(reader, data, state) {
    const variable = state.dataOptions.variable;
    if (!data.values) return;
    if (variable === 'precipitation' || variable === 'snowfall_water_equivalent') {
      const hours = intervalByURL.get(state.omFileUrl);
      if (!hours) throw new Error('Neerslaginterval ontbreekt');
      for (let i = 0; i < data.values.length; i++) data.values[i] = hourlyRate(data.values[i], hours);
      if (data.scaleFactor) data.scaleFactor *= hours;
    } else if (variable === 'wind_u_component_10m') {
      // The library derives speed and meteorological direction from native u/v.
      for (let i = 0; i < data.values.length; i++) data.values[i] *= 3.6;
      if (data.scaleFactor) data.scaleFactor /= 3.6;
    }
  },
};
const domain = domainOptions.find(d => d.value === 'ecmwf_ifs');
const protocol = getProtocolInstance(options);
const fieldCache=new Map();
let fieldReads=0;
function trimFieldCache(){
  let bytes=[...fieldCache.values()].reduce((sum,e)=>sum+(e.bytes||0),0);
  while(fieldCache.size>16||(bytes>128*1024*1024&&fieldCache.size>4)){
    const key=fieldCache.keys().next().value;bytes-=fieldCache.get(key).bytes||0;fieldCache.delete(key);
  }
}
function readField(file,variable){
  const b=map.getBounds(),south=Math.max(EUROPE[1],b.getSouth()),north=Math.min(EUROPE[3],b.getNorth());
  // Reuse a decoded latitude band when moving east/west or zooming into it.
  for(const [cachedKey,entry] of fieldCache){
    if(entry.file===file&&entry.variable===variable&&entry.south<=south&&entry.north>=north){
      fieldCache.delete(cachedKey);fieldCache.set(cachedKey,entry);return entry.promise;
    }
  }
  const margin=Math.max(.2,(north-south)*.35);
  const bounds=[EUROPE[0],Math.max(EUROPE[1],south-margin),EUROPE[2],Math.min(EUROPE[3],north+margin)];
  const ranges=getRanges(domain.grid,bounds),key=file+'|'+variable+'|'+JSON.stringify(ranges);
  $('app').dataset.fieldReads=++fieldReads;
  const promise=wasmReady.then(()=>protocol.omFileReader.readVariable(file,variable,ranges)).then(data=>{
    options.postReadCallback(protocol.omFileReader,data,{dataOptions:{variable},omFileUrl:file});
    const field={data,grid:GridFactory.create(domain.grid,ranges),variable,key,ranges,gridData:domain.grid};
    const entry=fieldCache.get(key);
    if(entry)entry.bytes=data.values.byteLength+(data.directions?.byteLength||0)+(field.cloudLow?.byteLength||0)+(field.cloudHigh?.byteLength||0);
    trimFieldCache();
    return field;
  }).catch(error=>{fieldCache.delete(key);throw error;});
  fieldCache.set(key,{file,variable,south:bounds[1],north:bounds[3],promise});
  trimFieldCache();
  return promise;
}
mapEngine.setWeatherLoader(url=>{const u=new URL(url.replace(/^om:\/\//,'')),variable=u.searchParams.get('variable');return readField(u.origin+u.pathname,variable).then(field=>({...field,texture:$('texture').checked}));});
const params = new URLSearchParams(location.search);
const coords = (params.get('center') || '5.94,51.96').split(',').map(Number);
const initialCenter = inEurope(coords[0], coords[1]) ? coords : [5.94, 51.96];
const initialZoom = Math.min(10, Math.max(1, Number(params.get('zoom')) || 6.3));

const map = new mapEngine.Map({
  container:'map', center:initialCenter, zoom:initialZoom, maxZoom:11, minZoom:1,
  maxBounds:[[EUROPE[0], EUROPE[1]], [EUROPE[2], EUROPE[3]]],
  renderWorldCopies:false, attributionControl:false, dragRotate:false, pitchWithRotate:false,
  canvasContextAttributes:{antialias:true},
  style:{version:8, sources:{
    satellite:{type:'raster',tileSize:256,tiles:['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],maxzoom:17,attribution:'Kaart © Esri, Maxar, Earthstar Geographics'},
    countries:{type:'geojson',data:'./assets/countries.geojson'},
  }, layers:[
    {id:'background',type:'background',paint:{'background-color':'#346580'}},
    {id:'satellite',type:'raster',source:'satellite',paint:{'raster-saturation':-.2,'raster-contrast':-.08,'raster-brightness-min':.12,'raster-brightness-max':.87}},
    {id:'borders',type:'line',source:'countries',paint:{'line-color':'#233734','line-opacity':.75,'line-width':['interpolate',['linear'],['zoom'],3,.45,7,1.15,10,1.6]}},
  ]},
});
map.touchZoomRotate.disableRotation();
map.addControl(new mapEngine.AttributionControl({compact:true,customAttribution:'<a href="https://open-meteo.com/" target="_blank" rel="noopener">ECMWF / Open-Meteo</a> · Natural Earth'}),'bottom-right');
map.addControl(new mapEngine.ScaleControl({maxWidth:100,unit:'metric'}),'bottom-left');
const mapReady = new Promise(resolve => map.once('load',resolve));
map.on('error', e => {
  if (e.sourceId && pendingSources.has(e.sourceId)) {
    frameErrors.add(e.sourceId);
    pendingSources.get(e.sourceId)?.();
  }
  else if(current?.ids.includes(e.sourceId))status('Kaartdeel kon niet worden opgehaald. Probeer opnieuw.',true);
});
map.on('move', queueCityDraw);
map.on('resize', queueCityDraw);
map.on('moveend', () => {
  const b=map.getBounds(); updateCurrentBounds([b.getWest(),b.getSouth(),b.getEast(),b.getNorth()]);
  if (current) updateViewportSamples();
  const c=map.getCenter(), u=new URL(location.href);
  u.searchParams.set('center',`${c.lng.toFixed(4)},${c.lat.toFixed(4)}`);u.searchParams.set('zoom',map.getZoom().toFixed(2));
  history.replaceState(null,'',u);
});
let viewportRevision=0;
async function updateViewportSamples(){
  const rev=++viewportRevision,frame=current,started=performance.now();
  try{
    // Leaflet extends the existing tile layers by itself; rebuilding all layers
    // here caused avoidable downloads, duplicated rendering and flashing on pan.
    const vars=[...new Set([...variablesForMode(),'temperature_2m'])];
    const fields=await Promise.all(vars.map(v=>readField(frame.url,v)));
    if(rev!==viewportRevision||current!==frame)return;
    vars.forEach((v,i)=>{current.samples[v]=fields[i];});queueCityDraw();updatePoint();
    $('app').dataset.panDataMs=Math.round(performance.now()-started);
  }catch(error){if(rev===viewportRevision)status(error.message,true);}
}
  map.on('click',e => {
  if(!inEurope(e.lngLat.lng,e.lngLat.lat))return;
  const near=drawnCities.find(c=>Math.hypot(c.x-e.point.x,c.y-e.point.y)<28);
  showPoint(near ? {lng:near.lon,lat:near.lat,name:near.name} : {...e.lngLat,name:`${e.lngLat.lat.toFixed(2)}° N, ${e.lngLat.lng.toFixed(2)}° E`});
});

function status(text, error=false) {
  $('status-text').textContent=text;$('status').classList.toggle('error',error);$('status').hidden=false;$('retry').hidden=!error;
}
async function json(url, signal) {
  const response=await fetch(url,{signal:signal || AbortSignal.timeout(16000),cache:'no-cache'});
  if(!response.ok) throw new Error(`Bron niet bereikbaar (${response.status})`);
  return response.json();
}
let runCacheTime=0;
async function discoverRun(now) {
  try{
    const saved=JSON.parse(localStorage.getItem('weerlab-ecmwf-run'));
    if(saved&&now-saved.savedAt<5*60*1000&&hasFullHorizon(saved.meta,now)){forecastFrames(saved.meta,now);runCacheTime=saved.savedAt;return saved.meta;}
  }catch{}
  runCacheTime=now;
  const latest=await json(`${DATA_ROOT}/latest.json`);
  // Side runs only cover 144h. Never fill the last day with a different run/model.
  if(hasFullHorizon(latest,now)) {
    try { forecastFrames(latest,now);return latest; } catch {}
  }
  const ref=Date.parse(latest.reference_time);
  if(!Number.isFinite(ref)) throw new Error('ECMWF-modeltijd ontbreekt');
  for(let back=6;back<=36;back+=6){
    const run=ref-back*HOUR;
    if(new Date(run).getUTCHours()%12) continue;
    try {
      const candidate=await json(`${DATA_ROOT}/${runPath(run)}/meta.json`);
      if(hasFullHorizon(candidate,now)){forecastFrames(candidate,now);return candidate;}
    } catch {}
  }
  throw new Error('Geen complete ECMWF-run voor tien dagen beschikbaar');
}

async function start() {
  stopPlayback();status('Complete ECMWF-run voor tien dagen ophalen…');
  try {
    const now=Date.now();
    meta=await discoverRun(now);$('app').dataset.metadataReadyMs=Math.round(performance.now());
    frames=forecastFrames(meta,now);
    try{localStorage.setItem('weerlab-ecmwf-run',JSON.stringify({savedAt:runCacheTime,meta}));}catch{}
    frames.forEach(f=>intervalByURL.set(f.url,f.hours));
    await mapReady;
    const b=map.getBounds();updateCurrentBounds([b.getWest(),b.getSouth(),b.getEast(),b.getNorth()]);
    buildTimeline();
    $('app').dataset.model='ecmwf_ifs';$('app').dataset.run=meta.reference_time;
    $('app').dataset.forecastStart=frames[0].iso;$('app').dataset.forecastEnd=frames.at(-1).iso;
    $('run-label').textContent=`ECMWF IFS HRES · 9 km · run ${fmt(meta.reference_time,{day:'numeric',month:'short'})} ${new Date(meta.reference_time).getUTCHours().toString().padStart(2,'0')} UTC`;
    const age=(now-Date.parse(meta.reference_time))/HOUR;
    $('run-label').title=`Bron bijgewerkt: ${fmt(meta.last_modified_time,{dateStyle:'medium',timeStyle:'short'})}${age>24?' · Let op: modelrun ouder dan 24 uur':''}`;
    if(age>24) $('run-label').textContent+=' · oudere run';
    ['play','previous','next','time-slider'].forEach(id=>$(id).disabled=false);
    requestFrame(0,true);
  } catch(error) {status(`${error.message}. Probeer opnieuw.`,true);}
}

function buildTimeline(){
  const unique=[...new Set(frames.map(f=>localDateKey(f.time)))];
  const container=$('days');container.replaceChildren();
  unique.forEach((key,i)=>{
    const dayFrames=frames.filter(f=>localDateKey(f.time)===key);
    const target=dayFrames.reduce((best,f)=>Math.abs(Number(fmt(f.time,{hour:'numeric',hourCycle:'h23'}))-12)<Math.abs(Number(fmt(best.time,{hour:'numeric',hourCycle:'h23'}))-12)?f:best);
    const button=document.createElement('button');button.type='button';button.dataset.day=key;button.dataset.short=fmt(target.time,{weekday:'short'}).replace('.','');
    const name=i===0?'vandaag':i===1?'morgen':fmt(target.time,{weekday:'short'}).replace('.','');
    button.textContent=name;const small=document.createElement('small');small.textContent=fmt(target.time,{day:'numeric'});button.append(small);
    button.title=fmt(target.time,{dateStyle:'full'});button.setAttribute('aria-pressed','false');
    button.setAttribute('aria-label',button.title);
    button.addEventListener('click',()=>{stopPlayback();requestFrame(frames.indexOf(i===0?dayFrames[0]:target));});container.append(button);
  });
  const end=(frames.at(-1).time-frames[0].time)/HOUR;
  $('time-slider').max=end;$('range-end').textContent=`+${FORECAST_DAYS} dagen`;
  $('time-ticks').replaceChildren();
  for(let i=0;i<=FORECAST_DAYS;i++){const tick=document.createElement('span');tick.textContent=i?`+${i}d`:'nu';$('time-ticks').append(tick);}
}
function variablesForMode(){
  if(mode==='temperature') return ['temperature_2m'];
  if(mode==='wind') return ['wind_u_component_10m'];
  return [...(mode==='weather'&&$('clouds').checked?['cloud_cover']:[]),'precipitation',...($('snow').checked&&meta.variables.includes('snowfall_water_equivalent')?['snowfall_water_equivalent']:[])];
}
function weatherURL(frame,variable){return `om://${frame.url}?variable=${variable}&interpolation=linear&color_blend=true`;}
function addLayer(frame,variable,prefix){
  const id=`${prefix}-${variable}`;
  map.addSource(id,{type:'raster',url:weatherURL(frame,variable),tileSize:256,maxzoom:10});
  map.addLayer({id,type:'raster',source:id,paint:{'raster-opacity':.00001,'raster-fade-duration':0}},'borders');
  return id;
}
function removeLayers(ids){for(const id of ids){pendingSources.delete(id);frameErrors.delete(id);if(map.getLayer(id)) map.removeLayer(id);if(map.getSource(id)) map.removeSource(id);}}
function awaitSources(ids){
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);map.off('sourcedata',check);ids.forEach(id=>pendingSources.delete(id));};
    const check=()=>{
      if(ids.some(id=>frameErrors.has(id))){cleanup();reject(new Error('Een ECMWF-weerlaag kon niet worden geladen'));return;}
      if(ids.every(id=>map.getSource(id)&&map.isSourceLoaded(id))){cleanup();resolve();}
    };
    const timer=setTimeout(()=>{cleanup();reject(new Error('Het laden van de ECMWF-kaart duurt te lang'));},45000);
    ids.forEach(id=>pendingSources.set(id,check));map.on('sourcedata',check);check();
  });
}
async function readTemperature(frame){
  return readField(frame.url,'temperature_2m');
}
async function renderFrame(index,rev){
  const started=performance.now();
  const frame=frames[index], layerMode=mode, vars=variablesForMode();
  const ids=vars.map(v=>addLayer(frame,v,`frame${sourceCounter}`));sourceCounter++;
  // The first view can reveal finished layers immediately. Later time changes
  // remain atomic, so there is never a mixture of different forecast hours.
  let reveal;
  if(!current){
    $('valid-clock').textContent=fmt(frame.time,{hour:'2-digit',minute:'2-digit'});
    $('valid-day').textContent=fmt(frame.time,{weekday:'short',day:'numeric',month:'short'});
    reveal=()=>{
      if(rev!==revision)return;
      for(const id of ids)if(map.isSourceLoaded(id)&&!frameErrors.has(id)){
        map.setPaintProperty(id,'raster-opacity',Number($('opacity').value)/100);
        if(!id.endsWith('snowfall_water_equivalent')&&!$('app').dataset.firstVisibleWeatherMs){$('app').dataset.firstVisibleWeatherMs=Math.round(performance.now());$('app').dataset.firstVisibleLayer=id;}
      }
    };
    map.on('sourcedata',reveal);
  }
  status(`Laden: ${fmt(frame.time,{weekday:'short',hour:'2-digit',minute:'2-digit'})}…`);
  $('app').dataset.frameStatus='loading';
  try {
    const [,temperature,...fields]=await Promise.all([awaitSources(ids),readTemperature(frame),...vars.map(v=>readField(frame.url,v))]);
    if(rev!==revision){removeLayers(ids);return false;}
    const samples={temperature_2m:temperature};
    vars.forEach((v,i)=>{samples[v]=fields[i];});
    const old=current;
    current={...frame,index,ids,mode:layerMode,samples};
    ids.forEach(id=>map.setPaintProperty(id,'raster-opacity',Number($('opacity').value)/100));
    if(old) removeLayers(old.ids);
    syncUI();queueCityDraw();updatePoint();$('status').hidden=true;
    $('app').dataset.frameStatus='ready';$('app').dataset.validTime=frame.iso;$('app').dataset.intervalHours=frame.hours;
    $('app').dataset.frameLoadMs=Math.round(performance.now()-started);
    if(!$('app').dataset.firstWeatherMs)$('app').dataset.firstWeatherMs=Math.round(performance.now());
    loadMapDetails();
    return true;
  } catch(error){
    removeLayers(ids);
    if(rev!==revision)return false;
    stopPlayback();$('app').dataset.frameStatus='error';
    status(`${error.message}. ${current?'De vorige tijdstap blijft zichtbaar.':''}`,true);
    return false;
  }finally{if(reveal)map.off('sourcedata',reveal);}
}
let detailsStarted=false;
function loadMapDetails(){
  if(detailsStarted)return;detailsStarted=true;
  map.loadDetails();
  fetch('./assets/cities.json').then(r=>{if(!r.ok)throw new Error('Plaatsnamen laden mislukt');return r.json();}).then(places=>{cities=places;queueCityDraw();}).catch(()=>{detailsStarted=false;});
}
async function requestFrame(index,force=false){
  if(!frames.length)return;
  wanted=Math.min(frames.length-1,Math.max(0,index));revision++;
  if(rendering)return;
  if(!force&&current?.index===wanted&&current.mode===mode){syncUI();return;}
  rendering=true;
  let success=false;
  try {
    let targetRevision;
    do {targetRevision=revision;success=await renderFrame(wanted,targetRevision);}while(targetRevision!==revision);
  } finally {rendering=false;}
  if(success){
    // Warm the next frame without keeping old decoded rasters indefinitely.
    const next=frames[(wanted+1)%frames.length];
    Promise.allSettled([...variablesForMode(),'temperature_2m'].map(v=>readField(next.url,v)));
    if(playing)scheduleNext();
  }
}
function syncUI(){
  if(!current)return;
  const f=current;$('valid-clock').textContent=fmt(f.time,{hour:'2-digit',minute:'2-digit'});
  $('valid-day').textContent=fmt(f.time,{weekday:'short',day:'numeric',month:'short'});
  $('slider-time').textContent=fmt(f.time,{weekday:'long',hour:'2-digit',minute:'2-digit'});
  $('time-slider').value=(f.time-frames[0].time)/HOUR;
  $('time-slider').setAttribute('aria-valuetext',fmt(f.time,{dateStyle:'full',timeStyle:'short'}));
  $('time-slider').style.background=`linear-gradient(to right,#ffdf00 ${$('time-slider').value/$('time-slider').max*100}%,#679db7 0)`;
  document.querySelectorAll('#days button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.day===localDateKey(f.time))));
  document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===f.mode)));
  $('previous').disabled=f.index===0;$('next').disabled=f.index===frames.length-1;
  $('interval-label').textContent=`ECMWF IFS · 9 km · ${f.hours}u ${(f.mode==='weather'||f.mode==='rain')?'neerslaggem.':'tijdstap'}`;
  $('load-label').textContent=`Verwachting · +${f.lead} uur`;
  const legend=$('legend');let title,unit,numbers,gradient;
  if(f.mode==='temperature'){title='Temperatuur';unit='°C';numbers=['−10','0','10','20','30+'];gradient='linear-gradient(to right,#366dd0,#4fc5da,#88d069,#fbd358,#e8693b)';}
  else if(f.mode==='wind'){title='Wind';unit='km/u';numbers=['0','20','40','60','100+'];gradient='linear-gradient(to right,#66c2d0,#53ca89,#e9cc48,#ee9131,#bc3379)';}
  else{title='Neerslag';unit='mm/u';numbers=['0,05','0,3','1','4','16+'];gradient='';}
  $('layer-title').textContent=f.mode==='weather'?'Weerradar':title;
  legend.querySelector('span').firstChild.textContent=title+' ';legend.querySelector('small').textContent=unit;
  legend.querySelector('.legend-colors').style.background=gradient;
  legend.querySelectorAll('.legend-numbers span').forEach((el,i)=>el.textContent=numbers[i]);
}
function stopPlayback(){playing=false;clearTimeout(playTimer);icon($('play'),'play');$('play').setAttribute('aria-label','Animatie afspelen');}
function scheduleNext(){clearTimeout(playTimer);playTimer=setTimeout(()=>{if(playing)requestFrame((wanted+1)%frames.length);},Number($('speed').value));}
$('play').addEventListener('click',()=>{
  if(playing){stopPlayback();return;}playing=true;icon($('play'),'pause');$('play').setAttribute('aria-label','Animatie pauzeren');if(!rendering)requestFrame((wanted+1)%frames.length);
});
$('previous').addEventListener('click',()=>{stopPlayback();requestFrame(wanted-1);});
$('next').addEventListener('click',()=>{stopPlayback();requestFrame(wanted+1);});
let sliderTimer;
$('time-slider').addEventListener('input',()=>{stopPlayback();clearTimeout(sliderTimer);const target=nearestIndex(frames,frames[0].time+Number($('time-slider').value)*HOUR);$('slider-time').textContent=fmt(frames[target].time,{weekday:'long',hour:'2-digit',minute:'2-digit'});sliderTimer=setTimeout(()=>requestFrame(target),130);});
document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{stopPlayback();mode=b.dataset.mode;requestFrame(wanted,true);}));
['clouds','snow','texture'].forEach(id=>$(id).addEventListener('change',()=>requestFrame(wanted,true)));
$('city-labels').addEventListener('change',queueCityDraw);
$('borders').addEventListener('change',()=>map.setLayoutProperty('borders','visibility',$('borders').checked?'visible':'none'));
$('opacity').addEventListener('input',()=>current?.ids.forEach(id=>map.setPaintProperty(id,'raster-opacity',Number($('opacity').value)/100)));
$('speed').addEventListener('change',()=>{if(playing&&!rendering)scheduleNext();});
$('zoom-in').addEventListener('click',()=>map.zoomIn());$('zoom-out').addEventListener('click',()=>map.zoomOut());
$('europe').addEventListener('click',()=>map.fitBounds([[-24,34],[42,70]],{padding:{top:105,bottom:185,left:45,right:75},duration:600}));
$('home').addEventListener('click',()=>map.flyTo({center:[5.3,51.6],zoom:7,duration:650}));
$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('app').requestFullscreen();}catch{status('Volledig scherm is niet beschikbaar in deze browser.',true);}});
$('settings-toggle').addEventListener('click',()=>{const open=$('settings').hidden;$('settings').hidden=!open;$('settings-toggle').setAttribute('aria-expanded',String(open));});
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>{$(b.dataset.close).hidden=true;$('settings-toggle').setAttribute('aria-expanded','false');}));
$('info-toggle').addEventListener('click',()=>$('info').showModal());$('info-close').addEventListener('click',()=>$('info').close());
$('info').addEventListener('click',e=>{if(e.target===$('info')){const r=$('info').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('info').close();}});
$('retry').addEventListener('click',()=>frames.length?requestFrame(wanted,true):start());
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){$('settings').hidden=true;$('settings-toggle').setAttribute('aria-expanded','false');$('search-form').hidden=true;closePoint();}
  if(e.target.closest('input,select,button,dialog')||$('info').open)return;
  if(e.code==='Space'){e.preventDefault();$('play').click();}
  if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();stopPlayback();requestFrame(wanted+(e.key==='ArrowRight'?1:-1));}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopPlayback();});

function sample(sampleData,lat,lon){
  if(!sampleData?.data?.values)return NaN;
  return sampleData.grid.getInterpolatedValue(sampleData.data.values,lat,lon,'linear');
}
let drawnCities=[];
function queueCityDraw(){if(!cityDrawQueued){cityDrawQueued=true;requestAnimationFrame(()=>{cityDrawQueued=false;drawCities();});}}
function sun(ctx,x,y,size){ctx.strokeStyle='#ffee38';ctx.fillStyle='#ffee38';ctx.lineWidth=1;for(let i=0;i<8;i++){const a=i*Math.PI/4;ctx.beginPath();ctx.moveTo(x+Math.cos(a)*size*1.25,y+Math.sin(a)*size*1.25);ctx.lineTo(x+Math.cos(a)*size*1.7,y+Math.sin(a)*size*1.7);ctx.stroke();}ctx.beginPath();ctx.arc(x,y,size,0,Math.PI*2);ctx.fill();}
function daylight(lat,lon,time){const d=new Date(time),day=(time-Date.UTC(d.getUTCFullYear(),0,0))/86400000,decl=23.44*Math.PI/180*Math.sin(2*Math.PI*(284+day)/365.25),h=(d.getUTCHours()+d.getUTCMinutes()/60+lon/15-12)*Math.PI/12,phi=lat*Math.PI/180;return Math.sin(phi)*Math.sin(decl)+Math.cos(phi)*Math.cos(decl)*Math.cos(h)>0;}
function skyIcon(ctx,x,y,city){if(daylight(city.lat,city.lon,current.time)){sun(ctx,x,y,4.3);return;}ctx.fillStyle='#ffee38';ctx.beginPath();ctx.arc(x,y,6,-Math.PI/2,Math.PI/2);ctx.quadraticCurveTo(x+3,y,x,y-6);ctx.fill();}
function drawCities(){
  const canvas=$('places'),ctx=canvas.getContext('2d'),width=map.getCanvas().clientWidth,height=map.getCanvas().clientHeight,dpr=Math.min(2,devicePixelRatio||1);
  if(canvas.width!==Math.round(width*dpr)||canvas.height!==Math.round(height*dpr)){canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);}
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);drawnCities=[];
  if(!$('city-labels').checked||!current)return;
  const zoom=map.getZoom(), boxes=[], font=zoom<5?11:12;
  for(const city of cities){
    if(city.minZoom>zoom)continue;
    const p=map.project([city.lon,city.lat]);
    if(p.x<25||p.x>width-25||p.y<20||p.y>height-25)continue;
    if(p.y>height-160&&Math.abs(p.x-width/2)<Math.min(width/2,500))continue;
    const name=city.name, w=Math.max(50,name.length*font*.53), rect=[p.x-w/2-9,p.y-30,p.x+w/2+9,p.y+18];
    if(boxes.some(b=>rect[0]<b[2]&&rect[2]>b[0]&&rect[1]<b[3]&&rect[3]>b[1]))continue;
    boxes.push(rect);
    const temp=sample(current.samples.temperature_2m,city.lat,city.lon),cloud=sample(current.samples.cloud_cover,city.lat,city.lon),rain=sample(current.samples.precipitation,city.lat,city.lon);
    ctx.font=`500 ${font}px Arial`;ctx.textAlign='center';ctx.lineJoin='round';ctx.lineWidth=2.7;ctx.strokeStyle='rgba(28,42,42,.7)';ctx.fillStyle='#f4f6f7';
    ctx.strokeText(name,p.x,p.y+12);ctx.fillText(name,p.x,p.y+12);
    ctx.fillStyle='#f5f8e9';ctx.fillRect(p.x-1.3,p.y-4,2.6,2.6);
    const displayedValue=current.mode==='wind'?sample(current.samples.wind_u_component_10m,city.lat,city.lon):temp;
    if(Number.isFinite(displayedValue)){const t=String(Math.round(displayedValue));ctx.font=`600 ${font}px Arial`;ctx.strokeText(t,p.x+7,p.y-12);ctx.fillStyle='#f3f663';ctx.fillText(t,p.x+7,p.y-12);}
    if(Number.isFinite(cloud)&&cloud<35&&!(rain>.1))skyIcon(ctx,p.x-13,p.y-16,city);
    else if(Number.isFinite(cloud)&&cloud<65){sun(ctx,p.x-15,p.y-17,3.7);ctx.fillStyle='#ebeded';ctx.beginPath();ctx.ellipse(p.x-11,p.y-14,6,3,0,0,Math.PI*2);ctx.fill();}
    if(current.mode==='wind'){
      const wind=current.samples.wind_u_component_10m;
      if(wind?.data.directions){const a=wind.grid.getLinearInterpolatedDirection(wind.data.directions,city.lat,city.lon)*Math.PI/180;ctx.save();ctx.translate(p.x-16,p.y-17);ctx.rotate(a+Math.PI);ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(0,7);ctx.lineTo(0,-7);ctx.lineTo(-3,-3);ctx.moveTo(0,-7);ctx.lineTo(3,-3);ctx.stroke();ctx.restore();}
    }
    drawnCities.push({...city,x:p.x,y:p.y});
  }
}

let pointMarker;
function showPoint(point){selectedPoint=point;if(pointMarker)pointMarker.remove();pointMarker=new mapEngine.Marker({color:'#ffdf00',scale:.7}).setLngLat([point.lng,point.lat]).addTo(map);$('point').hidden=false;$('search-form').hidden=true;updatePoint();}
function closePoint(){selectedPoint=null;$('point').hidden=true;pointMarker?.remove();pointMarker=null;}
$('point-close').addEventListener('click',closePoint);
function updatePoint(fetchMissing=true){
  if(!selectedPoint||!current)return;
  const p=selectedPoint;$('point-title').textContent=p.name;$('point-time').textContent=fmt(current.time,{dateStyle:'full',timeStyle:'short'});
  const values=$('point-values');values.replaceChildren();
  const entries=[['temperature_2m','Temperatuur','°C',1],['precipitation',`Neerslag · ${current.hours}u-gemiddelde`,'mm/u',2],['cloud_cover','Bewolking','%',0],['wind_u_component_10m','Wind','km/u',0]];
  for(const [variable,label,unit,digits] of entries){
    const value=sample(current.samples[variable],p.lat,p.lng),el=document.createElement('div'),strong=document.createElement('strong'),small=document.createElement('small');
    strong.textContent=Number.isFinite(value)?`${value.toLocaleString('nl-NL',{maximumFractionDigits:digits})} ${unit}`:'—';small.textContent=label;el.append(strong,small);values.append(el);
  }
  $('point-note').textContent=`Rooster circa 9 km. Neerslag gemiddeld over ${fmt(current.time-current.hours*HOUR,{hour:'2-digit',minute:'2-digit'})}–${fmt(current.time,{hour:'2-digit',minute:'2-digit'})}.`;
  if(fetchMissing){
    const frame=current,missing=entries.map(e=>e[0]).filter(v=>!frame.samples[v]);
    if(missing.length)Promise.allSettled(missing.map(async v=>{const field=await readField(frame.url,v);if(current===frame)frame.samples[v]=field;})).then(()=>{if(current===frame&&selectedPoint===p)updatePoint(false);});
  }
}

$('search-toggle').addEventListener('click',()=>{$('search-form').hidden=!$('search-form').hidden;if(!$('search-form').hidden)$('search').focus();});
let searchController;
const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function searchButtons(results){
  $('search-results').replaceChildren();
  for(const result of results){const b=document.createElement('button');b.type='button';b.textContent=result.name;const small=document.createElement('small');small.textContent=result.detail||'Europa';b.append(small);b.addEventListener('click',()=>{showPoint({lng:result.lon,lat:result.lat,name:result.name});map.flyTo({center:[result.lon,result.lat],zoom:8,duration:700});});$('search-results').append(b);}
}
$('search').addEventListener('input',()=>{searchController?.abort();const q=normalize($('search').value.trim());searchButtons(q.length<2?[]:cities.filter(c=>normalize(c.name).includes(q)).slice(0,7));});
$('search-form').addEventListener('submit',async e=>{
  e.preventDefault();const q=$('search').value.trim();if(q.length<2)return;
  searchController?.abort();searchController=new AbortController();const controller=searchController;
  const ll=q.match(/^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/);
  if(ll){const lat=Number(ll[1]),lon=Number(ll[2]);if(inEurope(lon,lat)){showPoint({lat,lng:lon,name:`${lat}° N, ${lon}° E`});map.flyTo({center:[lon,lat],zoom:8});return;}}
  const local=cities.filter(c=>normalize(c.name).includes(normalize(q))).slice(0,7);searchButtons(local);
  try{
    const data=await json(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({name:q,count:'10',language:'nl',format:'json'})}`,controller.signal);
    if(controller!==searchController)return;
    const results=(data.results||[]).filter(r=>inEurope(r.longitude,r.latitude)).map(r=>({name:r.name,lon:r.longitude,lat:r.latitude,detail:[r.admin1,r.country].filter(Boolean).join(' · ')}));
    if(results.length)searchButtons(results);else if(!local.length)$('search-results').textContent='Geen plaats in Europa gevonden.';
  }catch(error){if(error.name!=='AbortError'&&!local.length)$('search-results').textContent='Zoeken is tijdelijk niet beschikbaar. Probeer een andere plaats.';}
});

// Metadata is refreshed when the user returns after a long pause. Current frames
// are kept fixed during an animation, so a run can never change halfway through.
let checkedAt=Date.now();
window.addEventListener('focus',()=>{if(Date.now()-checkedAt>30*60*1000){checkedAt=Date.now();start();}});
start();
