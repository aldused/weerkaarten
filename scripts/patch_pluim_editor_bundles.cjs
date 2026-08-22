#!/usr/bin/env node
'use strict';

// De actuele editorbron is niet in deze repository aanwezig. Houd de twee
// productie-bundels daarom met exact getelde, fail-fast vervangingen gelijk.
const fs = require('fs');
const path = require('path');

const bundles = [
  {
    path: 'landelijke-editor-assets/weerbewaking_landelijke_kaart-pc6L27QC.js',
    national: true,
    number: 'Le', bft: 'Og', mean: 'Uw', summary: 'qw', next: '_w', days: 'jg', rainHours: 'au',
    render: {
      rainPath: 'LA', rainY: 'wA', windPath: 'LA', windY: 'QA',
      windMax: 'hA', windTicks: 'li', flatValues: 'nA', right: 'p', item: 'P', font: 'Q',
    },
  },
  {
    path: 'regio-editor-assets/weerbewaking_regio_kaart-DCFOt_3t.js',
    number: 'Pe', bft: 'Hg', mean: 'Zw', summary: '_w', next: '$w', days: 'kg', rainHours: 'ou',
    render: {
      rainPath: 'ge', rainY: 'BA', windPath: 'ge', windY: 'K',
      windMax: 'rA', windTicks: 'bA', flatValues: 'nA', right: 'S', item: 'Y', font: 'R',
    },
  },
];

