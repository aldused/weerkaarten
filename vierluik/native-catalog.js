const NATIVE_MODELS={arome:{prefix:'arome-native',stem:'arome_native',label:'AROME HD 1.3'},ukv:{prefix:'ukv-native',stem:'ukv_native',label:'UKMO UKV 2 km'},
 gfs:{prefix:'gfs-native',stem:'gfs_native',liveRegional:true},
 iconeu:{prefix:'icon-eu-native',stem:'icon_eu_native',liveRegional:true}};
export async function nativeCatalog(key,signal){
 const config=NATIVE_MODELS[key];
 const response=await fetch('https://harmonie-data.weerlab.nl/'+config.stem+'_canvas_meta.json',{headers:{Accept:'application/json'},cache:'no-store',signal});
 if(!response.ok)throw Error('Native modelindex niet beschikbaar');
 const meta=await response.json(),stamp=Date.parse(meta.run_utc),g=meta.grid;
 if(!Number.isFinite(stamp)||!Array.isArray(meta.tijden)||!meta.tijden.length||meta.tijden.length>200||!g||g.n_lat<2||g.n_lon<2||g.n_lat*g.n_lon>1000000)throw Error('Ongeldige modelmetadata');
 const age=Date.now()-stamp;
 if(config.liveRegional&&(age< -3600000||age>24*3600000))throw Error('Modelrun is verouderd');
 const id=new Date(stamp).toISOString().replace(/[-:T]/g,'').slice(0,10),parameters={};
 for(const [name,info] of Object.entries(meta.parameters||{})){
  if(!new RegExp('^'+config.prefix+'/'+id+'/'+config.stem+'_data_[a-z0-9_]+\\.bin$').test(info.file||'')||![1,2,3].includes(info.components))continue;
  parameters[name]={file:info.file,components:info.components,scale:info.scale,power:info.power,grid:info.grid};
 }
 if(!parameters.temp||!parameters.wind)throw Error('Temperatuur of wind ontbreekt');
 const version=meta.source_checked_at||meta.bijgewerkt||meta.run_utc;
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({id,version,times:meta.tijden,parameters})));
 const hash=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,16);
 let last=-Infinity;
 const steps=meta.tijden.map((valid,index)=>{
  if(!/(Z|[+-]\d\d:\d\d)$/.test(valid))throw Error('Native brontijd mist tijdzone');
  const time=Date.parse(valid),lead=(time-stamp)/3600000;if(!Number.isInteger(lead)||lead<0||time<=last)throw Error('Ongeldige native geldigheid');last=time;
  return {lead,valid:new Date(time).toISOString(),nativeIndex:index,keys:['t2m','ws'],asset:key+'-'+id+'-'+hash+index.toString(16).padStart(4,'0')+'.json',gustPeriod:key==='gfs'?undefined:1};
 });
 return {schema:1,key,updated:String(version),grid:{lon0:1.7,lat0:54.3,dx:.025,dy:-.025,w:269,h:221},runs:[{id,time:new Date(stamp).toISOString(),enc:{},regional:true,steps,native:{key,version,meta:{grid:g,parameters,times:meta.tijden,source:meta.source,attribution:meta.attribution,temperatureHeight:meta.parameters.temp.height_m||2}}}]};
}
