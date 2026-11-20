/* Calendar-based threshold analysis. KNMI daily series and explicitly incomplete national historical observations. */
(function(root){
'use strict';
const DAY=86400000;
const variables={
 TX:{label:'Maximumtemperatuur (TX)',unit:'°C',factor:10,definition:'Hoogste temperatuur van de KNMI-dag op normale waarnemingshoogte.'},
 TN:{label:'Minimumtemperatuur (TN)',unit:'°C',factor:10,definition:'Laagste temperatuur op normale waarnemingshoogte (circa 1,5 m). Vorst: TN < 0 °C; dit is geen grondvorst.'},
 RH:{label:'Neerslag (RH)',unit:'mm',factor:10,trace:true,definition:'KNMI-etmaalsom. Code −1 betekent minder dan 0,05 mm; geen negatieve neerslag.'},
 FXX:{label:'Hoogste windstoot (FXX)',unit:'km/u',factor:10/3.6,definition:'Hoogste windstoot van de KNMI-dag; bron in 0,1 m/s, omgerekend naar km/u.'},
 SQ:{label:'Zonneschijnduur (SQ)',unit:'uur',factor:10,trace:true,definition:'Zonneschijnduur van de KNMI-dag. Code −1 betekent minder dan 0,05 uur.'},
 TG:{label:'Gemiddelde temperatuur (TG)',unit:'°C',factor:10},T10N:{label:'Minimum op 10 cm (T10N · grondvorst)',unit:'°C',factor:10},
 FG:{label:'Gemiddelde wind (FG)',unit:'km/u',factor:10/3.6},FHX:{label:'Hoogste uurwind (FHX)',unit:'km/u',factor:10/3.6},
 DR:{label:'Neerslagduur (DR)',unit:'uur',factor:10},Q:{label:'Globale straling (Q)',unit:'J/cm²',factor:1},SP:{label:'Percentage zonneschijn (SP)',unit:'%',factor:1},
 PG:{label:'Gemiddelde luchtdruk (PG)',unit:'hPa',factor:10},PX:{label:'Hoogste luchtdruk (PX)',unit:'hPa',factor:10},PN:{label:'Laagste luchtdruk (PN)',unit:'hPa',factor:10},
 EV24:{label:'Referentieverdamping (EV24)',unit:'mm',factor:10},UG:{label:'Gemiddelde luchtvochtigheid (UG)',unit:'%',factor:1},UX:{label:'Hoogste luchtvochtigheid (UX)',unit:'%',factor:1},UN:{label:'Laagste luchtvochtigheid (UN)',unit:'%',factor:1}
};
const ops={lt:(v,t)=>v<t,le:(v,t)=>v<=t,gt:(v,t)=>v>t,ge:(v,t)=>v>=t,eq:(v,t)=>Math.abs(v-t)<1e-9};
function day(value){const s=String(value).replaceAll('-','');if(!/^\d{8}$/.test(s))return null;const y=+s.slice(0,4),m=+s.slice(4,6),d=+s.slice(6,8),t=Date.UTC(y,m-1,d),v=new Date(t);return v.getUTCFullYear()===y&&v.getUTCMonth()===m-1&&v.getUTCDate()===d?t:null;}
function md(value){if(!/^\d{2}-\d{2}$/.test(value)||day('2000'+value.replace('-',''))===null)throw Error('Gebruik een geldige dag en maand.');return value;}
function boundary(y,s){md(s);let m=+s.slice(0,2),d=+s.slice(3);if(m===2&&d===29&&new Date(Date.UTC(y,2,0)).getUTCDate()===28)d=28;return Date.UTC(y,m-1,d);}
// A leap-year template containing February in every period; 1 March keeps the same position in all years.
function calendarAxis(start){const y=start>'02-29'?1999:2000;return {year:y,start:boundary(y,start)};}
function position(t,start,periodYear){const a=calendarAxis(start),d=new Date(t),m=String(d.getUTCMonth()+1).padStart(2,'0')+'-'+String(d.getUTCDate()).padStart(2,'0');return (boundary(a.year+(periodYear===undefined?(m<start?1:0):d.getUTCFullYear()-periodYear),m)-a.start)/DAY;}
function meanDate(offset,start){return offset===null?null:new Date(calendarAxis(start).start+Math.round(offset)*DAY).toISOString().slice(5,10);}
function decode(raw,variable){if(raw===null||raw===undefined||String(raw).trim()===''||!Number.isFinite(Number(raw))||Number(raw)===-9999)return null;const n=Number(raw);if(variable.trace&&n===-1)return {value:null,trace:true};if(!['TX','TN','TG','T10N'].some(k=>variables[k]===variable)&&n<0)return null;return {value:n/variable.factor,trace:false};}
function match(v,op,threshold,upper){if(!v)return null;if(op==='between'){if(v.trace)return threshold<=0&&upper>=.05?true:upper<0||threshold>=.05?false:null;return v.value>=threshold-1e-9&&v.value<=upper+1e-9;}if(!v.trace)return ops[op](v.value,threshold);const lo=0,hi=.05;
 if(op==='lt')return threshold>=hi?true:threshold<=lo?false:null;
 if(op==='le')return threshold>=hi?true:threshold<lo?false:null;
 if(op==='ge')return threshold<=lo?true:threshold>=hi?false:null;
 if(op==='gt')return threshold<lo?true:threshold>=hi?false:null;
 return threshold<lo||threshold>=hi?false:null;
}
function analyze(json,options){
 const {field='TN',op='lt',threshold=0,upper,start='09-01',end='02-29'}=options,variable=variables[field];md(start);md(end);
 if(!variable||(!ops[op]&&op!=='between')||!Number.isFinite(threshold)||(op==='between'&&(!Number.isFinite(upper)||upper<threshold)))throw Error('Kies een geldige variabele, vergelijking en grens.');
 const di=json.kolommen.indexOf('YYYYMMDD'),vi=json.kolommen.indexOf(field);if(di<0||vi<0)throw Error('Deze variabele ontbreekt in de dagreeks van dit station.');
 const today=options.today??day(new Date().toISOString().slice(0,10)),byDate=new Map(),all=[];
 for(const row of json.data){const t=day(row[di]);if(t===null)continue;all.push(t);const v=decode(row[vi],variable);if(byDate.has(t)&&JSON.stringify(byDate.get(t))!==JSON.stringify(v))throw Error('Tegenstrijdige dagwaarden op '+new Date(t).toISOString().slice(0,10));byDate.set(t,v);}
 if(!all.length)throw Error('Geen daggegevens beschikbaar.');
 const first=Math.min(...all),last=Math.max(...all),cross=end<start,firstYear=new Date(first).getUTCFullYear();
 const from=options.from??firstYear-(cross?1:0),to=options.to??new Date(today).getUTCFullYear();
 if(!Number.isInteger(from)||!Number.isInteger(to)||from<1700||to>2200||from>to||to-from>=500)throw Error('Kies een geldige reeks beginjaren (maximaal 500 jaar).');
 const periods=[];
 for(let year=from;year<=to;year++){
  const a=boundary(year,start),b=boundary(year+(cross?1:0),end);if(a>today)continue;
  const expected=(b-a)/DAY+1,running=b>=today;let valid=0,missing=0,uncertain=0,hits=0,streak=0,longest=0,firstHit=null,lastHit=null,streakStart=null,longestStart=null,longestEnd=null,longestRuns=[];
  for(let t=a;t<=Math.min(b,today-DAY);t+=DAY){const v=byDate.get(t),yes=match(v,op,threshold,upper);if(!v){missing++;streak=0;continue;}if(yes===null){uncertain++;streak=0;continue;}valid++;
   if(yes){const hit={time:t,value:v.value,trace:v.trace,position:position(t,start,year)};firstHit ||= hit;lastHit=hit;hits++;if(!streak)streakStart=t;streak++;if(streak>longest){longest=streak;longestStart=streakStart;longestEnd=t;longestRuns=[{start:streakStart,end:t}];}else if(streak===longest)longestRuns.push({start:streakStart,end:t});}
   else streak=0;
  }
  const complete=!running&&valid===expected,status=running?'lopend':complete?'volledig':valid?'onvolledig':'geen gegevens';
  periods.push({year,label:cross?year+'/'+(year+1):String(year),start:a,end:b,expected,valid,missing,uncertain,running,complete,status,hits,first:firstHit,last:lastHit,longest,longestStart,longestEnd,longestRuns});
 }
 const complete=periods.filter(p=>p.complete),eventPeriods=complete.filter(p=>p.first),noEvent=complete.filter(p=>!p.first).length;
 const avg=side=>eventPeriods.length?eventPeriods.reduce((s,p)=>s+p[side].position,0)/eventPeriods.length:null;
 const rank=(side,descending=false,limit=10)=>{const sorted=eventPeriods.slice().sort((a,b)=>(descending?-1:1)*(a[side].position-b[side].position)||a.year-b.year);let rank=0,prev=null;return sorted.map((p,i)=>{const value=p[side].position;if(value!==prev)rank=i+1;prev=value;return {...p,rank};}).filter((p,i)=>i<limit||p[side].position===sorted[limit-1]?.[side].position);};
 return {field,variable,op,threshold,upper,start,end,cross,from,to,today,sourceFirst:first,sourceLast:last,periods,completeCount:complete.length,eventCount:eventPeriods.length,noEvent,excluded:periods.length-complete.length,meanFirst:meanDate(avg('first'),start),meanLast:meanDate(avg('last'),start),meanFirstOffset:avg('first'),meanLastOffset:avg('last'),rank};
}
// The day map feed has physical units. Only declared daily series certify coverage;
// isolated historical observations continue to come from the curated record archive.
function historicalSources(json){
 if(json?.units!=='physical'||!json.days||!json.stations)throw Error('Ongeldige historische dagreeksen.');
 const series=new Map();
 for(const [id,station]of Object.entries(json.stations))if(station.dailySeries===true)series.set(id,{id:station.naam,historical:true,values:[],fields:new Set()});
 if(!series.size)throw Error('De volledige historische dagreeksen ontbreken in de bron.');
 for(const [date,stations]of Object.entries(json.days)){
  if(day(date)===null)continue;
  for(const [id,values]of Object.entries(stations)){
   const source=series.get(id);if(!source)continue;
   const row={};for(const [field,value]of Object.entries(values))if(variables[field]&&Number.isFinite(value)){row[field]=value*variables[field].factor;source.fields.add(field);}
   if(Object.keys(row).length)source.values.push([date,row]);
  }
 }
 return [...series.values()].filter(s=>s.values.length).map(source=>{
  const fields=[...source.fields];return {id:source.id,historical:true,json:{kolommen:['YYYYMMDD',...fields],data:source.values.map(([date,row])=>[date,...fields.map(f=>row[f]??null)])}};
 });
}
// National observations are a union of station-days, never an average of temperatures.
// Sparse historic records cannot certify absence elsewhere, so national periods stay incomplete.
function analyzeNetwork(sources,records,options){
 const {field='TN',op='lt',threshold=0,upper}=options,variable=variables[field];
 if(!variable)throw Error('Kies een geldige variabele.');

 const days=new Map(),coverage=[];
 function add(time,v,station,historical=false){
  if(time===null||!v)return;
  let entry=days.get(time);if(!entry){entry=new Map();days.set(time,entry);}
  // Full daily series takes precedence over duplicate sparse record entries.
  if(!entry.has(station))entry.set(station,{...v,station,historical});
 }
 for(const source of sources){const di=source.json.kolommen.indexOf('YYYYMMDD'),vi=source.json.kolommen.indexOf(field);if(di<0||vi<0)continue;
  const dates=new Set();let first=Infinity,last=-Infinity;
  for(const row of source.json.data){const t=day(row[di]),v=decode(row[vi],variable);add(t,v,source.id,source.historical===true);if(t!==null&&v&&match(v,op,threshold,upper)!==null){dates.add(t);first=Math.min(first,t);last=Math.max(last,t);}}
  if(dates.size)coverage.push({dates,first,last});
 }
 for(const record of records)if(record.parameter===field&&Number.isFinite(record.waarde))add(day(record.datum),{value:record.waarde,trace:false},record.station,true);
 if(!days.size)throw Error('Geen geldige daggegevens beschikbaar voor deze variabele.');
 const hits=new Map(),rows=[];
 for(const [time,entries]of days){const values=[...entries.values()],matching=values.filter(v=>match(v,op,threshold,upper)===true);
  const v=matching[0]||values.find(v=>match(v,op,threshold,upper)===null)||values[0];
  rows.push([new Date(time).toISOString().slice(0,10).replaceAll('-',''),v.trace?-1:Math.round(v.value*variable.factor*1e8)/1e8]);
  if(matching.length)hits.set(time,matching.sort((a,b)=>a.station.localeCompare(b.station,'nl')));
 }
 const result=analyze({kolommen:['YYYYMMDD',field],data:rows},options);
 for(const p of result.periods){
  // Records need daily coverage in every available station's active interval.
  // Historic isolated records may extend an observed boundary, never certify absence.
  p.dailyComplete=!p.running&&coverage.some(s=>s.first<=p.start&&s.last>=p.end)&&coverage.every(s=>{
   for(let t=Math.max(p.start,s.first);t<=Math.min(p.end,s.last);t+=DAY)if(!s.dates.has(t))return false;
   return true;
  });
  p.complete=false;p.status=p.running?'lopend':p.valid?'onvolledig':'geen gegevens';
  for(const side of ['first','last'])if(p[side])p[side].observations=hits.get(p[side].time);
 }
 // National dates are observed boundaries, including periods with station gaps.
 // A complete-only subset would contradict the dates in the annual overview.
 const eventPeriods=result.periods.filter(p=>p.first&&!p.running);

 result.rank=(side,descending=false,limit=10)=>{const sorted=eventPeriods.slice().sort((a,b)=>(descending?-1:1)*(a[side].position-b[side].position)||a.year-b.year);let rank=0,previous=null;return sorted.map((p,i)=>{if(p[side].position!==previous)rank=i+1;previous=p[side].position;return {...p,rank};}).filter((p,i)=>i<limit||p[side].position===sorted[limit-1]?.[side].position);};
 return {...result,national:true,comparisonPeriodCount:eventPeriods.length,recordPeriodCount:result.periods.filter(p=>p.dailyComplete).length,completeCount:0,eventCount:0,noEvent:0,excluded:result.periods.length,meanFirst:null,meanLast:null,meanFirstOffset:null,meanLastOffset:null};
}
const api={DAY,variables,day,boundary,position,meanDate,decode,match,analyze,historicalSources,analyzeNetwork};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ThresholdQuestions=api;
})(typeof window==='undefined'?globalThis:window);
