(function(){
  window.terugNaarWeerbewaking=function(event){
    if(event) event.preventDefault();
    if(window.WBRecent) window.WBRecent.flush();
    if(window.self !== window.top){
      try{
        if(typeof window.parent.openWeerbewakingSubpage==='function'){
          window.parent.openWeerbewakingSubpage('home');
          window.parent.history.replaceState(null,'','#weerbewaking');
          return false;
        }
      }catch(e){}
      window.location.replace('weerbewaking.html');
      return false;
    }
    window.location.assign('index.html#weerbewaking');
    return false;
  };
  function init(){
    if(document.querySelector('.wb-nav')) return;
    // Eén vaste plek, ook voor hulpmiddelen die nog geen terugknop hadden.
    document.querySelectorAll('a,button').forEach(el=>{
      const action=el.getAttribute('onclick')||'';
      const href=el.getAttribute('href')||'';
      if(/\b(?:gaTerug|terugNaarWeerbewaking)\s*\(/.test(action) || /^(?:weerbewaking\.html|index\.html#weerbewaking)$/.test(href)){
        const parent=el.parentElement; el.remove();
        if(parent?.lastChild?.nodeType===3) parent.lastChild.textContent=parent.lastChild.textContent.replace(/\s*·\s*$/,'');
        if(parent?.tagName==='DIV' && !parent.children.length && !parent.textContent.trim()) parent.remove();
      }
    });
    const nav=document.createElement('nav'); nav.className='wb-nav'; nav.setAttribute('aria-label','Weerbewaking');
    const back=document.createElement('a'); back.href='weerbewaking.html'; back.textContent='← Terug naar overzicht'; back.addEventListener('click',window.terugNaarWeerbewaking);
    const label=document.createElement('span'); label.textContent='Weerbewaking';
    nav.append(back,label); document.body.prepend(nav);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
})();
