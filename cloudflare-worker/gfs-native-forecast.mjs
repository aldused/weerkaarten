/* Regional Weerlab point forecasts from the native GFS map data. No paid fallback. */
const specs={temperature_2m:['temp',0,'°C'],dew_point_2m:['dauwpunt',0,'°C'],relative_humidity_2m:['rv',0,'%'],pressure_msl:['druk',0,'hPa'],precipitation:['neerslag',0,'mm'],cloud_cover:['cloud_total',0,'%'],cloud_cover_low:['bewolking',2,'%'],cloud_cover_mid:['bewolking',1,'%'],cloud_cover_high:['bewolking',0,'%'],visibility:['zicht',0,'m'],cape:['cape',0,'J/kg'],shortwave_radiation:['straling',0,'W/m²'],wind_speed_10m:['wind',0,'km/h'],wind_direction_10m:['wind',0,'°'],wind_gusts_10m:['windstoten',0,'km/h']};
export async function gfsForecast(url,bucket){
 if(!bucket)throw Error('Eigen GFS-opslag ontbreekt');const q=url.searchParams;
 const models=(q.get('models')||'').split(',');if(models.length!==1||!['gfs_seamless','gfs_global','gfs025','gfs05'].includes(models[0]))throw Error('Vraag GFS afzonderlijk op');
 if(q.has('daily'))throw Error('Dagaggregaten nog niet beschikbaar in de eigen GFS-puntbron');
 const lat=Number(q.get('latitude')),lon=Number(q.get('longitude'));if(!q.has('latitude')||!q.has('longitude')||!Number.isFinite(lat)||!Number.isFinite(lon))throw Error('Eén geldige GFS-locatie vereist');
 const object=await bucket.get('gfs_native_canvas_meta.json');if(!object)throw Error('Eigen GFS-kaartbron nog niet beschikbaar');const m=await object.json();
 const age=Date.now()-Date.parse(m.run_utc);if(!Number.isFinite(age)||age>24*3600000||age< -3600000)throw Error('Eigen GFS-run verouderd');
 const g=m.grid;if(lat<g.lat_min||lat>g.lat_max||lon<g.lon_min||lon>g.lon_max)throw Error('Gekozen locatie valt buiten de eigen GFS-kaartuitsnede');
 const iy=Math.round((lat-g.lat_min)/(g.lat_max-g.lat_min)*(g.n_lat-1)),ix=Math.round((lon-g.lon_min)/(g.lon_max-g.lon_min)*(g.n_lon-1)),point=iy*g.n_lon+ix,nt=m.tijden.length;
 const fields=(q.get('hourly')||'temperature_2m').split(',').filter(Boolean);if(fields.some(f=>!specs[f]||!m.parameters[specs[f][0]]?.point_file))throw Error('Element ontbreekt in eigen GFS-bron');
 const all={};for(const key of new Set(fields.map(f=>specs[f][0]))){const p=m.parameters[key],length=nt*p.components*4,offset=16+point*length,object=await bucket.get(p.point_file,{range:{offset,length}});if(!object)throw Error('Eigen GFS-veld ontbreekt');const b=await object.arrayBuffer();if(b.byteLength!==length)throw Error('GFS-puntbestand onvolledig');const v=new DataView(b);all[key]=Array.from({length:nt},(_,i)=>Array.from({length:p.components},(_,c)=>v.getFloat32((i*p.components+c)*4,true)));}
 const hourly={time:m.tijden.map(t=>new Date(t).toISOString())},units={time:'iso8601'};
 for(const f of fields){const[key,component,unit]=specs[f];units[f]=unit;hourly[f]=all[key].map(a=>{let v=a[component];if(f==='wind_speed_10m'||f==='wind_gusts_10m')v=Math.hypot(a[0],a[1])*3.6;if(f==='wind_direction_10m'){if(Math.hypot(a[0],a[1])<1e-6)return null;v=(270-Math.atan2(a[1],a[0])*180/Math.PI)%360;}if(f==='pressure_msl')v/=100;if(f.startsWith('cloud_cover_'))v*=100;if(!Number.isFinite(v))return null;
 if((f==='temperature_2m'||f==='dew_point_2m')&&q.get('temperature_unit')==='fahrenheit'){v=v*1.8+32;units[f]='°F';}
 if((f==='wind_speed_10m'||f==='wind_gusts_10m')&&q.get('wind_speed_unit')==='ms'){v/=3.6;units[f]='m/s';}
 if(f==='precipitation'&&q.get('precipitation_unit')==='inch'){v/=25.4;units[f]='inch';}return v;});}
 return {latitude:g.lat_min+iy*(g.lat_max-g.lat_min)/(g.n_lat-1),longitude:g.lon_min+ix*(g.lon_max-g.lon_min)/(g.n_lon-1),timezone:'UTC',utc_offset_seconds:0,source:'NOAA GFS Open Data direct',run_utc:m.run_utc,hourly,hourly_units:units};
}
