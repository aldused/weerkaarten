"""Open-Meteo members → canonical per-model probabilities and coverage diagnostics."""
import json
from pathlib import Path
from datetime import datetime, timezone
import numpy as np
from probability import METHOD_VERSION, LOCAL_TZ
from engine import evaluate, rolling, convection
HERE=Path(__file__).parent

CRITERIA = [
    {"id":"gust60",  "var":"wind_gusts_10m",  "thr":60,  "mode":"day-max"},
    {"id":"gust75",  "var":"wind_gusts_10m",  "thr":75,  "mode":"day-max"},
    {"id":"gust100", "var":"wind_gusts_10m",  "thr":100, "mode":"day-max"},
    {"id":"rr10",    "var":"precipitation",   "thr":10,  "mode":"rolling-24h-sum"},
    {"id":"rr25",    "var":"precipitation",   "thr":25,  "mode":"rolling-24h-sum"},
    {"id":"rr50",    "var":"precipitation",   "thr":50,  "mode":"rolling-24h-sum"},
    {"id":"rr75",    "var":"precipitation",   "thr":75,  "mode":"rolling-24h-sum"},
    # thr_precip 2 mm (was 0.5): zelfde aanscherping als de grib-route (4jul'26)
    {"id":"thunder", "var":"cape", "thr":500,  "mode":"6h-window-plus-precip", "thr_precip":2.0},
    {"id":"svr",     "var":"cape", "thr":1500, "mode":"6h-window-plus-precip", "thr_precip":2.0},
    # hit_threshold = kans per lid waarboven we het lid als "vis-hit" markeren
    # Lager → meer gevoelig (ook leden met onzekere mist tellen mee)
    # Hoger → strenger (alleen leden met overtuigende mist-condities)
    {"id":"vis500",  "var":None,              "thr":500, "mode":"fog-mos", "thr_idx":0, "scale":1.0,  "hit_threshold":0.25, "fog_level":"light"},
    {"id":"vis200",  "var":None,              "thr":200, "mode":"fog-mos", "thr_idx":1, "scale":1.0,  "hit_threshold":0.30, "fog_level":"medium"},
    {"id":"vis50",   "var":None,              "thr":50,  "mode":"fog-mos", "thr_idx":2, "scale":0.4,  "hit_threshold":0.10, "fog_level":"dense"},
    {"id":"t25",     "var":"temperature_2m",  "thr":25,  "mode":"day-max"},
    {"id":"t27",     "var":"temperature_2m",  "thr":27,  "mode":"day-max"},
    {"id":"t30",     "var":"temperature_2m",  "thr":30,  "mode":"day-max"},
    {"id":"t35",     "var":"temperature_2m",  "thr":35,  "mode":"day-max"},
    {"id":"t40",     "var":"temperature_2m",  "thr":40,  "mode":"day-max"},
]

def parse_times(time_strs):
    out = []
    for s in time_strs:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        out.append(dt.astimezone(LOCAL_TZ))
    return out

def normalise_field(var, values, units):
    a=np.asarray(values,float)
    if units is None:return a  # Legacy cache used documented API defaults.
    if var.startswith('wind_'):
        if units=='m/s':return a*3.6
        if units=='km/h':return a
    elif var=='temperature_2m':
        if units=='K':return a-273.15
        if units in ('°C','celsius'):return a
    elif var=='precipitation':
        if units=='m':return a*1000
        if units=='mm':return a
    elif var=='cape' and units=='J/kg':return a
    elif var in ('relative_humidity_2m','cloud_cover_low') and units=='%':return a
    return np.full_like(a,np.nan)  # Unknown/undefined unit must not produce a probability.


