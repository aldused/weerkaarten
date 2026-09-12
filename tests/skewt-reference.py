"""Independent MetPy oracle for the browser's sounding calculations (stdin JSON)."""
import json
import sys
import numpy as np
import metpy.calc as mp
from metpy.units import units


def number(q):
    v = float(np.asarray(q.magnitude).reshape(-1)[0])
    return v if np.isfinite(v) else None


out = []
for case in json.load(sys.stdin):
    g = case["grid"]
    p = np.array([s["p"] for s in g]) * units.hPa
    t = np.array([s["t"] for s in g]) * units.degC
    td = np.array([s["td"] for s in g]) * units.degC
    mlp, mlt, mltd = mp.mixed_parcel(p, t, td, depth=100 * units.hPa)
    mup, mut, mutd, _ = mp.most_unstable_parcel(p, t, td, depth=300 * units.hPa)
    results = {}
    for key, launch_p, launch_t, launch_td in [
        ("sb", p[0], t[0], td[0]), ("ml", mlp, mlt, mltd), ("mu", mup, mut, mutd)
    ]:
        # Compare against the same environmental column, including the mixed layer.
        # Replace only launch T/Td so MetPy uses the intended parcel humidity.
        mask = (p <= launch_p) & (p >= 100 * units.hPa)
        pp, tt, dd = p[mask], t[mask].copy(), td[mask].copy()
        tt[0], dd[0] = launch_t, launch_td
        profile = mp.parcel_profile(pp, launch_t, launch_td)
        cape, cin = mp.cape_cin(pp, tt, dd, profile)
        lp, lt = mp.lcl(launch_p, launch_t, launch_td)
        results[key] = dict(cape=number(cape), cin=number(cin), lclP=number(lp),
                            startP=number(launch_p), li=number(mp.lifted_index(pp, tt, profile)))
    dc, _, _ = mp.downdraft_cape(p, t, td)
    results.update(mlT=number(mlt), mlTd=number(mltd),
                   dcape=number(dc), pw=number(mp.precipitable_water(p, td)),
                   wetbulb=number(mp.wet_bulb_temperature(p[0], t[0], td[0])))
    out.append(results)
json.dump(out, sys.stdout)
