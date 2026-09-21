export function selectionRect(start,end,width,height){
  width=Math.round(width);height=Math.round(height);
  const clamp=(n,max)=>Math.max(0,Math.min(max,n));
  const x=Math.floor(clamp(Math.min(start.x,end.x),width)),y=Math.floor(clamp(Math.min(start.y,end.y),height));
  return {x,y,width:Math.ceil(clamp(Math.max(start.x,end.x),width))-x,height:Math.ceil(clamp(Math.max(start.y,end.y),height))-y};
}
export function installAreaSelection({app,overlay,box,hint,save,cancel,onSave,onClose}){
  let start=null,rect=null,pointer=null;
  const reset=()=>{start=null;rect=null;pointer=null;box.hidden=true;save.disabled=true;hint.textContent='Sleep een kader om het gewenste gebied. Escape = annuleren.';};
  const close=()=>{overlay.hidden=true;app.classList.remove('selecting-area');reset();onClose?.();};
  const point=e=>{const r=overlay.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top};};
  const draw=e=>{
    const bounds=overlay.getBoundingClientRect();rect=selectionRect(start,point(e),bounds.width,bounds.height);
    Object.assign(box.style,{left:rect.x+'px',top:rect.y+'px',width:rect.width+'px',height:rect.height+'px'});box.hidden=false;
    save.disabled=rect.width<40||rect.height<40;
    hint.textContent=save.disabled?'Selecteer een groter gebied (minimaal 40 × 40 pixels).':`${rect.width} × ${rect.height} pixels geselecteerd. Sleep opnieuw om aan te passen.`;
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
