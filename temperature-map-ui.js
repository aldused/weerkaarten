/* Cartographic presentation shared by ground, minimum and maximum temperature. */
window.TemperatureMapUI = (function() {
  'use strict';
  const NS='http://www.w3.org/2000/svg';
  const node=(tag,attrs,parent)=>{const n=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))n.setAttribute(k,v);parent.append(n);return n;};
  const date=new Intl.DateTimeFormat('nl-NL',{timeZone:'Europe/Amsterdam',weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  let exportDetails, exportLegend, exporting=false;
  function setup(redraw) {
    const values=document.getElementById('waardenChk');
    const names=document.createElement('label'); names.className='chk';
    names.innerHTML='<input type="checkbox" id="namenChk" checked> Plaatsnamen';
    values.closest('label').after(names); names.querySelector('input').onchange=redraw;
    const map=document.getElementById('kaart'), stamp=document.createElement('div');
    stamp.className='map-validity';stamp.id='mapValidity';map.before(stamp);
    const download=document.createElement('button');download.type='button';download.className='knop';
    download.id='kaartPng';download.textContent='Download kaart (PNG)';download.disabled=true;
    stamp.before(download);
    const message=document.createElement('p');message.setAttribute('role','status');message.hidden=true;
    download.after(message);
    download.onclick=async()=>{
      if(!exportDetails||exporting)return;
      exporting=true;download.disabled=true;message.hidden=true;
      try {
        const {svgMapImage,saveMapPNG}=await import('./temperature-map-export.mjs?v=20261122-1');
        const details=exportDetails;
        const title=document.getElementById('kaartTitel').textContent;
        const area=document.getElementById('regio').selectedOptions[0].textContent;
        const categories=[...document.querySelectorAll('#legenda .leg-cat span')].map(item=>({
          label:item.textContent,color:getComputedStyle(item.querySelector('i')).backgroundColor,
        }));
        const legends=categories.length?categories:[exportLegend].filter(Boolean);
        const mapImage=await svgMapImage(document.getElementById('svg'));
        const namen=`${area}-${title}-${details.period}`.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/-+$/,'');
        await saveMapPNG(mapImage,{
          ...details,title:`${title} · ${area}`,legends,source:'Weerlab MOS · KNMI, DWD, ECMWF en NOAA · BRO Bodemkaart',
          mapAttribution:'Plaatsnamen: GeoNames',
        },`weerlab-${namen}.png`);
      }catch(error){
        message.textContent='De kaart kon niet worden gedownload. Probeer het opnieuw.';
        message.hidden=false;console.error(error);
      }finally{exporting=false;download.disabled=false;}
    };
    const footer=document.createElement('p');footer.className='map-footnote';footer.id='mapFootnote';
    document.getElementById('legenda').after(footer);
    const card=document.createElement('section');card.className='paneel map-location';card.id='mapLocation';
    card.setAttribute('aria-label','Lokale verwachting');document.querySelector('.grafiek').after(card);
    const defs=document.querySelector('#svg defs'), pattern=node('pattern',{id:'missingField',width:8,height:8,patternUnits:'userSpaceOnUse'},defs);
    node('rect',{width:8,height:8,fill:'var(--land)'},pattern);
    node('path',{d:'M-2,2L2,-2 M0,8L8,0 M6,10L10,6',stroke:'var(--grens)','stroke-width':1},pattern);
    document.getElementById('nlVlak').style.fill='url(#missingField)';
  }
  function meta({period,created,indicative,partial,coverage,range,unit='',soil=false,scale}) {
    const stamp=document.getElementById('mapValidity');stamp.replaceChildren();
    const title=document.createElement('strong');title.textContent=period;
    const state=document.createElement('span');state.className='map-quality'+(indicative||partial?' indicative':'');
    state.textContent=partial?'Onvolledige periode':indicative?'Buiten toetsbereik':soil?'Statische ondergrond':'MOS-verwachting';
    stamp.append(title,state);
    const line=document.createElement('small');line.textContent='Bijgewerkt '+date.format(new Date(created))+' · Nederlandse tijd';stamp.append(line);
    exportDetails={time:period,period,run:'Bijgewerkt '+date.format(new Date(created)),lead:state.textContent};
    document.getElementById('kaartPng').disabled=exporting;
    const foot=document.getElementById('mapFootnote');
    foot.textContent=(Number.isFinite(range.low)?`Kaartbereik ${range.low.toFixed(1).replace('.',',')} tot ${range.high.toFixed(1).replace('.',',')} ${unit} · `:'')+
      `${Math.round(coverage)}% geldige roostercellen · uitvoerrooster circa 5 km. Kleuren zijn vloeiend weergegeven; waarden en uitersten komen uit de roostercellen. Gearceerd = geen waarde.`+
      (scale&&(range.low<scale.lo||range.high>scale.hi)?` Buiten ${scale.lo} tot ${scale.hi} ${unit} blijft de eindkleur van de schaal gelijk.`:'');
  }
  function legend(container,lu,title,ticks,format) {
    exportLegend={label:title,labels:ticks.map(format),positions:ticks.map(v=>(v-lu.lo)/(lu.hi-lu.lo)),
      stops:Array.from({length:lu.n},(_,i)=>[i/(lu.n-1),`rgb(${lu.lut.subarray(3*i,3*i+3).join(',')})`])};
    container.replaceChildren();
    const wrap=document.createElement('div');wrap.className='leg-balk';
    const label=document.createElement('span');label.className='leg-titel';label.textContent=title;wrap.append(label);
    const cv=document.createElement('canvas');cv.width=lu.n;cv.height=1;
    const cx=cv.getContext('2d'), im=cx.createImageData(lu.n,1);
    for(let i=0;i<lu.n;i++)im.data.set([lu.lut[3*i],lu.lut[3*i+1],lu.lut[3*i+2],255],4*i);
    cx.putImageData(im,0,0);wrap.append(cv);
    const marks=document.createElement('div');marks.className='leg-ticks';
    ticks.forEach((v,i)=>{const mark=document.createElement('span');mark.style.left=100*(v-lu.lo)/(lu.hi-lu.lo)+'%';
      if(i===0)mark.className='first';if(i===ticks.length-1)mark.className='last';
      mark.textContent=format(v);marks.append(mark);});
    wrap.append(marks);container.append(wrap);
  }
  function labels({svg,group,places,value,format,project,inArea,bounds}) {
    group.replaceChildren();if(!document.getElementById('waardenChk').checked)return;
    const names=document.getElementById('namenChk').checked, scale=Math.abs(svg.getScreenCTM()?.a||1), [vx,vy,vw,vh]=bounds;
    const occupied=[], context=document.createElement('canvas').getContext('2d');
    const callout=document.getElementById('gLaagst');
    for(const item of callout.children){
      const b=item.getBBox();
      occupied.push({x:b.x-4/scale,y:b.y-4/scale,w:b.width+8/scale,h:b.height+8/scale});
    }
    const overlap=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
    for(const [name,lat,lon,c] of places) {
      if(!inArea(lat,lon))continue;const v=value(c);if(!Number.isFinite(v))continue;
      const [x,y]=project(lon,lat), text=format(v);
      context.font='700 18px sans-serif';let width=context.measureText(text).width;
      if(names){context.font='500 13px sans-serif';width=Math.max(width,context.measureText(name).width);}
      const w=(width+10)/scale,h=(names?39:27)/scale, gap=8/scale;
      const choices=[{x:x+gap,y:y-h/2,w,h},{x:x-gap-w,y:y-h/2,w,h}, {x:x-w/2,y:y-gap-h,w,h},{x:x-w/2,y:y+gap,w,h}];
      const box=choices.find(b=>b.x>=vx+3/scale&&b.y>=vy+3/scale&&b.x+b.w<=vx+vw-3/scale&&b.y+b.h<=vy+vh-3/scale&&!occupied.some(a=>overlap(a,b)));
      if(!box)continue;occupied.push(box);
      const label=node('g',{},group);node('title',{},label).textContent=name+': '+text;
      node('circle',{cx:x,cy:y,r:2.3/scale,class:'map-point'},label);
      const t=node('text',{x:box.x+5/scale,y:box.y+20/scale,class:'map-value','font-size':18/scale},label);t.textContent=text;
      if(names)node('text',{x:box.x+5/scale,y:box.y+35/scale,class:'map-place','font-size':13/scale},label).textContent=name;
    }
  }
  function extreme({svg,group,x,y,title,name,bounds}) {
    const scale=Math.abs(svg.getScreenCTM()?.a||1), [vx,vy,vw,vh]=bounds, context=document.createElement('canvas').getContext('2d');
    context.font='700 14px sans-serif';const titleWidth=context.measureText(title).width;
    context.font='500 12px sans-serif';const w=(Math.max(116,titleWidth,context.measureText(name).width)+20)/scale,h=46/scale,gap=14/scale;
    const positions=[{x:x+gap,y:y-h/2},{x:x-gap-w,y:y-h/2},{x:x-w/2,y:y-gap-h},{x:x-w/2,y:y+gap}];
    const existing=group.childElementCount?group.getBBox():null;
    const boxes=positions.map(p=>({x:Math.max(vx+6/scale,Math.min(vx+vw-w-6/scale,p.x)),y:Math.max(vy+6/scale,Math.min(vy+vh-h-6/scale,p.y))}));
    const box=boxes.find(b=>!existing||b.x+w<existing.x||b.x>existing.x+existing.width||b.y+h<existing.y||b.y>existing.y+existing.height)||boxes[0];
    const g=node('g',{},group);node('line',{x1:x,y1:y,x2:box.x+w/2,y2:box.y+h/2,class:'map-extreme-link'},g);
    node('circle',{cx:x,cy:y,r:8/scale,class:'map-extreme-ring'},g);
    node('rect',{x:box.x,y:box.y,width:w,height:h,rx:6/scale,class:'ls-box'},g);
    node('text',{x:box.x+10/scale,y:box.y+19/scale,'font-size':14/scale,class:'map-extreme-title'},g).textContent=title;
    node('text',{x:box.x+10/scale,y:box.y+36/scale,'font-size':12/scale,class:'map-extreme-name'},g).textContent=name;
  }
  function location({name,value,kind,interval,details,note}) {
    const card=document.getElementById('mapLocation');card.replaceChildren();
    const h=document.createElement('h2');h.textContent='Roostercel bij '+name;card.append(h);
    const main=document.createElement('p');main.className='local-value';main.textContent=value;
    const label=document.createElement('span');label.textContent=kind;main.append(label);card.append(main);
    if(interval){const p=document.createElement('p');p.className='local-interval';p.textContent=interval;card.append(p);}
    const dl=document.createElement('dl');
    details.forEach(([key,value])=>{const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;dl.append(dt,dd);});card.append(dl);
    const p=document.createElement('p');p.className='chart-note';p.textContent=note;card.append(p);
  }
  return {setup,meta,legend,labels,extreme,location};
})();
