/* Immutable model-run archives: compare one valid time, never six valid hours. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.ZesluikRuns=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function selectedRuns(manifest){
    var map=new Map();
    (manifest.runs||[]).forEach(function(run){
      var ms=Date.parse(run.run_utc);
      if(!Number.isFinite(ms)||!/^runcompare\/[a-z0-9]+\/\d{8}T\d{4}Z\/meta\.json$/.test(run.meta_file||''))throw Error('Ongeldig runarchief');
      map.set(ms,run);
    });
    var times=Array.from(map.keys()).sort(function(a,b){return a-b;});
    if(!times.length)return Array(6).fill(null);
    // Select actual available runs. A skipped source cycle keeps its true
    // timestamp; never fabricate an hourly runtime from an update timestamp.
    var recent=times.slice(-6).map(function(ms){return map.get(ms);});
    return Array(6-recent.length).fill(null).concat(recent);
  }
  function frameRange(binary,step){
    if(!binary||![0,1,2].includes(binary.dtype)||!Number.isInteger(step)||step<0||step>=binary.n_steps||!(binary.step_bytes>0))throw Error('Ongeldige archiefstap');
    var start=16+step*binary.step_bytes;
    return {start:start,end:start+binary.step_bytes-1};
  }
  function frameBuffer(binary,payload){
    if(payload.byteLength!==binary.step_bytes)throw Error('Onvolledige archiefkaart');
    var out=new ArrayBuffer(16+payload.byteLength),view=new DataView(out);
    view.setUint16(0,binary.n_lat,true);view.setUint16(2,binary.n_lon,true);
    view.setUint16(4,1,true);view.setUint16(6,binary.components,true);view.setUint8(8,binary.dtype);
    new Uint8Array(out,16).set(new Uint8Array(payload));return out;
  }
  async function fetchFrame(baseURL,meta,key,time,fetcher){
    var info=meta.parameters[key],step=meta.tijden.findIndex(function(t){return Date.parse(t)===Date.parse(time);});
    if(!info||step<0)throw Error('Run bevat dit geldige uur niet');
    if(!/^runcompare\/[a-z0-9]+\/\d{8}T\d{4}Z\/[a-z]+\.bin$/.test(info.file||''))throw Error('Ongeldig archiefbestand');
    var range=frameRange(info.binary,step),request=fetcher||fetch;
    var response=await request(baseURL+info.file,{headers:{Range:'bytes='+range.start+'-'+range.end}});
    if(!response.ok)throw Error('HTTP '+response.status+' voor archiefkaart');
    var payload=await response.arrayBuffer();
    if(response.status===206){
      var contentRange=response.headers.get('Content-Range');
      if(contentRange&&!contentRange.startsWith('bytes '+range.start+'-'+range.end+'/'))throw Error('Afwijkend archiefbereik');
    }else if(response.status===200){
      if(payload.byteLength!==16+info.binary.n_steps*info.binary.step_bytes)throw Error('Onvolledig archiefbestand');
      payload=payload.slice(range.start,range.end+1);
    }else throw Error('Archiefserver ondersteunt dit bereik niet');
    return {buffer:frameBuffer(info.binary,payload),step:step,time:time};
  }
  return {selectedRuns:selectedRuns,frameRange:frameRange,frameBuffer:frameBuffer,fetchFrame:fetchFrame};
});
