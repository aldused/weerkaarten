"""Lambert Conformal Conic op de bol, in km.

Exact dezelfde formules staan in web/js/lcc.js en in de fragment-shader
(web/js/renderer.js). Server en browser projecteren dus identiek: kust,
isobaren en weervelden vallen pixelzuiver op elkaar.
"""
import numpy as np

R = 6371.0          # km
LAT1, LAT2 = 40.0, 60.0
LAT0, LON0 = 52.0, 10.0

_p1, _p2, _p0 = np.radians([LAT1, LAT2, LAT0])
N = np.log(np.cos(_p1) / np.cos(_p2)) / np.log(np.tan(np.pi / 4 + _p2 / 2) / np.tan(np.pi / 4 + _p1 / 2))
F = np.cos(_p1) * np.tan(np.pi / 4 + _p1 / 2) ** N / N
RHO0 = R * F / np.tan(np.pi / 4 + _p0 / 2) ** N


def params():
    return {'R': R, 'lat1': LAT1, 'lat2': LAT2, 'lat0': LAT0, 'lon0': LON0,
            'n': float(N), 'F': float(F), 'rho0': float(RHO0)}


def forward(lon, lat):
    lon = np.asarray(lon, dtype=np.float64)
    lat = np.asarray(lat, dtype=np.float64)
    rho = R * F / np.tan(np.pi / 4 + np.radians(lat) / 2) ** N
    th = N * np.radians(((lon - LON0 + 180) % 360) - 180)
    return rho * np.sin(th), RHO0 - rho * np.cos(th)


def inverse(x, y):
    x = np.asarray(x, dtype=np.float64)
    y = np.asarray(y, dtype=np.float64)
    dy = RHO0 - y
    rho = np.sign(N) * np.hypot(x, dy)
    th = np.arctan2(x, dy)
    lon = LON0 + np.degrees(th / N)
    lat = np.degrees(2 * np.arctan((R * F / rho) ** (1 / N)) - np.pi / 2)
    return lon, lat
