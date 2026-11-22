export const HOUR = 3600000;
export const dayKey = date => new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(date));
export function validateFeed(feed,key){
 const g=feed?.grid;
 if(feed?.schema!==1||feed.key!==key||!g||!['w','h','lon0','lat0','dx','dy'].every(k=>Number.isFinite(g[k]))||g.w<2||g.h<2||g.w*g.h>400000||g.dx<=0||g.dy>=0||!Array.isArray(feed.runs)||!feed.runs.length)throw Error('Ongeldige modelindex: '+key);
 const run=[...feed.runs].sort((a,b)=>b.id.localeCompare(a.id))[0];
 if(!/^\d{10}$/.test(run.id)||!Number.isFinite(Date.parse(run.time))||!run.enc||!Array.isArray(run.steps)||!run.steps.length)throw Error('Ongeldige modelrun: '+key);
 for(const [i,s] of run.steps.entries())if(!Number.isInteger(s.lead)||!Number.isFinite(Date.parse(s.valid))||!Array.isArray(s.keys)||!new RegExp('^'+key+'-'+run.id+'-[a-f0-9]{20}\\.json$').test(s.asset)||(i&&Date.parse(s.valid)<=Date.parse(run.steps[i-1].valid)))throw Error('Ongeldige tijdstap: '+key);
 return {...feed,runs:[run]};
}
export function hourlyTimes(feed){
 const steps=feed.runs[0].steps,out=[];
 for(let i=0;i<steps.length;i++){
  const right=steps[i],left=steps[i-1],end=Date.parse(right.valid);
  if(feed.key.startsWith('ecmwf')&&left){const begin=Date.parse(left.valid),hours=right.lead-left.lead,nominal=right.lead>144?6:3;if(hours<=nominal&&end-begin===hours*HOUR)for(let t=begin+HOUR;t<end;t+=HOUR)out.push(t);}
  out.push(end);
 }
 return out;
}
export function sharedTimes(catalogs,keys,now=Date.now()){
 const feeds=[...new Set(keys)].map(k=>catalogs[k]);if(feeds.some(f=>!f))return [];
 const sets=feeds.map(f=>new Set(hourlyTimes(f))),start=Math.floor(now/HOUR)*HOUR;
 return [...sets[0]].filter(t=>t>=start&&sets.every(s=>s.has(t))).sort((a,b)=>a-b);
}
export function closestIndex(times,stamp){return times.reduce((best,t,i)=>Math.abs(t-stamp)<Math.abs(times[best]-stamp)?i:best,0);}
