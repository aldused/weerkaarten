import os
import json,math
from pathlib import Path
import numpy as np
from scipy.interpolate import RegularGridInterpolator
O=Path(os.environ['WEERKAART_OUT'])
points=[('Rotterdam',4.48,51.92),('Londen',-.12,51.5),('Parijs',2.35,48.85),('Berlijn',13.4,52.52),('Oslo',10.75,59.91),('Wenen',16.37,48.21)]
merc=lambda v:math.log(math.tan(math.pi/4+math.radians(v)/2))
for frame in json.loads((O/'frames.json').read_text()):
 day=frame['day']
 m=json.loads((O/f'{day}-ukmo-meta.json').read_text());g=m['grid'];yr,xr=m['ranges'];a=np.fromfile(O/f'{day}-ukmo-temperature_2m.bin',dtype='<f4').reshape(yr['end']-yr['start'],xr['end']-xr['start'])
 ys=g['latMin']+np.arange(yr['start'],yr['end'])*g['dy'];xs=g['lonMin']+np.arange(xr['start'],xr['end'])*g['dx'];sample=RegularGridInterpolator((ys,xs),a,bounds_error=True)
 svg=['<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="880" viewBox="0 0 1400 880">'];audit=[]
 for name,lo,la in points:
  value=float(sample([[la,lo]])[0]);assert np.isfinite(value);label=f'{math.floor(value+.5)}°';x=(lo+13)/37*1400+7;y=(merc(62)-merc(la))/(merc(62)-merc(42))*880+19
  svg.append(f'<text x="{x:.1f}" y="{y:.1f}" font-family="Arial,sans-serif" font-size="19" font-weight="700" fill="#b32235" stroke="white" stroke-width="4" stroke-linejoin="round" paint-order="stroke">{label}</text>')
  audit.append({'place':name,'lat':la,'lon':lo,'temperature_c':round(value,1),'valid':frame['valid']})
 svg.append('</svg>');(O/f'{day}-values.svg').write_text(''.join(svg));(O/f'{day}-values.json').write_text(json.dumps(audit,indent=2))
print('30 temperatuurwaarden uit dezelfde UKMO-velden als de kaart.')
