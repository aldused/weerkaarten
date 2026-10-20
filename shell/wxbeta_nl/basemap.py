"""Geographic Netherlands basemap, following the MOS/MIX map extent and water style."""
from functools import lru_cache
from pathlib import Path
import json
import numpy as np
from shapely import make_valid
from shapely.geometry import shape,box,Polygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

ROOT=Path(__file__).resolve().parents[2]
BOUNDS=(3.3,7.4,50.45,53.8)
WATER='#c8e0f0'


def polygons(geometry):
    if geometry.geom_type=='Polygon':
        yield orient(geometry,sign=1)
    elif hasattr(geometry,'geoms'):
        for member in geometry.geoms:
            yield from polygons(member)


@lru_cache(maxsize=1)
def geography():
    land=unary_union([p for f in json.loads((ROOT/'nl_land_detail.geojson').read_text())['features'] for p in polygons(make_valid(shape(f['geometry'])))])
    context=shape(json.loads((ROOT/'nl_omgeving_detail.geojson').read_text())['features'][0]['geometry'])
    inland_water=unary_union([Polygon(ring) for polygon in polygons(land) for ring in polygon.interiors])
    context=context.difference(inland_water)
    provinces=[make_valid(shape(f['geometry'])).intersection(land) for f in json.loads((ROOT/'nl_provincies.geojson').read_text())['features']]
    rivers=[shape(f['geometry']).intersection(land) for f in json.loads((ROOT/'nl_rivieren.geojson').read_text())['features']]
    return land,context,provinces,rivers


def geometry_path(geometry):
    from matplotlib.path import Path as MplPath
    paths=[]
    for polygon in polygons(geometry):
        for ring in [polygon.exterior,*polygon.interiors]:
            coordinates=np.asarray(ring.coords)
            codes=np.full(len(coordinates),MplPath.LINETO,dtype=np.uint8)
            codes[0]=MplPath.MOVETO;codes[-1]=MplPath.CLOSEPOLY
            paths.append(MplPath(coordinates,codes))
    return MplPath.make_compound_path(*paths)


def setup(ax):
    from matplotlib.patches import PathPatch
    land,context,_,_=geography()
    ax.set_facecolor(WATER)
    ax.add_patch(PathPatch(geometry_path(context),facecolor='#edf1e9',edgecolor='none',zorder=.1))
    clip=PathPatch(geometry_path(land),transform=ax.transData)
    return clip


def outlines(ax):
    from matplotlib.patches import PathPatch
    from matplotlib.collections import LineCollection
    land,_,provinces,rivers=geography()
    for province in provinces:
        ax.add_patch(PathPatch(geometry_path(province),facecolor='none',edgecolor='#60777f',linewidth=.45,zorder=5))
    ax.add_patch(PathPatch(geometry_path(land),facecolor='none',edgecolor='#243e49',linewidth=1.05,zorder=6))
    def lines(geometry):
        if geometry.geom_type=='LineString':yield np.asarray(geometry.coords)
        elif hasattr(geometry,'geoms'):
            for child in geometry.geoms:yield from lines(child)
    ax.add_collection(LineCollection([line for river in rivers for line in lines(river)],colors='#72a6c6',linewidths=.65,zorder=5.5))
