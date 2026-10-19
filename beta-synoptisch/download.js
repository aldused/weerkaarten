// Capture selection before asynchronous loading so a day change cannot mix runs.
$('download').onclick=async()=>{
 const button=$('download'),day=days[current],valid=$('valid').textContent,model=$('model-stamp').textContent,note=$('note').textContent;
 const exportManifest=manifest;
 const cloudLabel=cloudNames[$('cloud-level').value];
 const selected=Object.fromEntries(layers.map(k=>[k,!$('layer-'+k).hidden]));
 const visibleImages=[...document.querySelectorAll('.map>img')].filter(img=>!img.hidden);
 const opacities=visibleImages.map(img=>img.id==='layer-temp'?.55:1);
 const sources=visibleImages.map(img=>{
  const src=img.getAttribute('src');return /-ukmo-(temp|cloud(?:-(?:low|mid|high))?|rain|snow)\.png$/.test(src)?src.replace('.png','@2x.png'):src;
 });
 button.disabled=true;button.textContent='PNG maken…';$('download-status').textContent='';
 try{
  const images=await Promise.all(sources.map(src=>new Promise((resolve,reject)=>{const i=new Image();i.crossOrigin="anonymous";i.onload=()=>resolve(i);i.onerror=()=>reject(new Error('Kaartlaag kon niet worden geladen'));i.src=src+(src.includes('?')?'&':'?')+'export=1&origin='+encodeURIComponent(location.origin);})));
  const canvas=document.createElement('canvas');canvas.width=2800;const ctx=canvas.getContext('2d');
  const wrap=(value,size=23)=>{ctx.font=`${size}px Arial, sans-serif`;const lines=[];let line='';for(const word of value.split(/\s+/)){const next=line?line+' '+word:word;if(line&&ctx.measureText(next).width>2704){lines.push(line);line=word;}else line=next;}if(line)lines.push(line);return lines;};
  const noteLines=wrap(note),creditLines=wrap('Modeldata: UK Met Office via Open-Meteo · CC BY-SA 4.0 | Maximumtemperaturen: DWD MOSMIX | Bracknell © Crown Copyright | Geografie: Natural Earth',21);
  const mapY=230,legendY=mapY+1760+40,noteY=legendY+112,creditsY=noteY+noteLines.length*31+26,footerY=creditsY+creditLines.length*28+30;
  canvas.height=footerY+104;
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);
  const text=(value,x,y,size=25,color='#213b42',bold=false)=>{ctx.fillStyle=color;ctx.font=`${bold?'600 ':''}${size}px Arial, sans-serif`;ctx.fillText(value,x,y);};
  ctx.fillStyle='#edf2f2';ctx.fillRect(0,0,2800,mapY);
  ctx.fillStyle='#245f63';ctx.fillRect(0,mapY-6,2800,6);
  text('ED ALDUS · WEERLAB',48,43,24,'#527b7f',true);
  text('Het weerbeeld van Europa',48,108,54,'#213b42',true);
  text('Midden-Europa · '+valid,48,158,34,'#213b42',true);
  text(model+' · '+(exportManifest.frontsAvailable===false?'Fronten: zie Bracknell-bronkaart':(exportManifest.troughsAvailable===false?'Fronten':'Fronten en troggen')+': Met Office / Bracknell · 12 UTC'),48,201,24);
  ctx.textAlign='right';text('WEERLAB.NL',2752,48,28,'#245f63',true);ctx.textAlign='left';
  images.forEach((img,i)=>{ctx.globalAlpha=opacities[i];ctx.drawImage(img,0,mapY,2800,1760);});ctx.globalAlpha=1;
  let x=48;
  function scale(title,colors,labels){text(title,x,legendY,23,'#213b42',true);colors.forEach((c,j)=>{ctx.fillStyle=c;ctx.fillRect(x+j*55,legendY+15,55,15);});labels.forEach((v,j)=>text(v,x+j*(colors.length*55-35)/(labels.length-1),legendY+57,20));x+=620;}
  if(selected.rain)scale('Totale neerslag · mm/uur',['#8fd4ef','#4da9df','#3186d1','#3658b4','#35a88d','#83bd59','#d8cc44','#e99439','#cf4b47'],['0,1','0,5','2','8','32+']);
  if(selected.temp)scale('Temperatuur · °C',['#b8b6d9','#b9d4e5','#a5d7ca','#d5deb0','#eee1a4','#e8ba86','#ce8b79'],['−10','0','10','20','30']);
  if(selected.fronts){text('▲ Koufront',x,legendY,22,'#0032fe');text('● Warmtefront',x+190,legendY,22,'#fe3200');text('▲● Occlusie',x+430,legendY,22,'#e532e5');if(exportManifest.troughsAvailable!==false)text('Blauwe lijn zonder symbolen: trog',x,legendY+34,22,'#1666d1');}
  if(selected.pressure)text('Isobaren: 4 hPa · H/L: drukcentrum',2060,legendY,22);
  if(selected.cloud)text(cloudLabel,2060,legendY+34,22);
  if(selected.wind)text('Wind: Bft · pijl wijst stroomrichting',2060,legendY+65,22);
  if(selected.maximum)text('Paars: maximumtemperatuur (MOSMIX) · °C',1050,legendY+80,22,'#843aa5');
  if(selected.values)text('Rood: temperatuur op het kaarttijdstip · °C',48,legendY+80,22,'#b32235');
  ctx.strokeStyle='#d2dfe1';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(48,noteY-25);ctx.lineTo(2752,noteY-25);ctx.stroke();
  noteLines.forEach((line,index)=>text(line,48,noteY+index*31,23));
  creditLines.forEach((line,index)=>text(line,48,creditsY+index*28,21,'#627b80'));
  ctx.fillStyle='#245f63';ctx.fillRect(0,footerY,2800,104);
  text('ED ALDUS · WEERLAB',48,footerY+43,25,'#ffffff',true);
  text('Kaartset bijgewerkt '+dateText(exportManifest.updated)+' om '+localTime(new Date(exportManifest.updated))+' uur',48,footerY+78,22,'#d5e5e5');
  ctx.textAlign='right';text('weerlab.nl',2752,footerY+62,35,'#ffffff',true);ctx.textAlign='left';
  const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('PNG maken mislukt')),'image/png'));
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Weerlab-'+validDate(day).toLocaleDateString('nl-NL',{timeZone:'Europe/Amsterdam',weekday:'long',day:'numeric',month:'long',year:'numeric'}).replace(/\s+/g,'-')+'.png';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  $('download-status').textContent='PNG klaargezet · '+canvas.width+' × '+canvas.height+' pixels';
 }catch(error){$('download-status').textContent='Download mislukt. Probeer opnieuw. '+error.message;}
 finally{button.disabled=false;button.textContent='Download PNG ↓';}
};
