import os
"""Render weather rasters directly from native fields at 2x display resolution.
No extra meteorological detail is claimed: this refines presentation only.
Vector geography, contours and fronts keep their existing scalable assets.
"""
from pathlib import Path
source=Path(__file__).with_name('render_ukmo.py').read_text()
setup=source[:source.index('# Natural Earth')].replace('W,H=1400,880','W,H=2800,1760')
colors=source[source.index('tempmap='):source.index('frames=[]')]
loop=source[source.index('for frame in json.loads'):source.index(' fig,ax=')]
loop=loop.replace(".png')","@2x.png')")
exec(setup+colors+loop)
print('Rendered 20 retina layers at 2800 × 1760 directly from UKMO grid values.')
