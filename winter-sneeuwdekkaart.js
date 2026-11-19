/* KNMI snow-cover and snowfall normals: measured station points, no spatial interpolation. */
(() => {
  'use strict';
  const section=document.getElementById('sneeuwdekkaart');
  if(!section)return;
  const $=name=>document.getElementById('snowmap-'+name),NS='http://www.w3.org/2000/svg';
  const number=new Intl.NumberFormat('nl-NL',{minimumFractionDigits:1,maximumFractionDigits:1});
  const integer=new Intl.NumberFormat('nl-NL');
  const colors=['#d7edf5','#9ccfe3','#559cbe','#256386','#103b59','#072c48','#031a2f'];
  const coverPeriods=new Set(['1961-1990','1991-2020']),cache=new Map();
  let metric='snowcover',coverPeriod='1991-2020';
  let data,geo,selected,view,markers,drag=null,hasDragged=false,loadId=0;
  const periodLabel=()=>data.period.join('–'),isSnowfall=()=>data.kind==='snowfall';
  const missingLabel=()=>isSnowfall()?'Geen jaarnormaal':'Geen volledige normaal';
  const markerNodes=new Map();
  function element(tag,text){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;}
  function svgElement(tag,attributes={}){const e=document.createElementNS(NS,tag);for(const [key,value]of Object.entries(attributes))e.setAttribute(key,value);return e;}
  function color(mean){return mean===null?'#b4bfc7':colors[mean<5?0:mean<10?1:mean<15?2:mean<20?3:mean<25?4:mean<30?5:6];}
  function point(station){const [lon0,lat1,cos,k]=geo.proj;return [(station.lon-lon0)*cos*k,(lat1-station.lat)*k];}
  function value(station){return station.mean===null?missingLabel():number.format(station.mean)+' dagen per jaar';}
  function setView(){
    view.w=Math.max(geo.w/5,Math.min(geo.w,view.w));view.h=view.w*geo.h/geo.w;
    view.x=Math.max(0,Math.min(geo.w-view.w,view.x));view.y=Math.max(0,Math.min(geo.h-view.h,view.y));
    $('svg').setAttribute('viewBox',`${view.x} ${view.y} ${view.w} ${view.h}`);
    $('zoom-in').disabled=view.w<=geo.w/5+.01;$('zoom-out').disabled=view.w>=geo.w-.01;
  }
  function zoom(factor){const cx=view.x+view.w/2,cy=view.y+view.h/2;view.w/=factor;view.h=view.w*geo.h/geo.w;view.x=cx-view.w/2;view.y=cy-view.h/2;setView();}
  function reset(){view={x:0,y:0,w:geo.w,h:geo.h};setView();}
  function choose(id,focus=false){
    selected=data.stations.find(s=>s.id===Number(id));if(!selected)return;
    $('station').value=String(selected.id);$('name').textContent=selected.name;
    $('value').textContent=selected.mean===null?missingLabel():number.format(selected.mean);$('value').classList.toggle('snowmap-empty',selected.mean===null);
    $('unit').textContent=isSnowfall()?(selected.mean===null?'KNMI publiceert geen jaarnormaal':'sneeuwdagen per kalenderjaar'):(selected.mean===null?`Meetreeks ${periodLabel()} is onvolledig`:'sneeuwdekdagen per kalenderjaar');
    $('coverage').textContent=isSnowfall()?(selected.mean===null?'Alleen beschikbare maandnormalen':'Gepubliceerde KNMI-jaarnormaal'):`${selected.years} van 30 kalenderjaren volledig gemeten`;
    $('observations').textContent=isSnowfall()?`Automatische waarnemingen · ${periodLabel()}. De bron geeft geen meetdekking per afzonderlijk jaar.`:`${integer.format(selected.validDays)} van ${integer.format(data.expectedDays)} dagen met een geldige registratie`;
    $('station-code').textContent=`KNMI-${isSnowfall()?'weerstation':'neerslagstation'} ${String(selected.id).padStart(3,'0')}`;
    $('position').textContent=selected.lat===null?'Geen eenduidige kaartpositie beschikbaar; dit station staat wel in de tabel.':'';
    for(const [sid,node]of markerNodes){node.classList.toggle('is-selected',sid===selected.id);node.setAttribute('aria-pressed',String(sid===selected.id));node.setAttribute('tabindex',sid===selected.id?'0':'-1');}
    const node=markerNodes.get(selected.id);
    if(node){markers.append(node);if(focus)node.focus({preventScroll:true});}
    $('annual-details').hidden=isSnowfall();$('monthly-details').hidden=!isSnowfall();
    if(isSnowfall()){
      const months=['Januari','Februari','Maart','April','Mei','Juni','Juli','Augustus','September','Oktober','November','December'];
      $('months').replaceChildren(...selected.monthly.map((count,index)=>{const tr=element('tr');tr.append(element('th',months[index]),element('td',count===null?'Geen normaal':number.format(count)));tr.firstChild.scope='row';return tr;}));
      $('months-caption').textContent=`Sneeuwdagen per maand · ${selected.name} · ${periodLabel()}`;
    }else{
      $('years').replaceChildren(...selected.annual.map(([year,count,valid])=>{
        const tr=element('tr');for(const text of [year,count===null?'Onvolledig':integer.format(count),valid])tr.append(element('td',text));return tr;
      }));
      $('years-caption').textContent=`Sneeuwdekdagen per kalenderjaar · ${selected.name}`;
    }
    const [x,y]=node?point(selected):[0,0];
    if(node&&view.w<geo.w&&(x<view.x||x>view.x+view.w||y<view.y||y>view.y+view.h)){view.x=x-view.w/2;view.y=y-view.h/2;setView();}
  }
  function tooltip(event,station){
    if(event.pointerType==='touch')return;
    const tip=$('tooltip'),box=$('frame').getBoundingClientRect();tip.textContent=`${station.name} · ${value(station)}`;tip.hidden=false;
    tip.style.left=Math.max(5,Math.min(box.width-tip.offsetWidth-5,event.clientX-box.left+12))+'px';
    tip.style.top=Math.max(5,Math.min(box.height-tip.offsetHeight-5,event.clientY-box.top+12))+'px';
  }
  function renderMap(){
    markerNodes.clear();$('tooltip').hidden=true;drag=null;hasDragged=false;
    const svg=$('svg');svg.replaceChildren(svgElement('title',{id:'snowmap-svg-title'}));svg.firstChild.textContent=`Gemiddeld aantal ${isSnowfall()?"sneeuwdagen":"sneeuwdekdagen"} per kalenderjaar, ${periodLabel()}, per KNMI-station`;
    svg.append(svgElement('rect',{width:geo.w,height:geo.h,fill:'#e8f3f8'}));
    const land=svgElement('g',{'aria-hidden':'true'});
    for(const country of geo.buren)land.append(svgElement('path',{d:country.d,fill:'#eceee7',stroke:'#d0d8d4','stroke-width':1}));
    land.append(svgElement('path',{d:geo.nl,fill:'#fafcfb',stroke:'#95aeba','stroke-width':1.6,'fill-rule':'evenodd'}));
    for(const province of geo.provincies)land.append(svgElement('path',{d:province.d,fill:'none',stroke:'#c5d2d9','stroke-width':1,'fill-rule':'evenodd'}));
    svg.append(land);markers=svgElement('g',{'aria-label':isSnowfall()?'KNMI-weerstations':'KNMI-neerslagstations'});svg.append(markers);
    const mapped=data.stations.filter(s=>s.lat!==null&&s.lon!==null).sort((a,b)=>Number(a.mean!==null)-Number(b.mean!==null)||a.id-b.id);
    for(const station of mapped){
      const [x,y]=point(station),group=svgElement('g',{class:'snowmap-marker',transform:`translate(${x} ${y})`,role:'button',tabindex:'-1','aria-pressed':'false','aria-label':`${station.name}, station ${station.id}: ${value(station)}`,'data-station':station.id});
      group.append(svgElement('circle',{r:11,class:'snowmap-hit'}),svgElement('circle',{r:isSnowfall()?8:5.5,fill:color(station.mean),class:'snowmap-dot'}));
      group.addEventListener('click',event=>{if(hasDragged)return;event.stopPropagation();choose(station.id);$('tooltip').hidden=true;});
      group.addEventListener('pointermove',event=>tooltip(event,station));group.addEventListener('pointerleave',()=>{$('tooltip').hidden=true;});
      group.addEventListener('keydown',event=>{
        if(event.key==='Enter'||event.key===' '){event.preventDefault();choose(station.id);}
        else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){
          event.preventDefault();const sorted=mapped.slice().sort((a,b)=>a.name.localeCompare(b.name,'nl'));
          const next=(sorted.findIndex(s=>s.id===station.id)+(event.key==='ArrowLeft'||event.key==='ArrowUp'?-1:1)+sorted.length)%sorted.length;choose(sorted[next].id,true);
        }
      });
      markerNodes.set(station.id,group);markers.append(group);
    }
    reset();
  }
  function renderTable(){
    const term=$('search').value.trim().toLocaleLowerCase('nl'),stations=data.stations.filter(s=>(s.name+' '+String(s.id).padStart(3,'0')).toLocaleLowerCase('nl').includes(term)).sort((a,b)=>a.name.localeCompare(b.name,'nl'));
    $('table').replaceChildren(...stations.map(station=>{const tr=element('tr'),cell=element('th'),button=element('button',station.name);cell.scope='row';button.type='button';button.className='snowmap-table-button';button.addEventListener('click',()=>{choose(station.id);$('details').scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});});cell.append(button);tr.append(element('td',String(station.id).padStart(3,'0')),cell,element('td',station.mean===null?missingLabel():number.format(station.mean)),element('td',isSnowfall()?periodLabel():station.years+' / 30'));return tr;}));
    $('table-count').textContent=stations.length+' stations';
  }
  async function loadPeriod(period){
    if(metric==='snowfall'?period!=='2003-2020':!coverPeriods.has(period))return;
    const key=metric+'/'+period,stem=(metric==='snowfall'?'sneeuwval':'sneeuwdek')+'-normalen-'+period;
    const request=++loadId,previousStation=selected?.id,previousMetric=data?.kind||'snowcover';
    section.dataset.state='loading';$('period').disabled=true;$('type-cover').disabled=true;$('type-fall').disabled=true;$('canvas').hidden=true;
    $('status').textContent=`Sneeuwkaart ${period.replace('-', '–')} laden…`;
    $('download').href=`winter-data/${stem}.csv`;
    try{
      if(!cache.has(key)){
        const response=await fetch(`winter-data/${stem}.json?v=20261119-3`);
        if(!response.ok)throw Error('Sneeuwdeknormalen niet bereikbaar.');
        cache.set(key,await response.json());
      }
      if(request!==loadId)return;
      data=cache.get(key);geo=data.geometry;
      const normals=data.stations.filter(s=>s.mean!==null),mapped=normals.filter(s=>s.lat!==null),unmapped=normals.length-mapped.length;
      $('title').textContent=isSnowfall()?'Waar sneeuwt het vaakst?':'Waar ligt het vaakst sneeuw?';
      $('explanation').textContent=isSnowfall()?'Een sneeuwdag is een dag met sneeuwval. Gekleurde punten tonen de officiële KNMI-jaarnormaal; donkerder blauw betekent meer sneeuwdagen.':'Elk gekleurd punt is een station met 30 volledige meetjaren. Donkerder blauw betekent meer sneeuwdekdagen.';
      $('cover-source').hidden=isSnowfall();$('cover-links').hidden=isSnowfall();$('fall-source').hidden=!isSnowfall();
      $('legend').setAttribute('aria-label',isSnowfall()?'Sneeuwdagen per jaar':'Sneeuwdekdagen per jaar');$('missing-label').textContent=missingLabel();$('table-coverage').textContent=isSnowfall()?'Meetperiode':'Volledige jaren';
      $('period-label').textContent=periodLabel();$('source-period').textContent=`1 januari ${data.period[0]} t/m 31 december ${data.period[1]}`;
      $('status').textContent=isSnowfall()?`${mapped.length} gepubliceerde jaarnormalen · sneeuwval 2003–2020. Grijs: geen jaarnormaal in de KNMI-tabel.`:`${mapped.length} stationnormalen op de kaart · ${periodLabel()}. Grijs: geen 30 volledige meetjaren.`+(unmapped?` Nog ${unmapped} volledige normalen zonder kaartpositie staan in de tabel.`:'');
      const groups=[[isSnowfall()?'Met KNMI-jaarnormaal':'Met volledige normaal',s=>s.mean!==null],[missingLabel(),s=>s.mean===null]];
      $('station').replaceChildren(...groups.map(([label,test])=>{const group=element('optgroup');group.label=label;for(const s of data.stations.filter(test).sort((a,b)=>a.name.localeCompare(b.name,'nl')))group.append(new Option(`${s.name} (${String(s.id).padStart(3,'0')})`,s.id));return group;}));
      $('canvas').hidden=false;renderMap();renderTable();
      const previous=previousMetric===metric?data.stations.find(s=>s.id===previousStation):data.stations.find(s=>s.name===selected?.name);
      choose(previous?.id||normals.find(s=>s.id===(isSnowfall()?260:550))?.id||normals[0].id);
      section.dataset.state='ready';
    }catch(error){
      if(request!==loadId)return;
      section.dataset.state='error';$('status').textContent='De sneeuwkaart kon niet worden geladen. De stationnormalen voor de gekozen periode blijven beschikbaar als CSV.';console.error(error);
    }finally{if(request===loadId){$('period').disabled=false;$('type-cover').disabled=false;$('type-fall').disabled=false;}}
  }
  function share(){
    const url=new URL(location.href);url.searchParams.set('sneeuwkaart',metric==='snowfall'?'sneeuwval':'sneeuwdek');url.searchParams.set('sneeuwperiode',$('period').value);history.replaceState(null,'',url);
  }
  function setMetric(next,updateURL=true){
    if(metric==='snowcover'&&coverPeriods.has($('period').value))coverPeriod=$('period').value;
    metric=next;
    $('type-cover').setAttribute('aria-pressed',String(metric==='snowcover'));$('type-fall').setAttribute('aria-pressed',String(metric==='snowfall'));
    $('period-caption').textContent=metric==='snowfall'?'Meetperiode sneeuwval':'Klimaatperiode';
    $('period').replaceChildren(...(metric==='snowfall'?[new Option('2003–2020 · KNMI-normaal','2003-2020')]:[new Option('1961–1990 · oud klimaat','1961-1990'),new Option('1991–2020 · recent klimaat','1991-2020')]));
    $('period').value=metric==='snowfall'?'2003-2020':coverPeriod;
    if(updateURL)share();loadPeriod($('period').value);
  }
  function init(){
    const svg=$('svg');
    svg.addEventListener('pointerdown',event=>{if(event.button!==0||event.pointerType==='touch'||event.target.closest('[data-station]'))return;hasDragged=false;drag={x:event.clientX,y:event.clientY,view:{...view}};svg.setPointerCapture(event.pointerId);});
    svg.addEventListener('pointermove',event=>{if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>5)hasDragged=true;const bounds=svg.getBoundingClientRect(),scale=Math.min(bounds.width/drag.view.w,bounds.height/drag.view.h);view.x=drag.view.x-dx/scale;view.y=drag.view.y-dy/scale;setView();});
    const end=()=>{drag=null;setTimeout(()=>{hasDragged=false;},0);};svg.addEventListener('pointerup',end);svg.addEventListener('pointercancel',end);
    $('station').disabled=false;$('station').addEventListener('change',()=>choose($('station').value));$('search').disabled=false;$('search').addEventListener('input',renderTable);
    $('zoom-in').addEventListener('click',()=>zoom(1.5));$('zoom-out').addEventListener('click',()=>zoom(1/1.5));$('reset').addEventListener('click',reset);$('reset').disabled=false;
    $('period').addEventListener('change',()=>{share();loadPeriod($('period').value);});
    $('type-cover').addEventListener('click',()=>setMetric('snowcover'));$('type-fall').addEventListener('click',()=>setMetric('snowfall'));
    const params=new URLSearchParams(location.search),requested=params.get('sneeuwperiode');
    if(coverPeriods.has(requested)){$('period').value=requested;coverPeriod=requested;}
    setMetric(params.get('sneeuwkaart')==='sneeuwval'?'snowfall':'snowcover',false);
  }
  if('IntersectionObserver'in window){const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();init();}},{rootMargin:'450px'});observer.observe(section);}else init();
})();
