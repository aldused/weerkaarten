const CLOUD_SOURCES={
 harmonie:{meta:'harmonie_canvas_meta.json',file:/^harmonie_data_bewolking\.bin$/},
 harmonie46:{meta:'harmonie46_canvas_meta.json',file:/^harmonie46_data_bewolking\.bin$/},
 icond2:{meta:'icond2_canvas_meta.json',file:/^icond2_data_bewolking\.bin$/},
 ecmwf:{meta:'ecmwf_native_canvas_meta.json',file:/^ecmwf-native\/\d{10}\/ecmwf_native_data_bewolking\.bin$/},
 arome:{meta:'arome_native_canvas_meta.json',file:/^arome-native\/\d{10}\/arome_native_data_bewolking\.bin$/},
 ukv:{meta:'ukv_native_canvas_meta.json',file:/^ukv-native\/\d{10}\/ukv_native_data_bewolking\.bin$/}
};
const CLOUD_BASE_FILES={
 harmonie:/^harmonie_data_wolkenbasis\.bin$/,
 harmonie46:/^harmonie46_data_wolkenbasis\.bin$/,
 icond2:/^icond2_data_wolkenbasis(?:_\d{10}_[a-f0-9]{12})?\.bin$/,
 ecmwf:/^ecmwf-native\/\d{10}\/ecmwf_(?:native_data_wolkenbasis|om_data_wolkenbasis_\d{10}_[a-f0-9]{12})\.bin$/,
 arome:/^arome-native\/\d{10}\/arome_native_data_wolkenbasis\.bin$/,
 ukv:/^ukv-native\/\d{10}\/ukv_native_data_wolkenbasis\.bin$/
};
function cloudFileAllowed(key,file){return !!(CLOUD_SOURCES[key]?.file.test(file)||CLOUD_BASE_FILES[key]?.test(file));}
export function cloudTime(value){
 if(typeof value!=='string')throw Error('Wolkentijd ontbreekt');
 if(/(Z|[+-]\d\d:\d\d)$/.test(value)){const t=Date.parse(value);if(!Number.isFinite(t))throw Error('Ongeldige wolkentijd');return t;}
 if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?$/.test(value))throw Error('Ongeldige lokale wolkentijd');
 // Regional metadata uses local Dutch time without an offset.
 const desired=Date.parse(value+'Z');let utc=desired;
 const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 for(let i=0;i<3;i++){const p=Object.fromEntries(fmt.formatToParts(new Date(utc)).map(p=>[p.type,p.value]));const local=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);const correction=desired-local;if(!correction)return utc;utc+=correction;}
 throw Error('Lokale wolkentijd bestaat niet');
}
export async function cloudCatalog(key,field='bewolking'){
 const config=CLOUD_SOURCES[key],base=field==='wolkenbasis';if(!config||!['bewolking','wolkenbasis'].includes(field))throw Error('Onbekend wolkenmodel of veld');
 const read=async()=>{const r=await fetch('https://harmonie-data.weerlab.nl/'+config.meta,{headers:{Accept:'application/json'},cache:'no-store'});if(!r.ok)throw Error('Wolkenindex niet beschikbaar');return r.json();};
 const meta=await read(),parentRun=Date.parse(meta.run_utc),g=meta.grid,info=meta.parameters?.[field];
 const run=base&&info?.source_run_utc?Date.parse(info.source_run_utc):parentRun;
 if(!Number.isFinite(run)||!Number.isFinite(parentRun)||!g||g.n_lat<2||g.n_lon<2||g.n_lat*g.n_lon>1000000||!Array.isArray(meta.tijden)||!meta.tijden.length||meta.tijden.length>200)throw Error('Ongeldige wolkenbron');
 if((!info&&!base)||(info&&(info.components!==(base?1:3)||!(base?CLOUD_BASE_FILES[key]?.test(info.file):config.file.test(info.file)))))throw Error('Ongeldig wolkenbestand');
 const id=new Date(run).toISOString().replace(/[-:T]/g,'').slice(0,10),parentId=new Date(parentRun).toISOString().replace(/[-:T]/g,'').slice(0,10);
 if(info?.file.includes('/')&&!info.file.includes('/'+parentId+'/'))throw Error('Wolkenbestand hoort bij andere run');
 let etag;
 if(info&&!info.file.includes('/')){
  const header=await fetch('https://harmonie-data.weerlab.nl/'+info.file,{method:'HEAD',cache:'no-store'});
  if(!header.ok){await header.body?.cancel();throw Error('Wolkenbestand niet beschikbaar');}
  etag=header.headers.get('ETag')?.replace(/^W\//,'');if(!etag)throw Error('Wolkenbron mist versie');
  const after=await read();if(JSON.stringify(after)!==JSON.stringify(meta))throw Error('Wolkenrun wijzigt tijdens het ophalen');
 }
 const parameter=info?{file:info.file,components:info.components,grid:info.grid,etag,kind:info.kind,label:info.label,clearSky:info.clear_sky_value,source:info.source,sourceHours:info.source_interval_hours}:null;
 const version=JSON.stringify({id,field,updated:meta.bijgewerkt,etag,times:meta.tijden,parameter});
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(version));
 const hash=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,16);
 let prior=-Infinity;
 const allSteps=meta.tijden.map((valid,index)=>{const t=cloudTime(valid),lead=(t-run)/3600000;if(!Number.isInteger(lead)||lead<0||t<=prior)throw Error('Wolkenuren lopen niet op');prior=t;return {lead,valid:new Date(t).toISOString(),nativeIndex:index,keys:[base?'cloudBase':'clouds'],asset:key+'-'+id+'-'+hash+index.toString(16).padStart(4,'0')+'.json'};});
 const end=Date.parse(info?.valid_until),steps=Number.isFinite(end)?allSteps.filter(s=>Date.parse(s.valid)<=end):allSteps;
 return {schema:1,key,updated:field+'-'+hash,grid:{lon0:1.7,lat0:54.3,dx:.025,dy:-.025,w:269,h:221},runs:[{id,time:new Date(run).toISOString(),enc:{},regional:true,steps,native:{key,version:hash,cloudOnly:true,cloudParameter:field,cloudWhole:!!info&&!info.file.includes('/'),meta:{grid:g,parameters:parameter?{[field]:parameter}:{},times:allSteps.map(s=>s.valid),source:meta.source,attribution:meta.attribution}}}]};
}