function replaceOnce(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: verwacht 1 treffer, kreeg ${count}`);
  return source.replace(before, after);
}

function replaceOnceOrAlready(source, before, after, label) {
  const beforeCount = source.split(before).length - 1;
  const afterCount = source.split(after).length - 1;
  if (beforeCount === 1) return source.replace(before, after);
  if (beforeCount === 0 && afterCount === 1) return source;
  throw new Error(`${label}: oud=${beforeCount}, nieuw=${afterCount}`);
}

function patchNationalMapBackgrounds(source, config) {
  if (!config.national) return source;

  const assets = {
    Fo: 'bg_nederland_dag.png',
    zw: 'bg_nederland_nacht.png',
    Lw: 'bg_nederland_grenzen_dag.png',
    Pw: 'bg_nederland_grenzen_nacht.png',
  };
  for (const [variable, filename] of Object.entries(assets)) {
    const file = path.join(__dirname, 'assets', 'nederlandkaart', filename);
    const value = fs.readFileSync(file).toString('base64');
    const pattern = new RegExp(`${variable}="data:image/png;base64,[A-Za-z0-9+/=]+"`, 'g');
    const matches = source.match(pattern) || [];
    if (matches.length !== 1) {
      throw new Error(`${config.path}: kaartachtergrond ${variable} verwacht 1 treffer, kreeg ${matches.length}`);
    }
    source = source.replace(pattern, `${variable}="data:image/png;base64,${value}"`);
  }
  return source;
}

function summarySource(c) {
  const N = c.number, M = c.mean, D = c.days, H = c.rainHours;
  if (c.national) {
    return `${c.summary}=e=>{var y;const runs=(y=e==null?void 0:e.runs)!=null?y:[],selector=globalThis.WeerlabPlumeRuns,selected=selector&&typeof selector.selectedRunIso==="function"?selector.selectedRunIso():null,selectedTime=Date.parse(selected||""),A=Number.isFinite(selectedTime)?runs.find(F=>Date.parse(F==null?void 0:F.run)===selectedTime):null;if(!Number.isFinite(selectedTime))throw new Error("De gekozen ECMWF-run is nog niet volledig vastgesteld.");if(!A)throw new Error("De pluimdata bevat niet exact de gekozen ECMWF-run.");const t=A==null?void 0:A.temp_members,n=A==null?void 0:A.precip_members,i=A==null?void 0:A.wind_members,s=A==null?void 0:A.cloud_members,rh=(A==null?void 0:A.humidity_members)||((A==null?void 0:A.members)||{}).relative_humidity_2m,gust=(A==null?void 0:A.gust_members)||((A==null?void 0:A.members)||{}).wind_gusts_10m;if(!Array.isArray(t)||!t.length||!Array.isArray(n)||!n.length||!Array.isArray(i)||!i.length)throw new Error("De pluimdata bevat nog geen complete temperatuur-, neerslag- en windreeksen.");const l=[...t,...n,...i,...Array.isArray(s)?s:[]],a=Math.min(...l.map(F=>Array.isArray(F)?F.length:0));if(a<24)throw new Error("De pluimdata bevat te weinig geldige uren.");const u=Number(A.t0_ms),w=Number(A.step_h)||1,E=Array.isArray(A.times_ms)&&A.times_ms.length>=a?A.times_ms.slice(0,a).map(Number):Array.from({length:a},(F,N)=>u+N*w*36e5),C=[],cum=n.map(()=>0),cumOk=n.map(()=>!0),R=S=>{const F=E[S],N=new Date(F);if(!Number.isFinite(F)||N.getUTCMinutes()!==0||N.getUTCHours()%${H}!==0)return[];const b=F-${H}*36e5;return n.map(J=>{let AA=0,P=0;for(let o=S;o>=0&&E[o]>b;o--){const v=${N}(J==null?void 0:J[o]);if(v==null)return null;const h=o>0?E[o-1]:E[o]-(E[1]-E[0]),q=Math.max(0,Math.min(E[o],F)-Math.max(h,b));q>0&&(AA+=Math.max(0,v),P+=q)}return P>=${H}*36e5-1?AA:null}).filter(J=>J!=null)};for(let S=0;S<a;S++){const Q=n.map((F,N)=>{const b=${N}(F==null?void 0:F[S]);return b==null?cumOk[N]=!1:cumOk[N]&&(cum[N]+=Math.max(0,b)),cumOk[N]?cum[N]:null}).filter(F=>F!=null),h=new Date(E[S]);if(!Number.isFinite(E[S])||h.getUTCMinutes()!==0||h.getUTCHours()%3!==0)continue;const $=t.map(F=>${N}(F==null?void 0:F[S])).filter(F=>F!=null),d=i.map(F=>${N}(F==null?void 0:F[S])).filter(F=>F!=null),g=Array.isArray(s)?s.map(F=>${N}(F==null?void 0:F[S])).filter(F=>F!=null):[],H=Array.isArray(rh)?rh.map(F=>${N}(F==null?void 0:F[S])).filter(F=>F!=null):[],G=Array.isArray(gust)?gust.map(F=>${N}(F==null?void 0:F[S])).filter(F=>F!=null):[],x=F=>g.length?g.filter(F).length/g.length*100:null,O=R(S);!$.length&&!d.length&&!O.length||C.push({t:E[S],tempP10:ne($,.1),tempP25:ne($,.25),tempP50:ne($,.5),tempP75:ne($,.75),tempP90:ne($,.9),rainChance:O.length?O.filter(F=>F>=.1).length/O.length*100:null,rainMean:${M}(O),rainP50:ne(O,.5),rainP75:ne(O,.75),rainP90:ne(O,.9),rainCumP10:ne(Q,.1),rainCumP25:ne(Q,.25),rainCumP50:ne(Q,.5),rainCumP75:ne(Q,.75),rainCumP90:ne(Q,.9),windP10:ne(d,.1),windP25:ne(d,.25),windP50:ne(d,.5),windP75:ne(d,.75),windP90:ne(d,.9),gustP10:ne(G,.1),gustP25:ne(G,.25),gustP50:ne(G,.5),gustP75:ne(G,.75),gustP90:ne(G,.9),humidityP10:ne(H,.1),humidityP25:ne(H,.25),humidityP50:ne(H,.5),humidityP75:ne(H,.75),humidityP90:ne(H,.9),cloudP10:ne(g,.1),cloudP25:ne(g,.25),cloudP50:ne(g,.5),cloudP75:ne(g,.75),cloudP90:ne(g,.9),cloudSunnyPct:x(F=>F<=20),cloudLightPct:x(F=>F>20&&F<=50),cloudMostlyPct:x(F=>F>50&&F<=80),cloudOvercastPct:x(F=>F>80)})}const p=${D}(C),coverageHours=Math.round((E[a-1]-E[0]+(a>1?E[a-1]-E[a-2]:0))/36e5),availablePanels=["temperature","precipitation","wind","accumulation"];Array.isArray(s)&&s.length&&availablePanels.push("cloud");Array.isArray(rh)&&rh.length&&availablePanels.push("humidity");Array.isArray(gust)&&gust.length&&availablePanels.push("gusts");if(p.length<8)throw new Error("De pluimdata kon niet worden samengevat.");return{station:e.station||"De Bilt",updated:e.updated||"",run:A.run||"",memberCount:t.length,rainHours:${H},coverageHours,availablePanels,points:p}}`;
  }
  return `${c.summary}=e=>{var y;const runs=(y=e==null?void 0:e.runs)!=null?y:[],selector=globalThis.WeerlabPlumeRuns,selected=selector&&typeof selector.selectedRunIso==="function"?selector.selectedRunIso():null,selectedTime=Date.parse(selected||""),A=Number.isFinite(selectedTime)?runs.find(F=>Date.parse(F==null?void 0:F.run)===selectedTime):null;if(!Number.isFinite(selectedTime))throw new Error("De gekozen ECMWF-run is nog niet volledig vastgesteld.");if(!A)throw new Error("De pluimdata bevat niet exact de gekozen ECMWF-run.");const t=A==null?void 0:A.temp_members,n=A==null?void 0:A.precip_members,i=A==null?void 0:A.wind_members,s=A==null?void 0:A.cloud_members;if(!Array.isArray(t)||!t.length||!Array.isArray(n)||!n.length||!Array.isArray(i)||!i.length)throw new Error("De pluimdata bevat nog geen complete temperatuur-, neerslag- en windreeksen.");const l=[...t,...n,...i,...Array.isArray(s)?s:[]],a=Math.min(...l.map(F=>Array.isArray(F)?F.length:0));if(a<24)throw new Error("De pluimdata bevat te weinig geldige uren.");const u=Number(A.t0_ms),w=Number(A.step_h)||1,E=Array.isArray(A.times_ms)&&A.times_ms.length>=a?A.times_ms.slice(0,a).map(Number):Array.from({length:a},(F,N)=>u+N*w*36e5),C=[],R=S=>{const F=E[S],N=new Date(F);if(!Number.isFinite(F)||N.getUTCMinutes()!==0||N.getUTCHours()%${H}!==0)return[];const b=F-${H}*36e5;return n.map(J=>{let AA=0,P=0;for(let o=S;o>=0&&E[o]>b;o--){const v=${N}(J==null?void 0:J[o]);if(v==null)return null;const h=o>0?E[o-1]:E[o]-(E[1]-E[0]),q=Math.max(0,Math.min(E[o],F)-Math.max(h,b));q>0&&(AA+=Math.max(0,v),P+=q)}return P>=${H}*36e5-1?AA:null}).filter(J=>J!=null)};for(let S=0;S<a;S++){const h=new Date(E[S]);if(!Number.isFinite(E[S])||h.getUTCMinutes()!==0||h.getUTCHours()%3!==0)continue;const $=t.map(F=>${N}(F==null?void 0:F[S])).filter(F=>F!=null),d=i.map(F=>${N}(F==null?void 0:F[S])).filter(F=>F!=null),g=Array.isArray(s)?s.map(F=>${N}(F==null?void 0:F[S])).filter(F=>F!=null):[],x=F=>g.length?g.filter(F).length/g.length*100:null,O=R(S);!$.length&&!d.length&&!O.length||C.push({t:E[S],tempP10:ne($,.1),tempP25:ne($,.25),tempP50:ne($,.5),tempP75:ne($,.75),tempP90:ne($,.9),rainChance:O.length?O.filter(F=>F>=.1).length/O.length*100:null,rainMean:${M}(O),rainP50:ne(O,.5),rainP75:ne(O,.75),rainP90:ne(O,.9),windP10:ne(d,.1),windP25:ne(d,.25),windP50:ne(d,.5),windP75:ne(d,.75),windP90:ne(d,.9),cloudP10:ne(g,.1),cloudP25:ne(g,.25),cloudP50:ne(g,.5),cloudP75:ne(g,.75),cloudP90:ne(g,.9),cloudSunnyPct:x(F=>F<=20),cloudLightPct:x(F=>F>20&&F<=50),cloudMostlyPct:x(F=>F>50&&F<=80),cloudOvercastPct:x(F=>F>80)})}const p=${D}(C),coverageHours=Math.round((E[a-1]-E[0]+(a>1?E[a-1]-E[a-2]:0))/36e5);if(p.length<8)throw new Error("De pluimdata kon niet worden samengevat.");return{station:e.station||"De Bilt",updated:e.updated||"",run:A.run||"",memberCount:t.length,rainHours:${H},coverageHours,points:p}}`;
}

function hardenNationalSummary(source, c) {
  // Directe ECMWF-runs bewaren de kernvelden in de generieke members-map.
  // Houd de oudere veldnamen als fallback voor bestaande Open-Meteo-archieven.
  // Dit geldt ook voor de regionale editor: beide productiebundels gebruiken
  // dezelfde runselector en kunnen dus hetzelfde directe archiefdocument zien.
  if (!c.national) {
    source = replaceOnceOrAlready(
      source,
      'const t=A==null?void 0:A.temp_members,n=A==null?void 0:A.precip_members,i=A==null?void 0:A.wind_members,s=A==null?void 0:A.cloud_members;',
      'const t=((A==null?void 0:A.members)||{}).temperature_2m||(A==null?void 0:A.temp_members),n=((A==null?void 0:A.members)||{}).precipitation||(A==null?void 0:A.precip_members),i=((A==null?void 0:A.members)||{}).wind_speed_10m||(A==null?void 0:A.wind_members),s=((A==null?void 0:A.members)||{}).cloud_cover||(A==null?void 0:A.cloud_members);',
      `${c.path}: directe en historische kernvelden`,
    );
    return source;
  }
  source = replaceOnceOrAlready(
    source,
    'const t=A==null?void 0:A.temp_members,n=A==null?void 0:A.precip_members,i=A==null?void 0:A.wind_members,s=A==null?void 0:A.cloud_members,rh=',
    'const t=((A==null?void 0:A.members)||{}).temperature_2m||(A==null?void 0:A.temp_members),n=((A==null?void 0:A.members)||{}).precipitation||(A==null?void 0:A.precip_members),i=((A==null?void 0:A.members)||{}).wind_speed_10m||(A==null?void 0:A.wind_members),s=((A==null?void 0:A.members)||{}).cloud_cover||(A==null?void 0:A.cloud_members),rh=',
    `${c.path}: directe en historische kernvelden`,
  );

  // De numerieke helper in de minified bundle gebruikt Number(value). Daardoor
  // werd een ontbrekende archiefwaarde (null) als een echte meteorologische 0
  // samengevat. Doe de nullcontrole vóór de conversie en bepaal beschikbaarheid
  // op basis van ten minste één werkelijk getal in de hele ledenmatrix.
  source = source.replaceAll(`${c.number}(`, 'weerlabOptionalNumber(');
  source = replaceOnce(
    source,
    'gust=(A==null?void 0:A.gust_members)||((A==null?void 0:A.members)||{}).wind_gusts_10m;',
    `gust=(A==null?void 0:A.gust_members)||((A==null?void 0:A.members)||{}).wind_gusts_10m,weerlabOptionalNumber=F=>F==null||F===""?null:${c.number}(F),weerlabMatrixHasValues=F=>Array.isArray(F)&&F.some(N=>Array.isArray(N)&&N.some(P=>weerlabOptionalNumber(P)!=null));`,
    `${c.path}: ontbrekende extra pluimwaarden`,
  );
  source = replaceOnce(
    source,
    'const l=[...t,...n,...i,...Array.isArray(s)?s:[]]',
    'const l=[...t,...n,...i]',
    `${c.path}: optionele matrices bepalen de tijdas niet`,
  );
  source = replaceOnce(
    source,
    'Array.isArray(s)&&s.length&&availablePanels.push("cloud");Array.isArray(rh)&&rh.length&&availablePanels.push("humidity");Array.isArray(gust)&&gust.length&&availablePanels.push("gusts");',
    'weerlabMatrixHasValues(s)&&availablePanels.push("cloud");weerlabMatrixHasValues(rh)&&availablePanels.push("humidity");weerlabMatrixHasValues(gust)&&availablePanels.push("gusts");',
    `${c.path}: paneelbeschikbaarheid op echte waarden`,
  );

  // De twee bestaande banden zijn robuuste middenbanden. Bewaar daarnaast de
  // werkelijke laagste en hoogste uitkomst zodat de simpele pluim ook de tien
  // leden buiten P10-P90 eerlijk kan laten zien.
  const spreadFields = [
    [
      'tempP10:ne($,.1),tempP25:ne($,.25),tempP50:ne($,.5),tempP75:ne($,.75),tempP90:ne($,.9)',
      'tempMin:ne($,0),tempP10:ne($,.1),tempP25:ne($,.25),tempP50:ne($,.5),tempP75:ne($,.75),tempP90:ne($,.9),tempMax:ne($,1)',
      'temperatuur',
    ],
    [
      `rainMean:${c.mean}(O),rainP50:ne(O,.5),rainP75:ne(O,.75),rainP90:ne(O,.9)`,
      `rainMean:${c.mean}(O),rainMin:ne(O,0),rainP10:ne(O,.1),rainP25:ne(O,.25),rainP50:ne(O,.5),rainP75:ne(O,.75),rainP90:ne(O,.9),rainMax:ne(O,1)`,
      'neerslaginterval',
    ],
    [
      'rainCumP10:ne(Q,.1),rainCumP25:ne(Q,.25),rainCumP50:ne(Q,.5),rainCumP75:ne(Q,.75),rainCumP90:ne(Q,.9)',
      'rainCumMin:ne(Q,0),rainCumP10:ne(Q,.1),rainCumP25:ne(Q,.25),rainCumP50:ne(Q,.5),rainCumP75:ne(Q,.75),rainCumP90:ne(Q,.9),rainCumMax:ne(Q,1)',
      'neerslagaccumulatie',
    ],
    [
      'windP10:ne(d,.1),windP25:ne(d,.25),windP50:ne(d,.5),windP75:ne(d,.75),windP90:ne(d,.9)',
      'windMin:ne(d,0),windP10:ne(d,.1),windP25:ne(d,.25),windP50:ne(d,.5),windP75:ne(d,.75),windP90:ne(d,.9),windMax:ne(d,1)',
      'wind',
    ],
    [
      'gustP10:ne(G,.1),gustP25:ne(G,.25),gustP50:ne(G,.5),gustP75:ne(G,.75),gustP90:ne(G,.9)',
      'gustMin:ne(G,0),gustP10:ne(G,.1),gustP25:ne(G,.25),gustP50:ne(G,.5),gustP75:ne(G,.75),gustP90:ne(G,.9),gustMax:ne(G,1)',
      'windstoten',
    ],
    [
      'humidityP10:ne(H,.1),humidityP25:ne(H,.25),humidityP50:ne(H,.5),humidityP75:ne(H,.75),humidityP90:ne(H,.9)',
      'humidityMin:ne(H,0),humidityP10:ne(H,.1),humidityP25:ne(H,.25),humidityP50:ne(H,.5),humidityP75:ne(H,.75),humidityP90:ne(H,.9),humidityMax:ne(H,1)',
      'relatieve vochtigheid',
    ],
  ];
  for (const [before, after, label] of spreadFields) {
    source = replaceOnce(source, before, after, `${c.path}: volledige spreiding ${label}`);
  }
  return source;
}

function patchNationalPlumeSearch(source, config) {
  if (!config.national) return source;

  const helperMarker = 'let lt=1;function Ah()';
  const helperSource = String.raw`async function weerlabPlumeJson(e,A=45e3){let t;for(let n=0;n<3;n++){const i=new AbortController,s=setTimeout(()=>i.abort(),A);try{const l=await fetch(e,{cache:"no-store",signal:i.signal});if(clearTimeout(s),l.status===429&&n<2){await new Promise(a=>setTimeout(a,1200*(n+1)));continue}if(!l.ok)throw new Error("HTTP "+l.status);const a=await l.json();if(a&&a.error)throw new Error(a.reason||"De databron gaf een fout.");return a}catch(l){clearTimeout(s),t=l;if(n<2)await new Promise(a=>setTimeout(a,700*(n+1)))}}throw new Error(t&&t.name==="AbortError"?"De databron reageerde niet op tijd.":t&&t.message||"De databron kon niet worden geladen.")}function weerlabPlumeUtc(e){const A=String(e||"");return Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(A)?A:A+"Z")}function weerlabPlumeMetaSentinel(e){return[e.last_run_initialisation_time,e.data_end_time,e.last_run_modification_time].join(":")}async function weerlabPlumeMeta(){const e=await weerlabPlumeJson("https://ensemble-api.open-meteo.com/data/ecmwf_ifs025_ensemble/static/meta.json?_weerlab_meta="+Date.now(),2e4),A=Number(e.last_run_initialisation_time),t=Number(e.data_end_time);if(!Number.isFinite(A)||!Number.isFinite(t)||t<=A)throw new Error("De ECMWF-runmetadata is ongeldig.");return{...e,last_run_initialisation_time:A,data_end_time:t}}function weerlabPlumeMemberKeys(e,A){return Object.keys(e).filter(t=>t===A||t.startsWith(A+"_member")).sort((t,n)=>t===A?-1:n===A?1:Number(t.split("_member")[1])-Number(n.split("_member")[1]))}function weerlabPlumeApiUrl(e,A,t){const n=new Date(A.last_run_initialisation_time*1e3).toISOString().slice(0,16),i=new Date(A.data_end_time*1e3).toISOString().slice(0,16),s=new URL("https://ensemble-api.open-meteo.com/v1/ensemble");s.searchParams.set("latitude",e.lat),s.searchParams.set("longitude",e.lon),s.searchParams.set("hourly","temperature_2m,precipitation,wind_speed_10m,cloud_cover,relative_humidity_2m,wind_gusts_10m"),s.searchParams.set("models","ecmwf_ifs025"),s.searchParams.set("start_hour",n),s.searchParams.set("end_hour",i),s.searchParams.set("timezone","GMT"),s.searchParams.set("wind_speed_unit","kmh"),s.searchParams.set("temporal_resolution","native");let l=s.toString();return typeof location<"u"&&location.protocol==="https:"&&/(^|\.)weerlab\.nl$/.test(location.hostname)&&(l=l.replace("https://ensemble-api.open-meteo.com/v1/ensemble","https://om.weerlab.nl/om/ensemble"),l+=(l.includes("?")?"&":"?")+"_weerlab_fresh="+t),l}function weerlabPlumeDocument(e,A,t){const n=e&&e.hourly;if(!n||!Array.isArray(n.time))throw new Error("De ECMWF-pluim bevat geen tijdas.");const i=["temperature_2m","precipitation","wind_speed_10m","cloud_cover","relative_humidity_2m","wind_gusts_10m"],required=new Set(["temperature_2m","precipitation","wind_speed_10m","cloud_cover","wind_gusts_10m"]),unavailable=new Set(Array.isArray(e==null?void 0:e.weerlab_unavailable_variables)?e.weerlab_unavailable_variables:[]),s={};for(const p of i){if(unavailable.has(p)){if(required.has(p))throw new Error(p+" ontbreekt in de gekozen run.");continue}const m=weerlabPlumeMemberKeys(n,p);if(m.length!==51){if(!required.has(p))continue;throw new Error(p+": "+m.length+" leden ontvangen; exact 51 vereist.")}s[p]=m}const l=[...Object.values(s).flatMap(p=>p.map(m=>n[m].length))];if(!l.length||new Set(l).size!==1||n.time.length<l[0])throw new Error("De ECMWF-leden hebben geen gelijke lengte.");const a=l[0],u=n.time.slice(0,a).map(weerlabPlumeUtc),w=A.last_run_initialisation_time*1e3,E=A.data_end_time*1e3,C=n.time.length>a?weerlabPlumeUtc(n.time[a]):u[u.length-1];if(u[0]!==w||C!==E)throw new Error("De ECMWF-pluim dekt niet exact de geverifieerde run.");const shortRun=[6,18].includes(new Date(w).getUTCHours()),minimum=shortRun?5*864e5:15*864e5;if(u.some((p,m)=>!Number.isFinite(p)||(m&&p<=u[m-1]))||u[u.length-1]-w<minimum)throw new Error("De ECMWF-pluim heeft geen volledige tijdas voor deze cyclus.");const R=p=>(s[p]||[]).map(m=>n[m].map((v,D)=>{if(v==null)throw new Error(p+" bevat een ontbrekende waarde bij stap "+D+".");const H=Number(v);if(!Number.isFinite(H))throw new Error(p+" bevat een ontbrekende waarde bij stap "+D+".");return H})),$={run:new Date(w).toISOString(),fetched:new Date().toISOString(),t0_ms:u[0],times_ms:u,n:a,step_h:null,temp_members:R("temperature_2m"),precip_members:R("precipitation"),wind_members:R("wind_speed_10m"),cloud_members:R("cloud_cover"),humidity_members:R("relative_humidity_2m"),gust_members:R("wind_gusts_10m"),source:{model:"ecmwf_ifs025_ensemble",run_initialisation:new Date(w).toISOString(),grid_latitude:e.latitude,grid_longitude:e.longitude}};return{schema:3,station:t.name,lat:t.lat,lon:t.lon,updated:new Date(Number(A.last_run_modification_time||A.last_run_availability_time||A.last_run_initialisation_time)*1e3).toISOString(),runs:[$]}}async function weerlabLoadPlumeLocation(e){await globalThis.WeerlabPlumeRuns?.ensureLocation?.(e.lat,e.lon);for(let A=0;A<2;A++){const t=await weerlabPlumeMeta(),n=await weerlabPlumeJson(weerlabPlumeApiUrl(e,t,Date.now()),6e4),i=await weerlabPlumeMeta();if(weerlabPlumeMetaSentinel(t)===weerlabPlumeMetaSentinel(i))return weerlabPlumeDocument(n,t,e)}throw new Error("De ECMWF-run wisselde tijdens het laden; probeer het opnieuw.")}async function weerlabSearchPlumePlaces(e){const A=String(e||"").trim();if(A.length<2)throw new Error("Typ minimaal twee letters van een plaatsnaam.");const t=await weerlabPlumeJson("https://geocoding-api.open-meteo.com/v1/search?name="+encodeURIComponent(A)+"&count=8&language=nl&format=json",2e4),n=Array.isArray(t.results)?t.results:[];return n.map(i=>{const s=Number(i.latitude),l=Number(i.longitude);if(!Number.isFinite(s)||!Number.isFinite(l))return null;const a=String(i.name||A),u=i.country_code&&i.country_code!=="NL"?a+" ("+i.country_code+")":a,w=[i.admin1,i.country].filter((E,C,R)=>E&&R.indexOf(E)===C).join(" · ");return{name:u,label:a,detail:w,lat:s,lon:l}}).filter(Boolean)}const weerlabPlumePanels=[{key:"temperature",label:"Temperatuur"},{key:"precipitation",label:"Neerslag"},{key:"wind",label:"Windkracht"},{key:"cloud",label:"Zon & bewolking"},{key:"humidity",label:"Relatieve vochtigheid"},{key:"accumulation",label:"Neerslagaccumulatie"},{key:"gusts",label:"Windstoten"}];function weerlabPlumePanelKeys(e){const A=["temperature","precipitation","wind","cloud"],t=[],n=Array.isArray(e==null?void 0:e.panelKeys)?e.panelKeys:[],available=Array.isArray(e==null?void 0:e.availablePanels)?e.availablePanels:weerlabPlumePanels.map(s=>s.key);for(const i of [...n,...A,...weerlabPlumePanels.map(s=>s.key)])weerlabPlumePanels.some(s=>s.key===i)&&available.includes(i)&&!t.includes(i)&&t.length<4&&t.push(i);return t}${helperMarker}`;
  const existingHelperStart = source.indexOf('async function weerlabPlumeJson');
  const helperEnd = source.indexOf(helperMarker, Math.max(0, existingHelperStart));
  if (existingHelperStart >= 0 && helperEnd > existingHelperStart) {
    source = source.slice(0, existingHelperStart) + helperSource + source.slice(helperEnd + helperMarker.length);
  } else {
    source = replaceOnce(source, helperMarker, helperSource, `${config.path}: dynamische pluimhelpers`);
  }

  const oldState = '[LA,gt]=z.useState({stationSlug:"debilt",summary:null,loading:!1,error:""})';
  const newState = '[LA,gt]=z.useState({location:null,summary:null,loading:!1,error:""}),[plumeQuery,setPlumeQuery]=z.useState(""),[plumeResults,setPlumeResults]=z.useState([]),[plumeSearching,setPlumeSearching]=z.useState(!1)';
  source = replaceOnceOrAlready(source, oldState, newState, `${config.path}: zoekstatus`);

  const oldLoader = 'Vo=z.useCallback(async o=>{const c=Br.find(f=>f.slug===o)||Br.find(f=>f.slug==="debilt");gt({stationSlug:c.slug,summary:null,loading:!0,error:""});try{const f=await Dr("readPlume",`pluim_trend_${c.slug}.json`),h=qw(f);gt(I=>I.stationSlug===c.slug?{stationSlug:c.slug,summary:{...h,station:c.name},loading:!1,error:""}:I)}catch(f){gt(h=>h.stationSlug===c.slug?{stationSlug:c.slug,summary:null,loading:!1,error:(f==null?void 0:f.message)||`De pluim voor ${c.name} kon niet worden geladen.`}:h)}},[]),qo=z.useCallback(()=>{s("select"),dA(null),n(null),Se("plume"),x("plumeNl"),!LA.summary&&!LA.loading&&Vo(LA.stationSlug||"debilt")},[LA.summary,LA.loading,LA.stationSlug,Vo])';
  const newLoader = 'Vo=z.useCallback(async o=>{const c={name:String((o==null?void 0:o.name)||"").trim(),lat:Number(o==null?void 0:o.lat),lon:Number(o==null?void 0:o.lon)};if(!c.name||!Number.isFinite(c.lat)||!Number.isFinite(c.lon)){gt(f=>({...f,error:"Kies eerst een geldig zoekresultaat."}));return}gt({location:c,summary:null,loading:!0,error:""});try{const f=await weerlabLoadPlumeLocation(c),h=qw(f);gt(I=>I.location&&I.location.lat===c.lat&&I.location.lon===c.lon?{location:c,summary:{...h,station:c.name,latitude:c.lat,longitude:c.lon},loading:!1,error:""}:I)}catch(f){gt(h=>h.location&&h.location.lat===c.lat&&h.location.lon===c.lon?{location:c,summary:null,loading:!1,error:(f==null?void 0:f.message)||`De pluim voor ${c.name} kon niet worden geladen.`}:h)}},[]),plumeSearch=z.useCallback(async()=>{const o=plumeQuery.trim();if(o.length<2){gt(c=>({...c,error:"Typ minimaal twee letters van een plaatsnaam."}));return}setPlumeSearching(!0),setPlumeResults([]),gt(c=>({...c,error:""}));try{const c=await weerlabSearchPlumePlaces(o);setPlumeResults(c),c.length||gt(f=>({...f,error:"Geen plaats gevonden. Probeer een andere schrijfwijze."}))}catch(c){gt(f=>({...f,error:(c==null?void 0:c.message)||"Plaatsen zoeken is mislukt."}))}finally{setPlumeSearching(!1)}},[plumeQuery]),qo=z.useCallback(()=>{s("select"),dA(null),n(null),Se("plume"),x("plumeNl")},[])';
  source = replaceOnceOrAlready(source, oldLoader, newLoader, `${config.path}: locatiezoeker en dynamische pluim`);

  const oldUi = 'r.jsx(eA,{children:"MOSMIX-plaats"}),r.jsx(Ge,{value:LA.stationSlug,onChange:o=>Vo(o.target.value),children:Br.map(o=>r.jsx("option",{value:o.slug,children:o.name},o.slug))}),r.jsxs("div",{style:{fontSize:10,color:"#64748B",lineHeight:1.45,marginTop:-3,marginBottom:9},children:["Alle ",Br.length," plaatsen uit de landelijke MOSMIX-feed zijn beschikbaar. De pluim gebruikt het ECMWF-ensemble op dezelfde locatie."]}),LA.loading&&r.jsxs("div",{style:{color:"#BAE6FD",fontSize:13,marginBottom:10},children:["⏳ Pluim voor ",((Jc=Br.find(o=>o.slug===LA.stationSlug))==null?void 0:Jc.name)||"de gekozen plaats"," laden…"]})';
  const newUi = 'r.jsx(eA,{children:"Zoek plaats voor pluim"}),r.jsxs("div",{style:{display:"flex",gap:6,marginBottom:8},children:[r.jsx("input",{value:plumeQuery,onChange:o=>{setPlumeQuery(o.target.value),setPlumeResults([])},onKeyDown:o=>{o.key==="Enter"&&(o.preventDefault(),plumeSearch())},placeholder:"Typ een plaatsnaam…",autoComplete:"off",style:{minWidth:0,flex:1,padding:"9px 10px",borderRadius:6,border:"1px solid #475569",background:"#0F172A",color:"#E2E8F0",fontSize:13,fontFamily:Q}}),r.jsx("button",{type:"button",onClick:plumeSearch,disabled:plumeSearching||plumeQuery.trim().length<2,style:{padding:"8px 11px",borderRadius:6,border:"1px solid #0EA5E9",background:"#075985",color:"#F0F9FF",cursor:plumeSearching?"wait":"pointer",fontWeight:800,fontFamily:Q,opacity:plumeQuery.trim().length<2?0.45:1},children:plumeSearching?"…":"Zoek"})]}),plumeResults.length>0&&r.jsx("div",{style:{marginBottom:8,border:"1px solid #334155",borderRadius:6,overflow:"hidden",background:"#0F172A"},children:plumeResults.map(o=>r.jsxs("button",{type:"button",onClick:()=>{setPlumeQuery(o.name),setPlumeResults([]),Vo(o)},style:{display:"block",width:"100%",padding:"8px 10px",border:0,borderBottom:"1px solid #1E293B",background:"transparent",color:"#E2E8F0",textAlign:"left",cursor:"pointer",fontFamily:Q},children:[r.jsx("span",{style:{display:"block",fontSize:13,fontWeight:800},children:o.label}),o.detail&&r.jsx("span",{style:{display:"block",fontSize:10,color:"#94A3B8",marginTop:2},children:o.detail})]},o.lat+","+o.lon))}),r.jsx("div",{style:{fontSize:10,color:"#64748B",lineHeight:1.45,marginBottom:9},children:"Kies zelf iedere plaats. De actuele ECMWF-pluim wordt voor de coördinaten van het gekozen zoekresultaat berekend."}),LA.loading&&r.jsxs("div",{style:{color:"#BAE6FD",fontSize:13,marginBottom:10},children:["⏳ Pluim voor ",(LA.location==null?void 0:LA.location.name)||"de gekozen plaats"," laden…"]})';
  source = replaceOnceOrAlready(source, oldUi, newUi, `${config.path}: zoekinterface`);
  source = replaceOnceOrAlready(
    source,
    'r.jsx("b",{children:"In één oogopslag:"})," temperatuur, neerslagkans, windkracht en zon/bewolking voor de komende 15 dagen.",r.jsx("br",{}),"Bij temperatuur en wind toont de donkere band de middelste 50% en de lichte band 80%. Onderaan zie je welk aandeel van de berekeningen zonnig of bewolkt uitpakt."',
    'r.jsx("b",{children:"Vier van zeven:"})," stel zelf vier grafieken samen voor de komende ECMWF-periode.",r.jsx("br",{}),"Kies uit temperatuur, neerslag, windkracht, zon/bewolking, relatieve vochtigheid, neerslagaccumulatie en windstoten. De vier vakken blijven altijd uit exact dezelfde run."',
    `${config.path}: uitleg samenstelbare pluim`,
  );

  source = replaceOnceOrAlready(
    source,
    'const o={id:lt++,type:"plumeOutlook",x:gA/2,y:xA/2,title:`Pluim ${LA.summary.station||"De Bilt"}`,...LA.summary};',
    'const o={id:lt++,type:"plumeOutlook",x:gA/2,y:xA/2,title:`Pluim ${LA.summary.station||"De Bilt"}`,...LA.summary,panelKeys:["temperature","precipitation","wind","cloud"]};',
    `${config.path}: standaard vier pluimvakken`,
  );

  const propertiesStart = source.indexOf('E.type==="plumeOutlook"&&r.jsxs(r.Fragment,{children:[');
  const propertiesEnd = source.indexOf(',E.type==="weekOutlook"', propertiesStart);
  if (propertiesStart < 0 || propertiesEnd < 0) throw new Error(`${config.path}: pluimeigenschappen niet gevonden`);
  const properties = String.raw`E.type==="plumeOutlook"&&r.jsxs(r.Fragment,{children:[r.jsxs("div",{style:{padding:"8px 10px",marginBottom:10,borderRadius:6,background:"rgba(8,145,178,.16)",border:"1px solid rgba(34,211,238,.35)",color:"#CFFAFE",fontSize:12,lineHeight:1.45},children:["ECMWF-pluim met ",E.memberCount||51," leden voor ",E.station||"De Bilt",". Kies hieronder vier verschillende grafieken; alle vier blijven gekoppeld aan exact dezelfde run."]}),r.jsx(eA,{children:"Titel"}),r.jsx(OA,{value:!E.title||E.title==="Landelijke pluim"?"Pluim "+(E.station||"De Bilt"):E.title,onChange:o=>V(E.id,{title:o.target.value})}),r.jsx(eA,{children:"Samenstelling · vier van zeven"}),weerlabPlumePanelKeys(E).map((o,c)=>r.jsxs("div",{style:{display:"grid",gridTemplateColumns:"40px 1fr",gap:6,alignItems:"center",marginBottom:7},children:[r.jsx("span",{style:{fontSize:11,fontWeight:850,color:"#67E8F9"},children:"Vak "+(c+1)}),r.jsx(Ge,{value:o,"aria-label":"Pluimgrafiek vak "+(c+1),onChange:f=>{const h=weerlabPlumePanelKeys(E),I=f.target.value;h.includes(I)&&h[c]!==I||(h[c]=I,V(E.id,{panelKeys:h}))},children:weerlabPlumePanels.map(f=>{const h=weerlabPlumePanelKeys(E),I=h.includes(f.key)&&f.key!==o,v=Array.isArray(E.availablePanels)&&!E.availablePanels.includes(f.key);return r.jsx("option",{value:f.key,disabled:I||v,children:f.label+(I?" · al gekozen":v?" · niet in deze run":"")},f.key)})})]},"plume-slot-"+c)),r.jsx("div",{style:{fontSize:10,color:"#94A3B8",lineHeight:1.45,marginTop:2},children:"Neerslagaccumulatie wordt per ensemblelid opgeteld. Windstoten staan in km/u; Beaufort blijft alleen bij de gemiddelde windkracht."})]})`;
  source = source.slice(0, propertiesStart) + properties + source.slice(propertiesEnd);

  return source;
}

function nationalPlumeRendererSource() {
  const source = String.raw`function eh({el:e,isSel:A,onMouseDown:t,selectionStyle:n}){
const i=jg(e.points||[]);if(i.length<2)return null;
const s=e.station||"De Bilt",l=!e.title||e.title==="Landelijke pluim"?"Pluim "+s:e.title,a=l.length>22?36:l.length>17?39:43,u=1e3,w=1400,C=e.x-u/2,k=e.y-w/2,B=C+92,p=C+u-42,y=p-B,b=i[0].t,J=i.at(-1).t,AA=P=>B+(Number(P)-b)/(J-b)*y,panels=weerlabPlumePanelKeys(e),runTime=new Date(e.run),runValid=Number.isFinite(runTime.getTime()),runHour=runValid?String(runTime.getUTCHours()).padStart(2,"0"):"--",runDate=runValid?new Intl.DateTimeFormat("nl-NL",{timeZone:"UTC",weekday:"long",day:"numeric",month:"long"}).format(runTime):"",updated=Ao(e.updated),period=new Intl.DateTimeFormat("nl-NL",{timeZone:"Europe/Amsterdam",weekday:"short",day:"numeric",month:"short"}),dateLabel=P=>period.format(new Date(P)).replaceAll(".","").toUpperCase(),number=P=>{const o=Number(P);return Number.isFinite(o)?o:null},values=P=>i.flatMap(o=>P.map(q=>number(o[q]))).filter(q=>q!=null),line=(P,o)=>i.reduce((q,v)=>{const h=number(v[P]);return h==null?q:q+(q?" L":"M")+AA(v.t).toFixed(1)+","+o(h).toFixed(1)},""),band=(P,o,q)=>{const v=i.filter(h=>number(h[P])!=null&&number(h[o])!=null);if(v.length<2)return"";const m=v.map(h=>AA(h.t).toFixed(1)+","+q(h[o]).toFixed(1)).join(" L"),f=[...v].reverse().map(h=>AA(h.t).toFixed(1)+","+q(h[P]).toFixed(1)).join(" L");return"M"+m+" L"+f+" Z"},dayParts=[];
i.forEach(P=>{const o=dateLabel(P.t),q=dayParts.at(-1);q&&q.key===o?q.end=P.t:dayParts.push({key:o,start:P.t,end:P.t})}),dayParts.forEach((P,o)=>{P.end=o<dayParts.length-1?dayParts[o+1].start:J});
const frame=(P,o,q)=>r.jsxs(r.Fragment,{children:[r.jsx("rect",{x:C+30,y:P-57,width:u-60,height:o+87,rx:18,fill:"rgba(15,34,55,.78)",stroke:"rgba(148,210,255,.16)",strokeWidth:1.3}),r.jsx("text",{x:C+52,y:P-31,fontSize:22,fontWeight:900,fill:"#F8FAFC",fontFamily:Q,children:q.title}),r.jsx("text",{x:C+52,y:P-10,fontSize:12,fontWeight:650,fill:"#94A3B8",fontFamily:Q,children:q.subtitle})]}),days=(P,o)=>dayParts.map((q,v)=>{const h=q.key.split(" "),m=h.shift(),f=h.join(" ");return r.jsxs("g",{children:[r.jsx("rect",{x:AA(q.start),y:P,width:Math.max(1,AA(q.end)-AA(q.start)),height:o,fill:v%2?"rgba(148,210,255,.035)":"transparent"}),r.jsx("line",{x1:AA(q.start),y1:P,x2:AA(q.start),y2:P+o,stroke:"rgba(148,163,184,.12)"}),r.jsx("text",{x:(AA(q.start)+AA(q.end))/2,y:P+o+20,textAnchor:"middle",fontSize:11,fontWeight:v===0?900:800,fill:v===0?"#67E8F9":"#E2E8F0",fontFamily:Q,children:m}),r.jsx("text",{x:(AA(q.start)+AA(q.end))/2,y:P+o+36,textAnchor:"middle",fontSize:9.5,fontWeight:700,fill:v===0?"#67E8F9":"#94A3B8",fontFamily:Q,children:f})]},q.key+"-"+P)}),unavailable=(P,o,q)=>r.jsxs("g",{children:[frame(P,o,q),r.jsx("text",{x:(B+p)/2,y:P+o/2+5,textAnchor:"middle",fontSize:16,fontWeight:750,fill:"#FCA5A5",fontFamily:Q,children:"Niet beschikbaar in deze opgeslagen ECMWF-run"}),days(P,o)]}),tickText=P=>Math.abs(P)>=10||Number.isInteger(P)?String(Math.round(P)):P.toFixed(1),bandPanel=(P,o,q)=>{const v=values([q.p10,q.p90]);if(!v.length)return unavailable(P,o,q);let h=q.min!=null?q.min:Math.min(...v),m=q.max!=null?q.max:Math.max(...v);if(q.zero)h=0;if(q.min!=null&&q.max!=null){}else if(q.round){m=Math.max(q.round,Math.ceil(m/q.round)*q.round)}else{const f=Math.max(q.minSpan||4,m-h),D=f*.12;h=Math.floor((h-D)/(q.step||1))*(q.step||1),m=Math.ceil((m+D)/(q.step||1))*(q.step||1)}if(m<=h)m=h+1;const f=D=>P+o-(D-h)/(m-h)*o,H=D=>Array.from({length:5},(_,M)=>h+(m-h)*M/4),Y=H(),M=q.color||"#38BDF8";return r.jsxs("g",{children:[frame(P,o,q),days(P,o),Y.map(D=>r.jsxs("g",{children:[r.jsx("line",{x1:B,y1:f(D),x2:p,y2:f(D),stroke:"rgba(148,163,184,.16)"}),r.jsx("text",{x:B-13,y:f(D)+4,textAnchor:"end",fontSize:11,fontWeight:650,fill:"#94A3B8",fontFamily:Q,children:tickText(D)+(q.unit||"")})]},q.key+"-tick-"+D)),r.jsx("path",{d:band(q.p10,q.p90,f),fill:q.outer||"rgba(56,189,248,.16)"}),r.jsx("path",{d:band(q.p25,q.p75,f),fill:q.inner||"rgba(56,189,248,.33)"}),r.jsx("path",{d:line(q.p50,f),fill:"none",stroke:M,strokeWidth:3,strokeLinecap:"butt",strokeLinejoin:"miter"}),q.bft&&[0,6,20,39,62,89,118].filter(D=>D>=h&&D<=m).map(D=>r.jsxs("g",{children:[r.jsx("line",{x1:p,y1:f(D),x2:p+6,y2:f(D),stroke:"rgba(196,181,253,.55)"}),r.jsx("text",{x:p+10,y:f(D)+4,fontSize:9,fontWeight:650,fill:"#C4B5FD",fontFamily:Q,children:Og(D)+" Bft"})]},"bft-"+D))]})},rainPanel=(P,o)=>{const q={title:"Neerslag",subtitle:"Kans per "+(Number(e.rainHours)||3)+" uur · lijn = mediaan in mm"},v=values(["rainChance"]),h=values(["rainP50","rainP90"]);if(!v.length)return unavailable(P,o,q);const m=Math.max(2,...h),f=Math.max(1,Math.ceil(m/2)*2),D=H=>P+o-Math.max(0,Math.min(100,H))/100*o,H=Y=>P+o-Math.max(0,Y)/f*o,Y=Math.max(3,y/i.length*.72);return r.jsxs("g",{children:[frame(P,o,q),days(P,o),[0,25,50,75,100].map(M=>r.jsxs("g",{children:[r.jsx("line",{x1:B,y1:D(M),x2:p,y2:D(M),stroke:"rgba(148,163,184,.16)"}),r.jsx("text",{x:B-13,y:D(M)+4,textAnchor:"end",fontSize:11,fill:"#94A3B8",fontFamily:Q,children:M+"%"})]},"rain-"+M)),i.map((M,W)=>{const L=number(M.rainChance);return L==null?null:r.jsx("rect",{x:AA(M.t)-Y/2,y:D(L),width:Y,height:P+o-D(L),rx:Y/2,fill:L>=70?"#0EA5E9":L>=25?"#38BDF8":"#7DD3FC",opacity:.62},"rain-bar-"+W)}),r.jsx("path",{d:line("rainP50",H),fill:"none",stroke:"#E0F2FE",strokeWidth:2.2,strokeLinecap:"butt",strokeLinejoin:"miter"}),[0,f/2,f].map(M=>r.jsx("text",{x:p+9,y:H(M)+4,fontSize:10,fill:"#BAE6FD",fontFamily:Q,children:tickText(M)+(M===f?" mm":"")},"rain-mm-"+M))]})},cloudPanel=(P,o)=>{const q={title:"Zon & bewolking",subtitle:"Aandeel van vier bewolkingsklassen"},v=["cloudSunnyPct","cloudLightPct","cloudMostlyPct","cloudOvercastPct"],h=values(v);if(!h.length)return unavailable(P,o,q);const m=Y=>P+o-Math.max(0,Math.min(100,Y))/100*o,f=(Y,M)=>{const W=i.filter(L=>v.every(R=>number(L[R])!=null));if(W.length<2)return"";const L=(R,ne)=>v.slice(0,ne).reduce((T,X)=>T+(number(R[X])||0),0),D=W.map(R=>AA(R.t).toFixed(1)+","+m(L(R,M+1)).toFixed(1)).join(" L"),H=[...W].reverse().map(R=>AA(R.t).toFixed(1)+","+m(L(R,M)).toFixed(1)).join(" L");return"M"+D+" L"+H+" Z"},D=["#FDE047","#FDE68A","#A89A68","#64748B"];return r.jsxs("g",{children:[frame(P,o,q),days(P,o),[0,25,50,75,100].map(Y=>r.jsxs("g",{children:[r.jsx("line",{x1:B,y1:m(Y),x2:p,y2:m(Y),stroke:"rgba(248,250,252,.18)"}),r.jsx("text",{x:B-13,y:m(Y)+4,textAnchor:"end",fontSize:11,fill:"#CBD5E1",fontFamily:Q,children:Y+"%"})]},"cloud-"+Y)),D.map((Y,M)=>r.jsx("path",{d:f(0,M),fill:Y,opacity:M<2?0.9:0.82},"cloud-area-"+M))]})},renderPanel=(P,o,q)=>{if(q==="temperature")return bandPanel(P,o,{key:q,title:"Temperatuur",subtitle:"Mediaan en middelste 50% / 80% in °C",p10:"tempP10",p25:"tempP25",p50:"tempP50",p75:"tempP75",p90:"tempP90",unit:"°",step:1,minSpan:6,color:"#22D3EE"});if(q==="precipitation")return rainPanel(P,o);if(q==="wind")return bandPanel(P,o,{key:q,title:"Windkracht",subtitle:"km/u links · Beaufort (Bft) rechts",p10:"windP10",p25:"windP25",p50:"windP50",p75:"windP75",p90:"windP90",unit:"",zero:!0,round:10,min:0,color:"#DDD6FE",outer:"rgba(167,139,250,.17)",inner:"rgba(167,139,250,.35)",bft:!0});if(q==="cloud")return cloudPanel(P,o);if(q==="humidity")return bandPanel(P,o,{key:q,title:"Relatieve vochtigheid",subtitle:"Mediaan en spreiding in procent",p10:"humidityP10",p25:"humidityP25",p50:"humidityP50",p75:"humidityP75",p90:"humidityP90",unit:"%",min:0,max:100,color:"#2DD4BF",outer:"rgba(45,212,191,.15)",inner:"rgba(45,212,191,.31)"});if(q==="accumulation")return bandPanel(P,o,{key:q,title:"Neerslagaccumulatie",subtitle:"Vanaf het begin van de run · per lid opgeteld",p10:"rainCumP10",p25:"rainCumP25",p50:"rainCumP50",p75:"rainCumP75",p90:"rainCumP90",unit:"",zero:!0,round:5,min:0,color:"#7DD3FC",outer:"rgba(56,189,248,.15)",inner:"rgba(56,189,248,.31)"});return bandPanel(P,o,{key:q,title:"Windstoten",subtitle:"Mediaan en spreiding in km/u",p10:"gustP10",p25:"gustP25",p50:"gustP50",p75:"gustP75",p90:"gustP90",unit:"",zero:!0,round:10,min:0,color:"#FB7185",outer:"rgba(251,113,133,.15)",inner:"rgba(251,113,133,.31)"})},top=k+235,panelHeight=155,gap=253;
return r.jsxs("g",{onMouseDown:t,style:{cursor:"grab"},children:[r.jsxs("defs",{children:[r.jsxs("linearGradient",{id:"plume-panel-"+e.id,x1:"0",y1:"0",x2:"1",y2:"1",children:[r.jsx("stop",{offset:"0%",stopColor:"#0B243D"}),r.jsx("stop",{offset:"55%",stopColor:"#102C49"}),r.jsx("stop",{offset:"100%",stopColor:"#123B52"})]})]}),r.jsx("rect",{x:0,y:0,width:gA,height:xA,fill:"rgba(4,13,24,.76)"}),r.jsx("rect",{x:C,y:k,width:u,height:w,rx:30,fill:"url(#plume-panel-"+e.id+")",stroke:"rgba(148,210,255,.28)",strokeWidth:2}),A&&r.jsx("rect",{x:C-5,y:k-5,width:u+10,height:w+10,rx:34,fill:"none",...n}),r.jsxs("g",{style:{pointerEvents:"none"},children:[r.jsx("circle",{cx:C+56,cy:k+56,r:17,fill:"#22D3EE"}),r.jsx("text",{x:C+90,y:k+60,fontSize:a,fontWeight:900,fill:"#F8FAFC",fontFamily:Q,children:l}),r.jsx("text",{x:C+91,y:k+96,fontSize:18,fontWeight:650,fill:"#BAE6FD",fontFamily:Q,children:"ECMWF IFS-ENS · "+(e.memberCount||51)+" leden · run "+runHour+" UTC"+(runDate?" · "+runDate:"")+" · "+(e.coverageHours||Math.round((J-b)/36e5))+" uur"}),r.jsx("text",{x:C+91,y:k+124,fontSize:14,fontWeight:550,fill:"#94A3B8",fontFamily:Q,children:dateLabel(b)+" t/m "+dateLabel(J)+(updated?" · bijgewerkt "+updated:"")}),r.jsx("text",{x:C+u-48,y:k+64,textAnchor:"end",fontSize:14,fontWeight:800,fill:"#67E8F9",fontFamily:Q,children:"4 VAN 7 ZELF GEKOZEN"}),panels.map((P,o)=>renderPanel(top+o*gap,panelHeight,P)),r.jsx("text",{x:C+52,y:k+w-25,fontSize:13,fontWeight:600,fill:"#64748B",fontFamily:Q,children:"Bron: ECMWF IFS-ENS · alle vier grafieken uit exact dezelfde run · referentiepunt "+s})]})]})}`;
  let styled = source.replace('Vanaf het begin van de run · per lid opgeteld', 'Vanaf het begin van de run · per lid opgeteld in mm');
  styled = replaceOnce(
    styled,
    'number=P=>{const o=Number(P);return Number.isFinite(o)?o:null}',
    'number=P=>{if(P==null||P==="")return null;const o=Number(P);return Number.isFinite(o)?o:null}',
    'landelijke pluim: ontbrekende renderwaarden blijven leeg',
  );
  styled = replaceOnce(
    styled,
    'p=C+u-42,y=p-B',
    'p=C+u-68,y=p-B',
    'landelijke pluim: rechterasmarge binnen paneel',
  );
  styled = replaceOnce(
    styled,
    'bandPanel=(P,o,q)=>{const v=values([q.p10,q.p90]);',
    'bandPanel=(P,o,q)=>{const v=values(q.low&&q.high?[q.low,q.high]:[q.p10,q.p90]);',
    'landelijke pluim: assen omvatten alle 51 leden',
  );
  styled = replaceOnce(
    styled,
    'r.jsx("path",{d:band(q.p10,q.p90,f),fill:q.outer||"rgba(56,189,248,.16)"}),r.jsx("path",{d:band(q.p25,q.p75,f),fill:q.inner||"rgba(56,189,248,.33)"})',
    'q.low&&q.high&&r.jsx("path",{d:band(q.low,q.high,f),fill:q.full||"rgba(56,189,248,.09)"}),r.jsx("path",{d:band(q.p10,q.p90,f),fill:q.outer||"rgba(56,189,248,.16)"}),r.jsx("path",{d:band(q.p25,q.p75,f),fill:q.inner||"rgba(56,189,248,.33)"}),q.low&&q.high&&r.jsxs(r.Fragment,{children:[r.jsx("path",{d:line(q.low,f),fill:"none",stroke:q.edge||"rgba(186,230,253,.42)",strokeWidth:.8,strokeDasharray:"2 3"}),r.jsx("path",{d:line(q.high,f),fill:"none",stroke:q.edge||"rgba(186,230,253,.42)",strokeWidth:.8,strokeDasharray:"2 3"})]})',
    'landelijke pluim: volledige min-maxband',
  );

  const bandRanges = [
    ['p10:"tempP10"', 'low:"tempMin",p10:"tempP10"', 'p90:"tempP90"', 'p90:"tempP90",high:"tempMax",full:"rgba(34,211,238,.09)"', 'temperatuur'],
    ['p10:"windP10"', 'low:"windMin",p10:"windP10"', 'p90:"windP90"', 'p90:"windP90",high:"windMax",full:"rgba(167,139,250,.09)"', 'wind'],
    ['p10:"humidityP10"', 'low:"humidityMin",p10:"humidityP10"', 'p90:"humidityP90"', 'p90:"humidityP90",high:"humidityMax",full:"rgba(45,212,191,.08)"', 'relatieve vochtigheid'],
    ['p10:"rainCumP10"', 'low:"rainCumMin",p10:"rainCumP10"', 'p90:"rainCumP90"', 'p90:"rainCumP90",high:"rainCumMax",full:"rgba(125,211,252,.08)"', 'neerslagaccumulatie'],
    ['p10:"gustP10"', 'low:"gustMin",p10:"gustP10"', 'p90:"gustP90"', 'p90:"gustP90",high:"gustMax",full:"rgba(251,113,133,.08)"', 'windstoten'],
  ];
  for (const [p10Before, p10After, p90Before, p90After, label] of bandRanges) {
    styled = replaceOnce(styled, p10Before, p10After, `landelijke pluim: minimum ${label}`);
    styled = replaceOnce(styled, p90Before, p90After, `landelijke pluim: maximum ${label}`);
  }

  styled = replaceOnce(
    styled,
    'subtitle:"Mediaan en middelste 50% / 80% in °C"',
    'subtitle:"Mediaan · middelste 50% / 80% · alle 51 leden in °C"',
    'landelijke pluim: volledige temperatuurspreiding benoemd',
  );
  styled = replaceOnce(
    styled,
    'subtitle:"Aandeel van vier bewolkingsklassen"',
    'subtitle:"Aandeel van alle 51 leden in vier bewolkingsklassen"',
    'landelijke pluim: bewolkingsaandelen benoemd',
  );
  styled = replaceOnce(
    styled,
    'tickText=P=>Math.abs(P)>=10||Number.isInteger(P)?String(Math.round(P)):P.toFixed(1)',
    'tickText=P=>Number.isInteger(P)?String(P):P.toFixed(1).replace(/\\.0$/,"")',
    'landelijke pluim: eerlijke y-aslabels',
  );

  styled = replaceOnce(
    styled,
    'const q={title:"Neerslag",subtitle:"Kans per "+(Number(e.rainHours)||3)+" uur · lijn = mediaan in mm"}',
    'const q={title:"Neerslag",subtitle:"Staaf = kans · mm: P50 + middenbanden · stip/pijl = hoogste lid"}',
    'landelijke pluim: neerslaglegenda',
  );
  styled = replaceOnce(
    styled,
    'H=Y=>P+o-Math.max(0,Y)/f*o',
    'H=Y=>P+o-Math.max(0,Math.min(f,Y))/f*o',
    'landelijke pluim: extreme neerslag binnen plot',
  );
  styled = replaceOnce(
    styled,
    '),r.jsx("path",{d:line("rainP50",H),fill:"none",stroke:"#E0F2FE"',
    '),r.jsx("path",{d:band("rainP10","rainP90",H),fill:"rgba(125,211,252,.16)"}),r.jsx("path",{d:band("rainP25","rainP75",H),fill:"rgba(186,230,253,.28)"}),i.map((M,W)=>{const R=number(M.rainMax);if(R==null)return null;const T=AA(M.t);return R>f?r.jsx("path",{d:"M"+(T-2)+","+(P+4)+" L"+T+","+P+" L"+(T+2)+","+(P+4)+" Z",fill:"#E0F2FE",opacity:.48},"rain-extreme-"+W):r.jsx("circle",{cx:T,cy:H(R),r:1.4,fill:"#E0F2FE",opacity:.5},"rain-extreme-"+W)}),r.jsx("path",{d:line("rainP50",H),fill:"none",stroke:"#E0F2FE"',
    'landelijke pluim: neerslagbanden en uitersten',
  );
  styled = replaceOnce(
    styled,
    'D.map((Y,M)=>r.jsx("path",{d:f(0,M),fill:Y,opacity:M<2?0.9:0.82},"cloud-area-"+M))]})',
    'D.map((Y,M)=>r.jsx("path",{d:f(0,M),fill:Y,opacity:M<2?0.9:0.82},"cloud-area-"+M)),r.jsx("g",{children:D.map((Y,M)=>r.jsxs("g",{children:[r.jsx("rect",{x:p-356+M*86,y:P-43,width:16,height:8,rx:2,fill:Y}),r.jsx("text",{x:p-334+M*86,y:P-35,fontSize:9,fontWeight:700,fill:"#CBD5E1",fontFamily:Q,children:["≤20%","20–50%","50–80%",">80%"][M]})]},"cloud-legend-"+M))})]})',
    'landelijke pluim: bewolkingsklasselegenda',
  );
  styled = replaceOnce(styled, 'x:C+30,y:P-57,width:u-60,height:o+87,rx:18', 'x:C+26,y:P-55,width:u-52,height:o+108,rx:20', 'landelijke pluim: datumstrook binnen paneelkaart');
  styled = replaceOnce(styled, 'x:C+52,y:P-31,fontSize:22', 'x:C+52,y:P-32,fontSize:24', 'landelijke pluim: krachtige paneeltitel');
  styled = replaceOnce(styled, 'x:C+52,y:P-10,fontSize:12', 'x:C+52,y:P-11,fontSize:13', 'landelijke pluim: leesbaar paneelbijschrift');
  styled = replaceOnce(styled, 'top=k+235,panelHeight=155,gap=253', 'top=k+200,panelHeight=165,gap=282', 'landelijke pluim: vier panelen binnen het PNG-canvas');
  styled = replaceOnce(styled, 'u=1e3,w=1400,C=e.x-u/2', 'u=1e3,w=1320,C=e.x-u/2', 'landelijke pluim: boven- en onderrand volledig zichtbaar');
  styled = replaceOnce(styled, 'y:P+o+20,textAnchor:"middle"', 'y:P+o+22,textAnchor:"middle"', 'landelijke pluim: dagnaam vrij van grafiekrand');
  styled = replaceOnce(styled, 'y:P+o+36,textAnchor:"middle"', 'y:P+o+40,textAnchor:"middle"', 'landelijke pluim: datum vrij onder dagnaam');
  styled = replaceOnce(
    styled,
    'stopColor:"#123B52"})]})]})',
    'stopColor:"#123B52"})]}),r.jsxs("linearGradient",{id:"plume-temp-"+e.id,x1:"0",y1:"1",x2:"0",y2:"0",children:[r.jsx("stop",{offset:"0%",stopColor:"#2DD4BF"}),r.jsx("stop",{offset:"38%",stopColor:"#22D3EE"}),r.jsx("stop",{offset:"62%",stopColor:"#FACC15"}),r.jsx("stop",{offset:"82%",stopColor:"#FB923C"}),r.jsx("stop",{offset:"100%",stopColor:"#F87171"})]})]})',
    'landelijke pluim: temperatuurverloop',
  );
  styled = replaceOnce(
    styled,
    'Y=H(),M=q.color||"#38BDF8";return',
    'Y=H(),M=q.gradient?"url(#plume-temp-"+e.id+")":q.color||"#38BDF8";return',
    'landelijke pluim: temperatuurlijn gebruikt kleurverloop',
  );
  styled = replaceOnce(
    styled,
    'r.jsx("path",{d:line(q.p50,f),fill:"none",stroke:M,strokeWidth:3,strokeLinecap:"butt",strokeLinejoin:"miter"}),q.bft&&',
    'q.gradient&&r.jsx("path",{d:line(q.p50,f),fill:"none",stroke:"#22D3EE",strokeWidth:11,strokeLinecap:"round",strokeLinejoin:"round",opacity:.14}),r.jsx("path",{d:line(q.p50,f),fill:"none",stroke:M,strokeWidth:q.gradient?4.5:3,strokeLinecap:q.gradient?"round":"butt",strokeLinejoin:q.gradient?"round":"miter"}),q.legend&&r.jsxs("g",{children:[r.jsx("rect",{x:p-222,y:P-54,width:210,height:54,rx:12,fill:"rgba(2,12,25,.78)",stroke:"rgba(148,210,255,.12)"}),r.jsx("rect",{x:p-207,y:P-48,width:30,height:8,rx:4,fill:q.full||"rgba(56,189,248,.09)"}),r.jsx("line",{x1:p-207,x2:p-177,y1:P-44,y2:P-44,stroke:"#BAE6FD",strokeWidth:1.5,strokeDasharray:"4 3"}),r.jsx("text",{x:p-167,y:P-40,fontSize:10,fontWeight:700,fill:"#BAE6FD",fontFamily:Q,children:"alle 51 leden (min–max)"}),r.jsx("rect",{x:p-207,y:P-32,width:30,height:8,rx:4,fill:q.outer||"rgba(56,189,248,.16)"}),r.jsx("text",{x:p-167,y:P-24,fontSize:10,fontWeight:700,fill:"#CBD5E1",fontFamily:Q,children:"middelste 80%"}),r.jsx("rect",{x:p-207,y:P-16,width:30,height:8,rx:4,fill:q.inner||"rgba(56,189,248,.33)"}),r.jsx("line",{x1:p-207,x2:p-177,y1:P-12,y2:P-12,stroke:M,strokeWidth:2}),r.jsx("text",{x:p-167,y:P-8,fontSize:10,fontWeight:700,fill:"#E2E8F0",fontFamily:Q,children:"middelste 50% · lijn P50"})]}),q.bft&&',
    'landelijke pluim: bandlegenda en warme lijn',
  );
  styled = replaceOnce(
    styled,
    'r.jsx("rect",{x:p-207,y:P-32,width:30,height:8,rx:4,fill:q.outer||"rgba(56,189,248,.16)"})',
    'r.jsx("rect",{x:p-207,y:P-32,width:30,height:8,rx:4,fill:q.full||"rgba(56,189,248,.09)"}),r.jsx("rect",{x:p-207,y:P-32,width:30,height:8,rx:4,fill:q.outer||"rgba(56,189,248,.16)"})',
    'landelijke pluim: 80%-legendaswatch volgt laagopbouw',
  );
  styled = replaceOnce(
    styled,
    'r.jsx("rect",{x:p-207,y:P-16,width:30,height:8,rx:4,fill:q.inner||"rgba(56,189,248,.33)"})',
    'r.jsx("rect",{x:p-207,y:P-16,width:30,height:8,rx:4,fill:q.full||"rgba(56,189,248,.09)"}),r.jsx("rect",{x:p-207,y:P-16,width:30,height:8,rx:4,fill:q.outer||"rgba(56,189,248,.16)"}),r.jsx("rect",{x:p-207,y:P-16,width:30,height:8,rx:4,fill:q.inner||"rgba(56,189,248,.33)"})',
    'landelijke pluim: 50%-legendaswatch volgt laagopbouw',
  );
  styled = replaceOnce(
    styled,
    'minSpan:6,color:"#22D3EE"',
    'minSpan:6,color:"#22D3EE",gradient:!0,legend:!0',
    'landelijke pluim: temperatuuraccenten actief',
  );
  for (const [before, after, label] of [
    ['inner:"rgba(167,139,250,.35)",bft:!0', 'inner:"rgba(167,139,250,.35)",legend:!0,bft:!0', 'wind'],
    ['inner:"rgba(45,212,191,.31)"', 'inner:"rgba(45,212,191,.31)",legend:!0', 'relatieve vochtigheid'],
    ['inner:"rgba(56,189,248,.31)"', 'inner:"rgba(56,189,248,.31)",legend:!0', 'neerslagaccumulatie'],
    ['inner:"rgba(251,113,133,.31)"', 'inner:"rgba(251,113,133,.31)",legend:!0', 'windstoten'],
  ]) {
    styled = replaceOnce(styled, before, after, `landelijke pluim: bandlegenda ${label}`);
  }
  styled = replaceOnce(
    styled,
    'r.jsx("circle",{cx:C+56,cy:k+56,r:17,fill:"#22D3EE"}),r.jsx("text",{x:C+90',
    'r.jsx("circle",{cx:C+56,cy:k+56,r:17,fill:"#22D3EE"}),r.jsx("path",{d:"M"+(C+44)+","+(k+59)+" L"+(C+51)+","+(k+50)+" L"+(C+57)+","+(k+55)+" L"+(C+67)+","+(k+45),fill:"none",stroke:"#073B57",strokeWidth:4,strokeLinecap:"round",strokeLinejoin:"round"}),r.jsx("text",{x:C+90',
    'landelijke pluim: herkenbaar pluimicoon',
  );
  styled = replaceOnce(
    styled,
    'r.jsx("text",{x:C+u-48,y:k+64,textAnchor:"end",fontSize:14,fontWeight:800,fill:"#67E8F9",fontFamily:Q,children:"4 VAN 7 ZELF GEKOZEN"})',
    'r.jsx("rect",{x:C+u-260,y:k+34,width:212,height:43,rx:22,fill:"rgba(8,145,178,.18)",stroke:"rgba(103,232,249,.34)"}),r.jsx("text",{x:C+u-154,y:k+61,textAnchor:"middle",fontSize:13,fontWeight:850,fill:"#CFFAFE",fontFamily:Q,children:"BREDE BAND = ONZEKER"}),r.jsx("text",{x:C+u-48,y:k+98,textAnchor:"end",fontSize:11,fontWeight:800,fill:"#67E8F9",fontFamily:Q,children:"4 VAN 7 ZELF GEKOZEN"})',
    'landelijke pluim: onzekerheidspil',
  );
  return styled;
}

function patchNationalPlumeRenderer(source, config) {
  if (!config.national) return source;
  const start = source.indexOf('function eh({el:e,isSel:A,onMouseDown:t,selectionStyle:n})');
  const end = source.indexOf('function th(', start);
  if (start < 0 || end < 0) throw new Error(`${config.path}: landelijke pluimrenderer niet gevonden`);
  return source.slice(0, start) + nationalPlumeRendererSource() + source.slice(end);
}

function patchNationalModePalette(source, config) {
  if (!config.national) return source;

  const hiddenModes = '["plume","knmi"].includes(Vg)';
  const visibleGuard = `!${hiddenModes}&&`;
  const hiddenGuard = `${hiddenModes}?null:`;

  // Oude patchruns konden dezelfde moduswacht opnieuw vóór zichzelf zetten,
  // omdat de ongepatchte tekst ook in de gepatchte tekst voorkwam. Ruim die
  // herhalingen eerst op en houd de patch daarna werkelijk idempotent.
  while (source.includes(visibleGuard + visibleGuard)) {
    source = source.replaceAll(visibleGuard + visibleGuard, visibleGuard);
  }
  while (source.includes(hiddenGuard + hiddenGuard)) {
    source = source.replaceAll(hiddenGuard + hiddenGuard, hiddenGuard);
  }

  const recentStart = 'tn.length>0&&r.jsxs("div"';
  if (!source.includes(visibleGuard + recentStart)) {
    source = replaceOnce(source, recentStart, visibleGuard + recentStart, `${config.path}: recente symbolen verbergen bij pluim en metingen`);
  }

  const filterStart = 'r.jsxs("div",{style:{display:"flex",alignItems:"center",gap:5,margin:"5px 0 6px",flexWrap:"wrap"},children:[r.jsx("span",{style:{fontSize:11,color:"#94A3B8",minWidth:85,textAlign:"right",marginRight:3,fontWeight:700},children:"Symboolfilter"})';
  if (!source.includes(visibleGuard + filterStart)) {
    source = replaceOnce(source, filterStart, visibleGuard + filterStart, `${config.path}: symboolfilters verbergen bij pluim en metingen`);
  }

  const catalogStart = 'K==="alles"?Ol.map(';
  if (!source.includes(hiddenGuard + catalogStart)) {
    source = replaceOnce(source, catalogStart, hiddenGuard + catalogStart, `${config.path}: symbolencatalogus verbergen bij pluim en metingen`);
  }

  const addToolbarStart = 'r.jsxs("div",{style:{background:"#1a2436",borderBottom:"1px solid rgba(255,255,255,0.1)",borderLeft:"1px solid rgba(255,255,255,0.08)",padding:"7px 12px",display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",gridColumn:2,gridRow:2,minWidth:0,maxHeight:"24vh",overflowY:"auto",overscrollBehavior:"contain"},children:[r.jsx("span",{style:{fontSize:11,color:"#94A3B8",fontWeight:800,letterSpacing:".04em"},children:"TOEVOEGEN"})';
  if (!source.includes(visibleGuard + addToolbarStart)) {
    source = replaceOnce(source, addToolbarStart, visibleGuard + addToolbarStart, `${config.path}: algemene toevoegbalk verbergen bij pluim en metingen`);
  }
  return source;
}

function patchNationalSimpleMenu(source, config) {
  if (!config.national) return source;

  const duplicateModeButtons = 'r.jsxs(r.Fragment,{children:[r.jsx("button",{onClick:()=>{Se("single"),Zo()},style:qe(g==="mosmixNl"&&TA==="single"),children:"🌦 Verwachting"}),r.jsx("button",{onClick:qo,style:qe(g==="plumeNl"),children:"📈 Pluim"}),r.jsx("button",{onClick:hi,style:qe(g==="knmiExtremes"),children:"📊 KNMI metingen"}),r.jsx("div",{style:{width:1,height:22,background:"rgba(255,255,255,0.12)"}})]}),!1,';
  const simpleMenuLabel = 'r.jsx("span",{style:{fontSize:11,color:"#94A3B8",fontWeight:800,letterSpacing:".04em"},children:"TOEVOEGEN"}),!1,';
  return replaceOnceOrAlready(
    source,
    duplicateModeButtons,
    simpleMenuLabel,
    `${config.path}: dubbele modusknoppen uit onderste werkbalk`,
  );
}

function patchNationalSeparatePages(source, config) {
  if (!config.national) return source;

  const internalModeNavigation = 'r.jsx("div",{style:{display:"grid",gridTemplateColumns:"repeat(5,minmax(0,1fr))",gap:4,padding:4,marginBottom:7,borderRadius:9,background:"#111C2E",border:"1px solid rgba(148,163,184,.28)",flexShrink:0,zIndex:20,boxShadow:"0 7px 14px rgba(15,23,42,.72)"},children:[["landelijk","🇳🇱 Kaart Landelijk"],["week","🗓 Meerdaagse Landelijk"],["plume","📈 Pluim"],["regio","🗺 Kaart Regio"],["knmi","📊 KNMI metingen"]].map(([o,c])=>{const f=Vg===o;return r.jsx("button",{onClick:()=>_o(o),style:{...Ve("_"),justifyContent:"center",minWidth:0,minHeight:38,padding:"7px 6px",whiteSpace:"normal",lineHeight:1.15,textAlign:"center",border:f?"2px solid #60A5FA":"1px solid transparent",background:f?"rgba(37,99,235,.32)":"transparent",color:f?"#EFF6FF":"#CBD5E1",fontWeight:f?850:650},children:c},o)})})';
  const hiddenInternalModeNavigation = 'r.jsx("div",{"data-weerlab-hidden-mode-nav":!0,style:{display:"none"}})';
  source = replaceOnceOrAlready(
    source,
    internalModeNavigation,
    hiddenInternalModeNavigation,
    `${config.path}: dubbele interne paginanavigatie verbergen`,
  );

  const originalMenu = '_o=z.useCallback(o=>{if(o==="regio"){window.location.href="weerbewaking_regio_kaart.html";return}if(o==="knmi"){hi();return}if(o==="plume"){qo();return}Se(o==="week"?"week":"single"),Zo()},[hi,qo,Zo])';
  const reloadMenu = '_o=z.useCallback(o=>{const c={landelijk:"weerbewaking_landelijke_kaart.html",week:"weerbewaking_landelijke_meerdaagse.html",plume:"weerbewaking_landelijke_pluim.html",regio:"weerbewaking_regio_kaart.html",knmi:"weerbewaking_knmi_metingen.html"}[o];if(c&&!window.location.pathname.endsWith("/"+c)){window.location.href=c;return}if(o==="regio")return;if(o==="knmi"){hi();return}if(o==="plume"){qo();return}Se(o==="week"?"week":"single"),Zo()},[hi,qo,Zo])';
  const seamlessMenuV1 = '_o=z.useCallback(o=>{const c={landelijk:"weerbewaking_landelijke_kaart.html",week:"weerbewaking_landelijke_meerdaagse.html",plume:"weerbewaking_landelijke_pluim.html",regio:"weerbewaking_regio_kaart.html",knmi:"weerbewaking_knmi_metingen.html"}[o];if(o==="regio"){window.location.pathname.endsWith("/"+c)||(window.location.href=c);return}c&&!window.location.pathname.endsWith("/"+c)&&history.replaceState(null,"",c);if(o==="knmi"){hi();return}if(o==="plume"){qo();return}Se(o==="week"?"week":"single"),Zo()},[hi,qo,Zo])';
  const seamlessMenuV2 = '_o=z.useCallback(o=>{const c={landelijk:"weerbewaking_landelijke_kaart.html",week:"weerbewaking_landelijke_meerdaagse.html",plume:"weerbewaking_landelijke_pluim.html",regio:"weerbewaking_regio_kaart.html",knmi:"weerbewaking_knmi_metingen.html"}[o];if(o==="regio"){window.location.pathname.endsWith("/"+c)||(window.location.href=c);return}c&&!window.location.pathname.endsWith("/"+c)&&history.replaceState(null,"",c),window.dispatchEvent(new CustomEvent("weerlab:editor-mode-change",{detail:{mode:o}}));if(o==="knmi"){hi();return}if(o==="plume"){qo();return}Se(o==="week"?"week":"single"),Zo()},[hi,qo,Zo])';
  const seamlessMenuV3 = '_o=z.useCallback(o=>{const c={landelijk:"weerbewaking_landelijke_kaart.html",week:"weerbewaking_landelijke_meerdaagse.html",plume:"weerbewaking_landelijke_pluim.html",regio:"weerbewaking_regio_kaart.html",knmi:"weerbewaking_knmi_metingen.html"}[o];if(window.parent!==window){window.parent.postMessage({type:"weerlab-editor-mode",mode:o},window.location.origin);return}if(o==="regio"){window.location.pathname.endsWith("/"+c)||(window.location.href=c);return}c&&!window.location.pathname.endsWith("/"+c)&&history.replaceState(null,"",c),window.dispatchEvent(new CustomEvent("weerlab:editor-mode-change",{detail:{mode:o}}));if(o==="knmi"){hi();return}if(o==="plume"){qo();return}Se(o==="week"?"week":"single"),Zo()},[hi,qo,Zo])';
  const seamlessMenu = '_o=z.useCallback((o,c=!1)=>{const f={landelijk:"weerbewaking_landelijke_kaart.html",week:"weerbewaking_landelijke_meerdaagse.html",plume:"weerbewaking_landelijke_pluim.html",regio:"weerbewaking_regio_kaart.html",knmi:"weerbewaking_knmi_metingen.html"}[o];if(window.parent!==window&&!c){window.parent.postMessage({type:"weerlab-editor-mode",mode:o},window.location.origin);return}if(o==="regio"){window.location.pathname.endsWith("/"+f)||(window.location.href=f);return}f&&!window.location.pathname.endsWith("/"+f)&&history.replaceState(null,"",f),window.dispatchEvent(new CustomEvent("weerlab:editor-mode-change",{detail:{mode:o}}));if(o==="knmi"){hi();return}if(o==="plume"){qo();return}Se(o==="week"?"week":"single"),Zo()},[hi,qo,Zo])';
  if (source.includes(reloadMenu)) source = replaceOnce(source, reloadMenu, seamlessMenu, `${config.path}: naadloos paginamenu`);
  else if (source.includes(seamlessMenuV1)) source = replaceOnce(source, seamlessMenuV1, seamlessMenu, `${config.path}: runkeuze volgt editorpagina`);
  else if (source.includes(seamlessMenuV2)) source = replaceOnce(source, seamlessMenuV2, seamlessMenu, `${config.path}: vijf editorpanelen in hoofdsite`);
  else if (source.includes(seamlessMenuV3)) source = replaceOnce(source, seamlessMenuV3, seamlessMenu, `${config.path}: paginamodus in iframe toepassen`);
  else source = replaceOnceOrAlready(source, originalMenu, seamlessMenu, `${config.path}: vijf afzonderlijke editorpagina's`);
  source = replaceOnceOrAlready(
    source,
    'const o=new URLSearchParams(window.location.search).get("mode"),c=["landelijk","week","plume","knmi"].includes(o)?o:"landelijk";',
    'const o=globalThis.WEERLAB_EDITOR_MODE||new URLSearchParams(window.location.search).get("mode"),c=["landelijk","week","plume","knmi"].includes(o)?o:"landelijk";',
    `${config.path}: paginamodus uit wrapper`,
  );
  source = replaceOnceOrAlready(
    source,
    'const o=globalThis.WEERLAB_EDITOR_MODE||new URLSearchParams(window.location.search).get("mode"),c=["landelijk","week","plume","knmi"].includes(o)?o:"landelijk";_o(c)},[_o])',
    'const o=globalThis.WEERLAB_EDITOR_MODE||new URLSearchParams(window.location.search).get("mode"),c=["landelijk","week","plume","knmi"].includes(o)?o:"landelijk";_o(c,!0)},[_o])',
    `${config.path}: wrappermodus lokaal toepassen`,
  );
  const runHook = 'qo=z.useCallback(()=>{s("select"),dA(null),n(null),Se("plume"),x("plumeNl")},[])';
  const runEffects = 'plumeRunRefresh=z.useEffect(()=>{const o=()=>{LA.location&&Vo(LA.location)};return window.addEventListener("weerlab:plume-run-change",o),()=>window.removeEventListener("weerlab:plume-run-change",o)},[LA.location,Vo]),plumeElementRefresh=z.useEffect(()=>{LA.summary&&A(o=>o.map(c=>c.type==="plumeOutlook"&&((Number(c.latitude)===Number(LA.summary.latitude)&&Number(c.longitude)===Number(LA.summary.longitude))||c.station===LA.summary.station)?{...c,...LA.summary,title:c.title,panelKeys:c.panelKeys}:c))},[LA.summary])';
  const runHookWithRefresh = `${runHook},${runEffects}`;
  while (source.includes(`${runHookWithRefresh},${runEffects}`)) {
    source = replaceOnce(source, `${runHookWithRefresh},${runEffects}`, runHookWithRefresh, `${config.path}: dubbele pluimkoppeling verwijderen`);
  }
  if (!source.includes(runEffects)) {
    source = replaceOnce(source, runHook, runHookWithRefresh, `${config.path}: pluim behouden bij runwissel`);
  }

  const plumeAutoAnchor = '},[LA.summary,qA]),hi=z.useCallback';
  const plumeAutoOpen = '},[LA.summary,qA]),plumeInitial=z.useRef(!1),plumeInitialOpen=z.useEffect(()=>{if(TA!=="plume"||plumeInitial.current==="placed")return;if(!LA.location&&!LA.loading&&!LA.summary&&plumeInitial.current!=="loading"){plumeInitial.current="loading",Vo({name:"De Bilt",lat:52.101,lon:5.178});return}LA.summary&&!LA.loading&&(plumeInitial.current="placed",Yg())},[TA,LA.location,LA.loading,LA.summary,Vo,Yg]),hi=z.useCallback';
  source = replaceOnceOrAlready(
    source,
    plumeAutoAnchor,
    plumeAutoOpen,
    `${config.path}: nieuwste pluim direct openen`,
  );

  const knmiAutoAnchor = '},[kA,qA]),_o=z.useCallback';
  const knmiAutoOpen = '},[kA,qA]),knmiInitial=z.useRef(!1),knmiInitialOpen=z.useEffect(()=>{g==="knmiExtremes"&&kA.data&&kA.day&&!kA.loading&&!knmiInitial.current&&(knmiInitial.current=!0,bg())},[g,kA.data,kA.day,kA.loading,bg]),_o=z.useCallback';
  source = replaceOnceOrAlready(
    source,
    knmiAutoAnchor,
    knmiAutoOpen,
    `${config.path}: nieuwste KNMI-metingen direct openen`,
  );

  source = replaceOnceOrAlready(
    source,
    ']),n(null),x(null);const M=v.night===!0;',
    ']),n(null),x("knmiExtremes");const M=v.night===!0;',
    `${config.path}: KNMI-keuzepaneel openhouden na kaartplaatsing`,
  );

  source = replaceOnceOrAlready(
    source,
    '),o]),n(null),x(null),S("nederland"),d(!1),p(dt.nederland.day)},[LA.summary,qA])',
    '),o]),n(null),x("plumeNl"),S("nederland"),d(!1),p(dt.nederland.day)},[LA.summary,qA])',
    `${config.path}: pluimkeuzepaneel openhouden na kaartplaatsing`,
  );

  source = replaceOnceOrAlready(
    source,
    '),I]),n(null),x(null),S("nederland"),d(!1),p(dt.nederland.day)',
    '),I]),n(null),x("mosmixNl"),S("nederland"),d(!1),p(dt.nederland.day)',
    `${config.path}: meerdaagse keuzepaneel openhouden na kaartplaatsing`,
  );

  const weekAutoAnchor = '},[hA,Z.data,wA.data,qA]),Vo=z.useCallback';
  const weekAutoOpen = '},[hA,Z.data,wA.data,qA]),weekInitial=z.useRef(!1),weekInitialOpen=z.useEffect(()=>{const o=hA==="weatherpro"?wA.data:Z.data;TA==="week"&&o&&!weekInitial.current&&(weekInitial.current=!0,mg())},[TA,hA,Z.data,wA.data,mg]),Vo=z.useCallback';
  const weekAutoFinal = '},[hA,Z.data,wA.data,qA,weekStartOffset]),weekInitial=z.useRef(!1),weekInitialOpen=z.useEffect(()=>{const o=hA==="weatherpro"?wA.data:Z.data;TA==="week"&&o&&!weekInitial.current&&(weekInitial.current=!0,mg(weekStartOffset))},[TA,hA,Z.data,wA.data,mg,weekStartOffset]),Vo=z.useCallback';
  if (!source.includes(weekAutoFinal)) {
    source = replaceOnceOrAlready(
      source,
      weekAutoAnchor,
      weekAutoOpen,
      `${config.path}: actuele meerdaagse direct openen`,
    );
  }
  return source;
}

