/* Data validation for the Lobith observation page; never synthesizes readings. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.RijnCore=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 const DAY=86400000,OLA=1020;
 const validQ=q=>Number.isFinite(q)&&q>=0&&q<100000;
 function instant(value){return typeof value==='string'&&/(?:Z|[+-]\d\d:?\d\d)$/i.test(value)?Date.parse(value):NaN;}
 function day(value){if(typeof value!=='string'||!/^\d{4}-\d\d-\d\d$/.test(value))return NaN;const ms=Date.parse(value+'T12:00:00Z');return Number.isFinite(ms)&&new Date(ms).toISOString().slice(0,10)===value?ms:NaN;}
 function read(json,now=Date.now()){
  if(!json||!Array.isArray(json.reeks))throw Error('De meetreeks ontbreekt.');
  const today=new Intl.DateTimeFormat("sv-SE",{timeZone:"Europe/Amsterdam",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
  const unique=new Map();let rejected=0;
  for(const row of json.reeks){const ms=day(row.d);if(!Number.isFinite(ms)||!validQ(row.q)||row.d>today){rejected++;continue;}unique.set(row.d,{day:row.d,ms,q:row.q,complete:typeof row.volledig==='boolean'?row.volledig:null,count:Number.isInteger(row.aantal)?row.aantal:null});}
  const series=[...unique.values()].sort((a,b)=>a.ms-b.ms);
  if(!series.length)throw Error('Er zijn geen geldige afvoermetingen beschikbaar.');
  const t=instant(json.nu?.tijd);
  const current=validQ(json.nu?.afvoer)&&Number.isFinite(t)&&t<=now+300000?{q:json.nu.afvoer,ms:t}:null;
  const wt=instant(json.nu?.waterstand_tijd),w=json.nu?.waterstand_cm;
  const water=Number.isFinite(w)&&Math.abs(w)<100000&&Number.isFinite(wt)&&wt<=now+300000?{cm:w,ms:wt}:null;
  const minimum=series.reduce((a,b)=>b.q<a.q?b:a),maximum=series.reduce((a,b)=>b.q>a.q?b:a);
  return {series,current,water,minimum,maximum,rejected,generated:instant(json.gegenereerd),stale:!current||now-current.ms>3*3600000};
 }
 const format=ms=>new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(ms);
 return {read,validQ,instant,day,format,DAY,OLA};
});
