/* Cold-day counts use physical temperatures and UTC dates; missing values stay unknown. */
(function(root){
'use strict';
const DAY=86400000;
const categories=[
 {label:'Vorst',noun:'vorstdagen',description:'TN < 0 °C',field:'tn',test:v=>v<0,color:'#93c5fd'},
 {label:'IJsdag',noun:'ijsdagen',description:'TX < 0 °C (hele dag vorst)',field:'tx',test:v=>v<0,color:'#38bdf8'},
 {label:'Lichte vorst',noun:'dagen met lichte vorst',description:'−5,0 °C ≤ TN < 0 °C',field:'tn',test:v=>v>=-5&&v<0,color:'#60a5fa'},
 {label:'Matige vorst of kouder',noun:'dagen met matige vorst of kouder',description:'TN < −5 °C',field:'tn',test:v=>v< -5,color:'#3b82f6'},
 {label:'Strenge vorst of kouder',noun:'dagen met strenge vorst of kouder',description:'TN < −10 °C',field:'tn',test:v=>v< -10,color:'#2563eb'},
 {label:'Zeer strenge vorst',noun:'dagen met zeer strenge vorst',description:'TN < −15 °C',field:'tn',test:v=>v< -15,color:'#1e3a8a'},
 {label:'Extreem koude dagen',noun:'extreem koude dagen',description:'TN ≤ −20 °C',field:'tn',test:v=>v<=-20,color:'#5b21b6'}
];
function dateKey(y,m,d){const t=Date.UTC(y,m-1,d),v=new Date(t);return v.getUTCFullYear()===y&&v.getUTCMonth()===m-1&&v.getUTCDate()===d?t:null;}
function periodYear(time,mode='winteryear'){const d=new Date(time);return d.getUTCFullYear()-(mode==='winteryear'&&d.getUTCMonth()<7?1:0);}
function label(year,mode='winteryear'){return mode==='winteryear'?year+'/'+(Number(year)+1):String(year);}
function bounds(year,mode){return mode==='winteryear'?[Date.UTC(year,7,1),Date.UTC(year+1,7,1)-DAY]:[Date.UTC(year,0,1),Date.UTC(year+1,0,1)-DAY];}
function temperature(v){return typeof v==='number'&&Number.isFinite(v)&&v!==-9999&&v!==-999.9;}
function compute(sources,{mode='winteryear',today=new Date().toISOString().slice(0,10)}={}){
 const now=typeof today==='number'?today:Date.parse(today+'T00:00:00Z');
 if(!Number.isFinite(now)||!['winteryear','calendar'].includes(mode))throw Error('Ongeldige telperiode');
 const grid=new Map();
 for(const source of sources)for(const [year,months]of Object.entries(source?.maanddetail||{}))for(const [month,detail]of Object.entries(months))for(const day of detail.dagen||[]){
  const time=dateKey(+year,+month,+day.dag);if(time===null||time>=now||(!temperature(day.tn)&&!temperature(day.tx)))continue;
  let row=grid.get(time);if(!row){row={tn:null,tx:null};grid.set(time,row);}
  for(const field of ['tn','tx'])if(temperature(day[field])&&(row[field]===null||day[field]<row[field]))row[field]=day[field];
 }
 if(!grid.size)return null;
 const through=Math.max(...grid.keys()),perYear={},coverage={},minima={},monthTotal={},monthBest={},seasonTotal={},seasonBest={},monthly={},seasonal={};
 categories.forEach((_,i)=>{monthTotal[i]=Array(13).fill(0);monthBest[i]=Array(13).fill(null);seasonTotal[i]=[0,0,0,0];monthly[i]={};seasonal[i]=[{},{},{},{}];});
 for(const [time,row]of grid){
  const d=new Date(time),year=d.getUTCFullYear(),month=d.getUTCMonth()+1,py=periodYear(time,mode),[start,end]=bounds(py,mode);
  if(!perYear[py]){perYear[py]=categories.map(()=>0);coverage[py]={start,end,running:end>=now,valid:categories.map(()=>0),expected:(end-start)/DAY+1,elapsed:Math.max(0,(Math.min(end,now-DAY,through)-start)/DAY+1)};}
  minima[py]||={tn:null,tx:null};
  for(const field of ['tn','tx'])if(row[field]!==null&&(minima[py][field]===null||row[field]<minima[py][field]))minima[py][field]=row[field];
  const season=month===12||month<=2?0:month<=5?1:month<=8?2:3,sy=year+(month===12?1:0),my=year+'-'+month;
  categories.forEach((category,i)=>{
   const v=row[category.field];if(v===null)return;coverage[py].valid[i]++;
   if(!category.test(v))return;
   perYear[py][i]++;monthTotal[i][month]++;seasonTotal[i][season]++;
   monthly[i][my]=(monthly[i][my]||0)+1;seasonal[i][season][sy]=(seasonal[i][season][sy]||0)+1;
  });
 }
 categories.forEach((_,i)=>{
  for(const [key,count]of Object.entries(monthly[i])){const [year,month]=key.split('-').map(Number);if(!monthBest[i][month]||count>monthBest[i][month][0])monthBest[i][month]=[count,year];}
  seasonBest[i]=seasonal[i].map(years=>{let best=null;for(const [year,count]of Object.entries(years))if(!best||count>best[0])best=[count,+year];return best;});
 });
 return {mode,through,perYear,coverage,minima,monthTotal,monthBest,seasonTotal,seasonBest};
}
function rankYears(result,category){
 return Object.keys(result?.perYear||{}).map(Number).filter(y=>!result.coverage[y].running&&result.coverage[y].valid[category]>0)
  .map(year=>({year,count:result.perYear[year][category],label:label(year,result.mode),valid:result.coverage[year].valid[category],expected:result.coverage[year].expected}))
  .sort((a,b)=>b.count-a.count||a.year-b.year);
}
function stationRecords(sources,category,options={}){
 const rows=[];
 for(const source of sources){const c=compute([source],options);if(!c)continue;const ranking=rankYears(c,category);if(!ranking.length)continue;
  const top=ranking[0];rows.push({...top,station:source.station,stationNr:String(source.station_nr),ties:ranking.filter(r=>r.count===top.count)});
 }
 return rows.sort((a,b)=>b.count-a.count||String(a.station).localeCompare(String(b.station),'nl')||a.year-b.year);
}
const api={DAY,categories,dateKey,periodYear,label,bounds,compute,rankYears,stationRecords};
if(typeof module==='object'&&module.exports)module.exports=api;else root.ColdDays=api;
})(typeof window==='undefined'?globalThis:window);
