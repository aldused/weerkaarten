import {decodePacket} from './packed-grid.mjs';
export const FIELD_ORIGIN='https://weerlab-ecmwf-fields.dawn-term-a69f.workers.dev';
export class FieldPackets{
  constructor({fetcher=(...args)=>fetch(...args),storage=globalThis.caches,maxBytes=48*1024*1024,maxEntries=192}={}){
    Object.assign(this,{fetcher,storage,maxBytes,maxEntries});this.writes=0;this.maintenance=null;
  }
  async read(file,variable,bounds,signal){
    const source=new URL(file).pathname.match(/\/data_spatial\/ecmwf_ifs\/.*$/)?.[0];
    if(!source)throw new Error('Ongeldige ECMWF-bron');
    const url=FIELD_ORIGIN+source+'?'+new URLSearchParams({v:'3',variable,bounds:bounds.join(',')});
    const expected={source,variable,bounds};let cache,present;
    try{cache=await this.storage?.open('weerlab-ecmwf-packed-v3');}catch{/* Storage is optional in restricted/private browsers. */}
    signal?.throwIfAborted();
    try{present=await cache?.match(url);}catch{cache=undefined;}
    if(present){try{return decodePacket(await present.arrayBuffer(),expected);}catch{await cache.delete(url).catch(()=>{});}}
    signal?.throwIfAborted();
    const response=await this.fetcher(url,{signal});
    if(!response.ok)throw new Error(`Weerkaartbron tijdelijk niet bereikbaar (${response.status})`);
    const bytes=await response.arrayBuffer();signal?.throwIfAborted();
    const result=decodePacket(bytes,expected);
    if(cache)void cache.put(url,new Response(bytes,{headers:{'Content-Type':'application/octet-stream','X-Stored-At':String(Date.now()),'Content-Length':String(bytes.byteLength)}})).then(()=>{if(++this.writes%8===1)this.trim(cache);}).catch(()=>{});
    return result;
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
