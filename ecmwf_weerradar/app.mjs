import {hasIsobars,drawIsobars} from './isobars.mjs';
import {weatherSymbol,drawPrecipitationSymbol} from './weather-symbols.mjs';
import {createProjectedGrid} from './projected-grid.mjs';
import {CLOUD_STYLES,cloudIconType,isVeryLowCloud} from './cloud-style.mjs';
import {CLOUD_KEYS,cloudBytes} from './cloud-fields.mjs';
import {captureMap,composePNG,exportLegends,pngFilename} from './png-export.mjs';
import {installAreaSelection} from './area-selection.mjs';
import {beaufort,windLegend,windDirectionText} from './wind-style.mjs';
import {MODELS,MODEL_CONFIG,UPPER_AIR_LEVELS,upperAirFile,viewZoom,modelFor,regionalFrames,preserveModelTime,isBenelux,isRegional,isEuropeanHarmonie,modelView,latestModelURL,discoverEuropeanHarmonie} from './forecast-models.mjs';
import {createRegularGrid} from './regular-grid.mjs';
import {installMovableMenu} from './movable-menu.mjs';
import {visibleTimeout} from './frame-scheduler.mjs';
import {FOG_BANDS,fogBand,visibilityText} from './fog-style.mjs';
import {precipitationLegend,PRECIPITATION_THRESHOLD} from './precipitation-colors.mjs';
import {precipitationPeriod} from './precipitation.mjs';
import { forecastLabel, groupForecastDays, chooseDayEntry, nowFrameIndex } from './timeline.mjs';
import {combinedForecastFrames,discoverCachedForecastRuns,isNewerForecastRun} from './forecast-runs.mjs';
import * as mapEngine from './map.mjs';
import {updateCurrentBounds, domainOptions, getRanges} from '@openmeteo/weather-map-layer';
import {FieldPackets,FIELD_ORIGIN} from './field-packets.mjs';
import {createPackedGrid} from './packed-grid.mjs';
import { createSharedTask, consumeTask } from './shared-task.mjs';
import {fieldWindow} from './field-window.mjs';
import {AdjacentFrames} from './adjacent-frames.mjs';
import { DATA_ROOT, EUROPE, HOUR, FORECAST_DAYS, nearestIndex, normalizeFieldData, localDateKey, fmt, scales, inEurope, runPath, temperatureLegend } from './core.mjs';

const $ = id => document.getElementById(id);
$('app').dataset.moduleReadyMs=Math.round(performance.now());
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
for(const band of [...FOG_BANDS].reverse()){
  const item=document.createElement('span'),swatch=document.createElement('i');
  swatch.style.setProperty('--fog-color',band.color);swatch.className=band.hatch?'fog-swatch fog-hatched':'fog-swatch';
  item.append(swatch,document.createTextNode(band.label.replace('Zicht ','')));$('fog-bands').append(item);
}
for(const [type,style] of Object.entries(CLOUD_STYLES)){
  const swatch=document.querySelector(`[data-cloud-swatch="${type}"]`);
  swatch.style.setProperty('--cloud-color',`rgba(${style.rgb.join(',')},${style.sample})`);
  swatch.parentElement.addEventListener('click',()=>{
    const input=$(`cloud-${type}`);input.checked=!input.checked;
    input.dispatchEvent(new Event('change'));
  });
}
const cloudVisibility=()=>($('cloud-low').checked?1:0)|($('cloud-mid').checked?2:0)|($('cloud-high').checked?4:0);
function syncCloudButtons(){
  for(const type of ['high','mid','low']){
    const item=document.querySelector(`[data-cloud-swatch="${type}"]`).parentElement,visible=$(`cloud-${type}`).checked;
    item.classList.toggle('cloud-off',!visible);item.setAttribute('aria-pressed',String(visible));
  }
}
const modeNames={weather:'Weer',rain:'Neerslag',temperature:'Temperatuur',wind:'Wind'};
document.querySelectorAll('[data-mode]').forEach(button=>{const label=document.createElement('span');label.textContent=modeNames[button.dataset.mode];button.append(label);});
const settingsLabel=document.createElement('span');settingsLabel.textContent='Lagen';$('settings-toggle').append(settingsLabel);

