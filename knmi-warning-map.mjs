import {assertFeed,liveWarnings,formatValidity,containsPoint,rank,colors} from './knmi-warning-core.mjs?v=20261014-polygons';

const $=id=>document.getElementById(id),NS='http://www.w3.org/2000/svg';
let data=null,geo=null,bounds=null,visible=[],selected=null,pin=null,view=null,baseView=null,loading=false,drag=null,wasDrag=false;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const node=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
const date=v=>new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(v));
const factor=Math.cos(52.2*Math.PI/180);
const project=([lon,lat])=>[(lon-3)*factor,-(lat-50.6)];
function positions(g){return g.type==='Polygon'?g.coordinates:g.coordinates.flat();}
function path(g){return positions(g).map(ring=>ring.map((p,i)=>{const [x,y]=project(p);return (i?'L':'M')+((x-bounds.minx)*100).toFixed(3)+','+((y-bounds.miny)*100).toFixed(3);}).join(' ')+'Z').join(' ');}
function list(){return data?liveWarnings($('warningType').value==='outlook'?data.outlook||[]:data.warnings):[];}
function makeSelectors(){
 const previous=$('phenomenon').value;
 const names=[...new Set(list().map(w=>w.fenomeen))];
 $('phenomenon').replaceChildren(...(names.length?names:['']).map(name=>{const o=node('option',name||'Geen waarschuwingen');o.value=name;return o;}));
 if(names.includes(previous))$('phenomenon').value=previous;
 $('warningType').options[1].disabled=data.mode!=='polygons';
 $('warningTime').disabled=data.mode!=='polygons';
}
function chosen(){
 const hour=$('warningTime').value,point=Date.now()+Number(hour)*3600000;
 return list().filter(w=>w.fenomeen===$('phenomenon').value&&(hour==='all'||!w.onset||(Date.parse(w.onset)<=point&&point<Date.parse(w.expires))));
}
function describeWarning(w){
 const section=document.createElement('section');section.className='warning-card';
 const bar=node('div','','bar');bar.style.background=colors[w.code];section.append(bar);
 const body=node('div','','body');
 body.append(node('b',($('warningType').value==='outlook'?'Mogelijk gevaarlijk weer · niveau ':'Code ')+w.code+' — '+w.fenomeen));
 if(w.headline)body.append(node('p',w.headline));
 body.append(node('div',w.detail||'','meta knmi-detail'),node('div',(w.gebieden||[]).join(' · '),'areas'),node('p',formatValidity(w),'meta'));
 if(w.probability)body.append(node('p','Kans: '+w.probability+'%','meta'));
 if(w.impact)body.append(node('p',w.impact,'knmi-detail'));
 if(w.instruction)body.append(node('p',w.instruction,'knmi-detail'));
 section.append(body);return section;
}
function render(){
 if(!geo)return;
 const current=data&&Date.now()-Date.parse(data.generated)<=45*60000;
 visible=current?chosen():[];
 if(selected&&!visible.includes(selected))selected=null;
 const polygonMode=data?.mode==='polygons';
 const provinceFill=name=>{
  if(!current||polygonMode)return '#edf2f6';
  if(data.errors?.[name]||!data.provinces[name]||data.provinces[name].code===null)return '#aab4bf';
  const warnings=visible.filter(w=>w.gebieden?.includes(name));
  const code=warnings.reduce((c,w)=>rank[w.code]>rank[c]?w.code:c,'groen');return colors[code];
 };
 const basemap=geo.features.map(f=>`<path class="prov" d="${path(f.geometry)}" fill="${provinceFill(f.properties.statnaam)}" style="fill:${provinceFill(f.properties.statnaam)}" stroke="#738396" stroke-width=".4" fill-rule="evenodd"><title>${esc(f.properties.statnaam)}</title></path>`).join('');
 const areas=polygonMode?[...visible].sort((a,b)=>rank[a.code]-rank[b.code]).map(w=>`<path class="warning-area" tabindex="0" role="button" aria-label="${esc(w.fenomeen+' · code '+w.code+' · '+formatValidity(w))}" data-id="${esc(w.id)}" d="${path(w.geometry)}" fill="${colors[w.code]}" stroke="#41546a" stroke-width=".65" fill-opacity=".8" fill-rule="evenodd"><title>${esc(w.fenomeen+' · code '+w.code+' · '+formatValidity(w))}</title></path>`).join(''):'';
 const pinSVG=pin?`<circle class="location-pin" cx="${pin.x}" cy="${pin.y}" r="2.4"/>`:'';
 $('mapHost').innerHTML=`<svg class="nl" xmlns="${NS}" viewBox="${(view||baseView).join(' ')}" aria-label="KNMI-waarschuwingskaart ${esc($('phenomenon').value)}"><rect x="-20" y="-20" width="${baseView[2]+40}" height="${baseView[3]+40}" fill="#e4f1f7"/>${basemap}${areas}${pinSVG}</svg>`;
 $('warningListTitle').textContent=$('warningType').value==='outlook'?'Mogelijk gevaarlijk weer':'Afgegeven waarschuwingen';
 const cards=visible.map(describeWarning);
 $('warningList').replaceChildren(...(cards.length?cards:[node('p',current?'Geen '+($('warningType').value==='outlook'?'aanwijzingen voor mogelijk gevaarlijk weer':'waarschuwingen')+' in deze selectie.':'Actuele waarschuwingen zijn niet beschikbaar.','warning-empty')]));
 $('reasonsList').replaceChildren(...visible.map(w=>node('p',w.fenomeen+' · '+(w.gebieden||[]).join(', ')+' · '+formatValidity(w))));
 $('mapPeriod').textContent=$('warningTime').value==='all'?'Alle geldige perioden · geldigheid staat bij elk gebied':date(Date.now()+Number($('warningTime').value)*3600000);
 const sw=document.querySelector('.scale .sw');if(sw){sw.style.background=!current?'#aab4bf':polygonMode?'#edf2f6':colors.groen;sw.nextElementSibling.textContent=!current?'Gegevens niet beschikbaar':polygonMode?'Geen geselecteerd waarschuwingsgebied':'Geen waarschuwing voor dit fenomeen';}
 $('btnDownloadAll').disabled=!current;
 $('btnDownloadProv').disabled=!selected||!current;
 $('btnDownloadProv').style.opacity=selected&&current?'1':'.5';
 renderLocation();
}
function renderLocation(){
 const content=$('provPanelContent');content.replaceChildren();
 if(!pin){content.append(node('p','Klik op de kaart voor de waarschuwingen op dat punt. Zoom in voor meer detail.'));return;}
 content.append(node('p',pin.lat.toFixed(4)+'° N, '+pin.lon.toFixed(4)+'° E'));
 if(!data||Date.now()-Date.parse(data.generated)>45*60000){content.append(node('p','Actuele gegevens niet beschikbaar.'));return;}
 let matches;
 if(data.mode==='polygons'){
  const hour=$('warningTime').value,time=Date.now()+Number(hour)*3600000;
  matches=list().filter(w=>containsPoint(w.geometry,pin.lon,pin.lat)&&(hour==='all'||(Date.parse(w.onset)<=time&&time<Date.parse(w.expires))));
 }
 else{
  const province=geo.features.find(f=>containsPoint(f.geometry,pin.lon,pin.lat));
  if(!province){content.append(node('p','Dit punt ligt buiten de huidige provinciebron.'));return;}
  const name=province.properties.statnaam;content.append(node('p','Huidige KNMI-bron: '+name+' (provincie).'));
  if(data.errors?.[name]||data.provinces[name]?.code==null){content.append(node('p','Voor deze provincie zijn geen actuele gegevens beschikbaar.'));return;}
  matches=list().filter(w=>w.gebieden?.includes(name));
 }
 content.append(...(matches.length?matches.map(describeWarning):[node('p','Geen '+($('warningType').value==='outlook'?'aanwijzingen voor mogelijk gevaarlijk weer':'afgegeven waarschuwingen')+' voor dit punt.')]));
 if(data.mode==='polygons')content.append(node('p','Dicht bij een gebiedsgrens? Houd extra rekening met het weer.'));
}
function sourceMessage(error){
 const text=error?'Gegevens niet beschikbaar: '+error+' Bekijk de actuele waarschuwingen bij het KNMI.':data.mode==='polygons'?'Officiële KNMI-gebieden · kies één weerfenomeen. Kleuren gelden alleen voor de getekende gebieden en aangegeven perioden.': 'Huidige KNMI-bron: provincies. De overgang naar flexibele gebieden is gepland vanaf 2 november; zodra de officiële bron operationeel is, schakelt deze kaart automatisch om.';
 $('sourceMode').textContent=text;$('sourceMode').classList.toggle('source-error',!!error);
}
async function refresh(){
 if(loading)return;loading=true;
 try{
  const response=await fetch('https://data.weerlab.nl/waarschuwingen.json?t='+Date.now(),{cache:'no-store'});
  if(!response.ok)throw Error('KNMI-feed HTTP '+response.status);
  const next=assertFeed(await response.json());data=next;
  if(data.mode!=='polygons')$('warningType').value='warning';
  makeSelectors();sourceMessage();
  $('lastUpdate').textContent='KNMI · gecontroleerd '+date(data.generated)+(data.issued?' · uitgegeven '+date(data.issued):'');render();
 }catch(error){
  sourceMessage(error.message);$('lastUpdate').textContent='Ophalen mislukt';
  if(!data||Date.now()-Date.parse(data.generated)>45*60000){data=null;selected=null;render();}
 }finally{loading=false;}
}
function zoom(multiplier,center=pin){
 const v=view||baseView,w=v[2]*multiplier,h=v[3]*multiplier;
 if(w>baseView[2]*1.01||w<baseView[2]/16){if(w>baseView[2])view=null;render();return;}
 view=[(center?.x??(v[0]+v[2]/2))-w/2,(center?.y??(v[1]+v[3]/2))-h/2,w,h];render();
}
function showArea(w){
 selected=w;$('provPanelContent').replaceChildren(describeWarning(w));$('provPanelTitle').textContent='Geselecteerd waarschuwingsgebied';
 $('btnDownloadProv').disabled=false;$('btnDownloadProv').style.opacity='1';
}
function locate(lon,lat,name=''){
 const [x,y]=project([lon,lat]);pin={x:(x-bounds.minx)*100,y:(y-bounds.miny)*100,lon,lat};selected=null;
 view=[pin.x-30,pin.y-30,60,60];$('provPanelTitle').textContent=name?'KNMI · '+name:'Waarschuwing voor uw locatie';render();
}
let locationRequest=0;
async function searchLocation(event){
 event.preventDefault();const query=$('locationQuery').value.trim(),request=++locationRequest;if(!query)return;
 const coordinates=query.match(/^(-?\d+(?:[.,]\d+)?)\s*[,; ]\s*(-?\d+(?:[.,]\d+)?)$/);
 if(coordinates){const lat=Number(coordinates[1].replace(',','.')),lon=Number(coordinates[2].replace(',','.'));if(lat>=50.5&&lat<=54&&lon>=3&&lon<=7.7){locate(lon,lat);$('locationResults').replaceChildren();return;}}
 $('locationResults').replaceChildren(node('p','Locatie zoeken…'));
 try{
  const response=await fetch('https://geocoding-api.open-meteo.com/v1/search?name='+encodeURIComponent(query)+'&count=10&language=nl&format=json',{signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw Error('Locatiezoekdienst niet beschikbaar.');const result=await response.json();if(request!==locationRequest)return;
  const places=(result.results||[]).filter(p=>p.country_code==='NL'&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude));
  $('locationResults').replaceChildren(...(places.length?places.map(place=>{const button=node('button',place.name+(place.admin1?' · '+place.admin1:''));button.type='button';button.onclick=()=>{locate(place.longitude,place.latitude,place.name);$('locationResults').replaceChildren();};return button;}):[node('p','Geen plaats gevonden. Vul eventueel de coördinaten in als lat, lon.')]));
 }catch(error){if(request===locationRequest)$('locationResults').replaceChildren(node('p',error.message));}
}
function download(areaOnly=false){
 if(!data)return;
 const warnings=areaOnly&&selected?[selected]:visible;
 const svg=$('mapHost').querySelector('svg').cloneNode(true);svg.querySelectorAll('.location-pin').forEach(n=>n.remove());
 let exportView=baseView;
 if(areaOnly&&selected?.geometry){
  const points=positions(selected.geometry).flat().map(p=>{const [x,y]=project(p);return [(x-bounds.minx)*100,(y-bounds.miny)*100];});
  const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);exportView=[Math.min(...xs)-4,Math.min(...ys)-4,Math.max(...xs)-Math.min(...xs)+8,Math.max(...ys)-Math.min(...ys)+8];
  svg.querySelectorAll('.warning-area').forEach(n=>{if(n.dataset.id!==selected.id)n.remove();});
 }
 svg.setAttribute('viewBox',exportView.join(' '));svg.setAttribute('width','800');svg.setAttribute('height',String(Math.round(800*exportView[3]/exportView[2])));
 const title='KNMI · '+($('warningType').value==='outlook'?'Mogelijk gevaarlijk weer':'Waarschuwingen')+' · '+($('phenomenon').value||'Nederland');
 const lines=[title,$('mapPeriod').textContent,...warnings.flatMap(w=>[(w.warning_type==='potentially-dangerous-weather'?'Mogelijk gevaarlijk weer · ':'Code ')+w.code+' · '+(w.gebieden||[]).join(', '),formatValidity(w)]),'KNMI · uitgifte '+date(data.issued||data.generated)+' · Weerlab / Ed Aldus'];
 const image=new Image(),url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}));
 image.onload=()=>{const canvas=document.createElement('canvas'),mapHeight=Number(svg.getAttribute('height'));canvas.width=1000;canvas.height=mapHeight+90+lines.length*25;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,100,20,800,mapHeight);ctx.fillStyle='#102b46';ctx.font='16px Arial';lines.forEach((line,i)=>ctx.fillText(line,20,mapHeight+55+i*25,960));URL.revokeObjectURL(url);canvas.toBlob(blob=>{const a=document.createElement('a'),target=URL.createObjectURL(blob);a.href=target;a.download='knmi_'+(areaOnly?'gebied':'Nederland')+'_'+new Date().toISOString().slice(0,10)+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(target),1000);});};
 image.onerror=()=>{URL.revokeObjectURL(url);sourceMessage('Download mislukt; probeer opnieuw.');};image.src=url;
}
async function init(){
 try{
  const response=await fetch('nl_provincies_wadden.geojson');if(!response.ok)throw Error('Basiskaart niet beschikbaar');geo=await response.json();
  const pts=geo.features.flatMap(f=>positions(f.geometry).flat().map(project));
  bounds={minx:Math.min(...pts.map(p=>p[0])),maxx:Math.max(...pts.map(p=>p[0])),miny:Math.min(...pts.map(p=>p[1])),maxy:Math.max(...pts.map(p=>p[1]))};
  baseView=[-6,-6,(bounds.maxx-bounds.minx)*100+12,(bounds.maxy-bounds.miny)*100+12];render();await refresh();
 }catch(error){sourceMessage(error.message);return;}
 $('warningType').addEventListener('change',()=>{selected=null;makeSelectors();render();});
 for(const id of ['phenomenon','warningTime'])$(id).addEventListener('change',()=>{selected=null;render();});
 $('zoomIn').onclick=()=>zoom(.7);$('zoomOut').onclick=()=>zoom(1/.7);$('zoomReset').onclick=()=>{view=null;render();};
 $('btnRefresh').onclick=refresh;$('btnDownloadAll').onclick=()=>download();$('btnDownloadProv').onclick=()=>download(true);
 $('warningLocation').addEventListener('submit',searchLocation);
 $('mapHost').addEventListener('click',event=>{
  if(wasDrag){wasDrag=false;return;}
  const svg=$('mapHost').querySelector('svg'),p=svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;
  const v=p.matrixTransform(svg.getScreenCTM().inverse());pin={x:v.x,y:v.y,lon:(v.x/100+bounds.minx)/factor+3,lat:50.6-(v.y/100+bounds.miny)};
  $('provPanelTitle').textContent='Waarschuwing voor uw locatie';selected=null;render();
  const hit=event.target.closest('.warning-area');if(hit)showArea(visible.find(w=>w.id===hit.dataset.id));
 });
 $('mapHost').addEventListener('pointerdown',event=>{wasDrag=false;if(!view||event.button!==0)return;const svg=$('mapHost').querySelector('svg');drag={x:event.clientX,y:event.clientY,view:[...view],scale:svg.getScreenCTM().a};$('mapHost').setPointerCapture(event.pointerId);});
 $('mapHost').addEventListener('pointermove',event=>{if(!drag)return;const dx=(event.clientX-drag.x)/drag.scale,dy=(event.clientY-drag.y)/drag.scale;if(Math.abs(dx)+Math.abs(dy)<1)return;wasDrag=true;view=[drag.view[0]-dx,drag.view[1]-dy,drag.view[2],drag.view[3]];render();});
 $('mapHost').addEventListener('pointerup',()=>{drag=null;});$('mapHost').addEventListener('pointercancel',()=>{drag=null;});
 $('mapHost').addEventListener('wheel',event=>{if(!event.ctrlKey)return;event.preventDefault();const svg=$('mapHost').querySelector('svg'),p=svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY;const center=p.matrixTransform(svg.getScreenCTM().inverse());zoom(event.deltaY>0?1/.85:.85,center);},{passive:false});
 $('mapHost').addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)&&event.target.matches('.warning-area')){event.preventDefault();showArea(visible.find(w=>w.id===event.target.dataset.id));}});
 setInterval(()=>{if(!document.hidden)refresh();},15*60000);
 setInterval(()=>{if(data&&Date.now()-Date.parse(data.generated)>45*60000){sourceMessage('De KNMI-gegevens zijn niet actueel.');data=null;selected=null;render();}},60000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
}
init();
