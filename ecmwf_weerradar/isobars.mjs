// Sea-level pressure has been normalized from native Pa to hPa. Contours use a fixed geographic
// mesh, so moving or zooming the map never changes their meteorological shape.
export const ISOBAR_INTERVAL=4;
export const hasIsobars=meta=>(meta?.modelId||'ecmwf_ifs')==='ecmwf_ifs'&&meta?.variables?.includes('pressure_msl');
export function contours(values,nx,ny,{west=0,south=0,dx=1,dy=1,interval=ISOBAR_INTERVAL}={}){
  if(!(interval>0))throw Error('Invalid contour interval');
  const levels=new Map();
  for(let y=0;y<ny-1;y++)for(let x=0;x<nx-1;x++){
    const v=[values[y*nx+x],values[y*nx+x+1],values[(y+1)*nx+x+1],values[(y+1)*nx+x]];
    if(!v.every(Number.isFinite))continue;
    const lo=Math.min(...v),hi=Math.max(...v);
    for(let level=Math.ceil(lo/interval)*interval;level<hi;level+=interval){
      const corners=[[x,y],[x+1,y],[x+1,y+1],[x,y+1]],hits=[];
      for(let i=0;i<4;i++){
        const j=(i+1)%4;
        if((v[i]>level)===(v[j]>level))continue;
        const t=(level-v[i])/(v[j]-v[i]);
        hits.push([west+(corners[i][0]+t*(corners[j][0]-corners[i][0]))*dx,south+(corners[i][1]+t*(corners[j][1]-corners[i][1]))*dy]);
      }
      const segments=levels.get(level)||[];levels.set(level,segments);
      if(hits.length===2)segments.push(hits);
      // Asymptotic decider for a bilinear saddle (edges are cyclic).
      if(hits.length===4){
        const q=(v[0]-level)*(v[2]-level)-(v[1]-level)*(v[3]-level);
        if(q>=0)segments.push([hits[0],hits[1]],[hits[2],hits[3]]);
        else segments.push([hits[0],hits[3]],[hits[1],hits[2]]);
      }
    }
  }
  const result=[],key=p=>p.map(n=>n.toFixed(7)).join(',');
  for(const [level,segments] of levels){
    const nodes=new Map(),edges=[];
    for(const [a,b] of segments){
      const ka=key(a),kb=key(b);if(ka===kb)continue;
      for(const [k,p] of [[ka,a],[kb,b]])if(!nodes.has(k))nodes.set(k,{p,edges:[]});
      const i=edges.length;edges.push([ka,kb]);nodes.get(ka).edges.push(i);nodes.get(kb).edges.push(i);
    }
    const used=new Set();
    const walk=start=>{
      const points=[nodes.get(start).p];let k=start;
      while(true){const i=nodes.get(k).edges.find(i=>!used.has(i));if(i===undefined)break;used.add(i);k=edges[i][0]===k?edges[i][1]:edges[i][0];points.push(nodes.get(k).p);if(k===start)break;}
      if(points.length>1)result.push({level,points});
    };
    for(const [k,n] of nodes)if(n.edges.length===1)walk(k);
    for(const [a] of edges)walk(a);
  }
  return result;
}
const cache=new WeakMap();
export function fieldContours(field){
  if(cache.has(field))return cache.get(field);
  const [west,south,east,north]=field.packed.bounds,step=.25;
  const nx=Math.ceil((east-west)/step)+1,ny=Math.ceil((north-south)/step)+1,dx=(east-west)/(nx-1),dy=(north-south)/(ny-1);
  const values=new Float32Array(nx*ny);
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++)values[y*nx+x]=field.grid.getInterpolatedValue(field.data.values,south+y*dy,west+x*dx,'monotone');
  const lines=contours(values,nx,ny,{west,south,dx,dy});cache.set(field,lines);return lines;
}
export function drawIsobars(ctx,field,project,width,height){
  const lines=fieldContours(field),labels=[];ctx.save();ctx.lineJoin='round';ctx.lineCap='round';
  for(const {level,points} of lines){
    const screen=points.map(project);ctx.beginPath();
    screen.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));
    ctx.strokeStyle='rgba(255,255,255,.85)';ctx.lineWidth=3;ctx.stroke();
    ctx.strokeStyle='rgba(25,43,59,.9)';ctx.lineWidth=1.2;ctx.stroke();
    let distance=110;
    for(let i=1;i<screen.length;i++){
      const p=screen[i],previous=screen[i-1];distance+=Math.hypot(p.x-previous.x,p.y-previous.y);
      if(distance<210||p.x<30||p.x>width-30||p.y<30||p.y>height-30||labels.some(q=>Math.hypot(p.x-q.x,p.y-q.y)<85))continue;
      labels.push({...p,level});distance=0;
    }
  }
  ctx.font='bold 12px Arial';ctx.textAlign='center';ctx.textBaseline='middle';
  for(const p of labels){ctx.fillStyle='rgba(255,255,255,.88)';ctx.fillRect(p.x-18,p.y-8,36,16);ctx.fillStyle='#192b3b';ctx.fillText(String(p.level),p.x,p.y);}
  ctx.restore();return {lines:lines.length,labels:labels.length};
}