function patchNationalWeekStart(source, config) {
  if (!config.national) return source;

  const weekStartState = '[TA,Se]=z.useState("single"),[weekStartOffset,setWeekStartOffset]=z.useState(0),[Z,QA]=z.useState';
  const weekQuickEditState = '[TA,Se]=z.useState("single"),[weekStartOffset,setWeekStartOffset]=z.useState(0),[weekEditDay,setWeekEditDay]=z.useState(null),[Z,QA]=z.useState';
  const weekCustomPointState = '[TA,Se]=z.useState("single"),[weekStartOffset,setWeekStartOffset]=z.useState(0),[weekEditDay,setWeekEditDay]=z.useState(null),[customPoint,setCustomPoint]=z.useState';
  if (!source.includes(weekQuickEditState) && !source.includes(weekCustomPointState)) {
    source = replaceOnceOrAlready(
      source,
      '[TA,Se]=z.useState("single"),[Z,QA]=z.useState',
      weekStartState,
      `${config.path}: startkeuze meerdaagse bewaren`,
    );
  }

  source = replaceOnceOrAlready(
    source,
    'mg=z.useCallback(()=>{var v;const o=Array.from({length:7},(D,H)=>ye(H));',
    'mg=z.useCallback((weekStart=weekStartOffset)=>{var v;const weekOffset=weekStart===1?1:0,o=Array.from({length:7},(D,H)=>ye(H+weekOffset));',
    `${config.path}: meerdaagse vanaf gekozen dag opbouwen`,
  );

  const oldNextDay = 'ye(M+1)';
  const newNextDay = 'ye(M+weekOffset+1)';
  const oldNextDayCount = source.split(oldNextDay).length - 1;
  const newNextDayCount = source.split(newNextDay).length - 1;
  if (oldNextDayCount === 3 && newNextDayCount === 0) source = source.replaceAll(oldNextDay, newNextDay);
  else if (!(oldNextDayCount === 0 && newNextDayCount === 3)) {
    throw new Error(`${config.path}: nachten na gekozen startdag oud=${oldNextDayCount}, nieuw=${newNextDayCount}`);
  }

  source = replaceOnceOrAlready(
    source,
    'const D=`${f||"De bron"} heeft nog geen complete verwachting voor vandaag plus zes dagen.`;',
    'const D=`${f||"De bron"} heeft nog geen complete verwachting voor ${weekOffset?"morgen plus zes dagen":"vandaag plus zes dagen"}.`;',
    `${config.path}: foutmelding gekozen startdag`,
  );

  source = replaceOnceOrAlready(
    source,
    '},[hA,Z.data,wA.data,qA]),weekInitial=z.useRef(!1)',
    '},[hA,Z.data,wA.data,qA,weekStartOffset]),weekInitial=z.useRef(!1)',
    `${config.path}: startkeuze als meerdaagse-afhankelijkheid`,
  );
  source = replaceOnceOrAlready(
    source,
    'TA==="week"&&o&&!weekInitial.current&&(weekInitial.current=!0,mg())},[TA,hA,Z.data,wA.data,mg])',
    'TA==="week"&&o&&!weekInitial.current&&(weekInitial.current=!0,mg(weekStartOffset))},[TA,hA,Z.data,wA.data,mg,weekStartOffset])',
    `${config.path}: automatische meerdaagse met gekozen startdag`,
  );

  const oldWeekControls = 'r.jsx($e,{children:"Vandaag + 6 dagen"}),r.jsx("div",{style:{fontSize:11,color:"#A7F3D0",lineHeight:1.5,marginBottom:9},children:"Maximum en minimum tonen de landelijke bandbreedte over alle beschikbare plaatsen. Weerbeeld en wind blijven gebaseerd op De Bilt."})';
  const newWeekControls = 'r.jsx($e,{children:"Begin van de 7-daagse"}),r.jsx("div",{style:{display:"flex",gap:5,marginBottom:9},children:[["Vandaag",0],["Morgen",1]].map(([o,c])=>r.jsx("button",{type:"button",onClick:()=>{setWeekStartOffset(c),Ne.data&&mg(c)},style:{..._A,flex:1,border:weekStartOffset===c?"2px solid #34D399":"1px solid #475569",background:weekStartOffset===c?"rgba(5,150,105,.25)":"#334155",color:"#ECFDF5"},children:o},o))}),r.jsxs("div",{style:{fontSize:11,color:"#A7F3D0",lineHeight:1.5,marginBottom:9},children:["De kaart begint op ",weekStartOffset===0?"vandaag":"morgen",". Maximum en minimum tonen de landelijke bandbreedte over alle beschikbare plaatsen. Weerbeeld en wind blijven gebaseerd op De Bilt."]})';
  source = replaceOnceOrAlready(
    source,
    oldWeekControls,
    newWeekControls,
    `${config.path}: vandaag-morgenknoppen voor meerdaagse`,
  );
  source = replaceOnceOrAlready(
    source,
    'Ne.data&&r.jsx("button",{onClick:mg,style:',
    'Ne.data&&r.jsx("button",{onClick:()=>mg(weekStartOffset),style:',
    `${config.path}: plaatsknop gebruikt gekozen startdag`,
  );

  const oldTomorrowBadge = 'children:lA[0]&&lA[0].date===ye(1)?"MORGEN + 6":"VANDAAG + 6"';
  const namedTomorrowBadge = 'children:lA[0]&&lA[0].date===ye(1)?Ss((IA==null?void 0:IA.weekday)||"").toUpperCase()+" + 6":"VANDAAG + 6"';
  if (source.includes(oldTomorrowBadge)) {
    source = replaceOnce(source, oldTomorrowBadge, namedTomorrowBadge, `${config.path}: morgenbadge wordt weekdag`);
  } else {
    source = replaceOnceOrAlready(
      source,
      'children:"VANDAAG + 6"',
      namedTomorrowBadge,
      `${config.path}: startbadge op kaart`,
    );
  }
  const oldTomorrowRow = 'children:se===0?(tA.date===ye(1)?"MORGEN":"VANDAAG"):Ss((fA==null?void 0:fA.weekday)||"")';
  const namedTomorrowRow = 'children:se===0&&tA.date===ye(0)?"VANDAAG":Ss((fA==null?void 0:fA.weekday)||"")';
  if (source.includes(oldTomorrowRow)) {
    source = replaceOnce(source, oldTomorrowRow, namedTomorrowRow, `${config.path}: morgenrij wordt weekdag`);
  } else {
    source = replaceOnceOrAlready(
      source,
      'children:se===0?"VANDAAG":Ss((fA==null?void 0:fA.weekday)||"")',
      namedTomorrowRow,
      `${config.path}: eerste dagnaam op kaart`,
    );
  }

  source = replaceOnceOrAlready(
    source,
    'children:"Zeven dagen vanaf vandaag · temperaturen zijn de landelijke laagste–hoogste waarden. Weerbeeld en wind zijn gebaseerd op De Bilt. Alles kan hieronder worden aangepast."',
    'children:["Zeven dagen vanaf ",E.days&&E.days[0]&&E.days[0].date===ye(1)?"morgen":"vandaag"," · temperaturen zijn de landelijke laagste–hoogste waarden. Weerbeeld en wind zijn gebaseerd op De Bilt. Alles kan hieronder worden aangepast."]',
    `${config.path}: eigenschappenpaneel noemt gekozen startdag`,
  );
  const oldTomorrowProperty = 'children:[c===0?(o.date===ye(1)?"Morgen":"Vandaag"):Ss((f==null?void 0:f.weekday)||`Dag ${c+1}`)';
  const namedTomorrowProperty = 'children:[c===0&&o.date===ye(0)?"Vandaag":Ss((f==null?void 0:f.weekday)||`Dag ${c+1}`)';
  if (source.includes(oldTomorrowProperty)) {
    source = replaceOnce(source, oldTomorrowProperty, namedTomorrowProperty, `${config.path}: morgen in eigenschappen wordt weekdag`);
  } else {
    source = replaceOnceOrAlready(
      source,
      'children:[c===0?"Vandaag":Ss((f==null?void 0:f.weekday)||`Dag ${c+1}`)',
      namedTomorrowProperty,
      `${config.path}: eerste dagnaam in eigenschappenpaneel`,
    );
  }

  source = replaceOnceOrAlready(
    source,
    'r.jsx(eA,{children:"Titel"}),r.jsx(OA,{value:E.title||"Landelijke vooruitzichten",onChange:o=>V(E.id,{title:o.target.value})}),(E.days||bi()).map',
    'r.jsx(eA,{children:"Titel"}),r.jsx(OA,{value:E.title||"Landelijke vooruitzichten",onChange:o=>V(E.id,{title:o.target.value})}),r.jsx(eA,{children:"Bijgewerkt"}),r.jsx(OA,{value:E.updated||"",onChange:o=>V(E.id,{updated:o.target.value}),placeholder:"bijv. 15 augustus 16:30"}),(E.days||bi()).map',
    `${config.path}: bijgewerkttekst meerdaagse aanpassen`,
  );

  return source;
}

