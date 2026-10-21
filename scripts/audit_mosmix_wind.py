#!/usr/bin/env python3
"""Read-only validation of every available regional MOS/MIX hourly feed."""
import argparse,json,math
from collections import Counter
from datetime import datetime
from pathlib import Path

def audit(root):
    result=[]
    for path in sorted(root.glob('mosmix_uurlijks_*.json')):
        data=json.loads(path.read_text());issues=[];counts=Counter();steps=Counter()
        for name,s in data.get('data',{}).items():
            times=s.get('tijden_utc',[])
            if len(times)!=len(s.get('tijden',[])):issues.append({'station':name,'problem':'UTC-tijdas ontbreekt of wijkt af'})
            parsed=[datetime.fromisoformat(t.replace('Z','+00:00')) for t in times]
            for a,b in zip(parsed,parsed[1:]):steps[(b-a).total_seconds()/3600]+=1
            if any(b<=a for a,b in zip(parsed,parsed[1:])):issues.append({'station':name,'problem':'dubbele/ongeordende UTC-tijden'})
            for field in ['FF','FX1','DD']:
                values=s.get(field,[])
                if len(values)!=len(times):issues.append({'station':name,'problem':'verkeerde veldlengte','field':field})
                for i,v in enumerate(values):
                    if v is None:counts[field+'_missing']+=1;continue
                    if isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) or v<0 or field=='DD' and v>360:issues.append({'station':name,'field':field,'index':i,'problem':'ongeldige waarde'})
                    else:counts[field+'_values']+=1
        result.append({'region':path.stem.removeprefix('mosmix_uurlijks_'),'run':data.get('run'),'stations':len(data.get('data',{})),'source_steps_hours':dict(steps),'counts':dict(counts),'issues':issues})
    return result
if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--source',type=Path,required=True);args=ap.parse_args();report=audit(args.source);print(json.dumps(report,ensure_ascii=False,indent=2));raise SystemExit(bool(any(r['issues'] for r in report)))
