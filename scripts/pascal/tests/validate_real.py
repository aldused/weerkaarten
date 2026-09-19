"""Independent raw-field checks against serialized native probabilities."""
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo
import json,numpy as np
root=Path(__file__).resolve().parents[1]
checked=0
for name,suffix in [('ifs','grib'),('harm','harmoneps'),('icon','icond2eps')]:
 z=np.load(root/f'{name}_decoded.npz');m=json.loads(str(z['metadata']));out=json.loads((root/f'pascal_real_{suffix}.json').read_text())
 times=[datetime.fromisoformat(t) for t in m['times']]
 for area in ['Nederland','Zuid-Holland','Waddeneilanden']:
  series=out['nederland'] if area=='Nederland' else out['provinces'][area]
  for cid,values in series.items():
   spec=('vis',int(cid[3:]),True) if cid.startswith('vis') else ('gust',int(cid[4:]),False) if cid.startswith('gust') else ('wind',int(cid[4:]),False) if cid.startswith('wind') else ('t2m',int(cid[1:]),False) if cid.startswith('t') and cid!='thunder' else None
   if not spec:continue
   var,threshold,below=spec
   for day,p in zip(out['days'],values):
    idx=[i for i,t in enumerate(times) if t.astimezone(ZoneInfo('Europe/Amsterdam')).date().isoformat()==day]
    a=z[var][:,idx][:,:,m['areas'][area]]
    assert np.isfinite(a).all(),(name,area,cid,day)
    hits=(a<=threshold if below else a>=threshold).any(axis=(1,2))
    expected=100*sum(hits)/len(hits)
    assert p is not None and abs(p-expected)<1e-10,(name,area,cid,day,p,expected)
    diag=out['diagnostics'][area][cid][out['days'].index(day)]
    assert diag['hits']==sum(hits) and diag['members']==len(hits)
    checked+=1
print('PASS',checked,'raw native field → JSON probabilities/hits/member counts, three regions and all native days')
