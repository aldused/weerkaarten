"""Reproject reviewed official Bracknell source pixels, preserving glyph topology.
No guessed frontal type, orientation, or new symbol placement. Only the source
ink boundary gets subpixel smoothing when converted to sharp vector contours.
"""
import hashlib,json,shutil
from pathlib import Path
import numpy as np
from PIL import Image
from pyproj import Transformer
from scipy.ndimage import gaussian_filter
import contourpy
CRS='+proj=stere +lat_0=90 +lon_0=-35 +k=1 +datum=WGS84 +units=m'
METHOD='Frontlijnen en symbolen rechtstreeks uit de officiële Bracknell-kleurenkaart, geografisch herprojecteerd; troggen afzonderlijk tegen de bron gecontroleerd.'

def source_review(directory,run,frames):
 directory=Path(directory);metadata=json.loads((directory/'source.json').read_text())
 if metadata.get('reviewed') is not True:raise ValueError('Bracknell-bronmaskers zijn nog niet gecontroleerd')
 if metadata.get('run')!=run:raise ValueError('Bracknell-bron hoort bij een andere modelrun')
 if (metadata.get('sourceWidth'),metadata.get('sourceHeight'))!=(800,540):raise ValueError('Onbekende Bracknell-projectieafmetingen')
 for frame in frames:
  day=str(frame['day']);entry=metadata['frames'].get(day,{})
  if entry.get('valid')!=frame['valid']:raise ValueError('Bracknell-geldigheid wijkt af van de gekozen middag')
  for suffix,key,mode in [('fronts-source','sha256','RGBA'),('front-reference','referenceSha256','RGB')]:
   path=directory/f'{day}-{suffix}.png'
   if hashlib.sha256(path.read_bytes()).hexdigest()!=entry.get(key):raise ValueError('Bracknell-bron of frontmasker is na controle gewijzigd')
   with Image.open(path) as image:
    if image.size!=(800,540) or image.mode!=mode:raise ValueError('Ongeldig gecontroleerd Bracknell-beeld')
 return metadata

def source_coordinates(lon,lat):
 x,y=Transformer.from_crs('EPSG:4326',CRS,always_xy=True).transform(lon,lat)
 return ((np.asarray(x)+2168308.173980)/3951.089571*(800/2148),
         (-579889.081514-np.asarray(y))/3951.089571*(540/1452))

def vector_paths(image):
 rgba=np.asarray(image,dtype=float)/255
 palette=[('#0032fe',(0,50,254)),('#fe3200',(254,50,0)),('#e532e5',(229,50,229)),('#1666d1',(22,102,209))]
 for color,rgb in palette:
  selected=np.all(np.asarray(image)[:,:,:3]==rgb,axis=2)
  ink=gaussian_filter(rgba[:,:,3]*selected,.55)
  # Trace the boundary of the reviewed ink, including source glyph holes/crosses.
  paths,codes=contourpy.contour_generator(z=ink,fill_type='OuterCode').filled(.38,1.01)
  for points,commands in zip(paths,codes):yield color,points,commands

def source_to_screen(points):
 x=-2168308.173980+points[:,0]*(2148/800)*3951.089571
 y=-579889.081514-points[:,1]*(1452/540)*3951.089571
 lon,lat=Transformer.from_crs(CRS,'EPSG:4326',always_xy=True).transform(x,y)
 merc=lambda la:np.log(np.tan(np.pi/4+np.radians(np.clip(la,-85,85))/2))
 return np.column_stack([(np.asarray(lon)+13)/37*1400,(merc(62)-merc(lat))/(merc(62)-merc(42))*880])

def render_sources(directory,out,config):
 directory=Path(directory);out=Path(out);metadata=source_review(directory,config['run'],config['frames'])
 for frame in config['frames']:
  day=str(frame['day']);entry=metadata['frames'][day]
  parts=[f'<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="880" viewBox="0 0 1400 880"><title>Bracknell-fronten {frame["valid"]}</title><defs><clipPath id="extent"><rect width="1400" height="880"/></clipPath></defs><g clip-path="url(#extent)">']
  with Image.open(directory/f'{day}-fronts-source.png') as source:
   for color,points,commands in vector_paths(source):
    xy=source_to_screen(points);path=[]
    for point,command in zip(xy,commands):
     path.append('Z' if command==79 else ('M' if command==1 else 'L')+f'{point[0]:.2f},{point[1]:.2f}')
    parts.append(f'<path d="{" ".join(path)}" fill="{color}" stroke="white" stroke-opacity=".7" stroke-width="1.2" paint-order="stroke fill"/>')
  parts.append('</g></svg>');(out/f'{day}-fronts.svg').write_text(''.join(parts))
  shutil.copy(directory/f'{day}-front-reference.png',out/f'{day}-front-reference.png')
  (out/f'{day}-fronts.json').write_text(json.dumps(dict(valid=frame['valid'],run=config['run'],source=entry['source'],sourceMaskSha256=entry['sha256'],method=METHOD,representation='reprojected-reviewed-source-ink-contours'),indent=2))
