/** Background warm-up of the transport bytes of nearby forecast hours.
 *
 * Choosing an hour that was not prepared used to cost one network round trip
 * (≈0,2 s from the edge cache, ≈0,5–0,7 s on an edge miss) before decoding
 * could even start. This queue fetches only the compact field packets of the
 * hours around the selection, nearest first and forwards before backwards,
 * so scrubbing, hovering and arrow keys need no network wait. Nothing is
 * decoded or drawn here. Every new selection replaces the pending queue;
 * transfers already started finish into the browser cache.
 */
export function warmOrder(index,length,{ahead=36,behind=12,extra=[]}={}){
  const out=[],seen=new Set([index]);
  const add=i=>{if(Number.isInteger(i)&&i>=0&&i<length&&!seen.has(i)){seen.add(i);out.push(i);}};
  // Two hours ahead for every hour back: playback and "next" are the
  // dominant directions, but stepping back must not stall either.
  for(let d=1,back=1;d<=ahead||back<=behind;d++){
    if(d<=ahead)add(index+d);
    if(d%2===0&&back<=behind)add(index-back++);
    if(d>ahead&&back<=behind)add(index-back++);
  }
  for(const i of extra)add(i);
  return out;
}
export class WarmQueue{
  constructor({concurrency=4,delayMs=250}={}){
    Object.assign(this,{concurrency,delayMs});this.pending=[];this.active=0;this.timer=null;this.generation=0;this.done=0;this.failed=0;
  }
  /** Replace all queued work. jobs: array of () => Promise. */
  schedule(jobs,{delayMs=this.delayMs}={}){
    this.clear();const generation=this.generation;
    this.timer=setTimeout(()=>{this.timer=null;if(generation!==this.generation)return;this.pending=jobs.slice();this.drain();},delayMs);
  }
  /** Drop queued work; started transfers are allowed to finish. */
  clear(){clearTimeout(this.timer);this.timer=null;this.pending=[];this.generation++;}
  get size(){return this.pending.length;}
  drain(){
    while(this.active<this.concurrency&&this.pending.length){
      const job=this.pending.shift();this.active++;
      Promise.resolve().then(job).then(()=>{this.done++;},()=>{this.failed++;}).finally(()=>{this.active--;this.drain();});
    }
  }
}
