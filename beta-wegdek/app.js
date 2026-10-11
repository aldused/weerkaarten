'use strict';
const $=id=>document.getElementById(id);
const fmt=new Intl.NumberFormat('nl-NL',{minimumFractionDigits:1,maximumFractionDigits:1});
const timeFmt=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',hour:'2-digit',minute:'2-digit'});
const dateFmt=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'});
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const temp=v=>v===null||v===undefined?'Geen data':fmt.format(v)+' °C';
const time=v=>v?timeFmt.format(new Date(v)):'Onbekend';
const roadRefs=p=>p.nearby_road?.refs?.length?p.nearby_road.refs.join(' / '):'—';
const roadName=p=>[p.nearby_road?.name,p.nearby_road?.place].filter(Boolean).join(' · ');
const classes=[[-5,'#5a3789','white','< −5 °C'],[0,'#2863a6','white','−5 tot 0 °C'],[2,'#90cbea','#10233e','0 tot 2 °C'],[5,'#67cebc','#10233e','2 tot 5 °C'],[10,'#b8df8f','#10233e','5 tot 10 °C'],[20,'#f5d477','#10233e','10 tot 20 °C'],[30,'#e99350','#10233e','20 tot 30 °C'],[Infinity,'#b43136','white','≥ 30 °C']];
function color(v){return v==null?{bg:'#d4dbe4',fg:'#34465d'}:(()=>{let c=classes.find(c=>v<c[0]);return{bg:c[1],fg:c[2]};})();}
let data,region,map,scope=location.hash==='#zh'?'zh':'nl',points=[],sortKey='temperature_c',direction=1,selected=null,boundary,pointLayer,clusterLayer,labelLayer,provinceLayer,baseLayer,roadsLayer,roadLabels,roads,stationPopup;
const stationHistoryCache=new Map();
let provinceName='';
const provinceBounds=new Map();
const bounds={nl:[[50.72,3.28],[53.62,7.24]]};
function setScope(next){scope=next;provinceName='';$('province').value='';location.hash=scope;selected=null;render();}
function render(){
 points=data.points.filter(p=>scope==='nl'||p.province_name==='Zuid-Holland');
 $('title').textContent='Wegdektemperaturen '+(scope==='nl'?'Nederland':'Zuid-Holland');
 document.title=$('title').textContent+' — Weerlab demo';$('map-title').textContent='Kaart '+(scope==='nl'?'Nederland':'Zuid-Holland');
 $('province').options[0].textContent=scope==='zh'?'Heel Zuid-Holland':'Heel Nederland';
 for(let s of ['nl','zh']){$(s).classList.toggle('active',scope===s);$(s).setAttribute('aria-pressed',String(scope===s));}
 const summary=data.summary[scope],last=data.points.reduce((a,p)=>(p.source_observed_at||'')>a?p.source_observed_at:a,'');
 const age=(Date.now()-Date.parse(last))/60000;
 $('status').innerHTML='<strong>Demo · echte metingen van '+escape(dateFmt.format(new Date(last)))+' uur.</strong> '+(age>30?'Deze bronmetingen zijn verouderd. ':age>=15?'Deze bronmetingen zijn mogelijk verouderd. ':'')+'Dit is een momentopname; de demo ververst niet automatisch.';
 const cards=[['Koudste wegdek',summary.minimum,'°C','Laagste gemeten waarde'],['Warmste wegdek',summary.maximum,'°C','Hoogste gemeten waarde'],['Gemiddeld wegdek',summary.mean,'°C','Alle geldige meetpunten'],['Meetpunten',summary.count,'','Met een geldige temperatuur'],['Onder het vriespunt',summary.below_zero,'','Meetpunten onder 0 °C'],['Laatste meettijd',time(last),'','Europe/Amsterdam']];
 $('stats').innerHTML=cards.map(([label,value,unit,sub])=>'<div class="stat"><div class="label">'+label+'</div><div class="value">'+(unit?value==null?'—':fmt.format(value):escape(value))+'<span class="unit">'+unit+'</span></div><div class="sub">'+sub+'</div></div>').join('');
 const cold=points.filter(p=>p.temperature_c!=null).sort((a,b)=>a.temperature_c-b.temperature_c).slice(0,5);
 $('coldest').innerHTML=cold.map((p,i)=>'<button class="cold-item" data-station="'+escape(p.source_station_id)+'"><span><span class="rank">'+(i+1)+'</span><span class="station">'+escape(p.source_station_id)+'</span><small>'+escape(p.province_name||'Meetpunt')+' · '+time(p.source_observed_at)+'</small><small class="cold-road-name">'+escape(roadName(p)||'Wegnaam niet vastgesteld')+'</small></span><span class="temp">'+fmt.format(p.temperature_c)+' <small>°C · '+escape(roadRefs(p))+'</small></span></button>').join('')||'<p class="empty">Geen meetpunten beschikbaar.</p>';
 $('coldest').querySelectorAll('button').forEach(el=>el.onclick=()=>selectStation(el.dataset.station,true));
 if(stationPopup){map.closePopup();stationPopup=null;}
 $('detail').innerHTML='<h3>Meetpunt bekijken</h3><p>Klik op de kaart, de lijst of een tabelrij voor de gegevens van een meetpunt.</p>';
 $('source-note').textContent=data.source_note+' '+data.boundary_note+' Opgehaald: '+dateFmt.format(new Date(data.fetched_at))+'.';
 pointLayer.clearLayers();labelLayer.clearLayers();
 boundary.setStyle({opacity:scope==='zh'?1:.55,fillOpacity:scope==='zh'?.025:0,weight:scope==='zh'?2.5:1.5});
 data.points.forEach(p=>{const c=color(p.temperature_c);L.circleMarker([p.latitude,p.longitude],{radius:6,color:'#00205b',weight:2,fillColor:c.bg,fillOpacity:1}).addTo(pointLayer).on('click',()=>selectStation(p.source_station_id,false));});
 fit();refreshPointDisplay();renderTable();renderChart();window.dispatchEvent(new CustomEvent("forecast-scope"));
}
function fit(){
 const target=scope==='zh'?boundary.getBounds():provinceName?provinceBounds.get(provinceName):bounds.nl;
 map.fitBounds(target,{padding:[25,25],animate:false});
 $('map-title').textContent='Kaart '+(scope==='zh'?'Zuid-Holland':provinceName||'Nederland');
 $('national-map').hidden=scope==='nl'&&!provinceName;
 $('map-scope-note').textContent='Alle landelijke meetpunten blijven op de kaart. Overzicht en tabel: '+(scope==='zh'?'Zuid-Holland':'Nederland')+(provinceName?' · kaart ingezoomd op '+provinceName:'');
 provinceLayer.clearLayers();
 if(provinceName)L.geoJSON(window.land.features.find(f=>f.properties.naam===provinceName),{style:{color:'#003366',weight:2.5,fillOpacity:0},interactive:false}).addTo(provinceLayer);
 syncZoom();drawLabels();
}
function syncZoom(){if(!map)return;const zoom=map.getZoom();$('map-zoom').value=zoom;$('zoom-value').textContent=new Intl.NumberFormat('nl-NL',{maximumFractionDigits:2}).format(zoom);}
function resizeMap(){const height=Number($('map-height').value);$('height-value').textContent=height+' px';$('map').style.setProperty('--map-height',height+'px');map.invalidateSize({pan:false});fit();}

