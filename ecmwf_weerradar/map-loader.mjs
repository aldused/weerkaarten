// Start the public map and prefetch the latest model metadata.
function prefetchModelRun(){
  try{
    const saved=JSON.parse(localStorage.getItem('weerlab-ecmwf-runs-v2'));
    if([null,'ecmwf_ifs'].includes(new URLSearchParams(location.search).get('model'))&&(!saved||Date.now()<saved.savedAt||Date.now()-saved.savedAt>=300000)){
      window.weerlabLatest=fetch('https://weerlab-ecmwf-fields.dawn-term-a69f.workers.dev/data_spatial/ecmwf_ifs/latest.json',{cache:'no-cache',signal:AbortSignal.timeout(16000)}).then(r=>{if(!r.ok)throw new Error('ECMWF-modelinformatie niet bereikbaar');return r.json();});
      window.weerlabLatest.catch(()=>{});
    }
  }catch{}
}
prefetchModelRun();
await import(document.getElementById('app-loader').dataset.appSrc);
