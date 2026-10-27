/* Legacy point queries from own binary grids only. Missing fields remain null. */
const models={ecmwf_ifs:['ecmwf_native_canvas_meta.json','ECMWF IFS'],ecmwf_ifs025:['ecmwf_native_canvas_meta.json','ECMWF IFS'],ecmwf_seamless:['ecmwf_native_canvas_meta.json','ECMWF IFS'],ecmwf_aifs:['point-source/aifs/meta.json','ECMWF AIFS Single'],ecmwf_aifs_single:['point-source/aifs/meta.json','ECMWF AIFS Single'],icon_d2:['point-source/icond2/meta.json','DWD ICON-D2'],knmi_harmonie_arome_netherlands:['point-source/harmonie/meta.json','KNMI HARMONIE'],knmi_harmonie_arome_europe:['point-source/harmonie/meta.json','KNMI HARMONIE'],harmonie_nl:['point-source/harmonie/meta.json','KNMI HARMONIE']};
export const nativePointModels=new Set(Object.keys(models));
const specs={temperature_2m:['temp',0,'°C'],dew_point_2m:['dauwpunt',0,'°C'],relative_humidity_2m:['rv',0,'%'],precipitation:['neerslag',0,'mm'],pressure_msl:['druk',0,'hPa'],shortwave_radiation:['straling',0,'W/m²'],direct_radiation:['straling_direct',0,'W/m²'],sunshine_duration:['zon',0,'s'],cloud_cover:['cloud_total',0,'%'],cloud_cover_high:['bewolking',0,'%'],cloud_cover_mid:['bewolking',1,'%'],cloud_cover_low:['bewolking',2,'%'],cape:['cape',0,'J/kg'],visibility:['zicht',0,'m'],wind_speed_10m:['wind',0,'km/h'],wind_direction_10m:['wind',0,'°'],wind_gusts_10m:['windstoten',0,'km/h']};
export function utcTimes(meta){
 let previous=-Infinity;
 const fmt=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 return meta.tijden.map(s=>{let t;if(/(?:Z|[+-]\d\d:\d\d)$/.test(s))t=Date.parse(s);else{const nominal=Date.parse(s+'Z');const candidates=[0,1,2,3].map(h=>nominal-h*3600000).filter(t=>fmt.format(new Date(t)).replace(' ','T')===s.slice(0,16)&&t>previous).sort((a,b)=>a-b);t=candidates[0];}if(!Number.isFinite(t)||t<=previous)throw Error('Ongeldige native tijdas');previous=t;return new Date(t).toISOString();});
}
async function one(url,bucket,model){
 const q=url.searchParams,[metaKey,label]=models[model],obj=await bucket.get(metaKey);if(!obj)throw Error('Eigen puntbron ontbreekt: '+label);const m=await obj.json();
 if(!m.run_utc || Date.now()-Date.parse(m.run_utc)>24*3600000)throw Error('Eigen puntbron is verouderd: '+label);
 const requested=q.get('run')||q.get('run_utc');if(requested && Date.parse(requested.endsWith('Z')?requested:requested+'Z')!==Date.parse(m.run_utc))throw Error('Gevraagde exacte run ontbreekt voor '+label);
 const lat=Number(q.get('latitude')),lon=Number(q.get('longitude'));if(!q.has('latitude')||!q.has('longitude')||!Number.isFinite(lat)||!Number.isFinite(lon))throw Error('Eén geldige locatie vereist');
 const time=utcTimes(m),nt=time.length,cache={};
 async function read(key){if(key in cache)return cache[key];const p=m.parameters[key];if(!p || !(p.key||p.point_file))return cache[key]=null;const g=p.grid||m.grid;if(!g || lat<g.lat_min||lat>g.lat_max||lon<g.lon_min||lon>g.lon_max)throw Error('Locatie buiten het eigen '+label+' rooster');
 const y=Math.round((lat-g.lat_min)/(g.lat_max-g.lat_min)*(g.n_lat-1)),x=Math.round((lon-g.lon_min)/(g.lon_max-g.lon_min)*(g.n_lon-1)),size=p.bytes_per_value||4,nc=p.components,steps=p.steps||nt,length=steps*nc*size,offset=16+(y*g.n_lon+x)*length;
 const object=await bucket.get(p.key||p.point_file,{range:{offset,length}});if(!object)throw Error('Native veld ontbreekt: '+key);if(obj.uploaded && object.uploaded && new Date(object.uploaded)>new Date(obj.uploaded))throw Error('Eigen bron wordt bijgewerkt; probeer opnieuw');const buffer=await object.arrayBuffer();if(buffer.byteLength!==length || steps!==nt)throw Error('Onvolledig native puntveld: '+key);const v=new DataView(buffer);
 return cache[key]=Array.from({length:nt},(_,i)=>Array.from({length:nc},(_,c)=>{let n=size===1?(v.getUint8(i*nc+c)/(p.scale||10))**(p.power||2):v.getFloat32((i*nc+c)*4,true);return Number.isFinite(n)?n:null;}));}
 const fields=(q.get('hourly')||'temperature_2m,precipitation').split(',').filter(Boolean),h={time},units={time:'iso8601'},missing=[];
 const aliases={windspeed_10m:'wind_speed_10m',windgusts_10m:'wind_gusts_10m',winddirection_10m:'wind_direction_10m',cloudcover:'cloud_cover',dewpoint_2m:'dew_point_2m',relativehumidity_2m:'relative_humidity_2m',weathercode:'weather_code'};
 for(const requestedField of fields){const f=aliases[requestedField]||requestedField;const spec=specs[f];let values=null;units[f]=spec?.[2]||'';
 if(spec){let [key,c]=spec;const a=await read(key);if(a){values=a.map(row=>{if(f==='wind_speed_10m'||f==='wind_gusts_10m')return row.every(Number.isFinite)?Math.hypot(...row)*3.6:null;if(f==='wind_direction_10m')return row.every(Number.isFinite)&&Math.hypot(...row)>1e-6?(270-Math.atan2(row[1],row[0])*180/Math.PI+360)%360:null;let value=row[c];if(value===null)return null;if(f==='pressure_msl')value*=.01;if(f.startsWith('cloud_cover_'))value*=100;if(f==='sunshine_duration')value*=60;return value;});}
 if(!values&&f==='cloud_cover'){const a=await read('bewolking');if(a)values=a.map(row=>row.every(Number.isFinite)?(1-row.reduce((p,v)=>p*(1-Math.max(0,Math.min(1,v))),1))*100:null);}
 if(!values&&f==='dew_point_2m'){const t=await read('temp'),rh=await read('rv');if(t&&rh)values=t.map(([v],i)=>{const r=rh[i][0];if(!Number.isFinite(v)||!Number.isFinite(r)||r<=0)return null;const g=Math.log(r/100)+17.625*v/(243.04+v);return 243.04*g/(17.625-g);});}
 }
 if(!values&&f==='relative_humidity_2m'){const t=await read('temp'),dew=await read('dauwpunt');if(t&&dew)values=t.map(([v],i)=>Number.isFinite(v)&&Number.isFinite(dew[i][0])?Math.max(0,Math.min(100,100*Math.exp(17.625*dew[i][0]/(243.04+dew[i][0])-17.625*v/(243.04+v)))):null);}
 if(!values){values=Array(nt).fill(null);missing.push(f);}const windUnit=q.get('wind_speed_unit')||q.get('windspeed_unit');if(f.startsWith('wind_')&&f!=='wind_direction_10m'&&['ms','kn','mph'].includes(windUnit)){const factor=windUnit==='ms'?1/3.6:windUnit==='kn'?1/1.852:1/1.609344;values=values.map(v=>v===null?null:v*factor);units[f]=windUnit==='ms'?'m/s':windUnit==='kn'?'kn':'mph';}h[requestedField]=values;units[requestedField]=units[f];
 }
 if(missing.length===fields.length)throw Error('Gevraagde velden ontbreken in eigen '+label+' bron');
 const lo=q.get('start_hour')||q.get('start_date'),hi=q.get('end_hour')||q.get('end_date');const parse=s=>Date.parse(/(?:Z|[+-]\d\d:\d\d)$/.test(s)?s:s+'Z');const indexes=time.map((t,i)=>i).filter(i=>(!lo||Date.parse(time[i])>=parse(lo))&&(!hi||Date.parse(time[i])<=parse(hi)+(hi.length===10?86399999:0)));
 if(!indexes.length)throw Error('Gevraagde periode buiten eigen modelrun');for(const k of Object.keys(h))h[k]=indexes.map(i=>h[k][i]);
 return {latitude:lat,longitude:lon,timezone:'UTC',utc_offset_seconds:0,source:label+' rechtstreeks, eigen Weerlab-rooster',run_utc:m.run_utc,weerlab_run:m.run_utc,hourly:h,hourly_units:units,weerlab_unavailable_variables:missing,paid_fallback:false};
}
export async function nativePointForecast(url,bucket){
 const names=(url.searchParams.get('models')||'ecmwf_ifs').split(',');if(names.some(n=>!models[n]))throw Error('Geen eigen native bron voor één van de gekozen modellen');
 const daily=(url.searchParams.get('daily')||'').split(',').filter(Boolean),map={temperature_2m_max:['temperature_2m','max'],temperature_2m_min:['temperature_2m','min'],precipitation_sum:['precipitation','sum'],sunshine_duration:['sunshine_duration','sum'],wind_speed_10m_max:['wind_speed_10m','max'],wind_gusts_10m_max:['wind_gusts_10m','max']};
 const request=new URL(url);if(daily.length)request.searchParams.set('hourly',[...new Set([...(url.searchParams.get('hourly')||'').split(',').filter(Boolean),...daily.map(f=>map[f]?.[0]).filter(Boolean)])].join(','));
 const datasets=await Promise.all(names.map(n=>one(request,bucket,n)));if(datasets.length===1){const d=datasets[0];if(daily.length){
  const zone=url.searchParams.get('timezone')||'UTC',format=new Intl.DateTimeFormat('sv-SE',{timeZone:zone==='auto'?'Europe/Amsterdam':zone,year:'numeric',month:'2-digit',day:'2-digit'}),groups=new Map();d.hourly.time.forEach((t,i)=>{const day=format.format(new Date(t));if(!groups.has(day))groups.set(day,[]);groups.get(day).push(i);});
  d.daily={time:[...groups.keys()]};d.daily_units={time:'iso8601'};d.daily_complete=[];
  for(const day of groups.keys()){let expected=0;const center=Date.parse(day+'T00:00:00Z');for(let h=-18;h<42;h++)if(format.format(new Date(center+h*3600000))===day)expected++;d.daily_complete.push(groups.get(day).length===expected);}
  for(const f of daily){const spec=map[f];d.daily_units[f]=spec?d.hourly_units[spec[0]]:'';d.daily[f]=[...groups.values()].map((ix,i)=>{const v=spec?ix.map(j=>d.hourly[spec[0]]?.[j]):[];if(!d.daily_complete[i]||!v.length||!v.every(Number.isFinite))return null;return spec[1]==='max'?Math.max(...v):spec[1]==='min'?Math.min(...v):v.reduce((a,b)=>a+b,0);});}
  if(!url.searchParams.has('hourly')){delete d.hourly;delete d.hourly_units;}
 }return d;}
 const times=[...new Set(datasets.flatMap(d=>d.hourly.time))].sort(),hourly={time:times},hourly_units={time:'iso8601'};
 datasets.forEach((d,i)=>{const ix=new Map(d.hourly.time.map((t,j)=>[t,j]));for(const [f,values] of Object.entries(d.hourly)){if(f==='time')continue;hourly[f+'_'+names[i]]=times.map(t=>ix.has(t)?values[ix.get(t)]:null);hourly_units[f+'_'+names[i]]=d.hourly_units[f];}});
 return {latitude:datasets[0].latitude,longitude:datasets[0].longitude,timezone:'UTC',utc_offset_seconds:0,source:'Eigen native modelroosters',model_runs:Object.fromEntries(datasets.map((d,i)=>[names[i],d.run_utc])),hourly,hourly_units,weerlab_unavailable_variables:Object.fromEntries(datasets.map((d,i)=>[names[i],d.weerlab_unavailable_variables])),paid_fallback:false};
}
