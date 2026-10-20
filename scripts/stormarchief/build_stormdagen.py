#!/usr/bin/env python3
"""Reproduceer stormdagen uit ongewijzigde KNMI-dagarchieven; geen grafiektranscriptie.
Gebruik: python3 build_stormdagen.py --source source --output stormdagen_data.json
Ontbrekende FHX blijft ontbrekend; datums zijn KNMI-etmalen in UTC.
"""
import argparse,calendar,csv,hashlib,io,json,re,zipfile
from collections import defaultdict
from datetime import date,datetime,timezone
from pathlib import Path


def parse_text(text):
    header=None
    for line in text.splitlines():
        if re.match(r'\s*#?\s*STN\s*,\s*YYYYMMDD',line):
            header=[s.strip() for s in line.lstrip('# ').split(',')]
        elif re.match(r'\s*\d+\s*,\s*\d{8}',line):
            if header is None: raise ValueError('KNMI header ontbreekt')
            values=[s.strip() for s in next(csv.reader([line]))]
            if len(values)!=len(header):raise ValueError('Kolomaantal klopt niet')
            row=dict(zip(header,values))
            stamp=date.fromisoformat(f"{row['YYYYMMDD'][:4]}-{row['YYYYMMDD'][4:6]}-{row['YYYYMMDD'][6:8]}")
            value=int(row['FHX']) if row['FHX'] else None
            if value is not None and not 0<=value<=1000:raise ValueError('Ongeldige FHX')
            yield int(row['STN']),stamp,value


def build(source):
    excluded={209:'IJmond',308:'Cadzand',311:'Hoofdplaat',315:'Hansweert',316:'Schaar'}
    manifest=[m for m in json.loads((source/'manifest.json').read_text()) if m['station'] not in excluded]
    events=defaultdict(dict);coverage=defaultdict(lambda:defaultdict(set));station_meta=[]
    latest=None
    for m in manifest:
        blob=(source/m['file']).read_bytes()
        if hashlib.sha256(blob).hexdigest()!=m['sha256']:raise ValueError('Bronhash gewijzigd')
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            text=z.read(next(n for n in z.namelist() if n.endswith('.txt'))).decode('utf-8-sig')
        first=None;last=None;seen=set()
        for station,stamp,value in parse_text(text):
            if station!=m['station']:raise ValueError('Station komt niet overeen')
            if stamp in seen:raise ValueError('Dubbele stationdatum')
            seen.add(stamp)
            if latest is None or stamp>latest:latest=stamp
            if value is None:continue
            first=stamp if first is None else min(first,stamp);last=stamp if last is None else max(last,stamp)
            coverage[stamp.year][station].add(stamp.isoformat())
            if value>=208:events[stamp.isoformat()][station]=value
        station_meta.append({**m,'first_fhx':first.isoformat() if first else None,'last_fhx':last.isoformat() if last else None})
    # Bewaar op stormdatums ook lagere meetwaarden en windstoten voor een
    # eerlijke stationsvergelijking. FXX bepaalt nooit of een dag storm telt.
    observations=defaultdict(list)
    for m in manifest:
        with zipfile.ZipFile(source/m['file']) as z:
            text=z.read(next(n for n in z.namelist() if n.endswith('.txt'))).decode('utf-8-sig')
        header=None
        for line in text.splitlines():
            if re.match(r'\s*#?\s*STN\s*,\s*YYYYMMDD',line):
                header=[v.strip() for v in line.lstrip('# ').split(',')]
            elif re.match(r'\s*\d+\s*,\s*\d{8}',line):
                row=dict(zip(header,[v.strip() for v in next(csv.reader([line]))]))
                stamp=row['YYYYMMDD'];iso=f'{stamp[:4]}-{stamp[4:6]}-{stamp[6:8]}'
                if iso in events and row['FHX']:
                    observations[iso].append([int(row['STN']),int(row['FHX']),int(row['FXX']) if row.get('FXX') else None,int(row['FHXH']) if row.get('FHXH') else None])
    years=[]
    for year in range(1901,latest.year+1):
        cov=coverage[year];days=set().union(*cov.values()) if cov else set()
        expected=366 if calendar.isleap(year) else 365
        station_days={str(st):len(ds) for st,ds in sorted(cov.items())}
        year_events=[{'date':d,'measurements':[[st,v] for st,v in sorted(measurements.items())],'observations':sorted(observations[d])} for d,measurements in sorted(events.items()) if d.startswith(str(year))]
        years.append({'year':year,'storm':len(year_events) if days else None,'severe':sum(any(v>=245 for _,v in e['measurements']) for e in year_events) if days else None,'observed_days':len(days),'expected_days':expected,'stations':station_days,'partial_year':year==latest.year and latest<date(year,12,31),'events':year_events})
    return {'schema_version':2,'observation_columns':['station','FHX_0.1_ms','FXX_0.1_ms','FHXH_UTC_end_hour'],'generated_utc':datetime.now(timezone.utc).isoformat(),'source_index':'https://www.knmi.nl/nederland-nu/klimatologie/daggegevens/','latest_date':latest.isoformat(),'parameter':'FHX','unit':'0.1 m/s','storm_threshold':208,'severe_threshold':245,'day_basis':'UTC 00–24','excluded_stations':[{'station':st,'name':name} for st,name in excluded.items()],'scope':f'{len(station_meta)} geselecteerde stations uit de KNMI-dagarchiefindex, inclusief kust- en watermeetpunten; geen reconstructie van het historische landelijke meetnet.','stations':station_meta,'years':years}

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--source',type=Path,default=Path(__file__).parent/'source');ap.add_argument('--output',type=Path,default=Path(__file__).parent/'stormdagen_data.json');args=ap.parse_args()
    data=build(args.source);args.output.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'))+'\n')
    print(json.dumps({'stations':len(data['stations']),'latest_date':data['latest_date'],'2025':next({k:y[k] for k in ('storm','severe','observed_days')} for y in data['years'] if y['year']==2025)},ensure_ascii=False))
