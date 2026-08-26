(function(){
  window.terugNaarWeerbewaking=function(event){
    if(event) event.preventDefault();
    if(window.self !== window.top){
      try{
        if(typeof window.parent.openWeerbewakingSubpage==='function'){
          window.parent.openWeerbewakingSubpage('home');
          return false;
        }
      }catch(e){}
      window.location.replace('weerbewaking.html');
      return false;
    }
    window.location.assign('index.html#weerbewaking');
    return false;
  };
})();
