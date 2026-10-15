import os
import json,struct, numpy as np, math
from pathlib import Path
from scipy.ndimage import gaussian_filter, maximum_filter,minimum_filter
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap,BoundaryNorm,ListedColormap
from PIL import Image
from scipy.interpolate import RegularGridInterpolator
O=Path(os.environ.get('WEERKAART_OUT','outputs/weerkaart-demo'));W,H=1400,880;west,south,east,north=-13,42,24,62
merc=lambda v:np.log(np.tan(np.pi/4+np.deg2rad(v)/2));ymn,ymx=merc(south),merc(north)
lon=np.linspace(west,east,W);lat=np.rad2deg(2*np.arctan(np.exp(np.linspace(ymx,ymn,H)))-np.pi/2)
def xy(lo,la):return ((lo-west)/(east-west)*W,(ymx-merc(np.clip(la,-85,85)))/(ymx-ymn)*H)
def field(path):
 day=int(path.name.split('-')[0]);var=path.name.split('-12-')[1][:-4]
 m=json.loads((O/f'{day}-ukmo-meta.json').read_text());g=m['grid'];yr,xr=m['ranges']
 a=np.fromfile(O/f'{day}-ukmo-{var}.bin',dtype='<f4').reshape(yr['end']-yr['start'],xr['end']-xr['start'])
 ys=g['latMin']+np.arange(yr['start'],yr['end'])*g['dy'];xs=g['lonMin']+np.arange(xr['start'],xr['end'])*g['dx']
 interp=RegularGridInterpolator((ys,xs),a,bounds_error=True)
 yy,xx=np.meshgrid(lat,lon,indexing='ij');out=interp(np.stack([yy,xx],axis=-1));assert np.isfinite(out).all();return out
# Natural Earth public-domain geography already used by Weerlab.
features=[]
for kind in ['land','countries']:
 data=json.load(open('/Users/aldus/KNMI_Project/weerlab/ecmwf_weerradar/assets/'+kind+'.geojson'))
 paths=[]
 def walk(coords):
  if len(coords) and isinstance(coords[0][0],(int,float)):
   a=np.array(coords);x,y=xy(a[:,0],a[:,1]);
   if x.max()<0 or x.min()>W or y.max()<0 or y.min()>H:return
   paths.append('M'+' L'.join(f'{xx:.1f},{yy:.1f}' for xx,yy in zip(x,y)))
  else:
   for c in coords:walk(c)
 for f in data['features']:walk(f['geometry']['coordinates'])
 features.append(paths)
base=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}"><rect width="{W}" height="{H}" fill="#ddebf0"/>'+''.join(f'<path d="{p}Z" fill="#e8eddf" stroke="none"/>' for p in features[0])+'</svg>'
(O/'base.svg').write_text(base)
outline=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}"><g fill="none" stroke="#384c54" stroke-width="1.2" opacity=".74">'+''.join(f'<path d="{p}"/>' for p in features[1])+'</g><g fill="none" stroke="#344951" stroke-width="1.4">'+''.join(f'<path d="{p}"/>' for p in features[0])+'</g>'
for name,lo,la in [('Rotterdam',4.48,51.92),('Londen',-.12,51.5),('Parijs',2.35,48.85),('Berlijn',13.4,52.52),('Kopenhagen',12.57,55.68),('Wenen',16.37,48.21),('Praag',14.42,50.08),('Zürich',8.54,47.37),('Oslo',10.75,59.91),('Dublin',-6.26,53.35)]:
 x,y=xy(lo,la);outline+=f'<circle cx="{x:.1f}" cy="{y:.1f}" r="3" fill="#183c49"/><text x="{x+7:.1f}" y="{y-7:.1f}" font-family="Arial" font-size="14" font-weight="600" fill="#163945" stroke="white" stroke-width="3" paint-order="stroke">{name}</text>'
