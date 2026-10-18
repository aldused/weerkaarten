import {retryFetch} from './retry-fetch.mjs';
import {decodeRegularPacket} from './regular-grid.mjs';
import {decodeProjectedPacket} from './projected-grid.mjs';
import {decodePacket} from './packed-grid.mjs';
export const HARMONIE_ORIGIN='https://weerlab-harmonie-fields.dawn-term-a69f.workers.dev';
export const FIELD_ORIGIN='https://weerlab-ecmwf-fields.dawn-term-a69f.workers.dev';
export class FieldPackets{
  constructor({fetcher=(...args)=>fetch(...args),storage=globalThis.caches,maxBytes=160*1024*1024,maxEntries=1024}={}){
    Object.assign(this,{fetcher,storage,maxBytes,maxEntries});this.writes=0;this.maintenance=null;
    // One network transfer per packet URL, shared by the visible map and the
    // background warm-up of later forecast hours.
    this.inflight=new Map();
  }
  wire(file,variable,bounds){
    // A separate transport identity keeps old total-only cloud packets out
    // of both caches while leaving all non-cloud protocols unchanged.
    if(variable==='cloud_cover')variable='cloud_layers';
    const path=new URL(file).pathname,isHarmonie=/^\/harmonie\/(harmonie|harmonie46|icond2)\/\d{10}-[a-f0-9]{16}\/\d{3}\.bin$/.test(path);
    // Regular lat/lon OM domains (pressure-level temperature only) share the
    // Weerlab regular packet format with the regional exports.
    const regularOM=/^\/data_spatial\/(ecmwf_ifs025|ncep_gfs013|ncep_gfs025|dwd_icon_d2)\//.test(path);
    const source=isHarmonie?path:path.match(/\/data_spatial\/(?:ecmwf_ifs|ecmwf_ifs025|ncep_gfs013|ncep_gfs025|dwd_icon_d2|knmi_harmonie_arome_europe|dmi_harmonie_arome_europe)\/.*$/)?.[0],projected=/^\/data_spatial\/(knmi|dmi)_harmonie_arome_europe\//.test(path),decode=isHarmonie||regularOM?decodeRegularPacket:projected?decodeProjectedPacket:decodePacket;
    if(!source)throw new Error('Ongeldige ECMWF-bron');
    const url=(isHarmonie?HARMONIE_ORIGIN:FIELD_ORIGIN)+source+'?'+new URLSearchParams({v:isHarmonie||projected||regularOM?'1':'3',variable,bounds:bounds.join(',')});
    return {url,decode,expected:{source,variable,bounds}};
  }
  async openCache(){try{return await this.storage?.open('weerlab-ecmwf-packed-v3');}catch{return undefined;/* Storage is optional in restricted/private browsers. */}}
  /** Network transfer shared between callers. A visible-map request may be
   * aborted by its caller without cancelling a transfer others still await. */
  transfer(url,cache,{priority='high',signal}={}){
    let task=this.inflight.get(url);
    if(!task){
      const controller=new AbortController();
      const promise=retryFetch(url,{signal:controller.signal,priority},this.fetcher,{readResponse:async response=>{
        if(!response.ok)throw new Error(`Weerkaartbron tijdelijk niet bereikbaar (${response.status})`);
        return response.arrayBuffer();
      }});
      task={promise,controller,users:0};this.inflight.set(url,task);
      promise.then(bytes=>{
        const copy=cache?bytes.slice(0):null;
        if(cache)void Promise.resolve().then(()=>cache.put(url,new Response(copy,{headers:{'Content-Type':'application/octet-stream','X-Stored-At':String(Date.now()),'Content-Length':String(copy.byteLength)}}))).then(()=>{if(++this.writes%64===1)this.trim(cache);}).catch(()=>{});
      },()=>{}).finally(()=>{if(this.inflight.get(url)===task)this.inflight.delete(url);});
    }
    if(!signal)return task.promise;
    task.users++;
    return new Promise((resolve,reject)=>{
      const abort=()=>{
        if(--task.users<=0&&!task.background)task.controller.abort();
        reject(signal.reason??new DOMException('Aborted','AbortError'));
      };
      if(signal.aborted){abort();return;}
      signal.addEventListener('abort',abort,{once:true});
      task.promise.then(value=>{signal.removeEventListener('abort',abort);task.users--;resolve(value);},error=>{signal.removeEventListener('abort',abort);task.users--;reject(error);});
    });
  }
  async read(file,variable,bounds,signal){
    const {url,decode,expected}=this.wire(file,variable,bounds);
    let cache=await this.openCache(),present;
    signal?.throwIfAborted();
    try{present=await cache?.match(url);}catch{cache=undefined;}
    if(present){try{return decode(await present.arrayBuffer(),expected);}catch{await cache.delete(url).catch(()=>{});}}
    signal?.throwIfAborted();
    const bytes=await this.transfer(url,cache,{signal});signal?.throwIfAborted();
    // Private copy: decoded fields are normalised in place and a transfer may be shared.
    return decode(bytes.slice(0),expected);
  }
  /** Background warm-up: store the transport bytes only. No decoding or
   * drawing happens until the visitor actually selects that hour. */
  async warm(file,variable,bounds){
    const {url}=this.wire(file,variable,bounds);
    if(this.inflight.has(url))return 'inflight';
    const cache=await this.openCache();
    if(!cache)return 'nostore';
    try{if(await cache.match(url))return 'cached';}catch{return 'nostore';}
    if(this.inflight.has(url))return 'inflight';
    const promise=this.transfer(url,cache,{priority:'low'});
    const task=this.inflight.get(url);if(task)task.background=true;
    await promise;return 'fetched';
  }
  trim(cache){
    if(this.maintenance)return this.maintenance;
    this.maintenance=(async()=>{
      const keys=await cache.keys(),entries=await Promise.all(keys.map(async key=>{const r=await cache.match(key);return {key,time:Number(r?.headers.get('X-Stored-At'))||0,size:Number(r?.headers.get('Content-Length'))||0};}));
      entries.sort((a,b)=>b.time-a.time);let bytes=0;
      for(let i=0;i<entries.length;i++){bytes+=entries[i].size;if(i>=this.maxEntries||bytes>this.maxBytes||Date.now()-entries[i].time>86400000)await cache.delete(entries[i].key);}
    })().finally(()=>{this.maintenance=null;});return this.maintenance;
  }
}
