// KNMI Beaufort lower bounds in m/s. The numerical fields remain km/h;
// classify only after spatial interpolation, for every model and UI surface.
// https://www.knmi.nl/kennis-en-datacentrum/uitleg/windschaal-van-beaufort
export const BEAUFORT_MS=[0,.3,1.6,3.4,5.5,8,10.8,13.9,17.2,20.8,24.5,28.5,32.7];
export function beaufort(kmh){
 if(!Number.isFinite(kmh)||kmh<0)return NaN;
 for(let i=12;i>0;i--)if(kmh>=BEAUFORT_MS[i]*3.6)return i;
 return 0;
}
export function windDirectionText(degrees){
 if(!Number.isFinite(degrees))return '—';
 const angle=(degrees%360+360)%360,compass=['N','NNO','NO','ONO','O','OZO','ZO','ZZO','Z','ZZW','ZW','WZW','W','WNW','NW','NNW'];
 return `${compass[Math.round(angle/22.5)%16]} · ${Math.round(angle)%360}°`;
}
export const windScale={type:'breakpoint',unit:'Bft',breakpoints:[0,2,3,4,5,7,9,11,12],colors:[[102,194,208,.25],[70,192,188,.45],[83,202,137,.55],[164,205,91,.65],[233,204,72,.75],[238,145,49,.85],[230,83,58,.9],[188,51,121,.95],[120,39,153,1]]};
export const windLegend={labels:['0','3','6','9','12'],gradient:`linear-gradient(to right,${windScale.colors.map((c,i)=>`rgb(${c.slice(0,3).join(',')}) ${windScale.breakpoints[i]/12*100}%`).join(',')})`};
