/* Explicit editorial corrections; WeatherPro records remain unchanged. */
(function(root){
 'use strict';
 const FIELDS=['tt','wbgt','apparent','rh','dd','ff','ffg','rr','pop','thunder','sun','visibility'];
 const LIMITS={tt:[-40,60],wbgt:[-40,60],apparent:[-100,80],rh:[1,100],dd:[0,360],ff:[0,270],ffg:[0,400],rr:[0,500],pop:[0,100],thunder:[0,100],sun:[0,60],visibility:[0,200000]};
 const directions=['N','NNO','NO','ONO','O','OZO','ZO','ZZO','Z','ZZW','ZW','WZW','W','WNW','NW','NNW'];
 function parse(field,text){
  if(!LIMITS[field])throw Error('Onbekend tabelveld');
  const str=text.trim().toUpperCase();if(str===''||str==='—'||str==='-')return null;
  if(field==='dd'&&directions.includes(str))return directions.indexOf(str)*22.5;
  if(!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(str))throw Error('Vul een getal in'+(field==='dd'?' of een windrichting (bijvoorbeeld ZZW)':'')+'.');
  const value=Number(str.replace(',','.')),[min,max]=LIMITS[field];
  if(!Number.isFinite(value)||value<min||value>max)throw Error('Waarde moet tussen '+min+' en '+max+' liggen.');return value;
 }
 function apply(data,edits){
  const diagnostics=[...data.diagnostics];
  const hours=data.hours.map(original=>{
   const changes=edits.get(original.iso);if(!changes)return original;
   const h={...original,...changes};delete h.wbgt;
   for(const [field,value] of Object.entries(changes))diagnostics.push({code:'manual-correction',iso:h.iso,field,original:original[field]??null,value});
   // Retain the source's 2 m / 10 m ratio when the editor changes wind speed.
   // Without that source ratio there is no justified corrected 2 m input.
   if(Object.hasOwn(changes,'ff')){
    h.wind2=changes.ff!==null&&Number.isFinite(original.wind2)&&Number.isFinite(original.ff)&&original.ff>0?original.wind2*changes.ff/original.ff:null;
    diagnostics.push({code:'manual-wind2',iso:h.iso,value:h.wind2,method:'WeatherPro wind-height ratio; missing ratio gives no WBGT'});
   }
   return h;
  });return {...data,hours,diagnostics};
 }
 function finish(data,edits,core){
  const hours=data.hours.map(h=>{const change=edits.get(h.iso);if(!change||!Object.hasOwn(change,'wbgt'))return h;return {...h,wbgt:change.wbgt,wbgtReason:change.wbgt===null?'WBGT handmatig leeggemaakt':null,wbgtComponents:null,wbgtManual:true};});
  return {...data,hours,warnings:core.dailyWarnings(hours,data.criteria)};
 }
 root.GalazoEdits={FIELDS,parse,apply,finish};
})(typeof window!=='undefined'?window:globalThis);
