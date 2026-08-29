/* Gedeelde, niet-functionele UI-afwerking voor Weerbewaking-documenteditors. */
(function(){
  function zetTekst(el, tekst){
    if(el && el.textContent.trim() !== tekst) el.textContent = tekst;
  }

  function standaardiseerKnoppen(root){
    root.querySelectorAll('button[onclick],a.btn').forEach(el=>{
      const actie=(el.getAttribute('onclick') || '') + ' ' + (el.getAttribute('href') || '');
      if(/zetNu\s*\(/.test(actie)) zetTekst(el,'Opgesteld: nu');
      else if(/herlaadTabel\s*\(/.test(actie)) zetTekst(el,'Tabel opnieuw instellen');
      else if(/refetchData\s*\(/.test(actie)) zetTekst(el,'Data bijwerken');
      else if(/exporteerPDF\s*\(|downloadPdf\s*\(/.test(actie)) zetTekst(el,'PDF maken');
      else if(/toggleInstellingen\s*\(/.test(actie)) zetTekst(el,'Opties');
      else if(/wisDraft\s*\(/.test(actie)) zetTekst(el,'Wissen');
      else if(/gaTerug\s*\(|weerbewaking\.html/.test(actie)) zetTekst(el,'Overzicht');
    });
  }

  function maakKop(omvatting, selector){
    const kop=omvatting.querySelector(selector);
    if(!kop) return;
    kop.classList.add('toolbar-heading');
    if(!kop.querySelector('.toolbar-eyebrow')){
      const label=document.createElement('div');
      label.className='toolbar-eyebrow';
      label.textContent='Documenteditor';
      kop.insertBefore(label,kop.firstChild);
    }
  }

  function syncOpties(toolbar){
    const knop=toolbar.querySelector('.btn-instellingen');
    if(knop) knop.setAttribute('aria-expanded', String(toolbar.classList.contains('instellingen-open')));
  }

  function init(){
    document.querySelectorAll('.toolbar').forEach(toolbar=>{
      maakKop(toolbar,'.toolbar-top > div:first-child');
      standaardiseerKnoppen(toolbar);
      syncOpties(toolbar);
      new MutationObserver(()=>syncOpties(toolbar)).observe(toolbar,{attributes:true,attributeFilter:['class']});
    });

    const header=document.querySelector('.header');
    if(header){
      maakKop(header,':scope > div:first-child');
      standaardiseerKnoppen(header);
    }
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
})();
