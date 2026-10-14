/* Gemeenschappelijke bediening; bestaande data- en exportlogica blijft intact. */
(() => {
 document.body.classList.add('plume-unified');
 const embedded=parent!==window;
 document.body.classList.toggle('plume-embedded',embedded);
 let hostTabs=false;
 try{hostTabs=embedded&&!!parent.document.querySelector('#panel-pluim .wl-subtabs');}catch{}
 document.body.classList.toggle('plume-host-tabs',hostTabs);
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

/* Gedeelde indeling; de eigen databron en bediening blijven leidend. */
(() => {
 'use strict';
 const body=document.body;
 for(const element of document.querySelectorAll('body > .toolbar, body > .controls, body > .sleek, main > .toolbar'))element.classList.add('plume-toolbar');
 for(const element of document.querySelectorAll('main > .comparison-card, body > .wrap'))element.classList.add('plume-content');
 if(!document.querySelector('body > .wb-nav')){
  const nav=document.createElement('nav');nav.className='wb-nav';nav.setAttribute('aria-label','Overzicht');
  const back=document.createElement('a');back.href='index.html#pluim-ens6';back.target='_top';back.textContent='← Terug naar overzicht';nav.append(back);
  const toolbar=document.querySelector('body > .plume-toolbar, body > main, body > .plume-tabs');
  if(toolbar)toolbar.before(nav);else body.prepend(nav);
 }
 const formatRun=value=>{const d=new Date(value);return Number.isFinite(+d)?`${d.getUTCDate()} ${['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'][d.getUTCMonth()]} · ${String(d.getUTCHours()).padStart(2,'0')} UTC`:'Runtijd niet beschikbaar';};
 function sourceBar(label){
  let bar=document.querySelector('.plume-source-runs');if(bar)return bar;
  bar=document.createElement('section');bar.className='plume-source-runs';bar.setAttribute('aria-label',label);
  body.prepend(bar);return bar;
 }
 window.addEventListener('weerlab:plume-source-runs',event=>{
  const {label='Modelruns',runs=[],note=''}=event.detail||{};
  const bar=sourceBar(label);bar.replaceChildren();
  const title=document.createElement('span');title.className='plume-run-label';title.textContent=label;bar.append(title);
  for(const run of runs){
   const chip=document.createElement('span');chip.className='plume-run-chip';chip.dataset.current='true';
   chip.textContent=`${run.name ? run.name+' · ' : ''}${formatRun(run.time)}`;bar.append(chip);
  }
  if(note){const status=document.createElement('span');status.setAttribute('role','status');status.textContent=note;bar.append(status);}
 });
 if(body.classList.contains('comparison-page')) {
  const mist=new URLSearchParams(location.search).get('view')==='mist';
  const bar=sourceBar(mist?'DWD-MOSMIX-run':'Modelruns');
  bar.textContent='Modelruns laden…';
 }
 // ECMWF uitgebreid gebruikt een eigen exact-runloader. De knoppen sturen
 // diens bestaande ISO-selectie aan: geen tweede loader of verzonnen cycli.
 const select=document.getElementById('ensRunSelect');
 if(select){
  select.hidden=true;select.style.display='none';
  const buttons=document.createElement('div');buttons.className='plume-cycle-buttons';buttons.style.cssText='display:flex;flex-wrap:wrap;gap:8px';select.after(buttons);
  let signature='';
  const update=()=>{
   const options=[...select.options].filter(o=>Number.isFinite(Date.parse(o.value))&&!o.disabled);
   const next=JSON.stringify([select.value,select.disabled,options.map(o=>[o.value,o.textContent])]);if(next===signature)return;signature=next;
   buttons.replaceChildren();
   for(const hour of [0,6,12,18]){
    const candidates=options.filter(o=>new Date(o.value).getUTCHours()===hour).sort((a,b)=>Date.parse(b.value)-Date.parse(a.value));
    const option=candidates.find(o=>o.value===select.value)||candidates[0];
    const button=document.createElement('button');button.type='button';button.disabled=!option||select.disabled;button.dataset.runHour=String(hour);
    button.textContent=option?formatRun(option.value):`${String(hour).padStart(2,'0')} UTC`;
    button.setAttribute('aria-pressed',String(!!option&&option.value===select.value));
    button.title=option?option.textContent:'Deze cyclus is nog niet beschikbaar';
    button.onclick=()=>{if(!option)return;select.value=option.value;select.dispatchEvent(new Event('change',{bubbles:true}));update();};buttons.append(button);
   }
  };
  new MutationObserver(update).observe(select,{childList:true,subtree:true,attributes:true});select.addEventListener('change',update);update();
 }
 // Trend blijft een vergelijking van alle runs. Dezelfde runknoppen bieden
 // hier directe navigatie naar de bijbehorende grafiek.
 const trend=location.pathname.includes('demo_pluim6_trend') ? document.getElementById('wrap') : null;
 if(trend){
  const bar=sourceBar('ECMWF-runs');
  const update=()=>{
   const panels=[...trend.querySelectorAll('.runpanel[data-run-iso]')];bar.replaceChildren();
   const title=document.createElement('span');title.className='plume-run-label';title.textContent='ECMWF-runs';bar.append(title);
   panels.forEach((panel,i)=>{const button=document.createElement('button');button.type='button';button.textContent=formatRun(panel.dataset.runIso);button.setAttribute('aria-pressed',String(i===0));button.onclick=()=>{bar.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));panel.scrollIntoView({behavior:'smooth',block:'start'});};bar.append(button);});
   const note=document.createElement('span');note.setAttribute('role','status');note.textContent=panels.length?'Vergelijk alle runs · klik om naar een run te gaan':trend.textContent.trim()?'Geen complete runs beschikbaar':'Runs laden…';bar.append(note);
  };
  new MutationObserver(update).observe(trend,{childList:true});update();
 }
 // Zet de runbalk vóór navigatie en bediening, ook als de loader hem later maakt.
 const order=()=>{
  const run=body.querySelector(':scope > #weerlab-run-switcher, :scope > .run-selector, :scope > .plume-source-runs');
  if(run&&body.firstElementChild!==run)body.prepend(run);
 };
 new MutationObserver(order).observe(body,{childList:true});order();
})();
