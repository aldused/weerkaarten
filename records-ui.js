/* Presentation helpers; the pages keep their existing sources and calculations. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const page = location.pathname.split('/').pop();
  const links = [
    ['records_debilt.html','Weerrecords'],['dagrecords_6dagen.html','Dagrecords · kaarten'],
    ['dagrecords_jaar.html','Dagrecords · per jaar'],['extremen.html','Zoek extremen'],
    ['neerslag_records.html','Neerslagrecords'],['p13_records.html','Landelijk · P13'],
    ['hittegolven.html','Hittegolven'],['stationsanalyse.html','Eerste & laatste'],
    ['feestdagen_weer.html','Feestdagen'],['normalen.html','Klimaatnormalen']
  ];
  function element(tag, attrs = {}, text) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function stationSearch(select) {
    if (select.dataset.recordSearch) return;
    select.dataset.recordSearch = '1';
    const field = element('label', {class:'record-search'}, 'Zoek station op naam');
    const list = element('datalist', {id:'record-stations-'+select.id});
    const input = element('input', {type:'search',list:list.id,placeholder:page==='records_debilt.html'?'Bijv. Maastricht Caberg':'Typ een stationsnaam',autocomplete:'off'});
    const feedback = element('output', {'aria-live':'polite'});
    const fill = () => list.replaceChildren(...Array.from(select.options).filter(o=>o.value && !o.disabled).map(o=>element('option',{value:o.textContent.trim()})));
    fill();
    new MutationObserver(fill).observe(select,{childList:true,subtree:true});
    let choosing=false;
    function chooseStation() {
      const term = input.value.trim().toLocaleLowerCase('nl');
      if (!term) { feedback.textContent=''; return; }
      const options = Array.from(select.options);
      const exact = options.find(o=>o.textContent.trim().toLocaleLowerCase('nl')===term);
      const matches = options.filter(o=>o.textContent.toLocaleLowerCase('nl').includes(term));
      const match = exact || (matches.length===1 ? matches[0] : null);
      if (match) {
        select.value=match.value; input.value=match.textContent.trim(); feedback.textContent='';
        choosing=true;
        try { select.dispatchEvent(new Event('change',{bubbles:true})); } finally { choosing=false; }
      } else feedback.textContent=matches.length ? 'Kies een station uit de suggesties.' : 'Geen station gevonden. Probeer een andere naam.';
    }
    input.addEventListener('change',chooseStation);
    input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();chooseStation();}});
    input.addEventListener('input',()=>{
      const term=input.value.trim().toLocaleLowerCase('nl');
      if(Array.from(select.options).some(o=>o.textContent.trim().toLocaleLowerCase('nl')===term))chooseStation();
      if(!term)feedback.textContent='';
    });
    select.addEventListener('change',()=>{if(!choosing)input.value='';feedback.textContent='';});
    field.append(input,list,feedback);
    const group=select.closest('.filter-groep,.control,.ctrl-group,.station-select-wrap,label');
    if(group) group.before(field); else select.before(field);
  }
  function mainControls() {
    const filters=document.querySelector('.filters');
    const params=$('param-tabs');
    const direction=document.querySelector('.richting-tabs');
    // Relocate the original controls, preserving IDs, listeners and mode switching.
    filters.append(params,$('record-calculation-group'),direction);
    // Keep source notes together below the results instead of between controls and table.
    const source=document.querySelector('body > details');
    if(source) document.querySelector('.content').append(source);
    const overview=document.querySelector('.mobile-hoofdnav');
    const modes=$('mode-btn-stations')?.parentElement;
    if(modes) overview.append(modes);
    const updated=$('gegenereerd-lbl');if(updated)overview.append(updated);
    document.querySelector('.climate-heading .climate-source')?.remove();
    const actions=element('div',{class:'record-results-actions'});
    const help=element('p',{class:'record-period-help'},'Kies station, periode en meetwaarde. De ranglijst wordt direct bijgewerkt.');
    const step=element('div',{class:'record-step'});
    const prev=element('button',{type:'button','aria-label':'Vorige periode'},'← Vorige');
    const next=element('button',{type:'button','aria-label':'Volgende periode'},'Volgende →');
    step.append(prev,next);actions.append(help,step);
    const print=params.querySelector('.print-btn');
    if(print){print.className='record-action';print.style.cssText='';actions.append(print);}
    document.querySelector('.records-header').after(actions);
    function advance(delta) {
      const period=$('sel-periode-mobile').value;
      const ids={jaar:'sel-jaar',maand:'sel-maand',seizoen:'sel-seizoen'};
      if(ids[period]) {
        const s=$(ids[period]);
        // Year options are newest first; previous means the earlier year.
        const d=period==='jaar' ? -delta : delta;
        s.selectedIndex=(s.selectedIndex+d+s.options.length)%s.options.length;
        s.dispatchEvent(new Event('change',{bubbles:true}));
      } else if(period==='dag') {
        const month=$('sel-dag-maand'),day=$('sel-dag-dag');
        const date=new Date(2000,Number(month.value)-1,Number(day.value)+delta,12);
        month.value=String(date.getMonth()+1);month.dispatchEvent(new Event('change',{bubbles:true}));
        day.value=String(date.getDate());day.dispatchEvent(new Event('change',{bubbles:true}));
      } else if(period==='decade') {
        const month=$('sel-dec-maand'),dec=$('sel-dec-dec');
        const n=(Number(month.value)*3-3+Number(dec.value)-1+delta+36)%36;
        month.value=String(Math.floor(n/3)+1);dec.value=String(n%3+1);
        dec.dispatchEvent(new Event('change',{bubbles:true}));
      }
    }
    prev.addEventListener('click',()=>advance(-1));next.addEventListener('click',()=>advance(1));
    const sync=()=>{
      const period=$('sel-periode-mobile').value;
      const stationMode=$('l5-sectie').style.display==='none';
      $('sel-hoofdtab-mobile').disabled=!stationMode;
      const regular=stationMode&&$('sel-hoofdtab-mobile').value==='records';
      const param=$('sel-param-mobile').value;
      const climate=param.startsWith('dagen_');
      const calculation=$('record-calculation');
      const supports=['maand','decade','seizoen','jaar'].includes(period)&&['tx','tn','tg','rh','sq'].includes(param);
      $('record-calculation-group').hidden=!regular||!supports;
      const aggregate=supports&&calculation.value==='period';
      if(regular&&period==='jaar')$('filter-jaar').style.display=aggregate?'none':'flex';
      const climatePeriod={dag:'de gekozen kalenderdag',decade:'de gekozen decade',maand:'de gekozen maand',seizoen:'het gekozen seizoen',jaar:'het gekozen jaar',alltime:'elk kalenderjaar',periode:'de gekozen periode'};
      help.textContent=climate?`Aantal dagen boven de gekozen temperatuurgrens binnen ${climatePeriod[period]||'de gekozen periode'}.`:aggregate
        ? (['rh','sq'].includes(param)?'Som over de gekozen periode, vergeleken tussen jaren.':'Gemiddelde over de gekozen periode, vergeleken tussen jaren.')
        : 'Afzonderlijke dagmetingen binnen de gekozen periode. Zoek een station of filter de ranglijst.';
      actions.hidden=!regular;
      step.hidden=!['jaar','maand','seizoen','dag','decade'].includes(period)||(period==='jaar'&&aggregate);
      direction.querySelectorAll('.rtab').forEach(tab=>{tab.setAttribute('aria-pressed',String(tab.classList.contains('actief')));tab.setAttribute('aria-disabled',String(tab.style.pointerEvents==='none'));});
    };
    document.addEventListener('change',sync);document.addEventListener('click',sync);document.addEventListener('weerlab-records-rendered',sync);sync();
  }
  function p13Controls() {
    const panel=$('tab-records');
    const control=element('label',{class:'record-section-control'},'Toon records voor');
    const select=element('select',{'aria-label':'Periode van P13-records'});
    const groups={jaar:['g-jaren'],maand:['g-maanden'],seizoen:['g-sei-nat','g-sei-droog'],decade:['g-dec'],dag:['g-dag'],alles:['g-jaren','g-maanden','g-sei-nat','g-sei-droog','g-dec','g-dag']};
    for(const [v,l] of [['jaar','Jaar'],['maand','Maand'],['seizoen','Seizoen'],['decade','Decade (10 dagen)'],['dag','Dag'],['alles','Alle perioden']])select.append(element('option',{value:v},l));
    control.append(select);panel.prepend(control);
    const update=()=>{for(const id of groups.alles){const grid=$(id);grid.hidden=!groups[select.value].includes(id);grid.previousElementSibling.hidden=grid.hidden;}};
    select.addEventListener('change',update);update();
    const info=document.querySelector('.info');
    const details=element('details',{class:'info'});details.append(element('summary',{},'Meetwijze en stations'));
    while(info.firstChild)details.append(info.firstChild);info.replaceWith(details);
  }
  function yearControls() {
    const tabs=$('hoofdtabs-balk');
    const control=element('label',{class:'record-subnav'},'Onderdeel');
    const select=element('select',{'aria-label':'Onderdeel van dagrecords'});
    const buttons=Array.from(tabs.children).filter(el=>el.id.startsWith('hoofdtab-'));
    buttons.forEach(button=>select.append(element('option',{value:button.id},button.textContent.trim())));
    select.value='hoofdtab-dagrecordsjaar';
    select.addEventListener('change',()=>$(select.value).click());
    tabs.addEventListener('click',event=>{const button=event.target.closest('[id^=hoofdtab-]');if(button)select.value=button.id;});
    control.append(select);tabs.before(control);tabs.hidden=true;
    document.addEventListener('click',()=>{select.disabled=$('l5-sectie')?.style.display!=='none';});
  }
  function extremeControls() {
    const dashboard=$('dashboard');
    const hero=dashboard.querySelector('.hero-grid');
    const details=element('details',{class:'record-explanation'});
    details.append(element('summary',{},'Gekozen jaar: uitslag, meetreeks en dekking'));
    hero.before(details);details.append(hero);
    const chart=$('chart')?.closest('.block');
    if(chart){const graph=element('details',{class:'record-explanation'});graph.append(element('summary',{},'Grafiek van de afgelopen jaren'));chart.before(graph);graph.append(chart);}
    const today=$('todayCard');
    const live=element('details',{class:'record-explanation'});live.append(element('summary',{},'Vandaag tot nu toe · voorlopige metingen'));
    today.before(live);live.append(today);
    const showLive=()=>{live.hidden=today.classList.contains('hidden');};
    new MutationObserver(showLive).observe(today,{attributes:true,attributeFilter:['class']});showLive();
  }
  function rainControls() {
    const info=document.querySelector('.info-balk');
    const details=element('details',{class:'record-explanation'});
    details.append(element('summary',{},'Meetnet, meetperiode en uitleg'));
    info.before(details);details.append(info);
    document.querySelectorAll('.filter-periode-extra label').forEach(label=>{
      const field=label.nextElementSibling;
      if(field?.matches('input,select')&&field.id)label.htmlFor=field.id;
    });
  }
  function sortValue(text) {
    const value=text.trim().replace(/\s*lopend\s*/g,'').trim();
    const date=value.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if(date)return Number(date[3]+date[2].padStart(2,'0')+date[1].padStart(2,'0'));
    const named=value.toLowerCase().match(/^(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/);
    if(named){const month=['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'].indexOf(named[2].slice(0,3));if(month>=0)return Number(named[3]||2000)*10000+(month+1)*100+Number(named[1]);}
    if(/^[−-]?\d+(?:[.,]\d+)?(?:\s*(?:°C?|mm|cm|hPa|km\/u|uur|dagen|%))?$/.test(value))return Number(value.replace('−','-').replace(',','.').match(/^-?\d+(?:\.\d+)?/)[0]);
    return value.toLocaleLowerCase('nl');
  }
  const enhanced=new WeakSet();
  function enhanceTable(table) {
    if(enhanced.has(table)||!table.tHead||!table.tBodies.length) return;
    // Only long rankings need extra controls; small summary tables stay compact.
    if(table.tBodies[0].rows.length<11) return;
    enhanced.add(table);
    const tools=element('div',{class:'record-table-tools'});
    const label=element('label',{},'Filter deze ranglijst');
    const input=element('input',{type:'search',placeholder:'Zoek datum, jaar of station','aria-label':'Filter deze ranglijst'});
    label.append(input);
    const amount=element('label',{},'Aantal rijen');
    const limit=element('select',{'aria-label':'Aantal rijen'});
    for(const [v,t] of [['10','10'],['25','25'],['all','Alle geladen rijen']])limit.append(element('option',{value:v},t));
    amount.append(limit);const count=element('output',{'aria-live':'polite'});
    const empty=element('p',{class:'record-empty',hidden:''},'Geen resultaten binnen deze geladen ranglijst. Pas de zoekterm of de filters bovenaan aan.');
    tools.append(label,amount,count);table.before(tools);table.after(empty);
    let rows=[],sortColumn=-1,ascending=true;
    function apply() {
      const q=input.value.trim().toLocaleLowerCase('nl');
      const found=rows.filter(row=>row.textContent.toLocaleLowerCase('nl').includes(q));
      const max=limit.value==='all'?found.length:Number(limit.value);
      const shown=new Set(found.slice(0,max));rows.forEach(row=>{row.hidden=!shown.has(row);});
      const visible=getComputedStyle(table).display!=='none';
      tools.hidden=!visible;empty.hidden=!visible||found.length>0;
      const text=`${Math.min(max,found.length)} van ${found.length} rijen${q?' · '+rows.length+' geladen':''}`;
      if(count.textContent!==text)count.textContent=text;
    }
    function refresh() {
      sortColumn=-1;
      table.tHead.querySelectorAll('[aria-sort]').forEach(h=>h.removeAttribute('aria-sort'));
      table.tHead.querySelectorAll('.record-sort-indicator').forEach(el=>el.textContent=' ↕');
      rows=Array.from(table.tBodies[0]?.rows||[]).filter(row=>!row.querySelector('[colspan]'));
      table.querySelectorAll('tbody tr:has([colspan])').forEach(row=>row.hidden=true);
      Array.from(table.tHead.rows[0]?.cells||[]).forEach((th,index)=>{
        if(th.querySelector('button')||th.onclick||th.hasAttribute('onclick'))return;
        const title=th.textContent.trim();
        if(title==='Datum/periode')return;
        if(!/^(Datum|Jaar|Station|Waarde|Max(?:imum)?\s?temp|Min(?:imum)?\s?temp|Gem(?:iddelde)?\s?temp|Neerslag|Zonuren|Windstoot)/i.test(title))return;
        const button=element('button',{type:'button',class:'record-sort','aria-label':'Sorteer op '+title},title);
        button.append(element('span',{class:'record-sort-indicator','aria-hidden':'true'},' ↕'));
        th.replaceChildren(button);
        button.addEventListener('click',()=>{
          ascending=sortColumn===index?!ascending:true;sortColumn=index;
          rows.sort((a,b)=>{
            const av=sortValue(a.cells[index]?.textContent||''),bv=sortValue(b.cells[index]?.textContent||'');
            const cmp=typeof av==='number'&&typeof bv==='number'?av-bv:String(av).localeCompare(String(bv),'nl',{numeric:true});
            return ascending?cmp:-cmp;
          });
          observer.disconnect();table.tBodies[0].append(...rows);
          table.tHead.querySelectorAll('[aria-sort]').forEach(h=>h.removeAttribute('aria-sort'));
          table.tHead.querySelectorAll('.record-sort-indicator').forEach(el=>el.textContent=' ↕');
          th.setAttribute('aria-sort',ascending?'ascending':'descending');
          button.querySelector('.record-sort-indicator').textContent=ascending?' ↑':' ↓';
          apply();observe();
        });
      });
      apply();observer.takeRecords();
    }
    const observer=new MutationObserver(refresh);
    const observe=()=>observer.observe(table,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['style']});
    input.addEventListener('input',apply);limit.addEventListener('change',apply);
    refresh();observe();
  }
  document.addEventListener('DOMContentLoaded',()=>{
    document.body.classList.add('record-page');
    const nav=element('nav',{class:'record-nav','aria-label':'Recordspagina’s'});
    const routes=['records','dagrecords','dagrecords-jaar','extremen','neerslag668','p13','hittegolven','eerstelaatste','feestdagen','normalen'];
    const archives=[['beta_landelijk_maand.html','Maandbeeld','maandbeeld'],['maandoverzicht.html','Maandstanden','maandoverzicht'],['zomerstatistieken.html','Zomerstatistieken','zomerstatistieken'],['droogtemonitor.html','Droogtemonitor','droogte'],['neerslag_records.html','Neerslagrecords','neerslag668'],['historisch.html','Historische dagkaarten','archief']];
    const archivePage=archives.some(([file])=>file===page);
    const entries=archivePage ? archives : links.map(([file,label],i)=>[file,label,routes[i]]);
    nav.setAttribute('aria-label','Weerrecords en historie');
    for(const [file,label,route] of entries){
      const a=element('a',{href:window===window.top?file:'index.html#'+route},label);
      if(file===page || (page==='normalen_vergelijk.html' && file==='normalen.html'))a.setAttribute('aria-current','page');nav.append(a);
    }
    nav.append(element('a',{class:'record-nav-all',href:'index.html#menu/terugkijken'},'Alle onderdelen →'));
    const heading=document.querySelector('.climate-heading');heading.after(nav);
    document.querySelectorAll('.rtab,.ptab,.param-tab').forEach(el=>{
      el.setAttribute('role','button');el.tabIndex=0;
      el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();if(el.getAttribute('aria-disabled')!=='true')el.click();}});
    });
    if(page==='records_debilt.html')mainControls();
    if(page==='p13_records.html')p13Controls();
    if(page==='dagrecords_jaar.html')yearControls();
    if(page==='extremen.html')extremeControls();
    if(page==='neerslag_records.html')rainControls();
    const rankingPages=['records_debilt.html','dagrecords_jaar.html','dagrecords_6dagen.html','extremen.html','neerslag_records.html','p13_records.html'];
    const scan=()=>{
      for(const id of ['sel-station','station','stationSelect','station-select','sel-grafiek-station','sel-verg-station','ss']){const select=$(id);if(select?.tagName==='SELECT')stationSearch(select);}
      if(rankingPages.includes(page))document.querySelectorAll('table').forEach(enhanceTable);
    };
    scan();let queued=false;
    new MutationObserver(()=>{if(!queued){queued=true;requestAnimationFrame(()=>{queued=false;scan();});}}).observe(document.body,{childList:true,subtree:true});
  });
})();