function patchNationalWeekQuickEdit(source, config) {
  if (!config.national) return source;

  if (!source.includes('[weekEditDay,setWeekEditDay]=z.useState(null),[customPoint,setCustomPoint]=z.useState')) {
    source = replaceOnceOrAlready(
      source,
      '[weekStartOffset,setWeekStartOffset]=z.useState(0),[Z,QA]=z.useState',
      '[weekStartOffset,setWeekStartOffset]=z.useState(0),[weekEditDay,setWeekEditDay]=z.useState(null),[Z,QA]=z.useState',
      `${config.path}: gekozen meerdaagse dag bewaren`,
    );
  }

  source = replaceOnceOrAlready(
    source,
    'vi=(o,c,f,h)=>{if(!E)return;const I=Number(E[o]),v=Number.isFinite(I)?I:0,D=Math.max(f,Math.min(h,v+c));V(E.id,{[o]:String(D)})},Vg=',
    'vi=(o,c,f,h)=>{if(!E)return;const I=Number(E[o]),v=Number.isFinite(I)?I:0,D=Math.max(f,Math.min(h,v+c));V(E.id,{[o]:String(D)})},weekDay=(E==null?void 0:E.type)==="weekOutlook"&&Number.isInteger(weekEditDay)?(E.days||[])[weekEditDay]:null,weekDayInfo=weekDay?un(weekDay.date):null,weekAdjust=(o,c,f,h)=>{if(!weekDay)return;const I=Number(weekDay[o]),v=Number.isFinite(I)?I:0,D=Math.max(f,Math.min(h,v+c));Ot(E.id,weekEditDay,o,String(D))},Vg=',
    `${config.path}: snelle dagaanpassingen`,
  );

  source = replaceOnceOrAlready(
    source,
    'c&&r.jsx("rect",{x:R-5,y:q-5,width:970,height:1250,rx:32,fill:"none",...He}),r.jsxs("g",{style:{pointerEvents:"none"},children:[r.jsx("circle",{cx:R+54,cy:q+51',
    'c&&r.jsx("rect",{x:R-5,y:q-5,width:970,height:1250,rx:32,fill:"none",...He}),r.jsxs("g",{style:{pointerEvents:"all"},children:[r.jsx("circle",{cx:R+54,cy:q+51',
    `${config.path}: meerdaagse dagrijen aanklikbaar`,
  );

  const dayRowOriginal = 'return r.jsxs("g",{children:[r.jsx("rect",{x:R+24,y:JA,width:912,height:L,rx:20,fill:se===0?';
  const dayRowWithoutClickGuard = 'return r.jsxs("g",{onMouseDown:weekDayEvent=>{weekDayEvent.stopPropagation(),n(o.id),setWeekEditDay(se)},style:{cursor:"pointer"},children:[r.jsx("rect",{x:R+24,y:JA,width:912,height:L,rx:20,fill:se===0?';
  const dayRowQuickEditWithoutClickGuard = 'return r.jsxs("g",{onMouseDown:weekDayEvent=>{weekDayEvent.stopPropagation(),ai.current=!0,n(o.id),setWeekEditDay(se)},style:{cursor:"pointer"},children:[r.jsx("rect",{x:R+24,y:JA,width:912,height:L,rx:20,fill:se===0?';
  const dayRowQuickEdit = 'return r.jsxs("g",{onMouseDown:weekDayEvent=>{weekDayEvent.stopPropagation(),ai.current=!0,n(o.id),setWeekEditDay(se)},onClick:weekDayClick=>weekDayClick.stopPropagation(),style:{cursor:"pointer"},children:[r.jsx("rect",{x:R+24,y:JA,width:912,height:L,rx:20,fill:se===0?';
  if (source.includes(dayRowWithoutClickGuard)) {
    source = replaceOnce(source, dayRowWithoutClickGuard, dayRowQuickEdit, `${config.path}: dagrij bewaart snelbewerking`);
  } else if (source.includes(dayRowQuickEditWithoutClickGuard)) {
    source = replaceOnce(source, dayRowQuickEditWithoutClickGuard, dayRowQuickEdit, `${config.path}: dagrij houdt klik uit kaartselectie`);
  } else {
    source = replaceOnceOrAlready(
      source,
      dayRowOriginal,
      dayRowQuickEdit,
      `${config.path}: dagrij opent snelbewerking`,
    );
  }

  source = replaceOnceOrAlready(
    source,
    'I||(n(c),s("select"),dA(null)),ui.current=JSON.stringify(e)',
    'I||(n(c),setWeekEditDay(null),s("select"),dA(null)),ui.current=JSON.stringify(e)',
    `${config.path}: dagbewerking sluiten bij gewone selectie`,
  );
  source = replaceOnceOrAlready(
    source,
    'c.key==="Escape"&&(s("select"),dA(null))',
    'c.key==="Escape"&&(s("select"),dA(null),setWeekEditDay(null))',
    `${config.path}: dagbewerking sluiten met Escape`,
  );

  const oldTomorrowModalHeading = 'children:weekEditDay===0?(weekDay.date===ye(1)?"Morgen":"Vandaag"):Ss((weekDayInfo==null?void 0:weekDayInfo.weekday)||"Dag "+(weekEditDay+1))';
  const namedTomorrowModalHeading = 'children:weekEditDay===0&&weekDay.date===ye(0)?"Vandaag":Ss((weekDayInfo==null?void 0:weekDayInfo.weekday)||"Dag "+(weekEditDay+1))';
  if (source.includes(oldTomorrowModalHeading) || source.includes(namedTomorrowModalHeading)) {
    source = replaceOnceOrAlready(
      source,
      oldTomorrowModalHeading,
      namedTomorrowModalHeading,
      `${config.path}: dagbewerking gebruikt echte weekdag`,
    );
  }

  const modalAnchor = 'children:"Klaar"})]})]})]})}),r.jsxs("div",{style:{width:"auto",background:"#1E293B"';
  const modal = `children:"Klaar"})]})]})]}),weekDay&&!l&&r.jsxs("div",{role:"dialog","aria-label":"Meerdaagse dag snel bewerken",onMouseDown:o=>o.stopPropagation(),onClick:o=>o.stopPropagation(),style:{position:"absolute",zIndex:31,left:"50%",top:"50%",transform:"translate(-50%, -50%)",width:"min(430px, calc(100% - 24px))",maxHeight:"92%",overflowY:"auto",boxSizing:"border-box",padding:16,borderRadius:14,border:"1px solid rgba(125,211,252,.65)",background:"rgba(15,23,42,.98)",boxShadow:"0 18px 45px rgba(2,6,23,.78)",color:"#E2E8F0",fontFamily:Q},children:[r.jsxs("div",{style:{display:"flex",alignItems:"flex-start",gap:10,marginBottom:12},children:[r.jsxs("div",{style:{flex:1,minWidth:0},children:[r.jsx("div",{style:{fontSize:17,fontWeight:900,color:"#F8FAFC",letterSpacing:.3,textTransform:"uppercase"},children:weekEditDay===0&&weekDay.date===ye(0)?"Vandaag":Ss((weekDayInfo==null?void 0:weekDayInfo.weekday)||"Dag "+(weekEditDay+1))}),r.jsxs("div",{style:{fontSize:11,color:"#93C5FD",marginTop:2},children:[weekDay.date," · landelijke bandbreedte"]})]}),r.jsx("button",{type:"button","aria-label":"Dagbewerking sluiten",onClick:()=>setWeekEditDay(null),style:{width:34,height:34,borderRadius:8,border:"1px solid #475569",background:"#1E293B",color:"#CBD5E1",cursor:"pointer",fontSize:19,lineHeight:1},children:"×"})]}),r.jsx("div",{style:{fontSize:11,fontWeight:800,color:"#94A3B8",marginBottom:6,textTransform:"uppercase",letterSpacing:.8},children:"Temperatuur"}),r.jsx("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12},children:[["Maximum laag","maxTempLow",-50,60],["Maximum hoog","maxTempHigh",-50,60],["Minimum laag","minTempLow",-50,60],["Minimum hoog","minTempHigh",-50,60]].map(([o,c,f,h])=>r.jsxs("div",{children:[r.jsx("div",{style:{fontSize:10,color:c.startsWith("max")?"#FBBF24":"#60A5FA",marginBottom:4},children:o}),r.jsxs("div",{style:{display:"grid",gridTemplateColumns:"34px 1fr 34px",gap:4},children:[r.jsx("button",{type:"button","aria-label":o+" lager",onClick:()=>weekAdjust(c,-1,f,h),style:{..._A,padding:0,fontSize:18},children:"−"}),r.jsx("input",{"aria-label":o,type:"number",min:f,max:h,value:weekDay[c]??"",onChange:o=>Ot(E.id,weekEditDay,c,o.target.value),style:{width:"100%",minWidth:0,boxSizing:"border-box",borderRadius:6,border:"1px solid #475569",background:"#334155",color:"#fff",fontSize:16,fontWeight:850,textAlign:"center",fontFamily:Q}}),r.jsx("button",{type:"button","aria-label":o+" hoger",onClick:()=>weekAdjust(c,1,f,h),style:{..._A,padding:0,fontSize:18},children:"+"})]})]},c))}),r.jsx("div",{style:{fontSize:11,fontWeight:800,color:"#94A3B8",marginBottom:6,textTransform:"uppercase",letterSpacing:.8},children:"Wind"}),r.jsx("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:9},children:[["Bft minimum","windBftMin"],["Bft maximum","windBftMax"]].map(([o,c])=>r.jsxs("div",{children:[r.jsx("div",{style:{fontSize:10,color:"#BAE6FD",marginBottom:4},children:o}),r.jsxs("div",{style:{display:"grid",gridTemplateColumns:"34px 1fr 34px",gap:4},children:[r.jsx("button",{type:"button","aria-label":o+" lager",onClick:()=>weekAdjust(c,-1,0,12),style:{..._A,padding:0,fontSize:18},children:"−"}),r.jsx("input",{"aria-label":o,type:"number",min:0,max:12,value:weekDay[c]??"",onChange:o=>Ot(E.id,weekEditDay,c,o.target.value),style:{width:"100%",minWidth:0,boxSizing:"border-box",borderRadius:6,border:"1px solid #475569",background:"#334155",color:"#fff",fontSize:16,fontWeight:850,textAlign:"center",fontFamily:Q}}),r.jsx("button",{type:"button","aria-label":o+" hoger",onClick:()=>weekAdjust(c,1,0,12),style:{..._A,padding:0,fontSize:18},children:"+"})]})]},c))}),r.jsx("select",{"aria-label":"Windrichting meerdaagse dag",value:weekDay.windDir||"",onChange:o=>Ot(E.id,weekEditDay,"windDir",o.target.value),style:{width:"100%",boxSizing:"border-box",padding:"9px",marginBottom:12,borderRadius:7,border:"1px solid #475569",background:"#334155",color:"#F8FAFC",fontSize:14,fontWeight:750,fontFamily:Q},children:Qt.map(o=>r.jsx("option",{value:o,children:o},o))}),r.jsx("div",{style:{fontSize:11,fontWeight:800,color:"#94A3B8",marginBottom:6,textTransform:"uppercase",letterSpacing:.8},children:"Weersymbool"}),r.jsx("div",{style:{display:"grid",gridTemplateColumns:"repeat(6,minmax(0,1fr))",gap:5},children:gu.map(o=>r.jsx("button",{type:"button","aria-label":\`Kies \${WA[o]} voor meerdaagse dag\`,title:WA[o],onClick:()=>Ot(E.id,weekEditDay,"icon",o),style:{height:48,minWidth:0,padding:3,borderRadius:8,border:(weekDay.icon||"zon")===o?"2px solid #60A5FA":"1px solid #475569",background:(weekDay.icon||"zon")===o?"rgba(37,99,235,.34)":"#1E293B",cursor:"pointer"},children:r.jsxs("svg",{width:"100%",height:"100%",viewBox:"0 0 250 250",children:[r.jsx(kr,{}),r.jsx(Lt,{type:o,s:250})]})},o))}),r.jsxs("button",{type:"button","aria-expanded":C,onClick:()=>k(o=>!o),style:{width:"100%",padding:"8px 9px",marginTop:8,borderRadius:7,border:"1px solid #475569",background:"#1E293B",color:"#BFDBFE",fontSize:12,fontWeight:800,cursor:"pointer",fontFamily:Q},children:[C?"Minder symbolen":"Meer symbolen",!gu.includes(weekDay.icon)&&!C?\` · \${WA[weekDay.icon]||"huidig"}\`:""]}),C&&r.jsx("select",{"aria-label":"Alle weersymbolen voor meerdaagse dag",value:weekDay.icon||"zon",onChange:o=>Ot(E.id,weekEditDay,"icon",o.target.value),style:{width:"100%",boxSizing:"border-box",padding:"8px 9px",marginTop:7,borderRadius:7,border:"1px solid #475569",background:"#334155",color:"#F8FAFC",fontSize:13,fontFamily:Q},children:Object.keys(WA).map(o=>r.jsx("option",{value:o,children:WA[o]},o))}),r.jsxs("div",{style:{display:"flex",alignItems:"center",gap:8,marginTop:12,paddingTop:10,borderTop:"1px solid rgba(148,163,184,.18)"},children:[r.jsx("div",{style:{flex:1,fontSize:10,color:"#64748B",lineHeight:1.35},children:"Klik op een dagrij om een andere dag te bewerken"}),r.jsx("button",{type:"button",onClick:()=>setWeekEditDay(null),style:{padding:"8px 15px",borderRadius:7,border:"none",background:"#2563EB",color:"#fff",fontSize:12,fontWeight:850,cursor:"pointer",fontFamily:Q},children:"Klaar"})]})]}),r.jsxs("div",{style:{width:"auto",background:"#1E293B"`;
  const modalFixed = modal.replace(
    'children:"Klaar"})]})]})]}),weekDay',
    'children:"Klaar"})]})]})]})}),weekDay',
  );
  const updatedFieldAnchor = 'children:"×"})]}),r.jsx("div",{style:{fontSize:11,fontWeight:800,color:"#94A3B8",marginBottom:6,textTransform:"uppercase",letterSpacing:.8},children:"Temperatuur"})';
  const updatedFieldControls = 'children:"×"})]}),r.jsx("div",{style:{fontSize:11,fontWeight:800,color:"#94A3B8",marginBottom:5,textTransform:"uppercase",letterSpacing:.8},children:"Bijgewerkt op (datum en tijd)"}),r.jsx("input",{"aria-label":"Bijgewerkt op datum en tijd",type:"text",value:E.updated||"",onChange:o=>V(E.id,{updated:o.target.value}),placeholder:"16 augustus 2026 08:30",style:{width:"100%",boxSizing:"border-box",padding:"9px 10px",marginBottom:12,borderRadius:7,border:"1px solid #475569",background:"#334155",color:"#F8FAFC",fontSize:13,fontFamily:Q}}),r.jsx("div",{style:{fontSize:11,fontWeight:800,color:"#94A3B8",marginBottom:6,textTransform:"uppercase",letterSpacing:.8},children:"Temperatuur"})';
  const modalWithUpdated = modalFixed.replace(updatedFieldAnchor, updatedFieldControls);
  if (modalWithUpdated === modalFixed) throw new Error(`${config.path}: bijgewerktveld kon niet aan dagbewerking worden toegevoegd`);
  if (source.includes(modalFixed)) {
    source = replaceOnce(source, modalFixed, modalWithUpdated, `${config.path}: bijgewerktveld in bestaande dagbewerking`);
  } else {
    source = replaceOnceOrAlready(
      source,
      modalAnchor,
      modalWithUpdated,
      `${config.path}: snelbewerking per meerdaagse dag`,
    );
  }

  return source;
}

