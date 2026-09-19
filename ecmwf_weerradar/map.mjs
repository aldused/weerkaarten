import L from 'leaflet';
import { renderTile } from './tile-renderer.mjs';

// Canvas tiles keep the full ECMWF grid available on browsers without WebGL2.
let weatherLoader;
export const setWeatherLoader=loader=>{weatherLoader=loader;};
const tileCache=new globalThis.Map(),workerFields=new globalThis.Map(),jobs=new globalThis.Map();
let worker,jobCounter=0;
try{
  const workerURL=new URL('./assets/weather-worker.js',document.baseURI);workerURL.search=new URL(import.meta.url).search;
  worker=new Worker(workerURL,{type:'module'});
  worker.onmessage=({data})=>{
    const job=jobs.get(data.id);if(!job)return;jobs.delete(data.id);
    if(data.error)job.reject(new Error(data.error));else job.resolve(data.pixels);
  };
  worker.onerror=()=>{
    worker?.terminate();worker=null;workerFields.clear();
    for(const job of jobs.values()){try{job.resolve(renderTile(job.field,job.coords));}catch(error){job.reject(error);}}
    jobs.clear();
  };
}catch{}
function paint(field,coords){
  const key=field.key+'|'+field.texture+'|'+coords.z+'/'+coords.x+'/'+coords.y;
  if(tileCache.has(key)){const result=tileCache.get(key);tileCache.delete(key);tileCache.set(key,result);return result;}
  const task=new Promise((resolve,reject)=>{
    if(!worker){requestAnimationFrame(()=>{try{resolve(renderTile(field,coords));}catch(error){reject(error);}});return;}
    if(!workerFields.has(field.key)){
      worker.postMessage({type:'field',key:field.key,gridData:field.gridData,ranges:field.ranges,variable:field.variable,values:field.data.values,cloudLow:field.cloudLow,cloudHigh:field.cloudHigh});
      workerFields.set(field.key,field.data.values.byteLength+(field.cloudLow?.byteLength||0)+(field.cloudHigh?.byteLength||0));
      let bytes=[...workerFields.values()].reduce((a,b)=>a+b,0);
      while(workerFields.size>12||(bytes>96*1024*1024&&workerFields.size>3)){const old=workerFields.keys().next().value;bytes-=workerFields.get(old);workerFields.delete(old);worker.postMessage({type:'drop',key:old});}
    }
    const id=++jobCounter;jobs.set(id,{resolve,reject,field,coords});
    worker.postMessage({type:'tile',id,key:field.key,coords:{x:coords.x,y:coords.y,z:coords.z},texture:field.texture});
  }).catch(error=>{tileCache.delete(key);throw error;});
  tileCache.set(key,task);while(tileCache.size>128)tileCache.delete(tileCache.keys().next().value);
  return task;
}
const WeatherTiles=L.GridLayer.extend({
  initialize(url,options){L.GridLayer.prototype.initialize.call(this,options);this.url=url;},
  createTile(coords,done){
    const tile=document.createElement('canvas');tile.width=tile.height=256;
    weatherLoader(this.url).then(field=>paint(field,coords)).then(pixels=>{
      tile.getContext('2d').putImageData(new ImageData(pixels,256,256),0,0);done(null,tile);
    }).catch(error=>done(error,tile));
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
    this.countriesURL=options.style.sources.countries.data;
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
      this.regions=L.geoJSON(data,{pane:'borders',interactive:false,style:{color:'#2e4d58',weight:.6,opacity:.65,fill:false}}).addTo(this.native);
    }).catch(()=>{});
    fetch(this.countriesURL).then(r=>r.json()).then(data=>{
      this.border=L.geoJSON(data,{pane:'borders',interactive:false,style:{color:'#1b3034',weight:1,opacity:.75,fill:false}}).addTo(this.native);
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
  setLayoutProperty(id,property,value){if(id==='borders')for(const layer of [this.border,this.regions])if(layer){if(value==='none')layer.remove();else layer.addTo(this.native);}}
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
