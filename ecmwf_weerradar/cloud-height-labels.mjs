// Sample the original model cloud base at a readable screen spacing.
// Nearest values preserve missing / cloud-free markers at cloud edges.
export function cloudHeightLabels(field,unproject,width,height,{spacingX=90,spacingY=65,exclude=[]}={}){
 if(!field?.cloudBase)return [];
 const labels=[];
 for(let y=35;y<height-25;y+=spacingY)for(let x=45;x<width-35;x+=spacingX){
  if(exclude.some(r=>x>r[0]-30&&x<r[2]+30&&y>r[1]-15&&y<r[3]+15))continue;
  const p=unproject([x,y]),value=field.grid.getNearestNeighborValue(field.cloudBase,p.lat,p.lng);
  if(!Number.isFinite(value)||value<0||value===9999)continue;
  labels.push({x,y,text:Math.round(value)+'m'});
 }
 return labels;
}
export function drawCloudHeightLabels(ctx,field,unproject,width,height,options={}){
 const labels=cloudHeightLabels(field,unproject,width,height,options);
 ctx.save();ctx.font='700 16px Arial';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';ctx.lineWidth=3;ctx.strokeStyle='rgba(20,30,40,.7)';ctx.fillStyle='#fff';
 for(const {x,y,text} of labels){ctx.strokeText(text,x,y);ctx.fillText(text,x,y);}
 ctx.restore();return labels.length;
}