function patchNationalCustomPlace(source, config) {
  if (!config.national) return source;

  if (!source.includes('[mapHeaderText,setMapHeaderText]=z.useState')) {
    source = replaceOnceOrAlready(
      source,
      '[weekEditDay,setWeekEditDay]=z.useState(null),[Z,QA]=z.useState',
      '[weekEditDay,setWeekEditDay]=z.useState(null),[customPoint,setCustomPoint]=z.useState({label:"",value:"",dir:"ZW",bft:"3",icon:"zon"}),[Z,QA]=z.useState',
      `${config.path}: invoerstatus eigen weerpunt`,
    );
  }

  if (source.includes('customPointAdd=z.useCallback')) {
    source = replaceOnceOrAlready(
      source,
      'bft:String(f),size:Cr,date:Ne.day||ye(D==="night"?1:0),period:D}',
      'bft:String(f),showWind:!1,size:Cr,date:Ne.day||ye(D==="night"?1:0),period:D}',
      `${config.path}: eigen weerpunt-wind standaard verborgen`,
    );
  }

  source = replaceOnceOrAlready(
    source,
    '},[wA,qA,wi]),mg=z.useCallback(',
    '},[wA,qA,wi]),customPointAdd=z.useCallback(()=>{const o=String(customPoint.label||"").trim(),c=Number(customPoint.value),f=Number(customPoint.bft);if(!o){alert("Vul eerst een plaatsnaam in.");return}if(!Number.isFinite(c)){alert("Vul een geldige temperatuur in.");return}if(!Number.isFinite(f)||f<0||f>12){alert("Vul een windkracht van 0 tot en met 12 Bft in.");return}const h=lt++,I=e.filter(v=>v.type==="mosmixPoint"&&v.custom).length,D=Ne.period==="night"?"night":"day",H={id:h,type:"mosmixPoint",source:"Handmatig",custom:!0,x:gA*(.47+I%3*.055),y:xA*(.43+I%4*.06),label:o.toUpperCase(),station:o,badgeSide:"right",value:String(c),icon:customPoint.icon||"zon",dir:customPoint.dir||"ZW",bft:String(f),showWind:!1,size:Cr,date:Ne.day||ye(D==="night"?1:0),period:D};qA(),A(v=>[...v,H]),n(h),x("mosmixNl"),S("nederland"),d(D==="night"),p(dt.nederland[D])},[customPoint,e,Ne.day,Ne.period,qA]),mg=z.useCallback(',
    `${config.path}: eigen weerpunt plaatsen`,
  );

  const mapTip = 'TA==="single"&&r.jsx("div",{style:{padding:"7px 9px",marginBottom:10,borderRadius:6,background:"rgba(14,116,144,.16)",border:"1px solid rgba(34,211,238,.24)",color:"#BAE6FD",fontSize:11,lineHeight:1.45},children:"Kaarttip: klik om een station te bewerken, dubbelklik om plaatsnaam, symbool, temperatuur en wind samen te verwijderen. Slepen blijft verplaatsen."}),TA==="single"&&Ne.data&&';
  const customControls = 'TA==="single"&&r.jsx("div",{style:{padding:"7px 9px",marginBottom:10,borderRadius:6,background:"rgba(14,116,144,.16)",border:"1px solid rgba(34,211,238,.24)",color:"#BAE6FD",fontSize:11,lineHeight:1.45},children:"Kaarttip: klik om een station te bewerken, dubbelklik om plaatsnaam, symbool, temperatuur en wind samen te verwijderen. Slepen blijft verplaatsen."}),TA==="single"&&r.jsxs("div",{"aria-label":"Eigen plaats toevoegen",style:{marginBottom:11,padding:"10px",borderRadius:7,background:"rgba(5,150,105,.12)",border:"1px solid rgba(52,211,153,.32)"},children:[r.jsx($e,{children:"Eigen plaats toevoegen"}),r.jsx(eA,{children:"Plaatsnaam"}),r.jsx(OA,{"aria-label":"Plaatsnaam eigen weerpunt",value:customPoint.label,onChange:o=>setCustomPoint(c=>({...c,label:o.target.value})),placeholder:"Bijv. Amersfoort"}),r.jsx("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7},children:[r.jsxs("div",{children:[r.jsx(eA,{children:"Temperatuur °C"}),r.jsx(OA,{"aria-label":"Temperatuur eigen weerpunt",type:"number",min:-50,max:60,value:customPoint.value,onChange:o=>setCustomPoint(c=>({...c,value:o.target.value})),placeholder:"18"})]}),r.jsxs("div",{children:[r.jsx(eA,{children:"Windkracht Bft"}),r.jsx(OA,{"aria-label":"Windkracht eigen weerpunt",type:"number",min:0,max:12,value:customPoint.bft,onChange:o=>setCustomPoint(c=>({...c,bft:o.target.value}))})]})]}),r.jsx(eA,{children:"Windrichting"}),r.jsx(Ge,{"aria-label":"Windrichting eigen weerpunt",value:customPoint.dir,onChange:o=>setCustomPoint(c=>({...c,dir:o.target.value})),children:Qt.map(o=>r.jsx("option",{value:o,children:o},o))}),r.jsx(eA,{children:"Weersymbool"}),r.jsx(Ge,{"aria-label":"Weersymbool eigen weerpunt",value:customPoint.icon,onChange:o=>setCustomPoint(c=>({...c,icon:o.target.value})),children:Object.keys(WA).map(o=>r.jsx("option",{value:o,children:WA[o]},o))}),r.jsx("button",{type:"button",onClick:customPointAdd,style:{width:"100%",padding:"10px 9px",marginTop:3,borderRadius:7,border:"none",background:"#059669",color:"#fff",fontSize:13,fontWeight:850,cursor:"pointer",fontFamily:Q},children:"＋ Plaats eigen weerpunt"}),r.jsx("div",{style:{fontSize:10,color:"#A7F3D0",lineHeight:1.4,marginTop:7},children:"Het punt verschijnt op de kaart. Sleep het daarna naar de gewenste plaats; klikken opent alle aanpassingen."})]}),TA==="single"&&Ne.data&&';
  if (!source.includes('aria-label":"Eigen plaats toevoegen"')) {
    source = replaceOnceOrAlready(
      source,
      mapTip,
      customControls,
      `${config.path}: formulier eigen plaats`,
    );
  }

  const quickEditHeaderEnd = 'children:"×"})]}),r.jsxs("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}';
  const customNameQuickEdit = 'children:"×"})]}),E.custom&&r.jsx("input",{"aria-label":"Plaatsnaam eigen weerpunt bewerken",value:E.label||"",onChange:o=>V(E.id,{label:o.target.value.toUpperCase(),station:o.target.value}),style:{width:"100%",boxSizing:"border-box",padding:"8px 9px",marginBottom:11,borderRadius:7,border:"1px solid #475569",background:"#334155",color:"#F8FAFC",fontSize:13,fontWeight:750,fontFamily:Q}}),r.jsxs("div",{style:{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}';
  source = replaceOnceOrAlready(
    source,
    quickEditHeaderEnd,
    customNameQuickEdit,
    `${config.path}: plaatsnaam in snelbewerking`,
  );

  source = replaceOnceOrAlready(
    source,
    'E.type==="mosmixPoint"&&r.jsxs(r.Fragment,{children:[r.jsxs("div",{style:',
    'E.type==="mosmixPoint"&&r.jsxs(r.Fragment,{children:[E.custom&&r.jsxs(r.Fragment,{children:[r.jsx(eA,{children:"Plaatsnaam"}),r.jsx(OA,{value:E.label||"",onChange:o=>V(E.id,{label:o.target.value.toUpperCase(),station:o.target.value})})]}),r.jsxs("div",{style:',
    `${config.path}: plaatsnaam in eigenschappen`,
  );

  // De letters benoemen waar de wind vandaan komt; de pijlpunt toont waar de
  // lucht heen stroomt. NW loopt daarom visueel van noordwest naar zuidoost.
  const stationArrowFrom = 'transform:`translate(${D+20},0) rotate(${Gi(o.dir)})`';
  const stationArrowTo = 'transform:`translate(${D+20},0) rotate(${Gi(o.dir)+180})`';
  const roomyStationArrowFrom = 'transform:`translate(${D+24},0) rotate(${Gi(o.dir)})`';
  const roomyStationArrowTo = 'transform:`translate(${D+24},0) rotate(${Gi(o.dir)+180})`';
  if (source.includes(stationArrowFrom)) source = replaceOnce(source, stationArrowFrom, stationArrowTo, `${config.path}: stromingsrichting samengestelde weerpunten`);
  if (source.includes(roomyStationArrowFrom)) source = replaceOnce(source, roomyStationArrowFrom, roomyStationArrowTo, `${config.path}: stromingsrichting ruime weerpunten`);
  if (!source.includes(stationArrowTo) && !source.includes(roomyStationArrowTo)) {
    throw new Error(`${config.path}: stromingspijl samengesteld weerpunt niet herkend`);
  }
  source = replaceOnceOrAlready(
    source,
    'const Y=(Gi(o.dir)-90)*Math.PI/180',
    'const Y=((Gi(o.dir)+180)%360-90)*Math.PI/180',
    `${config.path}: stromingsrichting losse windpunten`,
  );

  return source;
}

