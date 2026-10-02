// One static Benelux layer, with shared borders drawn once.
export class MapDetails {
 constructor(map,L){this.map=map;this.L=L;this.pending=null;this.boundaries=[];this.borders=true;}
 async update(){
  if(this.pending)return this.pending;
  this.pending=fetch('./neerslag_mix_basemap.json').then(r=>{if(!r.ok)throw Error('Onderkaart niet bereikbaar');return r.json();}).then(data=>{
   for(const feature of data.features){
    const land=feature.properties.role==='land';
    const style=land?{stroke:false,fillColor:'#f5efd9',fillOpacity:1}:{fill:false,color:'#fff',weight:feature.properties.role==='countries'?1.6:1.25,opacity:1};
    const layer=this.L.geoJSON(feature,{pane:land?'land':'borders',interactive:false,style});
    if(land||this.borders)layer.addTo(this.map);
    if(!land)this.boundaries.push(layer);
   }
  }).catch(error=>{this.pending=null;document.getElementById('error').textContent=error.message;});
  return this.pending;
 }
 setBorders(show){this.borders=show;for(const layer of this.boundaries){if(show)layer.addTo(this.map);else layer.remove();}}
}
