#!/usr/bin/env python3
"""Migrate only daily wind fields from already published hourly station forecasts.
No extra DWD requests, no changes to source hours or non-wind parameters.
Run with --source /path/to/live/weerlab --output /path/to/staging.
"""
import argparse,json
from datetime import datetime
from pathlib import Path
from mosmix_wind import aggregate_wind

def rebuild(daily,hourly):
    if daily.get('run')!=hourly.get('run'):raise ValueError('Dag- en uurbron hebben verschillende nieuwste runs')
    changes=0
    for name,s in hourly.get('data',{}).items():
        times=s.get('tijden_utc')
        if not times or len(times)!=len(s.get('tijden',[])):raise ValueError('UTC-brontijden ontbreken: '+name)
        n=len(times);ff=[v/3.6 if isinstance(v,(int,float)) and not isinstance(v,bool) else None for v in s.get('FF',[])];fx=[v/3.6 if isinstance(v,(int,float)) and not isinstance(v,bool) else None for v in s.get('FX1',[])]
        result=aggregate_wind([datetime.fromisoformat(t.replace('Z','+00:00')) for t in times],ff,s.get('DD',[]),fx)
        for day,values in result.items():
            target=daily.get('data',{}).get(day.isoformat())
            if target is None:continue
            for key,value in values.items():
                old=target.setdefault(key,{}).get(name)
                if value is None:target[key].pop(name,None)
                else:target[key][name]=value
                changes+=old!=value
    daily['runs']=hourly.get('runs',{});daily['wind_definition']='ff-point-mean_fx1-end-interval_v2'
    return changes

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--source',type=Path,required=True);ap.add_argument('--output',type=Path,required=True);args=ap.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    for hourly_path in sorted(args.source.glob('mosmix_uurlijks_*.json')):
        region=hourly_path.stem.removeprefix('mosmix_uurlijks_');path=args.source/f'mosmix_{region}.json'
        if not path.exists():continue
        daily=json.loads(path.read_text());hourly=json.loads(hourly_path.read_text());changed=rebuild(daily,hourly)
        (args.output/path.name).write_text(json.dumps(daily,ensure_ascii=False));(args.output/hourly_path.name).write_text(json.dumps(hourly,ensure_ascii=False));print(region,len(hourly['data']),changed,'windwaarden bijgewerkt')
if __name__=='__main__':main()
