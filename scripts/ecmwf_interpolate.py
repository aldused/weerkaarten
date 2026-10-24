"""Mass-conserving, member-wise interpolation of ECMWF ensemble point arrays."""
import numpy as np
from scipy.interpolate import interp1d

def hourly_ensemble(fields,steps):
    steps=np.asarray(steps,dtype=int)
    if steps[0]!=0 or len(steps)<2 or np.any(np.diff(steps)<=0):raise ValueError('Invalid native lead times')
    hours=np.arange(0,int(steps[-1])+1)
    out={}
    def linear(a):return interp1d(steps,np.asarray(a,dtype='float64'),axis=-1,bounds_error=True)(hours)
    for field,a in fields.items():
        if field in ['precipitation','snowfall']:
            cumulative=np.cumsum(a,axis=-1,dtype='float64')
            interp=linear(cumulative)
            out[field]=np.diff(interp,axis=-1,prepend=np.zeros_like(interp[...,:1]))
            if np.min(out[field]) < -1e-8:raise ValueError('Negative interpolated accumulation')
            out[field]=np.maximum(out[field],0)
            if not np.allclose(out[field].sum(axis=-1),a.sum(axis=-1),atol=1e-6):raise ValueError('Accumulation is not conserved')
        elif field not in ['wind_speed_10m','wind_direction_10m']:
            out[field]=linear(a)
    if 'wind_speed_10m' in fields:
        angle=np.deg2rad(fields['wind_direction_10m']);speed=np.asarray(fields['wind_speed_10m'])
        u=linear(-speed*np.sin(angle));v=linear(-speed*np.cos(angle))
        out['wind_speed_10m']=np.hypot(u,v)
        out['wind_direction_10m']=(np.rad2deg(np.arctan2(-u,-v))+360)%360
    if any(np.any(~np.isfinite(a)) for a in out.values()):raise ValueError('Missing ensemble values')
    return out,tuple(int(h) for h in hours)
