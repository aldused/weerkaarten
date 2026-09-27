export const totalScale={type:'breakpoint',unit:'mm',breakpoints:[0,.099,.1,1,2,5,10,20,40,80,160],colors:[[150,240,255,0],[150,240,255,0],[150,240,255,0],[70,200,250,.65],[0,160,240,.85],[0,110,230,.95],[50,60,220,1],[235,220,25,1],[255,135,15,1],[235,50,40,1],[185,45,175,1]]};
export const snowTotalScale={...totalScale,colors:[[255,235,255,0],[255,235,255,0],[255,235,255,0],[225,190,245,.65],[205,140,235,.85],[185,95,220,.95],[155,60,195,1],[125,40,165,1],[100,25,140,1],[70,15,110,1],[45,5,80,1]]};
export function totalColor(variable,value,output,offset=0){
 const scale=variable==='snowfall_total'?snowTotalScale:totalScale;
 if(!Number.isFinite(value)||value<.1){output.fill(0,offset,offset+4);return;}
 let i=2;while(i<scale.breakpoints.length-2&&value>scale.breakpoints[i+1])i++;
 const f=Math.max(0,Math.min(1,(value-scale.breakpoints[i])/(scale.breakpoints[i+1]-scale.breakpoints[i])));
 for(let c=0;c<4;c++)output[offset+c]=(scale.colors[i][c]*(1-f)+scale.colors[i+1][c]*f)*(c===3?255:1);
}
export function totalLegend(snow=false){
 const scale=snow?snowTotalScale:totalScale,ticks=[.1,2,10,40,160];
 const stops=scale.breakpoints.filter(v=>v>=.1).map(value=>{
  let i=0;while(i<ticks.length-2&&value>ticks[i+1])i++;
  const p=(i+(value-ticks[i])/(ticks[i+1]-ticks[i]))/4,c=new Uint8ClampedArray(4);totalColor(snow?'snowfall_total':'precipitation_total',value,c);
  return [p,`rgba(${c[0]},${c[1]},${c[2]},${c[3]/255})`];
 });
 return {labels:['0,1','2','10','40','160+'],stops,gradient:'linear-gradient(to right,'+stops.map(([p,c])=>`${c} ${p*100}%`).join(',')+')'};
}
