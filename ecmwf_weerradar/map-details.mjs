// Static cartography is fetched by visible tile, independently of model data.
const pause=()=>new Promise(resolve=>requestAnimationFrame(resolve));
export class MapDetails{
  constructor(map,L){this.map=map;this.L=L;this.cache=new Map();this.layers=new Map();this.requests=new Map();this.revision=0;this.borders=true;this.manifest=null;}
  async update(){
    const revision=++this.revision;
    this.manifest??=fetch('./assets/map-details/index.json').then(r=>{if(!r.ok)throw new Error('Kaartindex niet bereikbaar');return r.json();}).catch(error=>{this.manifest=null;throw error;});
    let manifest;try{manifest=await this.manifest;}catch{return;}
    if(revision!==this.revision)return;
    const b=this.map.getBounds(),z=this.map.getZoom()<=5?3:5,n=2**z;
    const row=lat=>(1-Math.asinh(Math.tan(lat*Math.PI/180))/Math.PI)/2*n;
    const allowed=new Set(manifest.levels[z]),wanted=new Set();
    for(let y=Math.floor(row(Math.min(73,b.getNorth())));y<Math.ceil(row(Math.max(29,b.getSouth())));y++)for(let x=Math.floor((Math.max(-26,b.getWest())+180)/360*n);x<Math.ceil((Math.min(46,b.getEast())+180)/360*n);x++)if(allowed.has(`${x}-${y}`))wanted.add(`${z}/${x}-${y}`);
    for(const [key,job] of this.requests)if(!wanted.has(key)){job.controller.abort();this.requests.delete(key);}
    await Promise.allSettled([...wanted].map(async key=>{
      if(this.layers.has(key))return;
      let data=this.cache.get(key),job=this.requests.get(key);
      if(!data){
        if(!job){
          const controller=new AbortController();
          job={controller,promise:fetch(`./assets/map-details/${manifest.version}/${key}.json`,{signal:controller.signal,priority:'low'}).then(r=>{if(!r.ok)throw new Error('Kaarttegel niet bereikbaar');return r.json();})};
          this.requests.set(key,job);
        }
        try{data=await job.promise;this.cache.set(key,data);}finally{if(this.requests.get(key)===job)this.requests.delete(key);}
      }
      if(revision!==this.revision)return;
      const groups={};
      const styles={land:{stroke:false,fillColor:'#719342',fillOpacity:.44},countries:{color:'#1b3034',weight:1,opacity:.75,fill:false},regions:{color:'#2e4d58',weight:.6,opacity:.65,fill:false}};
      for(const kind of ['land','regions','countries']){
        const layer=this.L.geoJSON([],{pane:kind==='land'?'land':'borders',interactive:false,style:styles[kind]});groups[kind]=layer;
        // Inserting thousands of SVG/canvas paths in one task blocks input.
        let slice=performance.now();
        for(const feature of data[kind]){
          layer.addData(feature);
          if(performance.now()-slice>6){await pause();if(revision!==this.revision)return;slice=performance.now();}
        }
      }
      if(revision!==this.revision)return;
      this.layers.set(key,groups);
      for(const [kind,layer] of Object.entries(groups))if(kind==='land'||this.borders)layer.addTo(this.map);
    }));
    if(revision!==this.revision)return;
    for(const [key,groups] of this.layers)if(!wanted.has(key)){for(const layer of Object.values(groups))layer.remove();this.layers.delete(key);}
    // A small bounded LRU of source tiles, not indefinitely growing Leaflet layers.
    for(const key of wanted)if(this.cache.has(key)){const value=this.cache.get(key);this.cache.delete(key);this.cache.set(key,value);}
    while(this.cache.size>24)this.cache.delete(this.cache.keys().next().value);
  }
  setBorders(show){this.borders=show;for(const groups of this.layers.values())for(const kind of ['regions','countries']){if(show)groups[kind].addTo(this.map);else groups[kind].remove();}}
}
