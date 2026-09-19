/** Only the next playback frame and previous chronological frame. Never a
 * recursive sweep of the ten-day forecast. User changes cancel queued work.
 */
export function adjacentFrameIndices(index,length){
  if(length<2||index<0||index>=length)return [];
  return [...new Set([(index+1)%length,...(index>0?[index-1]:[])])];
}
export class AdjacentFrames {
  constructor({delayMs=350}={}){this.delayMs=delayMs;this.timer=null;this.job=null;}
  cancel(){clearTimeout(this.timer);this.timer=null;this.job?.controller.abort();this.job=null;}
  start(index,length,prepare,{ready=()=>{},error=()=>{}}={}){
    this.cancel();const indices=adjacentFrameIndices(index,length);
    if(!indices.length)return;
    const job={controller:new AbortController()};this.job=job;
    this.timer=setTimeout(async()=>{
      this.timer=null;
      for(let i=0;i<indices.length;i++){
        try{
          await prepare(indices[i],job.controller.signal);
          if(job!==this.job||job.controller.signal.aborted)return;
          if(i===0)ready(indices[i]);
        }catch(e){
          if(job!==this.job||job.controller.signal.aborted)return;
          if(i===0)error(e);
          return;
        }
      }
    },this.delayMs);
  }
}
