(function(){
  function pad(value){ return String(value).padStart(2,'0'); }
  function todayISO(date=new Date()){
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
  }
  function slug(value, fallback='document'){
    return String(value || '').toLowerCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-')
      .replace(/^-|-$/g,'') || fallback;
  }
  function goHome(){
    if(window.self !== window.top){
      try{ window.parent.history.replaceState(null,'','#weerbewaking'); }catch(e){}
      window.location.replace('weerbewaking.html');
      return;
    }
    window.location.href='index.html#weerbewaking';
  }
  function parentRoute(route){
    if(window.self === window.top) return false;
    try{
      window.parent.history.replaceState(null,'',route ? '#weerbewaking-'+route : '#weerbewaking');
      return true;
    }catch(e){ return false; }
  }
  window.WBDocument={ todayISO, slug, goHome, parentRoute };
})();
