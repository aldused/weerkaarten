/* Searchable, shared min/max forecast. Values come from the published MOS fields. */
window.TemperaturePlace=(function(){
  'use strict';
  const Data=window.TemperaturePlaceData,NS='http://www.w3.org/2000/svg',sources={},errors={},loading={};
  const dayFmt=new Intl.DateTimeFormat('nl-NL',{timeZone:'UTC',weekday:'short',day:'numeric',month:'short'});
  const shortDay=new Intl.DateTimeFormat('nl-NL',{timeZone:'UTC',weekday:'short',day:'numeric'});
  const stampFmt=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  const exportDate=new Intl.DateTimeFormat('nl-NL',{timeZone:'UTC',day:'numeric',month:'long',year:'numeric'});
  const periodFmt=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  const placeCountFmt=new Intl.NumberFormat('nl-NL');
  const fmt=v=>Number.isFinite(v)?v.toFixed(1).replace('.',',').replace('-','−'):'–';
  const dateOf=row=>new Date(row.key+'T12:00:00Z');
  const tag=(name,className,text)=>{const n=document.createElement(name);if(className)n.className=className;if(text!=null)n.textContent=text;return n;};
  const svgNode=(tag,attrs,parent,text)=>{const n=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);if(text!=null)n.textContent=text;parent.append(n);return n;};
  let root,config,places=[],choice=null,point=null,rows=[],selection=0,results=[],active=-1,manual=false,pendingRestore=null;
  let grass=true,margins=false,ignoreSync=false,catalogueError=false,chartWidth=1120;
  let exporting=false, pendingWarm=false, extremesAvailable=false, referenceChanged=false;
  const $=id=>root.querySelector('#'+id);
  function mount(options){
    config=options;
    root=tag('section','temperature-place');root.id='placeForecast';root.setAttribute('aria-labelledby','placeHeading');
    root.innerHTML=`<div class="place-top"><div class="place-intro"><p class="place-eyebrow">Jouw temperatuurverwachting</p><h2 id="placeHeading">Temperatuur voor <span id="placeName">de koudste plaats</span></h2><p class="place-lead">Maximum, nachtminimum en grasminimum in één overzicht.</p></div>
      <form class="place-search" role="search" autocomplete="off"><label for="placeQuery">Zoek een plaats</label><div class="place-search-box"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input id="placeQuery" type="search" placeholder="Bijv. Wateringen of De Bilt" role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="placeResults" spellcheck="false"><button type="submit">Toon</button></div><ul id="placeResults" role="listbox" aria-label="Gevonden plaatsen" hidden></ul><p class="place-search-status" id="placeSearchStatus" role="status" aria-live="polite">Zoeken in Nederlandse plaatsen</p></form></div>
      <div class="place-tools"><div><div class="place-extremes" role="group" aria-label="Plaats kiezen op temperatuur"><button type="button" id="placeCold" aria-pressed="true" disabled><i></i>Koudste plaats</button><button type="button" id="placeWarm" aria-pressed="false" disabled><i></i>Zachtste plaats</button></div><p class="place-mode" id="placeMode" aria-live="polite">Volgt de koudste plaats op de kaart</p></div><div class="place-toggles"><label><input type="checkbox" id="placeGrass" checked><span class="series-key grass"></span>Grasminimum</label><label><input type="checkbox" id="placeMargins">Foutmarges</label><button type="button" id="placeDownload" disabled>Download grafiek (PNG)</button></div></div>
      <div class="place-metrics" id="placeMetrics"></div>
      <div class="place-plot" id="placePlot"><div class="place-empty" role="status">De temperatuurverwachting wordt geladen…</div></div>
      <div class="place-chart-footer"><div class="place-legend"><span><i class="series-key max"></i>Maximum 2 m</span><span><i class="series-key min"></i>Minimum 2 m</span><span id="placeGrassLegend"><i class="series-key grass"></i>Minimum 10 cm boven gras</span></div><span id="placeHorizon"></span></div>
      <p class="place-explanation">Het minimum hoort bij de nacht vóór de aangegeven dag (18–09 uur Nederlandse tijd). Het maximum geldt voor 00–24 UTC. Grasminimum is de luchttemperatuur op 10 cm boven gras. Het vlak toont het min–maxbereik.</p>
      <p class="place-sources" id="placeSources"></p><p class="place-export-status" id="placeExportStatus" role="status" hidden></p><div class="place-errors" id="placeErrors" role="status" hidden></div>
      <details class="place-data"><summary>Alle waarden en exacte periodes</summary><div class="place-table-wrap" tabindex="0" role="region" aria-label="Temperatuurwaarden per dag"><table><thead><tr><th scope="col">Dag</th><th scope="col">Maximum 2 m</th><th scope="col">Minimum 2 m</th><th scope="col">Grasminimum</th><th scope="col">Periodes en dekking</th></tr></thead><tbody id="placeTable"></tbody></table></div></details>`;
    document.querySelector('header').after(root);
    const input=$('placeQuery');
    input.addEventListener('input',()=>{
      pendingRestore=null;
      pendingWarm=false;
      suggest();
    });
    input.addEventListener('focus',()=>{if(input.value.length>=2)suggest();});
    input.addEventListener('keydown',e=>{
      if(e.key==='Escape'){closeResults();return;}
      if(!['ArrowDown','ArrowUp','Enter'].includes(e.key))return;
      if(e.key==='Enter')return; // submit selects the highlighted result
      if(!results.length)return;e.preventDefault();
      active=active<0?(e.key==='ArrowDown'?0:results.length-1):(active+(e.key==='ArrowDown'?1:-1)+results.length)%results.length;highlight();
    });
    root.querySelector('form').addEventListener('submit',e=>{e.preventDefault();if(results.length){select(results[active>=0?active:0]);return;}suggest();});
    document.addEventListener('pointerdown',e=>{if(!root.querySelector('.place-search').contains(e.target))closeResults();});
    input.addEventListener('blur',e=>{if(!root.querySelector('.place-search').contains(e.relatedTarget))closeResults();});
    $('placeGrass').onchange=e=>{grass=e.target.checked;render();};
    $('placeMargins').onchange=e=>{margins=e.target.checked;if(margins)for(const kind of ['night','tx'])if(sources[kind]&&!sources[kind].periods.some(p=>p.sigma))load(kind,true);render();};
    $('placeCold').onclick=()=>chooseExtreme('cold');
    $('placeWarm').onclick=()=>chooseExtreme('warm');
    $('placeDownload').onclick=downloadChart;
    try {
      const saved=JSON.parse(sessionStorage.getItem('weerlab_temperature_place'));
      pendingWarm=saved?.extreme==='warm';
      if(saved&&typeof saved.name==='string'&&Number.isFinite(saved.lat)&&Number.isFinite(saved.lon))pendingRestore=saved;
    }catch(e){}
    fetch('temperature-places.json?v=20261124-plaatsen').then(response=>{
      if(!response.ok)throw new Error('plaatsenlijst');
      return response.json();
    }).then(data=>{
      places=Data.catalogue(data.places);
      if(input.value)suggest();
      else $('placeSearchStatus').textContent=catalogueSummary();
    }).catch(()=>{
      catalogueError=true;
      $('placeSearchStatus').textContent=catalogueSummary();
    });
    let width=0;new ResizeObserver(entries=>{const next=entries[0].contentRect.width;if(Math.abs(next-width)>.5){width=next;if(rows.length)chart();}}).observe($('placePlot'));
    load(config.kind==='night'?'tx':'night');
  }
  function catalogueSummary(){
    if(catalogueError)return 'De plaatsenlijst kon niet laden. Vernieuw de pagina om opnieuw te proberen.';
    return places.length?'Zoek in '+placeCountFmt.format(places.length)+' Nederlandse plaatsen en locaties':'De plaatsenlijst wordt geladen…';
  }
  function suggest(){
    const q=$('placeQuery').value.trim();results=Data.search(places,q);active=-1;
    const list=$('placeResults');list.replaceChildren();
    $('placeQuery').removeAttribute('aria-activedescendant');
    if(q.length<2){closeResults();$('placeSearchStatus').textContent=q?'Typ minimaal twee letters':catalogueSummary();return;}
    if(!places.length){$('placeSearchStatus').textContent=catalogueSummary();closeResults();return;}
    results.forEach((p,i)=>{const li=tag('li');li.id='placeOption'+i;li.setAttribute('role','option');li.setAttribute('aria-selected','false');
      const coordinates=p.lat.toFixed(2).replace('.',',')+'° N · '+p.lon.toFixed(2).replace('.',',')+'° O';
      li.append(tag('span','place-result-name',p.name),tag('small','',p.area||coordinates));
      li.addEventListener('pointerdown',e=>e.preventDefault());li.addEventListener('click',()=>select(p));list.append(li);});
    list.hidden=!results.length;$('placeQuery').setAttribute('aria-expanded',String(!!results.length));
    $('placeSearchStatus').textContent=results.length?results.length+(results.length===1?' suggestie':' suggesties')+' · kies met Enter of de pijltjestoetsen':'Geen plaats gevonden. Probeer een andere spelling.';
  }
  function highlight(){
    [...$('placeResults').children].forEach((li,i)=>li.setAttribute('aria-selected',String(i===active)));
    $('placeQuery').setAttribute('aria-activedescendant','placeOption'+active);
  }
  function closeResults(){if(!root)return;$('placeResults').hidden=true;$('placeQuery').setAttribute('aria-expanded','false');$('placeQuery').removeAttribute('aria-activedescendant');}
  function chooseExtreme(direction) {
    manual=false;
    choice=null;
    referenceChanged=true;
    pendingRestore=null;
    pendingWarm=false;
    results=[];
    active=-1;
    closeResults();
    $('placeQuery').value='';
    $('placeSearchStatus').textContent=catalogueSummary();
    config.onExtreme(direction);
  }
  function select(p){
    pendingRestore=null;
    pendingWarm=false;
    point=p;choice=p;manual=true;selection=0;closeResults();results=[];active=-1;$('placeQuery').value=p.name;
    $('placeSearchStatus').textContent='Verwachting voor '+p.name;
    try{sessionStorage.setItem('weerlab_temperature_place',JSON.stringify({name:p.name,lat:p.lat,lon:p.lon,area:p.area}));}catch(e){}
    ignoreSync=true;try{config.onSelect(p);}finally{ignoreSync=false;}render();
  }
  function sync(p){
    if(!p){
      extremesAvailable=false;
      if(!manual)point=null;
      render();
      return;
    }
    extremesAvailable=p.extremesAvailable;
    if(ignoreSync)return;
    if(manual&&choice&&!p.auto){const cell=Data.nearest(sources[p.kind],choice);if(cell?.index===p.cell){render();return;}}
    referenceChanged=p.auto&&(referenceChanged||p.reference?.key!==point?.reference?.key||p.extreme!==point?.extreme);
    point=p;choice=null;manual=!p.auto;
    if(document.activeElement!==$('placeQuery'))$('placeQuery').value=p.auto?'':p.name;
    try {
      if(p.extreme==='warm')sessionStorage.setItem('weerlab_temperature_place',JSON.stringify({extreme:'warm'}));
      else if(p.auto){if(!pendingWarm&&!pendingRestore)sessionStorage.removeItem('weerlab_temperature_place');}
      else sessionStorage.setItem('weerlab_temperature_place',JSON.stringify({name:p.name,lat:p.lat,lon:p.lon,area:p.area}));
    }catch(e){}
    render();
  }
  function setSource(kind,j){
    try{sources[kind]=Data.source(kind,j);delete errors[kind];
      if(kind===config.kind){
        if(pendingWarm)chooseExtreme('warm');
        else if(pendingRestore||choice)select(pendingRestore||choice);
      }
    }catch(e){errors[kind]='De '+(kind==='night'?'minimum-':'maximum-')+'gegevens hebben geen geldig formaat.';}
    render();
  }
  async function load(kind,full=false){
    if(loading[kind])return;loading[kind]=true;delete errors[kind];
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),25000);
    const file=kind==='night'?(full?'wgt_latest.json':'wgt_nachten.json'):(full?'wgt_tx_latest.json':'wgt_tx_dagen.json');
    try{const response=await fetch(config.dataBase+file+'?t='+Date.now(),{cache:'no-cache',signal:controller.signal});
      if(!response.ok)throw new Error('HTTP '+response.status);setSource(kind,await response.json());
    }catch(e){errors[kind]=(kind==='night'?'De minima':'De maxima')+' konden niet worden geladen.';
    }finally{clearTimeout(timer);loading[kind]=false;if(!full&&margins&&sources[kind]&&!errors[kind])load(kind,true);render();}
  }
  function sourceFailed(kind){errors[kind]=(kind==='night'?'De minima':'De maxima')+' konden niet worden geladen.';render();}
  function render(){
    if(!root)return;
    $('placeName').textContent=point?.name||'de koudste plaats';
    $('placeMode').textContent=manual?['Gekozen plaats',point?.area,'rooster circa 5 km'].filter(Boolean).join(' · '):extremeDescription()||'Volgt de koudste plaats op de kaart';
    $('placeCold').disabled=!extremesAvailable;
    $('placeWarm').disabled=!extremesAvailable;
    $('placeCold').setAttribute('aria-pressed',String(!manual&&point?.extreme!=='warm'));
    $('placeWarm').setAttribute('aria-pressed',String(!manual&&point?.extreme==='warm'));
    $('placeDownload').disabled=true;
    $('placeGrassLegend').hidden=!grass;
    const messages=Object.values(errors),errorBox=$('placeErrors');errorBox.replaceChildren();errorBox.hidden=!messages.length;
    if(messages.length){errorBox.append(tag('span','',messages.join(' ')+' De beschikbare reeksen blijven zichtbaar.'));const b=tag('button','','Opnieuw laden');b.type='button';b.onclick=()=>Object.keys(errors).forEach(kind=>load(kind,margins));errorBox.append(b);}
    $('placeSources').textContent=['night','tx'].filter(k=>sources[k]).map(k=>(k==='night'?'Minima':'Maxima')+': '+stampFmt.format(new Date(sources[k].created))).join(' · ')+' · bijwerktijden Nederlandse tijd';
    if(!point){
      rows=[];
      $('placeMetrics').replaceChildren();
      $('placePlot').replaceChildren(tag('div','place-empty',sources[config.kind]?'Geen temperatuurwaarden voor deze kaartperiode.':'De temperatuurverwachting wordt geladen…'));
      $('placeTable').replaceChildren();
      $('placeHorizon').textContent='';
      return;
    }
    const result=Data.series(sources,point);rows=result.rows;
    if(!rows.some(r=>Number.isFinite(r.min)||Number.isFinite(r.max)||Number.isFinite(r.grass))){
      $('placeMetrics').replaceChildren();$('placePlot').replaceChildren(tag('div','place-empty',Object.keys(sources).length?'Voor deze plaats zijn nog geen geldige waarden beschikbaar binnen het Nederlandse rekenrooster.':'De temperatuurverwachting wordt geladen…'));$('placeTable').replaceChildren();return;
    }
    if(!manual&&referenceChanged){
      const selected=rows.findIndex(row=>row.key===point.reference?.key);
      selection=selected<0?0:selected;
    }
    referenceChanged=false;
    selection=Math.min(selection,rows.length-1);metrics();chart();table();
    $('placeDownload').disabled=exporting||!$('placePlot').querySelector('svg');
    const indicative=rows.find(r=>r.day?.buiten_training||r.night?.buiten_training);
    $('placeHorizon').textContent=indicative?'Vanaf '+shortDay.format(dateOf(indicative))+': indicatief':'';
  }
  function extremeDescription() {
    const ref=point?.reference;
    if(manual||!ref)return '';
    const direction=point.extreme==='warm'?'Zachtste plaats':'Koudste plaats';
    return [direction,ref.area,ref.label,ref.period,fmt(ref.value)+' °C'].join(' · ');
  }
  async function downloadChart() {
    if(exporting||!$('placePlot').querySelector('svg'))return;
    const button=$('placeDownload');
    const status=$('placeExportStatus');
    exporting=true;
    button.disabled=true;
    button.textContent='PNG maken…';
    status.hidden=true;
    try {
      const {svgMapImage,saveMapPNG}=await import('./temperature-map-export.mjs?v=20261124-mos-label');
      const svg=$('placePlot').querySelector('svg');
      if(!svg||!point||!rows.length)throw new Error('Grafiek niet beschikbaar');
      const first=rows[0];
      const last=rows.at(-1);
      const palette=getComputedStyle(root);
      const series=[['max','Maximum op 2 m'],['min','Nachtminimum op 2 m']];
      if(grass)series.push(['grass','Nachtminimum op 10 cm boven gras (stippellijn)']);
      const legends=series.filter(([id])=>svg.querySelector('.place-dot.'+id)).map(([id,label])=>({
        label,color:palette.getPropertyValue('--tp-'+id).trim(),
      }));
      if(svg.querySelector('.place-band'))legends.push({label:'Schaduw rond de lijnen: modelmatig 80%-interval voor beschikbare reeksen',color:'#c4cedd'});
      const details={
        title:'Temperatuurverwachting voor '+point.name,
        headerLabel:'Experimenteel BETA MOS/MIX Weerlab',
        time:exportDate.format(dateOf(first))+' t/m '+exportDate.format(dateOf(last)),
        run:$('placeSources').textContent.replace(' · bijwerktijden Nederlandse tijd',''),
        lead:[$('placeHorizon').textContent,extremeDescription()].filter(Boolean).join(' · '),
        source:'weerlab.nl · Weerlab MOS · KNMI, DWD, ECMWF en NOAA',
        mapAttribution:'Nachtminima op de einddatum van de nacht (18–09 uur lokaal) · Dagmaxima 00–24 UTC',
        legends,
      };
      const slug=Data.normalise(point.name).replace(/ /g,'-')||'plaats';
      const chartImage=await svgMapImage(svg,{
        background:palette.getPropertyValue('--surface').trim(),
        pixelWidth:2400,
        omit:'.place-hit',
      });
      await saveMapPNG(chartImage,details,'weerlab-temperatuur-'+slug+'-'+first.key+'.png');
      status.textContent='PNG gedownload.';
    }catch(error){
      status.textContent='De grafiek kon niet worden gedownload. Probeer het opnieuw.';
      console.error(error);
    }finally{
      exporting=false;
      button.textContent='Download grafiek (PNG)';
      button.disabled=!$('placePlot').querySelector('svg');
      status.hidden=false;
    }
  }
  function metrics(){
    const row=rows[selection],container=$('placeMetrics');container.replaceChildren();
    for(const [key,title,sub] of [['max','Maximum overdag','2 m · 00–24 UTC'],['min','Minimum in de nacht','2 m · nacht vóór deze dag'],['grass','Minimum boven gras','10 cm · nacht vóór deze dag']]){
      const card=tag('div','place-metric '+key);if(key==='grass'&&!grass){card.hidden=true;}
      card.append(tag('span','place-metric-label',title),tag('strong','',fmt(row[key])+(Number.isFinite(row[key])?'°':'')),tag('span','place-metric-date',dayFmt.format(dateOf(row))),tag('small','',sub));container.append(card);
    }
    container.classList.toggle('without-grass',!grass);
  }
  function chart(){
    const parent=$('placePlot');parent.replaceChildren();
    const W=Math.max(720,parent.clientWidth),H=306,left=54,right=30,top=38,bottom=43,plotH=H-top-bottom;chartWidth=W;
    const visible=grass?['max','min','grass']:['max','min'];
    const extents=rows.flatMap(row=>visible.filter(k=>Number.isFinite(row[k])).flatMap(k=>{
      const s=margins?(k==='max'?row.sigmaMax:k==='grass'?row.sigmaGrass:NaN):NaN;
      return Number.isFinite(s)?[row[k]-1.28155*s,row[k]+1.28155*s]:[row[k]];
    }));
    if(!extents.length){parent.append(tag('div','place-empty','Voor de gekozen reeksen zijn geen waarden beschikbaar.'));return;}
    let lo=Math.floor((Math.min(...extents)-2)/2)*2,hi=Math.ceil((Math.max(...extents)+2)/2)*2;if(hi-lo<8){hi=lo+8;}
    const step=hi-lo>30?10:hi-lo>16?5:2;
    lo=Math.floor(lo/step)*step;hi=Math.ceil(hi/step)*step;
    const X=i=>left+36+(W-left-right-56)*(rows.length===1?.5:i/(rows.length-1)),Y=v=>top+(hi-v)/(hi-lo)*plotH;
    const scroll=tag('div','place-svg-scroll');scroll.setAttribute('aria-label','Temperatuurgrafiek, horizontaal te verschuiven op een klein scherm');parent.append(scroll);
    const s=document.createElementNS(NS,'svg');s.setAttribute('viewBox',`0 0 ${W} ${H}`);s.setAttribute('role','group');s.setAttribute('aria-label','Maximum, minimum en grasminimum bij '+point.name);scroll.append(s);
    svgNode('title',{},s,'Temperatuurverwachting voor '+point.name);
    const defs=svgNode('defs',{},s),gradient=svgNode('linearGradient',{id:'placeRangeGradient',x1:0,y1:0,x2:0,y2:1},defs);
    svgNode('stop',{offset:0,'stop-color':'#f28168','stop-opacity':'.12'},gradient);svgNode('stop',{offset:1,'stop-color':'#528fcf','stop-opacity':'.08'},gradient);
    const firstIndicative=rows.findIndex(r=>r.day?.buiten_training||r.night?.buiten_training);
    if(firstIndicative>=0){const x=firstIndicative?Math.max(left,(X(firstIndicative-1)+X(firstIndicative))/2):left;
      svgNode('rect',{x,y:top,width:W-right-x,height:plotH,class:'place-indicative'},s);
      svgNode('line',{x1:x,x2:x,y1:top,y2:H-bottom,class:'place-horizon-line'},s);
      svgNode('text',{x:x+10,y:23,class:'place-axis place-indicative-label'},s,'Indicatief');}
    for(let v=lo;v<=hi;v+=step){svgNode('line',{x1:left,x2:W-right,y1:Y(v),y2:Y(v),class:v===0?'place-zero':'place-grid'},s);svgNode('text',{x:left-13,y:Y(v)+4,'text-anchor':'end',class:'place-axis'},s,String(v).replace('-','−'));}
    svgNode('text',{x:left-13,y:top-17,'text-anchor':'end',class:'place-axis'},s,'°C');
    for(const run of Data.segments(rows,['max','min']))if(run.length>=2){const forward=run.map(({row,index})=>`${X(index)},${Y(row.max)}`),back=run.slice().reverse().map(({row,index})=>`${X(index)},${Y(row.min)}`);svgNode('path',{d:'M'+forward.join('L')+'L'+back.join('L')+'Z',fill:'url(#placeRangeGradient)'},s);}
    if(margins)for(const [key,sigma] of [['max','sigmaMax'],...(grass?[['grass','sigmaGrass']]:[])]){
      for(const run of Data.segments(rows,[key,sigma]))if(run.length>=2){const forward=run.map(({row,index})=>`${X(index)},${Y(row[key]+1.28155*row[sigma])}`),back=run.slice().reverse().map(({row,index})=>`${X(index)},${Y(row[key]-1.28155*row[sigma])}`);svgNode('path',{d:'M'+forward.join('L')+'L'+back.join('L')+'Z',class:'place-band '+key},s);}}
    svgNode('line',{x1:X(selection),x2:X(selection),y1:top,y2:H-bottom,class:'place-selection'},s);
    visible.forEach(key=>{
      Data.segments(rows,[key]).forEach(run=>svgNode('path',{d:run.map(({row,index},i)=>(i?'L':'M')+X(index)+','+Y(row[key])).join(''),class:'place-line '+key},s));
      rows.forEach((row,i)=>{if(!Number.isFinite(row[key]))return;svgNode('circle',{cx:X(i),cy:Y(row[key]),r:i===selection?5.5:4,class:'place-dot '+key,'data-index':i},s);});
    });
    // Draw values last so close grass/air lines cannot paint over their labels.
    for(const key of ['max','min'])rows.forEach((row,i)=>{
      if(!Number.isFinite(row[key]))return;
      const grassClose=grass&&Number.isFinite(row.grass)&&Y(row.grass)-Y(row.min)<35&&Y(row.grass)>=Y(row.min);
      const aboveMin=key==='min'&&grassClose&&Number.isFinite(row.max)&&Y(row.min)-Y(row.max)>30;
      svgNode('text',{x:X(i),y:Y(row[key])+(key==='max'||aboveMin?-13:23),'text-anchor':'middle',class:'place-value '+key},s,fmt(row[key])+'°');
    });
    rows.forEach((row,i)=>{
      svgNode('text',{x:X(i),y:H-13,'text-anchor':'middle',class:'place-axis '+(i===selection?'selected':'')},s,shortDay.format(dateOf(row)));
      const hitStart=i?(X(i-1)+X(i))/2:left,hitEnd=i===rows.length-1?W-right:(X(i)+X(i+1))/2;
      const hit=svgNode('rect',{x:hitStart,y:top-12,width:hitEnd-hitStart,height:plotH+bottom-2,fill:'transparent',class:'place-hit',tabindex:0,role:'button','aria-label':dayFmt.format(dateOf(row))+': maximum '+fmt(row.max)+', minimum '+fmt(row.min)+', grasminimum '+fmt(row.grass),'aria-pressed':String(i===selection)},s);
      const pick=()=>{selection=i;metrics();showDay(i);};hit.addEventListener('pointerenter',pick);hit.addEventListener('focus',pick);hit.addEventListener('click',pick);
      hit.addEventListener('keydown',e=>{if(['Enter',' '].includes(e.key)){e.preventDefault();pick();}if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();e.stopPropagation();const next=Math.max(0,Math.min(rows.length-1,i+(e.key==='ArrowRight'?1:-1)));s.querySelectorAll('.place-hit')[next].focus();}});
    });
    const detail=tag('div','place-day-detail');detail.id='placeDayDetail';detail.setAttribute('aria-live','polite');parent.append(detail);showDay(selection);
  }
  function showDay(i){
    const row=rows[i];if(!row)return;
    const s=$('placePlot').querySelector('svg');if(s){const positions=[...s.querySelectorAll('.place-hit')];positions.forEach((e,k)=>e.setAttribute('aria-pressed',String(k===i)));s.querySelectorAll('.place-dot').forEach(dot=>dot.setAttribute('r',+dot.dataset.index===i?5.5:4));const line=s.querySelector('.place-selection'),x=90+(chartWidth-54-30-56)*(rows.length===1?.5:i/(rows.length-1));line.setAttribute('x1',x);line.setAttribute('x2',x);}
    const detail=$('placeDayDetail');detail.replaceChildren();
    detail.append(tag('strong','',dayFmt.format(dateOf(row))));
    [['max','Maximum'],['min','Minimum'],...(grass?[['grass','Grasminimum']]:[])].forEach(([key,label])=>detail.append(tag('span',key,label+' '+fmt(row[key])+(Number.isFinite(row[key])?' °C':''))));
    if(margins){const text=[];for(const [key,sigma,label] of [['max','sigmaMax','Max'],...(grass?[['grass','sigmaGrass','Gras']]:[])])if(Number.isFinite(row[key])&&Number.isFinite(row[sigma]))text.push(label+' '+fmt(row[key]-1.28155*row[sigma])+' tot '+fmt(row[key]+1.28155*row[sigma])+' °C');detail.append(tag('small','',(text.length?'Modelmatig 80%-interval: '+text.join(' · ')+'. ':'Foutmarges zijn nog niet beschikbaar. ')+'Geen afzonderlijke marge voor het 2m-nachtminimum beschikbaar.'));}
  }
  function table(){
    const body=$('placeTable');body.replaceChildren();
    rows.forEach(row=>{const tr=tag('tr');tr.append(tag('th','',dayFmt.format(dateOf(row))));tr.firstChild.scope='row';
      for(const key of ['max','min','grass'])tr.append(tag('td','',fmt(row[key])+(Number.isFinite(row[key])?' °C':'')));
      const periods=[];if(row.night)periods.push('Nacht: '+periodFmt.format(new Date(row.night.start))+' – '+periodFmt.format(new Date(row.night.eind)));
      if(row.day)periods.push('Maximum: '+row.key+' 00–24 UTC'+(row.day.onvolledig?' · onvolledig':''));
      if(row.night?.buiten_training||row.day?.buiten_training)periods.push('Buiten toetsbereik');
      tr.append(tag('td','',periods.join(' · ')));body.append(tr);});
  }
  const cellFor=(kind,p)=>Data.nearest(sources[kind],p);
  return {mount,setSource,sync,sourceFailed,cellFor};
})();
