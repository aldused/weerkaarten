const NS='http://www.w3.org/2000/svg';
function element(tag,attrs={},text=''){const e=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text)e.textContent=text;return e;}
const nf=new Intl.NumberFormat('nl-NL',{maximumFractionDigits:3});
export class ClimateChart {
 constructor(host,{title,unit,xLabel='',formatX=x=>String(x),series=[],bands=[],thresholds=[],source='',minX,maxX}){
  this.host=host;this.options={title,unit,xLabel,formatX,series,bands,thresholds,source,minX,maxX};this.hidden=new Set();this.original=null;this.draw();
 }
 draw(){
  const o=this.options;this.host.replaceChildren();
  const valid=o.series.flatMap(s=>s.points).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
  if(!valid.length){this.host.textContent='Geen gecontroleerde waarden voor deze selectie.';return;}
  const allX=valid.map(p=>p.x);let xmin=o.minX??Math.min(...allX),xmax=o.maxX??Math.max(...allX);
  if(xmin===xmax)xmax=xmin+1;if(!this.original)this.original=[xmin,xmax];
  const extent=o.series.filter(s=>!this.hidden.has(s.name)).flatMap(s=>s.points).filter(p=>p.x>=xmin&&p.x<=xmax&&Number.isFinite(p.y)).map(p=>p.y);
  for(const b of o.bands)for(const p of b.points)if(p.x>=xmin&&p.x<=xmax){if(Number.isFinite(p.lo))extent.push(p.lo);if(Number.isFinite(p.hi))extent.push(p.hi);}
  extent.push(...o.thresholds.map(t=>t.value));if(!extent.length)extent.push(0,1);
  let ymin=Math.min(...extent),ymax=Math.max(...extent),margin=Math.max((ymax-ymin)*.12,.15);ymin-=margin;ymax+=margin;
  const mobile=this.host.clientWidth<600,W=mobile?480:1100,H=mobile?440:470,L=mobile?62:78,R=mobile?18:30,T=66,B=87,pw=W-L-R,ph=H-T-B;
  const X=x=>L+(x-xmin)/(xmax-xmin)*pw,Y=y=>T+(ymax-y)/(ymax-ymin)*ph;
  const svg=element('svg',{viewBox:`0 0 ${W} ${H}`,role:'img','aria-label':`${o.title}. ${o.unit}. Gebruik de jaarselectie of sleep in de grafiek om in te zoomen.`,tabindex:0,style:'width:100%;height:auto;display:block;background:#fff;font-family:system-ui,sans-serif;color:#203341;touch-action:pan-y'});
  svg.append(element('title',{},o.title),element('rect',{width:W,height:H,fill:'#fff'}),element('text',{x:L,y:25,fill:'#203341','font-size':17,'font-weight':650},o.title),element('text',{x:L,y:47,fill:'#5d6e7c','font-size':12},o.unit));
  const defs=element('defs');const clip=element('clipPath',{id:'plot-'+crypto.randomUUID()});clip.append(element('rect',{x:L,y:T,width:pw,height:ph}));defs.append(clip);svg.append(defs);
  for(let i=0;i<=5;i++){const y=ymin+(ymax-ymin)*i/5;svg.append(element('line',{x1:L,x2:W-R,y1:Y(y),y2:Y(y),stroke:'#e4eaee'}),element('text',{x:L-12,y:Y(y)+5,'text-anchor':'end',fill:'#5d6e7c','font-size':13},nf.format(y)));}
  for(let i=0;i<=5;i++){const x=xmin+(xmax-xmin)*i/5;svg.append(element('text',{x:X(x),y:H-B+26,'text-anchor':i===0?'start':i===5?'end':'middle',fill:'#5d6e7c','font-size':13},o.formatX(x)));}
  svg.append(element('text',{x:L+pw/2,y:H-34,'text-anchor':'middle',fill:'#5d6e7c','font-size':12},o.xLabel));
  const group=element('g',{'clip-path':`url(#${clip.id})`});svg.append(group);
  for(const b of o.bands){let run=[];const flush=()=>{if(run.length)group.append(element('path',{d:'M'+run.map(p=>`${X(p.x)},${Y(p.hi)}`).join('L')+'L'+[...run].reverse().map(p=>`${X(p.x)},${Y(p.lo)}`).join('L')+'Z',fill:b.color||'#e5ebef',opacity:b.opacity??1}));run=[];};for(const p of b.points){if(Number.isFinite(p.lo)&&Number.isFinite(p.hi))run.push(p);else flush();}flush();}
  for(const t of o.thresholds){group.append(element('line',{x1:L,x2:W-R,y1:Y(t.value),y2:Y(t.value),stroke:t.color||'#8c9aa5','stroke-dasharray':t.value===0?'':'5 5','stroke-width':t.value===0?1.5:1}));}
  const legend=document.createElement('div');legend.className='chart-legend';
  for(const s of o.series){
   const btn=document.createElement('button');btn.type='button';btn.textContent=s.name;btn.setAttribute('aria-pressed',String(!this.hidden.has(s.name)));btn.style.setProperty('--series',s.color||'#687986');btn.onclick=()=>{this.hidden.has(s.name)?this.hidden.delete(s.name):this.hidden.add(s.name);this.draw();};legend.append(btn);
   if(this.hidden.has(s.name))continue;
   let run=[];const flush=()=>{if(run.length)group.append(element('path',{d:run.map((p,i)=>`${i?'L':'M'}${X(p.x)},${Y(p.y)}`).join(''),fill:'none',stroke:s.color||'#687986','stroke-width':s.width||2,'stroke-dasharray':s.dash||'','vector-effect':'non-scaling-stroke','stroke-linejoin':'round'}));run=[];};
   for(const p of s.points){if(!Number.isFinite(p.y)){flush();continue;}if(s.enso&&run.length){const q=run.at(-1);const c=q.y>=.5?'#be4436':q.y<=-.5?'#247fb1':'#8a969e';group.append(element('path',{d:`M${X(q.x)},${Y(q.y)}L${X(p.x)},${Y(p.y)}`,fill:'none',stroke:c,'stroke-width':s.width||2.5,'vector-effect':'non-scaling-stroke'}));run=[p];}else run.push(p);}if(!s.enso)flush();
  }
  svg.append(element('text',{x:L,y:H-12,fill:'#5d6e7c','font-size':10},o.source.length>150?o.source.slice(0,147)+'…':o.source));
  const overlay=element('rect',{x:L,y:T,width:pw,height:ph,fill:'transparent',style:'cursor:crosshair'});svg.append(overlay);
  const cross=element('line',{x1:0,x2:0,y1:T,y2:H-B,stroke:'#607a86','stroke-dasharray':'3 4',visibility:'hidden'});svg.append(cross);
  const tooltip=document.createElement('div');tooltip.className='chart-tooltip';tooltip.hidden=true;tooltip.setAttribute('role','status');
  const show=x=>{
   tooltip.replaceChildren();const series=o.series.filter(s=>!this.hidden.has(s.name));let nearest=null;
   for(const s of series){const candidates=s.points.filter(p=>p.x>=xmin&&p.x<=xmax&&Number.isFinite(p.y));if(!candidates.length)continue;const p=candidates.reduce((a,b)=>Math.abs(a.x-x)<Math.abs(b.x-x)?a:b);if(!nearest||Math.abs(p.x-x)<Math.abs(nearest.x-x))nearest=p;}
   if(!nearest)return;cross.setAttribute('x1',X(nearest.x));cross.setAttribute('x2',X(nearest.x));cross.setAttribute('visibility','visible');
   const title=document.createElement('strong');title.textContent=nearest.label||o.formatX(nearest.x);tooltip.append(title);
   for(const s of series){const p=s.points.find(p=>Math.abs(p.x-nearest.x)<.001);const line=document.createElement('div');line.textContent=`${s.name}: ${p&&Number.isFinite(p.y)?nf.format(p.y)+' '+(s.unit||o.unit):'geen meting'}`+(p?.quality?` · ${p.quality}`:'');tooltip.append(line);}
   for(const b of o.bands){const p=b.points.find(p=>Math.abs(p.x-nearest.x)<.001);if(p){const line=document.createElement('div');line.textContent=`${b.name}: ${nf.format(p.lo)}–${nf.format(p.hi)} ${o.unit}`+(p.n?` · n=${p.n}`:'');tooltip.append(line);}}
   tooltip.hidden=false;
  };
  const mouseX=e=>xmin+((e.clientX-svg.getBoundingClientRect().left)/svg.getBoundingClientRect().width*W-L)/pw*(xmax-xmin);
  overlay.addEventListener('pointermove',e=>show(mouseX(e)));overlay.addEventListener('pointerleave',()=>{tooltip.hidden=true;cross.setAttribute('visibility','hidden');});
  let down=null;overlay.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'){down=mouseX(e);overlay.setPointerCapture(e.pointerId);}});
  overlay.addEventListener('pointerup',e=>{const end=mouseX(e);if(down!==null&&Math.abs(end-down)>(xmax-xmin)*.02){this.options.minX=Math.max(xmin,Math.min(down,end));this.options.maxX=Math.min(xmax,Math.max(down,end));this.draw();}down=null;});
  let keyIndex=0;svg.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight'].includes(e.key))return;e.preventDefault();const points=valid.filter(p=>p.x>=xmin&&p.x<=xmax).sort((a,b)=>a.x-b.x);keyIndex=Math.min(points.length-1,Math.max(0,keyIndex+(e.key==='ArrowRight'?1:-1)));show(points[keyIndex].x);});
  const toolbar=document.createElement('div');toolbar.className='chart-tools';
  for(const name of ['Inzoomen','Uitzoomen','Herstel zoom','PNG','SVG','CSV']){const b=document.createElement('button');b.textContent=name;b.type='button';b.onclick=()=>{if(name==='Herstel zoom'){this.options.minX=this.original[0];this.options.maxX=this.original[1];this.draw();}else if(name==='Inzoomen'||name==='Uitzoomen'){const mid=(xmin+xmax)/2,half=(xmax-xmin)/2*(name==='Inzoomen'?.65:1.6);this.options.minX=Math.max(this.original[0],mid-half);this.options.maxX=Math.min(this.original[1],mid+half);this.draw();}else this.export(name,svg,xmin,xmax);};toolbar.append(b);}
  const hint=document.createElement('span');hint.textContent='Sleep om in te zoomen · klik op een reeks om die te verbergen';toolbar.append(hint);
  this.host.append(legend,svg,tooltip,toolbar);
 }
 export(type,svg,xmin,xmax){
  const filename=this.options.title.toLowerCase().replace(/[^a-z0-9]+/g,'-');
  const download=(blob,ext)=>{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename+'.'+ext;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};
  if(type==='CSV'){
   const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';const lines=[['reeks','periode','x','waarde','eenheid','kwaliteit','bron'].map(quote).join(',')];
   for(const s of this.options.series){if(this.hidden.has(s.name))continue;for(const p of s.points)if(p.x>=xmin&&p.x<=xmax)lines.push([s.name,p.label,p.x,p.y,s.unit||this.options.unit,p.quality,this.options.source].map(quote).join(','));}
   for(const b of this.options.bands)for(const p of b.points)if(p.x>=xmin&&p.x<=xmax)for(const k of ['lo','hi'])lines.push([b.name+' '+k,p.label,p.x,p[k],this.options.unit,'berekend uit officiële data',this.options.source].map(quote).join(','));
   download(new Blob(['\ufeff'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'}),'csv');return;
  }
  const clone=svg.cloneNode(true);clone.querySelectorAll('[visibility]').forEach(e=>e.remove());clone.setAttribute('xmlns',NS);clone.setAttribute('style','background:#fff;font-family:system-ui,sans-serif;color:#203341');
  const view=clone.getAttribute('viewBox').split(' ').map(Number);clone.setAttribute('width',view[2]);clone.setAttribute('height',view[3]);
  const description=element('desc',{},this.options.source+'; '+this.options.series.filter(s=>!this.hidden.has(s.name)).map(s=>s.name).join('; '));clone.prepend(description);
  const active=this.options.series.filter(s=>!this.hidden.has(s.name));let cursor=view[3]+18;
  for(const s of active){clone.append(element('line',{x1:20,x2:40,y1:cursor-4,y2:cursor-4,stroke:s.color||'#687986','stroke-width':s.width||2,'stroke-dasharray':s.dash||''}),element('text',{x:48,y:cursor,fill:'#203341','font-size':11},s.name));cursor+=17;}
  const words=this.options.source.split(' '),sourceLines=[];let line='';const capacity=Math.floor((view[2]-40)/6);
  for(const word of words){if((line+' '+word).length>capacity){sourceLines.push(line);line=word;}else line+=(line?' ':'')+word;}if(line)sourceLines.push(line);
  cursor+=7;for(const text of sourceLines){clone.append(element('text',{x:20,y:cursor,fill:'#5d6e7c','font-size':10},text));cursor+=14;}
  const height=cursor+12;clone.insertBefore(element('rect',{x:0,y:view[3],width:view[2],height:height-view[3],fill:'#fff'}),clone.firstChild);view[3]=height;clone.setAttribute('viewBox',view.join(' '));clone.setAttribute('height',height);
  const blob=new Blob([new XMLSerializer().serializeToString(clone)],{type:'image/svg+xml;charset=utf-8'});
  if(type==='SVG'){download(blob,'svg');return;}
  const img=new Image(),url=URL.createObjectURL(blob);img.onload=()=>{const canvas=document.createElement('canvas');canvas.width=view[2]*2;canvas.height=view[3]*2;const ctx=canvas.getContext('2d');ctx.scale(2,2);ctx.drawImage(img,0,0);canvas.toBlob(b=>{download(b,'png');URL.revokeObjectURL(url);},'image/png');};img.onerror=()=>{URL.revokeObjectURL(url);alert('PNG-export mislukt. Gebruik SVG-export.');};img.src=url;
 }
}
