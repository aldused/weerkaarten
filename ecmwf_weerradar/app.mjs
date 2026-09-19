import {precipitationLegend,PRECIPITATION_THRESHOLD} from './precipitation-colors.mjs';
import {precipitationPeriod} from './precipitation.mjs';
import { forecastLabel, groupForecastDays } from './timeline.mjs';
import * as mapEngine from './map.mjs';
import { defaultOmProtocolSettings, updateCurrentBounds, getProtocolInstance, domainOptions, GridFactory, getRanges } from '@openmeteo/weather-map-layer';
import { LruBlockCache, initWasm } from '@openmeteo/file-reader';
import { FastBrowserBlockCache } from './fast-block-cache.mjs';
import { createSharedTask, consumeTask } from './shared-task.mjs';
import { DATA_ROOT, EUROPE, HOUR, FORECAST_DAYS, runPath, hasFullHorizon, forecastFrames, nearestIndex, normalizeFieldData, localDateKey, fmt, scales, inEurope } from './core.mjs';

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
  down:'m5 9 7 7 7-7', up:'m5 15 7-7 7 7', left:'m15 4-8 8 8 8', right:'m9 4 8 8-8 8', play:'m7 3 14 9-14 9Z', pause:'M8 4v16M16 4v16',
  info:'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 10v7M12 6v1',
};
function icon(el, name) {
  el.innerHTML = `<svg viewBox="0 0 24 24" fill="${name === 'play' ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="${name === 'pause' ? 4 : 1.9}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name]}"/></svg>`;
}
document.querySelectorAll('[data-icon]').forEach(el => icon(el, el.dataset.icon));
const modeNames={weather:'Weer',rain:'Neerslag',temperature:'Temperatuur',wind:'Wind'};
document.querySelectorAll('[data-mode]').forEach(button=>{const label=document.createElement('span');label.textContent=modeNames[button.dataset.mode];button.append(label);});
const settingsLabel=document.createElement('span');settingsLabel.textContent='Lagen';$('settings-toggle').append(settingsLabel);

