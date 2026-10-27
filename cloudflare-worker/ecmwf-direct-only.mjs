import {nearestStation,publishedRuns} from '../pluim_ens6_data.mjs';
const ROOT='https://data.weerlab.nl/';
export async function noOpenMeteoFetch(input,options){const host=new URL(typeof input==='string'?input:input.url).hostname;if(host==='open-meteo.com'||host.endsWith('.open-meteo.com'))throw Error('Open-Meteo is uitgeschakeld; geen externe aanvraag');return fetch(input,options);}
async function read(path,fetcher){const r=await fetcher(ROOT+path);if(!r.ok)throw Error('Eigen ECMWF-archief niet beschikbaar');return r.json();}
export async function ecmwfDirect(url,metaOnly=false,fetcher=noOpenMeteoFetch){
 const q=url.searchParams,lat=Number(q.get('latitude')||52.101),lon=Number(q.get('longitude')||5.18),station=nearestStation(lat,lon);if(!station)throw Error('Geen eigen ECMWF-pluimpunt binnen 8 km; Open-Meteo staat uit');
 const manifest=await read('pluim_archive_meta.json',fetcher);const entries=publishedRuns(manifest).sort((a,b)=>Date.parse(b.run)-Date.parse(a.run));if(!entries.length)throw Error('Geen complete eigen ECMWF-run');
 const requested=q.get('run')||q.get('run_utc'),entry=requested?entries.find(e=>Date.parse(e.run)===Date.parse(requested)):entries[0];if(!entry)throw Error('Deze exacte ECMWF-run ontbreekt in het eigen archief');
 const archive=await read('pluim_trend_'+station.slug+'.json?revision='+encodeURIComponent(manifest.revision),fetcher),d=archive.runs?.find(r=>r.run===entry.run);
 if(!d||d.source?.provider!=='ECMWF Open Data'||!Array.isArray(d.times_ms)||d.members?.temperature_2m?.length!==51)throw Error('Eigen rechtstreekse ECMWF-bron onvolledig');
 const meta={last_run_initialisation_time:Date.parse(d.run)/1000,data_end_time:d.times_ms.at(-1)/1000,last_run_modification_time:Date.parse(d.fetched)/1000,last_run_availability_time:Date.parse(d.source.availability||d.fetched)/1000,temporal_resolution_seconds:3600};if(metaOnly)return meta;
 if(q.has('daily'))throw Error('Deze eigen ECMWF-route levert uurwaarden; geen betaalde dagaggregaten');
 const fields=(q.get('hourly')||'temperature_2m').split(',');const h={time:d.times_ms.map(t=>new Date(t).toISOString())},units={time:'iso8601'};
 for(const f of fields){const rows=d.members[f];if(!Array.isArray(rows)||rows.length!==51)throw Error('Veld ontbreekt in eigen ECMWF-archief: '+f);
 for(let i=0;i<51;i++){const key=f+(i?'_member'+String(i).padStart(2,'0'):'');if(rows[i].length!==h.time.length)throw Error('ECMWF-lid onvolledig');h[key]=rows[i].map(v=>v===null?null:f.startsWith('wind_')&&f!=='wind_direction_10m'&&q.get('wind_speed_unit')==='ms'?v/3.6:v);units[key]=f==='precipitation'?'mm':f.startsWith('wind_')?(f==='wind_direction_10m'?'°':q.get('wind_speed_unit')==='ms'?'m/s':'km/h'):f.startsWith('temperature_')||f==='dew_point_2m'?'°C':f.startsWith('cloud_')||f==='relative_humidity_2m'?'%':'';}}
 return {source:'ECMWF Open Data direct',run_utc:d.run,latitude:archive.lat,longitude:archive.lon,timezone:'UTC',hourly:h,hourly_units:units,member_ids:Array.from({length:51},(_,i)=>i),control_member:0,__weerlabRunMeta:meta};
}