function refreshPointDisplay(){
 if(!map||!pointLayer||!clusterLayer)return;
 const enabled=$('show-temperatures').checked,clustered=map.getZoom()<9;
 clusterLayer.clearLayers();
 if(!enabled){map.removeLayer(pointLayer);map.removeLayer(clusterLayer);map.removeLayer(labelLayer);return;}
 if(!map.hasLayer(labelLayer))labelLayer.addTo(map);
 if(!clustered){if(!map.hasLayer(clusterLayer))map.removeLayer(clusterLayer);if(!map.hasLayer(pointLayer))pointLayer.addTo(map);return;}
 map.removeLayer(pointLayer);clusterLayer.addTo(map);
 const cells=new Map(),cellSize=128;
 for(const p of data.points){
  const pos=map.latLngToContainerPoint([p.latitude,p.longitude]);
  const key=Math.floor(pos.x/cellSize)+':'+Math.floor(pos.y/cellSize);
  if(!cells.has(key))cells.set(key,[]);cells.get(key).push(p);
 }
 for(const group of cells.values()){
  if(group.length===1){const p=group[0],c=color(p.temperature_c);L.circleMarker([p.latitude,p.longitude],{radius:5,color:'#00205b',weight:1.5,fillColor:c.bg,fillOpacity:1}).addTo(clusterLayer).on('click',()=>selectStation(p.source_station_id,false));continue;}
  const valid=group.filter(p=>p.temperature_c!=null),values=valid.map(p=>p.temperature_c),avg=values.length?values.reduce((a,b)=>a+b,0)/values.length:null,c=color(avg);
  const low=values.length?fmt.format(Math.min(...values)):'—',high=values.length?fmt.format(Math.max(...values)):'—';
  const icon=L.divIcon({className:'station-cluster-icon',html:'<span class="station-cluster" style="--cluster-color:'+c.bg+';--cluster-text:'+c.fg+'"><strong>'+(avg==null?'—':fmt.format(avg)+'°')+'</strong><small>'+group.length+' meetpunten · '+low+'–'+high+'°</small></span>',iconSize:[112,52],iconAnchor:[56,26]});
  L.marker([group.reduce((s,p)=>s+p.latitude,0)/group.length,group.reduce((s,p)=>s+p.longitude,0)/group.length],{icon,keyboard:true,title:group.length+' meetpunten · gemiddeld '+(avg==null?'geen data':temp(avg))}).addTo(clusterLayer).on('click',()=>{const b=L.latLngBounds(group.map(p=>[p.latitude,p.longitude]));map.fitBounds(b,{padding:[70,70],maxZoom:Math.min(11,map.getZoom()+2),animate:false});});
 }
}
function drawLabels(){
 if(!map||!data)return;labelLayer.clearLayers();const all=true,zoom=map.getZoom();
 let occupied=[],count=0;roadLabels.clearLayers();const view=map.getBounds();
 if(zoom<9){$('labels-status').textContent='Meetpunten gegroepeerd op Nederlandniveau · zoom in voor losse temperaturen en wegnummers';return;}
 for(const p of [...data.points].sort((a,b)=>(a.temperature_c??Infinity)-(b.temperature_c??Infinity))){
  if(!view.contains([p.latitude,p.longitude])||(!all&&p.source_station_id!==selected))continue;
  const latlng=L.latLng(p.latitude,p.longitude),pos=map.latLngToContainerPoint(latlng);let dx=0,dy=0,rect,collision;
  for(const offset of [[0,-40],[104,-25],[-104,-25],[0,40],[104,25],[-104,25]]){[dx,dy]=offset;rect=[pos.x+dx-48,pos.y+dy-15,pos.x+dx+48,pos.y+dy+15];collision=occupied.some(r=>rect[0]<r[2]+6&&rect[2]>r[0]-6&&rect[1]<r[3]+4&&rect[3]>r[1]-4);if(!collision)break;}
  if(collision&&!all)continue;occupied.push(rect);const c=color(p.temperature_c),road=roadRefs(p),tlabel=p.temperature_c==null?'—':fmt.format(p.temperature_c)+'°';
  L.polyline([latlng,map.containerPointToLatLng([pos.x+dx,pos.y+dy])],{color:'#00205b',weight:1.5,opacity:.85,interactive:false}).addTo(labelLayer);
  L.marker(latlng,{icon:L.divIcon({className:'map-label',html:'<span class="temperature-label'+(p.source_station_id===selected?' selected':'')+'" style="background:'+c.bg+';color:'+c.fg+'">'+'<strong>'+escape(tlabel)+'</strong><small>'+escape(road)+'</small></span>',iconSize:[100,34],iconAnchor:[50-dx,15-dy]}),title:p.source_station_id+': '+temp(p.temperature_c)+' · '+road,keyboard:true,zIndexOffset:p.source_station_id===selected?1000:0}).addTo(labelLayer).on('click',()=>selectStation(p.source_station_id,false));count++;
 }
 drawRoadLabels(occupied);
 const visible=data.points.filter(p=>view.contains([p.latitude,p.longitude])).length;
 $('labels-status').textContent=count+' labels · '+visible+' meetpunten in beeld · temperatuur eerst, wegnummer als context';
}
function drawRoadLabels(occupied=[]){
 if(!roadLabels)return [];roadLabels.clearLayers();if(!$('show-roads').checked||map.getZoom()<10)return [];
 const placed=[],view=map.getBounds();
 for(const f of roads.features){
  const lines=f.geometry.type==='MultiLineString'?f.geometry.coordinates:[f.geometry.coordinates];
  for(const line of lines){if(!line.length)continue;const coord=line[Math.floor(line.length/2)],latlng=L.latLng(coord[1],coord[0]);if(!view.contains(latlng))continue;
   const p=map.latLngToContainerPoint(latlng),rect=[p.x-24,p.y-13,p.x+24,p.y+13];
   if(occupied.some(r=>rect[0]<r[2]+6&&rect[2]>r[0]-6&&rect[1]<r[3]+4&&rect[3]>r[1]-4))continue;
   if(placed.some(r=>Math.abs((r[0]+24)-p.x)<100&&Math.abs((r[1]+13)-p.y)<65))continue;placed.push(rect);
   L.marker(latlng,{interactive:false,keyboard:false,icon:L.divIcon({className:'road-label',html:'<span class="road-shield">'+escape(f.properties.ref)+'</span>',iconSize:[48,24],iconAnchor:[24,12]})}).addTo(roadLabels);
  }
 }
 return placed;
}

