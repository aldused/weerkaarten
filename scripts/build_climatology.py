"""Build calendar climatology from Weerlab daily archives; no synthetic data."""
import calendar, datetime as dt, hashlib, json, pathlib, sys

def build(path):
    raw=path.read_bytes(); source=json.loads(raw); cols=source['columns']; rows=[dict(zip(cols,r)) for r in source['data'] if '1991-01-01'<=r[0]<='2020-12-31']
    days=[(dt.date(2001,1,1)+dt.timedelta(days=i)).strftime('%m-%d') for i in range(365)]
    series={k:[] for k in ['tg','tx','tn','rr']}; counts={k:[] for k in series}
    for day in days:
        for k in series:
            vals=[r[k] for r in rows if r['date'][5:]==day and isinstance(r.get(k),(int,float))]
            counts[k].append(len(vals)); series[k].append(sum(vals)/len(vals) if len(vals)>=24 else None)
    monthly=[]
    for m in range(1,13):
        sums=[]; wet={t:[] for t in [0.1,1,10]}
        for y in range(1991,2021):
            rr=[r.get('rr') for r in rows if r['date'].startswith(f'{y}-{m:02}')]
            if len(rr)==calendar.monthrange(y,m)[1] and all(isinstance(v,(int,float)) for v in rr):
                sums.append(sum(rr))
                for t in wet: wet[t].append(sum(v>=t for v in rr))
        monthly.append({'mm':sum(sums)/len(sums) if len(sums)>=24 else None,'years':len(sums),'wet':{str(t):sum(v)/len(v) if len(v)>=24 else None for t,v in wet.items()}})
    return {'station':source['station'],'name':source['naam'],'period':'1991–2020','source':path.name,'sha256':hashlib.sha256(raw).hexdigest(),'days':days,'series':series,'counts':counts,'monthly':monthly}
if __name__=='__main__':
    root=pathlib.Path(sys.argv[1]); out=pathlib.Path(sys.argv[2]); out.mkdir(exist_ok=True)
    for station in [260,240,280,310,380]:
        p=root/f'klimaatarchief_data_{station}.json'
        (out/f'{station}.json').write_text(json.dumps(build(p),ensure_ascii=False,separators=(',',':')))
