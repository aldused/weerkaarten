"""Shared UTC-day aggregation of KNMI observations, with auditable raw storage."""
import json, math, os
from pathlib import Path
from datetime import datetime, timezone, timedelta
from knmi_api import knmi_get
ROOT = Path(__file__).resolve().parents[1]
BASE = 'https://api.dataplatform.knmi.nl/edr/v1/collections/10-minute-in-situ-meteorological-observations'
PARAMS = 'ta,tx,tn,ff,fx,rg,ss,qg,p0,rh'

def aggregate(rows):
    def values(k):
        return [r[k] for r in rows if isinstance(r.get(k),(int,float)) and math.isfinite(r[k])]
    def calc(k, fn):
        v=values(k); return round(fn(v),1) if v else None
    tx=values('tx')+values('ta'); tn=values('tn')+values('ta')
    return {'tx':round(max(tx),1) if tx else None,'tn':round(min(tn),1) if tn else None,
            'tg':calc('ta',lambda v:sum(v)/len(v)), 'fg':calc('ff',lambda v:sum(v)/len(v)),
            'fx':calc('fx',max), 'rh':calc('rg',lambda v:sum(max(0,x) for x in v)/6),
            'sq':calc('ss',lambda v:sum(max(0,x) for x in v)/60),
            'q':calc('qg',lambda v:sum(max(0,x) for x in v)*600/10000),
            'pg':None, 'px':None, 'pn':None}

def fetch_live_day(station, day, wigos):
    cache = ROOT/'data'/'observations'/str(station)/f'{day}.json'
    if os.environ.get('WEERLAB_OBS_SNAPSHOT') == '1' and cache.exists():
        return aggregate(json.loads(cache.read_text())['rows'])
    start=datetime(day.year,day.month,day.day,tzinfo=timezone.utc)
    end=min(datetime.now(timezone.utc),start+timedelta(days=1))
    if end<=start: return None
    r=knmi_get(f'{BASE}/locations/{wigos}',params={'datetime':f'{start:%Y-%m-%dT00:10:00Z}/{end:%Y-%m-%dT%H:%M:%SZ}','parameter-name':PARAMS},timeout=45)
    if r.status_code in (400,404): return None
    r.raise_for_status(); js=r.json()
    if any(x.get('rel')=='next' for x in js.get('links',[])): raise ValueError('Incomplete paginated live day')
    rows={}
    for cov in js.get('coverages',[]):
        if cov.get('eumetnet:locationId')!=wigos: continue
        ts=cov['domain']['axes']['t']['values']; ranges=cov['ranges']
        for i,t in enumerate(ts):
            stamp=datetime.fromisoformat(t.replace('Z','+00:00'))
            if not start<stamp<=end: continue
            row={'time':t}
            for k,block in ranges.items(): row[k]=block['values'][i]
            if t in rows and rows[t]!=row: raise ValueError('Conflicting duplicate observation')
            rows[t]=row
    if not rows: return None
    dest=ROOT/'data'/'observations'/str(station); dest.mkdir(parents=True,exist_ok=True)
    ordered=[rows[t] for t in sorted(rows)]
    payload={'station':station,'date':day.isoformat(),'source':BASE,'last_time':ordered[-1]['time'],'rows':ordered}
    def write(name,obj):
        p=dest/name; tmp=p.with_suffix('.tmp'); tmp.write_text(json.dumps(obj,separators=(',',':'))); os.replace(tmp,p)
    write(f'{day}.json',payload)
    hours={}
    for row in ordered:
        t=datetime.fromisoformat(row['time'].replace('Z','+00:00'))
        h=(t-timedelta(seconds=1)).replace(minute=0,second=0)
        hours.setdefault(h.isoformat(),[]).append(row)
    write(f'{day}_hourly.json',{'station':station,'date':str(day),'hours':[{ 'start':h,'samples':len(rs),'complete':len(rs)==6,**aggregate(rs)} for h,rs in hours.items()]})
    out=aggregate(ordered)
    return out if any(v is not None for v in out.values()) else None
