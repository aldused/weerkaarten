/* Daily Weather24 figures. No aggregation of hourly probabilities or substitution of other sources. */
(function(root){
 'use strict';
 const finite=(value,min,max)=>typeof value==='number'&&Number.isFinite(value)&&value>=min&&value<=max;
 const decimal=value=>Number(value.toFixed(1)).toString();
 function daily(city,keys){
  const out={zon:[],nsk:[],nsm:[],bft:[],ri:[]};
  for(const key of keys){const d=city?.days?.[key]||{};
   out.zon.push(finite(d.sun,0,24)?decimal(d.sun):'–');
   out.nsk.push(finite(d.pop,0,100)?Math.round(d.pop):'–');
   out.nsm.push(finite(d.rr,0,1000)?decimal(d.rr):'–');
   out.bft.push(finite(d.ff,0,400)?[1,6,12,20,29,39,50,62,75,89,103,118].filter(limit=>d.ff>=limit).length:'–');
   out.ri.push(finite(d.dd,0,360)?d.dd:null);
  }return out;
 }
 function mixed(mosmix,station,keys,city){
  const temp=field=>keys.map(key=>{const value=mosmix?.data?.[key]?.[field]?.[station];return finite(value,-90,65)?Math.round(value):'–'});
  return {tmax:temp('TX'),tmin:temp('TN'),...daily(city,keys)};
 }
 root.Weather24Table={daily,mixed};
})(typeof window==='undefined'?globalThis:window);
