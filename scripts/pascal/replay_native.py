"""Replay archived decoded native fields without another network download."""
import json
from pathlib import Path
from datetime import datetime
import numpy as np
from native import calculate
HERE=Path(__file__).parent

def replay(name):
    archive=np.load(HERE/f'{name}_decoded.npz');meta=json.loads(str(archive['metadata']))
    fields={k:archive[k] for k in archive.files if k!='metadata'}
    times=[datetime.fromisoformat(t) for t in meta['times']]
    run=datetime.strptime(meta['run'],'%Y%m%d%HZ').replace(tzinfo=times[0].tzinfo)
    tolerance=meta.get('rain_tolerance',0)
    if name=='harm': tolerance=max(.01,tolerance)
    cadence=[3 if (t-run).total_seconds()/3600<=144 else 6 for t in times] if name=='ifs' else 1
    result=calculate(fields,times,meta['areas'],run,meta['member_ids'],cadence,tolerance)
    result.update({k:meta[k] for k in ['run','fetched_at','source']})
    result['rain_tolerance_mm']=tolerance
    filename={'harm':'harmoneps','icon':'icond2eps','ifs':'grib'}[name]
    (HERE/f'pascal_real_{filename}.json').write_text(json.dumps(result,allow_nan=False))
    return result
if __name__=='__main__':
    import sys
    for name in sys.argv[1:]:
        r=replay(name);print(name,r['nederland'].get('rr10',r['nederland'].get('vis500')))