let meta, frames = [], current = null, wanted = 0, revision = 0, rendering = false, refreshing = false;
let requestedContext = null, startupRevision = 0;
let retryLoad = () => start();
let mode = 'weather', playing = false, playTimer, sourceCounter = 0, cities = [], selectedPoint = null;
let pendingSources = new Map(), cityDrawQueued = false, frameErrors = new Set();
const intervalByURL = new Map();
const options = {
  ...defaultOmProtocolSettings,
  fileReaderConfig: { ...defaultOmProtocolSettings.fileReaderConfig, useSAB: false, retries: 2, cache: typeof caches==='undefined'?new LruBlockCache(65536,768):new FastBrowserBlockCache({cacheName:'weerlab-ecmwf-om-v1',blockSize:65536,memCacheTtlMs:15000,maxBytes:192*1024*1024,maxConcurrentFetches:8}) },
  maxStatesWithData: 14,
  clippingOptions: { bounds: EUROPE },
  colorScales: { ...defaultOmProtocolSettings.colorScales, ...scales },
  postReadCallback(reader, data, state) {
    normalizeFieldData(data,state.dataOptions.variable,intervalByURL.get(state.omFileUrl));
  },
};
const domain = domainOptions.find(d => d.value === 'ecmwf_ifs');
const protocol = getProtocolInstance(options);
const fieldCache=new Map();
let fieldReads=0;
function trimFieldCache(){
  let bytes=[...fieldCache.values()].reduce((sum,e)=>sum+(e.bytes||0),0);
  while(fieldCache.size>16||(bytes>128*1024*1024&&fieldCache.size>4)){
    const key=[...fieldCache].find(([,e])=>e.task.settled||e.task.controller.signal.aborted)?.[0];
    if(!key)break;bytes-=fieldCache.get(key).bytes||0;fieldCache.delete(key);
  }
}
function readField(file,variable,signal){
  signal?.throwIfAborted();
  const b=map.getBounds(),south=Math.max(EUROPE[1],b.getSouth()),north=Math.min(EUROPE[3],b.getNorth());
  // Reuse a decoded latitude band when moving east/west or zooming into it.
  for(const [cachedKey,entry] of fieldCache){
    if(!entry.task.controller.signal.aborted&&entry.file===file&&entry.variable===variable&&entry.south<=south&&entry.north>=north){
      fieldCache.delete(cachedKey);fieldCache.set(cachedKey,entry);return consumeTask(entry.task,signal);
    }
  }
  const margin=Math.max(.2,(north-south)*.35);
  const bounds=[EUROPE[0],Math.max(EUROPE[1],south-margin),EUROPE[2],Math.min(EUROPE[3],north+margin)];
  const ranges=getRanges(domain.grid,bounds),key=file+'|'+variable+'|'+JSON.stringify(ranges);
  $('app').dataset.fieldReads=++fieldReads;
  const task=createSharedTask(async readSignal=>{
    await wasmReady;readSignal.throwIfAborted();
    const data=await protocol.omFileReader.readVariable(file,variable,ranges,readSignal);
    options.postReadCallback(protocol.omFileReader,data,{dataOptions:{variable},omFileUrl:file});
    const field={data,grid:GridFactory.create(domain.grid,ranges),variable,key,ranges,gridData:domain.grid};
    const entry=fieldCache.get(key);
    if(entry)entry.bytes=data.values.byteLength+(data.directions?.byteLength||0)+(field.cloudLow?.byteLength||0)+(field.cloudHigh?.byteLength||0);
    trimFieldCache();
    return field;
  });
  task.promise.catch(()=>{if(fieldCache.get(key)?.task===task)fieldCache.delete(key);});
  fieldCache.set(key,{file,variable,south:bounds[1],north:bounds[3],task});
  trimFieldCache();
  return consumeTask(task,signal);
}
mapEngine.setWeatherLoader((url,signal)=>{const u=new URL(url.replace(/^om:\/\//,'')),variable=u.searchParams.get('variable');return readField(u.origin+u.pathname,variable,signal).then(field=>({...field,texture:$('texture').checked}));});
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
let viewportRevision=0,viewportController;
async function updateViewportSamples(){
  viewportController?.abort();viewportController=new AbortController();
  const rev=++viewportRevision,frame=current,started=performance.now(),signal=viewportController.signal;
  try{
    // Leaflet extends the existing tile layers by itself; rebuilding all layers
    // here caused avoidable downloads, duplicated rendering and flashing on pan.
    const vars=[...new Set([...variablesForMode(),'temperature_2m'])];
    const fields=await Promise.all(vars.map(v=>readField(frame.url,v,signal)));
    if(rev!==viewportRevision||current!==frame)return;
    vars.forEach((v,i)=>{current.samples[v]=fields[i];});queueCityDraw();updatePoint();
    $('app').dataset.panDataMs=Math.round(performance.now()-started);
  }catch(error){if(rev===viewportRevision&&error.name!=='AbortError')status(error.message,true);}
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
  const startup=++startupRevision;
  retryLoad=()=>start();
  refreshing=true;stopPlayback();clearTimeout(sliderTimer);revision++;renderController?.abort();status('Complete ECMWF-run voor tien dagen ophalen…');
  try {
    const now=Date.now();
    const candidateMeta=await discoverRun(now);
    if(startup!==startupRevision)return;
    const timeline=forecastFrames(candidateMeta,now);
    $('app').dataset.metadataReadyMs=Math.round(performance.now());
    try{localStorage.setItem('weerlab-ecmwf-run',JSON.stringify({savedAt:runCacheTime,meta:candidateMeta}));}catch{}
    timeline.forEach(f=>intervalByURL.set(f.url,f.hours));
    await mapReady;
    if(startup!==startupRevision)return;
    const b=map.getBounds();updateCurrentBounds([b.getWest(),b.getSouth(),b.getEast(),b.getNorth()]);
    // A refresh preserves the chosen forecast time where the new run permits
    // it. The previous run and its controls stay together until a full frame
    // from this candidate has loaded successfully.
    const selectedTime=requestedContext?.timeline[wanted]?.time??current?.time;
    const index=selectedTime===undefined?0:nearestIndex(timeline,selectedTime);
    refreshing=false;requestFrame(index,true,{meta:candidateMeta,timeline});
  } catch(error) {
    if(startup!==startupRevision)return;
    if(current){wanted=current.index;requestedContext={meta:current.modelMeta,timeline:current.timeline};}
    refreshing=false;status(`${error.message}. ${current?'De vorige modelrun blijft zichtbaar. ':''}Probeer opnieuw.`,true);
  }
}

let dayGroups=[],timelineDayKey='',hoursDayKey='';
function buildTimeline(timeline){
  dayGroups=groupForecastDays(timeline);timelineDayKey=localDateKey(Date.now());hoursDayKey='';
  const container=$('days');container.replaceChildren();
  for(const day of dayGroups){
    const button=document.createElement('button');button.type='button';button.dataset.day=day.key;
    button.textContent=day.label;const small=document.createElement('small');small.textContent=day.date;button.append(small);
    button.title=day.full;button.setAttribute('aria-label',day.full);button.setAttribute('aria-pressed','false');
    button.addEventListener('click',()=>{stopPlayback();requestFrame(day.target.index);});container.append(button);
  }
  $('time-slider').max=(timeline.at(-1).time-timeline[0].time)/HOUR;$('range-end').textContent=`+${FORECAST_DAYS} dagen`;
  $('time-ticks').replaceChildren();
  for(let i=0;i<=FORECAST_DAYS;i++){const tick=document.createElement('span');tick.textContent=i?`+${i}d`:'nu';$('time-ticks').append(tick);}
}
function showHours(day){
  $('hours-section').hidden=!day?.hoursVisible;
  if(!day?.hoursVisible){hoursDayKey='';return;}
  if(hoursDayKey===day.key)return;
  hoursDayKey=day.key;$('hours').replaceChildren();
  $('hours-day').textContent=`${day.label} · ${day.date}`;
  $('hours').setAttribute('aria-label',`Tijdstip op ${day.full}`);
  for(const entry of day.entries){
    const button=document.createElement('button');button.type='button';button.textContent=entry.label;button.dataset.index=entry.index;button.dataset.utc=entry.iso;
    button.setAttribute('aria-label',forecastLabel(entry.time).full);
    button.setAttribute('aria-pressed','false');button.addEventListener('click',()=>{stopPlayback();requestFrame(entry.index);});$('hours').append(button);
  }
}
function syncTimeChoices(frame,pending=false){
  if(!dayGroups.length)return;
  const key=localDateKey(frame.time),day=dayGroups.find(d=>d.key===key);
  showHours(day);
  for(const b of $('days').children){
    const active=b.dataset.day===key;
    b.classList.toggle('is-pending',pending&&active);b.setAttribute('aria-busy',String(pending&&active));
    if(!pending){const changed=b.getAttribute('aria-pressed')!=='true';b.setAttribute('aria-pressed',String(active));if(active&&changed)b.scrollIntoView({block:'nearest',inline:'nearest'});}
  }
  for(const b of $('hours').children){
    const active=Number(b.dataset.index)===frame.index;
    b.classList.toggle('is-pending',pending&&active);b.setAttribute('aria-busy',String(pending&&active));
    const changed=b.getAttribute('aria-pressed')!=='true';
    b.setAttribute('aria-pressed',String(!pending&&active||pending&&Number(b.dataset.index)===current?.index));
    if(active&&!pending&&changed)b.scrollIntoView({block:'nearest',inline:'center'});
  }
}
function setMenuCollapsed(collapsed){
  document.querySelector('.bottom-area').classList.toggle('is-collapsed',collapsed);
  $('menu-details').hidden=collapsed;$('menu-toggle').setAttribute('aria-expanded',String(!collapsed));
  const label=collapsed?'Menu uitklappen':'Menu inklappen';$('menu-toggle').setAttribute('aria-label',label);$('menu-toggle').title=label;icon($('menu-toggle'),collapsed?'up':'down');queueCityDraw();
}
$('menu-toggle').addEventListener('click',()=>setMenuCollapsed($('menu-toggle').getAttribute('aria-expanded')==='true'));
const shortViewport=matchMedia('(max-height: 650px)');
setMenuCollapsed(shortViewport.matches);
shortViewport.addEventListener('change',event=>{if(event.matches)setMenuCollapsed(true);});
// Only an actual menu size change updates layout; map motion never measures it.
new ResizeObserver(entries=>{document.documentElement.style.setProperty('--dock-height',`${Math.ceil(entries[0].contentRect.height)}px`);queueCityDraw();}).observe(document.querySelector('.bottom-area'));
function variablesForMode(modelMeta=meta){
  if(mode==='temperature') return ['temperature_2m'];
  if(mode==='wind') return ['wind_u_component_10m'];
  return [...(mode==='weather'&&$('clouds').checked?['cloud_cover']:[]),'precipitation',...($('snow').checked&&modelMeta.variables.includes('snowfall_water_equivalent')?['snowfall_water_equivalent']:[])];
}
function weatherURL(frame,variable){return `om://${frame.url}?variable=${variable}&interpolation=monotone&color_blend=true`;}
function addLayer(frame,variable,prefix){
  const id=`${prefix}-${variable}`;
  map.addSource(id,{type:'raster',url:weatherURL(frame,variable),tileSize:256,maxzoom:10});
  map.addLayer({id,type:'raster',source:id,paint:{'raster-opacity':.00001,'raster-fade-duration':0}},'borders');
  return id;
}
function removeLayers(ids){for(const id of ids){pendingSources.delete(id);frameErrors.delete(id);if(map.getLayer(id)) map.removeLayer(id);if(map.getSource(id)) map.removeSource(id);}}
function awaitSources(ids,signal){
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);map.off('sourcedata',check);ids.forEach(id=>pendingSources.delete(id));};
    const check=()=>{
      if(ids.some(id=>frameErrors.has(id))){cleanup();reject(new Error('Een ECMWF-weerlaag kon niet worden geladen'));return;}
      if(ids.every(id=>map.getSource(id)&&map.isSourceLoaded(id))){cleanup();resolve();}
    };
    const abort=()=>{cleanup();reject(signal.reason);};
    const timer=setTimeout(()=>{cleanup();reject(new Error('Het laden van de ECMWF-kaart duurt te lang'));},45000);
    signal?.addEventListener('abort',abort,{once:true});
    ids.forEach(id=>pendingSources.set(id,check));map.on('sourcedata',check);if(signal?.aborted)abort();else check();
  });
}
async function readTemperature(frame,signal){
  return readField(frame.url,'temperature_2m',signal);
}
async function renderFrame(index,rev,signal,context){
  const started=performance.now();
  const frame=context.timeline[index], modelMeta=context.meta, layerMode=mode, vars=variablesForMode(modelMeta);
  retryLoad=()=>requestFrame(index,true,context);
  const ids=vars.map(v=>addLayer(frame,v,`frame${sourceCounter}`));sourceCounter++;
  // The first view can reveal finished layers immediately. Later time changes
  // remain atomic, so there is never a mixture of different forecast hours.
  let reveal;
  if(!current){
    $('valid-clock').textContent=forecastLabel(frame.time).displayClock;
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
  status(`Laden: ${forecastLabel(frame.time).text}…`);
  $('app').dataset.frameStatus='loading';
  try {
    const [,temperature,...fields]=await Promise.all([awaitSources(ids,signal),readTemperature(frame,signal),...vars.map(v=>readField(frame.url,v,signal))]);
    if(rev!==revision){removeLayers(ids);return false;}
    const samples={temperature_2m:temperature};
    vars.forEach((v,i)=>{samples[v]=fields[i];});
    const old=current;
    meta=modelMeta;frames=context.timeline;
    current={...frame,index,ids,mode:layerMode,samples,modelMeta,timeline:context.timeline};
    if(old?.timeline!==current.timeline)buildTimeline(current.timeline);
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
    if(rev!==revision||error.name==='AbortError')return false;
    if(current){wanted=current.index;requestedContext={meta:current.modelMeta,timeline:current.timeline};syncUI();}
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
let renderController;
async function requestFrame(index,force=false,context={meta,timeline:frames}){
  if(!context.timeline.length)return;
  const target=Math.min(context.timeline.length-1,Math.max(0,index));
  if(!force&&rendering&&wanted===target&&requestedContext?.timeline===context.timeline)return;
  requestedContext=context;
  wanted=target;revision++;
  renderController?.abort();
  syncTimeChoices({...context.timeline[wanted],index:wanted},true);
  if(rendering||refreshing)return;
  if(!force&&current?.url===context.timeline[wanted].url&&current.mode===mode){syncUI();$('status').hidden=true;$('app').dataset.frameStatus='ready';return;}
  rendering=true;
  let success=false;
  try {
    let targetRevision;
    do {targetRevision=revision;renderController=new AbortController();success=await renderFrame(wanted,targetRevision,renderController.signal,requestedContext);}while(targetRevision!==revision&&!refreshing);
  } finally {rendering=false;}
  if(success&&!refreshing){
    if(playing)scheduleNext();
  }
}
function syncUI(){
  if(!current)return;
  const metadata=current.modelMeta,timeline=current.timeline;
  $('app').dataset.model='ecmwf_ifs';$('app').dataset.run=metadata.reference_time;
  $('app').dataset.forecastStart=timeline[0].iso;$('app').dataset.forecastEnd=timeline.at(-1).iso;
  const age=(Date.now()-Date.parse(metadata.reference_time))/HOUR;
  $('run-label').textContent=`ECMWF IFS HRES · 9 km · run ${fmt(metadata.reference_time,{day:'numeric',month:'short'})} ${new Date(metadata.reference_time).getUTCHours().toString().padStart(2,'0')} UTC${age>24?' · oudere run':''}`;
  $('run-label').title=`Bron bijgewerkt: ${fmt(metadata.last_modified_time,{dateStyle:'medium',timeStyle:'short'})}`;
  const f=current,label=forecastLabel(f.time);$('valid-clock').textContent=label.displayClock;
  $('valid-day').textContent=label.date;
  $('slider-time').textContent=label.text;
  $('time-slider').value=(f.time-timeline[0].time)/HOUR;
  $('time-slider').setAttribute('aria-valuetext',label.text);
  $('time-slider').style.setProperty('--progress',`${$('time-slider').value/$('time-slider').max*100}%`);
  if(timelineDayKey!==localDateKey(Date.now()))buildTimeline(timeline);
  syncTimeChoices(f);
  document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===f.mode)));
  $('play').disabled=false;$('time-slider').disabled=false;
  $('previous').disabled=f.index===0;$('next').disabled=f.index===timeline.length-1;
  $('interval-label').textContent=`ECMWF IFS · 9 km · ${f.hours}u ${(f.mode==='weather'||f.mode==='rain')?'neerslaggem.':'tijdstap'}`;
  $('load-label').textContent=`Verwachting · +${f.lead} uur`;
  const legend=$('legend');let title,unit,numbers,gradient;
  if(f.mode==='temperature'){title='Temperatuur';unit='°C';numbers=['−10','0','10','20','30+'];gradient='linear-gradient(to right,#366dd0,#4fc5da,#88d069,#fbd358,#e8693b)';}
  else if(f.mode==='wind'){title='Wind';unit='km/u';numbers=['0','20','40','60','100+'];gradient='linear-gradient(to right,#66c2d0,#53ca89,#e9cc48,#ee9131,#bc3379)';}
  else{const rainLegend=precipitationLegend();title='Neerslag';unit='mm/u';numbers=rainLegend.labels;gradient=rainLegend.gradient;}
  $('layer-title').textContent=f.mode==='weather'?'Weerradar':title;
  legend.querySelector('span').firstChild.textContent=title+' ';legend.querySelector('small').textContent=unit;
  legend.querySelector('.legend-colors').style.background=gradient;
  legend.querySelectorAll('.legend-numbers span').forEach((el,i)=>el.textContent=numbers[i]);
  const snowLegend=$('snow-legend');
  snowLegend.hidden=!f.ids.some(id=>id.endsWith('snowfall_water_equivalent'));
  if(!snowLegend.hidden){
    const snow=precipitationLegend('snowfall_water_equivalent');
    snowLegend.querySelector('.legend-colors').style.background=snow.gradient;
    snowLegend.querySelectorAll('.legend-numbers span').forEach((el,i)=>el.textContent=snow.labels[i]);
  }
}
function stopPlayback(){playing=false;clearTimeout(playTimer);icon($('play'),'play');$('play').setAttribute('aria-label','Animatie afspelen');}
function scheduleNext(){clearTimeout(playTimer);playTimer=setTimeout(()=>{if(playing)requestFrame((wanted+1)%frames.length);},Number($('speed').value));}
$('play').addEventListener('click',()=>{
  if(playing){stopPlayback();return;}playing=true;icon($('play'),'pause');$('play').setAttribute('aria-label','Animatie pauzeren');if(!rendering)requestFrame((wanted+1)%frames.length);
});
$('previous').addEventListener('click',()=>{stopPlayback();requestFrame(wanted-1);});
$('next').addEventListener('click',()=>{stopPlayback();requestFrame(wanted+1);});
let sliderTimer;
$('time-slider').addEventListener('input',()=>{stopPlayback();clearTimeout(sliderTimer);const target=nearestIndex(frames,frames[0].time+Number($('time-slider').value)*HOUR);$('time-slider').setAttribute('aria-valuetext',`Laden: ${forecastLabel(frames[target].time).text}`);sliderTimer=setTimeout(()=>requestFrame(target),130);});
document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{stopPlayback();if(mode===b.dataset.mode)return;mode=b.dataset.mode;requestFrame(wanted,true);}));
['clouds','snow','texture'].forEach(id=>$(id).addEventListener('change',()=>requestFrame(wanted,true)));
$('city-labels').addEventListener('change',queueCityDraw);
$('borders').addEventListener('change',()=>map.setLayoutProperty('borders','visibility',$('borders').checked?'visible':'none'));
$('opacity').addEventListener('input',()=>current?.ids.forEach(id=>map.setPaintProperty(id,'raster-opacity',Number($('opacity').value)/100)));
$('speed').addEventListener('change',()=>{if(playing&&!rendering)scheduleNext();});
$('zoom-in').addEventListener('click',()=>map.zoomIn());$('zoom-out').addEventListener('click',()=>map.zoomOut());
$('europe').addEventListener('click',()=>map.fitBounds([[-24,34],[42,70]],{padding:{top:105,bottom:185,left:45,right:75},duration:600}));
$('home').addEventListener('click',()=>map.flyTo({center:[5.3,51.6],zoom:7,duration:650}));
$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('app').requestFullscreen();}catch{status('Volledig scherm is niet beschikbaar in deze browser.',true);}});
$('settings-toggle').addEventListener('click',()=>{const open=$('settings').hidden;if(open)closePoint();if(open&&innerHeight<650)setMenuCollapsed(true);$('settings').hidden=!open;$('settings-toggle').setAttribute('aria-expanded',String(open));});
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>{$(b.dataset.close).hidden=true;$('settings-toggle').setAttribute('aria-expanded','false');}));
$('info-toggle').addEventListener('click',()=>$('info').showModal());$('info-close').addEventListener('click',()=>$('info').close());
$('info').addEventListener('click',e=>{if(e.target===$('info')){const r=$('info').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('info').close();}});
$('retry').addEventListener('click',()=>retryLoad());
document.addEventListener('keydown',e=>{
  if(e.key==='Escape'){$('settings').hidden=true;$('settings-toggle').setAttribute('aria-expanded','false');$('search-form').hidden=true;closePoint();}
  if(e.target.closest('input,select,button,dialog,#map')||$('info').open)return;
  if(e.code==='Space'){e.preventDefault();$('play').click();}
  if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();stopPlayback();requestFrame(wanted+(e.key==='ArrowRight'?1:-1));}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopPlayback();});

