// Move the already painted overlay with the map compositor. Forecast sampling,
// label collision checks and contour painting run once after the gesture.
export class MovingOverlay {
  constructor(map,canvas,redraw){Object.assign(this,{map,canvas,redraw});this.moving=false;}
  start(){
    if(this.moving)return;
    const c=this.map.getCenter();this.anchor=[c.lng,c.lat];this.pixel=this.map.project(this.anchor);this.zoom=this.map.getZoom();
    this.moving=true;this.canvas.style.transformOrigin='0 0';this.canvas.style.willChange='transform';
  }
  move(){
    if(!this.moving)return;
    const p=this.map.project(this.anchor),scale=2**(this.map.getZoom()-this.zoom);
    this.canvas.style.transform=`translate3d(${p.x-this.pixel.x*scale}px,${p.y-this.pixel.y*scale}px,0) scale(${scale})`;
  }
  finish(){
    this.moving=false;this.canvas.style.transform='';this.canvas.style.willChange='';this.redraw();
  }
}
