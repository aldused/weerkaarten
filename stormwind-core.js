'use strict';
(function(root){
 function top(rows,now=Date.now()){
  return [...new Map((rows||[]).filter(r=>r.samples===6&&new Date(r.end_utc).getUTCMinutes()===0&&Number.isFinite(r.mean_ms)&&r.mean_ms>=0&&Number.isFinite(Date.parse(r.end_utc))&&Date.parse(r.end_utc)<=now&&now-Date.parse(r.end_utc)<=100*60000).sort((a,b)=>Date.parse(b.end_utc)-Date.parse(a.end_utc)).map(r=>[r.station,r]).reverse()).values()].sort((a,b)=>b.mean_ms-a.mean_ms||a.station-b.station).slice(0,5);
 }
 function dayTop(rows,day){return (rows||[]).filter(r=>Number.isFinite(r.mean_ms)&&new Date(Date.parse(r.end_utc)-1000).toISOString().slice(0,10)===day).sort((a,b)=>b.mean_ms-a.mean_ms||a.station-b.station).slice(0,5);}
 function beaufort(ms){const rounded=Math.floor(ms+.5);return rounded>=33?12:rounded>=29?11:rounded>=25?10:rounded>=21?9:rounded>=17?8:rounded>=14?7:rounded>=11?6:rounded>=8?5:rounded>=6?4:rounded>=4?3:rounded>=2?2:rounded>=1?1:0;}
 const api={top,dayTop,beaufort};if(typeof module==='object'&&module.exports)module.exports=api;else root.StormWindCore=api;
})(typeof globalThis==='object'?globalThis:this);
