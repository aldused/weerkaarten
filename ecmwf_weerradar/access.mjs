// Session code gate, consistent with the other professional Weerlab tools.
// This is a browser-side entrance code, not server-side data authorization.
const CODE_HASH='bece13dde77280dac18052f8ff9d169a5dc27378646542ed69836c3926ac65d1';
const SESSION_KEY='weerlab-europakaart-access-v1';

export function installAccessGate(doc,storage,loadApp){
  const gate=doc.getElementById('access-gate'),app=doc.getElementById('app'),form=doc.getElementById('access-form'),input=doc.getElementById('access-code'),error=doc.getElementById('access-error'),button=doc.getElementById('access-submit');
  let busy=false,opened=false;
  async function unlock(){
    if(opened)return;
    opened=true;gate.hidden=true;app.hidden=false;
    try{await loadApp();}
    catch{opened=false;gate.hidden=false;app.hidden=true;error.textContent='De kaart kon niet worden geladen. Probeer het opnieuw.';}
  }
  const submit=async event=>{
    event.preventDefault();if(busy||opened)return;
    busy=true;button.disabled=true;error.textContent='';
    try{
      const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input.value.trim()));
      const hash=Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
      if(hash===CODE_HASH){
        try{storage?.setItem(SESSION_KEY,'1');}catch{}
        input.value='';await unlock();
      }else{error.textContent='Onjuiste toegangscode.';input.value='';input.focus();}
    }catch{error.textContent='De toegangscode kon niet worden gecontroleerd. Probeer het opnieuw.';}
    finally{busy=false;button.disabled=false;}
  };
  form.addEventListener('submit',submit);
  let remembered=false;try{remembered=storage?.getItem(SESSION_KEY)==='1';}catch{}
  return remembered?unlock():Promise.resolve();
}

// The model metadata is one small public file and the slowest first step.
// Fetching it while the code is still being typed removes that wait entirely;
// nothing personal is sent and no map data is requested before unlocking.
function prefetchModelRun(){
  try{
    const saved=JSON.parse(localStorage.getItem('weerlab-ecmwf-runs-v2'));
    if([null,'ecmwf_ifs'].includes(new URLSearchParams(location.search).get('model'))&&(!saved||Date.now()<saved.savedAt||Date.now()-saved.savedAt>=300000)){
      window.weerlabLatest=fetch('https://weerlab-ecmwf-fields.dawn-term-a69f.workers.dev/data_spatial/ecmwf_ifs/latest.json',{cache:'no-cache',signal:AbortSignal.timeout(16000)}).then(r=>{if(!r.ok)throw new Error('ECMWF-modelinformatie niet bereikbaar');return r.json();});
      window.weerlabLatest.catch(()=>{});
    }
  }catch{}
}
function startMap(){
  prefetchModelRun();
  return import(document.getElementById('app-loader').dataset.appSrc);
}
if(globalThis.document){
  let storage;try{storage=sessionStorage;}catch{}
  prefetchModelRun();
  installAccessGate(document,storage,startMap);
}
