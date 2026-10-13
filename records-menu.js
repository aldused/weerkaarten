/* A shared, task-oriented menu. All data and counts come from the page's record engine. */
(() => {
'use strict';
const $ = id => document.getElementById(id);
const make = (tag, text, attrs = {}) => { const n=document.createElement(tag); if(text)n.textContent=text; for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v); return n; };
document.addEventListener('DOMContentLoaded', () => {
 if(!$('sectie-warmedagen') || !$('sel-station'))return;
 document.body.classList.add('record-menu-page');
 const heading=document.querySelector('.climate-heading');
 $('climate-title').textContent='Records & klimaat';
 heading.querySelector('.climate-heading-row p').textContent='Kies een onderdeel en een station. Bekijk records, tel warme of koude dagen en vergelijk maanden en jaren.';
 document.title='Records & klimaat · Weerlab';
 const oldNav=document.querySelector('.record-nav');
 if(oldNav){oldNav.querySelector('a[href*=dagrecords_jaar],a[href*=dagrecords-jaar]')?.remove();const more=make('details',null,{class:'record-other-pages'});more.append(make('summary','Andere klimaatpagina’s'));oldNav.before(more);more.append(oldNav);}
 const menu=make('section',null,{class:'record-menu','aria-label':'Kies wat je wilt bekijken'});
 menu.append(make('h2','Wat wil je bekijken?'));
 const groups=[['Records',[['records','Weerrecords','Hoogste en laagste metingen'],['dagrecordsjaar','Dagrecords per jaar','Welke records zijn in een jaar gezet?']]],['Dagen tellen',[['warmedagen','Warme dagen','Vanaf 20, 25 of 30 °C'],['koudedagen','Koude dagen','Vorst en ijsdagen']]],['Overzichten',[['maandoverzicht','Maandoverzicht','Het weer in één maand'],['jaaroverzicht','Jaaroverzicht','Het weer in één jaar'],['maandranking','Maand- en seizoensranglijst','Vergelijk maanden en seizoenen']]]];
 const grid=make('nav',null,{class:'record-menu-groups','aria-label':'Onderdelen van records en klimaat'});
 const buttons=new Map();
 for(const [title,entries] of groups){const group=make('div',null,{class:'record-menu-group'});group.append(make('h3',title));for(const [key,label,description]of entries){const button=make('button',null,{type:'button','data-section':key});button.append(make('strong',label),make('span',description));button.addEventListener('click',()=>{if($('l5-sectie').style.display!=='none')wisselModus('stations');if(key==='warmedagen'&&huidigeHoofdtab!==key){wdThr=1;wdSetView('jaar');}wisselHoofdtab(key);if(mobile.matches)options.open=false;});buttons.set(key,button);group.append(button);}grid.append(group);}const options=make('details',null,{class:'record-menu-options'});const optionSummary=make('summary','Onderdeel kiezen');options.append(optionSummary,grid);menu.append(options);
 const mobile=matchMedia('(max-width:700px)');const foldMenu=()=>{options.open=!mobile.matches;};foldMenu();mobile.addEventListener('change',foldMenu);
 const context=make('div',null,{class:'record-menu-context'});
 const stationLabel=make('label','Station',{for:'sel-station',class:'record-menu-station'});
 const stationGroup=$('sel-station').closest('.filter-groep');
 stationLabel.append($('sel-station'));context.append(stationLabel);stationGroup?.remove();
 const scopeLabel=make('label','Meetgebied');
 const scope=make('select',null,{'aria-label':'Meetgebied'});scope.append(make('option','Station of stationsgroep',{value:'stations'}),make('option','Landelijk gemiddelde · 5 stations',{value:'l5'}));scope.addEventListener('change',()=>wisselModus(scope.value));scopeLabel.append(scope);context.append(scopeLabel);
 menu.append(context);heading.after(menu);
 // Keep the engine's original navigation controls for compatibility, out of the visual menu.
 $('hoofdtabs-balk').hidden=true;
 document.querySelector('.mobile-hoofdnav')?.setAttribute('hidden','');
 document.querySelector('.record-subnav')?.setAttribute('hidden','');
 const command=document.querySelector('.archive-command');
 const query=new URLSearchParams(location.search);let initialApplied=false;
 async function restoreInitial(){
  if(!command&&query.has('station')&&[...$('sel-station').options].some(o=>o.value===query.get('station'))){$('sel-station').value=query.get('station');await wisselStation();}
  const tab=query.get('tab');if(buttons.has(tab)){if(tab==='warmedagen')wdThr=1;wisselHoofdtab(tab);}
  schedule();
 }
 const filters=document.querySelector('.filters');
 if(command){const fold=command.querySelector('.archive-filter-fold');fold.open=true;const search=make('details',null,{class:'record-search-extra'});search.append(make('summary','Zoeken met een tekstopdracht'));command.prepend(search);for(const el of [...command.querySelectorAll('.archive-search,.archive-query-examples')])search.append(el);}
 // The year page has a second set of period/parameter tabs: use a single select for each.
 if(!command&&document.body.classList.contains('climate-dagrecords_jaar')){for(const [id,label,selector]of [['filter-periode-tabs-wrapper','Periode','.ptab'],['param-tabs','Meetwaarde','.param-tab']]){const container=$(id);const control=make('label',label,{class:'record-simple-control'});const select=make('select',null,{'aria-label':label});for(const [i,tab]of [...container.querySelectorAll(selector)].entries()){select.append(make('option',tab.textContent.trim(),{value:String(i)}));}select.onchange=()=>container.querySelectorAll(selector)[Number(select.value)].click();control.append(select);container.prepend(control);const update=()=>{const tabs=[...container.querySelectorAll(selector)];select.value=String(Math.max(0,tabs.findIndex(t=>t.classList.contains('actief'))));};document.addEventListener('click',update);document.addEventListener('change',update);}}
 const summaries={};
 for(const prefix of ['wd','kd']){
  const section=$('sectie-'+(prefix==='wd'?'warmedagen':'koudedagen'));
  const controls=make('div',null,{class:'record-count-controls'});
  const categoryLabel=make('label',prefix==='wd'?'Temperatuurgrens':'Soort koude dag');
  const category=make('select',null,{'aria-label':prefix==='wd'?'Temperatuurgrens':'Soort koude dag'});
  const labels=prefix==='wd'?WD_LABELS:KD_LABELS;
  labels.forEach((label,i)=>category.append(make('option',label+' · '+(prefix==='wd'?(WD_KEY[i]==='tn'?'minimum ':'maximum ')+'≥ '+WD_THR[i]+' °C':KD_DESC[i]),{value:String(i)})));
  category.onchange=()=>{if(prefix==='wd'){wdThr=Number(category.value);wdRender();}else{kdCat=Number(category.value);kdRender();}};
  categoryLabel.append(category);controls.append(categoryLabel);
  const yearLabel=make('label','Jaar');const year=make('select',null,{'aria-label':prefix==='wd'?'Jaar van warme dagen':'Jaar van koude dagen'});year.addEventListener('change',sync);yearLabel.append(year);controls.append(yearLabel);
  const card=make('div',null,{class:'record-count-summary',role:'status','aria-live':'polite'});
  section.prepend(controls,card);summaries[prefix]={category,year,card};
 }
 let busy=false;
 function sync(){
  if(!initialApplied&&data&&$('sel-jaar').options.length){initialApplied=true;restoreInitial();}
  const l5=$('l5-sectie').style.display!=='none';scope.value=l5?'l5':'stations';stationLabel.hidden=l5;
  menu.dataset.currentSection=l5?'l5':huidigeHoofdtab;
  optionSummary.textContent=(l5?'Landelijk gemiddelde':buttons.get(huidigeHoofdtab)?.querySelector('strong').textContent||'Weerrecords')+' · onderdeel wijzigen';
  for(const [key,button]of buttons){button.setAttribute('aria-pressed',String(!l5&&key===huidigeHoofdtab));}
  const regular=!l5&&huidigeHoofdtab==='records';
  document.querySelector('.content').hidden=l5||!['records','jaaroverzicht'].includes(huidigeHoofdtab);
  document.querySelector('.archive-notes')?.toggleAttribute('hidden',!regular);
  if(!command)filters.hidden=!regular;
  if(command)command.hidden=!regular;

  const period=$('filter-periode-tabs-wrapper');
  // Period-specific subfilters only belong to the records section.
  for(const id of ['filter-jaar','filter-seizoen','filter-maand','filter-decade','filter-dag','filter-periode'])$(id).hidden=!regular;
  if(!command){$('param-tabs').hidden=!regular;document.querySelector('.richting-tabs').hidden=!regular;}
  for(const [prefix,ui]of Object.entries(summaries)){
   if(l5||huidigeHoofdtab!==(prefix==='wd'?'warmedagen':'koudedagen'))continue;
   const c=busy?null:(prefix==='wd'?wdCompute():kdCompute());
   const category=prefix==='wd'?wdThr:kdCat;ui.category.value=String(category);
   const current=Number(new Intl.DateTimeFormat('en',{timeZone:'Europe/Amsterdam',year:'numeric'}).format(new Date()));
   const years=[...new Set([current,...Object.keys(c?.perYear||{}).map(Number)])].sort((a,b)=>b-a);
   const value=ui.year.value||String(current);
   if(ui.year.dataset.years!==years.join(',')){ui.year.replaceChildren(...years.map(y=>make('option',y===current?y+' · dit jaar':String(y),{value:String(y)})));ui.year.dataset.years=years.join(',');ui.year.value=years.includes(Number(value))?value:String(current);}
   const y=ui.year.value;const count=c?.perYear?.[y]?.[category];
   const label=(prefix==='wd'?WD_LABELS:KD_LABELS)[category].toLowerCase();
   const isTop=prefix==='wd'&&typeof wdAlleModus!=='undefined'&&wdAlleModus==='station'&&Array.isArray(multiData)&&multiData.length>1;
   const text=busy?'Metingen worden geladen…':isTop?'Bekijk hieronder het hoogste totaal per station.':count===undefined?'Geen dagelijkse temperatuurgegevens voor '+y+'.':count+' '+label+' in '+y;
   const detail=c&&!isTop?c.bron+(Array.isArray(multiData)&&multiData.length>1?' · dagen waarop de grens ergens in deze stationsgroep is bereikt':'')+(Number(y)===current?' · lopend jaar, tot de laatst ingeladen meetdag':''):'';
   // Text-only updates avoid repeated live announcements.
   if(ui.card.dataset.text!==text+detail){ui.card.replaceChildren(make('strong',text),make('span',detail));ui.card.dataset.text=text+detail;}
  }
 }
 let queued=false;function schedule(){if(!queued){queued=true;queueMicrotask(()=>{queued=false;sync();});}}
 // Follow programmatic section changes and asynchronous station loads as well as clicks.
 for(const name of ['wisselHoofdtab','wdRender','kdRender','wisselModus','toon']){const original=window[name];window[name]=function(...args){const result=original.apply(this,args);schedule();if(result?.then)result.finally(schedule);return result;};}
 const originalStation=window.wisselStation;window.wisselStation=async function(...args){busy=true;sync();try{return await originalStation.apply(this,args);}finally{busy=false;schedule();}};
 new MutationObserver(schedule).observe($('sel-jaar'),{childList:true});
 document.addEventListener('click',schedule);document.addEventListener('change',schedule);document.addEventListener('weerlab-records-rendered',schedule);
 sync();
});
})();
