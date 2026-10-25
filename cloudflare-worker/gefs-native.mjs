/* GEFS is served from the native NOAA cache; no paid fallback. */
const ROOT='https://data.weerlab.nl/';
const ids=Array.from({length:31},(_,i)=>i);
function km(a,b){const r=x=>x*Math.PI/180,dlat=r(a.lat-b.lat),dlon=r(a.lon-b.lon);return 12742*Math.asin(Math.sqrt(Math.sin(dlat/2)**2+Math.cos(r(a.lat))*Math.cos(r(b.lat))*Math.sin(dlon/2)**2));}
export function nearest(stations,lat,lon){return stations.map(station=>({station,km:km(station,{lat,lon})})).sort((a,b)=>a.km-b.km)[0];}
async function read(url,fetcher){const r=await fetcher(url);if(!r.ok)throw Error('Eigen GEFS-bron nog niet beschikbaar');return r.json();}
export async function gefsEnsemble(url,fetcher=fetch){
 const q=url.searchParams,models=q.get('models')?.split(',').map(x=>x.trim());
 if(models?.length!==1||!['gfs_seamless','gfs025','gfs05'].includes(models[0]))throw Error('Vraag GEFS afzonderlijk op; geen betaalde ensembleterugval');
 const lat=Number(q.get('latitude')),lon=Number(q.get('longitude'));
 if(!q.has('latitude')||!q.has('longitude')||!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)throw Error('Eén geldige locatie vereist');
 if(q.has('daily'))throw Error('Gebruik de uurwaarden van het eigen GEFS-ensemble');
 const manifest=await read(ROOT+'gefs_manifest.json',fetcher);
 if(!manifest.complete||manifest.member_count!==31||JSON.stringify(manifest.member_ids)!==JSON.stringify(ids)||manifest.control_member!==0)throw Error('Eigen GEFS-ensemble onvolledig');
 const age=Date.now()-Date.parse(manifest.run_utc);if(!Number.isFinite(age)||age>24*3600000||age< -3600000)throw Error('Eigen GEFS-run verouderd');
 const near=nearest(manifest.stations,lat,lon);if(!near||near.km>50)throw Error('Geen eigen GEFS-pluimpunt binnen 50 km');
 const expected=ROOT+'gefs/'+manifest.run_key+'/'+near.station.id+'.json';if(near.station.url!==expected)throw Error('Ongeldig eigen bronpad');
 const data=await read(expected,fetcher);
 if(data.run_utc!==manifest.run_utc||JSON.stringify(data.member_ids)!==JSON.stringify(ids))throw Error('Eigen GEFS-run of leden wijken af');
 const aliases={windspeed_10m:'wind_speed_10m',windgusts_10m:'wind_gusts_10m',winddirection_10m:'wind_direction_10m',cloudcover:'cloud_cover',cloudcover_low:'cloud_cover_low',cloudcover_mid:'cloud_cover_mid',cloudcover_high:'cloud_cover_high',dewpoint_2m:'dew_point_2m',relativehumidity_2m:'relative_humidity_2m'};
 const fields=(q.get('hourly')||'temperature_2m').split(',').filter(Boolean);if(fields.some(f=>!manifest.fields.includes(aliases[f]||f)))throw Error('Element ontbreekt in eigen GEFS-bron');
 const h=data.hourly,time=h?.time;if(!Array.isArray(time)||time.length!==manifest.steps)throw Error('Eigen uurreeks onvolledig');
 // UTC ISO timestamps remain unambiguous during the wintertime transition.
 const out={time:[...time]},units={time:'iso8601'};
 for(const requested of fields){const f=aliases[requested]||requested;for(const id of ids){const suffix=id===0?'':'_member'+String(id).padStart(2,'0'),key=requested+suffix,a=h[f+suffix];if(!Array.isArray(a)||a.length!==time.length)throw Error('Ensemblelid ontbreekt');out[key]=a.map(v=>{
  if(v===null)return null;if(!Number.isFinite(v))throw Error('Ongeldige bronwaarde');
  if(f.startsWith('wind_')&&f!=='wind_direction_10m'){if(q.get('wind_speed_unit')==='ms')return v/3.6;if(q.get('wind_speed_unit')==='kn')return v/1.852;if(q.get('wind_speed_unit')==='mph')return v/1.609344;}
  if((f==='temperature_2m'||f==='dew_point_2m')&&q.get('temperature_unit')==='fahrenheit')return v*1.8+32;
  if(f==='precipitation'&&q.get('precipitation_unit')==='inch')return v/25.4;return v;
 });units[key]=f==='precipitation'?(q.get('precipitation_unit')==='inch'?'inch':'mm'):f.startsWith('wind_')&&f!=='wind_direction_10m'?({ms:'m/s',kn:'kn',mph:'mph'}[q.get('wind_speed_unit')]||'km/h'):data.units?.[f]||({'cloud_cover':'%','cloud_cover_low':'%','cloud_cover_mid':'%','cloud_cover_high':'%','relative_humidity_2m':'%','cape':'J/kg','lightning_potential':'J/kg','wind_direction_10m':'°','dew_point_2m':'°C'}[f]||'');if((f==='temperature_2m'||f==='dew_point_2m')&&q.get('temperature_unit')==='fahrenheit')units[key]='°F';}}
 return {latitude:data.latitude,longitude:data.longitude,timezone:'UTC',timezone_abbreviation:'UTC',utc_offset_seconds:0,hourly:out,hourly_units:units,member_ids:ids,control_member:0,source:'NOAA Open Data direct',model:'NOAA GEFS',run_utc:data.run_utc,sampled_point:near.station.name,sampled_distance_km:near.km,__weerlabRunMeta:{last_run_initialisation_time:Date.parse(data.run_utc)/1000,data_end_time:Date.parse(time.at(-1))/1000}};
}
