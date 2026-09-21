import L from 'leaflet';
import {cloudBytes} from './cloud-fields.mjs';
import {MapDetails} from './map-details.mjs';
import { renderTile } from './tile-renderer.mjs';
import { SharedRenderQueue, abortError } from './render-queue.mjs';
import {visibleWeatherTiles} from './field-window.mjs';
import {CanvasCommits} from './canvas-commits.mjs';
import {frameScheduler} from './frame-scheduler.mjs';

// Canvas tiles keep the full ECMWF grid available on browsers without WebGL2.
let weatherLoader;
export const setWeatherLoader=loader=>{weatherLoader=loader;};
// Tile rasterisation used a single worker: one busy core while the machine
// had several idle ones. A small pool renders independent tiles in parallel;
// every worker keeps its own bounded field cache, together the same budget.
const POOL_SIZE=Math.max(1,Math.min(6,(globalThis.navigator?.hardwareConcurrency||4)-1));
const FIELD_BYTES=Math.round(32*1024*1024/POOL_SIZE),FIELD_ENTRIES=Math.max(8,Math.ceil(48/POOL_SIZE));
// Local diagnostics only; no reporting endpoint and no visitor tracking.
// Per-tile samples are kept only when the page is opened with ?profile=1.
const PROFILING=(()=>{try{return new URLSearchParams(location.search).get('profile')==='1';}catch{return false;}})();
export const renderStats={tiles:0,workerMs:0,commitWaitMs:0,commits:0,mainThreadTiles:0,samples:[]};
let jobCounter=0;
function createWorkerSlot(){
  let worker;
  try{
    const workerURL=new URL('./assets/weather-worker.js',document.baseURI);workerURL.search=new URL(import.meta.url).search;
    worker=new Worker(workerURL,{type:'module'});
  }catch{return null;}
  const slot={worker,fields:new globalThis.Map(),bytes:0,job:null};
  worker.onmessage=({data})=>{
    const job=slot.job;
    if(!job||job.id!==data.id)return;
    slot.job=null;
    renderStats.tiles++;const roundTrip=performance.now()-job.started;renderStats.workerMs+=roundTrip;
    if(PROFILING&&renderStats.samples.length<600)renderStats.samples.push({v:job.field.variable,x:job.coords.x,y:job.coords.y,z:job.coords.z,ms:Math.round(roundTrip),render:Math.round(data.renderMs||0)});
    if(data.error)job.reject(new Error(data.error));else job.resolve(data.pixels);
  };
  worker.onerror=()=>{
    slot.worker?.terminate();slot.worker=null;slot.fields.clear();slot.bytes=0;
    const job=slot.job;slot.job=null;
    if(job)renderOnMain(job.field,job.coords,job.signal).then(job.resolve,job.reject);
  };
  return slot;
}
const pool=Array.from({length:POOL_SIZE},createWorkerSlot).filter(Boolean);
const liveWorkers=()=>pool.reduce((n,slot)=>n+(slot.worker?1:0),0);
function renderOnMain(field,coords,signal){
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(abortError(signal));return;}
    const cancel=()=>{frameScheduler.cancel(frame);reject(abortError(signal));};
    const frame=frameScheduler.schedule(()=>{
      signal.removeEventListener('abort',cancel);
      if(signal.aborted){reject(abortError(signal));return;}
      try{resolve(renderTile(field,coords));}catch(error){reject(error);}
    });
    signal.addEventListener('abort',cancel,{once:true});
  });
}
function renderPixels({field,coords},signal){
  if(signal.aborted)return Promise.reject(abortError(signal));
  const slot=pool.find(s=>s.worker&&!s.job);
  if(!slot){renderStats.mainThreadTiles++;return renderOnMain(field,coords,signal);}
  return new Promise((resolve,reject)=>{
    // Upload and eviction happen at dispatch, so a field needed by this tile
    // cannot be dropped before its render message reaches the worker.
    if(slot.fields.has(field.key)){
      const bytes=slot.fields.get(field.key);slot.fields.delete(field.key);slot.fields.set(field.key,bytes);
    }else{
      slot.worker.postMessage({type:'field',key:field.key,gridData:field.gridData,ranges:field.ranges,packed:field.packed,variable:field.variable,values:field.data.values,cloudLow:field.cloudLow,cloudMid:field.cloudMid,cloudHigh:field.cloudHigh,cloudBase:field.cloudBase});
      const bytes=field.data.values.byteLength+cloudBytes(field);
      slot.fields.set(field.key,bytes);slot.bytes+=bytes;
      while(slot.fields.size>FIELD_ENTRIES||(slot.bytes>FIELD_BYTES&&slot.fields.size>2)){
        const old=slot.fields.keys().next().value;
        slot.bytes-=slot.fields.get(old);slot.fields.delete(old);slot.worker.postMessage({type:'drop',key:old});
      }
    }
    const id=++jobCounter;slot.job={id,resolve,reject,field,coords,signal,started:performance.now()};
    try{slot.worker.postMessage({type:'tile',id,key:field.key,coords:{x:coords.x,y:coords.y,z:coords.z},texture:field.texture,cloudVisible:field.cloudVisible});}
    catch(error){slot.job=null;reject(error);}
    // A worker's synchronous render cannot be interrupted. Keep its slot busy
    // until the reply arrives, even when subscribers cancel, so no message
    // pile can form. The queue discards that abandoned result.
  });
}
const paintQueue=new SharedRenderQueue(renderPixels,{maxEntries:256,concurrency:()=>Math.max(1,liveWorkers())});
const canvasCommits=new CanvasCommits();
function paint(field,coords,signal){
  const key=field.key+'|'+field.texture+'|'+(field.cloudVisible??7)+'|'+coords.z+'/'+coords.x+'/'+coords.y;
  return paintQueue.request(key,{field,coords},signal);
}
const WeatherTiles=L.GridLayer.extend({
  initialize(url,options){
    L.GridLayer.prototype.initialize.call(this,options);this.url=url;this.requests=new Set();
    this.on('tileunload',({tile})=>{
      tile.weatherRequest?.abort();
      if(this.unloadCheckPending)return;this.unloadCheckPending=true;
      queueMicrotask(()=>{
        this.unloadCheckPending=false;
        if(this._map&&this._loading&&this._noTilesToLoad()){this._loading=false;this.fire('load');}
      });
    });
  },
  onRemove(map){
    for(const controller of this.requests)controller.abort();this.requests.clear();
    L.GridLayer.prototype.onRemove.call(this,map);
  },
  _update(center){
    L.GridLayer.prototype._update.call(this,center);
    if(this.prunePending)return;this.prunePending=true;
    // Leaflet normally waits for a new tile to finish before pruning after a
    // pan. Prune now, before obsolete queued tiles consume the render slot.
    // Defer one microtask so _setView has installed its animation/noPrune flag.
    queueMicrotask(()=>{
      this.prunePending=false;
      if(this._map&&!this._noPrune&&!this._map._animatingZoom)this._pruneTiles();
    });
  },
  createTile(coords,done){
    const tile=document.createElement('canvas');tile.width=tile.height=256;
    const controller=new AbortController(),{signal}=controller;tile.weatherRequest=controller;this.requests.add(controller);
    Promise.resolve().then(()=>{
      if(signal.aborted)throw abortError(signal);
      return weatherLoader(this.url,signal);
    }).then(field=>paint(field,coords,signal)).then(pixels=>{const queued=performance.now();return canvasCommits.commit(()=>{
      renderStats.commits++;renderStats.commitWaitMs+=performance.now()-queued;
      if(signal.aborted)throw abortError(signal);
      tile.getContext('2d').putImageData(new ImageData(pixels,256,256),0,0);done(null,tile);
    },signal);}).catch(error=>{
      // Never call Leaflet's done for detached tiles: a new tile can already
      // have reused its coordinates. The unload handler settles loading state.
      if(!signal.aborted&&error?.name!=='AbortError')done(error,tile);
    }).finally(()=>{this.requests.delete(controller);delete tile.weatherRequest;});
    return tile;
  },
});
const ll=([lng,lat])=>[lat,lng];
export class Map {
  constructor(options){
    this.el=document.getElementById(options.container);this.sources=new globalThis.Map();this.layers=new globalThis.Map();this.events=new globalThis.Map();
    const bounds=options.maxBounds.map(ll);
    this.native=L.map(this.el,{zoomControl:false,attributionControl:false,preferCanvas:true,zoomSnap:1,zoomDelta:1,maxBounds:bounds,maxBoundsViscosity:1,minZoom:options.minZoom+1,maxZoom:options.maxZoom+1}).setView(ll(options.center),Math.round(options.zoom+1));
    this.native.createPane('weather');this.native.getPane('weather').style.zIndex=350;
    this.native.createPane('land');this.native.getPane('land').style.zIndex=250;this.native.getPane('land').style.pointerEvents='none';
    this.native.createPane('borders');this.native.getPane('borders').style.zIndex=450;this.native.getPane('borders').style.pointerEvents='none';
    const satellite=options.style.sources.satellite;
    L.tileLayer(satellite.tiles[0],{maxZoom:18,maxNativeZoom:17,attribution:satellite.attribution,noWrap:true}).addTo(this.native);
    this.details=new MapDetails(this.native,L);this.bordersVisible=true;
    this.native.on('moveend',()=>{if(this.detailsLoaded)this.detailsPromise=this.details.update();});
    for(const ev of ['movestart','move','resize','moveend'])this.native.on(ev,()=>this.fire(ev,{}));
    this.native.on('click',e=>this.fire('click',{lngLat:{lng:e.latlng.lng,lat:e.latlng.lat},point:e.containerPoint}));
    this.touchZoomRotate={disableRotation(){}};
    // Native initialization is synchronous; defer compatibility load event.
    queueMicrotask(()=>{this.loaded=true;this.fire('load',{});});
  }
  loadDetails(){
    if(this.detailsLoaded)return this.detailsPromise;this.detailsLoaded=true;
    this.detailsPromise=this.details.update();
    return this.detailsPromise;
  }
  on(ev,fn){if(!this.events.has(ev))this.events.set(ev,new Set());this.events.get(ev).add(fn);return this;}
  off(ev,fn){this.events.get(ev)?.delete(fn);return this;}
  once(ev,fn){const wrapped=e=>{this.off(ev,wrapped);fn(e);};this.on(ev,wrapped);if(ev==='load'&&this.loaded)queueMicrotask(()=>wrapped({}));return this;}
  fire(ev,e){for(const fn of this.events.get(ev)||[])fn(e);}
  addControl(control,position){control.addTo(this.native,position);}
  getBounds(){return this.native.getBounds();}
  getCenter(){return this.native.getCenter();}
  getZoom(){return this.native.getZoom()-1;}
  getCanvas(){return this.el;}
  performanceStats(){return {
    pixelCacheEntries:paintQueue.cache.size,pixelCacheBytes:[...paintQueue.cache.values()].reduce((n,v)=>n+v.byteLength,0),
    workerFields:pool.reduce((n,slot)=>n+slot.fields.size,0),workerFieldBytes:pool.reduce((n,slot)=>n+slot.bytes,0),workers:liveWorkers(),
    pendingTiles:paintQueue.pending.size,weatherLayers:this.layers.size,
    renderedTiles:renderStats.tiles,workerMs:Math.round(renderStats.workerMs),
    commits:renderStats.commits,commitWaitMs:Math.round(renderStats.commitWaitMs),mainThreadTiles:renderStats.mainThreadTiles,
    detailTiles:this.details.layers.size,detailCacheTiles:this.details.cache.size,
  };}
  setFrameBudget(fieldCount){
    const b=this.getBounds(),tiles=visibleWeatherTiles([b.getWest(),b.getSouth(),b.getEast(),b.getNorth()],this.getZoom());
    // Four frames: the selected one, both prepared neighbours and the frame
    // being prepared after a step. With three, the parallel renderers filled
    // the cache and dropped the previous frame that the user steps back to.
    // The absolute ceiling remains 1024 tiles, never a full-day cache.
    paintQueue.maxEntries=Math.min(1024,Math.max(32,tiles.length*fieldCount*4+8));
  }
  async prepareFields(fields,signal){
    const b=this.getBounds(),tiles=visibleWeatherTiles([b.getWest(),b.getSouth(),b.getEast(),b.getNorth()],this.getZoom());
    this.setFrameBudget(fields.length);
    await Promise.all(fields.flatMap(field=>tiles.map(coords=>paint(field,coords,signal))));
  }
  project(point){return this.native.latLngToContainerPoint(ll(point));}
  zoomIn(){this.native.zoomIn();} zoomOut(){this.native.zoomOut();}
  flyTo(o){
    const zoom=o.zoom+1;
    // Large fly animations redraw every vector/city at many intermediate
    // scales and request tiles that are never used. Jump directly instead.
    if(Math.abs(zoom-this.native.getZoom())>1)this.native.setView(ll(o.center),zoom,{animate:false});
    else this.native.flyTo(ll(o.center),zoom,{duration:(o.duration||500)/1000});
  }
  fitBounds(bounds,o){
    const p=o.padding,previousSnap=this.native.options.zoomSnap;
    // Integer snapping can nearly double the region shown on a smaller screen.
    // Allow the named regional fit to use quarter zooms; manual zoom is unchanged.
    try{if(o.zoomSnap!==undefined)this.native.options.zoomSnap=o.zoomSnap;this.native.fitBounds(bounds.map(ll),{paddingTopLeft:[p.left,p.top],paddingBottomRight:[p.right,p.bottom],animate:false});}
    finally{this.native.options.zoomSnap=previousSnap;}
  }
  addSource(id,source){this.sources.set(id,source);}
  getSource(id){return this.sources.get(id);}
  removeSource(id){this.sources.delete(id);}
  getLayer(id){return this.layers.get(id);}
  addLayer(def){
    const source=this.sources.get(def.source);
    const layer=new WeatherTiles(source.url,{pane:'weather',tileSize:256,minZoom:2,maxZoom:12,maxNativeZoom:10,noWrap:true,keepBuffer:1,updateWhenIdle:true,updateWhenZooming:false,opacity:def.paint['raster-opacity'],bounds:[[29,-26],[73,46]]});
    layer.on('load',()=>this.fire('sourcedata',{sourceId:def.id}));
    layer.on('tileerror',e=>this.fire('error',{sourceId:def.id,error:e.error}));
    this.layers.set(def.id,layer);layer.addTo(this.native);
  }
  isSourceLoaded(id){const layer=this.layers.get(id);return layer&&!layer.isLoading();}
  removeLayer(id){const layer=this.layers.get(id);if(layer)this.native.removeLayer(layer);this.layers.delete(id);}
  setPaintProperty(id,property,value){if(property==='raster-opacity')this.layers.get(id)?.setOpacity(value);}
  setLayoutProperty(id,property,value){
    if(id!=='borders')return;this.bordersVisible=value!=='none';
    this.details.setBorders(this.bordersVisible);
  }
}
export class AttributionControl {
  constructor(options){this.options=options;}
  addTo(map,position){const c=L.control.attribution({position:position.replace('-',''),prefix:false}).addTo(map);c.addAttribution(this.options.customAttribution);}
}
export class ScaleControl {
  constructor(options){this.options=options;}
  addTo(map,position){L.control.scale({position:position.replace('-',''),maxWidth:this.options.maxWidth,metric:true,imperial:false}).addTo(map);}
}
export class Marker {
  constructor(options){this.options=options;}
  setLngLat(coords){this.coords=coords;return this;}
  addTo(map){this.marker=L.circleMarker(ll(this.coords),{radius:7,color:'#fff',weight:2,fillColor:this.options.color,fillOpacity:1,pane:'borders',interactive:false}).addTo(map.native);return this;}
  remove(){this.marker?.remove();}
}
