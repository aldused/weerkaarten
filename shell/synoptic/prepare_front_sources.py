"""Rebuild review masks from retained official colour charts and reviewed trough corridors.
This extracts source ink, not fronts inferred from model fields. Review the resulting
masks against all originals before setting reviewed=true in source.json.
"""
import argparse,hashlib,json
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
from scipy.ndimage import binary_dilation,distance_transform_edt
PALETTE=np.array([[0,50,254],[254,50,0],[229,50,229]],dtype=float)

def colour_masks(images):
 background=np.median(images,axis=0)
 for original in images:
  image=np.asarray(original,dtype=float)
  distances=np.linalg.norm(image[:,:,None,:]-PALETTE,axis=3)
  kind=np.argmin(distances,axis=2);seed=np.min(distances,axis=2)<24
  near=distance_transform_edt(~seed)<=1.5
  foreground=PALETTE[kind];delta=foreground-background
  alpha=np.clip(np.sum((image-background)*delta,axis=2)/np.maximum(np.sum(delta*delta,axis=2),1),0,1)
  residual=np.linalg.norm(image-(background+delta*alpha[:,:,None]),axis=2)
  valid=near&(((residual<28)&(alpha>.12))|seed)
  # Red thickness contours use a different palette entry, not warm-front orange.
  valid&=~((kind==1)&(image[:,:,1]<22))
  alpha=np.where(seed,np.maximum(alpha,.88),alpha)
  rgba=np.zeros((*image.shape[:2],4),dtype=np.uint8)
  rgba[:,:,:3]=foreground.astype('uint8');rgba[:,:,3]=np.round(np.where(valid,alpha,0)*255).astype('uint8')
  yield Image.fromarray(rgba)

def trough_mask(original,paths):
 image=np.asarray(original,dtype=float);height,width=image.shape[:2]
 corridor=Image.new('L',(width,height));draw=ImageDraw.Draw(corridor)
 for points in paths:draw.line([tuple(p) for p in points],fill=255,width=5,joint='curve')
 near=binary_dilation(np.max(image,axis=2)<80,iterations=1)
 alpha=np.where((np.array(corridor)>0)&near,np.clip((155-np.max(image,axis=2))/100,0,1),0)
 rgba=np.zeros((height,width,4),np.uint8);rgba[:,:,:3]=[22,102,209];rgba[:,:,3]=np.round(alpha*255).astype('uint8')
 return Image.fromarray(rgba)

def rebuild(directory):
 directory=Path(directory);metadata=json.loads((directory/'source.json').read_text());days=list(metadata['frames'])
 images=[np.array(Image.open(directory/f'{day}-front-reference.png')).astype(float) for day in days]
 for day,image,mask in zip(days,images,colour_masks(images)):
  mask.alpha_composite(trough_mask(image,metadata['frames'][day]['troughPaths']))
  target=directory/f'{day}-fronts-source.png';mask.save(target)
  metadata['frames'][day]['sha256']=hashlib.sha256(target.read_bytes()).hexdigest()
 metadata['reviewed']=False
 (directory/'source.json').write_text(json.dumps(metadata,indent=2)+'\n')
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('directory',type=Path);rebuild(parser.parse_args().directory)
