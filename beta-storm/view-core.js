/* Pure geometry helpers shared by the browser and numerical regression tests. */
(function(root){
  'use strict';
  function contours(values,lat,lon,threshold){
    const lines=[];
    for(let y=0;y<lat.length-1;y++)for(let x=0;x<lon.length-1;x++){
      const v=[values[y][x],values[y][x+1],values[y+1][x+1],values[y+1][x]];
      if(v.some(a=>!Number.isFinite(a)))continue;
      const points=[[lat[y],lon[x]],[lat[y],lon[x+1]],[lat[y+1],lon[x+1]],[lat[y+1],lon[x]]],cross=[];
      for(let e=0;e<4;e++){
        const j=(e+1)%4;if((v[e]>=threshold)===(v[j]>=threshold))continue;
        const t=(threshold-v[e])/(v[j]-v[e]);
        cross.push({edge:e,p:[points[e][0]+t*(points[j][0]-points[e][0]),points[e][1]+t*(points[j][1]-points[e][1])]});
      }
      if(cross.length===2)lines.push(cross.map(a=>a.p));
      else if(cross.length===4){
        // Resolve saddle cells by the bilinear centre; never bridge missing cells.
        const centre=v.reduce((a,b)=>a+b,0)/4;
        const pairs=(centre>=threshold)===(v[0]>=threshold)?[[0,1],[2,3]]:[[0,3],[1,2]];
        pairs.forEach(pair=>lines.push(pair.map(i=>cross[i].p)));
      }
    }
    return lines;
  }
  function days(frames){return [...new Set(frames.map(f=>f.valid.slice(0,10)))];}
  function dayFrame(frames,day,current){
    const hour=frames[current].valid.slice(11,16),wanted=Date.parse(day+'T'+hour+':00Z');
    const indices=frames.map((f,i)=>f.valid.startsWith(day)?i:-1).filter(i=>i>=0);
    return indices.reduce((a,b)=>Math.abs(Date.parse(frames[a].valid)-wanted)<=Math.abs(Date.parse(frames[b].valid)-wanted)?a:b,indices[0]);
  }
  function systemAtFrame(systems,frame){
    return systems.filter(s=>s.tracks.find(t=>t.member===0)?.points[frame]).sort((a,b)=>a.tracks.find(t=>t.member===0).points[frame][2]-b.tracks.find(t=>t.member===0).points[frame][2])[0]||null;
  }
  const api={contours,days,dayFrame,systemAtFrame};if(typeof module==='object'&&module.exports)module.exports=api;else root.StormViewCore=api;
})(typeof globalThis==='object'?globalThis:this);
