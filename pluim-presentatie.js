/* Gemeenschappelijke bediening; bestaande data- en exportlogica blijft intact. */
(() => {
 document.body.classList.add('plume-unified');
 const embedded=parent!==window;
 document.body.classList.toggle('plume-embedded',embedded);
 // Header fields are kept in the DOM because existing loaders update them.
 // Unique run details remain readable in a compact, neutral status row.
 const header=document.querySelector('body>.header,body>.header-bg');
 if(header){
  const status=document.createElement('div');status.className='plume-run-details';status.setAttribute('role','status');
  for(const id of ['hdrRun','run-info','runInfo']){
   const source=header.querySelector('#'+id);if(!source)continue;
   const copy=document.createElement('span');const update=()=>copy.textContent=source.textContent;update();new MutationObserver(update).observe(source,{childList:true,subtree:true,characterData:true});status.append(copy);
  }
  if(status.childNodes.length&&!document.querySelector('.toolbar #runinfo'))header.after(status);
 }
})();
