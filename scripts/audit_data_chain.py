"""Read-only local chain monitor; CDN/source verification is reported separately."""
import argparse
import json
import math
import plistlib
import re
import struct
import subprocess
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

def iso(value):
    return datetime.fromisoformat(value.replace('Z', '+00:00'))

def inspect(root, now):
    checks, issues = [], []
    def issue(kind, file, detail):
        issues.append(dict(kind=kind, file=str(file), detail=detail))
    products = {}
    for p in sorted(root.glob('*.json')):
        try:
            products[p.name] = json.loads(p.read_text(), parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))
        except Exception as exc:
            issue('invalid_json', p.name, str(exc))
    for name, meta in products.items():
        if not isinstance(meta, dict) or not name.endswith('canvas_meta.json'):
            continue
        times = meta.get('tijden', [])
        row = dict(product=name, steps=len(times), run=meta.get('run_utc'), parameters={})
        retired = name in {'arome_fr_canvas_meta.json','ecmwf_canvas_meta.json','ecmwf_nwe_canvas_meta.json','ecmwf_short_canvas_meta.json'}
        row['retired_candidate']=retired
        if not retired:
            freshness=meta.get('source_checked_at') or meta.get('run_utc')
            if not freshness and meta.get('bijgewerkt'):
                try: freshness=datetime.strptime(meta['bijgewerkt'],'%d %b %Y %H:%M').replace(tzinfo=ZoneInfo('Europe/Amsterdam')).isoformat()
                except ValueError: issue('unverified_model_freshness',name,meta.get('bijgewerkt'))
            if freshness:
                stamp=iso(freshness)
                age=(now-stamp).total_seconds()/3600
                row['source_age_hours']=round(age,2)
                max_age=6 if name.startswith(('harmonie','icond2')) else 18
                if age>max_age:issue('stale_model',name,dict(age_hours=round(age,2),limit_hours=max_age))
        if len(times) != meta.get('uren') or len(set(times)) != len(times):
            issue('forecast_times', name, 'Duplicate times or step count differs from uren')
        try:
            stamps = [iso(t) for t in times]
            gaps = [(times[i-1], times[i]) for i in range(1,len(times)) if (stamps[i]-stamps[i-1]).total_seconds()!=3600]
            row['non_hourly_steps'] = gaps
            if gaps: issue('forecast_cadence', name, gaps)
        except Exception as exc: issue('forecast_times', name, str(exc))
        for param, desc in meta.get('parameters', {}).items():
            if not isinstance(desc,dict) or not desc.get('file'): continue
            p=root/desc['file']
            if not p.exists():
                issue('missing_binary', name, desc['file']); continue
            try:
                with p.open('rb') as f: nlat,nlon,steps,components=struct.unpack('<HHHH',f.read(8))
                width=1 if desc.get('dtype') in ('u8sqrt','u8lin','uint8','u8') else 4
                expected=16+nlat*nlon*steps*components*width
                row['parameters'][param]=dict(shape=[steps,components,nlat,nlon],bytes=p.stat().st_size)
                if p.stat().st_size != expected: issue('binary_size',name,dict(parameter=param,expected=expected,actual=p.stat().st_size))
                grid=desc.get('grid',meta.get('grid',{}))
                if (steps,nlat,nlon,components)!=(len(times),grid.get('n_lat'),grid.get('n_lon'),desc.get('components',1)):
                    issue('binary_shape',name,dict(parameter=param,shape=[steps,components,nlat,nlon]))
            except Exception as exc: issue('binary_header',name,str(exc))
        checks.append(row)
    today=now.date().isoformat()
    observations=[]
    for p in sorted((root/'data'/'observations').glob(f'*/{today}.json')):
        try:
            data=json.loads(p.read_text());rows=data['rows'];times=[iso(r['time']) for r in rows]
            counts=Counter(times)
            if any(n>1 for n in counts.values()):issue('duplicate_observation',str(p.relative_to(root)), 'Duplicate timestamp')
            start=iso(today+'T00:00:00Z');last=max(times)
            expected=int((last-start).total_seconds()/600)
            missing=expected-len(counts)
            age=(now-last).total_seconds()/60
            item=dict(station=data['station'],records=len(rows),last_time=last.isoformat(),age_minutes=round(age,1),missing_samples=missing)
            if missing:issue('observation_gaps',str(p.relative_to(root)),item)
            if age>40:issue('stale_observations',str(p.relative_to(root)),item)
            # Read related files together: the inventory pass can span an
            # importer cycle, and comparing those cached objects gives a false alarm.
            station=str(data['station'])
            month_path=root/f'maanddata_{station}.json'
            month_obj=json.loads(month_path.read_text()) if month_path.exists() else {}
            month_days=month_obj.get('data',{})
            month=month_days.get(today,{})
            yesterday=(now.date()-timedelta(days=1)).isoformat()
            if now.hour>=7 and yesterday not in month_days:
                issue('missing_yesterday',station,yesterday)
            record_path=root/f'records_{station}.json'
            record=json.loads(record_path.read_text()) if record_path.exists() else {}
            days=record.get('maanddetail',{}).get(str(now.year),{}).get(str(now.month),{}).get('dagen',[])
            day=next((d for d in days if d.get('dag')==now.day),{})
            differences={k:[month.get('rr' if k=='rh' else k),day.get(k)] for k in ('tx','tn','tg','rh','sq','fg') if month.get('rr' if k=='rh' else k)!=day.get(k)}
            if differences and record.get('lopend_dagrecords_version')==2:
                issue('station_month_records_disagreement',station,differences)
            observations.append(item)
        except Exception as exc:issue('observation_read',str(p.relative_to(root)),str(exc))
    streams=[]
    def stream_age(name, stamp, limit_hours, local=False):
        try:
            parsed=iso(stamp)
            if parsed.tzinfo is None:
                parsed=parsed.replace(tzinfo=ZoneInfo('Europe/Amsterdam') if local else timezone.utc)
            age=(now-parsed).total_seconds()/3600
            streams.append(dict(product=name,source_time=parsed.isoformat(),age_hours=round(age,2),limit_hours=limit_hours))
            if age>limit_hours or age < -1: issue('stream_freshness',name,streams[-1])
        except Exception as exc:issue('stream_timestamp',name,str(exc))
    for name, keys, limit in [
        ('bliksem_strikes.json',['updated'],0.15),
        ('metar_data.json',['_update'],2),
        ('mtg_prov_meta.json',['bijgewerkt'],0.5),
        ('waarschuwingen.json',['generated'],2),
        ('weatherpro_uur.json',['_meta','fetched'],2),
        ('jvens.json',['current_run'],30),
        ('pluim_archive_meta.json',['updated'],3),
    ]:
        if name not in products:issue('missing_active_product',name,'Expected active source absent');continue
        value=products[name]
        for key in keys:value=value.get(key) if isinstance(value,dict) else None
        stream_age(name,value,limit)
    radar=products.get('radar_meta.json',{})
    if radar.get('tijden'):
        stream_age('radar_meta.json',radar['tijden'][radar['t_now_index']],0.4)
        if len(radar['tijden'])!=radar.get('frames') or radar.get('n_history',0)+radar.get('n_forecast',0)!=radar.get('frames'):
            issue('radar_steps','radar_meta.json','Frame count differs from time axis')
        stamps=[iso(t) for t in radar['tijden']]
        if any((b-a).total_seconds()!=300 for a,b in zip(stamps,stamps[1:])):issue('radar_cadence','radar_meta.json','Missing or duplicate 5-minute step')
    for name, data in products.items():
        if not name.startswith('mosmix_') or not isinstance(data,dict) or not data.get('run') or name.endswith(('.local.json','_demo.json')):continue
        stream_age(name,data['run'],18)
        if name.startswith('mosmix_uurlijks_'):
            for station,series in data.get('data',{}).items():
                times=series.get('tijden_utc',series.get('tijden',[]))
                if not times:issue('empty_hourly_forecast',name,station);continue
                for field,values in series.items():
                    if isinstance(values,list) and len(values)!=len(times):issue('hourly_forecast_length',name,dict(station=station,field=field,steps=len(values),expected=len(times)))
                if series.get('tijden_utc'):
                    stamps=[iso(t) for t in times]
                    if len(set(stamps))!=len(stamps) or any((b-a).total_seconds()!=3600 for a,b in zip(stamps,stamps[1:])):
                        issue('hourly_forecast_cadence',name,station)
    dwd=products.get('dwd_guidance.json',{})
    for section in ('kurzfrist','mittelfrist'):
        part=dwd.get(section,{})
        stream_age('dwd_guidance.json/'+section,part.get('fetchedAt'),30,local=True)
        if not part.get('translated') or part.get('error'):issue('missing_translation','dwd_guidance.json',section)
    rain=products.get('neerslag_records.json',{})
    if rain.get('stations_achter_bron'):issue('precipitation_archive_behind','neerslag_records.json',rain['stations_achter_bron'])
    if now.hour*60+now.minute>=20:
        yesterday=(now.date()-timedelta(days=1)).isoformat()
        for directory in (root/'data'/'observations').glob('*'):
            if directory.is_dir() and (directory/(yesterday+'.json')).exists() and not (directory/(today+'.json')).exists():
                issue('missing_current_day',directory.name,today)
    # Crawl actual navigation/assets rather than assuming every old/demo file is live.
    todo=['index.html'];seen=set();refs=set()
    while todo:
        name=todo.pop()
        if name in seen:continue
        seen.add(name);p=root/name
        if not p.exists():continue
        if p.suffix not in ('.html','.js'):continue
        text=p.read_text(errors='replace')
        for match in re.findall(r'''["']([^"'<>\s]+\.(?:html|js|json))(?:[?#][^"'<>\s]*)?["']''',text):
            if '://' in match or match.startswith('//'):continue
            try: resolved=(root/Path(name).parent/match).resolve().relative_to(root.resolve()).as_posix()
            except ValueError:continue
            refs.add(resolved)
            if resolved.endswith(('.html','.js')):todo.append(resolved)
    schedulers=[]
    for p in sorted((Path.home()/'Library'/'LaunchAgents').glob('*.plist')):
        if not any(s in p.name for s in ('edaldus','weerlab')):continue
        d=plistlib.loads(p.read_bytes());entry={'label':d.get('Label'),'interval':d.get('StartInterval'),'logs':[]}
        for key in ('StandardOutPath','StandardErrorPath'):
            if key not in d:continue
            f=Path(d[key]);entry['logs'].append({'path':str(f),'exists':f.exists(),'age_minutes':round((now.timestamp()-f.stat().st_mtime)/60,1) if f.exists() else None})
        schedulers.append(entry)
    try:
        result=subprocess.run(['launchctl','list'],capture_output=True,text=True,timeout=10)
        loaded={line.split()[-1]:line.split()[:2] for line in result.stdout.splitlines() if len(line.split())==3}
        if not loaded:raise ValueError('No launchd services visible in this execution context')
        for job in schedulers:
            job['loaded']=job['label'] in loaded
            job['process_status']=loaded.get(job['label'])
            if not job['loaded'] and job['label']=='nl.edaldus.kranten':
                job['delegated_to']='Codex automation krantenredactie-dagelijks-bijwerken; duplicate launchd explicitly disabled'
            elif not job['loaded']:issue('scheduler_not_loaded',job['label'],'Installed plist is not loaded; confirm whether intentionally disabled')
            elif job['process_status'][0]=='-' and job['process_status'][1] not in ('0','-'):issue('scheduler_failed',job['label'],job['process_status'])
    except Exception as exc:
        issues.append(dict(kind='unverified_scheduler_status',file='launchctl',detail=str(exc)))
    return dict(generated_utc=now.isoformat(),root=str(root),json_products=len(products),streams=streams,models=checks,observations=observations,navigation_pages=sorted(seen),data_references=sorted(refs),schedulers=schedulers,issues=issues,limitations=['Local evidence only; CDN and upstream require separate live verification.','Nulls and stale files can be intentional for retired stations/products.','Log mtime is not evidence of successful import.'])

def main():
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    args=p.parse_args();report=inspect(args.root,datetime.now(timezone.utc))
    tmp=args.output.with_suffix('.tmp');tmp.write_text(json.dumps(report,indent=2));tmp.replace(args.output)
    print(json.dumps({'models':len(report['models']),'stations':len(report['observations']),'pages_assets':len(report['navigation_pages']),'issues':Counter(x['kind'] for x in report['issues'])}))
    for issue in report['issues']:print('WAARSCHUWING:',json.dumps(issue))
    return 1 if report['issues'] else 0

if __name__=='__main__':raise SystemExit(main())
