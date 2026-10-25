'use strict';
(function(root){
 function top(rows,now=Date.now()){
  return [...new Map((rows||[]).filter(r=>r.samples===6&&Number.isFinite(r.mean_ms)&&r.mean_ms>=0&&Number.isFinite(Date.parse(r.end_utc))&&Date.parse(r.end_utc)<=now&&now-Date.parse(r.end_utc)<=40*60000).sort((a,b)=>Date.parse(b.end_utc)-Date.parse(a.end_utc)).map(r=>[r.station,r]).reverse()).values()].sort((a,b)=>b.mean_ms-a.mean_ms||a.station-b.station).slice(0,5);
 }
 const api={top};if(typeof module==='object'&&module.exports)module.exports=api;else root.StormWindCore=api;
})(typeof globalThis==='object'?globalThis:this);
