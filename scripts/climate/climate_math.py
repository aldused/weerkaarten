"""Reproduceerbare berekeningen; geen aanvulling van ontbrekende waarnemingen."""
from calendar import isleap, monthrange
from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
import math
import statistics

SEASONS = ['DJF','JFM','FMA','MAM','AMJ','MJJ','JJA','JAS','ASO','SON','OND','NDJ']

def month_shift(d, n):
    total = d.year * 12 + d.month - 1 + n
    y, m = divmod(total, 12)
    return date(y, m + 1, min(d.day, monthrange(y, m + 1)[1]))

def official_round(value):
    return float(Decimal(str(value)).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP))

def difference(value, baseline):
    if value is None or baseline is None:
        return {'absolute': None, 'percent': None}
    return {'absolute': value - baseline, 'percent': (value - baseline) / baseline * 100 if baseline else None}

def quantile(values, p):
    values = sorted(values)
    if not values: return None
    pos = (len(values) - 1) * p
    lo, hi = math.floor(pos), math.ceil(pos)
    return values[lo] + (values[hi] - values[lo]) * (pos - lo)

def episodes(rows):
    """CPC historique criteria: rounded index, five consecutive overlapping seasons.

    Parse the entire history first, so episodes crossing January 2000 retain their
    true start. Durations count centre months, not the sum of overlapping windows.
    This is an index-based history, not a diagnostic advisory.
    """
    out, run, phase, previous = [], [], 0, None
    def finish(ongoing=False):
        if len(run) < 5: return
        peak = max(run, key=lambda r: abs(r['value']))
        if run[-1]['date'] < '2000-01-01': return
        out.append({'id':run[0]['date'], 'phase':'El Niño' if phase == 1 else 'La Niña',
                    'start':run[0]['date'], 'end':run[-1]['date'], 'start_period':run[0]['period'],
                    'end_period':run[-1]['period'], 'duration':len(run), 'ongoing':ongoing,
                    'peak':peak['value'], 'peak_date':peak['date'], 'peak_period':peak['period'],
                    'mean':statistics.mean(r['value'] for r in run), 'values':list(run),
                    'growth_months':next(i for i,r in enumerate(run) if r is peak),
                    'growth_rate':(peak['value']-run[0]['value']) / max(1,next(i for i,r in enumerate(run) if r is peak)),
                    'decay_months':len(run)-1-next(i for i,r in enumerate(run) if r is peak)})
    for r in sorted(rows, key=lambda x:x['date']):
        d=date.fromisoformat(r['date'])
        v=r.get('official_value',official_round(r['value'])) if r['value'] is not None else None
        new=1 if v is not None and v>=0.5 else -1 if v is not None and v<=-0.5 else 0
        if previous and (month_shift(previous,1)!=d or phase!=new):
            finish(); run=[]
        phase=new
        if new:run.append(r)
        previous=d
    finish(ongoing=bool(run))
    return out

def valid_day(r):
    return r['value'] is not None and r.get('missing',0)==0

def full_years(rows, today, daily=True):
    groups=defaultdict(set)
    for r in rows:
        if valid_day(r):groups[int(r['date'][:4])].add(r['date'])
    return sorted(y for y, dates in groups.items() if y>=2000 and y<today.year and
                  len(dates)==((366 if isleap(y) else 365) if daily else 12))

def calendar_reference(rows, start=1981, end=2010):
    groups=defaultdict(list)
    for r in rows:
        if start<=int(r['date'][:4])<=end and valid_day(r):groups[r['date'][5:]].append(r['value'])
    return {key:{'mean':statistics.mean(v),'median':statistics.median(v),'p10':quantile(v,.1),
                 'p90':quantile(v,.9),'n':len(v)} for key,v in groups.items()}

def extremes(rows, today):
    complete=set(full_years(rows,today))
    groups=defaultdict(list)
    for r in rows:
        if int(r['date'][:4])>=2000 and valid_day(r):groups[int(r['date'][:4])].append(r)
    out=[]
    for y, rs in sorted(groups.items()):
        minimum=min(r['value'] for r in rs);maximum=max(r['value'] for r in rs)
        out.append({'year':y,'complete':y in complete,'days':len(rs),'min':minimum,'max':maximum,
                    'min_dates':[r['date'] for r in rs if r['value']==minimum],
                    'max_dates':[r['date'] for r in rs if r['value']==maximum]})
    for r in out:
        for key in ['min','max']:
            others=[x[key] for x in out if x['complete']]
            r[key+'_rank']=1+sum(v<r[key] for v in others) if r['complete'] else None
            prev=next((x for x in out if x['year']==r['year']-1 and x['complete']),None)
            r[key+'_previous']=difference(r[key],prev[key]) if r['complete'] and prev else difference(None,None)
    return out