def process(raw, lr_models=None):
    lr_models = lr_models or {}
    model_results = {}; model_diagnostics = {}
    all_days = set()
    for model, meta in raw['models'].items():
        points = [(area, pt) for area, pts in raw['data'].items() for pt in pts]
        reference = next((pt['models'][model]['hourly']['time'] for _,pt in points if model in pt['models']), [])
        if not reference: continue
        times = parse_times(reference)
        n = meta['n_members']; shape = (n,len(times),len(points))
        def field(var):
            a = np.full(shape,np.nan)
            for j,(_,pt) in enumerate(points):
                h = pt.get('models',{}).get(model,{}).get('hourly',{})
                if h.get('time') != reference: continue
                v = normalise_field(var,h.get(var,[]),pt.get('models',{}).get(model,{}).get('units',{}).get(var))
                if v.shape == shape[:2]: a[:,:,j] = v
            return a
        times_days = sorted({t.date() for t in times}); all_days.update(times_days)
        fields = {v:field(v) for v in ('wind_gusts_10m','wind_speed_10m','temperature_2m','precipitation','cape','relative_humidity_2m','cloud_cover_low')}
        fields['rain24'] = rolling(fields['precipitation'],times,24)
        fields['proxy'] = convection(fields['cape'],rolling(fields['precipitation'],times,6),times)
        areas = {area:[i for i,(a,_) in enumerate(points) if a==area] for area in raw['data']}
        areas['Nederland'] = list(range(len(points)))
        values = {a:{} for a in areas}; diagnostics = {a:{} for a in areas}
        for c in CRITERIA + [{'id':'wind40','var':'wind_speed_10m','thr':40,'mode':'day-max'}, {'id':'wind60','var':'wind_speed_10m','thr':60,'mode':'day-max'}]:
            mode = c['mode']; threshold = c['thr']
            if mode == 'fog-mos':
                lr = lr_models.get(c['id'])
                if not lr: a = np.full(shape,np.nan)
                else:
                    rh=fields['relative_humidity_2m']; wind=fields['wind_speed_10m']; lcc=fields['cloud_cover_low']
                    utc=[t.astimezone(timezone.utc) for t in times]
                    hour=np.array([t.hour for t in utc])[None,:,None]; month=np.array([t.month for t in utc])[None,:,None]
                    feats=[rh,np.maximum(0,rh-90),(rh/100)**2,wind,rh*wind/100,lcc,np.sin(2*np.pi*hour/24),np.cos(2*np.pi*hour/24),np.sin(2*np.pi*(month-1)/12),np.cos(2*np.pi*(month-1)/12)]
                    z=sum(coef*feat for coef,feat in zip(lr['coef'],feats))+lr['intercept']
                    a=1/(1+np.exp(-np.clip(z,-30,30)))*c.get('scale',1)
                threshold=c['hit_threshold']
            else:
                key='rain24' if mode=='rolling-24h-sum' else 'proxy' if mode=='6h-window-plus-precip' else c['var']
                a=fields[key]
            for area,idx in areas.items():
                results=[evaluate(a[:,:,idx],times,day,threshold) for day in times_days]
                diagnostics[area][c['id']] = results
                values[area][c['id']] = [r['p'] for r in results]
        model_results[model]=(times_days,values); model_diagnostics[model]=(times_days,diagnostics)
    days=sorted(all_days)
    out={'method_version':METHOD_VERSION,'window_policy':'available_local_samples_explicit_coverage',
         'fetched_at':raw['fetched_at'],'source':raw['source'],'models':raw['models'],
         'sampling':raw.get('sampling'),'timezone':'Europe/Amsterdam','days':[d.isoformat() for d in days],
         'provinces_per_model':{},'nederland_per_model':{},'diagnostics_per_model':{}}
    for model,(mdays,values) in model_results.items():
        diags=model_diagnostics[model][1]
        out['diagnostics_per_model'][model]={}
        for area,criteria in values.items():
            aligned={cid:[vals[mdays.index(d)] if d in mdays else None for d in days] for cid,vals in criteria.items()}
            out['diagnostics_per_model'][model][area]={cid:[vals[mdays.index(d)] if d in mdays else {'p':None,'reason':'datum buiten verwachtingstermijn','status':'unavailable','members':0} for d in days] for cid,vals in diags[area].items()}
            if area=='Nederland':out['nederland_per_model'][model]=aligned
            else:out['provinces_per_model'].setdefault(model,{})[area]=aligned
    return out

if __name__ == '__main__':
    raw=json.loads((HERE/'om_raw.json').read_text())
    mos_path=HERE/'fog_mos_logreg.json'
    lr={m['label']:m for m in json.loads(mos_path.read_text())['models']} if mos_path.exists() else {}
    out=process(raw,lr)
    target=HERE/'pascal_real.json';temp=target.with_suffix('.json.tmp')
    temp.write_text(json.dumps(out,allow_nan=False));temp.replace(target)
    print('Geschreven:',target)