function patchNationalStationWindControls(source, config) {
  if (!config.national) return source;

  source = replaceOnceOrAlready(
    source,
    'bft:L!=null?String(Fn(Number(L))):"",size:Cr,date:h,period:I}',
    'bft:L!=null?String(Fn(Number(L))):"",showWind:!1,size:Cr,date:h,period:I}',
    `${config.path}: MOSMIX-wind standaard verborgen`,
  );
  source = replaceOnceOrAlready(
    source,
    'bft:Number.isFinite(Number(v==null?void 0:v.ff))?String(Fn(Number(v.ff))):"",size:Cr,date:f,period:h}',
    'bft:Number.isFinite(Number(v==null?void 0:v.ff))?String(Fn(Number(v.ff))):"",showWind:!1,size:Cr,date:f,period:h}',
    `${config.path}: WeatherPro-wind standaard verborgen`,
  );

  source = replaceOnceOrAlready(
    source,
    '{station:"Vlissingen",weatherPro:"vlissingen",label:"VLISSINGEN",rdX:30475.2,rdY:385185.5,badgeSide:"left"}',
    '{station:"Vlissingen",weatherPro:"vlissingen",label:"VLISSINGEN",rdX:30475.2,rdY:385185.5,badgeSide:"right"}',
    `${config.path}: windvak Vlissingen binnen de kaart`,
  );
  source = replaceOnceOrAlready(
    source,
    '{station:"Enschede",weatherPro:"enschede",label:"ENSCHEDE",rdX:257493,rdY:477394.1,badgeSide:"right"}',
    '{station:"Enschede",weatherPro:"enschede",label:"ENSCHEDE",rdX:257493,rdY:477394.1,badgeSide:"left"}',
    `${config.path}: windvak Enschede binnen de kaart`,
  );

  source = replaceOnceOrAlready(
    source,
    'if(o.type==="mosmixPoint"){const v=(o.size||Cr)/100,D=o.badgeSide==="left"?-176:48,H=Math.min(-78,D-4),Y=Math.max(180,D+132);',
    'if(o.type==="mosmixPoint"){const v=(o.size||Cr)/100,D=o.badgeSide==="left"?-210:48,H=Math.min(-78,D-4),Y=Math.max(214,D+166);',
    `${config.path}: ruimer windvak bij stations`,
  );

  const compactWindBadge = 'o.dir&&r.jsxs("g",{children:[r.jsx("rect",{x:D,y:-27,width:128,height:54,rx:5,fill:"rgba(15,23,42,0.46)"}),r.jsx("g",{transform:`translate(${D+20},0) rotate(${Gi(o.dir)+180})`,children:r.jsx("polygon",{points:"0,-15 10,9 0,4 -10,9",fill:"#fff"})}),r.jsx("text",{x:D+64,y:9,fontSize:25,fontWeight:800,fill:"#fff",textAnchor:"middle",fontFamily:Q,children:o.dir}),r.jsx("text",{x:D+109,y:9,fontSize:23,fontWeight:800,fill:"#fff",textAnchor:"middle",fontFamily:Q,children:o.bft})]})';
  const visibleDefaultWindBadge = 'o.dir&&o.showWind!==!1&&r.jsxs("g",{children:[r.jsx("rect",{x:D,y:-29,width:160,height:58,rx:6,fill:"rgba(15,23,42,0.46)"}),r.jsx("g",{transform:`translate(${D+24},0) rotate(${Gi(o.dir)+180})`,children:r.jsx("polygon",{points:"0,-15 10,9 0,4 -10,9",fill:"#fff"})}),r.jsx("text",{x:D+84,y:9,fontSize:24,fontWeight:800,fill:"#fff",textAnchor:"middle",fontFamily:Q,children:o.dir}),r.jsx("text",{x:D+143,y:9,fontSize:23,fontWeight:800,fill:"#fff",textAnchor:"middle",fontFamily:Q,children:o.bft})]})';
  const hiddenDefaultWindBadge = 'o.dir&&o.showWind===!0&&r.jsxs("g",{children:[r.jsx("rect",{x:D,y:-29,width:160,height:58,rx:6,fill:"rgba(15,23,42,0.46)"}),r.jsx("g",{transform:`translate(${D+24},0) rotate(${Gi(o.dir)+180})`,children:r.jsx("polygon",{points:"0,-15 10,9 0,4 -10,9",fill:"#fff"})}),r.jsx("text",{x:D+84,y:9,fontSize:24,fontWeight:800,fill:"#fff",textAnchor:"middle",fontFamily:Q,children:o.dir}),r.jsx("text",{x:D+143,y:9,fontSize:23,fontWeight:800,fill:"#fff",textAnchor:"middle",fontFamily:Q,children:o.bft})]})';
  if (source.includes(visibleDefaultWindBadge)) {
    source = replaceOnce(source, visibleDefaultWindBadge, hiddenDefaultWindBadge, `${config.path}: bestaande stationswind standaard verborgen`);
  }
  source = replaceOnceOrAlready(
    source,
    compactWindBadge,
    hiddenDefaultWindBadge,
    `${config.path}: windpijl, richting en Bft uit elkaar`,
  );

  const quickWindDirection = 'r.jsx("div",{style:{fontSize:11,fontWeight:800,color:"#94A3B8",marginBottom:5,textTransform:"uppercase",letterSpacing:.8},children:"Windrichting"}),r.jsx("select",{"aria-label":"Windrichting",value:E.dir||"",onChange:o=>V(E.id,{dir:o.target.value})';
  const visibleDefaultQuickWindToggleControl = 'r.jsx("label",{style:{display:"flex",alignItems:"center",gap:8,padding:"8px 9px",marginBottom:10,borderRadius:7,border:"1px solid #475569",background:E.showWind===!1?"rgba(127,29,29,.22)":"rgba(14,116,144,.18)",color:E.showWind===!1?"#FCA5A5":"#BAE6FD",fontSize:12,fontWeight:800,cursor:"pointer"},children:[r.jsx("input",{type:"checkbox","aria-label":"Wind tonen bij dit station",checked:E.showWind!==!1,onChange:o=>V(E.id,{showWind:o.target.checked})}),E.showWind===!1?"Wind is verborgen voor dit station":"Wind tonen bij dit station"]}),';
  const quickWindToggleControl = 'r.jsx("label",{style:{display:"flex",alignItems:"center",gap:8,padding:"8px 9px",marginBottom:10,borderRadius:7,border:"1px solid #475569",background:E.showWind===!0?"rgba(14,116,144,.18)":"rgba(127,29,29,.22)",color:E.showWind===!0?"#BAE6FD":"#FCA5A5",fontSize:12,fontWeight:800,cursor:"pointer"},children:[r.jsx("input",{type:"checkbox","aria-label":"Wind tonen bij dit station",checked:E.showWind===!0,onChange:o=>V(E.id,{showWind:o.target.checked})}),E.showWind===!0?"Wind tonen bij dit station":"Wind is verborgen voor dit station"]}),';
  if (source.includes(visibleDefaultQuickWindToggleControl)) {
    source = source.replaceAll(visibleDefaultQuickWindToggleControl, quickWindToggleControl);
  }
  while (source.includes(quickWindToggleControl + quickWindToggleControl)) {
    source = source.replaceAll(quickWindToggleControl + quickWindToggleControl, quickWindToggleControl);
  }
  const quickToggleCount = source.split(quickWindToggleControl).length - 1;
  if (quickToggleCount === 0) {
    source = replaceOnce(
      source,
      quickWindDirection,
      quickWindToggleControl + quickWindDirection,
      `${config.path}: wind per station in snelbewerking`,
    );
  } else if (quickToggleCount !== 1) {
    throw new Error(`${config.path}: windschakelaar snelbewerking verwacht 1 treffer, kreeg ${quickToggleCount}`);
  }

  const propertyWindAnchor = 'children:"Temperatuur, symbool en wind zijn ook direct naast het punt aan te passen."})]}),r.jsx(eA,{children:"Temperatuur °C"})';
  const visibleDefaultPropertyWindToggle = 'children:"Temperatuur, symbool en wind zijn ook direct naast het punt aan te passen."})]}),r.jsx("label",{style:{display:"flex",alignItems:"center",gap:8,padding:"7px 8px",marginBottom:9,borderRadius:6,background:"rgba(14,116,144,.14)",color:"#BAE6FD",fontSize:12,fontWeight:750},children:[r.jsx("input",{type:"checkbox","aria-label":"Wind tonen in eigenschappen",checked:E.showWind!==!1,onChange:o=>V(E.id,{showWind:o.target.checked})}),"Wind tonen bij dit station"]}),r.jsx(eA,{children:"Temperatuur °C"})';
  const propertyWindToggle = 'children:"Temperatuur, symbool en wind zijn ook direct naast het punt aan te passen."})]}),r.jsx("label",{style:{display:"flex",alignItems:"center",gap:8,padding:"7px 8px",marginBottom:9,borderRadius:6,background:"rgba(14,116,144,.14)",color:"#BAE6FD",fontSize:12,fontWeight:750},children:[r.jsx("input",{type:"checkbox","aria-label":"Wind tonen in eigenschappen",checked:E.showWind===!0,onChange:o=>V(E.id,{showWind:o.target.checked})}),"Wind tonen bij dit station"]}),r.jsx(eA,{children:"Temperatuur °C"})';
  if (source.includes(visibleDefaultPropertyWindToggle)) {
    source = replaceOnce(source, visibleDefaultPropertyWindToggle, propertyWindToggle, `${config.path}: eigenschappenwind standaard uit`);
  }
  source = replaceOnceOrAlready(
    source,
    propertyWindAnchor,
    propertyWindToggle,
    `${config.path}: wind per station in eigenschappen`,
  );

  return source;
}

