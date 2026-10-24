/* Weather24 point forecasts: exact app hours, no grid interpolation or substitutions. */
(()=>{
 const BASE='https://weerlab-weather24.dawn-term-a69f.workers.dev';
 const cache=new Map();
 const norm=s=>s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
 async function json(path){const r=await fetch(BASE+path,{signal:AbortSignal.timeout(25000),cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error||'Weather24 niet bereikbaar');return d}
 async function load(p){
  const key=norm(p.name),old=cache.get(key);if(old&&Date.now()-Date.parse(old.generated)<10*60000&&Date.parse(old.start)>=Math.ceil(Date.now()/3600000)*3600000)return old;
  const found=await json('/search?'+new URLSearchParams({q:p.name}));const exact=found.filter(x=>norm(x.name)===key).sort((a,b)=>Math.hypot(a.lat-p.lat,a.lon-p.lon)-Math.hypot(b.lat-p.lat,b.lon-p.lon));
  if(!exact.length)throw Error('Weather24 heeft geen exacte plaatsmatch voor '+p.name+'. Kies een woonplaatsnaam.');const city=exact[0];if(Math.hypot(city.lat-p.lat,city.lon-p.lon)>.3)throw Error('Weather24-plaats komt niet overeen met de gekozen locatie');
  const data=await json('/forecast?lid='+city.lid);const out={...data,place:{...city,name:p.name}};cache.set(key,out);return out;
 }
 function meta(d,kind){return {...d,run_utc:d.generated,h43_run:d.generated,ifs_run:d.generated,tag:d.generated,model:'weather24',source_intervals:Array(d.hours).fill(1),start:kind==='rain'?d.rows[0].t:d.rows[0].end,t0:d.rows[0].end,source:Array(d.hours).fill('Weather24'),sources:Array(d.hours).fill('Weather24')};}
 function sample(p,kind){const d=cache.get(norm(p.name));if(!d)throw Error('Weather24-plaats is nog niet geladen');const required=kind==='wind'?['ws','wg','wd']:[kind==='temp'?'temp':'rain'];if(d.rows.some(r=>required.some(k=>!Number.isFinite(r[k]))))throw Error('Weather24 levert ontbrekende '+kind+'-waarden voor '+p.name);
  if(kind==='wind')return d.rows.map(r=>({t:r.end,ws:r.ws,wg:r.wg,wd:r.wd,src:'Weather24'}));return {...p,[kind]:d.rows.map(r=>r[kind])};
 }
 async function prepare(places){const results=[];let next=0;await Promise.all(Array.from({length:4},async()=>{while(next<places.length){const p=places[next++];try{await load(p);results.push(p)}catch{}}}));if(!results.length)throw Error('Geen volledige Weather24-plaatsen beschikbaar');const start=cache.get(norm(results[0].name)).start;return results.filter(p=>cache.get(norm(p.name)).start===start);}
 window.Weather24Platen={load,meta,sample,prepare,has:p=>cache.has(norm(p.name)),source:'MOS/ECMWF · Weather24',base:BASE};
})();
