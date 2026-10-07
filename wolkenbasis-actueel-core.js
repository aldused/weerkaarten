(function(root){
'use strict';
const number=v=>typeof v==='number'&&Number.isFinite(v);
function fresh(time,now,maxMinutes){const t=Date.parse(time);return Number.isFinite(t)&&t<=now+300000&&now-t<=maxMinutes*60000;}
function metar(m,now=Date.now()){
 const time=number(m.obsTime)?new Date(m.obsTime*1000).toISOString():m.reportTime;
 if(!fresh(time,now,90)||!number(m.lat)||!number(m.lon))return null;
 const raw=m.rawOb||'', layers=(m.clouds||[]).filter(c=>['FEW','SCT','BKN','OVC'].includes(c.cover)&&number(c.base)&&c.base>=0).sort((a,b)=>a.base-b.base);
 const lowest=layers[0], vv=(m.clouds||[]).find(c=>['VV','OVX'].includes(c.cover));
 let status='unknown',height=null,detail='Geen wolkenbasishoogte gemeld';
 if(vv||/\bVV\d{3}\b|\bVV\/\/\//.test(raw)){status='vertical';const match=raw.match(/\bVV(\d{3})\b/);height=vv&&number(vv.base)?vv.base*.3048:match?Number(match[1])*100*.3048:null;detail='Verticaal zicht bij een onzichtbare hemel; geen gemeten wolkenbasis';}
 else if(lowest){status='height';height=lowest.base*.3048;detail='Laagste gemelde wolkenlaag · '+lowest.cover;}
 else if(/\bCAVOK\b/.test(raw)){status='cavok';detail='CAVOK: geen operationeel relevante lage bewolking; hogere wolken zijn mogelijk';}
 else if(/\b(?:NSC|NCD|CLR|SKC)\b/.test(raw)){status='no-base';detail='Geen wolkenlaag gemeld binnen de rapportage- of detectiegrens';}
 return {id:m.icaoId,name:m.name||m.icaoId,lat:m.lat,lon:m.lon,time,status,height,detail,source:'METAR · '+m.icaoId,raw};
}
function knmi(s,now=Date.now()){
 const time=s.h_t;
 if(!fresh(time,now,60)||!number(s.lat)||!number(s.lon)||!number(s.h)||s.h<0)return null;
 return {id:s.wigos||s.naam,name:s.naam,lat:s.lat,lon:s.lon,time,status:'height',height:s.h*.3048,detail:'KNMI wolkenbasis over de afgelopen 30 minuten',source:'KNMI 10-minuten',raw:''};
}
const colors=['#a62e45','#d14c40','#ec8846','#edbd59','#b6c775','#6baea1','#4794b5','#477bb4','#676bab'];
const limits=[100,200,500,1000,1500,2000,3000,5000];
function color(h){return colors[limits.findIndex(x=>h<x)<0?8:limits.findIndex(x=>h<x)];}
const api={fresh,metar,knmi,color,limits,colors};if(typeof module==='object')module.exports=api;else root.WolkenbasisActueel=api;
})(typeof window==='object'?window:globalThis);