function patchNationalMapHeader(source, config) {
  if (!config.national) return source;

  if (!source.includes('[showSymbolCatalog,setShowSymbolCatalog]=z.useState')) {
    source = replaceOnceOrAlready(
      source,
      '[customPoint,setCustomPoint]=z.useState({label:"",value:"",dir:"ZW",bft:"3",icon:"zon"}),[Z,QA]=z.useState',
      '[customPoint,setCustomPoint]=z.useState({label:"",value:"",dir:"ZW",bft:"3",icon:"zon"}),[mapHeaderText,setMapHeaderText]=z.useState(()=>{try{return localStorage.getItem("weerlab_map_header")||""}catch{return""}}),[Z,QA]=z.useState',
      `${config.path}: koptekst landelijke kaart bewaren`,
    );
  }

  source = replaceOnceOrAlready(
    source,
    '},[tn]),z.useEffect(()=>{u&&!e.some',
    '},[tn]),z.useEffect(()=>{try{localStorage.setItem("weerlab_map_header",mapHeaderText)}catch{}},[mapHeaderText]),z.useEffect(()=>{u&&!e.some',
    `${config.path}: koptekst lokaal onthouden`,
  );

  source = replaceOnceOrAlready(
    source,
    'return f?{line1:c.period==="night"?su(c.date):`${Ss(f.weekday)} ${f.day} ${f.month} ${f.year} overdag`,line2:""}:null',
    'return f?{line1:c.period==="night"?su(c.date):`${Ss(f.weekday)} ${f.day} ${f.month} ${f.year} overdag`,line2:mapHeaderText}:null',
    `${config.path}: koptekst onder datum tekenen`,
  );

  const customPlacePanel = 'TA==="single"&&r.jsxs("div",{"aria-label":"Eigen plaats toevoegen",style:{marginBottom:11,padding:"10px",borderRadius:7,background:"rgba(5,150,105,.12)",border:"1px solid rgba(52,211,153,.32)"}';
  const mapHeaderPanel = 'TA==="single"&&r.jsxs("div",{"aria-label":"Koptekst landelijke kaart instellen",style:{marginBottom:11,padding:"10px",borderRadius:7,background:"rgba(30,64,175,.14)",border:"1px solid rgba(96,165,250,.32)"},children:[r.jsx($e,{children:"Koptekst op de kaart"}),r.jsx(OA,{"aria-label":"Koptekst landelijke kaart",value:mapHeaderText,onChange:o=>setMapHeaderText(o.target.value),placeholder:"Wisselend bewolkt met buien"}),r.jsx("div",{style:{fontSize:10,color:"#BFDBFE",lineHeight:1.4,marginTop:5},children:"Deze tekst verschijnt linksboven direct onder de datum."})]}),';
  if (!source.includes('aria-label":"Koptekst landelijke kaart instellen"')) {
    source = replaceOnce(
      source,
      customPlacePanel,
      mapHeaderPanel + customPlacePanel,
      `${config.path}: invoerveld voor koptekst`,
    );
  }

  source = replaceOnceOrAlready(
    source,
    'width:Math.min(gA-32,Math.max(410,pA.line1.length*(pA.line2?13.4:14.2)+58))',
    'width:Math.min(gA-32,Math.max(410,Math.max(pA.line1.length*(pA.line2?13.4:14.2),(pA.line2||"").length*17.2)+58))',
    `${config.path}: kopvlak past ook om langere koptekst`,
  );
  source = replaceOnceOrAlready(
    source,
    'height:pA.line2?88:52',
    'height:pA.line2?98:52',
    `${config.path}: meer ruimte tussen datum en koptekst`,
  );
  source = replaceOnceOrAlready(
    source,
    'pA.line2&&r.jsx("text",{x:34,y:79',
    'pA.line2&&r.jsx("text",{x:34,y:89',
    `${config.path}: koptekst lager onder datum`,
  );

  return source;
}

