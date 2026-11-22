/* Shared numerical/display rules for Weerlab temperature maps. No forecast adjustment. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TemperatureMap = api;
})(typeof globalThis === 'object' ? globalThis : this, function() {
  'use strict';
  const temperatureStops = [[-20,'#35216d'],[-15,'#194b99'],[-10,'#2171b5'],[-5,'#58a6d6'],[-2,'#a7d5ed'],
    [0,'#e5f2f4'],[2,'#b5ddc6'],[5,'#6db889'],[8,'#a5c975'],[12,'#dfdc73'],[16,'#f5d05e'],
    [20,'#f5aa45'],[25,'#eb7538'],[30,'#cf3e32'],[35,'#a31f42'],[40,'#741b54'],[45,'#48174f']];
  const temperatureTicks = [-20,-10,0,10,20,30,40,45];
  const percent = v => Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v)+'%' : '–';
  const decode16 = v => Number.isFinite(v) && v !== -32768 ? v/10 : NaN;
  function interpolate(a,b,c,d,x,y) {
    const values=[a,b,c,d], weights=[(1-x)*(1-y),x*(1-y),(1-x)*y,x*y];
    // Keep missing cells visibly missing rather than smoothing across them.
    if (!Number.isFinite(values[(y<.5?0:2)+(x<.5?0:1)])) return NaN;
    let sum=0, weight=0;
    values.forEach((v,i)=>{if(Number.isFinite(v)){sum+=v*weights[i];weight+=weights[i];}});
    return weight>0 ? sum/weight : NaN;
  }
  function contourSegments(values,level) {
    if (!values.every(Number.isFinite)) return [];
    const corners=[[0,0],[1,0],[1,1],[0,1]], intersections=[];
    for(let i=0;i<4;i++) {
      const j=(i+1)%4, a=values[i], b=values[j];
      if((a<level)===(b<level)) continue;
      const f=(level-a)/(b-a), p=corners[i], q=corners[j];
      intersections.push([p[0]+(q[0]-p[0])*f,p[1]+(q[1]-p[1])*f]);
    }
    if(intersections.length===2) return [[intersections[0],intersections[1]]];
    if(intersections.length!==4) return [];
    // Asymptotic decider: preserve the topology of a bilinear saddle.
    const q=(values[0]-level)*(values[2]-level)-(values[1]-level)*(values[3]-level);
    return q>=0 ? [[intersections[0],intersections[1]],[intersections[2],intersections[3]]]
      : [[intersections[0],intersections[3]],[intersections[1],intersections[2]]];
  }
  function contourPath(values,nx,ny,level,project) {
    let path='';
    for(let y=0;y<ny-1;y++) for(let x=0;x<nx-1;x++) {
      const corners=[values[y*nx+x],values[y*nx+x+1],values[(y+1)*nx+x+1],values[(y+1)*nx+x]];
      for(const [a,b] of contourSegments(corners,level)) {
        const p=project(y+a[1],x+a[0]), q=project(y+b[1],x+b[0]);
        path+=`M${p[0].toFixed(1)},${p[1].toFixed(1)}L${q[0].toFixed(1)},${q[1].toFixed(1)}`;
      }
    }
    return path;
  }
  function summary(cells,value,latitude) {
    let low=Infinity, high=-Infinity, minCell=-1, maxCell=-1, total=0, weight=0, valid=0;
    for(const c of cells) {
      const v=value(c); if(!Number.isFinite(v)) continue;
      const w=Math.cos(latitude(c)*Math.PI/180);
      total+=v*w; weight+=w; valid++;
      if(v<low){low=v;minCell=c;} if(v>high){high=v;maxCell=c;}
    }
    return {low:valid?low:NaN,high:valid?high:NaN,minCell,maxCell,mean:weight?total/weight:NaN,
      valid,total:cells.length,coverage:cells.length?100*valid/cells.length:0};
  }
  return {temperatureStops,temperatureTicks,percent,decode16,interpolate,contourSegments,contourPath,summary};
});
