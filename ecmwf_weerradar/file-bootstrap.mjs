import {BlockCacheBackend, OmDataType, OmFileReader} from '@openmeteo/file-reader';
import {createSharedTask,consumeTask} from './shared-task.mjs';

// OM files put their catalogue at the end. One suffix request supplies both
// the file length and catalogue, replacing HEAD -> trailer -> catalogue.
export class BootstrapFiles {
  constructor(cache,{fetcher=(...args)=>globalThis.fetch(...args),tailBytes=262144,maxFiles=32}={}){
    Object.assign(this,{cache,fetcher,tailBytes,maxFiles});this.files=new Map();
  }
  open(url,signal){
    let task=this.files.get(url);
    if(task?.controller.signal.aborted){this.files.delete(url);task=null;}
    if(!task){
      task=createSharedTask(async sharedSignal=>{
        let size=await this.cache.size(`${url}/block/0`);
        if(!Number.isSafeInteger(size)||size<=0){
          const response=await this.fetcher(`${url}?tail=${this.tailBytes}`,{headers:{Range:`bytes=-${this.tailBytes}`},signal:AbortSignal.any([sharedSignal,AbortSignal.timeout(30000)])});
          const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range')||'');
          if(response.status!==206||!match)throw new Error('Ongeldige ECMWF-bestandsindex');
          const [start,end,total]=match.slice(1).map(Number);
          if(![start,end,total].every(Number.isSafeInteger)||total<=0||end!==total-1||start!==Math.max(0,total-this.tailBytes))throw new Error('Ongeldig ECMWF-indexbereik');
          const bytes=new Uint8Array(await response.arrayBuffer());
          if(bytes.length!==end-start+1)throw new Error('Onvolledige ECMWF-bestandsindex');
          sharedSignal.throwIfAborted();
          await this.cache.seedTail(url,bytes,total);size=total;
        }
        return {
          count:async()=>size,close:async()=>{},
          // BlockCacheBackend routes every miss through the validated cache.
          getBytes:()=>{throw new Error('ECMWF-blokcache is vereist');},
        };
      });
      this.files.set(url,task);
      task.promise.catch(()=>{if(this.files.get(url)===task)this.files.delete(url);});
    }
    this.files.delete(url);this.files.set(url,task);
    for(const [key,value] of this.files){if(this.files.size<=this.maxFiles)break;if(value.settled)this.files.delete(key);}
    return consumeTask(task,signal);
  }
  async readVariable(url,variable,ranges,signal){
    const backend=await this.open(url,signal);signal?.throwIfAborted();
    const reader=await OmFileReader.create(BlockCacheBackend.withStringKeys(backend,this.cache,url));
    let child;
    try{
      signal?.throwIfAborted();child=await reader.getChildByName(variable);
      if(!child)throw new Error(`ECMWF-variabele ontbreekt: ${variable}`);
      return {values:await child.read({type:OmDataType.FloatArray,ranges,intoSAB:false,signal,prefetchConcurrency:64}),directions:undefined,scaleFactor:child.scaleFactor()};
    }finally{child?.dispose();reader.dispose();}
  }
}
