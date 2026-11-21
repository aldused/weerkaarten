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
 for(const [title,entries] of groups){const group=make('div',null,{class:'record-menu-group'});group.append(make('h3',title));for(const [key,label,description]of entries){const button=make('button',null,{type:'button','data-section':key});button.append(make('strong',label),make('span',description));button.addEventListener('click',()=>{if($('l5-sectie').style.display!=='none')wisselModus('stations');if(key==='warmedagen'&&huidigeHoofdtab!==key){wdThr=1;wdSetView('jaar');}wisselHoofdtab(key);const link=new URL(location.href);link.searchParams.set('tab',key);history.replaceState(null,'',link);if(mobile.matches)options.open=false;});buttons.set(key,button);group.append(button);}grid.append(group);}const options=make('details',null,{class:'record-menu-options'});const optionSummary=make('summary','Onderdeel kiezen');options.append(optionSummary,grid);menu.append(options);
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
  const tab=query.get('tab');if(tab==='koudedagen'){if(['winteryear','calendar'].includes(query.get('coldperiod')))kdPeriod=query.get('coldperiod');const category=Number(query.get('coldcategory'));if(query.has('coldcategory')&&Number.isInteger(category)&&category>=0&&category<KD_LABELS.length)kdCat=category;if(['jaar','seizoen','maand','reeksen','stations'].includes(query.get('coldview')))kdView=query.get('coldview');}
  if(buttons.has(tab)){if(tab==='warmedagen')wdThr=1;wisselHoofdtab(tab);}
  if(tab==='koudedagen'&&kdView==='stations'&&$('sel-station').value!=='alle')await kdShowStationRecords();
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
  category.onchange=()=>{if(prefix==='wd'){wdThr=Number(category.value);wdRender();}else{kdCat=Number(category.value);kdRender();kdRememberSelection();}};
  categoryLabel.append(category);controls.append(categoryLabel);
  let period=null;
  if(prefix==='kd'){const label=make('label','Periode');period=make('select',null,{id:'kd-period-mode','aria-label':'Periode voor koude dagen'});period.append(make('option','Winterjaar · 1 augustus t/m 31 juli',{value:'winteryear'}),make('option','Kalenderjaar · 1 januari t/m 31 december',{value:'calendar'}));period.onchange=()=>{kdPeriod=period.value;kdRender();queueMicrotask(kdRememberSelection);};label.append(period);controls.append(label);}
  const yearLabel=make('label',prefix==='kd'?'Winterjaar':'Jaar');const year=make('select',null,{'aria-label':prefix==='wd'?'Jaar van warme dagen':'Winterjaar van koude dagen'});year.addEventListener('change',()=>{sync();if(prefix==='kd')kdRememberSelection();});if(prefix==='kd')year.id='kd-selected-year';yearLabel.append(year);controls.append(yearLabel);
  const card=make('div',null,{class:'record-count-summary',role:'status','aria-live':'polite'});
  section.prepend(controls,card);summaries[prefix]={category,year,card,yearLabel,period};
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
   const currentCalendar=Number(new Intl.DateTimeFormat('en',{timeZone:'Europe/Amsterdam',year:'numeric'}).format(new Date()));
   const current=prefix==='kd'?ColdDays.periodYear(Date.parse(kdToday()+'T00:00:00Z'),kdPeriod):currentCalendar;
   if(prefix==='kd'){ui.period.value=kdPeriod;ui.yearLabel.firstChild.textContent=kdPeriod==='winteryear'?'Winterjaar':'Jaar';ui.year.setAttribute('aria-label',kdPeriod==='winteryear'?'Winterjaar van koude dagen':'Jaar van koude dagen');ui.yearLabel.hidden=kdView==='stations'||kdView==='reeksen';}
   const periodLabel=y=>prefix==='kd'?ColdDays.label(y,kdPeriod):String(y);
   const years=[...new Set([current,...Object.keys(c?.perYear||{}).map(Number)])].sort((a,b)=>b-a);
   let value=ui.year.value||String(current);
   if(prefix==='kd'&&query.has('coldyear')&&ui.year.dataset.initialApplied!=='true'&&years.includes(Number(query.get('coldyear')))){value=query.get('coldyear');ui.year.dataset.initialApplied='true';}
   const yearTag=(prefix==='kd'?kdPeriod+':':'')+years.join(',');
   if(ui.year.dataset.years!==yearTag){ui.year.replaceChildren(...years.map(y=>make('option',y===current?periodLabel(y)+' · lopend':periodLabel(y),{value:String(y)})));ui.year.dataset.years=yearTag;ui.year.value=years.includes(Number(value))?value:String(current);}
   const y=ui.year.value;const count=c?.perYear?.[y]?.[category];
   const label=(prefix==='wd'?WD_LABELS:KD_LABELS)[category].toLowerCase();
   const isTop=prefix==='wd'&&typeof wdAlleModus!=='undefined'&&wdAlleModus==='station'&&Array.isArray(multiData)&&multiData.length>1;
   const cold=prefix==='kd',meta=cold?c?.coverage?.[y]:null;
   const text=busy?'Metingen worden geladen…':cold&&kdView==='stations'?'Hoogste telling per afzonderlijk station':isTop?'Bekijk hieronder het hoogste totaal per station.':count===undefined||(cold&&!meta?.valid[category])?'Geen dagelijkse temperatuurgegevens voor '+periodLabel(y)+'.':cold?kdCountText(c,y,category)+' '+ColdDays.categories[category].noun+' in '+(kdPeriod==='winteryear'?'winterjaar ':'')+periodLabel(y):count+' '+label+' in '+y;
   const detail=c&&!isTop?(cold&&kdView==='stations'?'Vergelijking van alle geladen stations over alle afgesloten '+kdPeriodName()+'en.':c.bron+(Array.isArray(multiData)&&multiData.length>1?' · dagen waarop de grens ergens in deze stationsgroep is bereikt':'')+(cold?' · '+(kdPeriod==='winteryear'?'1 augustus t/m 31 juli':'1 januari t/m 31 december'):'')+(cold&&meta?.running||!cold&&Number(y)===current?' · lopend, tot de laatst ingeladen meetdag':'')):'';
   // Text-only updates avoid repeated live announcements.
   if(ui.card.dataset.text!==text+detail){ui.card.replaceChildren(make('strong',text),make('span',detail));ui.card.dataset.text=text+detail;}
  }
 }
 let queued=false;function schedule(){if(!queued){queued=true;queueMicrotask(()=>{queued=false;sync();});}}
 // Follow programmatic section changes and asynchronous station loads as well as clicks.
 for(const name of ['wisselHoofdtab','wdRender','kdRender','wisselModus','toon']){const original=window[name];window[name]=function(...args){const result=original.apply(this,args);schedule();if(result?.then)result.finally(schedule);return result;};}
 const originalStation=window.wisselStation;window.wisselStation=async function(...args){busy=true;sync();try{return await originalStation.apply(this,args);}finally{busy=false;if(huidigeHoofdtab==='koudedagen'&&kdView==='stations'&&$('sel-station').value!=='alle'){kdView='jaar';kdRender();}schedule();}};
 new MutationObserver(schedule).observe($('sel-jaar'),{childList:true});
 document.addEventListener('click',schedule);document.addEventListener('change',schedule);document.addEventListener('weerlab-records-rendered',schedule);
 sync();
});
})();
