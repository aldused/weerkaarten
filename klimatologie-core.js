(function(root){
 const wrap=(i,n)=>(i%n+n)%n;
 function smooth(a){return a.map((_,i)=>{let w=Array.from({length:31},(_,j)=>a[wrap(i+j-15,a.length)]);return w.every(Number.isFinite)?w.reduce((s,v)=>s+v,0)/31:null})}
 function trends(a,method='regression') {if(method==='difference'){let s=smooth(a);return s.map((_,i)=>Number.isFinite(s[wrap(i-1,a.length)])&&Number.isFinite(s[wrap(i+1,a.length)])?(s[wrap(i+1,a.length)]-s[wrap(i-1,a.length)])/2:null)}return a.map((_,i)=>{let w=Array.from({length:31},(_,j)=>a[wrap(i+j-15,a.length)]);return w.every(Number.isFinite)?w.reduce((s,v,j)=>s+(j-15)*v,0)/2480:null})}
 function extremes(a,indices=a.map((_,i)=>i)){let valid=indices.filter(i=>Number.isFinite(a[i]));return valid.length?{min:valid.reduce((x,y)=>a[x]<=a[y]?x:y),max:valid.reduce((x,y)=>a[x]>=a[y]?x:y)}:null}
 function crossings(a){return a.flatMap((v,i)=>{let p=a[wrap(i-1,a.length)];return Number.isFinite(v)&&Number.isFinite(p)&&((p<=0&&v>0)||(p>=0&&v<0))?[i]:[]})}
 const api={smooth,trends,extremes,crossings};if(typeof module!=='undefined')module.exports=api;else root.Climate=api;
})(globalThis);
