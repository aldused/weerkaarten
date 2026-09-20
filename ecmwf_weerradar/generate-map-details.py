"""Build static viewport-only cartography. Forecast data are not touched.
Fine tiles contain original geometry, clipped only at shared tile boundaries.
At continental scale, simplify less than 1/4 screen pixel at the chosen LOD.
"""
import json,math,hashlib
from pathlib import Path
from shapely.geometry import shape,mapping,box
ROOT=Path(__file__).parent
inputs={k:(ROOT/'assets'/f'{k}.geojson').read_bytes() for k in ['land','countries','regions']}
version='v1-'+hashlib.sha256(b''.join(inputs.values())).hexdigest()[:12]
destination=ROOT/'assets'/'map-details'/version;destination.mkdir(parents=True,exist_ok=True)
objects={k:[shape(f['geometry']) for f in json.loads(data)['features']] for k,data in inputs.items()}
def latitude(y,z):return math.degrees(math.atan(math.sinh(math.pi*(1-2*y/2**z))))
def row(lat,z):return (1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*2**z
manifest={'version':version,'levels':{}}
for z in [3,5]:
 tiles=[]
 for y in range(math.floor(row(73,z)),math.ceil(row(29,z))):
  for x in range(math.floor(154/360*2**z),math.ceil(226/360*2**z)):
   bounds=[max(-26,x/2**z*360-180),max(29,latitude(y+1,z)),min(46,(x+1)/2**z*360-180),min(73,latitude(y,z))];area=box(*bounds)
   data={}
   for kind,geometries in objects.items():
    features=[]
    for geometry in geometries:
     if not geometry.intersects(area):continue
     clipped=geometry.intersection(area)
     if z==3:clipped=clipped.simplify(.02,preserve_topology=True)
     if not clipped.is_empty:features.append({'type':'Feature','properties':{},'geometry':mapping(clipped)})
    data[kind]=features
   if not any(data.values()):continue
   tile=f'{x}-{y}';tiles.append(tile);p=destination/str(z)/(tile+'.json');p.parent.mkdir(exist_ok=True)
   p.write_text(json.dumps(data,separators=(',',':')))
 manifest['levels'][str(z)]=tiles
(ROOT/'assets'/'map-details'/'index.json').write_text(json.dumps(manifest,separators=(',',':')))
print(version,{z:len(keys) for z,keys in manifest['levels'].items()})
