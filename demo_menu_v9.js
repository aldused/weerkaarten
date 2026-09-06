/* Local menu concept. Native product links retain the existing site's routing and access checks. */
(() => {
  'use strict';
  const paths = {
    home:'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
    sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    cloud:'<path d="M7 18a5 5 0 1 1 1-9.9A6.5 6.5 0 0 1 20.5 11 3.5 3.5 0 0 1 20 18Z"/>',
    history:'<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-4v5l3 2"/>',
    star:'<path d="m12 3 2.8 5.7 6.3.9-4.55 4.4 1.1 6.2L12 17.3l-5.65 2.9 1.1-6.2L2.9 9.6l6.3-.9Z"/>',
    search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
    arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
    chevron:'<path d="m9 5 7 7-7 7"/>',
    close:'<path d="m6 6 12 12M6 18 18 6"/>',
    warning:'<path d="m12 3 10 18H2Z"/><path d="M12 9v5m0 3v.01"/>',
    tools:'<path d="M14.5 6.5a5 5 0 0 0-6.4 6.4L3 18a2.1 2.1 0 0 0 3 3l5.1-5.1a5 5 0 0 0 6.4-6.4L14 13l-3-3Z"/>',
    grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    list:'<path d="M9 6h12M9 12h12M9 18h12M3 6h1M3 12h1M3 18h1"/>',
    filter:'<path d="M3 6h5m4 0h9M3 18h11m4 0h3"/><circle cx="10" cy="6" r="2"/><circle cx="16" cy="18" r="2"/>',
    radar:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><path d="m12 12 6-6"/><circle cx="12" cy="12" r="1"/>',
    chart:'<path d="M3 3v18h18M6 15l4-6 4 4 6-8"/>',
    map:'<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Zm6-3v15m6-12v15"/>',
    text:'<path d="M6 3h9l4 4v14H6Z"/><path d="M14 3v5h5M9 12h7m-7 4h5"/>',
    water:'<path d="M12 3s-7 8-7 12a7 7 0 0 0 14 0c0-4-7-12-7-12Z"/>',
    lightning:'<path d="m13 2-9 12h7l-1 8 10-13h-8Z"/>',
    thermometer:'<path d="M9 14.8V5a3 3 0 0 1 6 0v9.8a5 5 0 1 1-6 0ZM12 10v7"/>',
    wind:'<path d="M3 8h12a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h5a3 3 0 1 1-3 3"/>',
    lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
    menu:'<path d="M4 6h16M4 12h16M4 18h16"/>',
  };
  const icon = (name, cls='') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name] || paths.map}</svg>`;
  const escape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const $ = selector => document.querySelector(selector);
  const products = MENU_PRODUCTS;
  const byId = new Map(products.map(p => [p.id, p]));
  const categories = {
    start:{name:'Start',icon:'home'},
    nu:{name:'Nu',icon:'sun',title:'Het weer van dit moment',description:'Bekijk buien, satellietbeelden en de laatste metingen.',types:[['nu','Alles'],['beeld','Radar & satelliet'],['metingen','Metingen'],['water','Water & kust']]},
    verwachting:{name:'Verwachting',icon:'cloud',title:'Wat gaat het weer doen?',description:'Van de komende bui tot de verwachting voor volgende week.',types:[['kaarten','Weerkaarten'],['pluim','Pluimen & kansen'],['tekst','Weerbericht']]},
    terugkijken:{name:'Terugkijken',icon:'history',title:'Het weer in perspectief',description:'Bekijk eerdere metingen, weerrecords en klimaatgemiddelden.',types:[['terug','Maand & archief'],['klimaat','Records & klimaat']]},
    favorieten:{name:'Favorieten',icon:'star',title:'Jouw favorieten',description:'Alles wat je graag bij de hand houdt, op één plek.'},
    professioneel:{name:'Voor professionals',icon:'tools',title:'Voor professionals',description:'Verdieping, analyse en gereedschap voor de weerstudio.',types:[['vak','Alles'],['analyse','Analyse'],['tv','TV & uitzending'],['studio','Studio']]},
  };
  const typeNames={nu:'Nu',kaarten:'Weerkaarten',pluim:'Pluimen & kansen',tekst:'Weerbericht',terug:'Maand & archief',klimaat:'Records & klimaat',vak:'Voor professionals'};
  const filterSets={
    kaarten:[['veld','Weerelement'],['model','Weermodel'],['gebied','Gebied']],
    pluim:[['bron','Type verwachting'],['grootheid','Weerelement'],['vorm','Weergave']],
  };
  const productIcon = p => ({radar:'radar',neerslag:'water',temp:'thermometer',wind:'wind',bewolking:'cloud',sat:'cloud',bliksem:'lightning',vierluik:'grid',pluim:'chart',pluim6:'chart',pluimtrend:'chart',meteogram:'chart',tekst:'text',studio:'tools',water:'water',records:'chart',tabel:'list',skewt:'chart',kansen:'chart'})[p.icon] || 'map';
  function readStorage(key,fallback){try{return JSON.parse(localStorage.getItem(key)) ?? fallback;}catch{return fallback;}}
  let saved=readStorage('weerlab-menu-v9-favorites',['radar','significant','pluim-ens6']);
  let favorites=Array.isArray(saved)?[...new Set(saved.filter(id=>byId.has(id)))]:['radar','significant','pluim-ens6'];
  let view=readStorage('weerlab-menu-v9-view','cards')==='list'?'list':'cards';
  let state={}, filterOpen=false, toastTimer, searchTimer, searchOrigin='#start';
  const main=$('#main'), search=$('#search'), dialog=$('#menu-dialog');
  function save(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
  function say(message,toast=false){$('#announcement').textContent=message;if(toast){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.add('visible');toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),2500);}}
  function routeUrl(page,type,filters={}){const q=new URLSearchParams();if(type)q.set('type',type);Object.entries(filters).forEach(([key,value])=>{if(value)q.set(key,value);});return '#'+page+(q.size?'?'+q:'');}
  function readRoute(){
    const [path,query='']=location.hash.slice(1).split('?');
    const params=new URLSearchParams(query);
    const aliases={kaarten:['verwachting','kaarten'],pluim:['verwachting','pluim'],tekst:['verwachting','tekst'],terug:['terugkijken','terug'],klimaat:['terugkijken','klimaat'],vak:['professioneel','vak']};
    const page=aliases[path]?.[0] || (categories[path]||path==='zoeken'?path:'start');
    const available=categories[page]?.types;
    const candidate=aliases[path]?.[1] || params.get('type');
    const type=available?.find(t=>t[0]===candidate)?.[0] || available?.[0][0] || '';
    const filters={};
    for(const [key] of filterSets[type]||[]){const val=params.get(key);if(val && Object.hasOwn(MENU_LABELS[key],val))filters[key]=val;}
    return {page,type,filters,q:page==='zoeken'?(params.get('q')||'').slice(0,180):''};
  }
  function navigate(hash,{replace=false,focus=false,keepScroll=false}={}){
    clearTimeout(searchTimer);
    if(location.hash!==hash) history[replace?'replaceState':'pushState'](null,'',hash);
    state=readRoute();render();
    if(!keepScroll)window.scrollTo({top:0,behavior:'instant'});
    if(focus)main.querySelector('h1')?.focus({preventScroll:true});
  }
  function navLink(id){const cat=categories[id];return `<a class="nav-link" href="#${id}" data-route="${id}" ${state.page===id?'aria-current="page"':''}>${icon(cat.icon)}<span>${cat.name}</span>${id==='favorieten'?`<span class="nav-count">${favorites.length}</span>`:''}</a>`;}
  function renderNav(){
    $('#desktop-nav').innerHTML=navLink('start')+'<div class="nav-label">Ontdek het weer</div>'+['nu','verwachting','terugkijken'].map(navLink).join('')+'<div class="nav-divider"></div>'+navLink('favorieten');
    $('.sidebar-bottom [data-route]').setAttribute('aria-current',state.page==='professioneel'?'page':'false');
    $('#mobile-nav').innerHTML=['start','nu','verwachting','terugkijken'].map(id=>`<a href="#${id}" ${state.page===id?'aria-current="page"':''}>${icon(categories[id].icon)}<span>${categories[id].name}</span></a>`).join('')+`<button id="open-menu" aria-haspopup="dialog" aria-controls="menu-dialog" aria-expanded="${dialog.open}">${icon('menu')}<span>Menu</span></button>`;
    $('#dialog-nav').innerHTML=['start','nu','verwachting','terugkijken','favorieten','professioneel'].map(navLink).join('')+`<a href="index.html#waarschuwingen" class="nav-link">${icon('warning')}Waarschuwingen</a>`;
  }
  function pin(p){const pinned=favorites.includes(p.id);return `<button class="pin-button" data-pin="${p.id}" aria-pressed="${pinned}" aria-label="${escape(p.name)} ${pinned?'verwijderen uit':'toevoegen aan'} favorieten" title="${pinned?'Verwijderen uit':'Toevoegen aan'} favorieten">${icon('star')}</button>`;}
  function productCard(p,{featured=false}={}){
    const quickNames={radar:['Radar & buien','Waar regent het nu?'],modelkaarten:['Weerkaarten','De komende uren en dagen'],'pluim-viewer':['Weerpluim','De verwachting voor jouw plaats'],actueel:['Waarnemingen','Het gemeten weer in Nederland']};
    const [name,description]=featured?quickNames[p.id]:[p.name,p.description];
    return `<article class="product-card ${p.thumbnail?'':'no-image'}" data-product="${p.id}">${!p.thumbnail?`<span class="product-icon">${icon(productIcon(p))}</span>`:''}<a class="card-link" href="${escape(p.href)}">${p.thumbnail?`<div class="card-image"><img src="${escape(p.thumbnail)}" alt="" loading="${featured?'eager':'lazy'}" decoding="async"></div>`:''}<div class="card-copy"><h3 class="card-title">${escape(name)}${icon('arrow')}</h3><p>${escape(description)}</p>${p.restricted?`<span class="product-meta">${icon('lock')}Afgeschermde tool</span>`:''}</div></a>${pin(p)}</article>`;
  }
  function productRow(p,context=false){return `<article class="product-row" data-product="${p.id}"><a class="row-link" href="${escape(p.href)}"><span class="row-icon">${icon(productIcon(p))}</span><span class="row-copy"><strong>${escape(p.name)}</strong><p>${escape(p.description)}</p>${context?`<span class="product-meta">${escape(typeNames[p.type])}</span>`:''}${p.restricted?`<span class="product-meta">${icon('lock')}Afgeschermde tool</span>`:''}</span>${icon('arrow','arrow')}</a>${pin(p)}</article>`;}
  function productCollection(list,mode=view,context=false){return `<div class="${mode==='cards'?'catalogue-grid':'product-list'}">${list.map(p=>mode==='cards'?productCard(p):productRow(p,context)).join('')}</div>`;}
  function heading(title,description,eyebrow){return `<div class="page-heading"><div>${eyebrow?`<div class="eyebrow">${escape(eyebrow)}</div>`:''}<h1 tabindex="-1">${escape(title)}</h1><p>${escape(description)}</p></div></div>`;}
  function favoriteChips(){return favorites.slice(0,4).map(id=>{const p=byId.get(id);return `<a class="favorite-chip" href="${escape(p.href)}">${escape(p.name)}${icon('chevron')}</a>`;}).join('');}
  function home(){
    const browse=[
      {id:'nu',description:'Wat gebeurt er op dit moment?',links:[['radar','Radar & buien'],['satelliet','Satellietbeelden'],['actueel','Waarnemingen']]},
      {id:'verwachting',description:'Wat kun je de komende dagen verwachten?',links:[['#verwachting?type=kaarten','Weerkaarten'],['#verwachting?type=pluim','Pluimen & kansen'],['#verwachting?type=tekst','Weerbericht']]},
      {id:'terugkijken',description:'Hoe was het weer, en wat is normaal?',links:[['#terugkijken?type=terug','Maand & seizoen'],['archief','Archief metingen'],['#terugkijken?type=klimaat','Records & klimaat']]},
    ];
    return heading('Jouw weeroverzicht','Snel naar de kaarten, verwachtingen en metingen die je zoekt.','Welkom bij Weerlab')+
      `<section aria-labelledby="quick-title"><div class="section-heading"><h2 id="quick-title">Snel naar</h2><p>Direct naar je weerinformatie</p></div><div class="quick-grid">${['radar','modelkaarten','pluim-viewer','actueel'].map(id=>productCard(byId.get(id),{featured:true})).join('')}</div></section>
      <section class="home-favorites" aria-label="Jouw favorieten"><span class="favorites-label">${icon('star')}Jouw favorieten</span><div class="favorite-chips">${favorites.length?favoriteChips():'<span class="favorites-label">Bewaar een onderdeel met het sterretje.</span>'}</div><a class="quiet-link" href="#favorieten">${favorites.length>4?'Alle '+favorites.length:'Bekijken'}${icon('arrow')}</a></section>
      <section aria-labelledby="browse-title"><div class="section-heading"><h2 id="browse-title">Ontdek Weerlab</h2><p>Alles op een logische plek</p></div><div class="category-grid">${browse.map(c=>`<div class="category-block" data-category="${c.id}"><div class="category-title">${icon(categories[c.id].icon)}<h2>${categories[c.id].name}</h2></div><p>${c.description}</p><div class="category-links">${c.links.map(([id,label])=>`<a href="${escape(id.startsWith('#')?id:byId.get(id).href)}">${label}${icon('chevron')}</a>`).join('')}</div><a class="quiet-link" href="#${c.id}">Alles bekijken${icon('arrow')}</a></div>`).join('')}</div></section>`;
  }
  function isInType(p){
    if(p.category!==state.page)return false;
    const sections={beeld:'Beeld',metingen:'Metingen',water:'Water & kust',analyse:'Analyse',tv:'TV / uitzending',studio:'Studio (afgeschermd)'};
    return sections[state.type]?p.section===sections[state.type]:p.type===state.type;
  }
  function matchesFilters(p,filters=state.filters){return Object.entries(filters).every(([key,value])=>p.facets[key]?.includes(value));}
  function controls(count,{filters=false}={}){
    const n=Object.keys(state.filters).length;
    return `<div class="catalogue-toolbar"><p>${count} ${count===1?'onderdeel':'onderdelen'}</p><div class="toolbar-actions">${filters?`<button class="button" id="toggle-filters" aria-expanded="${filterOpen}" aria-controls="filters">${icon('filter')}Verfijnen${n?' · '+n:''}</button>`:''}<div class="view-switch" role="group" aria-label="Weergave"><button data-view="cards" aria-label="Kaartweergave" title="Kaartweergave" aria-pressed="${view==='cards'}">${icon('grid')}</button><button data-view="list" aria-label="Lijstweergave" title="Lijstweergave" aria-pressed="${view==='list'}">${icon('list')}</button></div></div></div>`;
  }
  function filterPanel(base){
    const entries=filterSets[state.type];if(!entries)return '';
    const n=Object.keys(state.filters).length;
    return `<div class="filter-panel" id="filters" ${filterOpen?'':'hidden'}><p class="filter-intro">Welke weerinformatie zoek je?</p><div class="filter-fields">${entries.map(([key,label])=>{
      const values=Object.entries(MENU_LABELS[key]).filter(([value])=>base.some(p=>p.facets[key]?.includes(value)));
      return `<label for="filter-${key}">${label}<select id="filter-${key}" data-filter="${key}"><option value="">Alle ${key==='gebied'?'gebieden':key==='model'?'modellen':key==='veld'||key==='grootheid'?'weerelementen':'opties'}</option>${values.map(([value,name])=>{
        const other={...state.filters,[key]:value};const count=base.filter(p=>matchesFilters(p,other)).length;
        return `<option value="${value}" ${state.filters[key]===value?'selected':''} ${count===0 && state.filters[key]!==value?'disabled':''}>${escape(name)}${count===0?' · geen combinatie':''}</option>`;
      }).join('')}</select></label>`;
    }).join('')}</div><div class="filter-footer"><p>Toont de onderdelen waarin deze informatie beschikbaar is.</p><button class="button" data-reset-filters ${n?'':'disabled'}>Wis filters</button></div></div>${n?`<div class="active-filters" aria-label="Gekozen filters">${Object.entries(state.filters).map(([key,value])=>`<button class="filter-chip" data-remove-filter="${key}" aria-label="Filter ${escape(MENU_LABELS[key][value])} verwijderen">${escape(MENU_LABELS[key][value])}${icon('close')}</button>`).join('')}</div>`:''}`;
  }
  function empty(title,text,action){return `<div class="empty">${icon(state.page==='favorieten'?'star':'search')}<h2>${escape(title)}</h2><p>${escape(text)}</p><div class="empty-actions">${action}</div></div>`;}
  function catalogue(){
    const cat=categories[state.page];
    const base=state.page==='favorieten'?favorites.map(id=>byId.get(id)):products.filter(isInType);
    const result=base.filter(p=>matchesFilters(p));
    let html=heading(cat.title,cat.description,cat.name);
    if(cat.types)html+=`<nav class="subnav" aria-label="${cat.name}: onderwerpen">${cat.types.map(([type,name])=>`<a href="${routeUrl(state.page,type)}" ${state.type===type?'aria-current="page"':''}>${name}</a>`).join('')}</nav>`;
    html+=controls(result.length,{filters:!!filterSets[state.type]})+filterPanel(base);
    if(!result.length)return html+empty(state.page==='favorieten'?'Maak Weerlab een beetje van jou':'Geen onderdelen bij deze combinatie',state.page==='favorieten'?'Tik op het sterretje bij een onderdeel. Je favorieten worden in deze browser bewaard.':'Verwijder een filter om meer weerinformatie te zien.',state.page==='favorieten'?'<a class="button button-primary" href="#start">Ontdek Weerlab</a>':'<button class="button button-primary" data-reset-filters>Alle filters wissen</button>');
    if(state.page==='nu' && state.type==='nu' || state.page==='professioneel' && state.type==='vak'){
      const secs=[...new Set(result.map(p=>p.section))];
      html+=secs.map(sec=>`<section class="catalogue-section"><h2>${escape(sec==='Beeld'?'Radar & satelliet':sec)}</h2>${productCollection(result.filter(p=>p.section===sec))}</section>`).join('');
    }else html+=productCollection(result);
    return html;
  }
  const normalize=value=>value.toLocaleLowerCase('nl').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
  const searchIndex=new Map(products.map(p=>[p.id,normalize(p.name+' '+p.description+' '+p.keywords+' '+typeNames[p.type]+' '+categories[p.category].name+' '+({radar:'regen buien neerslag',nowcast:'regen buien neerslag verwachting',satelliet:'wolken',bliksem:'onweer ontladingen',actueel:'actueel temperatuur stations vandaag',normalen:'klimaat normaal',droogte:'droogte neerslagtekort'}[p.id]||''))]));
  function findResults(q){
    const synonyms={regen:'neerslag',wolken:'bewolking',temperaturen:'temperatuur'};
    const terms=normalize(q).split(' ').filter(Boolean);
    return products.filter(p=>terms.every(term=>{const txt=searchIndex.get(p.id);return txt.includes(term) || !!synonyms[term]&&txt.includes(synonyms[term]);})).sort((a,b)=>Number(normalize(b.name).includes(normalize(q)))-Number(normalize(a.name).includes(normalize(q))));
  }
  function searchPage(){
    const q=state.q.trim();
    if(!q)return heading('Zoek in heel Weerlab','Zoek op een onderwerp, een weerelement of een model.','Zoeken')+`<div class="search-suggestions">${['Radar','Neerslag','ECMWF','Pluim','Weerrecords'].map(q=>`<a href="#zoeken?q=${encodeURIComponent(q)}">${q}</a>`).join('')}</div>`;
    const results=findResults(q);
    return heading(`Resultaten voor ‘${q}’`,`${results.length} ${results.length===1?'onderdeel':'onderdelen'} gevonden in heel Weerlab.`,'Zoeken')+(results.length?productCollection(results,'list',true):empty('Geen resultaat gevonden','Probeer een kortere zoekterm, zoals regen, pluim of ECMWF.','<button class="button button-primary" data-clear-query>Opnieuw zoeken</button><a class="button" href="#start">Naar start</a>'));
  }
  function render(){
    renderNav();
    main.innerHTML=state.page==='start'?home():state.page==='zoeken'?searchPage():catalogue();
    if(search.value!==state.q)search.value=state.q;
    $('#clear-search').hidden=!search.value;
    $('.search-key').hidden=!!search.value;
    document.title=(state.page==='start'?'Jouw weeroverzicht':state.page==='zoeken'?'Zoeken':categories[state.page].name)+' · Weerlab';
    // Broken thumbnails degrade to the product icon without blocking navigation.
    main.querySelectorAll('.card-image img').forEach(img=>img.addEventListener('error',()=>{
      const p=byId.get(img.closest('[data-product]').dataset.product);
      img.parentElement.innerHTML=`<span class="image-fallback">${icon(productIcon(p))}</span>`;
    },{once:true}));
  }
  function toggleFavorite(id){
    const removing=favorites.includes(id);favorites=removing?favorites.filter(x=>x!==id):favorites.concat(id);
    const stored=save('weerlab-menu-v9-favorites',favorites);
    const focused=document.activeElement;
    const previousIndex=[...main.querySelectorAll('[data-pin]')].indexOf(focused);
    renderNav();
    document.querySelectorAll(`[data-pin="${id}"]`).forEach(button=>{button.setAttribute('aria-pressed',String(!removing));button.setAttribute('aria-label',byId.get(id).name+(!removing?' verwijderen uit':' toevoegen aan')+' favorieten');button.title=(!removing?'Verwijderen uit':'Toevoegen aan')+' favorieten';});
    if(state.page==='start'){
      $('.favorite-chips').innerHTML=favorites.length?favoriteChips():'<span class="favorites-label">Bewaar een onderdeel met het sterretje.</span>';
      $('.home-favorites>.quiet-link').innerHTML=(favorites.length>4?'Alle '+favorites.length:'Bekijken')+icon('arrow');
    }
    if(state.page==='favorieten'){
      render();const buttons=[...main.querySelectorAll('[data-pin]')];(buttons[Math.min(Math.max(previousIndex,0),buttons.length-1)] || main.querySelector('h1'))?.focus();
    }
    say(byId.get(id).name+(removing?' verwijderd uit favorieten':' toegevoegd aan favorieten')+(stored?'':'. Alleen voor deze sessie bewaard.'),true);
  }
  function closeDialog(){dialog.close();document.body.style.overflow='';$('#open-menu').setAttribute('aria-expanded','false');}
  document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
  document.addEventListener('click',event=>{
    const pinButton=event.target.closest('[data-pin]');if(pinButton){toggleFavorite(pinButton.dataset.pin);return;}
    const viewButton=event.target.closest('[data-view]');if(viewButton){view=viewButton.dataset.view;save('weerlab-menu-v9-view',view);render();main.querySelector(`[data-view="${view}"]`).focus();say(view==='list'?'Lijstweergave':'Kaartweergave');return;}
    if(event.target.closest('#toggle-filters')){filterOpen=!filterOpen;$('#filters').hidden=!filterOpen;$('#toggle-filters').setAttribute('aria-expanded',String(filterOpen));return;}
    const removeFilter=event.target.closest('[data-remove-filter]');
    if(event.target.closest('[data-reset-filters]')||removeFilter){const next={...state.filters};if(removeFilter)delete next[removeFilter.dataset.removeFilter];else Object.keys(next).forEach(key=>delete next[key]);navigate(routeUrl(state.page,state.type,next),{keepScroll:true});$('#toggle-filters')?.focus();say('Filters bijgewerkt');return;}
    if(event.target.closest('#open-menu')){dialog.showModal();document.body.style.overflow='hidden';$('#open-menu').setAttribute('aria-expanded','true');return;}
    if(event.target.closest('#close-menu')){closeDialog();return;}
    if(event.target.closest('[data-clear-query]') || event.target.closest('#clear-search')){search.value='';navigate(searchOrigin,{replace:true});search.focus();return;}
    const link=event.target.closest('a[href^="#"]');
    if(link && !event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey && event.button===0){
      if(link.hash==='#main'){event.preventDefault();main.focus();return;}
      event.preventDefault();if(dialog.open)closeDialog();filterOpen=false;navigate(link.hash,{focus:true});
    }
  });
  document.addEventListener('change',event=>{
    if(!event.target.matches('[data-filter]'))return;
    const key=event.target.dataset.filter,next={...state.filters};
    if(event.target.value)next[key]=event.target.value;else delete next[key];
    const focusId=event.target.id;
    navigate(routeUrl(state.page,state.type,next),{keepScroll:true});$('#'+focusId)?.focus({preventScroll:true});
    say(main.querySelector('.catalogue-toolbar>p').textContent+' bij deze filters');
  });
  search.addEventListener('input',()=>{
    clearTimeout(searchTimer);const q=search.value.slice(0,180);$('#clear-search').hidden=!q;$('.search-key').hidden=!!q;
    searchTimer=setTimeout(()=>{
      if(state.page!=='zoeken')searchOrigin=location.hash||'#start';
      if(!q.trim()){navigate(searchOrigin,{replace:state.page==='zoeken',keepScroll:true});return;}
      navigate('#zoeken?q='+encodeURIComponent(q),{replace:state.page==='zoeken',keepScroll:true});
      say(`${findResults(q).length} resultaten voor ${q}`);
    },160);
  });
  search.addEventListener('keydown',event=>{
    if(event.key==='ArrowDown'||event.key==='Enter'){
      event.preventDefault();clearTimeout(searchTimer);
      if(search.value.trim()){
        if(state.page!=='zoeken')searchOrigin=location.hash||'#start';
        navigate('#zoeken?q='+encodeURIComponent(search.value.slice(0,180)),{replace:state.page==='zoeken',keepScroll:true});
        main.querySelector('.row-link')?.focus();
      }
    }
    if(event.key==='Escape'&&!dialog.open){event.preventDefault();clearTimeout(searchTimer);if(state.page==='zoeken'){search.value='';navigate(searchOrigin,{replace:true});search.focus();}else{search.value='';$('#clear-search').hidden=true;$('.search-key').hidden=false;search.blur();}}
  });
  document.addEventListener('keydown',event=>{
    if(dialog.open)return;
    const editing=event.target.matches('input,textarea,select,[contenteditable="true"]');
    if(event.key==='/'&&!editing&&!event.ctrlKey&&!event.metaKey || (event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){
      event.preventDefault();search.focus();search.select();
    }
  });
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
  dialog.addEventListener('keydown',event=>{
    if(event.key!=='Tab')return;
    const focusable=[...dialog.querySelectorAll('a[href],button:not(:disabled)')].filter(el=>el.getClientRects().length);
    const first=focusable[0],last=focusable[focusable.length-1];
    if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
  });
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeDialog();}});
  window.addEventListener('popstate',()=>{clearTimeout(searchTimer);state=readRoute();filterOpen=false;render();});
  window.addEventListener('hashchange',()=>{if(location.hash==='#main')return;state=readRoute();filterOpen=false;render();});
  state=readRoute();render();
})();
