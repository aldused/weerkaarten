/* Krantconcepten blijven gekoppeld aan hun bron, editie en revisie. */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const ACCESS_HASH = 'cbdecc97d4791e60d96f893432c10727d4a01a258ae96b013eecf59826a93789';
  const ACCESS_KEY = 'weerlab.kranten.toegang.v1';
  const PAPER = {
    volkskrant: {name:'de Volkskrant', ids:['vk_kort','vk_lang'], delivery:'Beide teksten samen · vk-eindredactie@dpgmedia.nl'},
    trouw: {name:'Trouw', ids:['trouw'], delivery:'eindredactie@trouw.nl en foto@trouw.nl'},
    parool: {name:'Het Parool', ids:['parool'], delivery:'Inplannen via HQ · hq.buienradar.nl/content/parool'},
    ad: {name:'AD', ids:['ad'], delivery:'columnisten@dpgmedia.nl'}
  };
  const SPECS = {
    vk_kort: {label:'Voorpagina · kort', min:1, max:30, target:'max. 30', unit:'words', title:true},
    vk_lang: {label:'Weerpagina · lang', min:167, max:203, target:'rond 185', unit:'words', title:false},
    trouw: {label:'Weerpagina', min:900, max:1100, target:'rond 1.000', unit:'characters', title:true},
    parool: {label:'Landelijk weerbericht', min:90, max:110, target:'rond 100', unit:'words', title:true},
    ad: {label:'Landelijk weerbericht', min:90, max:110, target:'rond 100', unit:'words', title:true}
  };
  const clone = value => JSON.parse(JSON.stringify(value));
  const words = value => value.trim().split(/\s+/u).filter(Boolean).length;
  const measuredLength = (value,spec) => spec.unit==='characters' ? Array.from(value).length : words(value);
  const number = value => new Intl.NumberFormat('nl-NL').format(value);
  const unit = (spec,count) => spec.unit==='characters' ? 'karakters inclusief spaties' : count===1 ? 'woord' : 'woorden';
  const formatDate = value => new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',day:'numeric',month:'long',year:'numeric'}).format(new Date(value.length===10?value+'T12:00:00Z':value));
  const formatTime = value => new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',hour:'2-digit',minute:'2-digit'}).format(new Date(value)).replace(':','.');
  const today = () => new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  let data, base, pending, paper='volkskrant', dirty=false, busy=false, storageOK=true, checkStatus;
  let toastTimer;
  async function sha256(value) {
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
    return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  }
  function unlock() {
    try { sessionStorage.setItem(ACCESS_KEY,'1'); } catch {}
    document.body.classList.remove('locked');
    $('login-gate').hidden=true;
    load();
  }
  function lock() {
    try { sessionStorage.removeItem(ACCESS_KEY); } catch {}
    document.body.classList.add('locked');
    $('login-gate').hidden=false;
    $('login-password').value='';
    $('login-error').textContent='';
    $('login-password').focus();
  }
  function initAccess() {
    let unlocked=false;
    try { unlocked=sessionStorage.getItem(ACCESS_KEY)==='1'; } catch {}
    if(unlocked){unlock();return;}
    $('login-password').focus();
  }
  function toast(message) { $('toast').textContent=message; clearTimeout(toastTimer); toastTimer=setTimeout(()=>$('toast').textContent='',4500); }
  function storageKey() { return 'weerlab.kranten.demo.v1.'+data.publicationDate; }
  function readStored(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
  function save() {
    dirty = JSON.stringify([data.author,data.articles]) !== JSON.stringify([base.author,base.articles]);
    try { localStorage.setItem(storageKey(),JSON.stringify({data,base,dirty})); storageOK=true; }
    catch { storageOK=false; }
    $('save-status').textContent = !storageOK ? 'Bewaren in deze browser lukt niet. Download je tekst.' : dirty ? 'Eigen wijzigingen bewaard in deze browser.' : 'Bronconcept geladen. Wijzigingen worden in deze browser bewaard.';
  }
  function validPayload(value) {
    return value && typeof value.revision==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value.publicationDate) && /^\d{4}-\d{2}-\d{2}$/.test(value.sourceDate) &&
      typeof value.author==='string' && !isNaN(Date.parse(value.updatedAt)) && value.source && Array.isArray(value.source.paragraphs) && Array.isArray(value.usedParagraphs) &&
      Object.keys(SPECS).every(k=>typeof value.articles?.[k]?.title==='string' && typeof value.articles?.[k]?.body==='string');
  }
  function notice() {
    const messages=[];
    if (data.sourceDate!==today()) messages.push('Verouderde editie: deze concepten zijn geschreven op '+formatDate(data.sourceDate)+'. Wacht op een actuele versie voor aanlevering.');
    if (checkStatus?.ok===false) messages.push('Laatste broncontrole mislukt. De eerdere concepten zijn behouden. '+checkStatus.message);
    else if (checkStatus?.sourceId && checkStatus.sourceId!==data.sourceId) messages.push('Een nieuwere bron wacht op redactionele verwerking. Deze concepten horen nog bij de eerdere bron.');
    if (data.demoOnly) messages.push('Zaterdagdemo: de teksten tonen het weer voor zondag '+formatDate(data.publicationDate)+'. Er verschijnt geen zondagskrant; deze editie is uitsluitend een voorbeeld.');
    if (!messages.length) messages.push('Concept voor '+formatDate(data.publicationDate)+'. ‘Vandaag’ verwijst in de krant naar deze datum. Lees de teksten na vóór aanlevering.');
    $('alert').textContent=messages.join(' ');
    $('alert').className='notice'+(data.sourceDate!==today()||checkStatus?.ok===false?' error':data.demoOnly?'':' good');
    $('check-status').textContent=checkStatus ? 'Broncontrole: '+formatDate(checkStatus.checkedAt)+' · '+formatTime(checkStatus.checkedAt)+' uur'+(checkStatus.ok?'':' · mislukt') : 'Status van broncontrole niet beschikbaar';
  }
  function subject() { return 'Weerbericht voor '+formatDate(data.publicationDate)+' '+formatTime(data.updatedAt)+' uur door Buienradar'; }
  function renderMeta() {
    $('written-date').textContent=formatDate(data.sourceDate);
    $('publication-date').textContent=formatDate(data.publicationDate);
    $('updated').textContent=formatTime(data.updatedAt)+' uur';
    $('source-time').textContent='Buienradar · '+formatDate(data.source.publishedAt)+' · '+formatTime(data.source.publishedAt)+' uur';
    $('subject').textContent=subject();
    $('author').value=data.author;
    $('source-heading').textContent=data.source.title;
    $('source-text').replaceChildren(...data.usedParagraphs.map(i=>{const p=document.createElement('p');p.textContent=data.source.paragraphs[i];return p;}));
    $('pending').hidden=!pending;
    notice();
  }
  function issues(key) {
    const item=data.articles[key], spec=SPECS[key], count=measuredLength(item.body,spec), list=[];
    if (count<spec.min||count>spec.max) list.push(key==='vk_kort'?'Tekst moet 1–30 woorden bevatten.':'Richtlengte: '+number(spec.min)+'–'+number(spec.max)+' '+unit(spec,count)+'.');
    if (spec.title && (words(item.title)<1||words(item.title)>5)) list.push('Gebruik 1–5 titelwoorden.');
    if (!data.author.trim()) list.push('Vul de auteursnaam in.');
    if (!/^Vandaag\b/u.test(item.body.trim())) list.push('Begin bij ‘Vandaag’ vanuit de krantdatum.');
    if (key==='vk_kort'&&!/\bmorgen\b/iu.test(item.body)) list.push('Neem ook morgen op.');
    if (/\bovermorgen\b/iu.test(item.body)) list.push('Controleer de dag: gebruik een weekdag of de dagen erna.');
    if (!/[.!?]$/u.test(item.body.trim())) list.push('Sluit de tekst af met een leesteken.');
    if (/[,;:!?]{2,}|\S[ \t]+[,.;:!?]|[.!?][A-Za-zÀ-ÿ]/u.test(item.body)) list.push('Controleer dubbele leestekens en spaties.');
    return list;
  }
  function updateArticle(key) {
    const item=data.articles[key], spec=SPECS[key], list=issues(key);
    const count=measuredLength(item.body,spec), titleCount=words(item.title), over=count-spec.max, under=spec.min-count;
    const unitLabel=unit(spec,count), shortUnit=spec.unit==='characters'?'karakters':'woorden';
    const bodyCounter=$('count-'+key);
    bodyCounter.textContent=number(count)+' '+unitLabel+' · '+(over>0?number(over)+' te veel':spec.target);
    bodyCounter.classList.toggle('bad',under>0||over>0);
    const lengthStatus=$('length-status-'+key);
    lengthStatus.className='length-status'+(over>0?' over':under>0?' under':'');
    lengthStatus.textContent=over>0
      ? '⚠ '+number(over)+' '+shortUnit+' te veel'+(key==='vk_kort'?'':' boven de richtmarge')+'. Kort de tekst in tot maximaal '+number(spec.max)+' '+shortUnit+'.'
      : under>0
        ? 'Nog '+number(under)+' '+shortUnit+' nodig om '+number(spec.min)+' '+shortUnit+' te bereiken.'
        : '✓ Binnen de '+(key==='vk_kort'?'woordlimiet':'richtmarge')+' · nog '+number(spec.max-count)+' '+shortUnit+' ruimte tot '+number(spec.max)+'.';
    $('body-'+key).setAttribute('aria-invalid',String(over>0||under>0));
    if(spec.title){
      $('title-count-'+key).textContent=titleCount+' / 5 woorden'+(titleCount>5?' · '+(titleCount-5)+' te veel':'');
      $('title-count-'+key).className=titleCount>5?'title-over':'';
      $('title-'+key).setAttribute('aria-invalid',String(titleCount<1||titleCount>5));
      $('print-title-'+key).textContent=item.title;
    }
    $('issues-'+key).textContent=list.length?list.join(' '):'Lengte en basisleestekens akkoord · redactioneel concept';
    $('issues-'+key).className=list.length?'issues':'';
    $('byline-'+key).textContent=data.author;
    $('print-body-'+key).textContent=item.body;
    const area=$('body-'+key);area.style.height='auto';area.style.height=(area.scrollHeight+8)+'px';
  }
  function renderPaper() {
    const config=PAPER[paper];
    document.querySelectorAll('[data-paper]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.paper===paper)));
    $('paper-name').textContent=config.name;$('delivery').textContent=config.delivery;
    $('copy-paper').textContent=config.ids.length===2?'Kopieer beide teksten':'Kopieer bericht';
    $('articles').replaceChildren();
    for (const key of config.ids) {
      const spec=SPECS[key], item=data.articles[key], card=document.createElement('article');card.className='article';
      // Template contains only fixed internal IDs and labels; all source and editor text uses textContent/value.
      const titleField=spec.title?`<label class="field-label" for="title-${key}">Titel · maximaal 5 woorden <span id="title-count-${key}" role="status"></span></label><input id="title-${key}" class="title-input" aria-label="Titel ${spec.label}" aria-describedby="title-count-${key}" maxlength="180"><div id="print-title-${key}" class="print-copy title"></div>`:'';
      const rule=spec.unit==='characters'
        ? `Richtlengte: ${spec.target} karakters inclusief spaties · marge ${number(spec.min)}–${number(spec.max)}`
        : key==='vk_kort'?'Maximaal 30 woorden':`Richtlengte: ${spec.target} woorden · marge ${spec.min}–${spec.max}`;
      const explanation=spec.unit==='characters'?'Alle letters, leestekens en spaties in het bericht tellen mee. Titel en auteursnaam tellen niet mee.':'We tellen woorden. Titel en auteursnaam tellen niet mee.';
      card.innerHTML=`<div class="article-top"><h3>${spec.label}</h3><span id="count-${key}" class="counter"></span></div><div class="paper">${titleField}<label class="field-label" for="body-${key}">Bericht · klik om te redigeren</label><p id="word-rule-${key}" class="word-rule"><strong>${rule}</strong><span>${explanation}</span></p><textarea id="body-${key}" spellcheck="true" lang="nl" aria-label="Bericht ${spec.label}" aria-describedby="word-rule-${key} length-status-${key}"></textarea><p id="length-status-${key}" class="length-status" role="status" aria-atomic="true"></p><div id="print-body-${key}" class="print-copy"></div><p class="byline" id="byline-${key}"></p></div><div class="article-bottom"><p id="issues-${key}"></p><button type="button" data-copy="${key}">Kopieer tekst</button></div>`;
      $('articles').append(card);
      if(spec.title){$('title-'+key).value=item.title;$('title-'+key).addEventListener('input',event=>{data.articles[key].title=event.target.value;updateArticle(key);save();});}
      $('body-'+key).value=item.body;
      $('body-'+key).addEventListener('input',event=>{data.articles[key].body=event.target.value;updateArticle(key);save();});
      card.querySelector('[data-copy]').addEventListener('click',()=>copy(exportText([key],false)));
      updateArticle(key);
    }
    save();
  }
  function exportText(keys, includeSubject=true) {
    const warnings=[];
    if (data.demoOnly) warnings.push('DEMO — GEEN ZONDAGSKRANT');
    if (data.sourceDate!==today()) warnings.push('VEROUDERD CONCEPT — geschreven op '+formatDate(data.sourceDate));
    if (checkStatus?.ok===false || (checkStatus?.sourceId&&checkStatus.sourceId!==data.sourceId)) warnings.push('CONCEPT — controleer de actualiteit van de bron');
    if(keys.some(key=>issues(key).length)) warnings.push('CONCEPT — tekstcontrole bevat aandachtspunten');
    const parts=[...warnings];
    if(includeSubject) parts.push(subject());
    for(const key of keys) {
      if(keys.length>1) parts.push((key.startsWith('vk_')?'Volkskrant · ':PAPER[key]?.name+' · ')+SPECS[key].label);
      parts.push((SPECS[key].title?data.articles[key].title.trim()+'\n\n':'')+data.articles[key].body.trim()+'\n\n'+data.author.trim());
    }
    return parts.join('\n\n');
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text);toast('Gekopieerd.'); }
    catch { toast('Kopiëren is niet toegestaan in deze browser. Gebruik Download .txt.'); }
  }
  function download(text, filename) {
    const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));
    const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
  }
  async function getJson(path) {
    const response=await fetch(path+'?t='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw Error('HTTP '+response.status);
    return response.json();
  }
  async function load(manual=false) {
    if(busy)return;busy=true;$('refresh').disabled=true;
    try {
      const results=await Promise.allSettled([getJson('data/kranten_demo.json'),getJson('data/kranten_status.json')]);
      if(results[0].status==='rejected')throw results[0].reason;
      const incoming=results[0].value;
      if(!validPayload(incoming))throw Error('Ongeldige conceptgegevens');
      checkStatus=results[1].status==='fulfilled'?results[1].value:null;
      if(!data) {
        const local=readStored('weerlab.kranten.demo.v1.'+incoming.publicationDate);
        if(local?.dirty && validPayload(local.data) && validPayload(local.base)) {
          data=local.data;base=local.base;dirty=true;
          if(incoming.revision!==data.revision)pending=incoming;
        } else { data=clone(incoming);base=clone(incoming); }
        renderMeta();renderPaper();
      } else if(incoming.revision!==data.revision) {
        if(dirty){pending=incoming;$('pending').hidden=false;notice();}
        else {data=clone(incoming);base=clone(incoming);pending=null;renderMeta();renderPaper();}
      } else notice();
      if(manual)toast(pending?'Nieuwe concepten staan klaar; je eigen tekst is behouden.':'Laatste beschikbare concepten geladen.');
    } catch(error) {
      $('alert').className='notice error';
      $('alert').textContent=data?'Nieuwe concepten konden niet worden geladen. De getoonde versie en je eigen tekst zijn behouden.':'Concepten konden niet worden geladen. Open deze pagina via de lokale webserver en probeer Concepten verversen.';
      if(data){checkStatus={checkedAt:new Date().toISOString(),ok:false,message:'Conceptbestand kon niet worden opgehaald.'};}
    } finally {busy=false;$('refresh').disabled=false;}
  }
  document.querySelectorAll('[data-paper]').forEach(button=>button.addEventListener('click',()=>{if(!data)return;paper=button.dataset.paper;renderPaper();}));
  $('author').addEventListener('input',event=>{if(!data)return;data.author=event.target.value;PAPER[paper].ids.forEach(updateArticle);save();});
  $('copy-paper').addEventListener('click',()=>data&&copy(exportText(PAPER[paper].ids)));
  $('copy-subject').addEventListener('click',()=>data&&copy(subject()));
  $('download').addEventListener('click',()=>data&&download(exportText(PAPER[paper].ids),paper+'-'+data.publicationDate+'.txt'));
  $('print').addEventListener('click',()=>data&&window.print());
  $('refresh').addEventListener('click',()=>load(true));
  $('restore').addEventListener('click',()=>{
    if(!data)return;
    if(PAPER[paper].ids.some(key=>JSON.stringify(data.articles[key])!==JSON.stringify(base.articles[key])))download(exportText(PAPER[paper].ids),paper+'-'+data.publicationDate+'-eigen-tekst.txt');
    for(const key of PAPER[paper].ids)data.articles[key]=clone(base.articles[key]);
    renderPaper();toast('Bronconcept hersteld. Gewijzigde teksten zijn vooraf gedownload.');
  });
  $('load-new').addEventListener('click',()=>{
    if(!pending)return;
    download(exportText(Object.keys(SPECS)),'alle-eigen-teksten-'+data.publicationDate+'.txt');
    data=clone(pending);base=clone(pending);pending=null;dirty=false;renderMeta();renderPaper();toast('Nieuwe concepten geladen. Je vorige teksten zijn gedownload.');
  });
  window.addEventListener('resize',()=>{if(data)PAPER[paper].ids.forEach(updateArticle);});
  window.addEventListener('beforeprint',()=>{if(data){notice();PAPER[paper].ids.forEach(updateArticle);}});
  $('login-form').addEventListener('submit',async event=>{
    event.preventDefault();
    const input=$('login-password'), button=event.submitter;
    if(button)button.disabled=true;
    try {
      if(await sha256(input.value)===ACCESS_HASH){unlock();return;}
      $('login-error').textContent='Onjuist wachtwoord.';
      input.select();
    } finally {if(button)button.disabled=false;}
  });
  $('logout').addEventListener('click',lock);
  initAccess();setInterval(()=>{if(!document.body.classList.contains('locked'))load();},60000);
})();