function patchNationalSymbolCatalogToggle(source, config) {
  if (!config.national) return source;

  source = replaceOnceOrAlready(
    source,
    '[mapHeaderText,setMapHeaderText]=z.useState(()=>{try{return localStorage.getItem("weerlab_map_header")||""}catch{return""}}),[Z,QA]=z.useState',
    '[mapHeaderText,setMapHeaderText]=z.useState(()=>{try{return localStorage.getItem("weerlab_map_header")||""}catch{return""}}),[showSymbolCatalog,setShowSymbolCatalog]=z.useState(!1),[Z,QA]=z.useState',
    `${config.path}: symbolencatalogus standaard ingeklapt`,
  );

  const toolbarNewButton = 'r.jsx("button",{onClick:Lg,title:"Nieuwe kaart (alles wissen)",style:{...Ve("_"),fontSize:12,border:"1px solid rgba(239,68,68,0.35)",background:"rgba(239,68,68,0.12)",color:"#FCA5A5"},children:"🔄 Nieuw"})';
  const symbolToggleAndNew = '![' + '"plume","knmi"' + '].includes(Vg)&&r.jsx("button",{type:"button","aria-expanded":showSymbolCatalog,onClick:()=>setShowSymbolCatalog(o=>!o),style:{...Ve("_"),fontSize:12,border:showSymbolCatalog?"1px solid #60A5FA":"1px solid rgba(148,163,184,.28)",background:showSymbolCatalog?"rgba(37,99,235,.28)":"rgba(255,255,255,.04)",color:showSymbolCatalog?"#DBEAFE":"#CBD5E1"},children:showSymbolCatalog?"🖼 Symbolen verbergen":"🖼 Symbolen tonen"}),' + toolbarNewButton;
  if (!source.includes('children:showSymbolCatalog?"🖼 Symbolen verbergen":"🖼 Symbolen tonen"')) {
    source = replaceOnce(
      source,
      toolbarNewButton,
      symbolToggleAndNew,
      `${config.path}: knop voor symbolencatalogus`,
    );
  }

  source = replaceOnceOrAlready(
    source,
    '![' + '"plume","knmi"' + '].includes(Vg)&&tn.length>0&&r.jsxs("div"',
    'showSymbolCatalog&&![' + '"plume","knmi"' + '].includes(Vg)&&tn.length>0&&r.jsxs("div"',
    `${config.path}: recente symbolen alleen uitgeklapt`,
  );
  source = replaceOnceOrAlready(
    source,
    '![' + '"plume","knmi"' + '].includes(Vg)&&r.jsxs("div",{style:{display:"flex",alignItems:"center",gap:5,margin:"5px 0 6px",flexWrap:"wrap"}',
    'showSymbolCatalog&&![' + '"plume","knmi"' + '].includes(Vg)&&r.jsxs("div",{style:{display:"flex",alignItems:"center",gap:5,margin:"5px 0 6px",flexWrap:"wrap"}',
    `${config.path}: symboolfilters alleen uitgeklapt`,
  );
  source = replaceOnceOrAlready(
    source,
    '["plume","knmi"].includes(Vg)?null:K==="alles"?',
    '!showSymbolCatalog||["plume","knmi"].includes(Vg)?null:K==="alles"?',
    `${config.path}: symbolen alleen uitgeklapt`,
  );

  return source;
}

function patchRegionalSimpleMenu(source, config) {
  if (config.national) return source;

  const internalModeNavigation = 'r.jsx("div",{style:{display:"grid",gridTemplateColumns:"repeat(5,minmax(0,1fr))",gap:4,padding:4,marginBottom:7,borderRadius:9,background:"#111C2E",border:"1px solid rgba(148,163,184,.28)",flexShrink:0,zIndex:20,boxShadow:"0 7px 14px rgba(15,23,42,.72)"},children:[["landelijk","🇳🇱 Kaart Landelijk"],["week","🗓 Meerdaagse Landelijk"],["plume","📈 Pluim"],["regio","🗺 Kaart Regio"],["knmi","📊 KNMI metingen"]].map(([o,c])=>{const f=_g===o;return r.jsx("button",{onClick:()=>zc(o),style:{...Ue("_"),justifyContent:"center",minWidth:0,minHeight:38,padding:"7px 6px",whiteSpace:"normal",lineHeight:1.15,textAlign:"center",border:f?"2px solid #60A5FA":"1px solid transparent",background:f?"rgba(37,99,235,.32)":"transparent",color:f?"#EFF6FF":"#CBD5E1",fontWeight:f?850:650},children:c},o)})})';
  const hiddenInternalModeNavigation = 'r.jsx("div",{"data-weerlab-hidden-mode-nav":!0,style:{display:"none"}})';
  return replaceOnceOrAlready(
    source,
    internalModeNavigation,
    hiddenInternalModeNavigation,
    `${config.path}: dubbele interne paginanavigatie verbergen`,
  );
}

const nationalOnly = process.argv.includes('--national-only');
for (const config of bundles) {
  if (nationalOnly && !config.national) continue;
  let source = fs.readFileSync(config.path, 'utf8');
  source = patchNationalMapBackgrounds(source, config);

  const helperStart = `${config.bft}=e=>{const A=${config.number}(e),t=[1,5,11,19,28,38,49,61,74,88,102,117];if(A==null)return null;for(let n=0;n<t.length;n++)if(A<=t[n])return n;return 12}`;
  const helperFixed = `${config.bft}=e=>{const A=${config.number}(e),t=[1,6,12,20,29,39,50,62,75,89,103,118];if(A==null)return null;let n=0;for(let i=0;i<t.length;i++)A>=t[i]&&(n=i+1);return n}`;
  if (source.includes(helperStart)) source = replaceOnce(source, helperStart, helperFixed, `${config.path}: Beaufort`);
  else if (!source.includes(helperFixed)) throw new Error(`${config.path}: Beaufort-helper niet herkend`);

  const start = source.indexOf(`${config.summary}=e=>`);
  const endMarker = `,${config.next}=async e=>`;
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error(`${config.path}: samenvattingsfunctie niet gevonden`);
  source = source.slice(0, start) + hardenNationalSummary(summarySource(config), config) + source.slice(end);

  if (!config.national) {
  source = replaceOnceOrAlready(source, '(["rainMean"]).length?"rainMean":"rainP75"', '(["rainP50"]).length?"rainP50":"rainP75"', `${config.path}: P50-neerslaglijn`);
  source = replaceOnceOrAlready(source, ' uur · blauwe lijn = gemiddelde hoeveelheid', ' uur · blauwe lijn = mediaan (P50)', `${config.path}: neerslaglabel`);

  source = replaceOnceOrAlready(
    source,
    'strokeWidth:6,strokeLinecap:"round",strokeLinejoin:"round",filter:"url(#plume-glow-"+e.id+")"',
    'strokeWidth:4,strokeLinecap:"butt",strokeLinejoin:"miter"',
    `${config.path}: temperatuurlijn`,
  );
  source = replaceOnceOrAlready(
    source,
    `d:${config.render.rainPath}(EA,${config.render.rainY}),fill:"none",stroke:"#C4F1FF",strokeWidth:3,strokeLinejoin:"round"`,
    `d:${config.render.rainPath}(EA,${config.render.rainY}),fill:"none",stroke:"#C4F1FF",strokeWidth:2.2,strokeLinecap:"butt",strokeLinejoin:"miter"`,
    `${config.path}: neerslaglijn`,
  );
  source = replaceOnceOrAlready(
    source,
    `d:${config.render.windPath}("windP50",${config.render.windY}),fill:"none",stroke:"#DDD6FE",strokeWidth:5,strokeLinecap:"round",strokeLinejoin:"round"`,
    `d:${config.render.windPath}("windP50",${config.render.windY}),fill:"none",stroke:"#DDD6FE",strokeWidth:3,strokeLinecap:"butt",strokeLinejoin:"miter"`,
    `${config.path}: windlijn`,
  );

  source = replaceOnceOrAlready(
    source,
    '["ECMWF IFS-ENS · ",e.memberCount||51," berekeningen · circa 15 dagen"]',
    '["ECMWF IFS-ENS · ",e.memberCount||51," berekeningen · run ",Number.isFinite(new Date(e.run).getTime())?String(new Date(e.run).getUTCHours()).padStart(2,"0"):"--"," UTC · ",e.coverageHours||Math.max(0,Math.round((J-b)/36e5))," uur"]',
    `${config.path}: exacte run en looptijd in kaartkop`,
  );

  const W = config.render.windMax;
  const V = config.render.flatValues;
  source = replaceOnceOrAlready(
    source,
    `${W}=Math.max(4,Math.ceil(Math.max(...${V}(["windP90"]),4)))`,
    `${W}=Math.max(20,Math.ceil(Math.max(...${V}(["windP90"]),20)/5)*5)`,
    `${config.path}: windbereik in km/u`,
  );
  const T = config.render.windTicks;
  const I = config.render.item;
  source = replaceOnceOrAlready(
    source,
    `${T}=Array.from({length:${W}+1},(${I},${I === 'P' ? 'oA' : 'xA'})=>${I === 'P' ? 'oA' : 'xA'}).filter(${I}=>${I}===0||${I}===${W}||${I}%2===0)`,
    `${T}=[...new Set([...Array.from({length:Math.floor(${W}/10)+1},(${I},${I === 'P' ? 'oA' : 'xA'})=>${I === 'P' ? 'oA' : 'xA'}*10),${W}])].sort((${I},${I === 'P' ? 'oA' : 'xA'})=>${I}-${I === 'P' ? 'oA' : 'xA'})`,
    `${config.path}: windticks in km/u`,
  );
  source = replaceOnceOrAlready(
    source,
    'Beaufort (Bft) · uitschieters vallen in de lichte band',
    'km/u links · Beaufort (Bft) rechts · uitschieters vallen in de lichte band',
    `${config.path}: windeenheden`,
  );

  const Y = config.render.windY;
  const R = config.render.right;
  const F = config.render.font;
  const B = config.bft;
  const path = config.render.windPath;
  const p50Path = `r.jsx("path",{d:${path}("windP50",${Y}),fill:"none",stroke:"#DDD6FE",strokeWidth:3,strokeLinecap:"butt",strokeLinejoin:"miter"})`;
  const oldAxis = `${p50Path},r.jsx("text",{x:B-58,y:x+O/2,textAnchor:"middle",fontSize:13,fontWeight:850,fill:"#C4B5FD",fontFamily:${F},transform:\`rotate(-90 \${B-58} \${x+O/2})\`,children:"Bft"})`;
  const rightTicks = `[0,6,20,39,62,89,118].filter(${I}=>${I}<=${W}).map(${I}=>r.jsxs("g",{children:[r.jsx("line",{x1:${R},y1:${Y}(${I}),x2:${R}+7,y2:${Y}(${I}),stroke:"rgba(196,181,253,.55)",strokeWidth:1}),r.jsxs("text",{x:${R}+11,y:${Y}(${I})+4,fontSize:10,fontWeight:650,fill:"#C4B5FD",fontFamily:${F},children:[${B}(${I})," Bft"]})]},"wind-bft-"+${I}))`;
  const newAxis = `${p50Path},${rightTicks},r.jsx("text",{x:B-58,y:x+O/2,textAnchor:"middle",fontSize:13,fontWeight:850,fill:"#C4B5FD",fontFamily:${F},transform:\`rotate(-90 \${B-58} \${x+O/2})\`,children:"km/u"})`;
  source = replaceOnceOrAlready(source, oldAxis, newAxis, `${config.path}: Beaufort-rechteras`);
  }

  source = patchNationalPlumeSearch(source, config);
  source = patchNationalPlumeRenderer(source, config);
  source = patchNationalModePalette(source, config);
  source = patchNationalSimpleMenu(source, config);
  source = patchNationalSeparatePages(source, config);
  source = patchNationalWeekStart(source, config);
  source = patchNationalWeekQuickEdit(source, config);
  source = patchNationalCustomPlace(source, config);
  source = patchNationalStationWindControls(source, config);
  source = patchNationalMapHeader(source, config);
  source = patchNationalSymbolCatalogToggle(source, config);
  source = patchRegionalSimpleMenu(source, config);

  fs.writeFileSync(config.path, source);
  process.stdout.write(`gepatcht: ${config.path}\n`);
}
