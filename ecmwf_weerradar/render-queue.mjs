/** A shared, cancellable FIFO with an LRU of completed results.
 * Only work with a live subscriber is dispatched. Running synchronous worker
 * work may finish, but it never blocks newer work behind a posted message pile.
 */
export class SharedRenderQueue {
  constructor(render,{maxEntries=128}={}){
    this.render=render;this.maxEntries=maxEntries;this.cache=new Map();
    this.pending=new Map();this.queue=[];this.active=false;this.scheduled=false;
  }
  request(key,payload,signal){
    if(signal?.aborted)return Promise.reject(abortError(signal));
    if(this.cache.has(key)){
      const value=this.cache.get(key);this.cache.delete(key);this.cache.set(key,value);
      return Promise.resolve(value);
    }
    let job=this.pending.get(key);
    if(!job){
      job={key,payload,subscribers:new Set(),controller:new AbortController(),cancelled:false};
      this.pending.set(key,job);this.queue.push(job);
    }
    const promise=new Promise((resolve,reject)=>{
      const subscriber={resolve,reject,cleanup:()=>signal?.removeEventListener('abort',cancel)};
      const cancel=()=>{
        subscriber.cleanup();job.subscribers.delete(subscriber);reject(abortError(signal));
        if(!job.subscribers.size){
          job.cancelled=true;job.controller.abort();
          if(this.pending.get(key)===job)this.pending.delete(key);
          // Release queued grids immediately, not after the current tile ends.
          if(job!==this.running){const i=this.queue.indexOf(job);if(i>=0)this.queue.splice(i,1);}
        }
      };
      job.subscribers.add(subscriber);signal?.addEventListener('abort',cancel,{once:true});
    });
    this.schedule();return promise;
  }
  schedule(){
    if(this.active||this.scheduled)return;
    this.scheduled=true;queueMicrotask(()=>{this.scheduled=false;this.drain();});
  }
  async drain(){
    if(this.active)return;
    const job=this.queue.shift();if(!job)return;
    this.active=true;this.running=job;
    try{
      const value=await this.render(job.payload,job.controller.signal);
      if(!job.cancelled){
        this.cache.set(job.key,value);
        while(this.cache.size>this.maxEntries)this.cache.delete(this.cache.keys().next().value);
        for(const subscriber of job.subscribers){subscriber.cleanup();subscriber.resolve(value);}
      }
    }catch(error){
      for(const subscriber of job.subscribers){subscriber.cleanup();subscriber.reject(error);}
    }finally{
      job.subscribers.clear();if(this.pending.get(job.key)===job)this.pending.delete(job.key);
      this.active=false;this.running=null;this.schedule();
    }
  }
}
export function abortError(signal){return signal?.reason??new DOMException('Tile no longer needed','AbortError');}