(O/'geography.svg').write_text(outline+'</svg>')
tempmap=LinearSegmentedColormap.from_list('temp',[(0,'#b8b6d9'),(.18,'#b9d4e5'),(.35,'#a5d7ca'),(.52,'#d5deb0'),(.7,'#eee1a4'),(.85,'#e8ba86'),(1,'#ce8b79')])
raincolors=['#8fd4ef','#4da9df','#3186d1','#3658b4','#35a88d','#83bd59','#d8cc44','#e99439','#cf4b47'];bounds=[.1,.2,.5,1,2,4,8,16,32,64]
frames=[]
for frame in json.loads((O/'frames.json').read_text()):
 day=frame['day']
 def get(var):
  value=field(O/f'{day}-12-{var}.bin')
  return value/frame['intervalHours'] if var in ['precipitation','rain'] else value
 t=get('temperature_2m');c=get('cloud_cover');r=get('precipitation');p=get('pressure_msl');snow=np.zeros_like(r);r=np.maximum(r,0)
 Image.fromarray((tempmap(np.clip((t+10)/40,0,1))*255).astype('uint8')).save(O/f'{day}-ukmo-temp.png')
 cloud=np.ones((H,W,4));cloud[:,:,:3]=.99;cloud[:,:,3]=np.clip((c-15)/85,0,1)*.76;Image.fromarray((cloud*255).astype('uint8')).save(O/f'{day}-ukmo-cloud.png')
 rr=ListedColormap(raincolors)(BoundaryNorm(bounds,len(raincolors))(r));rr[:,:,3]=np.where(r>=.1,.88,0);Image.fromarray((rr*255).astype('uint8')).save(O/f'{day}-ukmo-rain.png')
 snowcolors=['#fbd2e5','#f5a1cc','#ed6eb0','#d63c91','#ad2077','#77115a'];ss=ListedColormap(snowcolors)(BoundaryNorm([.05,.1,.2,.5,1,2,100],len(snowcolors))(snow));ss[:,:,3]=np.where(snow>=.05,.96,0);Image.fromarray((ss*255).astype('uint8')).save(O/f'{day}-ukmo-snow.png')
 fig,ax=plt.subplots(figsize=(W/100,H/100),dpi=100);fig.subplots_adjust(0,0,1,1);ax.set_xlim(0,W);ax.set_ylim(H,0);ax.axis('off');smooth=gaussian_filter(p,3);cs=ax.contour(np.arange(W),np.arange(H),smooth,levels=np.arange(940,1060,4),colors='#344851',linewidths=.8,alpha=.85);ax.clabel(cs,fmt='%d',fontsize=10,inline=True,inline_spacing=5)
 # Synoptic-scale smoothing suppresses terrain/reduction noise in mean sea-level pressure.
 centres=gaussian_filter(p,15)
 centres_audit=[]
 occupied=[]
 for symbol,mask,color in [('H',centres==maximum_filter(centres,241),'#315e98'),('L',centres==minimum_filter(centres,241),'#a34857')]:
  ys,xs=np.where(mask);chosen=[]
  for y,x in zip(ys,xs):
   if not(35<x<W-35 and 25<y<H-45) or any((x-a)**2+(y-b)**2<240**2 for a,b in chosen):continue
   # Search complete rings at multiple scales, retaining broad anticyclones
   # while rejecting insignificant ripples and boundary/terrain artefacts.
   prominence=0.0
   for radius in [100,150,200,250,290]:
    if radius>=min(x,W-x-1,y,H-y-1):continue
    angles=np.linspace(0,2*np.pi,72,endpoint=False)
    rx=np.rint(x+radius*np.cos(angles)).astype(int);ry=np.rint(y+radius*np.sin(angles)).astype(int)
    difference=(centres[y,x]-centres[ry,rx])*(1 if symbol=='H' else -1)
    if float(np.median(difference))>=1.0:prominence=max(prominence,float(np.min(difference)))
   if prominence<0.35:continue
   if any((x-a)**2+(y-b)**2<160**2 for a,b in occupied):continue
   occupied.append((x,y))
   centres_audit.append(dict(symbol=symbol,prominence_hpa=round(prominence,2),x=int(x),y=int(y),pressure=round(float(centres[y,x]),1),lon=round(float(lon[x]),3),lat=round(float(lat[y]),3)));chosen.append((x,y));ax.text(x,y,symbol,color=color,fontsize=28,fontweight='bold',ha='center');ax.text(x,y+20,f'{centres[y,x]:.0f}',color=color,fontsize=12,ha='center')
 (O/f'{day}-ukmo-pressure-centres.json').write_text(json.dumps(centres_audit,indent=2))
 fig.savefig(O/f'{day}-ukmo-pressure.svg',transparent=True);plt.close(fig)
 frames.append({'day':day,'valid':frame['valid'],'interpolated':False,'rainInterval':frame['rainInterval'],'snowAvailable':False,'precipitationType':'total','frontValid':frame['valid']})
 print(day,'temp',round(t.min(),1),round(t.max(),1),'pressure',round(p.min()),round(p.max()),'rain',round(r.max(),1),'snow SWE',round(snow.max(),2),'snow pixels',int((snow>=.05).sum()))
(O/'ukmo-frames.json').write_text(json.dumps(frames))
