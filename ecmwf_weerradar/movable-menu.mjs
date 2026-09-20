// Moving the controls only changes their screen position; no map or data reload.
const STORAGE_KEY='weerlab-map-menu-position-v1';
export function installMovableMenu(dock,handle,reset,onMove=()=>{}){
 const container=dock.parentElement;
 let position=null,drag=null,pending=0;
 const dimensions=()=>({width:dock.offsetWidth,height:dock.offsetHeight,viewportWidth:container.clientWidth,viewportHeight:container.clientHeight});
 function bounded(point,size=dimensions()){
  return {x:Math.min(Math.max(8,size.viewportWidth-size.width-8),Math.max(8,point.x)),y:Math.min(Math.max(46,size.viewportHeight-size.height-8),Math.max(46,point.y))};
 }
 function announceMove(){if(!pending)pending=requestAnimationFrame(()=>{pending=0;onMove();});}
 function apply(point){
  position=point;dock.classList.toggle('is-positioned',!!point);reset.hidden=!point;
  if(point){dock.style.setProperty('--dock-x',`${point.x}px`);dock.style.setProperty('--dock-y',`${point.y}px`);}
  else{dock.style.removeProperty('--dock-x');dock.style.removeProperty('--dock-y');}
  announceMove();
 }
 function save(){try{if(position)localStorage.setItem(STORAGE_KEY,JSON.stringify(position));else localStorage.removeItem(STORAGE_KEY);}catch{/* Position memory is optional. */}}
 function restoreDefault(){if(drag)finish(false);apply(null);save();handle.focus({preventScroll:true});}
 function origin(){const rect=dock.getBoundingClientRect(),parent=container.getBoundingClientRect();return {x:rect.left-parent.left,y:rect.top-parent.top};}
 function finish(cancelled){
  if(!drag)return;
  const prior=drag.prior,id=drag.id;drag=null;dock.classList.remove('is-dragging');
  if(handle.hasPointerCapture(id))handle.releasePointerCapture(id);
  if(cancelled)apply(prior);else save();
 }
 handle.addEventListener('pointerdown',event=>{
  if(!event.isPrimary||event.button!==0||drag)return;
  event.preventDefault();event.stopPropagation();handle.focus({preventScroll:true});
  drag={id:event.pointerId,prior:position,start:origin(),x:event.clientX,y:event.clientY,size:dimensions()};
  handle.setPointerCapture(event.pointerId);dock.classList.add('is-dragging');
 });
 handle.addEventListener('pointermove',event=>{
  if(!drag||event.pointerId!==drag.id)return;
  event.preventDefault();const x=event.clientX-drag.x,y=event.clientY-drag.y;
  if(!position&&Math.hypot(x,y)<3)return;
  apply(bounded({x:drag.start.x+x,y:drag.start.y+y},drag.size));
 });
 handle.addEventListener('pointerup',event=>{if(drag?.id===event.pointerId)finish(false);});
 handle.addEventListener('pointercancel',event=>{if(drag?.id===event.pointerId)finish(true);});
 handle.addEventListener('lostpointercapture',()=>{if(drag)finish(true);});
 handle.addEventListener('dblclick',restoreDefault);
 handle.addEventListener('keydown',event=>{
  const directions={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
  if(!directions[event.key]&&!['Home','Escape'].includes(event.key))return;
  event.preventDefault();event.stopPropagation();
  if(event.key==='Escape'){if(drag)finish(true);return;}
  if(event.key==='Home'){restoreDefault();return;}
  const [dx,dy]=directions[event.key],start=position||origin(),step=event.shiftKey?40:10;
  apply(bounded({x:start.x+dx*step,y:start.y+dy*step}));save();
 });
 reset.addEventListener('click',restoreDefault);
 function keepVisible(){if(position&&!drag){apply(bounded(position));save();}}
 new ResizeObserver(keepVisible).observe(dock);
 window.addEventListener('resize',keepVisible);
 try{const saved=JSON.parse(localStorage.getItem(STORAGE_KEY));if(saved&&Number.isFinite(saved.x)&&Number.isFinite(saved.y))apply(bounded(saved));}catch{/* Default bottom position. */}
}