let meta, frames = [], current = null, wanted = 0, revision = 0, rendering = false, refreshing = false;
let checkedAt = Date.now();
let requestedContext = null, startupRevision = 0;
let retryLoad = () => start();
let mode = 'weather', playing = false, playTimer, sourceCounter = 0, cities = [], selectedPoint = null;
let pendingSources = new Map(), cityDrawQueued = false, frameErrors = new Set();
const adjacentFrames=new AdjacentFrames();
let nextFrameReady=false;
const intervalByURL = new Map();
const domain=domainOptions.find(d=>d.value==='ecmwf_ifs');
const fieldPackets=new FieldPackets();
const fieldCache=new Map();
let fieldReads=0;
function trimFieldCache(){
  let bytes=[...fieldCache.values()].reduce((sum,e)=>sum+(e.bytes||0),0);
  while(fieldCache.size>64||(bytes>128*1024*1024&&fieldCache.size>4)){
    const key=[...fieldCache].find(([,e])=>e.task.settled||e.task.controller.signal.aborted)?.[0];
    if(!key)break;bytes-=fieldCache.get(key).bytes||0;fieldCache.delete(key);
  }
}
function readField(file,variable,signal){
  signal?.throwIfAborted();
  const b=map.getBounds(),window=fieldWindow([b.getWest(),b.getSouth(),b.getEast(),b.getNorth()],map.getZoom());
  const [west,south,east,north]=window.bounds;
  // Reuse an exact native crop only when it covers this complete tile window.
  for(const [cachedKey,entry] of fieldCache){
    if(!entry.task.controller.signal.aborted&&entry.file===file&&entry.variable===variable&&entry.south<=south&&entry.north>=north&&entry.west<=west&&entry.east>=east){
      fieldCache.delete(cachedKey);fieldCache.set(cachedKey,entry);return consumeTask(entry.task,signal);
    }
  }
  const bounds=window.readBounds;
  const ranges=getRanges(domain.grid,bounds),key=file+'|'+variable+'|'+JSON.stringify(window.bounds);
  $('app').dataset.fieldReads=++fieldReads;
  const task=createSharedTask(async readSignal=>{
    const data=await fieldPackets.read(file,variable,window.bounds,readSignal);
    if(data.metadata.kind!=='regular')normalizeFieldData(data,variable,intervalByURL.get(file));
    const field={data,grid:data.metadata.kind==='regular'?createRegularGrid(data.metadata.grid):data.metadata.kind==='projected'?createProjectedGrid(data.metadata):createPackedGrid(data.metadata),packed:data.metadata,variable,key,ranges,gridData:domain.grid};
    for(const key of CLOUD_KEYS)if(data[key])field[key]=data[key];
    if(data.cloudBase)field.cloudBase=data.cloudBase;
    const entry=fieldCache.get(key);
    if(entry)entry.bytes=data.values.byteLength+(data.directions?.byteLength||0)+cloudBytes(field);
    trimFieldCache();
    return field;
  });
  task.promise.catch(()=>{if(fieldCache.get(key)?.task===task)fieldCache.delete(key);});
  fieldCache.set(key,{file,variable,west,south,east,north,task});
  trimFieldCache();
  return consumeTask(task,signal);
}
mapEngine.setWeatherLoader((url,signal)=>{const u=new URL(url.replace(/^om:\/\//,'')),variable=u.searchParams.get('variable');return readField(u.origin+u.pathname,variable,signal).then(field=>({...field,texture:$('texture').checked,cloudVisible:Number(u.searchParams.get('clouds')??7)}));});
const params = new URLSearchParams(location.search);
let selectedModel=MODELS[params.get('model')]?params.get('model'):'ecmwf_ifs';
// Temperature level: 2 m, 850 hPa or 500 hPa. Pressure levels come from the
// model's own upper-air source (MODEL_CONFIG.upperAir), never from another model.
let tempLevel=Object.hasOwn(UPPER_AIR_LEVELS,params.get('level'))?params.get('level'):'2m';
function tempVariable(modelId){const v=UPPER_AIR_LEVELS[tempLevel];return v!=='temperature_2m'&&!MODEL_CONFIG[modelId]?.upperAir?'temperature_2m':v;}
// File that holds `variable` for this frame: same model, run and valid time.
function fieldFile(frame,variable){return variable.endsWith('hPa')?upperAirFile(frame,modelFor(frame.modelMeta),variable):frame.url;}
$('model-select').value=selectedModel;
$('model-select').addEventListener('change',()=>{selectedModel=$('model-select').value;start(undefined,selectedModel,true);});
// Optional local diagnostics: no reporting endpoint and no visitor tracking.
if(params.get('profile')==='1'){
  setInterval(()=>{
    $('app').dataset.cacheStats=JSON.stringify({...map.performanceStats(),fieldEntries:fieldCache.size,fieldBytes:[...fieldCache.values()].reduce((n,e)=>n+(e.bytes||0),0)});
  },1000);
  globalThis.weerlabProfile={project:(lon,lat)=>{const p=map.project([lon,lat]);return {x:p.x,y:p.y};},padding:()=>viewPadding(),zoom:()=>map.getZoom(),stats:()=>map.performanceStats(),samples:()=>mapEngine.renderStats.samples,fields:()=>[...fieldCache.values()].map(e=>({variable:e.variable,bounds:[e.west,e.south,e.east,e.north]}))};
}
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
map.addControl(new mapEngine.AttributionControl({compact:true,customAttribution:'<span id="model-attribution"><a href="https://open-meteo.com/" target="_blank" rel="noopener">ECMWF / Open-Meteo</a></span> · Natural Earth'}),'bottom-right');
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
map.on('movestart',cancelPreparation);
map.on('resize', queueCityDraw);
map.on('moveend', () => {
  const b=map.getBounds(); updateCurrentBounds([b.getWest(),b.getSouth(),b.getEast(),b.getNorth()]);
  if (current&&!refreshing) updateViewportSamples();
  // An automatic model view belongs to the screen, not to the link: sharing
  // or reloading on another device must compute its own view again.
  const c=map.getCenter(), u=new URL(location.href);
  if(autoView){u.searchParams.delete('center');u.searchParams.delete('zoom');}
  else{u.searchParams.set('center',`${c.lng.toFixed(4)},${c.lat.toFixed(4)}`);u.searchParams.set('zoom',map.getZoom().toFixed(2));}
  history.replaceState(null,'',u);
});
// ---- Responsive default view -------------------------------------------
// Every model has its own view (MODEL_CONFIG.view). It is recomputed from the
// free map area, i.e. the map minus the brand/toolbars at the top and the
// time dock at the bottom, whenever that area changes: window resize,
// rotation, fullscreen, the dock opening/closing or moving. It stays
// automatic until the visitor pans or zooms; the home button restores it.
let autoView=!params.has('center');
function viewPadding(){
  const area=$('map').getBoundingClientRect(),h=area.height,w=area.width;
  let top=12,bottom=12;
  // Horizontal top bars only; the narrow zoom column at the right edge is
  // part of the side margin, not a band across the map.
  for(const el of document.querySelectorAll('.brand,.top-left,.layer-toolbar')){
    const r=el.getBoundingClientRect();
    if(r.width&&r.height&&r.height<h*.3&&r.bottom<area.top+h*.5)top=Math.max(top,r.bottom-area.top+8);
  }
  const dock=document.querySelector('.bottom-area').getBoundingClientRect();
  if(dock.height&&getComputedStyle(document.querySelector('.bottom-area')).display!=='none'&&dock.top>area.top+h*.3)bottom=Math.max(bottom,area.bottom-dock.top+8);
  // On a very low screen (landscape phone) never let overlays leave less than
  // 45% of the height for the Netherlands; they are translucent/collapsible.
  const free=h-top-bottom,minFree=h*.45;
  if(free<minFree){const k=Math.max(0,(h-minFree))/(top+bottom);top*=k;bottom*=k;}
  const side=w<=700?10:24;
  return {top:Math.round(top),bottom:Math.round(bottom),left:side,right:side};
}
function fitModelView(modelId=selectedModel){
  const view=modelView(modelId);
  const padding=viewPadding();let measured;
  map.fitView(view,padding,zoomFor=>{measured=[zoomFor(view.core),zoomFor(view.context)];return viewZoom(view,zoomFor);});
  autoView=true;Object.assign($('app').dataset,{autoView:'true',viewZoom:map.getZoom().toFixed(2),viewPadding:[padding.top,padding.right,padding.bottom,padding.left].join(' '),viewFit:measured.map(z=>z.toFixed(2)).join(' ')});
}
function manualView(){if(autoView){autoView=false;$('app').dataset.autoView='false';}}
for(const type of ['pointerdown','wheel','touchstart'])$('map').addEventListener(type,manualView,{passive:true});
$('map').addEventListener('keydown',e=>{if(/^(Arrow|\+|-|=)/.test(e.key))manualView();});
let refitTimer;
function scheduleRefit(){clearTimeout(refitTimer);refitTimer=setTimeout(()=>{if(autoView)fitModelView();else map.native.invalidateSize({pan:false});},120);}
addEventListener('resize',scheduleRefit);addEventListener('orientationchange',scheduleRefit);
document.addEventListener('fullscreenchange',scheduleRefit);
new ResizeObserver(scheduleRefit).observe($('map'));
if(autoView)fitModelView();
let viewportRevision=0,viewportController;
async function updateViewportSamples(){
  viewportController?.abort();viewportController=new AbortController();
  const rev=++viewportRevision,frame=current,started=performance.now(),signal=viewportController.signal;
  try{
    // Leaflet extends the existing tile layers by itself; rebuilding all layers
    // here caused avoidable downloads, duplicated rendering and flashing on pan.
    const vars=sampleVariables(variablesForMode(frame.modelMeta,frame),frame.modelMeta);
    const fields=await Promise.all(vars.map(v=>readField(fieldFile(frame,v),v,signal)));
    if(rev!==viewportRevision||current!==frame)return;
    vars.forEach((v,i)=>{current.samples[v]=fields[i];});queueCityDraw();updatePoint();
    $('app').dataset.panDataMs=Math.round(performance.now()-started);
    prepareAdjacentFrames();
  }catch(error){if(rev===viewportRevision&&current===frame&&error.name!=='AbortError')status(error.message,true);}
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
  const transport=url.startsWith(DATA_ROOT)&&url.endsWith('.json')?FIELD_ORIGIN+new URL(url).pathname:url;
  const response=await fetch(transport,{signal:signal || AbortSignal.timeout(16000),cache:'no-cache'});
  if(!response.ok) throw new Error(`Bron niet bereikbaar (${response.status})`);
  return response.json();
}
let runCacheTime=0;
// ECMWF publishes four runs a day. Stored metadata of the run that is still
// on screen may open the map without any metadata request; the existing run
// check then verifies it and replaces the whole frame when a newer run exists.
async function discoverRuns(now,prefetchedLatest) {
  let saved;
  try{saved=JSON.parse(localStorage.getItem('weerlab-ecmwf-runs-v2'));}catch{}
  const result=await discoverCachedForecastRuns(json,now,saved,prefetchedLatest);
  runCacheTime=result.savedAt;
  if(result.needsCheck){checkedAt=0;setTimeout(()=>checkForNewRun(),1200);}
  return result.metas;
}

let modelDiscoveryController;
async function start(prefetchedLatest,modelId=selectedModel,focusRegion=false) {
  modelDiscoveryController?.abort();modelDiscoveryController=new AbortController();
  const signal=modelDiscoveryController.signal;
  if(!current){$('interval-label').textContent=MODELS[modelId].detail;$('model-coverage').textContent=MODELS[modelId].region;}
  $('model-select').setAttribute('aria-busy','true');
  const startup=++startupRevision;
  retryLoad=()=>start(undefined,modelId,focusRegion);
  refreshing=true;stopPlayback();cancelPreparation();clearTimeout(sliderTimer);revision++;renderController?.abort();status(`${MODELS[modelId].label}-verwachting ophalen…`);
  try {
    const now=Date.now();
    let timeline;
    if(modelId==='ecmwf_ifs'){
      const candidateMetas=await discoverRuns(now,prefetchedLatest);
      if(startup!==startupRevision)return;
      timeline=combinedForecastFrames(candidateMetas,now);
      try{localStorage.setItem('weerlab-ecmwf-runs-v2',JSON.stringify({savedAt:runCacheTime,metas:candidateMetas}));}catch{}
    }else if(isEuropeanHarmonie(modelId))timeline=await discoverEuropeanHarmonie(url=>json(url,signal),modelId,now);
    else timeline=regionalFrames(await json(latestModelURL(modelId),signal),modelId,now);
    if(startup!==startupRevision)return;
    $('app').dataset.metadataReadyMs=Math.round(performance.now());
    timeline.forEach(f=>intervalByURL.set(f.url,f.hours));
    await mapReady;
    if(startup!==startupRevision)return;
    // Benelux is intentionally tighter than the full regional export. Explicit
    // model changes use its named region; later hours preserve the user's view.
    // Explicit model change: that model's own default view. First load:
    // unless a link carries its own centre. Later runs keep the user's view.
    if(focusRegion||(!current&&autoView))fitModelView(modelId);
    const b=map.getBounds();updateCurrentBounds([b.getWest(),b.getSouth(),b.getEast(),b.getNorth()]);
    // A refresh preserves the chosen forecast time where the new run permits
    // it. The previous run and its controls stay together until a full frame
    // from this candidate has loaded successfully.
    const linkedTime=params.get('time');
    const requestedTime=linkedTime&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z$/.test(linkedTime)?Date.parse(linkedTime):NaN;
    let selectedTime=requestedContext?.timeline[wanted]?.time??current?.time??(Number.isFinite(requestedTime)?requestedTime:undefined);
    const selection=preserveModelTime(timeline,selectedTime);selectedTime=selection.time;
    $('model-notice').textContent=selection.outside?'De gekozen datum valt buiten deze modelrun. Het eerst beschikbare tijdstip wordt getoond.':'';
    const index=selectedTime===undefined?0:nearestIndex(timeline,selectedTime);
    refreshing=false;requestFrame(index,true,{meta:timeline[index].modelMeta,timeline});
  } catch(error) {
    if(startup!==startupRevision)return;
    if(current){wanted=current.index;requestedContext={meta:current.modelMeta,timeline:current.timeline};}
    if(current){selectedModel=modelFor(current.modelMeta);$('model-select').value=selectedModel;}
    refreshing=false;status(`${error.message}. ${current?'Het vorige model blijft zichtbaar. ':''}Probeer opnieuw.`,true);
  }finally{if(startup===startupRevision)$('model-select').setAttribute('aria-busy','false');}
}

let dayGroups=[],timelineDayKey='',hoursDayKey='';
function buildTimeline(timeline){
  dayGroups=groupForecastDays(timeline);timelineDayKey=localDateKey(Date.now());hoursDayKey='';
  const container=$('days');container.replaceChildren();
  for(const day of dayGroups){
    const button=document.createElement('button');button.type='button';button.dataset.day=day.key;
    button.textContent=day.label;const small=document.createElement('small');small.textContent=day.date;button.append(small);
    button.title=day.full;button.setAttribute('aria-label',day.full);button.setAttribute('aria-pressed','false');
    button.addEventListener('click',()=>{stopPlayback();requestFrame(chooseDayEntry(day,requestedContext?.timeline[wanted]?.time??current?.time)?.index??day.target.index);});container.append(button);
  }
  $('time-slider').max=(timeline.at(-1).time-timeline[0].time)/HOUR;const span=Number($('time-slider').max);$('range-end').textContent=span>=240?'+10 dagen':`+${span} uur`;
  document.querySelector('.timeline').setAttribute('aria-label',`Verwachting tot ${forecastLabel(timeline.at(-1).time).text}`);
  $('time-ticks').replaceChildren();
  const divisions=span>=240?10:Math.min(5,Math.ceil(span/12));
  for(let i=0;i<=divisions;i++){const tick=document.createElement('span'),hours=Math.round(span*i/divisions);tick.textContent=i?(span>=240?`+${Math.round(hours/24)}d`:`+${hours}u`):'nu';$('time-ticks').append(tick);}
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
// Low screens and phones start with the compact dock: the expanded menu would
// otherwise cover most of the map (and the Netherlands) on a phone.
const shortViewport=matchMedia('(max-height: 650px), (max-width: 700px)');
setMenuCollapsed(shortViewport.matches);
installMovableMenu(document.querySelector('.bottom-area'),$('menu-drag'),$('menu-reset'),queueCityDraw);
shortViewport.addEventListener('change',event=>{if(event.matches)setMenuCollapsed(true);});
// Only an actual menu size change updates layout; map motion never measures it.
let dockWidth=0,dockHeightSeen=0;
new ResizeObserver(entries=>{
  const {width,height}=entries[0].contentRect;
  document.documentElement.style.setProperty('--dock-height',`${Math.ceil(height)}px`);queueCityDraw();
  // The dock covers the bottom of the map: its height is part of the view.
  if(Math.abs(height-dockHeightSeen)>4){dockHeightSeen=height;scheduleRefit();}
  if(Math.abs(width-dockWidth)>1){dockWidth=width;requestAnimationFrame(()=>{
    for(const id of ['days','hours'])$(id).querySelector('[aria-pressed=true]')?.scrollIntoView({block:'nearest',inline:'center'});
  });}
}).observe(document.querySelector('.bottom-area'));
// Refinements of the same frame: they must not delay the first usable map.
const OPTIONAL_LAYERS=['visibility','snowfall_water_equivalent'];
function variablesForMode(modelMeta=meta,frame){
  if(mode==='temperature'){const v=tempVariable(modelFor(modelMeta));return !frame||fieldFile(frame,v)?[v]:[];}
  if(mode==='wind') return ['wind_u_component_10m'];
  return [...(mode==='weather'&&$('clouds').checked?['cloud_cover',...($('fog').checked&&modelMeta.variables.includes('visibility')?['visibility']:[])]:[]),'precipitation',...($('snow').checked&&modelMeta.variables.includes('snowfall_water_equivalent')?['snowfall_water_equivalent']:[])];
}
function sampleVariables(layerVariables,modelMeta){
  const labels=$('city-labels').checked?(mode==='wind'?(modelMeta.variables.includes('wind_gusts_10m')?['wind_gusts_10m']:[]):mode==='temperature'?[]:['temperature_2m']):[];
  return [...new Set([...layerVariables,...labels,...($('isobars').checked&&hasIsobars(modelMeta)?['pressure_msl']:[])])];
}
function weatherURL(frame,variable){return `om://${fieldFile(frame,variable)}?variable=${variable}&interpolation=monotone&color_blend=true&clouds=${cloudVisibility()}`;}
function addLayer(frame,variable,prefix){
  const id=`${prefix}-${variable}`;
  map.addSource(id,{type:'raster',url:weatherURL(frame,variable),tileSize:256,maxzoom:10});
  map.addLayer({id,type:'raster',source:id,paint:{'raster-opacity':.00001,'raster-fade-duration':0}},'borders');
  return id;
}
function removeLayers(ids){for(const id of ids){pendingSources.delete(id);frameErrors.delete(id);if(map.getLayer(id)) map.removeLayer(id);if(map.getSource(id)) map.removeSource(id);}}
function awaitSources(ids,signal){
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{stopTimer();signal?.removeEventListener('abort',abort);map.off('sourcedata',check);ids.forEach(id=>pendingSources.delete(id));};
    const check=()=>{
      if(ids.some(id=>frameErrors.has(id))){cleanup();reject(new Error('Een ECMWF-weerlaag kon niet worden geladen'));return;}
      if(ids.every(id=>map.getSource(id)&&map.isSourceLoaded(id))){cleanup();resolve();}
    };
    const abort=()=>{cleanup();reject(signal.reason);};
    // Only visible seconds count: a background tab renders very slowly and
    // must show its finished map on return, not a load error.
    const stopTimer=visibleTimeout(45000,()=>{cleanup();reject(new Error('Het laden van de ECMWF-kaart duurt te lang'));});
    signal?.addEventListener('abort',abort,{once:true});
    ids.forEach(id=>pendingSources.set(id,check));map.on('sourcedata',check);if(signal?.aborted)abort();else check();
  });
}
async function renderFrame(index,rev,signal,context){
  const started=performance.now();
  viewportController?.abort();viewportRevision++;pointController?.abort();
  const frame=context.timeline[index], modelMeta=frame.modelMeta??context.meta, layerMode=mode, vars=variablesForMode(modelMeta,frame);
  map.setFrameBudget(vars.length);
  retryLoad=()=>requestFrame(index,true,context);
  const ids=vars.map(v=>addLayer(frame,v,`frame${sourceCounter}`));sourceCounter++;
  // The first view can reveal finished layers immediately. Later time changes
  // remain atomic, so there is never a mixture of different forecast hours.
  let reveal;
  if(!current){
    updateTimeHeading(frame,modelMeta);
    reveal=()=>{
      if(rev!==revision){map.off('sourcedata',reveal);return;}
      for(const id of ids)if(map.getSource(id)&&map.isSourceLoaded(id)&&!frameErrors.has(id)){
        map.setPaintProperty(id,'raster-opacity',Number($('opacity').value)/100);
        if(!OPTIONAL_LAYERS.some(v=>id.endsWith(v))&&!$('app').dataset.firstVisibleWeatherMs){$('app').dataset.firstVisibleWeatherMs=Math.round(performance.now());$('app').dataset.firstVisibleLayer=id;}
      }
      // Keep listening while the optional layers of this same frame finish.
      if(ids.every(id=>!map.getSource(id)||map.isSourceLoaded(id)))map.off('sourcedata',reveal);
    };
    map.on('sourcedata',reveal);
  }
  status(`Laden: ${forecastLabel(frame.time).text}…`);
  $('app').dataset.frameStatus='loading';
  try {
    const sampleVars=sampleVariables(vars,modelMeta);
    // The first map must not wait for mist and snow: both are refinements of
    // the same frame and cost roughly half of all tiles. A later time change
    // still switches every layer together, so no two hours are ever mixed.
    const requiredIds=!current&&ids.length>1?ids.filter((id,i)=>!OPTIONAL_LAYERS.includes(vars[i])):ids;
    let [,...fields]=await Promise.all([awaitSources(requiredIds.length?requiredIds:ids,signal),...sampleVars.map(v=>readField(fieldFile(frame,v),v,signal))]);
    // A pan during loading may change the crop while the time stays the same.
    // Commit city/point values only once they cover the current tile window.
    for(;;){
      signal.throwIfAborted();
      const b=map.getBounds(),needed=fieldWindow([b.getWest(),b.getSouth(),b.getEast(),b.getNorth()],map.getZoom()).bounds;
      if(fields.every(f=>{const a=f.packed.bounds;return a[0]<=needed[0]&&a[1]<=needed[1]&&a[2]>=needed[2]&&a[3]>=needed[3];}))break;
      fields=await Promise.all(sampleVars.map(v=>readField(fieldFile(frame,v),v,signal)));
    }
    if(rev!==revision){removeLayers(ids);return false;}
    const samples={};
    sampleVars.forEach((v,i)=>{samples[v]=fields[i];});
    const old=current;
    meta=modelMeta;frames=context.timeline;
    current={...frame,index,ids,mode:layerMode,level:tempLevel,samples,modelMeta,timeline:context.timeline};
    if(old?.timeline!==current.timeline){
      buildTimeline(current.timeline);
      // Only after the replacement frame is usable may obsolete runs leave
      // persistent storage. Keep both the latest and its long-range fallback.

      // Packet cache keys contain the complete immutable run/file path.
      // Retain recently viewed other models within the same bounded LRU.
      // Every entry already owns its immutable model/run/field/area identity.
      trimFieldCache();
    }
    ids.forEach(id=>map.setPaintProperty(id,'raster-opacity',Number($('opacity').value)/100));
    if(old) removeLayers(old.ids);
    syncUI();queueCityDraw();updatePoint();$('status').hidden=true;
    $('app').dataset.frameStatus='ready';$('app').dataset.validTime=frame.iso;$('app').dataset.intervalHours=frame.hours;
    delete $('app').dataset.lastLoadError;
    $('app').dataset.frameLoadMs=Math.round(performance.now()-started);
    if(!$('app').dataset.firstWeatherMs)$('app').dataset.firstWeatherMs=Math.round(performance.now());
    loadMapDetails();
    return true;
  } catch(error){
    removeLayers(ids);
    if(rev!==revision||error.name==='AbortError')return false;
    $('app').dataset.lastLoadError=error.message;
    if(current){wanted=current.index;requestedContext={meta:current.modelMeta,timeline:current.timeline};syncUI();}
    stopPlayback();$('app').dataset.frameStatus='error';
    status(`De weergegevens konden niet worden geladen. ${current?'De vorige tijdstap blijft zichtbaar.':'Probeer opnieuw.'}`,true);
    return false;
  }finally{if(reveal&&(rev!==revision||ids.every(id=>!map.getSource(id)||map.isSourceLoaded(id))))map.off('sourcedata',reveal);}
}
let detailsStarted=false,detailsReady=Promise.resolve();
function loadMapDetails(){
  if(detailsStarted)return;detailsStarted=true;
  const mapDetails=map.loadDetails();
  const cityDetails=fetch('./assets/cities.json').then(r=>{if(!r.ok)throw new Error('Plaatsnamen laden mislukt');return r.json();}).then(places=>{cities=places;queueCityDraw();}).catch(()=>{detailsStarted=false;});
  detailsReady=Promise.allSettled([mapDetails,cityDetails]);
}
let renderController;
async function requestFrame(index,force=false,context={meta,timeline:frames}){
  if(!context.timeline.length)return;
  const target=Math.min(context.timeline.length-1,Math.max(0,index));
  if(!force&&rendering&&wanted===target&&requestedContext?.timeline===context.timeline)return;
  requestedContext=context;
  cancelPreparation();
  wanted=target;revision++;
  renderController?.abort();
  syncTimeChoices({...context.timeline[wanted],index:wanted},true);
  if(rendering||refreshing)return;
  if(!force&&current?.url===context.timeline[wanted].url&&current.mode===mode&&current.level===tempLevel){syncUI();$('status').hidden=true;$('app').dataset.frameStatus='ready';prepareAdjacentFrames();return;}
  rendering=true;
  let success=false;
  try {
    let targetRevision;
    do {targetRevision=revision;renderController=new AbortController();success=await renderFrame(wanted,targetRevision,renderController.signal,requestedContext);}while(targetRevision!==revision&&!refreshing);
  } finally {rendering=false;}
  if(success&&!refreshing){
    prepareAdjacentFrames();
  }
}
function updateTimeHeading(frame,metadata){
  const label=forecastLabel(frame.time,metadata.reference_time,MODELS[modelFor(metadata)].label);
  $('selected-date').textContent=label.date;
  $('selected-date-mobile').textContent=label.mobileDate;
  $('selected-clock').textContent=`${label.clock} uur`;
  $('slider-time').setAttribute('aria-label',label.full);
  $('slider-time').dataset.utc=new Date(frame.time).toISOString();
  $('run-badge').textContent=label.runLabel+(frame.olderRun?' · Aanvullende eerdere run':'');
  $('run-badge').classList.toggle('earlier-run',!!frame.olderRun);
  $('run-badge').title=`Bron bijgewerkt: ${forecastLabel(metadata.last_modified_time).full}`;
  $('forecast-lead').textContent=label.leadLabel;
  $('selected-zone').textContent=label.zone;
  document.title=`${label.text} · Weerkaart Europa · Weerlab`;
  return label;
}
function syncUI(){
  if(!current)return;
  const metadata=current.modelMeta,timeline=current.timeline;
  const modelId=modelFor(metadata);selectedModel=modelId;$('model-select').value=modelId;
  $('app').dataset.model=modelId;$('app').dataset.run=metadata.reference_time;
  $('app').dataset.olderRun=String(!!current.olderRun);
  $('app').dataset.forecastStart=timeline[0].iso;$('app').dataset.forecastEnd=timeline.at(-1).iso;
  const f=current,label=updateTimeHeading(f,metadata);
  const pageURL=new URL(location.href);pageURL.searchParams.set('time',new Date(f.time).toISOString());pageURL.searchParams.set('model',modelId);history.replaceState(null,'',pageURL);
  $('time-slider').value=(f.time-timeline[0].time)/HOUR;
  $('time-slider').setAttribute('aria-valuetext',label.text);
  $('time-slider').style.setProperty('--progress',`${$('time-slider').value/$('time-slider').max*100}%`);
  if(timelineDayKey!==localDateKey(Date.now()))buildTimeline(timeline);
  syncTimeChoices(f);
  document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===f.mode)));
  $('play').disabled=!playing&&!nextFrameReady;$('time-slider').disabled=false;$('now').disabled=false;
  $('previous').disabled=f.index===0;$('next').disabled=f.index===timeline.length-1;
  $('interval-label').textContent=`${MODELS[modelId].detail} · ${f.hours}u ${(f.mode==='weather'||f.mode==='rain')?'neerslaggem.':'tijdstap'}`;
  $('model-attribution').textContent=MODELS[modelId].attribution;
  $('model-coverage').textContent=MODELS[modelId].region;
  $('model-resolution').textContent=MODELS[modelId].resolution;
  $('point-model').textContent=MODELS[modelId].label+'-VERWACHTING';
  $('ecmwf-info').hidden=modelId!=='ecmwf_ifs';$('harmonie-info').hidden=!isBenelux(modelId);$('harmonie-europe-info').hidden=!isEuropeanHarmonie(modelId);
  $('icon-d2-info').hidden=modelId!=='icond2';
  $('snow').disabled=!metadata.variables.includes('snowfall_water_equivalent');
  $('isobars').disabled=!hasIsobars(metadata);
  $('isobars-note').textContent=hasIsobars(metadata)?'Luchtdruk op zeeniveau · lijnen om de 4 hPa.':'Isobaren zijn beschikbaar bij ECMWF.';
  const legend=$('legend');let title,unit,numbers,gradient;
  if(f.mode==='temperature'){const v=tempVariable(modelId),l=temperatureLegend(v);title=v==='temperature_2m'?'Temperatuur':`Temperatuur ${v.slice(12,15)} hPa`;unit='°C';numbers=l.labels;gradient=l.gradient;}
  else if(f.mode==='wind'){title='Wind';unit='Bft';numbers=windLegend.labels;gradient=windLegend.gradient;}
  else{const rainLegend=precipitationLegend();title='Neerslag';unit='mm/u';numbers=rainLegend.labels;gradient=rainLegend.gradient;}
  $('layer-title').textContent=f.mode==='weather'?'Weerradar':title;
  $('wind-key').hidden=f.mode!=='wind';
  syncTempLevels(f,modelId);
  $('wind-key').textContent='Windkracht in Bft · pijl: richting waarin de wind waait'+(metadata.variables.includes('wind_gusts_10m')?' · stoten in km/u':' · windstoten niet beschikbaar');
  legend.querySelector('span').firstChild.textContent=title+' ';legend.querySelector('small').textContent=unit;legend.setAttribute('aria-label',`Legenda ${title.toLowerCase()} in ${unit}`);
  legend.querySelector('.legend-colors').style.background=gradient;
  legend.querySelectorAll('.legend-numbers span').forEach((el,i)=>el.textContent=numbers[i]);
  $('fog-legend').hidden=!f.ids.some(id=>id.endsWith('-visibility'));
  $('cloud-legend').hidden=!f.ids.some(id=>id.endsWith('-cloud_cover'));
  syncCloudButtons();
  const hasBase=!!f.samples.cloud_cover?.cloudBase;
  $('cloud-legend-fog').classList.toggle('cloud-off',!f.ids.some(id=>id.endsWith('-visibility'))&&!(hasBase&&$('cloud-low').checked));
  $('very-low-key').hidden=$('cloud-legend').hidden;
  $('very-low-key').textContent=hasBase?'Mistkleur: ook zeer lage bewolking · wolkenbasis <150 m.':'Zeer lage bewolking: geen afzonderlijke wolkenbasis in deze bron.';
  $('very-low-key').title=$('very-low-key').textContent;
  $('fog-unavailable').hidden=!(f.mode==='weather'&&$('clouds').checked&&$('fog').checked&&!f.modelMeta.variables.includes('visibility'));
  const snowLegend=$('snow-legend');
  snowLegend.hidden=!f.ids.some(id=>id.endsWith('snowfall_water_equivalent'));
  if(!snowLegend.hidden){
    const snow=precipitationLegend('snowfall_water_equivalent');
    snowLegend.querySelector('.legend-colors').style.background=snow.gradient;
    snowLegend.querySelectorAll('.legend-numbers span').forEach((el,i)=>el.textContent=snow.labels[i]);
  }
}
function cancelPreparation(){
  adjacentFrames.cancel();clearTimeout(playTimer);nextFrameReady=false;
  $('play').disabled=!playing;$('app').dataset.nextFrameReady='false';
  $('play').title=playing?'Animatie pauzeren':'Volgende beeld wordt voorbereid…';
}
function prepareAdjacentFrames(){
  if(!current||rendering||refreshing||document.hidden)return;
  cancelPreparation();const frame=current,texture=$('texture').checked,cloudVisible=cloudVisibility();
  const connection=navigator.connection;
  const limited=connection?.saveData||['slow-2g','2g','3g'].includes(connection?.effectiveType)||matchMedia('(max-width:700px), (pointer:coarse)').matches;
  adjacentFrames.start(frame.index,frame.timeline.length,async(index,signal)=>{
    // Let the selected view and its map labels finish first on slow links.
    await detailsReady;signal.throwIfAborted();
    const next=frame.timeline[index],vars=variablesForMode(next.modelMeta,next);
    const sampleVars=sampleVariables(vars,next.modelMeta);
    const fields=await Promise.all(sampleVars.map(v=>readField(fieldFile(next,v),v,signal)));
    signal.throwIfAborted();
    await map.prepareFields(fields.filter(f=>vars.includes(f.variable)).map(f=>({...f,texture,cloudVisible})),signal);
  },{previous:!limited,delayMs:limited?1200:350,ready:()=>{
    if(current!==frame)return;
    nextFrameReady=true;$('app').dataset.nextFrameReady='true';$('play').disabled=false;$('play').title='Afspelen / pauzeren';
    if(playing)scheduleNext();
  },error:()=>{
    if(current!==frame)return;
    stopPlayback();$('play').title='Volgende beeld nog niet beschikbaar; kies Volgende tijdstap om opnieuw te laden';
  }});
}
function stopPlayback(){playing=false;clearTimeout(playTimer);icon($('play'),'play');$('play').setAttribute('aria-label','Animatie afspelen');$('play').disabled=!nextFrameReady;}
function scheduleNext(){clearTimeout(playTimer);playTimer=setTimeout(()=>{if(playing)requestFrame((wanted+1)%frames.length);},Number($('speed').value));}
$('play').addEventListener('click',()=>{
  if(playing){stopPlayback();return;}playing=true;icon($('play'),'pause');$('play').setAttribute('aria-label','Animatie pauzeren');if(!rendering)requestFrame((wanted+1)%frames.length);
});
$('now').addEventListener('click',()=>{stopPlayback();const index=nowFrameIndex(frames);if(index>=0)requestFrame(index);});
$('previous').addEventListener('click',()=>{stopPlayback();requestFrame(wanted-1);});
$('next').addEventListener('click',()=>{stopPlayback();requestFrame(wanted+1);});
let sliderTimer;
$('time-slider').addEventListener('input',()=>{stopPlayback();clearTimeout(sliderTimer);const target=nearestIndex(frames,frames[0].time+Number($('time-slider').value)*HOUR);$('time-slider').setAttribute('aria-valuetext',`Laden: ${forecastLabel(frames[target].time).text}`);sliderTimer=setTimeout(()=>requestFrame(target),130);});
document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>{stopPlayback();if(mode===b.dataset.mode)return;mode=b.dataset.mode;requestFrame(wanted,true);}));
function syncTempLevels(frame,modelId){
  const upper=MODEL_CONFIG[modelId]?.upperAir,chosen=tempVariable(modelId);
  $('temp-levels').hidden=frame.mode!=='temperature';
  for(const b of $('temp-levels').querySelectorAll('button')){
    const level=b.dataset.level;b.disabled=level!=='2m'&&!upper;
    b.setAttribute('aria-pressed',String(UPPER_AIR_LEVELS[level]===chosen));
  }
  let note='';
  if(!upper)note=`${MODELS[modelId].label} levert in deze bron geen drukvlakken; 850/500 hPa niet beschikbaar.`;
  else if(chosen!=='temperature_2m')note=fieldFile(frame,chosen)?`${upper.label} · ${upper.resolution}.`:`Dit tijdstip heeft geen ${chosen.slice(12,15)} hPa-veld: ${upper.label} ${upper.stepNote}.`;
  $('temp-level-note').textContent=note;
  const u=new URL(location.href);if(frame.mode==='temperature'&&tempLevel!=='2m')u.searchParams.set('level',tempLevel);else u.searchParams.delete('level');history.replaceState(null,'',u);
}
$('temp-levels').addEventListener('click',e=>{
  const b=e.target.closest('button[data-level]');if(!b||b.disabled||tempLevel===b.dataset.level)return;
  stopPlayback();tempLevel=b.dataset.level;requestFrame(wanted,true);
});
['clouds','snow','texture','fog','cloud-high','cloud-mid','cloud-low'].forEach(id=>$(id).addEventListener('change',()=>{syncCloudButtons();requestFrame(wanted,true);}));
$('isobars').addEventListener('change',()=>{stopPlayback();queueCityDraw();requestFrame(wanted,true);});
$('city-labels').addEventListener('change',()=>{queueCityDraw();if(current)updateViewportSamples();});
$('borders').addEventListener('change',()=>map.setLayoutProperty('borders','visibility',$('borders').checked?'visible':'none'));
$('opacity').addEventListener('input',()=>current?.ids.forEach(id=>map.setPaintProperty(id,'raster-opacity',Number($('opacity').value)/100)));
$('speed').addEventListener('change',()=>{if(playing&&!rendering&&nextFrameReady)scheduleNext();});
$('zoom-in').addEventListener('click',()=>{manualView();map.zoomIn();});$('zoom-out').addEventListener('click',()=>{manualView();map.zoomOut();});
$('europe').addEventListener('click',()=>{manualView();map.fitBounds([[-24,34],[42,70]],{padding:viewPadding(),duration:600});});
$('home').addEventListener('click',()=>fitModelView());
$('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('app').requestFullscreen();}catch{status('Volledig scherm is niet beschikbaar in deze browser.',true);}});
let pngURL=null;
$('png-close').addEventListener('click',()=>$('png-dialog').close());
$('png-dialog').addEventListener('close',()=>{if(pngURL)URL.revokeObjectURL(pngURL);pngURL=null;$('png-preview').removeAttribute('src');prepareAdjacentFrames();});
$('export-png').addEventListener('click',()=>exportPNG());
const areaSelection=installAreaSelection({app:$('app'),overlay:$('area-overlay'),box:$('area-box'),hint:$('area-hint'),save:$('area-save'),cancel:$('area-cancel'),onSave:rect=>exportPNG(rect),onClose:()=>{$('select-area').focus();prepareAdjacentFrames();}});
$('select-area').addEventListener('click',()=>{
  if(!current||rendering||refreshing){status('Wacht tot de kaart geladen is om een gebied te selecteren.');return;}
  stopPlayback();cancelPreparation();areaSelection.open();
});
map.on('movestart',()=>{if(!$('area-overlay').hidden)areaSelection.close();});
async function exportPNG(crop=null){
  stopPlayback();cancelPreparation();
  $('png-preview').hidden=true;$('png-save').hidden=true;$('png-status').textContent='De kaart wordt samengesteld…';$('png-dialog').showModal();$('export-png').disabled=true;
  try{
    if(!current||rendering||refreshing||$('app').dataset.frameStatus!=='ready')throw Error('Wacht tot de gekozen kaart geladen is en klik daarna opnieuw op PNG.');
    const frame=current,rev=revision,center=map.getCenter(),view=[center.lng,center.lat,map.getZoom()].join();
    await document.fonts.ready;
    const nextCenter=map.getCenter();
    if(current!==frame||revision!==rev||[nextCenter.lng,nextCenter.lat,map.getZoom()].join()!==view)throw Error('De kaart is gewijzigd. Klik opnieuw op PNG voor de nieuwe uitsnede.');
    if(frame.ids.some(id=>!map.isSourceLoaded(id)||frameErrors.has(id)))throw Error('De kaarttegels worden nog geladen. Probeer het zo opnieuw.');
    drawCities();
    const modelId=modelFor(frame.modelMeta),label=forecastLabel(frame.time,frame.modelMeta.reference_time,MODELS[modelId].label);
    const canvas=composePNG(captureMap($('map'),$('places'),crop),{
      title:`${MODELS[modelId].label} · ${modeNames[frame.mode]}${$('isobars').checked&&hasIsobars(frame.modelMeta)?' · Isobaren (4 hPa)':''}`,
      time:label.full,run:label.runLabel,lead:label.leadLabel,source:MODELS[modelId].attribution,opacity:$('opacity').value,
      legends:exportLegends({mode:frame.mode,variables:variablesForMode(frame.modelMeta,frame),cloudVisible:cloudVisibility(),hasBase:!!frame.samples.cloud_cover?.cloudBase}),
    });
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('PNG maken is niet gelukt.')),'image/png'));
    if(!$('png-dialog').open)return;
    if(pngURL)URL.revokeObjectURL(pngURL);pngURL=URL.createObjectURL(blob);
    $('png-preview').src=pngURL;$('png-preview').hidden=false;$('png-save').href=pngURL;$('png-save').download=pngFilename(modelId,frame.iso,frame.mode);$('png-save').hidden=false;
    $('png-status').textContent=`${canvas.width} × ${canvas.height} pixels · ${crop?'geselecteerd gebied':'huidige uitsnede'} · Ed Aldus · Weerlab`;
  }catch(error){$('png-status').textContent=error.name==='SecurityError'?'De achtergrondbron blokkeert PNG-export. Vernieuw de pagina en probeer opnieuw.':error.message;}
  finally{$('export-png').disabled=false;}
}
$('settings-toggle').addEventListener('click',()=>{const open=$('settings').hidden;if(open)closePoint();if(open&&innerHeight<650)setMenuCollapsed(true);$('settings').hidden=!open;$('settings-toggle').setAttribute('aria-expanded',String(open));});
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>{$(b.dataset.close).hidden=true;$('settings-toggle').setAttribute('aria-expanded','false');}));
$('info-toggle').addEventListener('click',()=>$('info').showModal());$('info-close').addEventListener('click',()=>$('info').close());
$('info').addEventListener('click',e=>{if(e.target===$('info')){const r=$('info').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('info').close();}});
$('retry').addEventListener('click',()=>retryLoad());
document.addEventListener('keydown',e=>{
  if(e.defaultPrevented)return;
  if(!$('area-overlay').hidden)return;
  if(e.key==='Escape'){$('settings').hidden=true;$('settings-toggle').setAttribute('aria-expanded','false');$('search-form').hidden=true;closePoint();}
  if(e.altKey||e.ctrlKey||e.metaKey||e.target.closest('input,select,textarea,dialog,#map,[contenteditable=true]')||document.querySelector('dialog[open]'))return;
  if(['ArrowRight','ArrowLeft','Home','End'].includes(e.key)&&(!e.target.closest('button')||e.target.closest('.timeline'))){
    e.preventDefault();stopPlayback();requestFrame(e.key==='Home'?0:e.key==='End'?frames.length-1:wanted+(e.key==='ArrowRight'?1:-1));
  }
  if(e.code==='Space'&&!e.target.closest('button')){e.preventDefault();$('play').click();}
});
document.addEventListener('visibilitychange',()=>{if(document.hidden){stopPlayback();cancelPreparation();}else prepareAdjacentFrames();});

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
  if(current&&$('isobars').checked&&hasIsobars(current.modelMeta)&&current.samples.pressure_msl){
    const audit=drawIsobars(ctx,current.samples.pressure_msl,p=>map.project(p),width,height);
    canvas.dataset.isobars=JSON.stringify({...audit,time:current.iso,run:current.modelMeta.reference_time});
  }else delete canvas.dataset.isobars;
  if(!$('city-labels').checked||!current)return;
  const symbolAudit=params.get('profile')==='1'?[]:null;
  const zoom=map.getZoom(), boxes=[], font=zoom<5?11:12,valueFont=font+2,windMode=current.mode==='wind',controls=document.querySelector('.bottom-area').getBoundingClientRect();
  for(const city of cities){
    if(city.minZoom>zoom)continue;
    const p=map.project([city.lon,city.lat]);
    if(p.x<25||p.x>width-25||p.y<20||p.y>height-25)continue;
    if(p.x>controls.left-12&&p.x<controls.right+12&&p.y>controls.top-42&&p.y<controls.bottom+24)continue;
    const name=city.name, w=Math.max(windMode?76:58,name.length*font*.53), rect=[p.x-w/2-9,p.y-(windMode?44:33),p.x+w/2+9,p.y+18];
    if(boxes.some(b=>rect[0]<b[2]&&rect[2]>b[0]&&rect[1]<b[3]&&rect[3]>b[1]))continue;
    boxes.push(rect);
    const temp=sample(current.samples.temperature_2m,city.lat,city.lon),rain=sample(current.samples.precipitation,city.lat,city.lon);
    const cloudField=current.samples.cloud_cover;
    const cloud=cloudIconType(...CLOUD_KEYS.map(key=>cloudField?.[key]?cloudField.grid.getInterpolatedValue(cloudField[key],city.lat,city.lon,'monotone'):NaN));
    ctx.font=`500 ${font}px Arial`;ctx.textAlign='center';ctx.lineJoin='round';ctx.lineWidth=2.7;ctx.strokeStyle='rgba(28,42,42,.7)';ctx.fillStyle='#f4f6f7';
    ctx.strokeText(name,p.x,p.y+12);ctx.fillText(name,p.x,p.y+12);
    if(!windMode){ctx.fillStyle='#f5f8e9';ctx.fillRect(p.x-1.3,p.y-4,2.6,2.6);}
    const levelVar=current.mode==='temperature'?current.ids.map(id=>id.split('-').slice(1).join('-')).find(v=>v.startsWith('temperature_')):null;
    const displayedValue=current.mode==='wind'?sample(current.samples.wind_u_component_10m,city.lat,city.lon):levelVar?sample(current.samples[levelVar],city.lat,city.lon):current.mode==='temperature'?NaN:temp;
    if(Number.isFinite(displayedValue)){const t=String(windMode?beaufort(displayedValue):Math.round(displayedValue)),y=p.y-(windMode?23:12);ctx.font=`700 ${valueFont}px Arial`;ctx.strokeText(t,p.x+7,y);ctx.fillStyle='#f3f663';ctx.fillText(t,p.x+7,y);}
    const fog=current.ids.some(id=>id.endsWith('-visibility'))?fogBand(sample(current.samples.visibility,city.lat,city.lon)):null;
    const snowfall=sample(current.samples.snowfall_water_equivalent,city.lat,city.lon);
    const symbol=weatherSymbol({precipitation:rain,snowfall,cloud,fog});
    if(symbolAudit)symbolAudit.push({name,lat:city.lat,lon:city.lon,precipitation:rain,snowfall,cloud,symbol});
    if(['rain','snow','mixed'].includes(symbol))drawPrecipitationSymbol(ctx,p.x-13,p.y-17,symbol);
    else if(symbol==='fog'){
      ctx.fillStyle=fog.color;ctx.strokeStyle='#4b401d';ctx.lineWidth=1.5;ctx.fillRect(p.x-23,p.y-25,20,18);ctx.strokeRect(p.x-23,p.y-25,20,18);
      for(let line=0;line<3;line++){ctx.beginPath();ctx.moveTo(p.x-20+(line%2)*2,p.y-21+line*5);ctx.lineTo(p.x-6,p.y-21+line*5);ctx.stroke();}
    }
    else if(symbol==='clear')skyIcon(ctx,p.x-13,p.y-16,city);
    else if(symbol==='filtered'){skyIcon(ctx,p.x-15,p.y-17,city);ctx.fillStyle='#ebeded';ctx.beginPath();ctx.ellipse(p.x-11,p.y-14,6,3,0,0,Math.PI*2);ctx.fill();}
    if(current.mode==='wind'){
      const wind=current.samples.wind_u_component_10m;
      if(wind?.data.directions&&Number.isFinite(displayedValue)){const a=wind.grid.getLinearInterpolatedDirection(wind.data.directions,city.lat,city.lon)*Math.PI/180;ctx.save();ctx.translate(p.x-16,p.y-27);ctx.rotate(a+Math.PI);ctx.beginPath();ctx.moveTo(0,9);ctx.lineTo(0,-9);ctx.lineTo(-4,-4);ctx.moveTo(0,-9);ctx.lineTo(4,-4);ctx.strokeStyle='#243846';ctx.lineWidth=4;ctx.stroke();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();ctx.restore();}
      const gust=sample(current.samples.wind_gusts_10m,city.lat,city.lon);
      if(Number.isFinite(gust)&&gust>=0){const text=`stoten ${Math.round(gust)}`;ctx.font=`600 ${font}px Arial`;ctx.strokeText(text,p.x,p.y-4);ctx.fillStyle='#fff';ctx.fillText(text,p.x,p.y-4);}
    }
    drawnCities.push({...city,x:p.x,y:p.y});
  }
  if(symbolAudit)canvas.dataset.weatherSymbols=JSON.stringify({model:modelFor(current.modelMeta),run:current.modelMeta.reference_time,time:current.iso,places:symbolAudit});
}

