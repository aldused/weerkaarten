import os
"""Manually digitized Bracknell source front lines; pixels refer to retained source images.
Always include troughs as plain blue lines, alongside fronts, for every source chart.
Only systems intersecting the demo region are traced. Type and symbol side follow source.
This static demo is a cartographic interpretation, not operational automated front detection.
"""
import json,numpy as np
from pathlib import Path
from scipy.interpolate import PchipInterpolator
O=Path(os.environ.get('WEERKAART_OUT','outputs/weerkaart-demo'));W,H=1400,880
# type, side relative to directed line in source-image coordinates, pixels
fronts={int(day):items for day,items in json.loads(Path(os.environ['WEERKAART_FRONTS']).read_text()).items()}
from pyproj import Transformer
# Published Bracknell CRS and world file by Ernst Lobsiger, resized from 2148x1452.
# https://www.leshamilton.co.uk/BracknellGIS.htm (ChartOverlaySetup, BAK/Bracknell.pngw)
transform=Transformer.from_crs('+proj=stere +lat_0=90 +lon_0=-35 +k=1 +datum=WGS84 +units=m','EPSG:4326',always_xy=True)
def unproject(pts):
 x,y=np.asarray(pts,dtype=float).T
 x=-2168308.173980+(x*2148/960)*3951.089571
 y=-579889.081514-(y*1452/647)*3951.089571
 lo,la=transform.transform(x,y)
 return np.column_stack([lo,la])
merc=lambda la:np.log(np.tan(np.pi/4+np.radians(la)/2))
def screen(ll):
 lo,la=ll.T;return np.column_stack([(lo+13)/37*W,(merc(62)-merc(la))/(merc(62)-merc(42))*H])
def smooth(points):
 p=np.asarray(points);t=np.r_[0,np.cumsum(np.linalg.norm(np.diff(p,axis=0),axis=1))];s=np.linspace(0,t[-1],max(40,int(t[-1]/2)))
 return np.column_stack([PchipInterpolator(t,p[:,i])(s) for i in range(2)])
for day,items in fronts.items():
 parts=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}"><defs><clipPath id="map"><rect width="{W}" height="{H}"/></clipPath></defs><g clip-path="url(#map)">'];audit=[]
 for kind,side,pixels in items:
  ll=unproject(pixels);xy=screen(ll);xy=smooth(xy);audit.append({'type':kind,'sourcePixels':pixels,'coordinates':ll.tolist(),'side':side})
  color={'cold':'#1666d1','warm':'#da334a','occluded':'#9942bd','trough':'#1666d1'}[kind]
  path='M'+' L'.join(f'{x:.1f},{y:.1f}' for x,y in xy)
  line_width=5 if kind=='trough' else 2.8
  halo_width=8 if kind=='trough' else 5
  parts.append(f'<path d="{path}" fill="none" stroke="white" stroke-opacity=".85" stroke-width="{halo_width}"/><path d="{path}" fill="none" stroke="{color}" stroke-width="{line_width}" stroke-linecap="round"/>')
  if kind=='trough':
   continue
  lengths=np.r_[0,np.cumsum(np.linalg.norm(np.diff(xy,axis=0),axis=1))]
  # Orient using local projection: both source and target have y down, orientation preserved.
  for j,d in enumerate(np.arange(20,lengths[-1]-5,35)):
   i=np.searchsorted(lengths,d);center=xy[i];t=xy[min(i+2,len(xy)-1)]-xy[max(0,i-2)];t=t/np.linalg.norm(t);n=np.array([-t[1],t[0]])*side
   if kind=='cold' or (kind=='occluded' and j%2==0):
    shape=[center-t*8,center+t*8,center+n*13]
   else:
    theta=np.linspace(0,np.pi,16);shape=[center+t*np.cos(v)*8+n*np.sin(v)*9 for v in theta]
   pts=' '.join(f'{x:.1f},{y:.1f}' for x,y in shape);parts.append(f'<polygon points="{pts}" fill="{color}" stroke="{color}" stroke-width=".8"/>')
 parts.append('</g></svg>');(O/f'{day}-fronts.svg').write_text(''.join(parts))
 (O/f'{day}-fronts.json').write_text(json.dumps({'valid':f'2026-10-{day}T12:00:00Z','source':'Met Office / Bracknell','sourceImage':f'{day}-front-reference.png','method':'Handmatig gedigitaliseerde frontlijnen; cartografische demo-interpretatie','fronts':audit},indent=2))
