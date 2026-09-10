/* Existing product logic, presented inside the shared Weerlab shell. */
(() => {
  if (parent === window) return;
  let pending = false;
  function report() {
    if (pending) return;
    pending = true;
    queueMicrotask(() => {
      pending = false;
      document.body.classList.toggle('compact-vierluik', /^#weerkaarten-(vierluik|hires4|hires6|global4)$/.test(location.hash));
      parent.postMessage({type:'weerlab-product-route',hash:location.hash,title:document.getElementById('topbar-titel')?.textContent || 'Weerlab'}, location.protocol === 'file:' ? '*' : location.origin);
    });
  }
  for (const name of ['pushState','replaceState']) {
    const original = history[name].bind(history);
    history[name] = function(...args) { const result = original(...args); report(); return result; };
  }
  new MutationObserver(report).observe(document.getElementById('topbar-titel'), {childList:true,subtree:true,characterData:true});
  window.addEventListener('hashchange', report);
  function wireLinks(doc) {
    if (!doc || doc.documentElement.dataset.shellLinks) return;
    doc.documentElement.dataset.shellLinks='true';
    doc.addEventListener('keydown', event=>{
      const editing=event.target.matches?.('input,textarea,select,[contenteditable="true"]');
      if((event.key==='/'&&!editing&&!event.ctrlKey&&!event.metaKey)||((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k')){
        event.preventDefault();event.stopImmediatePropagation();
        parent.postMessage({type:'weerlab-focus-search'},location.protocol==='file:'?'*':location.origin);
      }
    },true);
    doc.addEventListener('click', event => {
      const a=event.target.closest?.('a[href]');
      if(!a || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button!==0)return;
      const url=new URL(a.href,doc.baseURI);
      if(url.origin!==location.origin || !/\/(?:index(?:\.html)?)?$/.test(url.pathname))return;
      event.preventDefault();
      parent.postMessage({type:'weerlab-product-route',hash:url.hash||'#home',title:'Weerlab'},location.protocol==='file:'?'*':location.origin);
      if(url.hash && !url.hash.startsWith('#menu/')) openHashRoute(url.hash);
    },true);
    doc.addEventListener('load', event=>{if(event.target.tagName==='IFRAME'){try{wireLinks(event.target.contentDocument);}catch{}}},true);
    doc.querySelectorAll('iframe').forEach(frame=>{try{wireLinks(frame.contentDocument);}catch{}});
  }
  // De kaart is twee iframes diep: geef beeldvullend door aan de buitenste pagina.
  window.addEventListener('message', event => {
    if(event.origin!==location.origin || event.source!==document.getElementById('wk-frame')?.contentWindow)return;
    if(event.data?.type==='weerlab-weerkaarten-focus')parent.postMessage(event.data,location.origin);
  });
  const style=document.createElement('style');
  style.textContent='body.compact-vierluik .content-scroll{padding:0!important;overflow:hidden}body.compact-vierluik #wk-facetten{display:none}body.compact-vierluik #wk-frame{display:block;height:100dvh!important}';
  document.head.appendChild(style);
  wireLinks(document);
  report();
})();
