"""DWD FF/DD point forecasts and FX1 preceding-hour maxima; no synthetic hours."""
import json, math
from datetime import datetime,time,timedelta,timezone
from pathlib import Path
from zoneinfo import ZoneInfo
CONFIG=json.loads((Path(__file__).resolve().parents[1]/'mosmix-periods.json').read_text())
_parts=sorted(CONFIG['parts'],key=lambda p:p['start'])
if (CONFIG['timezone']!='Europe/Amsterdam' or {p['id'] for p in _parts}!={'nacht','ochtend','middag','avond'} or _parts[0]['start']!=0 or _parts[-1]['end']!=24 or any(not isinstance(p['start'],int) or not isinstance(p['end'],int) or p['end']<=p['start'] or i and p['start']!=_parts[i-1]['end'] for i,p in enumerate(_parts))):
    raise ValueError('Dagdeelgrenzen moeten de Nederlandse kalenderdag precies bedekken')
NL=ZoneInfo(CONFIG['timezone']);UTC=timezone.utc
PARTS={p['id']:p for p in CONFIG['parts']}
def valid(value):return isinstance(value,(int,float)) and not isinstance(value,bool) and math.isfinite(value) and value>=0

def representative(speeds,directions):
    if not speeds or not all(valid(v) for v in speeds):return None,None
    mean=sum(speeds)/len(speeds)
    moving=[(s,d) for s,d in zip(speeds,directions) if s>0]
    if not moving:return round(mean*3.6,1),None
    if any(not valid(d) or d>360 for _,d in moving):return round(mean*3.6,1),None
    u=sum(-s*math.sin(math.radians(d)) for s,d in moving)
    v=sum(-s*math.cos(math.radians(d)) for s,d in moving)
    direction=None if math.hypot(u,v)<.15*sum(s for s,_ in moving) else round(math.degrees(math.atan2(-u,-v))%360)%360
    return round(mean*3.6,1),direction

def window(day,start,end):
    beginning=datetime.combine(day,time(start),NL).astimezone(UTC)
    ending=datetime.combine(day+timedelta(days=end//24),time(end%24),NL).astimezone(UTC)
    return beginning,ending

def aggregate_wind(times,ff,dd,fx):
    """FF is a mean of instantaneous 10m forecasts; FX is a separate maximum.
    Point samples use [start,end), preceding-hour gusts use (start,end].
    Legacy night is evening plus the following morning (18–06), never two nights.
    """
    index={}
    for i,value in enumerate(times):
        t=value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
        if t in index:raise ValueError('Dubbel UTC-tijdstip in MOS/MIX')
        index[t]=(ff[i] if i<len(ff) else None,dd[i] if i<len(dd) else None,fx[i] if i<len(fx) else None)
    output={}
    for day in sorted({t.astimezone(NL).date() for t in index}):
        result={}
        windows={'':(PARTS['ochtend']['start'],PARTS['middag']['end']),'_O':(PARTS['ochtend']['start'],PARTS['ochtend']['end']),'_M':(PARTS['middag']['start'],PARTS['middag']['end']),'_N':(PARTS['avond']['start'],24+PARTS['nacht']['end'])}
        for suffix,(start,end) in windows.items():
            a,b=window(day,start,end);points=[];gusts=[];t=a
            while t<b:
                points.append(index.get(t,(None,None,None)));gusts.append(index.get(t+timedelta(hours=1),(None,None,None))[2]);t+=timedelta(hours=1)
            mean,direction=representative([v[0] for v in points],[v[1] for v in points])
            result['FF'+suffix]=mean;result['DD'+suffix]=direction
            result['FX'+suffix]=round(max(gusts)*3.6,1) if gusts and all(valid(v) for v in gusts) else None
        output[day]=result
    return output
