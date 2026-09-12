/* Shared Weerlab navigation and product routing. */
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
  const site = window.WEERLAB_MENU_SITE || {};
  const selfPage = site.selfPage || 'index.html';
  const storagePrefix = site.storagePrefix || 'weerlab-menu-v9';
  const products = MENU_PRODUCTS;
  const byId = new Map(products.map(p => [p.id, p]));
  const categories = site.categories || {
    start:{name:'Overzicht',icon:'home'},
    nu:{name:'Nu',icon:'sun',title:'Het weer van dit moment',description:'Bekijk buien, satellietbeelden en de laatste metingen.',types:[['nu','Alles'],['beeld','Radar & satelliet'],['metingen','Metingen'],['water','Water & kust']]},
    verwachting:{name:'Verwachting',icon:'cloud',title:'Wat gaat het weer doen?',description:'Van de komende bui tot de verwachting voor volgende week.',types:[['kaarten','Weerkaarten'],['pluim','Pluimen & kansen'],['tekst','Weerbericht']]},
    terugkijken:{name:'Terugkijken',icon:'history',title:'Het weer in perspectief',description:'Bekijk eerdere metingen, weerrecords en klimaatgemiddelden.',types:[['terug','Maand & archief'],['klimaat','Records & klimaat']]},
    favorieten:{name:'Favorieten',icon:'star',title:'Jouw favorieten',description:'Alles wat je graag bij de hand houdt, op één plek.'},
    professioneel:{name:'Voor professionals',icon:'tools',title:'Voor professionals',description:'Verdieping, analyse en gereedschap voor de weerstudio.',types:[['vak','Alles'],['analyse','Analyse'],['tv','TV & uitzending'],['studio','Studio']]},
  };
  const typeNames=site.typeNames || {nu:'Nu',kaarten:'Weerkaarten',pluim:'Pluimen & kansen',tekst:'Weerbericht',terug:'Maand & archief',klimaat:'Records & klimaat',vak:'Voor professionals'};
  const filterSets=site.filterSets || {
    kaarten:[['veld','Weerelement'],['model','Model / bron'],['gebied','Gebied']],
    pluim:[['bron','Type verwachting'],['grootheid','Weerelement'],['vorm','Weergave']],
  };
  const productIcon = p => ({radar:'radar',neerslag:'water',temp:'thermometer',wind:'wind',bewolking:'cloud',sat:'cloud',bliksem:'lightning',vierluik:'grid',pluim:'chart',pluim6:'chart',pluimtrend:'chart',meteogram:'chart',tekst:'text',studio:'tools',water:'water',records:'chart',tabel:'list',skewt:'chart',kansen:'chart'})[p.icon] || 'map';
  function readStorage(key,fallback){try{return JSON.parse(localStorage.getItem(key)) ?? fallback;}catch{return fallback;}}
  const previous=site.storagePrefix?[]:readStorage('sb_favorieten',[]);
  const defaultFavorites=site.defaultFavorites || ['radar','significant','pluim-ens6'];
  const migrated=Array.isArray(previous)?previous.map(id=>products.find(p=>p.href==='index.html#'+id)?.id).filter(Boolean):[];
  let saved=readStorage(storagePrefix+'-favorites',migrated.length?migrated:defaultFavorites);
  let favorites=Array.isArray(saved)?[...new Set(saved.map(id=>id==='global4'?'hires4':id).filter(id=>byId.has(id)))]:defaultFavorites;
  let view=readStorage(storagePrefix+'-view','cards')==='list'?'list':'cards';
  let state={}, filterOpen=false, toastTimer, searchTimer, searchOrigin='#start';
  const main=$('#main'), search=$('#search'), dialog=$('#menu-dialog');
  function save(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
  function say(message,toast=false){$('#announcement').textContent=message;if(toast){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.add('visible');toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),2500);}}
  function routeUrl(page,type,filters={}){const q=new URLSearchParams();if(type)q.set('type',type);Object.entries(filters).forEach(([key,value])=>{if(value)q.set(key,value);});return '#menu/'+page+(q.size?'?'+q:'');}
  function readRoute(){
    const incoming=location.hash.slice(1);
    const raw=site.routeAliases?.[incoming] ?? incoming;
    const isMenu=!raw || raw.startsWith('menu/') || ['start','home','nu','terugkijken','favorieten','professioneel','zoeken',...(site.navItems || [])].includes(raw.split('?')[0]);
    if(!isMenu){
      const product=products.find(p=>new URL(p.href,location.href).hash==='#'+raw);
      if(site.directProducts && !product)return {page:'start',type:'',filters:{},q:''};
      return {page:product?.category || 'start',type:product?.type || '',filters:{},q:'',productRoute:raw,product};
    }
    const [path,query='']=raw.replace(/^menu\//,'').replace(/^home$/,'start').split('?');
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
    if(focus)(state.productRoute?$('#product-title'):main.querySelector('h1'))?.focus({preventScroll:true});
  }
  function navLink(id){const cat=categories[id];return `<a class="nav-link" href="#${id}" data-route="${id}" ${state.page===id?'aria-current="page"':''}>${icon(cat.icon)}<span>${cat.name}</span>${id==='favorieten'?`<span class="nav-count">${favorites.length}</span>`:''}</a>`;}
  function renderNav(){
    $('#desktop-nav').innerHTML=navLink('start')+'<div class="nav-label">Ontdek het weer</div>'+(site.navItems || ['nu','verwachting','terugkijken']).map(navLink).join('')+'<div class="nav-divider"></div>'+navLink('favorieten');
    $('.sidebar-bottom [data-route]')?.setAttribute('aria-current',state.page==='professioneel'?'page':'false');
    $('#mobile-nav').innerHTML=['start',...(site.navItems || ['nu','verwachting','terugkijken'])].map(id=>`<a href="#${id}" ${state.page===id?'aria-current="page"':''}>${icon(categories[id].icon)}<span>${categories[id].name}</span></a>`).join('')+`<button id="open-menu" aria-haspopup="dialog" aria-controls="menu-dialog" aria-expanded="${dialog.open}">${icon('menu')}<span>Menu</span></button>`;
    const extraLinks=site.extraLinks || [{href:'index.html#waarschuwingen',name:'Waarschuwingen',icon:'warning'},{href:'index.html#nieuws',name:'Wat is nieuw'},{href:'index_be.html',name:'Weer in België'},{href:'/cdn-cgi/access/logout',name:'Uitloggen'}];
    $('#dialog-nav').innerHTML=['start',...(site.navItems || ['nu','verwachting','terugkijken']),'favorieten',...(categories.professioneel?['professioneel']:[])].map(navLink).join('')+extraLinks.map(link=>`<a href="${escape(link.href)}" class="nav-link">${link.icon?icon(link.icon):''}${escape(link.name)}</a>`).join('');
  }
  function pin(p){const pinned=favorites.includes(p.id);return `<button class="pin-button" data-pin="${p.id}" aria-pressed="${pinned}" aria-label="${escape(p.name)} ${pinned?'verwijderen uit':'toevoegen aan'} favorieten" title="${pinned?'Verwijderen uit':'Toevoegen aan'} favorieten">${icon('star')}</button>`;}
  function productCard(p,{featured=false}={}){
    const quickNames={radar:['Radar & buien','Waar regent het nu?'],modelkaarten:['Weerkaarten','De komende uren en dagen'],'pluim-viewer':['Weerpluim','De verwachting voor jouw plaats'],actueel:['Waarnemingen','Het gemeten weer in Nederland']};
    const [name,description]=featured?(quickNames[p.id] || [p.name,p.description]):[p.name,p.description];
    const mapPlaceholder=p.type==='kaarten'&&!p.thumbnail;
    return `<article class="product-card ${p.thumbnail||mapPlaceholder?'':'no-image'}" data-product="${p.id}">${!p.thumbnail&&!mapPlaceholder?`<span class="product-icon">${icon(productIcon(p))}</span>`:''}<a class="card-link" href="${escape(p.href)}">${p.thumbnail?`<div class="card-image"><img src="${escape(p.thumbnail)}" alt="" loading="${featured?'eager':'lazy'}" decoding="async"></div>`:mapPlaceholder?`<div class="card-image map-placeholder" aria-hidden="true">${icon(productIcon(p))}<span>${p.facets.model?.includes('mosmix')?'DWD MOS/MIX':'Weerkaarten Europa'}</span></div>`:''}<div class="card-copy"><h3 class="card-title">${escape(name)}${icon('arrow')}</h3><p>${escape(description)}</p>${p.restricted?`<span class="product-meta">${icon('lock')}Afgeschermde tool</span>`:''}</div></a>${pin(p)}</article>`;
  }
  function productRow(p,context=false){return `<article class="product-row" data-product="${p.id}"><a class="row-link" href="${escape(p.href)}"><span class="row-icon">${icon(productIcon(p))}</span><span class="row-copy"><strong>${escape(p.name)}</strong><p>${escape(p.description)}</p>${context?`<span class="product-meta">${escape(typeNames[p.type])}</span>`:''}${p.restricted?`<span class="product-meta">${icon('lock')}Afgeschermde tool</span>`:''}</span>${icon('arrow','arrow')}</a>${pin(p)}</article>`;}
  function productCollection(list,mode=view,context=false){return `<div class="${mode==='cards'?'catalogue-grid':'product-list'}">${list.map(p=>mode==='cards'?productCard(p):productRow(p,context)).join('')}</div>`;}
  function heading(title,description,eyebrow){return `<div class="page-heading"><div>${eyebrow?`<div class="eyebrow">${escape(eyebrow)}</div>`:''}<h1 tabindex="-1">${escape(title)}</h1><p>${escape(description)}</p></div></div>`;}
  function favoriteChips(){return favorites.slice(0,4).map(id=>{const p=byId.get(id);return `<a class="favorite-chip" href="${escape(p.href)}">${escape(p.name)}${icon('chevron')}</a>`;}).join('');}
  function home(){
    const browse=site.browse || [
      {id:'nu',description:'Wat gebeurt er op dit moment?',links:[['radar','Radar & buien'],['satelliet','Satellietbeelden'],['actueel','Waarnemingen']]},
      {id:'verwachting',description:'Wat kun je de komende dagen verwachten?',links:[['#verwachting?type=kaarten','Weerkaarten'],['#verwachting?type=pluim','Pluimen & kansen'],['#verwachting?type=tekst','Weerbericht']]},
      {id:'terugkijken',description:'Hoe was het weer, en wat is normaal?',links:[['#terugkijken?type=terug','Maand & seizoen'],['archief','Archief metingen'],['#terugkijken?type=klimaat','Records & klimaat']]},
    ];
    return heading(site.homeTitle || 'Jouw weeroverzicht',site.homeDescription || 'Snel naar de kaarten, verwachtingen en metingen die je zoekt.',site.welcome || 'Welkom bij Weerlab')+
      `<section aria-labelledby="quick-title"><div class="section-heading"><h2 id="quick-title">Snel naar</h2><p>Direct naar je weerinformatie</p></div><div class="quick-grid">${(site.quickProducts || ['radar','modelkaarten','pluim-viewer','actueel']).map(id=>productCard(byId.get(id),{featured:true})).join('')}</div></section>
      <section class="home-favorites" aria-label="Jouw favorieten"><span class="favorites-label">${icon('star')}Jouw favorieten</span><div class="favorite-chips">${favorites.length?favoriteChips():'<span class="favorites-label">Bewaar een onderdeel met het sterretje.</span>'}</div><a class="quiet-link" href="#favorieten">${favorites.length>4?'Alle '+favorites.length:'Bekijken'}${icon('arrow')}</a></section>
      <section aria-labelledby="browse-title"><div class="section-heading"><h2 id="browse-title">Ontdek Weerlab</h2><p>Alles op een logische plek</p></div><div class="category-grid">${browse.map(c=>`<div class="category-block" data-category="${c.id}"><div class="category-title">${icon(categories[c.id].icon)}<h2>${categories[c.id].name}</h2></div><p>${c.description}</p><div class="category-links">${c.links.map(([id,label])=>`<a href="${escape(id.startsWith('#')?id:byId.get(id).href)}">${label}${icon('chevron')}</a>`).join('')}</div><a class="quiet-link" href="#${c.id}">Alles bekijken${icon('arrow')}</a></div>`).join('')}</div></section>`;
  }
  function isInType(p){
    if(p.category!==state.page)return false;
    if(!state.type)return true;
    const sections={beeld:'Beeld',metingen:'Metingen',water:'Water & kust',analyse:'Analyse',tv:'TV / uitzending',studio:'Studio (afgeschermd)'};
    return sections[state.type]?p.section===sections[state.type]:p.type===state.type || p.alsoTypes?.includes(state.type);
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
    const climate=state.page==='terugkijken' && state.type==='klimaat';
    const archive=state.page==='terugkijken' && state.type==='terug';
    const maps=!site.directProducts && state.page==='verwachting' && state.type==='kaarten';
    if(maps){const order={'mosmix-minikaarten':0,'mosmix-parameter':1,'mosmix-neerslagkans':2};result.sort((a,b)=>(order[a.id]??3)-(order[b.id]??3));}
    let html=heading(climate?'Records & klimaat':archive?'Maand & archief':cat.title,climate?'Van uitzonderlijk weer tot het langjarig gemiddelde. Kies wat je wilt onderzoeken.':archive?'Bekijk de maandbalans, volg het seizoen en zoek het weer van een eerdere dag terug.':cat.description,cat.name);
    if(cat.types)html+=`<nav class="subnav" aria-label="${cat.name}: onderwerpen">${cat.types.map(([type,name])=>`<a href="${routeUrl(state.page,type)}" ${state.type===type?'aria-current="page"':''}>${name}</a>`).join('')}</nav>`;
    if(climate)html+=`<aside class="climate-guide"><span>${icon('chart')}</span><div><strong>Het weer in context</strong><p>Records en metingen worden aangevuld zodra brondata beschikbaar zijn. Klimaatnormalen hebben de vaste referentieperiode <b>1991–2020</b>. De gegevensdatum staat bij het onderdeel.</p></div></aside>`;
    if(archive)html+=`<aside class="climate-guide"><span>${icon('chart')}</span><div><strong>Van dagkaart tot seizoensbalans</strong><p>Kies een landelijk overzicht of bekijk één station in detail. Bij elk onderdeel staan de meetperiode en de bron; recente dagen kunnen nog worden aangevuld.</p></div></aside>`;
    if(maps)html+=`<nav class="maps-shortcuts" aria-label="Snel naar weerkaarten"><a href="index.html#mosmix-minikaarten">${icon('map')}<span><strong>MOS/MIX Nederland</strong><small>9 dagen in één overzicht</small></span>${icon('arrow')}</a><a href="index.html#weerkaarten-modelkaarten">${icon('cloud')}<span><strong>Modelkaarten</strong><small>Uur voor uur vooruit</small></span>${icon('arrow')}</a><a href="index.html#weerkaarten-vierluik">${icon('grid')}<span><strong>Vergelijken</strong><small>Vier modellen of elementen</small></span>${icon('arrow')}</a></nav>`;
    html+=controls(result.length,{filters:!!filterSets[state.type]})+filterPanel(base);
    if(!result.length)return html+empty(state.page==='favorieten'?'Maak Weerlab een beetje van jou':'Geen onderdelen bij deze combinatie',state.page==='favorieten'?'Tik op het sterretje bij een onderdeel. Je favorieten worden in deze browser bewaard.':'Verwijder een filter om meer weerinformatie te zien.',state.page==='favorieten'?'<a class="button button-primary" href="#start">Ontdek Weerlab</a>':'<button class="button button-primary" data-reset-filters>Alle filters wissen</button>');
    if(maps){
      const groups=[['Nederland · MOS/MIX','Statistisch nabewerkte stationsverwachtingen. De kaartkleuren tussen stations zijn een ruimtelijke schatting.',p=>p.facets.model?.includes('mosmix')],['Nederland · modelkaarten','Gedetailleerde verwachtingen per uur. Vergelijk modellen én weerelementen.',p=>!p.facets.model?.includes('mosmix') && p.facets.gebied?.includes('nl')],['Europa · overzicht & scenario’s','Bekijk de grote lijn: luchtdruk, fronten, uitzonderlijk weer en onzekerheid.',p=>!p.facets.model?.includes('mosmix') && !p.facets.gebied?.includes('nl')]];
      html+=groups.map(([title,description,match])=>{const items=result.filter(match);return items.length?`<section class="catalogue-section maps-section"><h2>${title}</h2><p class="maps-section-intro">${description}</p>${productCollection(items)}</section>`:'';}).join('');
      html+='<p class="maps-footnote">Controleer in de kaart altijd de modelrun en geldige tijd. Voorbeeldafbeeldingen in dit overzicht zijn geen actuele weerkaarten.</p>';
    }else if(climate || archive || state.page==='nu' && state.type==='nu' || state.page==='professioneel' && state.type==='vak'){
      const secs=[...new Set(result.map(p=>p.section))];
      html+=secs.map(sec=>`<section class="catalogue-section"><h2>${escape(sec==='Beeld'?'Radar & satelliet':sec)}</h2>${productCollection(result.filter(p=>p.section===sec))}</section>`).join('');
    }else html+=productCollection(result);
    return html;
  }
  const normalize=value=>value.toLocaleLowerCase('nl').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/mos[\s/-]*mix/g,'mosmix').replace(/[^a-z0-9]+/g,' ').trim();
  const searchIndex=new Map(products.map(p=>[p.id,normalize(p.name+' '+p.description+' '+p.keywords+' '+typeNames[p.type]+' '+categories[p.category].name+' '+({radar:'regen buien neerslag',nowcast:'regen buien neerslag verwachting',satelliet:'wolken',bliksem:'onweer ontladingen',actueel:'actueel temperatuur stations vandaag',normalen:'klimaat normaal',droogte:'droogte neerslagtekort'}[p.id]||''))]));
  function findResults(q){
    const synonyms={regen:'neerslag',wolken:'bewolking',temperaturen:'temperatuur'};
    const terms=normalize(q).split(' ').filter(Boolean);
    return products.filter(p=>terms.every(term=>{const txt=searchIndex.get(p.id);return txt.includes(term) || !!synonyms[term]&&txt.includes(synonyms[term]);})).sort((a,b)=>Number(normalize(b.name).includes(normalize(q)))-Number(normalize(a.name).includes(normalize(q))));
  }
  function searchPage(){
    const q=state.q.trim();
    if(!q)return heading(site.searchTitle || 'Zoek in heel Weerlab','Zoek op een onderwerp, een weerelement of een model.','Zoeken')+`<div class="search-suggestions">${(site.searchSuggestions || ['Radar','Neerslag','ECMWF','Pluim','Weerrecords']).map(q=>`<a href="#zoeken?q=${encodeURIComponent(q)}">${q}</a>`).join('')}</div>`;
    const results=findResults(q);
    return heading(`Resultaten voor ‘${q}’`,`${results.length} ${results.length===1?'onderdeel':'onderdelen'} gevonden in ${site.searchScope || 'heel Weerlab'}.`,'Zoeken')+(results.length?productCollection(results,'list',true):empty('Geen resultaat gevonden','Probeer een kortere zoekterm, zoals regen, pluim of ECMWF.','<button class="button button-primary" data-clear-query>Opnieuw zoeken</button><a class="button" href="#start">Naar start</a>'));
  }
  function prefixMenuLinks(){
    document.querySelectorAll('a[href^="#"]').forEach(a=>{if(a.id==='product-permalink'||a.hash==='#main'||a.hash.startsWith('#menu/'))return;a.setAttribute('href','#menu/'+a.hash.slice(1));});
  }
  function render(){
    renderNav();
    const showingProduct=!!state.productRoute;
    document.body.classList.toggle('product-open',showingProduct);
    document.body.classList.remove('map-focus-open');
    setProductExpanded(false);
    document.body.classList.toggle('vierluik-open', showingProduct && /^weerkaarten-(vierluik|hires4|hires6|global4)$/.test(state.productRoute));
    main.hidden=showingProduct;
    $('#product-workspace').hidden=!showingProduct;
    if(showingProduct){renderProduct();prefixMenuLinks();return;}
    $('#product-frame').removeAttribute('src');
    $('#product-frame').dataset.route='';
    main.innerHTML=state.page==='start'?home():state.page==='zoeken'?searchPage():catalogue();
    if(search.value!==state.q)search.value=state.q;
    $('#clear-search').hidden=!search.value;
    $('.search-key').hidden=!!search.value;
    document.title=(state.page==='start'?'Jouw weeroverzicht':state.page==='zoeken'?'Zoeken':categories[state.page].name)+' · Weerlab';
    prefixMenuLinks();
    // Broken thumbnails degrade to the product icon without blocking navigation.
    main.querySelectorAll('.card-image img').forEach(img=>img.addEventListener('error',()=>{
      const p=byId.get(img.closest('[data-product]').dataset.product);
      img.parentElement.innerHTML=`<span class="image-fallback">${icon(productIcon(p))}</span>`;
    },{once:true}));
  }
  function toggleFavorite(id){
    const removing=favorites.includes(id);favorites=removing?favorites.filter(x=>x!==id):favorites.concat(id);
    const stored=save(storagePrefix+'-favorites',favorites);
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
  function closeDialog(){clearTimeout(searchTimer);dialog.close();document.body.style.overflow='';$('#open-menu')?.setAttribute('aria-expanded','false');}
  const mobileMenu = matchMedia('(max-width:760px)');
  const searchBox = $('.search-box');
  function placeSearch(){
    if(!mobileMenu.matches && dialog.open)closeDialog();
    (mobileMenu.matches?$('#dialog-search'):$('#sidebar-search')).appendChild(searchBox);
  }
  function showMenu(focusSearch=false){
    if(!dialog.open)dialog.showModal();
    document.body.style.overflow='hidden';
    $('#open-menu')?.setAttribute('aria-expanded','true');
    renderMenuSearch();
    (focusSearch?search:$('#close-menu')).focus();
  }
  function focusSearch(){
    setProductExpanded(false);
    if(document.body.classList.contains('map-focus-open')){
      document.body.classList.remove('map-focus-open');
      $('#product-frame').contentWindow?.postMessage({type:'weerlab-weerkaarten-focus-exit'},location.origin);
    }
    if(mobileMenu.matches)showMenu(true);
    search.focus();search.select();
  }
  function renderMenuSearch(){
    const q=search.value.trim(), results=$('#dialog-search-results');
    results.hidden=!q;$('#dialog-nav').hidden=!!q;
    if(!q){results.replaceChildren();return;}
    const matches=findResults(q);
    results.innerHTML=matches.slice(0,8).map(p=>`<a href="${escape(p.href)}">${escape(p.name)}<small>${escape(p.description)}</small></a>`).join('') || '<p>Geen resultaten. Probeer een andere zoekterm.</p>';
    if(matches.length>8)results.innerHTML+=`<a href="#menu/zoeken?q=${encodeURIComponent(q)}">Alle ${matches.length} resultaten bekijken</a>`;
  }
  function setProductExpanded(active){
    document.body.classList.toggle('product-expanded',active);
    const button=$('#product-expand');
    button.setAttribute('aria-pressed',String(active));
    button.setAttribute('aria-label',active?'Sluit beeldvullend':'Toon deze pagina beeldvullend');
    button.title=active?'Sluit beeldvullend (Escape)':'Beeldvullend';
    button.querySelector('.expand-label').textContent=active?'Sluiten':'Beeldvullend';
    button.firstElementChild.textContent=active?'✕':'⛶';
  }
  mobileMenu.addEventListener('change',placeSearch);
  placeSearch();
  new ResizeObserver(()=>{
    const height=$('#mobile-nav').getBoundingClientRect().height;
    // Bewaar de gemeten hoogte terwijl beeldvullend de navigatie tijdelijk verbergt.
    if(height)document.documentElement.style.setProperty('--mobile-nav-height',height+'px');
  }).observe($('#mobile-nav'));
  document.querySelectorAll('[data-icon]').forEach(el=>el.innerHTML=icon(el.dataset.icon));
  document.addEventListener('click',event=>{
    const pinButton=event.target.closest('[data-pin]');if(pinButton){toggleFavorite(pinButton.dataset.pin);return;}
    const viewButton=event.target.closest('[data-view]');if(viewButton){view=viewButton.dataset.view;save(storagePrefix+'-view',view);render();main.querySelector(`[data-view="${view}"]`).focus();say(view==='list'?'Lijstweergave':'Kaartweergave');return;}
    if(event.target.closest('#toggle-filters')){filterOpen=!filterOpen;$('#filters').hidden=!filterOpen;$('#toggle-filters').setAttribute('aria-expanded',String(filterOpen));return;}
    const removeFilter=event.target.closest('[data-remove-filter]');
    if(event.target.closest('[data-reset-filters]')||removeFilter){const next={...state.filters};if(removeFilter)delete next[removeFilter.dataset.removeFilter];else Object.keys(next).forEach(key=>delete next[key]);navigate(routeUrl(state.page,state.type,next),{keepScroll:true});$('#toggle-filters')?.focus();say('Filters bijgewerkt');return;}
    if(event.target.closest('#product-expand')){setProductExpanded(!document.body.classList.contains('product-expanded'));return;}
    if(event.target.closest('#open-menu')){showMenu();return;}
    if(event.target.closest('#close-menu')){closeDialog();return;}
    if(event.target.closest('[data-clear-query]') || event.target.closest('#clear-search')){clearTimeout(searchTimer);search.value='';if(dialog.open){renderMenuSearch();$('#clear-search').hidden=true;}else navigate(searchOrigin,{replace:true});search.focus();return;}
    const productLink=event.target.closest('a[href]');
    if(productLink && !event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey && event.button===0){
      const url=new URL(productLink.href,location.href);
      if(url.origin===location.origin && (site.selfPage?url.pathname===new URL(selfPage,location.href).pathname:/\/(?:index(?:\.html)?)?$/.test(url.pathname)) && url.hash && !url.hash.startsWith('#menu/')){
        event.preventDefault();if(dialog.open)closeDialog();navigate(url.hash,{focus:true});return;
      }
    }
    const link=event.target.closest('a[href^="#"]');
    if(link && !event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.altKey && event.button===0){
      if(link.hash==='#main'){event.preventDefault();(state.productRoute?$('#product-title'):main).focus();return;}
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
      if(dialog.open){renderMenuSearch();return;}
      if(state.page!=='zoeken')searchOrigin=location.hash||'#start';
      if(!q.trim()){navigate(searchOrigin,{replace:state.page==='zoeken',keepScroll:true});return;}
      navigate('#menu/zoeken?q='+encodeURIComponent(q),{replace:state.page==='zoeken',keepScroll:true});
      say(`${findResults(q).length} resultaten voor ${q}`);
    },160);
  });
  search.addEventListener('keydown',event=>{
    if(event.key==='ArrowDown'||event.key==='Enter'){
      event.preventDefault();clearTimeout(searchTimer);
      if(search.value.trim()){
        if(state.page!=='zoeken')searchOrigin=location.hash||'#start';
        if(dialog.open)closeDialog();
        navigate('#menu/zoeken?q='+encodeURIComponent(search.value.slice(0,180)),{replace:state.page==='zoeken',keepScroll:true});
        main.querySelector('.row-link')?.focus();
      }
    }
    if(event.key==='Escape'&&!dialog.open){event.preventDefault();clearTimeout(searchTimer);if(state.page==='zoeken'){search.value='';navigate(searchOrigin,{replace:true});search.focus();}else{search.value='';$('#clear-search').hidden=true;$('.search-key').hidden=false;search.blur();}}
  });
  document.addEventListener('keydown',event=>{
    if(dialog.open)return;
    if(event.key==='Escape' && document.body.classList.contains('product-expanded')){setProductExpanded(false);$('#product-expand').focus();return;}
    const editing=event.target.matches('input,textarea,select,[contenteditable="true"]');
    if(event.key==='/'&&!editing&&!event.ctrlKey&&!event.metaKey || (event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){
      event.preventDefault();focusSearch();
    }
  });
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeDialog();});
  dialog.addEventListener('keydown',event=>{
    if(event.key!=='Tab')return;
    const focusable=[...dialog.querySelectorAll('a[href],button:not(:disabled),input:not(:disabled)')].filter(el=>el.getClientRects().length);
    const first=focusable[0],last=focusable[focusable.length-1];
    if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
    else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
  });
  dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)closeDialog();}});
  window.addEventListener('popstate',()=>{clearTimeout(searchTimer);state=readRoute();filterOpen=false;render();});
  window.addEventListener('hashchange',()=>{if(location.hash==='#main')return;state=readRoute();filterOpen=false;render();});

  function renderProduct(){
    const route=state.productRoute;
    document.body.classList.toggle('vierluik-open', /^weerkaarten-(vierluik|hires4|hires6|global4)$/.test(route));
    const title=state.product?.name || 'Weerlab';
    $('#product-title').textContent=title;
    $('#product-permalink').href=selfPage+'#'+route;
    const category=categories[state.page]||categories.start;
    $('#product-back').href='#menu/'+state.page+(state.type?'?type='+state.type:'');
    $('#product-back').textContent='← '+category.name;
    const frame=$('#product-frame');
    frame.hidden=false;
    if(frame.dataset.route!==route){
      frame.dataset.route=route;
      frame.title=title;
      frame.src=state.product?.src || 'product-host.html?v=20260912-waarnemingen3#'+route;
    }
    search.value='';$('#clear-search').hidden=true;$('.search-key').hidden=false;
    document.title=title+' · Weerlab';
  }
  // Standalone Belgische producten delen de zoek- en Escape-sneltoetsen met het menu.
  if(site.directProducts)$('#product-frame').addEventListener('load',()=>{
    let doc;try{doc=$('#product-frame').contentDocument;}catch{return;}
    doc?.addEventListener('keydown',event=>{
      if(event.key==='Escape'){setProductExpanded(false);return;}
      const editing=event.target.matches('input,textarea,select,[contenteditable="true"]');
      if(event.key==='/'&&!editing&&!event.ctrlKey&&!event.metaKey || (event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){
        event.preventDefault();focusSearch();
      }
    });
  });
  window.addEventListener('message',event=>{
    const frame=$('#product-frame');
    if(event.source!==frame.contentWindow || (event.origin!==location.origin && !(location.protocol==='file:'&&event.origin==='null')))return;
    const data=event.data;
    if(data?.type==='weerlab-weerkaarten-focus'){document.body.classList.toggle('map-focus-open', Boolean(data.active));return;}
    if(data?.type==='weerlab-focus-search'){focusSearch();return;}
    if(data?.type==='weerlab-product-focus-exit'){setProductExpanded(false);return;}
    if(data?.type!=='weerlab-product-route'||typeof data.hash!=='string'||!/^#[a-z0-9_-]+$/i.test(data.hash))return;
    if(data.hash==='#home'){navigate('#menu/start');return;}
    if(data.hash!==location.hash){
      history.pushState(null,'',data.hash);
      frame.dataset.route=data.hash.slice(1);
      state=readRoute();renderNav();renderProduct();prefixMenuLinks();
      $('#product-permalink').href=selfPage+data.hash;
    }
    if(typeof data.title==='string'){$('#product-title').textContent=data.title;frame.title=data.title;document.title=data.title+' · Weerlab';}
  });

  state=readRoute();render();
})();