def trend(points, reference):
    """OLS with Newey-West/Bartlett HAC, lag 3 years, Student-t approximation.

    Only contiguous annual samples, one calendar month per series. No daily fit.
    """
    import numpy as np
    from scipy.stats import t
    points=sorted(points)
    if len(points)<10 or any(b[0]-a[0]!=1 for a,b in zip(points,points[1:])):return None
    x=np.array([p[0] for p in points],dtype=float);y=np.array([p[1] for p in points])
    X=np.column_stack([np.ones(len(x)),x-x.mean()]);inv=np.linalg.inv(X.T@X)
    beta=inv@X.T@y;res=y-X@beta;z=X*res[:,None];meat=z.T@z
    for lag in range(1,4):
        cross=z[lag:].T@z[:-lag];meat+=(1-lag/4)*(cross+cross.T)
    cov=inv@meat@inv*len(x)/(len(x)-2)
    se=math.sqrt(max(0,float(cov[1,1])));margin=float(t.ppf(.975,len(x)-2))*se
    slope=float(beta[1])*10
    return {'start':points[0][0],'end':points[-1][0],'n':len(points),'per_decade':slope,
            'percent_per_decade':slope/reference*100 if reference else None,
            'reference':reference,'ci95':[(float(beta[1])-margin)*10,(float(beta[1])+margin)*10],
            'method':'OLS · Newey–West HAC (3 jaar) · benaderend 95%-interval',
            'fit':[[int(a),float(beta[0]+beta[1]*(a-x.mean()))] for a in x]}

def ice_analysis(daily, monthly, today):
    ref=calendar_reference(daily);monthly_ref=calendar_reference(monthly)
    complete=full_years(daily,today);complete_monthly=full_years(monthly,today,daily=False)
    valid=[r for r in daily if valid_day(r)]
    latest=valid[-1];d=date.fromisoformat(latest['date']);md=latest['date'][5:]
    index={r['date']:r for r in valid};same=[r for r in valid if r['date'][5:]==md and 2000<=int(r['date'][:4])<d.year]
    comparisons=[]
    def add(label,v,n,years=None):
        comparisons.append({'label':label,'baseline':v,'n':n,'years':years,**difference(latest['value'],v)})
    for offset in [1,2,3]:
        try:prev=d.replace(year=d.year-offset);r=index.get(prev.isoformat())
        except ValueError:r=None
        add(str(d.year-offset),r['value'] if r else None,1 if r else 0)
    for label,years in [('Laatste vijf volledige jaren',complete[-5:]),('Gemiddelde sinds 2000',complete)]:
        vals=[r['value'] for r in same if int(r['date'][:4]) in years]
        add(label,statistics.mean(vals) if vals else None,len(vals),years)
    rr=ref.get(md,{})
    add('Mediaan 1981–2010',rr.get('median'),rr.get('n',0))
    add('Gemiddelde 1981–2010',rr.get('mean'),rr.get('n',0))
    add('Laagste op deze kalenderdag sinds 2000',min((r['value'] for r in same),default=None),len(same))
    add('Hoogste op deze kalenderdag sinds 2000',max((r['value'] for r in same),default=None),len(same))
    sameall=same+[latest];rank=1+sum(r['value']<latest['value'] for r in same)
    changes={}
    for n in [7,30]:
        prev=index.get((d-timedelta(days=n)).isoformat());changes[str(n)]=difference(latest['value'],prev['value'] if prev else None)
    monthly_out=[];mi={r['date']:r for r in monthly}
    for r in monthly:
        if r['date']<'2000-01-01':continue
        baseline=monthly_ref.get(r['date'][5:],{}).get('mean');prev=mi.get(month_shift(date.fromisoformat(r['date']),-12).isoformat())
        monthly_out.append({**r,'anomaly':difference(r['value'],baseline),'previous':difference(r['value'],prev['value'] if prev else None)})
    trends=[]
    for m in range(1,13):
        values=[(int(r['date'][:4]),r['value']) for r in monthly if int(r['date'][:4]) in complete_monthly and int(r['date'][5:7])==m]
        baseline=monthly_ref.get(f'{m:02d}-01',{}).get('mean')
        trends.append({'month':m,'result':trend(values,baseline)})
    annual=[]
    for y in complete_monthly:
        annual.append((y,statistics.mean(r['value'] for r in monthly if r['date'].startswith(str(y)))))
    baseline=statistics.mean(v['mean'] for v in monthly_ref.values()) if len(monthly_ref)==12 else None
    hist=calendar_reference([r for r in daily if int(r['date'][:4]) in complete],2000,today.year-1)
    # Historical envelope is min/max, not percentiles.
    for key in hist:
        vals=[r['value'] for r in valid if r['date'][5:]==key and int(r['date'][:4]) in complete]
        hist[key]={'min':min(vals),'max':max(vals),'n':len(vals)}
    return {'latest':latest,'reference':ref,'monthly_reference':monthly_ref,'historical_envelope':hist,
            'comparisons':comparisons,'rank':rank,'rank_n':len(sameall),'changes':changes,
            'complete_years':complete,'complete_monthly_years':complete_monthly,'extremes':extremes(daily,today),
            'monthly':monthly_out,'trends':trends,'annual_trend':trend(annual,baseline)}
