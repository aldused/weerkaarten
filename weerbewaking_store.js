(function(){
  function readJSON(key, fallback=null){
    try{
      const value=localStorage.getItem(key);
      return value == null ? fallback : JSON.parse(value);
    }catch(e){ return fallback; }
  }
  function writeJSON(key, value){
    localStorage.setItem(key,JSON.stringify(value));
    return value;
  }
  function remove(key){ localStorage.removeItem(key); }
  function backup(key, backupKey){
    const value=localStorage.getItem(key);
    if(value != null) writeJSON(backupKey,{ts:Date.now(),data:value});
    return value;
  }
  function uniqueStrings(values){
    return [...new Set((Array.isArray(values)?values:[]).map(String).map(v=>v.trim()).filter(Boolean))];
  }
  window.WBStore={ readJSON, writeJSON, remove, backup, uniqueStrings };
})();
