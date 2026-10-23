/* ECMWF ENS storm viewer. Missing values are never interpreted as 0%. */
'use strict';
const $ = id => document.getElementById(id);
const COLORS = ['#fff2bd','#f9da80','#f3b45f','#ec884b','#e66146','#d53f51','#bb315f','#962d6f','#73296f','#4f235e'];
COLORS.forEach(c => {const el=document.createElement('i');el.style.background=c;$('colors').append(el);});
const map = L.map('map', {preferCanvas:true, zoomSnap:0.25, minZoom:3,maxZoom:9}).setView([52,-5],4);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  crossOrigin:true, attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',maxZoom:19
}).addTo(map);
map.createPane('gusts');map.getPane('gusts').style.zIndex=350;
const lines=L.layerGroup().addTo(map), markers=L.layerGroup().addTo(map);
let data=null, file=null, frame=0, timer=null, overlay=null, loading=false, loadError='', systemChoice='auto', pickedId=null, selectionNote='';
const utc = s => new Intl.DateTimeFormat('nl-NL',{weekday:'short',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'UTC'}).format(new Date(s))+' UTC';
function systems(){return data?.systems?.length ? data.systems : data ? [{id:'legacy',seed:data.seed,start_hour:0,tracks:data.tracks}] : [];}
function activeSystem(){return systems().find(s=>s.id===pickedId)||systems()[0]||null;}
function activeTracks(){return activeSystem()?.tracks||data.tracks;}
function autoSystem(){
  const now=Date.now();
  const score=s=>{
    const control=s.tracks.find(t=>t.member===0);
    let points=control.points.filter((p,i)=>p&&Date.parse(data.frames[i].valid)>=now&&p[0]>=40&&p[0]<=65&&p[1]>=-40&&p[1]<=20);
    return points.length?Math.min(...points.map(p=>p[2])):Infinity;
  };
  return [...systems()].sort((a,b)=>score(a)-score(b))[0]||null;
}
function selectSystem(fit=true){
  const before=pickedId;
  const selected=systemChoice==='auto'?autoSystem():systems().find(s=>s.id===systemChoice);
  pickedId=selected?.id||systems()[0]?.id;
  const s=activeSystem();if(!s)return;
  if(before!==pickedId && Number.isFinite(s.deepest_hour))frame=Math.max(0,data.frames.findIndex(f=>f.hour===s.deepest_hour));
  if(frame<s.start_hour/3)frame=Math.max(0,data.frames.findIndex(f=>f.hour>=s.start_hour));
  if(fit||before!==pickedId){const positions=s.tracks.flatMap(t=>t.points.filter(Boolean).map(p=>p.slice(0,2)));if(positions.length)map.fitBounds(L.latLngBounds(positions).pad(.08),{maxZoom:6,animate:false});}
  const title=s.storm_name?'Storm '+s.storm_name:'Lagedrukgebied'+(s.minimum_hpa?' · minimum '+Math.round(s.minimum_hpa)+' hPa':' · ECMWF ENS');
  $('storm-name').textContent=title;$('map-name').textContent=title;
}
function updateSystemMenu(){
  $('system').replaceChildren(new Option('Automatisch · diepste komende laag','auto'),...systems().map((s,i)=>new Option(`Laag ${i+1} · min. ${Math.round(s.minimum_hpa||s.seed?.[2]||0)} hPa · ${utc(data.frames.find(f=>f.hour===s.deepest_hour)?.valid||data.run)}`,s.id)));
  $('system').value=systemChoice;$('system').disabled=false;
}
function mean(points){
  if(!points.length)return null;
  let x=0,y=0,z=0;
  for(const p of points){const a=p[0]*Math.PI/180,b=p[1]*Math.PI/180;x+=Math.cos(a)*Math.cos(b);y+=Math.cos(a)*Math.sin(b);z+=Math.sin(a);}
  return [Math.atan2(z,Math.hypot(x,y))*180/Math.PI,Math.atan2(y,x)*180/Math.PI];
}
function color(p){return p>=10 ? COLORS[Math.min(9,Math.floor(p/10)-1)] : null;}
function stop(){clearInterval(timer);timer=null;$('play').textContent='▶';$('play').setAttribute('aria-label','Animatie starten');}
function segments(points){const out=[];let part=[];for(const p of points){if(p)part.push(p.slice(0,2));else if(part.length){out.push(part);part=[];}}if(part.length)out.push(part);return out;}
function status(){
  if(!data)return;
  const age=(Date.now()-new Date(data.run))/36e5;
  const f=data.frames[frame], g=f.gust;
  const notes=[];
  if(loadError)notes.push(loadError);
  if(selectionNote)notes.push(selectionNote);
  if(systemChoice==='auto'&&activeSystem())notes.push('Automatisch: diepste nog verwachte gesloten laag binnen 40–65°N, 40°W–20°E. Het windstootkansveld blijft het volledige ENS-product.');
  if(age>24)notes.push('Verouderde modelrun: meer dan 24 uur oud.');
  if(!activeSystem()?.seed)notes.push('Geen gesloten lagedrukkern gevonden in het zoekgebied. Er wordt geen stormbaan getekend.');
  if(g && g.end_hour-g.start_hour<3)notes.push(`Windstootkans geldt voor ${g.end_hour-g.start_hour} uur vóór de gekozen tijd; tussenliggende uren zijn niet beschikbaar in deze drie-uurlijkse dataset.`);
  if(!g)notes.push('Geen windstootkans voor deze tijd: '+(f.hour===0?'op +0u is geen maximumtijdvenster beschikbaar.':'windstootvelden ontbreken of hebben verschillende tijdvensters.'));
  else if(g.members.length<51)notes.push(`Onvolledig ensemble: ${g.members.length}/51 leden voor windstoten. De kans gebruikt uitsluitend deze beschikbare leden.`);
  const count=activeTracks().filter(t=>t.points[frame]).length;
  if(activeSystem()?.seed && count<51)notes.push(`${count}/51 gekoppelde lagedrukkernen op deze tijd. Ontbrekende banen worden niet aangevuld.`);
  $('notice').classList.toggle('warn',notes.length>0);
  $('notice').textContent=notes.join('\n') || '51/51 leden beschikbaar · drukbanen en windstootkans zijn afzonderlijk berekend · alle tijden UTC';
}
function render(){
  if(!data)return;
  const f=data.frames[frame], g=f.gust;
  $('valid').textContent=utc(f.valid);$('map-time').textContent=utc(f.valid)+` · +${f.hour}u`;$('time').value=frame;
  lines.clearLayers();markers.clearLayers();if(overlay){map.removeLayer(overlay);overlay=null;}
  const selected=$('member').value;
  const means=data.frames.map((_,i)=>mean(activeTracks().map(t=>t.points[i]).filter(Boolean)));
  if($('tracks').checked){
    for(const t of [...activeTracks()].sort((a,b)=>b.member-a.member)){
      if(selected!=='all'&&+selected!==t.member)continue;
      const control=t.member===0, style={color:control?'#ed991c':'#526d9f',weight:control?3:1.2,opacity:control?1:.36};
      for(const segment of segments(t.points))L.polyline(segment,style).bindTooltip(control?'Control (IFS oper/fc)':`ENS-lid ${t.member}`).addTo(lines);
      const p=t.points[frame];if(p)L.circleMarker(p.slice(0,2),{radius:control?5:2.5,color:style.color,fillOpacity:.95,weight:1}).bindTooltip(`${control?'Control':'Lid '+t.member}: ${p[2]} hPa · ${utc(f.valid)}`).addTo(markers);
    }
    if(selected==='all'){
      for(const seg of segments(means))L.polyline(seg,{color:'#124ed6',weight:3.5,dashArray:'8 6',opacity:1}).addTo(lines);
      const m=means[frame];if(m)L.circleMarker(m,{color:'#124ed6',radius:7,fillColor:'white',fillOpacity:1,weight:3}).bindTooltip(`Gemiddelde kernpositie · ${activeTracks().filter(t=>t.points[frame]).length} leden`).addTo(markers);
      means.forEach((p,i)=>{if(!p||data.frames[i].hour%24)return;L.marker(p,{interactive:false,icon:L.divIcon({className:'',html:`<span class="core-label">${utc(data.frames[i].valid)}</span>`,iconAnchor:[-8,8]})}).addTo(markers);});
    }
  }
  if(g&&$('gust').checked){
    const {lat,lon}=data.grid, c=document.createElement('canvas');c.width=lon.length;c.height=lat.length;
    const ctx=c.getContext('2d'), img=ctx.createImageData(c.width,c.height);
    for(let y=0;y<lat.length;y++)for(let x=0;x<lon.length;x++){
      const p=g.values[y][x], n=g.counts[y][x], hex=n>0&&Number.isFinite(p)?color(p):null;if(!hex)continue;
      const i=((lat.length-1-y)*lon.length+x)*4;img.data[i]=parseInt(hex.slice(1,3),16);img.data[i+1]=parseInt(hex.slice(3,5),16);img.data[i+2]=parseInt(hex.slice(5,7),16);img.data[i+3]=185;
    }
    ctx.putImageData(img,0,0);
    // ImageOverlay is linear in Mercator y; pre-warp source rows into Mercator.
    const merc=a=>Math.log(Math.tan(Math.PI/4+a*Math.PI/360));
    const south=lat[0]-data.grid.resolution/2,north=lat.at(-1)+data.grid.resolution/2, lo=merc(south),hi=merc(north);
    const warped=document.createElement('canvas');warped.width=c.width;warped.height=c.height*3;
    const w=warped.getContext('2d');w.imageSmoothingEnabled=false;
    for(let y=0;y<warped.height;y++){
      const a=(2*Math.atan(Math.exp(hi-(y+.5)/warped.height*(hi-lo)))-Math.PI/2)*180/Math.PI;
      const src=Math.max(0,Math.min(c.height-1,Math.floor((north-a)/data.grid.resolution)));
      w.drawImage(c,0,src,c.width,1,0,y,c.width,1);
    }
    overlay=L.imageOverlay(warped.toDataURL(),[[south,lon[0]-data.grid.resolution/2],[north,lon.at(-1)+data.grid.resolution/2]],{pane:'gusts',className:'gust-layer',interactive:false}).addTo(map);
  }
  $('window').textContent=g?`Maximum van +${g.start_hour}u tot +${g.end_hour}u · ${utc(new Date(new Date(data.run).getTime()+g.start_hour*36e5))} – ${utc(f.valid)}`:'Geen geldig windstootvenster';
  $('coverage').textContent=g?`${g.members.length}/51 leden · rooster ${String(data.grid.resolution).replace('.',',')}° · strikt >90 km/u · ongekleurd bij <10% · kernposities op geselecteerde tijd: ${activeTracks().filter(t=>t.points[frame]).length}/51`:'Kansveld niet beschikbaar. Ontbrekende data betekenen geen 0% kans.';
  status();
}
map.on('click',e=>{
  if(!data)return;const g=data.frames[frame].gust;if(!g||!$('gust').checked)return;
  const {lat,lon}=data.grid,y=Math.round((e.latlng.lat-lat[0])/data.grid.resolution),x=Math.round((e.latlng.lng-lon[0])/data.grid.resolution);
  if(y<0||x<0||y>=lat.length||x>=lon.length)return;
  const p=g.values[y][x],n=g.counts[y][x];
  L.popup().setLatLng(e.latlng).setContent(n?`<b>${p.toFixed(1)}% kans op &gt;90 km/u</b><br>${Math.round(p*n/100)} van ${n} beschikbare leden<br>+${g.start_hour}–${g.end_hour}u · ${utc(data.frames[frame].valid)}<br>Roosterpunt ${lat[y].toFixed(2)}°N, ${lon[x].toFixed(2)}°E`:'Geen windstootdata voor dit punt').openOn(map);
});
function validate(d){
  if(d.schema!==1||d.expected_members!==51||d.threshold_kmh!==90||!Array.isArray(d.frames)||!d.frames.length||d.tracks?.length!==51||!Number.isFinite(Date.parse(d.run)))throw Error('Ongeldig dataschema');
  const members=d.tracks.map(t=>t.member);if(new Set(members).size!==51||members.some(m=>!Number.isInteger(m)||m<0||m>50))throw Error('Ongeldige leden');
  if(!d.grid?.lat?.length||!d.grid?.lon?.length)throw Error('Rooster ontbreekt');
  for(const t of d.tracks)if(t.points.length!==d.frames.length||t.points.some(p=>p!==null&&(!Array.isArray(p)||p.length!==3||p.some(v=>!Number.isFinite(v)))))throw Error('Ongeldige baan');
  if(d.systems){
    if(!Array.isArray(d.systems)||new Set(d.systems.map(s=>s.id)).size!==d.systems.length)throw Error('Ongeldige lagedruksystemen');
    for(const s of d.systems){
      if(typeof s.id!=='string'||!Number.isInteger(s.start_hour)||s.start_hour<0||s.tracks?.length!==51)throw Error('Ongeldig lagedrukgebied');
      if(new Set(s.tracks.map(t=>t.member)).size!==51||s.tracks.some(t=>!members.includes(t.member)))throw Error('Ongeldige systeemleden');
      for(const t of s.tracks)if(t.points.length!==d.frames.length||t.points.some(p=>p!==null&&(!Array.isArray(p)||p.length!==3||p.some(v=>!Number.isFinite(v)))))throw Error('Ongeldige systeembaan');
    }
  }
  for(const f of d.frames){
    if(!Number.isFinite(Date.parse(f.valid))||!Number.isFinite(f.hour))throw Error('Ongeldige tijd');
    const g=f.gust;if(!g)continue;
    if(!g.members.length||new Set(g.members).size!==g.members.length||g.members.some(m=>!members.includes(m))||!(g.start_hour<g.end_hour)||g.end_hour!==f.hour)throw Error('Ongeldig windstootvenster');
    if(g.values.length!==d.grid.lat.length||g.counts.length!==d.grid.lat.length)throw Error('Ongeldig kansrooster');
    g.values.forEach((row,y)=>{if(row.length!==d.grid.lon.length||g.counts[y].length!==row.length)throw Error('Roostergrootte');row.forEach((v,x)=>{const n=g.counts[y][x];if(!Number.isFinite(v)||v<0||v>100||!Number.isInteger(n)||n<1||n>g.members.length)throw Error('Ongeldige kans/noemer');});});
  }
}
async function getJSON(url){const r=await fetch(url,{cache:'no-store',signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error(`HTTP ${r.status}`);return r.json();}
async function load(){
  if(loading)return;loading=true;$('refresh').disabled=true;
  try{
    const manifest=await getJSON('data/current.json');
    if(!/^ens-\d{10}-[a-f0-9]{12}\.json$/.test(manifest.file))throw Error('Ongeldige publicatie');
    if(manifest.file!==file){
      const next=await getJSON('data/'+manifest.file);validate(next);if(next.run!==manifest.run)throw Error('Modelruns verschillen');
      const oldTime=data?.frames[frame]?.valid, oldData=data, oldSystem=data?activeSystem():null;
      stop();data=next;file=manifest.file;selectionNote='';
      if(systemChoice!=='auto'&&oldSystem){
        let best=null,bestDistance=600;
        for(const s of systems())for(let i=0;i<s.tracks[0].points.length;i++){
          const point=s.tracks.find(t=>t.member===0).points[i];if(!point)continue;
          const oldIndex=oldData.frames.findIndex(f=>f.valid===data.frames[i].valid), oldPoint=oldSystem.tracks.find(t=>t.member===0).points[oldIndex];
          if(!oldPoint)continue;const km=map.distance(point.slice(0,2),oldPoint.slice(0,2))/1000;
          if(km<bestDistance){best=s;bestDistance=km;}
        }
        systemChoice=best?.id||'auto';if(!best)selectionNote='Het eerder gekozen laag kon niet aan de nieuwe run worden gekoppeld. Automatische selectie is hervat.';
      }
      updateSystemMenu();
      frame=Math.max(0,data.frames.findIndex(f=>f.valid===oldTime));if(!oldTime)frame=Math.min(8,data.frames.length-1);
      $('member').replaceChildren(new Option('Alle 51 leden','all'),...activeTracks().map(t=>new Option(t.member===0?'Control (oper/fc)':'ENS-lid '+t.member,String(t.member))));
      $('time').max=data.frames.length-1;
      for(const id of ['member','time','play','prev','next'])$(id).disabled=false;
      selectSystem(true);
      $('run').textContent=`Run ${utc(data.run)} · 50 ENS-leden + control · bijgewerkt ${utc(data.generated)}`;
      $('issues').textContent=data.issues.length?data.issues.join('\n'):'Geen ontbrekende bronvelden gemeld.';
    }
    loadError='';if(systemChoice==='auto')selectSystem(false);render();
  }catch(e){
    loadError=`Nieuwe ECMWF-publicatie niet beschikbaar (${e.message}). `+(data?'Laatste geldige set blijft zichtbaar.':'Er worden geen banen of kansen verzonnen.');
    if(data)status();else{$('notice').textContent=loadError;$('notice').classList.add('warn');}
  }finally{loading=false;$('refresh').disabled=false;}
}
$('time').oninput=()=>{stop();frame=+$('time').value;render();};
$('prev').onclick=()=>{stop();frame=Math.max(0,frame-1);render();};$('next').onclick=()=>{stop();frame=Math.min(data.frames.length-1,frame+1);render();};
$('play').onclick=()=>{if(timer){stop();return;}$('play').textContent='Ⅱ';$('play').setAttribute('aria-label','Animatie pauzeren');timer=setInterval(()=>{frame=(frame+1)%data.frames.length;render();},1100);};
for(const id of ['member','tracks','gust'])$(id).onchange=render;
$('system').onchange=()=>{stop();systemChoice=$('system').value;selectionNote='';selectSystem(true);render();};
$('refresh').onclick=load;document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();else load();});
load();setInterval(load,300000);
