// Prefetch only the selected native ECMWF manifest, alongside the main bundle.
const model=new URLSearchParams(location.search).get('model')||'ecmwf_ifs';
if(['ecmwf_ifs','ecmwf_ifs01'].includes(model)){
 const resolution=model==='ecmwf_ifs01'?'0p1':'0p25';
 window.weerlabLatest=fetch(`https://weerlab-ifs-interactive.dawn-term-a69f.workers.dev/ifs-interactive/${resolution}/current.json`,{cache:'no-cache',signal:AbortSignal.timeout(10000)}).then(r=>{if(!r.ok)throw Error('ECMWF-modelinformatie niet bereikbaar');return r.json();});
 window.weerlabLatest.catch(()=>{});
}
await import(document.getElementById('app-loader').dataset.appSrc);
