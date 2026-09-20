import {OmFileReader,BlockCacheBackend,LruBlockCache} from '@openmeteo/file-reader';
import {getProtocolInstance,defaultOmProtocolSettings} from '@openmeteo/weather-map-layer';
import {RangeBatcher} from '../range-batcher.mjs';

// Cloudflare request contexts may share completed bytes, never live I/O or
// pending fetch promises owned by another request.
const sharedBytes=new Map(),sharedCatalogues=new Map();let sharedSize=0;
function remember(key,value){
  if(sharedBytes.has(key))return;
  sharedBytes.set(key,value);sharedSize+=value.byteLength;
  while(sharedSize>12*1024*1024){const first=sharedBytes.keys().next().value;sharedSize-=sharedBytes.get(first).byteLength;sharedBytes.delete(first);}
}

export function nativeReader(wasm,fetcher=(...args)=>fetch(...args),requestSignal){
  const batcher=new RangeBatcher({fetcher,concurrency:6,retries:0});
  class Cache extends LruBlockCache{
    get(key,fn,size,signal){
      if(requestSignal)signal=signal?AbortSignal.any([signal,requestSignal]):requestSignal;
      if(signal?.aborted)return Promise.reject(signal.reason);
      if(sharedBytes.has(key))return Promise.resolve(sharedBytes.get(key));
      const match=String(key).match(/^(.*\.om)\/block\/(\d+)$/);
      if(match&&size){const end=size-Number(match[2])*65536,start=Math.max(0,end-65536);return super.get(key,s=>batcher.read(match[1],start,end,size,s),size,signal).then(value=>{remember(key,value);return value;});}
      return super.get(key,fn,size,signal);
    }
  }
  const cache=new Cache(65536,256),catalogues=new Map();
  const Reader=getProtocolInstance({...defaultOmProtocolSettings,fileReaderConfig:{cache,useSAB:false}}).omFileReader.constructor;
  const reader=new Reader({cache,useSAB:false});
  reader.withReader=async(url,callback)=>{
    let opening=catalogues.get(url);
    if(!opening){
      opening=(async()=>{
        const saved=sharedCatalogues.get(url);
        if(saved){for(const [key,bytes] of saved.blocks)remember(key,bytes);return saved.total;}
        const timeout=AbortSignal.timeout(20000);
        const r=await fetcher(url,{headers:{Range:'bytes=-262144'},signal:requestSignal?AbortSignal.any([requestSignal,timeout]):timeout});
        const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(r.headers.get('Content-Range')||'');
        if(r.status!==206||!match)throw new Error('Invalid native catalogue');
        const bytes=new Uint8Array(await r.arrayBuffer()),[start,end,total]=match.slice(1).map(Number);
        if(bytes.length!==end-start+1||end!==total-1||start!==Math.max(0,total-262144))throw new Error('Truncated native catalogue');
        // Avoid a network miss when seeding the four catalogue blocks.
        const blocks=[];
        for(let i=0;i<bytes.length/65536;i++){
          const end=bytes.length-i*65536,part=bytes.slice(Math.max(0,end-65536),end);
          await LruBlockCache.prototype.get.call(cache,`${url}/block/${i}`,async()=>part,total);
          blocks.push([`${url}/block/${i}`,part]);remember(`${url}/block/${i}`,part);
        }
        sharedCatalogues.set(url,{total,blocks});while(sharedCatalogues.size>8)sharedCatalogues.delete(sharedCatalogues.keys().next().value);
        return total;
      })();catalogues.set(url,opening);opening.catch(()=>catalogues.delete(url));
      while(catalogues.size>16)catalogues.delete(catalogues.keys().next().value);
    }
    const size=await opening;
    const backend={count:async()=>size,close:async()=>{},getBytes(){throw new Error('Only validated blocks');}};
    const root=await new OmFileReader(BlockCacheBackend.withStringKeys(backend,cache,url),wasm).initialize();
    try{return await callback(root);}finally{root.dispose();}
  };
  return reader;
}
