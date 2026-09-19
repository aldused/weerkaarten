import {rangeRequestURL} from './data-transport.mjs';
/** Merge only adjacent requested byte ranges of the SAME immutable run file.
 * CacheStorage still owns block reuse/deduplication. This layer reduces HTTP
 * round trips without downloading gaps or changing compressed weather bytes.
 */
export class RangeBatcher {
  constructor({fetcher=(...args)=>globalThis.fetch(...args),delayMs=4,maxBytes=512*1024,concurrency=6,retries=2,timeoutMs=30000}={}){
    Object.assign(this,{fetcher,delayMs,maxBytes,concurrency,retries,timeoutMs});
    this.pending=[];this.queue=[];this.active=0;this.timer=null;
  }
  read(url,start,end,total,signal){
    if(signal?.aborted)return Promise.reject(signal.reason??new DOMException('Aborted','AbortError'));
    return new Promise((resolve,reject)=>{
      const item={url,start,end,total,signal,resolve,reject,done:false,group:null};
      const finish=(error,data)=>{
        if(item.done)return;item.done=true;signal?.removeEventListener('abort',item.abort);
        if(error)reject(error);else resolve(data);
      };
      item.finish=finish;
      item.abort=()=>{
        finish(signal.reason??new DOMException('Aborted','AbortError'));
        if(item.group&&item.group.items.every(i=>i.done))item.group.controller.abort();
      };
      signal?.addEventListener('abort',item.abort,{once:true});this.pending.push(item);
      if(this.timer===null)this.timer=setTimeout(()=>this.flush(),this.delayMs);
    });
  }
  flush(){
    clearTimeout(this.timer);this.timer=null;
    const items=this.pending.filter(i=>!i.done).sort((a,b)=>a.url.localeCompare(b.url)||a.start-b.start);
    this.pending=[];
    let group;
    for(const item of items){
      if(!group||group.url!==item.url||group.total!==item.total||item.start>group.end||Math.max(group.end,item.end)-group.start>this.maxBytes){
        group={url:item.url,start:item.start,end:item.end,total:item.total,items:[],controller:new AbortController()};
        this.queue.push(group);
      }
      group.end=Math.max(group.end,item.end);group.items.push(item);item.group=group;
    }
    this.drain();
  }
  drain(){
    while(this.active<this.concurrency&&this.queue.length){
      const group=this.queue.shift();
      if(group.items.every(i=>i.done))continue;
      this.active++;
      this.run(group).finally(()=>{this.active--;this.drain();});
    }
  }
  async run(group){
    try{
      // Cancellation before dispatch must not download the cancelled edge blocks.
      const live=group.items.filter(i=>!i.done);
      group.start=Math.min(...live.map(i=>i.start));group.end=Math.max(...live.map(i=>i.end));
      let data,lastError;
      for(let attempt=0;attempt<=this.retries;attempt++){
        group.controller.signal.throwIfAborted();
        const controller=new AbortController(),abort=()=>controller.abort(group.controller.signal.reason);
        group.controller.signal.addEventListener('abort',abort,{once:true});
        const timer=setTimeout(()=>controller.abort(new DOMException('ECMWF-verzoek duurde te lang','TimeoutError')),this.timeoutMs);
        try{
          const response=await this.fetcher(rangeRequestURL(group.url,group.start,group.end),{headers:{Range:`bytes=${group.start}-${group.end-1}`},signal:controller.signal});
          const range=response.headers.get('Content-Range');
          if(response.status!==206||range!==`bytes ${group.start}-${group.end-1}/${group.total}`)throw new Error('Ongeldig ECMWF-deelantwoord');
          const received=new Uint8Array(await response.arrayBuffer());
          if(received.length!==group.end-group.start)throw new Error('Onvolledig ECMWF-deelantwoord');
          data=received;break;
        }catch(error){lastError=error;if(group.controller.signal.aborted)throw error;}
        finally{clearTimeout(timer);group.controller.signal.removeEventListener('abort',abort);}
      }
      if(!data)throw lastError;
      for(const item of group.items)if(!item.done)item.finish(null,data.subarray(item.start-group.start,item.end-group.start));
    }catch(error){for(const item of group.items)item.finish(error);}
  }
}
