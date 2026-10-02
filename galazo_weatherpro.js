/* Strict GALAZO WeatherPro adapter. No feed substitutions or weather fallbacks.
 * PT0S values at interval END; PT1H values over the labelled hour. Join UTC
 * instants, never local strings (which repeat when summer time ends).
 */
(function(root){
 'use strict';
 const HOUR=3600000,TZ='Europe/Amsterdam';
 const TOKEN='https://api.weatherpro.com/v1/token/weather';
 const FORECAST='https://point-forecast-weatherpro.meteogroup.com/search';
 const INSTANT={tt:['airTemperatureInCelsius',-40,60],td:['dewPointTemperatureInCelsius',-80,60],rh:['relativeHumidityInPercent',1,100],ff:['windSpeedInKilometerPerHour',0,270],wind2:['windSpeed2MetersInMeterPerSecond',0,75],dd:['windDirectionInDegree',0,360],n:['totalCloudCoverInOcta',0,8],apparent:['feelsLikeTemperatureInCelsius',-100,80],visibility:['visibilityInMeter',0,200000],uv:['uvIndexWithClouds',0,30],ppp:['airPressureAtSeaLevelInHectoPascal',500,1100],ww:['weatherCode',-8,99]};
 const INTERVAL={ffg:['maxWindGustInKilometerPerHour',0,400],rr:['precipitationAmountInMillimeter',0,500],pop:['precipitationProbabilityInPercent',0,100],thunder:['thunderstormProbabilityInPercent',0,100],sun:['sunshineDurationInMinutes',0,60],solar:['averageGlobalRadiationInWattPerSquareMeter',0,1400]};
 function parts(ms){return Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:TZ,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(ms)).map(p=>[p.type,p.value]));}
 function dateKey(ms){const p=parts(ms);return `${p.year}-${p.month}-${p.day}`;}
 function addDate(d,n){return new Date(Date.parse(d+'T12:00:00Z')+n*24*HOUR).toISOString().slice(0,10);}
 function midnight(d){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d)throw Error('Ongeldige datum');
  const target=Date.parse(d+'T00:00:00Z');let ms=target;
  for(let i=0;i<3;i++){const p=parts(ms);ms+=target-Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);}
  return ms;
 }
 function windowFor(start,days,now=Date.now()){
  const today=dateKey(now);
  if(!Number.isInteger(days)||days<1||days>7)throw Error('Kies 1 tot 7 dagen');
  if(start<today||start>addDate(today,6))throw Error('Kies een datum binnen de komende zeven kalenderdagen');
  const end=addDate(start,days)<addDate(today,7)?addDate(start,days):addDate(today,7);
  return {from:midnight(start),until:midnight(end),start,end,timezone:TZ};
 }
 function timestamp(v){return typeof v==='string'&&/(Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))?Date.parse(v):null;}
 function normalize(inst,interval,range){
  const diagnostics=[],im=new Map(),vm=new Map();
  function index(rows,map,period){for(const f of rows){
   const start=timestamp(f.validFrom),end=timestamp(f.validUntil);
   if(start===null||end===null||(period==='PT1H'?end-start!==HOUR:end!==start)){diagnostics.push({code:'invalid-time',period});continue;}
   const key=end;if(map.has(key)){diagnostics.push({code:'duplicate-time',period,iso:new Date(end).toISOString()});continue;}
   map.set(key,f);
  }}
  index(inst,im,'PT0S');index(interval,vm,'PT1H');
  const hours=[];
  for(let ms=range.from;ms<range.until;ms+=HOUR){
   const i=im.get(ms+HOUR),v=vm.get(ms+HOUR),p=parts(ms),h={iso:new Date(ms).toISOString(),endIso:new Date(ms+HOUR).toISOString(),t:`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`,date:dateKey(ms),missing:[]};
   h.offset=new Intl.DateTimeFormat('en',{timeZone:TZ,timeZoneName:'shortOffset'}).formatToParts(new Date(ms)).find(x=>x.type==='timeZoneName').value.replace('GMT','UTC');
   h.available=!!(i||v);h.issuedInstant=i?.issuedAt??null;h.issuedInterval=v?.issuedAt??null;
   function copy(spec,row){for(const [key,[field,lo,hi]] of Object.entries(spec)){
    const value=row?.[field];h[key]=typeof value==='number'&&Number.isFinite(value)&&value>=lo&&value<=hi&&(key!=='ww'||Number.isInteger(value))?value:null;
    if(h[key]===null){h.missing.push(field);diagnostics.push({code:value===undefined||value===null?'missing-field':'invalid-field',iso:h.iso,field});}
   }}
   copy(INSTANT,i);copy(INTERVAL,v);
   // Effective cloud is separately available; do not relabel it as total cloud.
   if(h.n===null&&typeof i?.effectiveCloudCoverInOcta==='number'&&i.effectiveCloudCoverInOcta>=0&&i.effectiveCloudCoverInOcta<=8){h.n=i.effectiveCloudCoverInOcta;h.cloudType='effectief';}else h.cloudType='totaal';
   hours.push(h);
  }
  const issued=[...im.values(),...vm.values()].map(x=>x.issuedAt).filter(x=>timestamp(x)!==null);
  return {source:'WeatherPro',hours,diagnostics,issued:[...new Set(issued)].sort(),range};
 }
 async function request(url,options={}){
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),20000);
  try{const r=await fetch(url,{...options,signal:ctrl.signal,cache:'no-store'});if(!r.ok)throw Error('WeatherPro HTTP '+r.status);return r;}
  catch(e){if(e.name==='AbortError')throw Error('WeatherPro antwoordt niet binnen 20 seconden');throw e;}finally{clearTimeout(timer);}
 }
 async function fetchForecast(lat,lon,range){
  if(!Number.isFinite(lat)||lat< -90||lat>90||!Number.isFinite(lon)||lon< -180||lon>180)throw Error('Ongeldige coördinaten');
  const tok=(await (await request(TOKEN)).text()).trim();if(!tok||tok.length<10)throw Error('Geen geldig WeatherPro-token');
  async function get(spec,period){
   const fields=['issuedAt',...Object.values(spec).map(x=>x[0])];if(period==='PT0S')fields.push('effectiveCloudCoverInOcta');
   const u=new URL(FORECAST);u.search=new URLSearchParams({fields:fields.join(','),locatedAt:`${lon},${lat}`,validPeriod:period,validFrom:new Date(range.from).toISOString(),validUntil:new Date(range.until).toISOString()}).toString();
   const j=await (await request(u.href,{headers:{Authorization:'Bearer '+tok}})).json();
   if(!Array.isArray(j.forecasts))throw Error('WeatherPro-respons bevat geen forecastlijst');return j.forecasts;
  }
  const res=await Promise.allSettled([get(INSTANT,'PT0S'),get(INTERVAL,'PT1H')]);
  if(res.every(r=>r.status==='rejected'))throw Error(res.map(r=>r.reason.message).join('; '));
  const data=normalize(res[0].status==='fulfilled'?res[0].value:[],res[1].status==='fulfilled'?res[1].value:[],range);
  res.forEach((r,i)=>{if(r.status==='rejected')data.diagnostics.push({code:'request-failed',period:i?'PT1H':'PT0S',message:r.reason.message});});
  if(!data.hours.some(h=>h.available))throw Error('WeatherPro levert geen uren in de gekozen periode');
  return {...data,lat,lon,fetched:new Date().toISOString()};
 }
 // PDOK is used only to resolve Dutch place names into coordinates, never
 // for weather values. Forecast requests remain exclusively WeatherPro.
 async function resolveLocation(name){
  const url=new URL('https://api.pdok.nl/bzk/locatieserver/search/v3_1/free');
  url.search=new URLSearchParams({q:name,fq:'type:woonplaats',rows:'10'}).toString();
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),15000);
  try{
   const r=await fetch(url.href,{signal:ctrl.signal});if(!r.ok)throw Error('Plaats zoeken mislukt (HTTP '+r.status+')');
   const j=await r.json(),docs=j.response?.docs;
   if(!Array.isArray(docs))throw Error('Plaatszoeker geeft geen geldige resultaten');
   const locations=docs.flatMap(d=>{const m=d.centroide_ll?.match(/^POINT\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)$/);if(!m)return [];const lon=Number(m[1]),lat=Number(m[2]);if(!Number.isFinite(lat)||!Number.isFinite(lon))return [];return [{name:d.weergavenaam||d.woonplaatsnaam,place:d.woonplaatsnaam,lat,lon}];});
   const exact=locations.filter(l=>l.place?.toLocaleLowerCase('nl')===name.trim().toLocaleLowerCase('nl'));
   return exact.length===1?exact:locations;
  }catch(e){if(e.name==='AbortError')throw Error('Plaatszoeker antwoordt niet. Vul de coördinaten handmatig in.');throw e;}finally{clearTimeout(timer);}
 }
 root.GalazoWeatherPro={fetch:fetchForecast,normalize,windowFor,midnight,addDate,dateKey,timestamp,HOUR,TZ,INSTANT,INTERVAL,resolveLocation};
})(typeof window!=='undefined'?window:globalThis);
