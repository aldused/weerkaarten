import os
import json, math
from pathlib import Path
import numpy as np
from wind_math import beaufort,flow_bearing
O=Path(os.environ.get('WEERKAART_OUT','outputs/weerkaart-demo'))
# Sparse fixed sites, away from city labels; sample native 10m wind grid.
points=[(-10,57),(-10,52),(-8,47),(-1,49.5),(2,54.5),(3,58.5),(7,56.5),(17,57),(21,54),(10,50),(16,47),(1,46),(7,44)]
merc=lambda la:math.log(math.tan(math.pi/4+math.radians(la)/2))
for frame in json.loads((O/'frames.json').read_text()):
 day=frame['day']
 m=json.loads((O/f'{day}-ukmo-meta.json').read_text());g=m['grid'];yr,xr=m['ranges'];shape=(yr['end']-yr['start'],xr['end']-xr['start'])
 speed=np.fromfile(O/f'{day}-ukmo-wind_speed_10m.bin',dtype='<f4').reshape(shape);direction=np.fromfile(O/f'{day}-ukmo-wind_direction_10m.bin',dtype='<f4').reshape(shape)
 centres=json.loads((O/f'{day}-ukmo-pressure-centres.json').read_text())
 parts=['<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="880" viewBox="0 0 1400 880">'];audit=[]
 for lo,la in points:
  ix=round((lo-g['lonMin'])/g['dx'])-xr['start'];iy=round((la-g['latMin'])/g['dy'])-yr['start'];v=float(speed[iy,ix]);d=float(direction[iy,ix]);assert math.isfinite(v+d) and v>=0
  bft=beaufort(v);x=(lo+13)/37*1400;y=(merc(62)-merc(la))/(merc(62)-merc(42))*880
  if any((x-c['x'])**2+(y-c['y'])**2<85**2 for c in centres):continue
  audit.append(dict(lon=lo,lat=la,speed_ms=v,from_degrees=d,to_degrees=flow_bearing(d),bft=bft,wind_type="mean_10m"))
  # Base arrow points north; rotate by meteorological FROM direction + 180.
  glyph='<circle r="3" fill="none" stroke="#264953" stroke-width="1.8"/>' if bft==0 else f'<g transform="rotate({flow_bearing(d):.1f})"><path d="M0,13 V-13 M-5,-6 L0,-13 L5,-6" fill="none" stroke="white" stroke-width="5" stroke-linecap="round"/><path d="M0,13 V-13 M-5,-6 L0,-13 L5,-6" fill="none" stroke="#264953" stroke-width="1.8" stroke-linecap="round"/></g>'
  parts.append(f'<g transform="translate({x:.1f},{y:.1f})">{glyph}<text x="18" y="5" font-family="Arial,sans-serif" font-size="14" font-weight="600" fill="#264953" stroke="white" stroke-width="3" paint-order="stroke">{bft}</text></g>')
 parts.append('</svg>');(O/f'{day}-wind.svg').write_text(''.join(parts));(O/f'{day}-wind.json').write_text(json.dumps(audit,indent=2))
print('65 windpunten op vijf kaarten; m/s naar Beaufort, pijlen naar stroomrichting.')
