(function(root){
 'use strict';
 const base=new URLSearchParams(location.search).has('localData')?'harmoneps_plume/':'https://data.weerlab.nl/harmoneps_plume/';
 const finite=v=>typeof v==='number'&&Number.isFinite(v);
 function validate(data,stationId){
  const match=/^(\d{4})(\d{2})(\d{2})(\d{2})Z$/.exec(data?.run||'');
  const start=match?Date.UTC(+match[1],+match[2]-1,+match[3],+match[4]):NaN;
  if(data?.schema!==2||data.complete!==true||data.station?.id!==stationId||data.n_members!==6||data.member_ids?.length!==6||data.member_ids[0]!==0||new Set(data.member_ids).size!==6||!Number.isFinite(start)||data.times?.length!==61)throw new Error('Onvolledige HARMONIE-batch');
  if(data.times.some((t,i)=>Date.parse(t)!==start+i*3600000))throw new Error('HARMONIE-tijdas klopt niet');
  for(const [field,members] of Object.entries(data.vars||{})){
   if(!Array.isArray(members)||members.length!==6||members.some(m=>!Array.isArray(m)||m.length!==61||m.some(v=>!finite(v))))throw new Error('Onvolledig HARMONIE-veld: '+field);
   if(field.endsWith('_pct')&&members.some(m=>m.some(v=>v<0||v>100)))throw new Error('Ongeldig percentage');
   if(field==='precip_mm_per_h'&&members.some(m=>m.some(v=>v<0)))throw new Error('Ongeldige neerslag');
  }
  if(!data.vars?.t2m_c||!data.vars?.precip_mm_per_h||data.vars.pwat_mm)throw new Error('Onjuiste HARMONIE-velddefinitie');
  return data;
 }
 async function json(url){const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(25000)});if(!r.ok)throw new Error('HARMONIE-bron tijdelijk niet bereikbaar');return r.json();}
 async function manifest(){
  const m=await json(base+'latest.json?t='+Date.now());
  if(m?.schema!==2||m.complete!==true||!/^\d{10}$/.test(m.run_key)||m.n_members!==6||!Array.isArray(m.stations)||m.stations.length!==m.station_count)throw new Error('Onvolledig HARMONIE-manifest');return m;
 }
 async function load(stationId,m){
  m=m||await manifest();
  if(!m.stations.some(s=>s.id===stationId))throw new Error('Plaats niet beschikbaar');
  const data=validate(await json(base+m.run_key+'/'+encodeURIComponent(stationId)+'.json'),stationId);
  if(data.run!==m.run_key+'Z')throw new Error('HARMONIE-run wisselde tijdens laden');return data;
 }
 root.HarmonepsData={validate,manifest,load};
 if(typeof module==='object')module.exports=root.HarmonepsData;
})(globalThis);
