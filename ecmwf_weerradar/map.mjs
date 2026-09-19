import L from 'leaflet';
import { renderTile } from './tile-renderer.mjs';
import { SharedRenderQueue, abortError } from './render-queue.mjs';

// Canvas tiles keep the full ECMWF grid available on browsers without WebGL2.
let weatherLoader;
export const setWeatherLoader=loader=>{weatherLoader=loader;};
const workerFields=new globalThis.Map();
let worker,workerJob,jobCounter=0;
try{
  const workerURL=new URL('./assets/weather-worker.js',document.baseURI);workerURL.search=new URL(import.meta.url).search;
  worker=new Worker(workerURL,{type:'module'});
  worker.onmessage=({data})=>{
    if(!workerJob||workerJob.id!==data.id)return;
    const job=workerJob;workerJob=null;
    if(data.error)job.reject(new Error(data.error));else job.resolve(data.pixels);
  };
  worker.onerror=()=>{
    worker?.terminate();worker=null;workerFields.clear();
    const job=workerJob;workerJob=null;
    if(job)renderOnMain(job.field,job.coords,job.signal).then(job.resolve,job.reject);
  };
}catch{}
function renderOnMain(field,coords,signal){
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(abortError(signal));return;}
    const cancel=()=>{cancelAnimationFrame(frame);reject(abortError(signal));};
    const frame=requestAnimationFrame(()=>{
      signal.removeEventListener('abort',cancel);
      if(signal.aborted){reject(abortError(signal));return;}
      try{resolve(renderTile(field,coords));}catch(error){reject(error);}
    });
    signal.addEventListener('abort',cancel,{once:true});
  });
}
function renderPixels({field,coords},signal){
  if(signal.aborted)return Promise.reject(abortError(signal));
  if(!worker)return renderOnMain(field,coords,signal);
  return new Promise((resolve,reject)=>{
    // Upload and eviction happen at dispatch, so fields needed by queued jobs
    // cannot be dropped before their render message reaches the worker.
    if(workerFields.has(field.key)){
      const bytes=workerFields.get(field.key);workerFields.delete(field.key);workerFields.set(field.key,bytes);
    }else{
      worker.postMessage({type:'field',key:field.key,gridData:field.gridData,ranges:field.ranges,variable:field.variable,values:field.data.values,cloudLow:field.cloudLow,cloudHigh:field.cloudHigh});
      workerFields.set(field.key,field.data.values.byteLength+(field.cloudLow?.byteLength||0)+(field.cloudHigh?.byteLength||0));
      let bytes=[...workerFields.values()].reduce((a,b)=>a+b,0);
      while(workerFields.size>12||(bytes>96*1024*1024&&workerFields.size>3)){
        const old=workerFields.keys().next().value;bytes-=workerFields.get(old);workerFields.delete(old);worker.postMessage({type:'drop',key:old});
      }
    }
    const id=++jobCounter;workerJob={id,resolve,reject,field,coords,signal};
    try{worker.postMessage({type:'tile',id,key:field.key,coords:{x:coords.x,y:coords.y,z:coords.z},texture:field.texture});}
    catch(error){workerJob=null;reject(error);}
    // A worker's synchronous render cannot be interrupted. Keep this slot busy
    // until its reply, even when its subscribers cancel, so only one tile is
    // ever posted. The queue will discard that abandoned result.
  });
}
const paintQueue=new SharedRenderQueue(renderPixels,{maxEntries:128});
function paint(field,coords,signal){
  const key=field.key+'|'+field.texture+'|'+coords.z+'/'+coords.x+'/'+coords.y;
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
    }).then(field=>paint(field,coords,signal)).then(pixels=>{
      if(signal.aborted)throw abortError(signal);
      tile.getContext('2d').putImageData(new ImageData(pixels,256,256),0,0);done(null,tile);
    }).catch(error=>{
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
    this.countriesURL=options.style.sources.countries.data;this.bordersVisible=true;
    for(const ev of ['move','resize','moveend'])this.native.on(ev,()=>this.fire(ev,{}));
    this.native.on('click',e=>this.fire('click',{lngLat:{lng:e.latlng.lng,lat:e.latlng.lat},point:e.containerPoint}));
    this.touchZoomRotate={disableRotation(){}};
    // Native initialization is synchronous; defer compatibility load event.
    queueMicrotask(()=>{this.loaded=true;this.fire('load',{});});
  }
  loadDetails(){
    if(this.detailsLoaded)return;this.detailsLoaded=true;
    fetch('./assets/land.geojson').then(r=>r.json()).then(data=>{
      L.geoJSON(data,{pane:'land',interactive:false,style:{stroke:false,fillColor:'#719342',fillOpacity:.44}}).addTo(this.native);
    }).catch(()=>{});
    fetch('./assets/regions.geojson').then(r=>r.json()).then(data=>{
      this.regions=L.geoJSON(data,{pane:'borders',interactive:false,style:{color:'#2e4d58',weight:.6,opacity:.65,fill:false}});
      if(this.bordersVisible)this.regions.addTo(this.native);
    }).catch(()=>{});
    fetch(this.countriesURL).then(r=>r.json()).then(data=>{
      this.border=L.geoJSON(data,{pane:'borders',interactive:false,style:{color:'#1b3034',weight:1,opacity:.75,fill:false}});
      if(this.bordersVisible)this.border.addTo(this.native);
    }).catch(()=>{});
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
  project(point){return this.native.latLngToContainerPoint(ll(point));}
  zoomIn(){this.native.zoomIn();} zoomOut(){this.native.zoomOut();}
  flyTo(o){this.native.flyTo(ll(o.center),o.zoom+1,{duration:(o.duration||500)/1000});}
  fitBounds(bounds,o){const p=o.padding;this.native.flyToBounds(bounds.map(ll),{paddingTopLeft:[p.left,p.top],paddingBottomRight:[p.right,p.bottom],duration:(o.duration||500)/1000});}
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
    for(const layer of [this.border,this.regions])if(layer){if(this.bordersVisible)layer.addTo(this.native);else layer.remove();}
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