function selectStation(id,zoom){window.dispatchEvent(new CustomEvent("forecast-station",{detail:id}));const p=data.points.find(p=>p.source_station_id===id);if(!p)return;selected=id;const road=p.nearby_road;
 $('detail').innerHTML='<p class="eyebrow">GESELECTEERD MEETPUNT</p><h3>Station '+escape(id)+'</h3><div class="big">'+temp(p.temperature_c)+'</div><dl><dt>Rijksweg nabij</dt><dd>'+escape(road?road.refs.join(' / '):'Niet vastgesteld')+'</dd><dt>Omgeving (NWB)</dt><dd>'+escape(road?.place||'Niet bekend')+'</dd><dt>Afstand tot weg</dt><dd>'+escape(road?road.distance_m+' m':'—')+'</dd><dt>Provincie</dt><dd>'+escape(p.province_name||'Niet vastgesteld')+'</dd><dt>Coördinaten</dt><dd>'+p.latitude.toFixed(5)+', '+p.longitude.toFixed(5)+'</dd><dt>Meettijd</dt><dd>'+escape(dateFmt.format(new Date(p.source_observed_at||p.fetched_at)))+'</dd><dt>Opgehaald om</dt><dd>'+time(p.fetched_at)+'</dd></dl><p class="road-note">'+(road?'Wegnummer en omgeving geografisch afgeleid uit officiële NWB-wegvakken; geen officiële naam van het meetstation.':'De bron levert geen officiële stationsnaam.')+'</p><section class="station-history" aria-live="polite">Twee-uursverloop wordt geladen…</section>';
 if(zoom)map.setView([p.latitude,p.longitude],Math.max(map.getZoom(),12),{animate:false});drawLabels();renderTable();
 stationPopup=L.popup({maxWidth:360,minWidth:250,autoPan:true,keepInView:true}).setLatLng([p.latitude,p.longitude]).setContent('<strong>Station '+escape(id)+' · '+temp(p.temperature_c)+'</strong><p>Twee-uursverloop wordt geladen…</p>').openOn(map);
 loadStationHistory(p,stationPopup);
}
function stationChart(payload){
 const values=payload.observations.filter(p=>Number.isFinite(p.temperature_c));
 if(!values.length)return '<h3>Laatste 2 uur</h3><p>Geen bronmetingen beschikbaar voor dit meetpunt in deze periode.</p>';
 const start=Date.parse(payload.start),end=Date.parse(payload.end),W=330,H=170,left=42,right=16,top=14,bottom=28;
 const temps=values.map(p=>p.temperature_c),min=Math.min(...temps),max=Math.max(...temps),lo=Math.floor(min-0.5),hi=Math.max(lo+1,Math.ceil(max+0.5));
 const x=t=>left+(Date.parse(t)-start)/(end-start)*(W-left-right),y=v=>H-bottom-(v-lo)/(hi-lo)*(H-top-bottom);
 let svg='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="Temperatuurverloop van station '+escape(payload.station_id)+' in de laatste twee uur">';
 for(let i=0;i<=4;i++){const v=lo+(hi-lo)*i/4;svg+='<line x1="'+left+'" x2="'+(W-right)+'" y1="'+y(v)+'" y2="'+y(v)+'" stroke="#dce4ed"/><text x="'+(left-5)+'" y="'+(y(v)+4)+'" text-anchor="end" font-size="11" fill="#526277">'+fmt.format(v)+'</text>';}
 for(let i=0;i<=4;i++){const t=new Date(start+i*(end-start)/4).toISOString();svg+='<text x="'+x(t)+'" y="'+(H-7)+'" text-anchor="middle" font-size="11" fill="#526277">'+time(t)+'</text>';}
 let prev=null;for(const b of payload.observations){if(b.temperature_c==null){prev=null;continue;}if(prev&&Date.parse(b.time)-Date.parse(prev.time)<=7.5*60000)svg+='<line x1="'+x(prev.time)+'" x2="'+x(b.time)+'" y1="'+y(prev.temperature_c)+'" y2="'+y(b.temperature_c)+'" stroke="#003366" stroke-width="2.5"/>';svg+='<circle cx="'+x(b.time)+'" cy="'+y(b.temperature_c)+'" r="3" fill="#003366"><title>'+time(b.time)+' · '+temp(b.temperature_c)+'</title></circle>';prev=b;}
 const change=values.at(-1).temperature_c-values[0].temperature_c;
 return '<h3>Laatste 2 uur</h3><p class="history-period">'+time(payload.start)+'–'+time(payload.end)+' · tot laatste bronmeting · °C</p>'+svg+'</svg><div class="station-trend"><span>Min <strong>'+temp(min)+'</strong></span><span>Max <strong>'+temp(max)+'</strong></span><span>Verandering <strong>'+(change>0?'+':'')+temp(change)+'</strong></span></div><p class="history-period">'+values.length+' echte meetmomenten · ontbrekende perioden blijven leeg.</p>';
}
async function loadStationHistory(p,popup){
 const id=p.source_station_id;
 try{let payload=stationHistoryCache.get(id);if(!payload){const r=await fetch('data/station-history/'+encodeURIComponent(id)+'.json');if(!r.ok)throw Error('history unavailable');payload=await r.json();stationHistoryCache.set(id,payload);}
 if(selected!==id||stationPopup!==popup)return;
 const markup=stationChart(payload);$('detail').querySelector('.station-history').innerHTML=markup;
 popup.setContent('<div class="station-popup"><p class="eyebrow">Station '+escape(id)+(p.nearby_road?' · nabij '+escape(p.nearby_road.refs.join(' / ')):'')+'</p><div class="popup-temperature">'+temp(p.temperature_c)+'</div>'+markup+'</div>');
 }catch(error){if(selected!==id||stationPopup!==popup)return;const message='<p>Het temperatuurverloop kan momenteel niet worden geladen.</p>';$('detail').querySelector('.station-history').innerHTML=message;popup.setContent('<strong>Station '+escape(id)+'</strong>'+message);}
}

