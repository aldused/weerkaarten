import {PRECIPITATION_THRESHOLD} from './precipitation-colors.mjs';

// Values are sampled from the committed map frame, already normalised to mm/h.
// Cloud transparency is a drawing choice, never evidence that it is dry.
export function weatherSymbol({precipitation=NaN,snowfall=NaN,cloud=null,fog=null}={}){
  if(Number.isFinite(snowfall)&&snowfall>=PRECIPITATION_THRESHOLD){
    return Number.isFinite(precipitation)&&precipitation-snowfall>=PRECIPITATION_THRESHOLD?'mixed':'snow';
  }
  if(Number.isFinite(precipitation)&&precipitation>=PRECIPITATION_THRESHOLD)return 'rain';
  if(fog)return 'fog';
  // Missing weather values must not turn into a dry-weather forecast.
  if(!Number.isFinite(precipitation)||precipitation<0)return null;
  return ['clear','filtered','overcast'].includes(cloud)?cloud:null;
}

export function drawPrecipitationSymbol(ctx,x,y,type){
  ctx.save();ctx.translate(x,y);ctx.lineJoin='round';ctx.lineCap='round';
  // Compact outlined cloud remains legible over both dark map and pale clouds.
  ctx.beginPath();ctx.moveTo(-6,1);ctx.bezierCurveTo(-11,1,-10,-6,-5,-5);
  ctx.bezierCurveTo(-5,-12,5,-12,6,-5);ctx.bezierCurveTo(12,-6,12,1,7,1);ctx.closePath();
  ctx.fillStyle='#e8f1f6';ctx.strokeStyle='#203a50';ctx.lineWidth=1.5;ctx.fill();ctx.stroke();
  ctx.beginPath();
  for(const dx of [-5,1,7]){
    if(type==='snow'||type==='mixed'&&dx===7){
      for(let i=0;i<3;i++){const a=i*Math.PI/3;ctx.moveTo(dx-Math.cos(a)*2.4,6-Math.sin(a)*2.4);ctx.lineTo(dx+Math.cos(a)*2.4,6+Math.sin(a)*2.4);}
    }else{ctx.moveTo(dx,4);ctx.lineTo(dx-2,8);}
  }
  ctx.strokeStyle='#203a50';ctx.lineWidth=3;ctx.stroke();
  ctx.strokeStyle=type==='snow'?'#f5edff':'#64ddff';ctx.lineWidth=1.5;ctx.stroke();ctx.restore();
}
