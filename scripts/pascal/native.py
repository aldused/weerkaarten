"""Common native-grid calculation and auditable JSON diagnostics."""
from datetime import timedelta
import numpy as np
from engine import evaluate, rolling, convection
from probability import METHOD_VERSION, LOCAL_TZ


def calculate(fields, times, areas, run, member_ids, cadence=1, rain_tolerance=0):
    # Fields have canonical units: wind km/h, temperature C, precip mm, visibility m.
    f=dict(fields)
    if 'tp' in f:
        f['rain24']=rolling(f['tp'],times,24,True,run,rain_tolerance)
        if 'cape' in f: f['proxy']=convection(f['cape'],rolling(f['tp'],times,6,True,run,rain_tolerance),times,max(cadence) if isinstance(cadence,list) else cadence)
    specs=[('gust'+str(t),'gust',t,False) for t in [60,75,100]]
    specs += [('wind'+str(t),'wind',t,False) for t in [40,60]]
    specs += [('rr'+str(t),'rain24',t,False) for t in [10,25,50,75]]
    specs += [('t'+str(t),'t2m',t,False) for t in [25,27,30,35,40]]
    specs += [('vis'+str(t),'vis',t,True) for t in [500,200,50]]
    specs += [('thunder','proxy',500,False),('svr','proxy',1500,False)]
    days=sorted({t.astimezone(LOCAL_TZ).date() for t in times})
    out=dict(method_version=METHOD_VERSION,window_policy='available_local_samples_explicit_coverage',
             days=[d.isoformat() for d in days],n_members=len(member_ids),provinces={},nederland={},diagnostics={})
    for area,idx in areas.items():
        values={};diags={}
        for cid,key,thr,below in specs:
            if key not in f:continue
            results=[]
            for d in days:
                step=max((cadence[i] for i,t in enumerate(times) if t.astimezone(LOCAL_TZ).date()==d),default=1) if isinstance(cadence,list) else cadence
                results.append(evaluate(f[key][:,:,idx],times,d,thr,below,step,member_ids))
            values[cid]=[r['p'] for r in results];diags[cid]=results
        out['diagnostics'][area]=diags
        if area=='Nederland':out['nederland']=values
        else:out['provinces'][area]=values
    return out