let pointMarker,pointController;
function showPoint(point){$('settings').hidden=true;$('settings-toggle').setAttribute('aria-expanded','false');if(innerHeight<650)setMenuCollapsed(true);selectedPoint=point;if(pointMarker)pointMarker.remove();pointMarker=new mapEngine.Marker({color:'#2ec4e8',scale:.7}).setLngLat([point.lng,point.lat]).addTo(map);$('point').hidden=false;$('search-form').hidden=true;updatePoint();}
function closePoint(){selectedPoint=null;$('point').hidden=true;pointMarker?.remove();pointMarker=null;}
$('point-close').addEventListener('click',closePoint);
function updatePoint(fetchMissing=true){
  if(!selectedPoint||!current)return;
  const p=selectedPoint;$('point-title').textContent=p.name;$('point-time').textContent=forecastLabel(current.time).full;
  const values=$('point-values');values.replaceChildren();
  const entries=[['temperature_2m','Temperatuur','°C',1],['precipitation',`Neerslag · ${current.hours}u-gemiddelde`,'mm/u',2],['cloud_cover','Bewolking','%',0],['wind_u_component_10m','Wind','Bft',0]];
  if(current.modelMeta.variables.includes('wind_gusts_10m'))entries.push(['wind_gusts_10m','Windstoten','km/u',0]);
  if(current.modelMeta.variables.includes('visibility'))entries.push(['visibility','Berekend zicht','m',1]);
  // Pressure-level temperature only for the chosen level, from the same run.
  if(current.mode==='temperature'){const v=tempVariable(modelFor(current.modelMeta));if(v!=='temperature_2m'&&fieldFile(current,v))entries.splice(1,0,[v,`Temperatuur ${v.slice(12,15)} hPa`,'°C',1]);}
  for(const [variable,label,unit,digits] of entries){
    const rawValue=sample(current.samples[variable],p.lat,p.lng),value=variable==='wind_u_component_10m'?beaufort(rawValue):rawValue,el=document.createElement('div'),strong=document.createElement('strong'),small=document.createElement('small');
    strong.textContent=Number.isFinite(value)?`${variable==='precipitation'&&value>0&&value<PRECIPITATION_THRESHOLD?'<'+PRECIPITATION_THRESHOLD.toLocaleString('nl-NL'):value.toLocaleString('nl-NL',{maximumFractionDigits:digits})} ${unit}`:'—';small.textContent=label;
    if(variable==='visibility'){
      const band=fogBand(value);strong.textContent=visibilityText(value);el.classList.add('visibility-value');
      if(band){el.classList.add('fog-value');el.style.setProperty('--fog-color',band.color);el.classList.toggle('fog-hatched',band.hatch);small.textContent=`≋ Mist · ${band.label} · berekend`; }
      el.title=`${p.name} · ${forecastLabel(current.time).full} · berekend zicht: ${visibilityText(value)}${band?' · '+band.label:''}`;
    }
    el.append(strong,small);values.append(el);
    if(variable==='cloud_cover'){
      const cloud=current.samples.cloud_cover;
      for(const [key,type] of [['cloudHigh','high'],['cloudMid','mid'],['cloudLow','low']]){
        const value=cloud?.[key]?cloud.grid.getInterpolatedValue(cloud[key],p.lat,p.lng,'monotone'):NaN;
        const item=document.createElement('div'),amount=document.createElement('strong'),label=document.createElement('small');
        item.className='cloud-point-value';amount.textContent=Number.isFinite(value)?`${Math.round(value)} %`:'—';label.textContent=CLOUD_STYLES[type].label;item.append(amount,label);values.append(item);
      }
      if(cloud?.cloudBase){
        const base=cloud.grid.getNearestNeighborValue(cloud.cloudBase,p.lat,p.lng);
        const item=document.createElement('div'),amount=document.createElement('strong'),label=document.createElement('small');
        item.className='cloud-point-value';amount.textContent=!Number.isFinite(base)||base<0?'—':base===9999?'Wolkenvrij':`${Math.round(base)} m`;
        label.textContent=isVeryLowCloud(base)?'Wolkenbasis · zeer laag':'Wolkenbasis';
        item.title='Oorspronkelijke modelhoogte van het dichtstbijzijnde bronpunt; <150 m is de weergavegrens voor zeer lage bewolking.';
        item.append(amount,label);values.append(item);
      }
    }
    if(variable==='wind_u_component_10m'){
      const wind=current.samples[variable],direction=wind?.data.directions?wind.grid.getLinearInterpolatedDirection(wind.data.directions,p.lat,p.lng):NaN;
      const item=document.createElement('div'),heading=document.createElement('strong'),label=document.createElement('small');
      item.className='wind-direction-value';heading.textContent=windDirectionText(direction);label.textContent='Windrichting (uit)';item.append(heading,label);values.append(item);
    }
  }
  const period=precipitationPeriod(current.modelMeta.reference_time,new Date(current.time).toISOString(),current.hours);
  const rain=sample(current.samples.precipitation,p.lat,p.lng),total=rain*period.hours;
  $('point-note').textContent=`Tijdvak: ${forecastLabel(period.start).text} – ${forecastLabel(period.end).full}. ${Number.isFinite(total)?`Totaal ${total>0&&total<.01?'<0,01':total.toLocaleString('nl-NL',{maximumFractionDigits:2})} mm (regen + sneeuw). `:''}${forecastLabel(current.time,period.run,MODELS[modelFor(current.modelMeta)].label).runLabel}. ${MODELS[modelFor(current.modelMeta)].resolution}`;
  Object.assign($('point').dataset,{precipitationRate:String(rain),precipitationAmount:String(total),periodStart:period.start,periodEnd:period.end,run:period.run});
  if(fetchMissing){
    const frame=current,missing=entries.map(e=>e[0]).filter(v=>!frame.samples[v]);
    if(missing.length){pointController?.abort();pointController=new AbortController();const pointSignal=pointController.signal;Promise.allSettled(missing.map(async v=>{const file=fieldFile(frame,v);if(!file)return;const field=await readField(file,v,pointSignal);if(current===frame)frame.samples[v]=field;})).then(()=>{if(current===frame&&selectedPoint===p)updatePoint(false);});}
  }
}

