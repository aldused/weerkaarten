(function(){
  'use strict';
  const core=window.WeerlabDiscussion;
  const $=id=>document.getElementById(id);
  const BASE=new URLSearchParams(location.search).get('localData')==='1'?'../guidance_cache/':'https://data.weerlab.nl/';
  let edition=null,selectedDate='',allDays=false,gallery=[],currentChart=null,request=0,controller=null,pendingEdition=null;
  let lastDay=core.today(),lastError='';
  const dialog=$('chart-dialog');
  function text(tag,value,className){const node=document.createElement(tag);node.textContent=value||'';if(className)node.className=className;return node;}
  function formatDate(date,options){return new Date(date+'T12:00:00Z').toLocaleDateString('nl-NL',{timeZone:'Europe/Amsterdam',...options});}
  function timestamp(value,utc=false){
    const date=new Date(value);if(!Number.isFinite(date.getTime()))return 'Niet vermeld';
    return date.toLocaleString('nl-NL',{timeZone:utc?'UTC':'Europe/Amsterdam',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})+(utc?' UTC':'');
  }
  function updateStatus(){
    if(!edition)return;
    if(edition.korte_termijn)$('short-term-status').hidden=Date.parse(edition.korte_termijn.geldig_tot)>Date.now();
    const age=core.ageHours(edition.generated_utc),runAge=core.ageHours(edition.ecmwf_run_utc);
    const stale=age>14||!edition.days.some(d=>d.date>=core.today());
    if(edition.redactioneel_voorbeeld){$('status').dataset.state='warning';$('status').textContent='Redactioneel voorbeeld op basis van de editie van '+timestamp(edition.generated_utc)+'. Dit is geen nieuwe actuele verwachting.'+(edition.voorbeeld_kaartmelding?' '+edition.voorbeeld_kaartmelding:'');return;}
    $('status').dataset.state=lastError||stale||runAge>36?'warning':'info';
    const labels=[];
    if(lastError)labels.push(lastError);
    if(stale)labels.push('Oudere editie: controleer de uitgifte en geldigheid voordat je deze bespreking gebruikt.');
    else labels.push('Meest recent opgehaalde editie');
    if(runAge>36)labels.push('De ECMWF-basisrun is ouder dan 36 uur.');
    if(!lastError&&!stale)labels.push('automatisch samengesteld · volgende controle binnen 15 min');
    $('status').textContent=labels.join(' · ');
  }
  function updateDayView(){
    const nodes=[...$('days').children];
    $('all-days').setAttribute('aria-pressed',String(allDays));
    $('all-days').textContent=allDays?'Eén dag bekijken':'Alle dagen onder elkaar';
    $('days').classList.toggle('all-view',allDays);
    nodes.forEach(node=>{node.hidden=!allDays&&node.dataset.date!==selectedDate;});
    $('day-nav').querySelectorAll('button').forEach(button=>{
      const on=!allDays&&button.dataset.date===selectedDate;
      button.setAttribute('aria-pressed',String(on));
    });
  }
  function refreshDialog(){
    if(!currentChart)return;
    const available=gallery.filter(x=>!x.failed);
    $('chart-counter').textContent=`${available.indexOf(currentChart)+1} / ${available.length}`;
    $('chart-caption').textContent=currentChart.caption;
    $('chart-image').hidden=false;$('chart-error').hidden=true;
    $('chart-image').alt=currentChart.caption;$('chart-image').src=currentChart.src;
    $('previous-chart').disabled=$('next-chart').disabled=available.length<2;
  }
  function openChart(item){if(item.failed)return;currentChart=item;refreshDialog();dialog.showModal();}
  function nextChart(direction){
    const available=gallery.filter(x=>!x.failed);if(!available.length)return;
    currentChart=available[(available.indexOf(currentChart)+direction+available.length)%available.length];refreshDialog();
  }
  function closeChart(){dialog.close();}
  $('close-chart').addEventListener('click',closeChart);
  $('previous-chart').addEventListener('click',()=>nextChart(-1));
  $('next-chart').addEventListener('click',()=>nextChart(1));
  dialog.addEventListener('click',event=>{if(event.target===dialog)closeChart();});
  dialog.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();nextChart(event.key==='ArrowLeft'?-1:1);}});
  dialog.addEventListener('close',()=>{currentChart=null;if(pendingEdition){const fresh=pendingEdition;pendingEdition=null;render(fresh);}});
  $('chart-image').addEventListener('error',()=>{$('chart-image').hidden=true;$('chart-error').hidden=false;});
  function caption(chart,kind){
    if(kind==='ecmwf')return 'ECMWF · '+(chart.valid_label||'Overzichtskaart');
    if(kind==='knmi')return 'KNMI · '+(chart.valid_label||chart.soort||'Frontkaart');
    if(kind==='cluster'){
      const period={int1:'dag 3–4',int2:'dag 5–7',int3:'dag 8–10'}[(chart.file.match(/int[123]/)||[])[0]];
      return 'ECMWF ENS · clusters '+(period||'');
    }
    return 'UKMO/Bracknell · '+(core.numeric(chart.lead)===0?'analyse':core.numeric(chart.lead)!==null?'bestandsstap '+chart.lead:'frontkaart')+' · zie geldigheid op kaart';
  }
  function thumbnail(chart,kind,feed){
    const src=core.fileUrl(chart.file,BASE,feed.generated_utc);if(!src)return null;
    const item={src,caption:caption(chart,kind),failed:false};gallery.push(item);
    const button=document.createElement('button');button.type='button';button.className='chart-thumb';button.setAttribute('aria-label','Vergroot '+item.caption);
    const img=document.createElement('img');img.src=src;img.alt='';img.loading='lazy';img.decoding='async';img.width=400;img.height=348;
    img.addEventListener('error',()=>{item.failed=true;img.hidden=true;button.prepend(text('span','Kaart tijdelijk niet beschikbaar','image-failed'));button.disabled=true;});
    button.append(img,text('span',item.caption));button.addEventListener('click',()=>openChart(item));return button;
  }
  function appendCharts(container,items,feed){let count=0;for(const {chart,kind} of items){const thumb=thumbnail(chart,kind,feed);if(thumb){container.append(thumb);count++;}}return count;}
  function sourceDetails(ids,feed){
    const details=text('details','','text-sources');details.append(text('summary','Onderbouwing'));
    const list=text('ul');
    for(const id of ids){
      const source=(feed.bronregister||[]).find(s=>s.id===id);
      if(source)list.append(text('li',source.naam+(source.issued_utc?' · '+timestamp(source.issued_utc):'')));
    }
    details.append(list);return details;
  }
  function render(feed){
    edition=feed;lastError='';
    $('issued').textContent=timestamp(feed.generated_utc);
    $('model-run').textContent=timestamp(feed.ecmwf_run_utc,true);
    const ordered=feed.days.slice().sort((a,b)=>a.date.localeCompare(b.date));
    $('period').textContent=formatDate(ordered[0].date,{day:'numeric',month:'short'})+' – '+formatDate(ordered.at(-1).date,{day:'numeric',month:'short',year:'numeric'});
    $('intro').textContent=feed.intro;
    $('attention').replaceChildren();
    const attention=core.sentences(feed.aandachtspunten);
    (attention.length?attention:['In deze editie zijn geen afzonderlijke aandachtspunten aangeleverd.']).forEach(sentence=>$('attention').append(text('li',sentence)));
    $('short-term-elements').replaceChildren();
    const short=feed.korte_termijn;
    $('short-term-panel').hidden=$('short-term-link').hidden=!short;
    if(short){
      $('short-term-period').textContent=timestamp(short.geldig_van)+' – '+timestamp(short.geldig_tot)+' · Nederlandse tijd';
      for(const item of short.elementen){
        const card=text('article','','panel element-card');
        card.append(text('h3',core.elementNames[item.element]),text('p',item.tekst));
        card.append(sourceDetails(item.bron_ids,feed));
        $('short-term-elements').append(card);
      }
    }
    $('source-notes').hidden=!feed.bronnotities;
    $('source-notes').textContent=feed.bronnotities||'';
    const sources=new Map((feed.bronregister||[]).map(source=>[source.id,source]));
    $('assessments').replaceChildren();
    (feed.modelbeoordeling||[]).forEach(item=>{
      const card=text('article','','panel assessment-card');
      card.append(text('p',item.periode,'eyebrow'),text('h3',item.onderwerp),text('p',item.vergelijking));
      const impact=text('div','','assessment-impact');impact.append(text('h4','Betekenis voor Nederland'),text('p',item.betekenis));card.append(impact);
      card.append(sourceDetails(item.bron_ids,feed));
      $('assessments').append(card);
    });
    $('assessment-panel').hidden=$('assessment-link').hidden=!$('assessments').children.length;
    $('attention-title').textContent=$('assessment-panel').hidden?'Modelverschillen & aandachtspunten':'Waarop letten';
    $('source-register').replaceChildren();
    if(sources.size){
      $('source-register').append(text('h3','Gebruikte bronnen bij deze editie'));
      const list=text('ul');
      sources.forEach(source=>list.append(text('li',source.naam+' · '+source.status+(source.issued_utc?' · uitgifte '+timestamp(source.issued_utc):''))));
      $('source-register').append(list);
    }
    $('source-register').hidden=!sources.size;
    $('outlook').textContent=feed.vooruitzichten||'';$('outlook-panel').hidden=!feed.vooruitzichten;
    const visible=ordered.filter(d=>d.date>=core.today());
    if(!visible.some(d=>d.date===selectedDate))selectedDate=visible[0]?.date||'';
    $('day-nav').replaceChildren();$('days').replaceChildren();gallery=[];
    const charts=[];
    for(const [field,kind] of [['ecmwf_charts','ecmwf'],['knmi_charts','knmi'],['brack_charts','brack'],['cluster_charts','cluster']]){
      for(const value of Array.isArray(feed[field])?feed[field]:[]){
        const chart=typeof value==='string'?{file:value}:value;
        if(chart&&core.fileUrl(chart.file,BASE,feed.generated_utc))charts.push({chart,kind,date:core.chartDate(chart,feed,kind)});
      }
    }
    const used=new Set();
    visible.forEach((day,index)=>{
      const choice=document.createElement('button');choice.type='button';choice.className='day-choice';choice.dataset.date=day.date;
      const label=day.date===core.today()?'Vandaag':formatDate(day.date,{weekday:'long'});
      choice.append(text('strong',label.charAt(0).toUpperCase()+label.slice(1)),text('span',formatDate(day.date,{day:'numeric',month:'short'})));
      choice.setAttribute('aria-controls','forecast-'+day.date);
      choice.addEventListener('click',()=>{selectedDate=day.date;allDays=false;updateDayView();});
      choice.addEventListener('keydown',event=>{
        const buttons=[...$('day-nav').children];let target=null;
        if(event.key==='ArrowRight')target=(index+1)%buttons.length;
        if(event.key==='ArrowLeft')target=(index-1+buttons.length)%buttons.length;
        if(event.key==='Home')target=0;if(event.key==='End')target=buttons.length-1;
        if(target!==null){event.preventDefault();buttons[target].focus();buttons[target].click();}
      });
      $('day-nav').append(choice);
      const card=document.createElement('article');card.className='day-card';card.id='forecast-'+day.date;card.dataset.date=day.date;card.setAttribute('aria-labelledby','day-title-'+day.date);
      const heading=text('div','','day-heading');const h=text('h3',formatDate(day.date,{weekday:'long',day:'numeric',month:'long'}));h.id='day-title-'+day.date;
      heading.append(h,text('span','Nederland · dagverwachting'));card.append(heading);
      const body=text('div','','day-body');const copy=text('div','','weather-copy');
      copy.append(text('h4','Verwacht weertype'),text('p',day.weertype));
      const synoptic=text('div','','synoptic');synoptic.append(text('h4','Synoptische onderbouwing'),text('p',day.synoptiek||day.text||''));copy.append(synoptic);
      if(day.onzekerheid){const uncertainty=text('div','','day-uncertainty');uncertainty.append(text('h4','Wat kan nog veranderen'),text('p',day.onzekerheid));copy.append(uncertainty);}
      body.append(copy);
      const items=charts.filter(item=>item.date===day.date);
      if(items.length){
        const images=text('div','','day-charts');images.append(text('p','Bronkaarten · klik om te vergroten','chart-title'));
        const grid=text('div','','chart-grid');appendCharts(grid,items,feed);items.forEach(item=>used.add(item));images.append(grid);
        if(!items.some(item=>item.kind==='knmi'))images.append(text('p','Voor deze dag bevat deze editie geen KNMI-frontkaart. KNMI-kaarten bestrijken alleen de korte termijn.','small-note'));
        if(charts.some(item=>item.kind==='brack'&&!item.date)){
          const link=text('a','Bekijk de Bracknell-frontkaarten ↓','text-link bracknell-link');link.href='#bracknell-kaarten';
          link.addEventListener('click',()=>{$('gallery-panel').open=true;});images.append(link);
        }
        body.append(images);
      }else body.classList.add('no-charts');
      card.append(body);$('days').append(card);
    });
    $('no-days').hidden=!!visible.length;$('all-days').hidden=!visible.length;
    // Used charts are shown once. Undated UKMO maps remain explicitly separate.
    $('source-groups').replaceChildren();let extraCount=0;
    const groups={brack:'UKMO/Bracknell · geldigheid op de kaart',knmi:'KNMI · overige frontkaarten',ecmwf:'ECMWF · verdere doorkijk',cluster:'ECMWF ENS · spreiding in de drukverdeling'};
    for(const [kind,title] of Object.entries(groups)){
      const extras=charts.filter(item=>item.kind===kind&&!used.has(item)&&(!item.date||item.date>=core.today()));
      if(!extras.length)continue;
      const section=text('section','','source-group');if(kind==='brack')section.id='bracknell-kaarten';section.append(text('h3',title));const grid=text('div','','chart-grid');extraCount+=appendCharts(grid,extras,feed);section.append(grid);$('source-groups').append(section);
    }
    $('chart-count').textContent=`(${extraCount})`;$('gallery-panel').hidden=!extraCount;
    $('edition').hidden=false;$('content').hidden=false;updateDayView();updateStatus();
  }
  async function load(){
    const id=++request;if(controller)controller.abort();const activeController=new AbortController();controller=activeController;
    const timeout=setTimeout(()=>activeController.abort(),30000);
    $('refresh').disabled=true;$('refresh').setAttribute('aria-busy','true');
    if(!edition){$('status').dataset.state='info';$('status').textContent='De nieuwste bespreking wordt opgehaald…';}
    try{
      const response=await fetch(BASE+'ecmwf_guidance.json',{cache:'no-store',signal:activeController.signal});
      if(!response.ok)throw new Error('Niet beschikbaar');
      const feed=core.validate(await response.json());if(id!==request)return;
      if(edition&&Date.parse(feed.generated_utc)<Date.parse(edition.generated_utc))throw new Error('Oudere editie ontvangen');
      if(dialog.open){pendingEdition=feed;lastError='';updateStatus();}else render(feed);
    }catch(error){
      if(id!==request)return;
      if(edition){lastError='Verversen niet gelukt; de laatst geladen editie blijft zichtbaar';updateStatus();}
      else{$('status').dataset.state='error';$('status').textContent='De bespreking is nu niet bereikbaar. Probeer opnieuw met Verversen.';}
    }finally{
      clearTimeout(timeout);if(id===request){$('refresh').disabled=false;$('refresh').removeAttribute('aria-busy');}
    }
  }
  $('all-days').addEventListener('click',()=>{allDays=!allDays;updateDayView();});
  $('refresh').addEventListener('click',load);
  window.addEventListener('storage',event=>{if(event.key==='weerlab_theme')document.documentElement.dataset.theme=event.newValue==='dark'?'dark':'light';});
  setInterval(()=>{if(edition)updateStatus();const day=core.today();if(day!==lastDay){lastDay=day;if(edition&&!dialog.open)render(edition);load();}},30000);
  setInterval(()=>{if(!document.hidden)load();},15*60000);
  load();
})();
