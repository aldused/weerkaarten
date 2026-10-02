/* GALAZO calculations and daily criteria. Weather data exclusively WeatherPro.
 * Reuses wbgt_core.js: Liljegren natural wet-bulb/globe heat balances; combines
 * components using the supplied GGD 2023 formula. No Stull substitution.
 */
(function(root){
 'use strict';
 const finite=v=>typeof v==='number'&&Number.isFinite(v);
 function calculateHour(h,context,engine=root.WBGT){
  const missing=[];
  for(const [key,label] of [['tt','luchttemperatuur'],['rh','relatieve luchtvochtigheid'],['wind2','wind op 2 m'],['solar','globale straling'],['ppp','luchtdruk op zeeniveau']])if(!finite(h[key]))missing.push(label);
  if(!finite(context.elevation)||context.elevation< -500||context.elevation>4000)missing.push('locatiehoogte (m)');
  if(!finite(context.lat)||!finite(context.lon)||!Number.isFinite(Date.parse(h.iso)))missing.push('locatie/tijd');
  if(!h.issuedInstant||!h.issuedInterval||!Number.isFinite(Date.parse(h.issuedInstant))||!Number.isFinite(Date.parse(h.issuedInterval)))missing.push('WeatherPro-uitgiftetijd van moment- en intervaldata');
  else if(Date.parse(h.issuedInstant)!==Date.parse(h.issuedInterval))missing.push('gelijke WeatherPro-uitgiftetijd voor uur- en stralingsgegevens');
  if(missing.length)return {value:null,reason:missing.join(', '),components:null};
  if(!engine)return {value:null,reason:'WBGT-rekenkern niet geladen',components:null};
  // Hydrostatic approximation, not another weather source. Explicit site
  // elevation required; sea-level pressure must not silently act as site pressure.
  const pressure=h.ppp*Math.exp(-9.80665*context.elevation/(287.05*(h.tt+273.15)));
  // Radiation is the hourly mean: solar geometry at the middle of that interval.
  const cosZ=engine.solarZenithCos(context.lat,context.lon,new Date(Date.parse(h.iso)+1800000));
  if(h.solar>0&&cosZ<=0)return {value:null,reason:'positieve uurstraling bij zon onder de horizon (tijdvak niet representatief)',components:null};
  // The Liljegren direct-beam partition is a documented model assumption.
  // WeatherPro directRadiation's horizontal/normal convention is unverified;
  // it is deliberately not treated as a measured beam fraction.
  const fdir=engine.estimateFdir(h.solar,cosZ);
  const c=engine.calculateManual({method:'model',exposure:'outdoor',Ta:h.tt,RH:h.rh,wind:h.wind2,windHeight:2,S:h.solar,pressure,elevation:Math.asin(Math.min(1,cosZ))*180/Math.PI,fdir});
  if(!c||!finite(c.WBGT))return {value:null,reason:'ongeldige invoer of warmtebalans convergeert niet',components:null};
  return {value:c.WBGT,reason:null,components:c};
 }
 const CRITERIA=[{key:'wbgt',field:'wbgt',label:'WBGT (°C)',direction:'high',min:-10,max:60,defaultValue:null},
  {key:'temp',field:'tt',label:'Temperatuur (°C)',direction:'high',min:-40,max:60,defaultValue:30},
  {key:'gust',field:'ffg',label:'Windstoot (km/u)',direction:'high',min:1,max:400,defaultValue:50},
  {key:'rain',field:'rr',label:'Regen (mm/uur)',direction:'high',min:.1,max:500,defaultValue:5},
  {key:'thunder',field:'thunder',label:'Onweerskans (%)',direction:'high',min:1,max:100,defaultValue:30},
  {key:'visibility',field:'visibility',label:'Zicht lager dan (m)',direction:'low',min:1,max:200000,defaultValue:1000}];
 function validateCriteria(settings){for(const c of CRITERIA){const v=settings[c.key];if(v!==null&&v!==undefined&&(!finite(v)||v<c.min||v>c.max))throw Error('Ongeldig waarschuwingscriterium: '+c.label);}return settings;}
 function criteriaText(settings){return CRITERIA.filter(c=>finite(settings[c.key])).map(c=>`${c.label} ${c.direction==='low'?'<':'≥'} ${settings[c.key]}`).join(' · ')||'Geen automatische criteria ingesteld';}
 function dailyWarnings(hours,settings){
  validateCriteria(settings);const days=new Map();
  for(const h of hours){if(!days.has(h.date))days.set(h.date,[]);days.get(h.date).push(h);}
  return [...days].map(([date,rows])=>{
   const triggers=[];
   for(const c of CRITERIA){const limit=settings[c.key];if(!finite(limit))continue;
    const hits=rows.filter(h=>finite(h[c.field])&&(c.direction==='low'?h[c.field]<limit:h[c.field]>=limit));
    if(hits.length){const extreme=(c.direction==='low'?Math.min:Math.max)(...hits.map(h=>h[c.field]));
     triggers.push({key:c.key,label:c.label,limit,extreme,hours:hits.map(h=>h.iso),text:`${c.label}: ${c.direction==='low'?'min.':'max.'} ${extreme.toFixed(c.key==='wbgt'||c.key==='rain'?1:0).replace('.',',')} (${hits.map(h=>h.t.slice(11,16)+' '+h.offset).join(', ')})`});}
   }
   return {date,triggers};
  }).filter(d=>d.triggers.length);
 }
 function process(data,context,settings){
  if(data.source!=='WeatherPro')throw Error('GALAZO accepteert uitsluitend WeatherPro');
  const diagnostics=[...data.diagnostics],hours=data.hours.map(h=>{const result=calculateHour(h,context);if(result.reason)diagnostics.push({code:'wbgt-unavailable',iso:h.iso,reason:result.reason});return {...h,wbgt:result.value,wbgtReason:result.reason,wbgtComponents:result.components};});
  return {...data,hours,diagnostics,warnings:dailyWarnings(hours,settings),criteria:{...settings},context:{...context}};
 }
 root.GalazoCore={calculateHour,process,dailyWarnings,CRITERIA,validateCriteria,criteriaText};
})(typeof window!=='undefined'?window:globalThis);