$('search-toggle').addEventListener('click',()=>{$('search-form').hidden=!$('search-form').hidden;if(!$('search-form').hidden)$('search').focus();});
let searchController;
const normalize=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
function searchButtons(results){
  $('search-results').replaceChildren();
  for(const result of results){const b=document.createElement('button');b.type='button';b.textContent=result.name;const small=document.createElement('small');small.textContent=result.detail||'Europa';b.append(small);b.addEventListener('click',()=>{showPoint({lng:result.lon,lat:result.lat,name:result.name});manualView();map.flyTo({center:[result.lon,result.lat],zoom:8,duration:700});});$('search-results').append(b);}
}
$('search').addEventListener('input',()=>{searchController?.abort();const q=normalize($('search').value.trim());searchButtons(q.length<2?[]:cities.filter(c=>normalize(c.name).includes(q)).slice(0,7));});
$('search-form').addEventListener('submit',async e=>{
  e.preventDefault();const q=$('search').value.trim();if(q.length<2)return;
  searchController?.abort();searchController=new AbortController();const controller=searchController;
  const ll=q.match(/^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/);
  if(ll){const lat=Number(ll[1]),lon=Number(ll[2]);if(inEurope(lon,lat)){showPoint({lat,lng:lon,name:`${lat}° N, ${lon}° E`});manualView();map.flyTo({center:[lon,lat],zoom:8});return;}}
  const local=cities.filter(c=>normalize(c.name).includes(normalize(q))).slice(0,7);searchButtons(local);
  try{
    const data=await json(`https://geocoding-api.open-meteo.com/v1/search?${new URLSearchParams({name:q,count:'10',language:'nl',format:'json'})}`,controller.signal);
    if(controller!==searchController)return;
    const results=(data.results||[]).filter(r=>inEurope(r.longitude,r.latitude)).map(r=>({name:r.name,lon:r.longitude,lat:r.latitude,detail:[r.admin1,r.country].filter(Boolean).join(' · ')}));
    if(results.length)searchButtons(results);else if(!local.length)$('search-results').textContent='Geen plaats in Europa gevonden.';
  }catch(error){if(error.name!=='AbortError'&&!local.length)$('search-results').textContent='Zoeken is tijdelijk niet beschikbaar. Probeer een andere plaats.';}
});

