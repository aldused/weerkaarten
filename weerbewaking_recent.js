/* Laatste twee formulieren per editor, naast de bestaande dagopslag. */
(function(){
  'use strict';
  const KEY='wb_recent_forms_v1';
  const types=[
    ['wb_wm_draft_','weerbewaking_rijnmond.html','Weerbewaking 5 dagen'],
    ['wb_uurlijks_draft_','weerbewaking_uurlijks.html','W.M. uurlijks'],
    ['wb_rrdk_draft_','weerbewaking_ridderkerk_rhoon_dekuip.html','Ridderkerk / Rhoon / De Kuip'],
    ['wb_gladheid_draft_','weerbewaking_gladheid.html','Gladheid'],
    ['wb_rr_draft_','weerbewaking_rr.html','Rijnmond kort'],
    ['wb_fey_draft_','weerbewaking_fey.html','Feyenoord'],
    ['vlag_draft_','vlaggenweer.html','Vlaggenweer']
  ];
  const file=location.pathname.split('/').pop();
  const current=types.find(t=>t[1]===file);
  let dirty=false, timer, failure='', selecting=false;
  function read(key, fallback=null){
    try{ return JSON.parse(localStorage.getItem(key)) ?? fallback; }catch(e){ return fallback; }
  }
  function entry(key, data){
    if(typeof key!=='string') return null;
    const type=types.find(t=>key.startsWith(t[0]));
    const date=type && key.slice(type[0].length, type[0].length+10);
    if(!type || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !data || typeof data!=='object' || Array.isArray(data) || !Number.isFinite(data.__ts)) return null;
    return {key,file:type[1],label:type[2],date,name:data.docNaam || data.plaats || type[2],ts:data.__ts,data};
  }
  function list(){
    const saved=read(KEY,[]);
    return Array.isArray(saved) ? saved.filter(e=>e && entry(e.key||'',e.data) && e.file===entry(e.key,e.data).file) : [];
  }
  function trim(items){
    const seen=new Set(), counts={};
    return items.sort((a,b)=>b.ts-a.ts).filter(e=>{
      if(seen.has(e.key) || (counts[e.file]||0)>=2) return false;
      seen.add(e.key); counts[e.file]=(counts[e.file]||0)+1; return true;
    });
  }
  function persist(items){
    try{ localStorage.setItem(KEY,JSON.stringify(trim(items))); failure=''; return true; }
    catch(e){ failure='Opslaan is niet gelukt. Laat dit formulier open en controleer de browseropslag.'; render(); return false; }
  }
  function migrate(){
    const items=list();
    try{
      for(let i=0;i<localStorage.length;i++){
        const key=localStorage.key(i);
        if(!types.some(t=>key.startsWith(t[0]))) continue;
        const e=entry(key,read(key));
        if(e && !items.some(old=>old.key===key)) items.push(e);
      }
      if(items.length) persist(items);
    }catch(e){ failure='Browseropslag is niet beschikbaar. Formulieren worden niet onthouden.'; }
  }
  function capture(key,data){
    if(!dirty) return;
    const e=entry(key,data);
    if(!e) return;
    if(typeof window.saveTabel==='function') window.saveTabel();
    if(typeof window.tabelSaveKey==='function'){
      e.tableKey=window.tabelSaveKey(); e.table=read(e.tableKey);
    }
    if(persist([e,...list().filter(old=>old.key!==key)])) dirty=false;
    render();
  }
  function flush(){
    clearTimeout(timer);
    if(dirty && typeof window.saveDraft==='function') window.saveDraft();
  }
  function startDate(fallback){
    const date=new URLSearchParams(location.search).get('datum');
    return /^\d{4}-\d{2}-\d{2}$/.test(date||'') && !Number.isNaN(Date.parse(date+'T12:00:00')) ? date : fallback;
  }
  function href(e){
    const params=new URLSearchParams({datum:e.date,'wb-recent':e.key});
    if(e.data.docNaam) params.set('doc',e.data.docNaam);
    if(e.file==='vlaggenweer.html') params.set('standalone','1');
    return e.file+'?'+params;
  }
  // Herstel vóór de editor initialiseert; de oorspronkelijke documentdatum blijft behouden.
  function prepare(){
    const key=new URLSearchParams(location.search).get('wb-recent');
    const e=list().find(item=>item.key===key && item.file===file);
    if(!e) return;
    try{
      const live=read(e.key);
      if(!live || (live.__ts||0)<e.ts) localStorage.setItem(e.key,JSON.stringify(e.data));
      if(e.tableKey && e.table && !localStorage.getItem(e.tableKey)) localStorage.setItem(e.tableKey,JSON.stringify(e.table));
      // De herstelactie is eenmalig: Wissen + herladen mag niet opnieuw herstellen.
      const params=new URLSearchParams(location.search); params.delete('wb-recent');
      history.replaceState(history.state,'',location.pathname+(params.size?'?'+params:'')+location.hash);
    }catch(err){ failure='Dit formulier kon niet uit de browseropslag worden hersteld.'; }
  }
  function render(){
    if(selecting) return;
    const host=document.getElementById('wb-recent');
    if(!host) return;
    const items=list().filter(e=>!current || e.file===file).slice(0,2);
    host.replaceChildren();
    const title=document.createElement('h2'); title.textContent='Laatste 2 formulieren'; host.append(title);
    const help=document.createElement('p'); help.className='wb-recent-help';
    help.textContent=failure || (current ? 'Automatisch bewaard in deze browser. Open een formulier om verder te schrijven.' : 'Ga verder met je laatst geschreven formulieren. Elke editor bewaart de laatste twee in deze browser.');
    if(failure) help.setAttribute('role','alert');
    host.append(help);
    const rows=document.createElement('div'); rows.className='wb-recent-list'; host.append(rows);
    if(!items.length){
      const empty=document.createElement('p'); empty.className='wb-recent-empty'; empty.textContent='Nog geen geschreven formulieren opgeslagen.'; rows.append(empty);
    }
    items.forEach(e=>{
      const a=document.createElement('a'); a.className='wb-recent-item'; a.href=href(e);
      const text=document.createElement('span');
      const name=document.createElement('strong'); name.textContent=e.name;
      const meta=document.createElement('small');
      meta.textContent=(e.name===e.label?'':e.label+' · ')+new Date(e.date+'T12:00:00').toLocaleDateString('nl-NL',{day:'numeric',month:'short',year:'numeric'})+' · opgeslagen '+new Date(e.ts).toLocaleString('nl-NL',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
      text.append(name,meta);
      const action=document.createElement('span'); action.className='wb-recent-open'; action.textContent='Openen →'; a.append(text,action);
      a.addEventListener('click',()=>flush()); rows.append(a);
    });
  }
  function init(){
    migrate();
    if(current && !document.getElementById('wb-recent')){
      const panel=document.createElement('section'); panel.id='wb-recent'; panel.className='wb-recent'; panel.setAttribute('aria-label','Laatst geschreven formulieren');
      const toolbar=document.querySelector('.toolbar,.header');
      if(toolbar) toolbar.after(panel);
    }
    render();
  }
  window.WBRecent={capture,flush,startDate,list,storageError(){failure='Opslaan is niet gelukt. Laat dit formulier open en controleer de browseropslag.';render();}};
  if(current){
    const mark=e=>{
      if(!e.target.closest?.('[data-save],.pagina [contenteditable="true"],.pagina input,.pagina select,.pagina textarea,#vlag-table input,#vlag-table select,#plaats-in,#doc-naam,#opgesteld-tijd,#doc-tijd')) return;
      dirty=true; clearTimeout(timer); timer=setTimeout(flush,400);
    };
    document.addEventListener('input',mark,true);
    document.addEventListener('change',mark,true);
    window.addEventListener('pagehide',flush);
    window.addEventListener('beforeunload',flush);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden') flush();});
  }
  window.addEventListener('storage',e=>{if(e.key===KEY) render();});
  // Blur slaat de tekst op vóór click. Behoud dan de aangeklikte link in de DOM.
  document.addEventListener('pointerdown',e=>{selecting=!!e.target.closest?.('.wb-recent-item');},true);
  function endSelection(){ if(selecting) setTimeout(()=>{selecting=false;render();},0); }
  document.addEventListener('pointerup',endSelection,true);
  document.addEventListener('pointercancel',endSelection,true);
  prepare();
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();
