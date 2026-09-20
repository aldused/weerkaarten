/** A shared, cancellable FIFO with an LRU of completed results.
 * Only work with a live subscriber is dispatched. Running synchronous worker
 * work may finish, but it never blocks newer work behind a posted message pile.
 * `concurrency` is the number of renderers that may be busy at once; it may be
 * a function so a shrinking worker pool lowers it without a new queue.
 */
export class SharedRenderQueue {
  constructor(render,{maxEntries=128,concurrency=1}={}){
    this.render=render;this.maxEntries=maxEntries;this.concurrency=concurrency;this.cache=new Map();
    this.pending=new Map();this.queue=[];this.active=0;this.running=new Set();this.scheduled=false;
  }
  get slots(){
    const value=typeof this.concurrency==='function'?this.concurrency():this.concurrency;
    return Math.max(1,Math.trunc(value)||1);
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
          if(!this.running.has(job)){const i=this.queue.indexOf(job);if(i>=0)this.queue.splice(i,1);}
        }
      };
      job.subscribers.add(subscriber);signal?.addEventListener('abort',cancel,{once:true});
    });
    this.schedule();return promise;
  }
  schedule(){
    if(this.scheduled||this.active>=this.slots||!this.queue.length)return;
    this.scheduled=true;queueMicrotask(()=>{this.scheduled=false;this.drain();});
  }
  drain(){
    while(this.active<this.slots&&this.queue.length){
      const job=this.queue.shift();
      this.active++;this.running.add(job);
      this.run(job);
    }
  }
  async run(job){
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
      this.active--;this.running.delete(job);this.schedule();
    }
  }
}
export function abortError(signal){return signal?.reason??new DOMException('Tile no longer needed','AbortError');}