// A tiny metadata check picks up all four runs, only when visible and idle.
// Unchanged metadata never reloads fields. Never switch runs during playback.
let checkingRun=false;
async function checkForNewRun(){
  if(!current||!$('area-overlay').hidden||document.hidden||playing||rendering||refreshing||checkingRun||Date.now()-checkedAt<10*60*1000)return;
  checkedAt=Date.now();checkingRun=true;const polledModel=selectedModel,polledFrame=current;
  try {
    if(selectedModel!=='ecmwf_ifs'){
      const latest=await json(latestModelURL(selectedModel));
      if(selectedModel===polledModel&&current===polledFrame&&!playing&&!rendering&&!refreshing&&(Date.parse(latest.reference_time)>Date.parse(current.modelMeta.reference_time)||(isRegional(selectedModel)&&latest.reference_time===current.modelMeta.reference_time&&latest.version!==current.modelMeta.version)))await start(undefined,polledModel);
      return;
    }
    const latest=await json(`${DATA_ROOT}/latest.json`);
    if(selectedModel===polledModel&&current===polledFrame&&!playing&&!rendering&&!refreshing&&!document.hidden&&isNewerForecastRun(latest,current.timeline,Date.now()))await start(latest);
  } catch { /* Keep the current forecast when the metadata check fails. */ }
  finally {checkingRun=false;}
}
window.addEventListener('focus',checkForNewRun);
document.addEventListener('visibilitychange',checkForNewRun);
setInterval(checkForNewRun,60*1000);
start(window.weerlabLatest);
