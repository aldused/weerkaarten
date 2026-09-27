// Opt-in local diagnostics. No network reporting or persistent storage.
export function installGestureProfile(map,element,{raf=requestAnimationFrame,caf=cancelAnimationFrame,now=()=>performance.now()}={}){
 let handle=null,start=0,last=0,gaps=[];
 const tick=time=>{gaps.push(time-last);last=time;handle=raf(tick);};
 map.on('movestart',()=>{if(handle!==null)caf(handle);start=last=now();gaps=[];handle=raf(tick);});
 map.on('moveend',()=>{
  if(handle===null)return;
  caf(handle);handle=null;
  const sorted=gaps.slice().sort((a,b)=>a-b);
  element.dataset.gestureProfile=JSON.stringify({durationMs:Math.round(now()-start),frames:gaps.length,p95FrameMs:Math.round(sorted[Math.max(0,Math.ceil(sorted.length*.95)-1)]||0),maxFrameMs:Math.round(sorted.at(-1)||0),framesOver50ms:gaps.filter(ms=>ms>50).length});
 });
}