function sample(sampleData,lat,lon){
  if(!sampleData?.data?.values)return NaN;
  return sampleData.grid.getInterpolatedValue(sampleData.data.values,lat,lon,'monotone');
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
  const zoom=map.getZoom(), boxes=[], font=zoom<5?11:12,controls=document.querySelector('.bottom-area').getBoundingClientRect();
  for(const city of cities){
    if(city.minZoom>zoom)continue;
    const p=map.project([city.lon,city.lat]);
    if(p.x<25||p.x>width-25||p.y<20||p.y>height-25)continue;
    if(p.x>controls.left-12&&p.x<controls.right+12&&p.y>controls.top-20)continue;
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
    else if(Number.isFinite(cloud)&&cloud<65){skyIcon(ctx,p.x-15,p.y-17,city);ctx.fillStyle='#ebeded';ctx.beginPath();ctx.ellipse(p.x-11,p.y-14,6,3,0,0,Math.PI*2);ctx.fill();}
    if(current.mode==='wind'){
      const wind=current.samples.wind_u_component_10m;
      if(wind?.data.directions){const a=wind.grid.getLinearInterpolatedDirection(wind.data.directions,city.lat,city.lon)*Math.PI/180;ctx.save();ctx.translate(p.x-16,p.y-17);ctx.rotate(a+Math.PI);ctx.strokeStyle='#fff';ctx.lineWidth=1.5;ctx.beginPath();ctx.moveTo(0,7);ctx.lineTo(0,-7);ctx.lineTo(-3,-3);ctx.moveTo(0,-7);ctx.lineTo(3,-3);ctx.stroke();ctx.restore();}
    }
    drawnCities.push({...city,x:p.x,y:p.y});
  }
}

