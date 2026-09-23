// Wissel tussen "Ensemble 6 pluim" en "Ensemble 6 pluim+" — zelfde plek en
// uitstraling op beide pagina's (rechts in de .wb-nav van weerbewaking_return.js).
(function(){
  const PAGINAS = [
    {key:'ens6',     hash:'#pluim-ens6',     file:'weerbewaking_pluim.html', label:'Ensemble 6 pluim'},
    {key:'ens6plus', hash:'#pluim-ens6plus', file:'pluim_6_plus.html',       label:'Ensemble 6 pluim+'},
  ];
  const huidig = PAGINAS.find(p => location.pathname.endsWith('/' + p.file) || location.pathname.endsWith(p.file)) || PAGINAS[0];

  function open(doel, event){
    if (event) event.preventDefault();
    try {
      if (window.self !== window.top) {
        // Pluimen-host met subtabs: dezelfde subtab openen als de knoppen bovenin.
        if (typeof window.parent.openPluim === 'function') { window.parent.openPluim(doel.key); return; }
        // Menu-shell (index.html) die dit product los inlaadt: via de shell-route.
        if (window.parent.document.getElementById('product-frame')) {
          window.parent.postMessage({type:'weerlab-navigate', hash:doel.hash}, location.origin);
          return;
        }
      }
    } catch (e) {}
    // Los geopend: zelfde plaats meenemen; runkeuze is per pagina verschillend.
    const params = new URLSearchParams(location.search);
    params.delete('run');
    location.assign(doel.file + (params.toString() ? '?' + params : ''));
  }

  function init(){
    if (document.querySelector('.pluim-wissel')) return;
    const wissel = document.createElement('div');
    wissel.className = 'pluim-wissel';
    wissel.setAttribute('role', 'group');
    wissel.setAttribute('aria-label', 'Kies pluim');
    for (const pagina of PAGINAS) {
      const a = document.createElement('a');
      a.href = pagina.file;
      a.textContent = pagina.label;
      if (pagina === huidig) a.setAttribute('aria-current', 'page');
      else a.addEventListener('click', event => open(pagina, event));
      wissel.appendChild(a);
    }
    const nav = document.querySelector('.wb-nav');
    if (nav) {
      nav.querySelector(':scope > span')?.remove();
      nav.appendChild(wissel);
      // Zelfde volgorde als de normale pluim: runbalk bovenaan, dan navigatie.
      const runbalk = document.querySelector('body > .run-selector');
      if (runbalk) runbalk.after(nav);
    } else {
      const eigen = document.createElement('nav');
      eigen.className = 'wb-nav';
      eigen.setAttribute('aria-label', 'Pluimen');
      eigen.appendChild(wissel);
      document.body.prepend(eigen);
    }
  }

  const css = document.createElement('style');
  css.textContent = `
    .wb-nav{flex-wrap:wrap}
    .pluim-wissel{display:inline-flex;margin-left:auto;border:1px solid #c5d3e3;border-radius:999px;background:#f0f4f8;padding:2px}
    .pluim-wissel a{padding:5px 12px!important;border-radius:999px;font-size:12px;font-weight:700;color:#2a4a70!important;text-decoration:none!important;white-space:nowrap}
    .pluim-wissel a:hover{background:#e4f1ff}
    .pluim-wissel a[aria-current=page]{background:#003366;color:#fff!important;cursor:default}
    @media(max-width:700px){.pluim-wissel{margin-left:0;width:100%}.pluim-wissel a{flex:1;text-align:center;min-height:36px;display:flex;align-items:center;justify-content:center}}
    @media print{.pluim-wissel{display:none!important}}`;
  document.head.appendChild(css);
  // Laden met defer ná weerbewaking_return.js, zodat de nav al bestaat.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();
