import {frameScheduler} from './frame-scheduler.mjs';
// Cache hits can complete hundreds of tiles in the same microtask. Keep their
// canvas/Leaflet commits inside a short animation-frame budget as well.
export class CanvasCommits {
  constructor({schedule=fn=>frameScheduler.schedule(fn),cancel=handle=>frameScheduler.cancel(handle),now=()=>performance.now(),budgetMs=6}={}){
    Object.assign(this,{schedule,cancel,now,budgetMs});this.queue=[];this.frame=null;
  }
  commit(draw,signal){
    if(signal.aborted)return Promise.reject(signal.reason);
    return new Promise((resolve,reject)=>{
      const job={draw,resolve,reject,signal};
      job.abort=()=>{
        const index=this.queue.indexOf(job);if(index>=0)this.queue.splice(index,1);
        signal.removeEventListener('abort',job.abort);reject(signal.reason);
        if(!this.queue.length&&this.frame!==null){this.cancel(this.frame);this.frame=null;}
      };
      signal.addEventListener('abort',job.abort,{once:true});this.queue.push(job);this.request();
    });
  }
  request(){if(this.frame===null&&this.queue.length)this.frame=this.schedule(()=>this.flush());}
  flush(){
    this.frame=null;const start=this.now();
    while(this.queue.length){
      const job=this.queue.shift();job.signal.removeEventListener('abort',job.abort);
      if(job.signal.aborted)job.reject(job.signal.reason);
      else try{job.resolve(job.draw());}catch(error){job.reject(error);}
      if(this.now()-start>=this.budgetMs)break;
    }
    this.request();
  }
}
