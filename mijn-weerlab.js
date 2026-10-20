/* Personal data lives only in memory; the authenticated API owns persistence. */
window.MijnWeerlab=(()=>{
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let data=null,userId=null,products=[],status='loading',message='',busy=false,retry=null,refresh=()=>{},query='',adding=false,drag=null,generation=0,loading=false,pendingVisits=[];
  const api='/api/mijn-weerlab';
  const catalog=()=>new Map(products.map(p=>[p.id,p]));
  function clear(){generation++;loading=false;pendingVisits=[];data=null;userId=null;products=[];retry=null;busy=false;query='';adding=false;drag=null;status='error';message='Log opnieuw in om je persoonlijke omgeving te openen.';refresh();}
  async function request(path,options={}){
    const response=await fetch(api+path,{credentials:'same-origin',cache:'no-store',redirect:'manual',...options,headers:{'X-Weerlab-Request':'1',...options.headers},signal:AbortSignal.timeout(15000)});
    if(response.type==='opaqueredirect'||[301,302,303,307,308].includes(response.status)){clear();const error=Error('Je sessie is verlopen. Log opnieuw in.');error.session=true;throw error;}
    let result;try{result=await response.json();}catch{throw Error('Je sessie of de verbinding is onderbroken. Log zo nodig opnieuw in.');}
    if(response.status===401){clear();const error=Error(result.error);error.session=true;throw error;}
    if(!response.ok){const error=Error(result.error||'Opslaan mislukt. Probeer opnieuw.');error.conflict=response.status===409;error.validation=[400,413,415].includes(response.status);throw error;}
    return result;
  }
  async function load({initial=false}={}){
    if(busy||loading)return;const attempt=++generation;loading=true;status='loading';message='';refresh();
    try{
      const [account,list]=await Promise.all([request('/dashboard'),request('/catalog')]);
      if(attempt!==generation)return;
      if(userId&&userId!==account.userId)pendingVisits=[];
      data=account.dashboard;userId=account.userId;products=list.products;status='saved';retry=null;
      if(initial&&!location.hash&&data.preferences.start==='personal')history.replaceState(null,'','#menu/favorieten');
    }catch(error){if(attempt!==generation)return;status='error';message=error.message;retry=()=>load();}
    finally{if(attempt===generation){loading=false;refresh();flushVisits();}}
  }
  async function persist(next,path='/dashboard'){
    if(busy||loading||!data)return false;
    const owner=userId,revision=data.revision,attempt=generation;busy=true;status='saving';message='';retry=null;refresh();
    try{
      const result=await request(path,{method:path==='/import'?'POST':'PUT',headers:{'Content-Type':'application/json','If-Match':String(revision),'X-Expected-User':owner},body:JSON.stringify(next)});
      if(userId!==owner||attempt!==generation)return false;
      data=result.dashboard;status='saved';message=result.skipped?`${result.skipped} onbekende of dubbele producten overgeslagen.`:'';return true;
    }catch(error){
      if(userId!==owner||attempt!==generation)return false;
      status='error';message=error.message;
      if(!error.session&&!error.validation)retry=error.conflict?()=>load():()=>persist(next,path);
      return false;
    }finally{if(attempt===generation){busy=false;refresh();flushVisits();}}
  }
  function change(fn){if(!data||busy||loading||retry)return;const next=structuredClone(data);fn(next);if(!next.preferences.history)pendingVisits=[];return persist(next);}
  function flushVisits(){
    if(!data?.preferences.history||busy||loading||retry||!pendingVisits.length)return;
    const visits=pendingVisits;pendingVisits=[];
    return change(next=>{for(const id of visits)next.recent=[id,...next.recent.filter(x=>x!==id)].slice(0,5);});
  }
  function visit(id){
    if(!data?.preferences.history||!products.some(p=>p.id===id)||pendingVisits.at(-1)===id||!pendingVisits.length&&data.recent[0]===id)return;
    pendingVisits=[...pendingVisits.filter(x=>x!==id),id].slice(-5);return flushVisits();
  }
  const disabled=()=>busy||status==='loading'||!!retry&&!!data?' disabled':'';
  function options(current){return `<option value="">Niet ingedeeld</option>`+(data?.categories||[]).map(c=>`<option value="${esc(c.id)}" ${current===c.id?'selected':''}>${esc(c.name)}</option>`).join('');}
  function favorite(f){
    const p=catalog().get(f.productId),name=f.customName||p?.name||f.productId;
    return `<article class="mw-favorite" data-favorite="${esc(f.id)}"><div class="mw-card-head"><button class="mw-drag" type="button" draggable="true" data-drag="${esc(f.id)}" aria-label="Versleep ${esc(name)}"${disabled()}>⠿</button><button data-mw="remove" data-id="${esc(f.id)}" aria-label="${esc(name)} verwijderen" title="Verwijderen"${disabled()}>★</button></div>${p?.available?`<a class="mw-open" href="${esc(p.href)}"><strong>${esc(name)}</strong><small>${esc(p.section)}</small><span>Direct openen →</span></a>`:`<strong>${esc(name)}</strong><p>Dit product is momenteel niet beschikbaar. Je favoriet blijft bewaard.</p>`}<details><summary>Aanpassen</summary><label>Persoonlijke naam<input data-edit="name" data-id="${esc(f.id)}" value="${esc(f.customName)}" placeholder="${esc(p?.name||f.productId)}" maxlength="100"${disabled()}></label><button data-mw="reset" data-id="${esc(f.id)}"${disabled()}>Standaardnaam</button><label>Categorie<select data-edit="category" data-id="${esc(f.id)}"${disabled()}>${options(f.categoryId)}</select></label><div class="mw-order"><button data-mw="up" data-id="${esc(f.id)}" aria-label="${esc(name)} omhoog"${disabled()}>↑ Omhoog</button><button data-mw="down" data-id="${esc(f.id)}" aria-label="${esc(name)} omlaag"${disabled()}>↓ Omlaag</button></div><small>Oorspronkelijk: ${esc(p?.name||f.productId)}</small></details></article>`;
  }
  function savedPages(){return (data?.savedPages||[]).map(page=>{
    const product=page.productId?catalog().get(page.productId):null;
    const route=product?new URL(product.href,location.href).hash.slice(1):page.menuRoute;
    return {...page,url:route?new URL('index.html#'+route+(page.query?'?'+page.query:''),location.href).href:null};
  });}
  function pageReference(page){
    const url=new URL(page.url,location.href);if(url.origin!==location.origin)throw Error('Ongeldige paginaroute.');
    const [route,query='']=url.hash.slice(1).split(/\?(.*)/s);
    return {id:crypto.randomUUID(),title:page.title,productId:page.id||null,menuRoute:page.id?null:route,query:new URLSearchParams(query).toString()};
  }
  function togglePage(page){const next=pageReference(page);return change(n=>{
    n.savedPages??=[];const at=n.savedPages.findIndex(p=>p.productId===next.productId&&p.menuRoute===next.menuRoute&&p.query===next.query);
    if(at>=0)n.savedPages.splice(at,1);else n.savedPages.push(next);
  });}
  function html(){
    let out=`<header class="mw-header"><div><h1 tabindex="-1">Mijn Weerlab</h1><p>Jouw persoonlijke meteorologische werkplek</p></div><span class="mw-status" role="status">${status==='saved'?'✓ Opgeslagen':status==='saving'?'Bezig met opslaan…':status==='loading'?'Laden…':'Niet opgeslagen'}</span></header>`;
    if(message)out+=`<p class="mw-message" role="alert">${esc(message)} ${retry?'<button data-mw="retry">'+(message.includes('ander apparaat')?'Nieuwste versie laden':'Opnieuw proberen')+'</button>':''}${!userId?'<a href="/cdn-cgi/access/logout">Opnieuw inloggen</a>':''}</p>`;
    if(!data)return out+(status==='loading'?'<div class="mw-skeleton" aria-label="Dashboard wordt geladen"></div>':'<button data-mw="reload">Dashboard laden</button>');
    out+=`<div class="mw-toolbar"><label class="mw-search">Zoek in je favorieten<input id="mw-search" type="search" value="${esc(query)}" placeholder="Naam, categorie of omschrijving" autocomplete="off"></label><button data-mw="add"${disabled()}>+ Product toevoegen</button><button data-mw="view" data-view-value="cards" aria-pressed="${data.preferences.view==='cards'}"${disabled()}>Tegels</button><button data-mw="view" data-view-value="list" aria-pressed="${data.preferences.view==='list'}"${disabled()}>Lijst</button></div>`;
    if(!data.favorites.length)out+=`<section class="mw-welcome"><h2>Welkom bij Mijn Weerlab</h2><p>Voeg favorieten toe, geef ze een eigen naam en bepaal zelf de volgorde. Alles wordt automatisch bewaard, ook wanneer je later opnieuw inlogt.</p><button data-mw="add"${disabled()}>Mijn eerste favoriet toevoegen</button></section>`;
    if(adding)out+=`<section class="mw-discover"><h2>Product toevoegen</h2><button data-mw="close-add">Sluiten</button><label>Zoek een product<input id="mw-product-search" type="search" placeholder="Bijvoorbeeld ECMWF of neerslag"></label><label>Categorie voor nieuwe favorieten<select id="mw-add-category">${options(null)}</select></label><div id="mw-products">${productChoices('')}</div></section>`;
    const groups=[...data.categories,{id:null,name:'Niet ingedeeld'}],map=catalog();
    for(const group of groups){
      const found=data.favorites.filter(f=>f.categoryId===group.id).filter(f=>{const p=map.get(f.productId);return [f.customName,p?.name,p?.description,group.name].join(' ').toLocaleLowerCase('nl').includes(query.toLocaleLowerCase('nl'));});
      out+=`<section class="mw-group" data-drop-category="${esc(group.id||'')}"><div class="mw-group-title"><h2>${esc(group.name)}</h2><small>${found.length} favorieten</small>${group.id?`<details><summary>Categorie aanpassen</summary><label>Naam<input data-edit="group-name" data-id="${esc(group.id)}" value="${esc(group.name)}" maxlength="100"${disabled()}></label><button data-mw="group-up" data-id="${esc(group.id)}"${disabled()}>↑ Omhoog</button><button data-mw="group-down" data-id="${esc(group.id)}"${disabled()}>↓ Omlaag</button><label>Verplaats favorieten bij verwijderen naar<select id="mw-delete-${esc(group.id)}">${options(null)}</select></label><button data-mw="group-delete" data-id="${esc(group.id)}"${disabled()}>Categorie verwijderen</button></details>`:''}</div><div class="mw-items ${data.preferences.view==='list'?'mw-list':''}">${found.map(favorite).join('')}</div></section>`;
    }
    const pages=savedPages().filter(p=>[p.title,p.productId,p.menuRoute].join(' ').toLocaleLowerCase('nl').includes(query.toLocaleLowerCase('nl')));
    if(pages.length)out+=`<section class="mw-saved-pages"><h2>Bewaarde pagina’s en instellingen</h2><p>Directe links naar een specifieke pagina of productconfiguratie.</p>${pages.map(p=>`<div class="mw-product">${p.url?`<a href="${esc(p.url)}">${esc(p.title)}</a>`:`<span>${esc(p.title)} · Momenteel niet beschikbaar</span>`}<button data-mw="remove-page" data-id="${esc(p.id)}"${disabled()}>Verwijderen</button></div>`).join('')}</section>`;
    out+=`<form id="mw-new-group" class="mw-toolbar"><label>Nieuwe categorie<input name="name" required maxlength="100" placeholder="Bijvoorbeeld dagelijkse weerbewaking"${disabled()}></label><button${disabled()}>Categorie maken</button></form><details class="mw-settings"><summary>Voorkeuren en back-up</summary><label>Startpagina<select data-edit="start"${disabled()}><option value="general" ${data.preferences.start==='general'?'selected':''}>Algemeen overzicht</option><option value="personal" ${data.preferences.start==='personal'?'selected':''}>Mijn Weerlab</option></select></label><label><input type="checkbox" data-edit="history" ${data.preferences.history?'checked':''}${disabled()}> Laatst bekeken bewaren</label><button data-mw="clear-history"${disabled()}>Geschiedenis wissen</button><button data-mw="export"${disabled()}>Exporteer dashboard</button><label>Importeer dashboard (JSON)<input id="mw-import" type="file" accept="application/json,.json"${disabled()}></label><p>Import voegt toe; bestaande favorieten blijven behouden.</p></details>`;
    if(data.preferences.history&&data.recent.length)out+=`<section><h2>Laatst bekeken</h2><div class="mw-recents">${data.recent.map(id=>map.get(id)).filter(Boolean).map(p=>`<a href="${esc(p.href)}">${esc(p.name)}</a>`).join('')}</div></section>`;
    return out;
  }
  function productChoices(q){return products.filter(p=>[p.name,p.description,p.section].join(' ').toLocaleLowerCase('nl').includes(q.toLocaleLowerCase('nl'))).map(p=>`<div class="mw-product"><span><strong>${esc(p.name)}</strong><small>${esc(p.section)}${p.requiresProductGate?' · Eigen producttoegang blijft vereist':''}</small></span><button data-mw="choose" data-id="${esc(p.id)}" ${data.favorites.some(f=>f.productId===p.id)?'disabled':disabled()}>${data.favorites.some(f=>f.productId===p.id)?'Toegevoegd':'Toevoegen'}</button></div>`).join('');}
  function toggle(id,categoryId=null){if(!data||busy)return;if(!products.some(p=>p.id===id)){message='Dit product staat niet in de actuele productcatalogus.';refresh();return;}return change(next=>{const at=next.favorites.findIndex(f=>f.productId===id);if(at>=0)next.favorites.splice(at,1);else next.favorites.push({id:crypto.randomUUID(),productId:id,customName:'',categoryId});});}
  function move(id,targetId,categoryId){if(id===targetId&&data?.favorites.find(f=>f.id===id)?.categoryId===categoryId)return;return change(next=>{const at=next.favorites.findIndex(f=>f.id===id);if(at<0)return;const [item]=next.favorites.splice(at,1);item.categoryId=categoryId;const index=next.favorites.findIndex(f=>f.id===targetId);next.favorites.splice(index<0?next.favorites.length:index,0,item);});}
  document.addEventListener('click',event=>{
    const b=event.target.closest('[data-mw]');if(!b)return;
    const action=b.dataset.mw,id=b.dataset.id;
    if(action==='retry'){retry?.();return;}if(action==='reload'){load();return;}
    if(action==='add'||action==='close-add'){adding=action==='add';refresh();document.getElementById('mw-product-search')?.focus();return;}
    if(busy||!data)return;
    if(action==='choose'){toggle(id,document.getElementById('mw-add-category').value||null);return;}
    if(action==='view'){change(n=>n.preferences.view=b.dataset.viewValue);return;}
    if(action==='remove-page'){change(n=>n.savedPages=n.savedPages.filter(p=>p.id!==id));return;}
    if(action==='remove'){change(n=>n.favorites=n.favorites.filter(f=>f.id!==id));return;}
    if(action==='reset'){change(n=>n.favorites.find(f=>f.id===id).customName='');return;}
    if(action==='up'||action==='down'){
      const current=data.favorites.find(f=>f.id===id),peers=data.favorites.filter(f=>f.categoryId===current.categoryId),index=peers.indexOf(current),other=peers[index+(action==='up'?-1:1)];
      if(other)change(n=>{const a=n.favorites.findIndex(f=>f.id===id),b=n.favorites.findIndex(f=>f.id===other.id);[n.favorites[a],n.favorites[b]]=[n.favorites[b],n.favorites[a]];});return;
    }
    if(action==='group-delete'){const target=document.getElementById('mw-delete-'+id).value||null;if(target===id){message='Kies een andere categorie als bestemming.';refresh();return;}change(n=>{n.categories=n.categories.filter(c=>c.id!==id);n.favorites.forEach(f=>{if(f.categoryId===id)f.categoryId=target;});});return;}
    if(action==='group-up'||action==='group-down'){change(n=>{const at=n.categories.findIndex(c=>c.id===id),to=at+(action==='group-up'?-1:1);if(to>=0&&to<n.categories.length)[n.categories[at],n.categories[to]]=[n.categories[to],n.categories[at]];});return;}
    if(action==='clear-history'){change(n=>n.recent=[]);return;}
    if(action==='export'){const {revision,...exported}=data;const url=URL.createObjectURL(new Blob([JSON.stringify(exported,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='mijn-weerlab.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  });
  document.addEventListener('submit',event=>{if(event.target.id!=='mw-new-group')return;event.preventDefault();const name=new FormData(event.target).get('name').trim();if(name)change(n=>n.categories.push({id:crypto.randomUUID(),name}));});
  document.addEventListener('input',event=>{
    if(event.target.id==='mw-search'){query=event.target.value;const at=event.target.selectionStart;refresh();const input=document.getElementById('mw-search');input.focus();try{input.setSelectionRange(at,at);}catch{}}
    if(event.target.id==='mw-product-search')document.getElementById('mw-products').innerHTML=productChoices(event.target.value);
  });
  document.addEventListener('change',async event=>{
    const el=event.target,id=el.dataset.id;
    if(el.id==='mw-import'){
      const file=el.files[0],owner=userId,attempt=generation;if(!file)return;
      try{if(file.size>262144)throw Error('Bestand te groot (maximaal 256 kB).');const imported=JSON.parse(await file.text());if(owner!==userId||attempt!==generation)return;await persist(imported,'/import');}catch(error){if(owner!==userId||attempt!==generation)return;status='error';message=error.message;refresh();}return;
    }
    if(!el.dataset.edit)return;
    change(n=>{
      if(el.dataset.edit==='name')n.favorites.find(f=>f.id===id).customName=el.value;
      if(el.dataset.edit==='category')n.favorites.find(f=>f.id===id).categoryId=el.value||null;
      if(el.dataset.edit==='group-name')n.categories.find(c=>c.id===id).name=el.value;
      if(el.dataset.edit==='start')n.preferences.start=el.value;
      if(el.dataset.edit==='history'){n.preferences.history=el.checked;if(!el.checked)n.recent=[];}
    });
  });
  document.addEventListener('dragstart',event=>{const handle=event.target.closest('[data-drag]');if(!handle||busy||query)return;drag=handle.dataset.drag;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',drag);});
  document.addEventListener('dragover',event=>{if(drag&&event.target.closest('[data-drop-category]'))event.preventDefault();});
  document.addEventListener('drop',event=>{const group=event.target.closest('[data-drop-category]');if(!drag||!group)return;event.preventDefault();const id=drag;drag=null;move(id,event.target.closest('[data-favorite]')?.dataset.favorite,group.dataset.dropCategory||null);});
  document.addEventListener('dragend',()=>drag=null);
  let pointerDrag=null;
  document.addEventListener('pointerdown',event=>{
    const handle=event.target.closest('[data-drag]');if(!handle||busy||query||event.pointerType==='mouse')return;
    pointerDrag={id:handle.dataset.drag,x:event.clientX,y:event.clientY,moved:false};handle.setPointerCapture(event.pointerId);
  });
  document.addEventListener('pointermove',event=>{
    if(!pointerDrag)return;
    if(Math.hypot(event.clientX-pointerDrag.x,event.clientY-pointerDrag.y)>8)pointerDrag.moved=true;
    if(pointerDrag.moved){event.preventDefault();const edge=64;if(event.clientY<edge)window.scrollBy(0,-14);if(event.clientY>innerHeight-edge)window.scrollBy(0,14);}
  },{passive:false});
  document.addEventListener('pointerup',event=>{
    const source=pointerDrag;pointerDrag=null;if(!source?.moved)return;
    const target=document.elementFromPoint(event.clientX,event.clientY),group=target?.closest('[data-drop-category]');
    if(group)move(source.id,target.closest('[data-favorite]')?.dataset.favorite,group.dataset.dropCategory||null);
  });
  document.addEventListener('pointercancel',()=>pointerDrag=null);

  document.addEventListener('click',event=>{if(event.target.closest('a[href*="/cdn-cgi/access/logout"]'))clear();});
  window.addEventListener('pagehide',clear);
  window.addEventListener('pageshow',event=>{if(event.persisted)load();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!busy&&!(data&&retry))load();});
  return {html,toggle,togglePage,savedPages,loaded:()=>!!data,removePage(id){return change(n=>n.savedPages=n.savedPages.filter(p=>p.id!==id));},init(callback){refresh=callback;return load({initial:true});},ids:()=>data?.favorites.map(f=>f.productId)||[],ready:()=>!!data&&!busy&&!retry&&status!=='loading',error:()=>status==='error'?message:'',visit};
})();
