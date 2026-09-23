import {CLOUD_STYLES} from './cloud-style.mjs';
import {precipitationLegend} from './precipitation-colors.mjs';
import {windScale,windLegend} from './wind-style.mjs';
import {FOG_BANDS} from './fog-style.mjs';
import {temperatureLegend} from './core.mjs';

export function pngFilename(model,iso,mode){
  return `weerlab-ed-aldus-${model}-${iso.replace(/[:.]/g,'-')}-${mode}.png`;
}
export function exportLegends({mode,variables,cloudVisible,hasBase}){
  const rows=[];
  if(mode==='temperature'){
    const variable=variables.find(v=>v.startsWith('temperature_'))||'temperature_2m',legend=temperatureLegend(variable);
    rows.push({label:`Temperatuur ${variable==='temperature_2m'?'2 m':variable.slice(12,15)+' hPa'} · °C`,labels:legend.labels,stops:legend.stops});
  }
  else if(mode==='wind')rows.push({label:'Windkracht · Bft (pijlen: richting waarin de wind waait)',labels:windLegend.labels,stops:windScale.colors.map((c,i)=>[windScale.breakpoints[i]/12,`rgb(${c.slice(0,3)})`])});
  else for(const variable of ['precipitation','snowfall_water_equivalent'])if(variables.includes(variable)){
    const legend=precipitationLegend(variable);
    rows.push({label:variable==='precipitation'?'Neerslag · mm/u':'Sneeuw · mm smeltwater/u',labels:legend.labels,stops:legend.stops.map(s=>[s.percent/100,`rgba(${s.rgba.slice(0,3)},${s.rgba[3]/255})`])});
  }
  if(variables.includes('cloud_cover'))for(const [type,bit,label] of [['high',4,'Hoge bewolking · ijle witte sluier'],['mid',2,'Middelbare bewolking · doorschijnend lichtgrijs'],['low',1,'Lage bewolking · compact grijs']])if(cloudVisible&bit){
    const s=CLOUD_STYLES[type];rows.push({label,color:`rgba(${s.rgb},${s.sample})`});
  }
  if(variables.includes('visibility'))for(const band of [...FOG_BANDS].reverse())rows.push({label:`Mist · ${band.label.toLowerCase()}`,color:band.color});
  if(variables.includes('cloud_cover')&&hasBase&&(cloudVisible&1))rows.push({label:'Zeer lage bewolking · wolkenbasis <150 m',color:'#dedcca'});
  return rows;
}
export function wrapText(text,maxWidth,measure){
  const lines=[];let line='';
  for(const word of text.split(/\s+/)){
    if(line&&measure(line+' '+word)>maxWidth){lines.push(line);line=word;}else line+=(line?' ':'')+word;
  }
  if(line)lines.push(line);return lines;
}
// Compose native planes in paint order; omit controls and reject missing tiles.
export function cropMapCanvas(canvas,rect){
  if(!rect)return canvas;
  if(rect.width<1||rect.height<1||rect.x<0||rect.y<0||rect.x+rect.width>canvas.width||rect.y+rect.height>canvas.height)throw Error('Het geselecteerde gebied valt buiten de kaart. Selecteer opnieuw.');
  const cropped=document.createElement('canvas');cropped.width=rect.width;cropped.height=rect.height;
  cropped.getContext('2d').drawImage(canvas,rect.x,rect.y,rect.width,rect.height,0,0,rect.width,rect.height);
  return cropped;
}
export function captureMap(mapElement,places,rectSelection=null){
  const rect=mapElement.getBoundingClientRect(),canvas=document.createElement('canvas');
  canvas.width=Math.round(rect.width);canvas.height=Math.round(rect.height);
  const ctx=canvas.getContext('2d');ctx.fillStyle='#365f77';ctx.fillRect(0,0,canvas.width,canvas.height);
  const panes=[...mapElement.querySelector('.leaflet-map-pane').children].filter(p=>p.classList.contains('leaflet-pane')).sort((a,b)=>Number(getComputedStyle(a).zIndex)-Number(getComputedStyle(b).zIndex));
  for(const pane of panes)for(const el of pane.querySelectorAll('img.leaflet-tile,canvas')){
    const r=el.getBoundingClientRect();
    if(!r.width||!r.height||r.right<=rect.left||r.left>=rect.right||r.bottom<=rect.top||r.top>=rect.bottom)continue;
    let opacity=1,visible=true;
    for(let p=el;p&&p!==mapElement;p=p.parentElement){const s=getComputedStyle(p);opacity*=Number(s.opacity);if(s.display==='none'||s.visibility==='hidden')visible=false;}
    if(!visible||!opacity)continue;
    if(el.tagName==='IMG'&&(!el.complete||!el.naturalWidth))throw Error('De achtergrondkaart is nog niet volledig geladen. Probeer het zo opnieuw.');
    ctx.globalAlpha=opacity;ctx.drawImage(el,r.left-rect.left,r.top-rect.top,r.width,r.height);
  }
  ctx.globalAlpha=1;
  if(places.width&&places.height)ctx.drawImage(places,0,0,canvas.width,canvas.height);
  ctx.getImageData(0,0,1,1); // Fail explicitly if a source blocks CORS export.
  return cropMapCanvas(canvas,rectSelection);
}
export function composePNG(mapImage,{title,time,run,lead,source,opacity,legends}){
  const width=Math.max(640,Math.min(1920,mapImage.width)),pad=28,inner=width-pad*2;
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
  ctx.font='16px system-ui';
  const lines=text=>wrapText(text,inner,t=>ctx.measureText(t).width);
  const timeLines=lines(time),runLines=lines(`${run} · ${lead}`),sourceLines=lines(`Bron: ${source} · Kaart © Esri, Maxar, Earthstar Geographics · Natural Earth · Plaatsnamen: GeoNames`);
  const header=88+timeLines.length*23,mapHeight=Math.round(mapImage.height*width/mapImage.width);
  const footer=108+(runLines.length+sourceLines.length)*22+legends.reduce((n,l)=>n+(l.stops?78:30),0);
  canvas.width=width;canvas.height=header+mapHeight+footer;
  ctx.fillStyle='#fff';ctx.fillRect(0,0,width,canvas.height);
  ctx.fillStyle='#00205b';ctx.fillRect(0,0,width,header);
  ctx.fillStyle='#fff';ctx.font='bold 25px system-ui';ctx.fillText(title,pad,40,inner);
  ctx.font='16px system-ui';timeLines.forEach((line,i)=>ctx.fillText(line,pad,70+i*23));
  ctx.fillStyle='#2ec4e8';ctx.fillRect(0,header-5,width,5);
  ctx.drawImage(mapImage,0,header,width,mapHeight);
  let y=header+mapHeight+30;
  ctx.fillStyle='#00205b';ctx.font='bold 21px system-ui';ctx.fillText('Ed Aldus · Weerlab',pad,y);y+=29;
  ctx.font='16px system-ui';runLines.forEach(line=>{ctx.fillText(line,pad,y);y+=22;});
  ctx.fillStyle='#5c6f85';ctx.fillText(`Instelling laag-opacity: ${opacity}% · Nederlandse tijd (Europe/Amsterdam)`,pad,y,inner);y+=28;
  for(const row of legends){
    ctx.font='15px system-ui';ctx.fillStyle='#18314c';
    if(row.stops){
      ctx.fillText(row.label,pad,y,inner);y+=10;
      const gradient=ctx.createLinearGradient(pad,0,pad+inner,0);
      row.stops.forEach(([position,color])=>gradient.addColorStop(Math.max(0,Math.min(1,position)),color));
      ctx.fillStyle='#f1f4f7';ctx.fillRect(pad,y,inner,14);ctx.fillStyle=gradient;ctx.fillRect(pad,y,inner,14);y+=32;
      ctx.fillStyle='#18314c';row.labels.forEach((label,i)=>{ctx.textAlign=i===0?'left':i===row.labels.length-1?'right':'center';ctx.fillText(label,pad+i*inner/(row.labels.length-1),y);});ctx.textAlign='left';y+=36;
    }else{
      ctx.fillStyle='#f1f4f7';ctx.fillRect(pad,y-16,32,21);ctx.fillStyle=row.color;ctx.fillRect(pad,y-16,32,21);ctx.strokeStyle='#9aa8b6';ctx.strokeRect(pad,y-16,32,21);ctx.fillStyle='#18314c';ctx.fillText(row.label,pad+44,y,inner-44);y+=30;
    }
  }
  ctx.font='14px system-ui';ctx.fillStyle='#5c6f85';sourceLines.forEach(line=>{ctx.fillText(line,pad,y);y+=22;});
  return canvas;
}
