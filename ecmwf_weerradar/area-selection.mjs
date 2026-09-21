export function selectionRect(start,end,width,height){
  width=Math.round(width);height=Math.round(height);
  const clamp=(n,max)=>Math.max(0,Math.min(max,n));
  // Anchor one corner; keep one integer side length, even at map boundaries.
  const sx=Math.round(clamp(start.x,width)),sy=Math.round(clamp(start.y,height));
  const dx=end.x-start.x,dy=end.y-start.y,left=dx<0,up=dy<0;
  const side=Math.min(Math.ceil(Math.max(Math.abs(dx),Math.abs(dy))),left?sx:width-sx,up?sy:height-sy);
  return {x:left?sx-side:sx,y:up?sy-side:sy,width:side,height:side};
}
export function installAreaSelection({app,overlay,box,hint,save,cancel,onSave,onClose}){
  let start=null,rect=null,pointer=null;
  const reset=()=>{start=null;rect=null;pointer=null;box.hidden=true;save.disabled=true;hint.textContent='Sleep een vierkant (1:1) om het gewenste gebied. Escape = annuleren.';};
  const close=()=>{overlay.hidden=true;app.classList.remove('selecting-area');reset();onClose?.();};
  const point=e=>{const r=overlay.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};};
  const draw=e=>{
    const bounds=overlay.getBoundingClientRect();rect=selectionRect(start,point(e),bounds.width,bounds.height);
    Object.assign(box.style,{left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px'});box.hidden=false;
    save.disabled=rect.width<40||rect.height<40;
    hint.textContent=save.disabled?'Selecteer een groter vierkant (minimaal 40 × 40 pixels).':`${rect.width} × ${rect.height} pixels · vierkant (1:1). Sleep opnieuw om aan te passen.`;
  };
  overlay.addEventListener('pointerdown',e=>{
    if(e.target.closest('.area-actions')||!e.isPrimary||e.button!==0)return;
    e.preventDefault();start=point(e);pointer=e.pointerId;overlay.setPointerCapture(pointer);draw(e);
  });
  overlay.addEventListener('pointermove',e=>{if(start&&e.pointerId===pointer)draw(e);});
  overlay.addEventListener('pointerup',e=>{if(!start||e.pointerId!==pointer)return;draw(e);start=null;overlay.releasePointerCapture(pointer);pointer=null;});
  overlay.addEventListener('pointercancel',reset);
  overlay.addEventListener('wheel',e=>e.preventDefault(),{passive:false});
  cancel.addEventListener('click',close);
  save.addEventListener('click',()=>{if(!rect||save.disabled)return;const selected={...rect};close();onSave(selected);});
  document.addEventListener('keydown',e=>{if(!overlay.hidden&&e.key==='Escape'){e.preventDefault();close();}});
  window.addEventListener('resize',()=>{if(!overlay.hidden)close();});
  return {open(){reset();overlay.hidden=false;app.classList.add('selecting-area');cancel.focus();},close};
}