let pointMarker;
function showPoint(point){$('settings').hidden=true;$('settings-toggle').setAttribute('aria-expanded','false');if(innerHeight<650)setMenuCollapsed(true);selectedPoint=point;if(pointMarker)pointMarker.remove();pointMarker=new mapEngine.Marker({color:'#2ec4e8',scale:.7}).setLngLat([point.lng,point.lat]).addTo(map);$('point').hidden=false;$('search-form').hidden=true;updatePoint();}
function closePoint(){selectedPoint=null;$('point').hidden=true;pointMarker?.remove();pointMarker=null;}
$('point-close').addEventListener('click',closePoint);
function updatePoint(fetchMissing=true){
  if(!selectedPoint||!current)return;
  const p=selectedPoint;$('point-title').textContent=p.name;$('point-time').textContent=forecastLabel(current.time).text;
  const values=$('point-values');values.replaceChildren();
  const entries=[['temperature_2m','Temperatuur','°C',1],['precipitation',`Neerslag · ${current.hours}u-gemiddelde`,'mm/u',2],['cloud_cover','Bewolking','%',0],['wind_u_component_10m','Wind','km/u',0]];
  for(const [variable,label,unit,digits] of entries){
    const value=sample(current.samples[variable],p.lat,p.lng),el=document.createElement('div'),strong=document.createElement('strong'),small=document.createElement('small');
    strong.textContent=Number.isFinite(value)?`${variable==='precipitation'&&value>0&&value<PRECIPITATION_THRESHOLD?'<'+PRECIPITATION_THRESHOLD.toLocaleString('nl-NL'):value.toLocaleString('nl-NL',{maximumFractionDigits:digits})} ${unit}`:'—';small.textContent=label;el.append(strong,small);values.append(el);
  }
  const period=precipitationPeriod(current.modelMeta.reference_time,new Date(current.time).toISOString(),current.hours);
  const rain=sample(current.samples.precipitation,p.lat,p.lng),total=rain*period.hours;
  const dateOptions={day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZoneName:'short'};
  $('point-note').textContent=`Tijdvak: ${fmt(period.start,dateOptions)} – ${fmt(period.end,dateOptions)}. ${Number.isFinite(total)?`Totaal ${total>0&&total<.01?'<0,01':total.toLocaleString('nl-NL',{maximumFractionDigits:2})} mm (regen + sneeuw). `:''}Rooster circa 9 km.`;
  Object.assign($('point').dataset,{precipitationRate:String(rain),precipitationAmount:String(total),periodStart:period.start,periodEnd:period.end,run:period.run});
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