function matches(p){let t=p.temperature_c,q=$('search').value.toLowerCase(),f=$('filter').value;return [p.source_station_id,...(p.nearby_road?.refs||[]),p.nearby_road?.place||''].join(' ').toLowerCase().includes(q)&&(f==='all'||t!=null&&(f==='frost'?t<0:f==='20+'?t>=20:(()=>{let [a,b]=f.split('-').map(Number);return t>=a&&t<b;})()));}
function renderTable(){let list=points.filter(matches).sort((a,b)=>{let x=a[sortKey],y=b[sortKey];if(x==null)return y==null?0:1;if(y==null)return -1;return direction*(typeof x==='number'?x-y:String(x).localeCompare(String(y),'nl',{numeric:true}));});
 $('table-count').textContent=list.length+' van '+points.length+' meetpunten · klik op een rij voor details';
 $('rows').innerHTML=list.length?list.map(p=>'<tr tabindex="0" role="button" aria-label="Bekijk station '+escape(p.source_station_id)+'" class="'+(selected===p.source_station_id?'selected':'')+'" data-station="'+escape(p.source_station_id)+'"><td>'+escape(p.source_station_id)+'</td><td class="road-cell">'+escape(p.nearby_road?.refs.join(' / ')||'—')+'<small>'+escape(roadName(p)||'Wegnaam niet vastgesteld')+'</small></td><td><span class="table-temp" style="--color:'+color(p.temperature_c).bg+'">'+temp(p.temperature_c)+' · '+escape(roadRefs(p))+'</span></td><td>'+escape(p.province_name||'—')+'</td><td>'+p.latitude.toFixed(5)+'</td><td>'+p.longitude.toFixed(5)+'</td><td>'+time(p.source_observed_at)+'</td></tr>').join(''):'<tr><td colspan="7" class="empty">Geen meetpunten voor deze selectie.</td></tr>';
 $('rows').querySelectorAll('tr[data-station]').forEach(el=>{el.onclick=()=>selectStation(el.dataset.station,true);el.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();el.click();}};});
}
function renderChart(){const buckets=data.history[scope].filter(b=>b.count>0);if(!buckets.length){$('chart').innerHTML='<p class="empty">Nog geen historische bronmetingen beschikbaar.</p>';return;}
 const end=Math.max(...buckets.map(b=>Date.parse(b.time))),start=end-24*3600000,W=Math.max(300,$('chart').clientWidth-36),H=225,left=50,right=20,top=15,bottom=35;
 const values=buckets.flatMap(b=>[b.minimum,b.maximum]);let lo=Math.floor(Math.min(...values)/5)*5,hi=Math.ceil(Math.max(...values)/5)*5;if(hi===lo)hi=lo+5;
 const x=t=>left+(Date.parse(t)-start)/(end-start)*(W-left-right),y=v=>H-bottom-(v-lo)/(hi-lo)*(H-top-bottom);
 let svg='<svg viewBox="0 0 '+W+' '+H+'" preserveAspectRatio="none"><rect x="'+left+'" y="'+top+'" width="'+(W-left-right)+'" height="'+(H-top-bottom)+'" fill="#f7f9fc"/>';
 for(let v=lo;v<=hi;v+=5){svg+='<line x1="'+left+'" x2="'+(W-right)+'" y1="'+y(v)+'" y2="'+y(v)+'" stroke="#dce4ed"/><text x="'+(left-8)+'" y="'+(y(v)+4)+'" text-anchor="end" font-size="12" fill="#526277">'+v+'°</text>';}
 for(let i=0;i<=24;i+=(W<500?6:4)){const t=new Date(start+i*3600000).toISOString();svg+='<text x="'+x(t)+'" y="'+(H-10)+'" text-anchor="middle" font-size="12" fill="#526277">'+time(t)+'</text>';}
 for(let [key,c] of [['minimum','#2563a6'],['maximum','#c65631'],['mean','#003366']]){let prev=null;for(const b of buckets){if(prev&&Date.parse(b.time)-Date.parse(prev.time)<=90*60000)svg+='<line x1="'+x(prev.time)+'" y1="'+y(prev[key])+'" x2="'+x(b.time)+'" y2="'+y(b[key])+'" stroke="'+c+'" stroke-width="'+(key==='mean'?3:2)+'"/>';svg+='<circle cx="'+x(b.time)+'" cy="'+y(b[key])+'" r="3" fill="'+c+'"><title>'+time(b.time)+' · '+temp(b[key])+'</title></circle>';prev=b;}}
 $('chart').innerHTML=svg+'</svg>';$('history-note').textContent='Minimum, gemiddelde en maximum · '+buckets.length+' echte bronmomenten · tijd in Europe/Amsterdam';
}
async function start(){try{
 const responses=await Promise.all(['data/temperatures.json','data/zuid-holland.geojson','data/nederland.geojson','data/roads.geojson'].map(url=>fetch(url)));if(responses.some(r=>!r.ok))throw Error('Data unavailable');[data,region,window.land,roads]=await Promise.all(responses.map(r=>r.json()));
 map=L.map('map',{zoomControl:true,attributionControl:true,scrollWheelZoom:false,minZoom:5,maxZoom:17,zoomSnap:0.25,zoomDelta:0.5,fadeAnimation:false});map.attributionControl.setPrefix(false);map.attributionControl.addAttribution('Provinciegrenzen: CBS/PDOK');
 for(const f of [...window.land.features].sort((a,b)=>a.properties.naam.localeCompare(b.properties.naam,'nl'))){const name=f.properties.naam;provinceBounds.set(name,L.geoJSON(f).getBounds());const option=document.createElement('option');option.value=name;option.textContent=name;$('province').append(option);}
 baseLayer=L.tileLayer('https://service.pdok.nl/kadaster/brt-achtergrondkaart/wmts/v2_0/standaard/EPSG:3857/{z}/{x}/{y}.png',{maxZoom:19,maxNativeZoom:19,attribution:'Achtergrondkaart: <a href="https://www.pdok.nl/introductie/-/article/basisregistratie-topografie-achtergrondkaarten-brt-a-" target="_blank" rel="noopener">Kadaster / PDOK</a>',updateWhenIdle:true,keepBuffer:1}).addTo(map);
 baseLayer.on('tileerror',()=>{$('basemap-status').textContent='De achtergrondkaart kan gedeeltelijk niet worden geladen. Controleer je internetverbinding.';$('basemap-status').classList.add('map-warning');});
 baseLayer.on('tileload',()=>{$('basemap-status').textContent='Kadaster / PDOK · water, eilanden, plaatsen en wegen · zoom in voor meer wegnummers.';$('basemap-status').classList.remove('map-warning');});
 L.geoJSON(window.land,{style:{fill:false,color:'#718291',opacity:0.35,weight:1},interactive:false}).addTo(map);
 L.control.scale({imperial:false,position:'bottomleft'}).addTo(map);
 boundary=L.geoJSON(region,{style:{color:'#003366',weight:2,fillOpacity:0},interactive:false}).addTo(map);bounds.zh=boundary.getBounds();provinceLayer=L.layerGroup().addTo(map);map.createPane('roads');map.getPane('roads').style.zIndex=410;roadsLayer=L.geoJSON(roads,{pane:'roads',style:{color:'#a93836',weight:3,opacity:.75},interactive:false}).addTo(map);roadLabels=L.layerGroup().addTo(map);pointLayer=L.layerGroup().addTo(map);clusterLayer=L.layerGroup().addTo(map);labelLayer=L.layerGroup().addTo(map);map.on('moveend zoomend',()=>{refreshPointDisplay();drawLabels();syncZoom();});
 $('legend').innerHTML=[...classes.map(c=>[c[1],c[3]]),['#d4dbe4','Geen data']].map(([c,t])=>'<span class="legend-item"><i class="swatch" style="background:'+c+'"></i>'+t+'</span>').join('');
 $('map-height').value=innerWidth<760?'650':'800';$('map').style.setProperty('--map-height',$('map-height').value+'px');$('height-value').textContent=$('map-height').value+' px';
 $('map-height').oninput=resizeMap;$('map-zoom').oninput=()=>map.setZoom(Number($('map-zoom').value),{animate:false});
 $('province').onchange=()=>{provinceName=$('province').value;if(scope==='zh'&&provinceName){scope='nl';location.hash='nl';render();}else fit();};
 $('nl').onclick=()=>setScope('nl');$('zh').onclick=()=>setScope('zh');$('reset').onclick=fit;$('national-map').onclick=()=>setScope('nl');$('all-labels').onchange=drawLabels;$('show-roads').onchange=()=>{if($('show-roads').checked)roadsLayer.addTo(map);else map.removeLayer(roadsLayer);drawLabels();};$('show-temperatures').onchange=()=>{refreshPointDisplay();drawLabels();};$('filter').onchange=renderTable;$('search').oninput=renderTable;
 document.querySelectorAll('[data-sort]').forEach(b=>b.onclick=()=>{direction=sortKey===b.dataset.sort?-direction:1;sortKey=b.dataset.sort;document.querySelectorAll('[data-sort]').forEach(btn=>{btn.parentElement.setAttribute('aria-sort',btn===b?(direction===1?'ascending':'descending'):'none');btn.textContent=btn.textContent.replace(/ [↑↓↕]$/,'')+' '+(btn===b?(direction===1?'↑':'↓'):'↕');});renderTable();});
 window.addEventListener('resize',()=>{renderChart();drawLabels();});
 window.addEventListener('hashchange',()=>{const s=location.hash==='#zh'?'zh':'nl';if(s!==scope){scope=s;provinceName='';$('province').value='';render();}});render();
 }catch(error){$('status').textContent='De metingen kunnen momenteel niet worden geladen. Probeer de demo later opnieuw te openen.';console.error(error);}}
start();

