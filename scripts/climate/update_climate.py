#!/usr/bin/env python3
"""Download, validate, then atomically publish official climate data.

Cached bodies are replaced only after successful parsing/validation. A per-group
last-good JSON remains available on any download/format/version failure.
"""
import argparse
import calendar
from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import date, datetime, timezone
import hashlib
import html
from html.parser import HTMLParser
import io
import json
import os
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.request
from climate_math import SEASONS, episodes, ice_analysis, month_shift, official_round

ROOT=Path(__file__).resolve().parents[2 if Path(__file__).resolve().parent.name=='climate' else 1]
CONFIG=json.loads((Path(__file__).with_name('sources.json')).read_text())

def utc():return datetime.now(timezone.utc).isoformat(timespec='seconds')
def save(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+'.tmp')
    tmp.write_text(json.dumps(value,ensure_ascii=False,allow_nan=False,separators=(',',':')))
    os.replace(tmp,path)

def unique(rows):
    dates=[r['date'] for r in rows]
    if len(dates)!=len(set(dates)):raise ValueError('Dubbele meetdatum')
    if dates!=sorted(dates):raise ValueError('Datums niet chronologisch')
    if not rows or rows[0]['date']>'2000-01-01' or rows[-1]['date']<'2000-12-01':
        raise ValueError('Historische dekking vanaf 2000 ontbreekt')
    if rows[-1]['date']>date.today().isoformat():raise ValueError('Toekomstige waarneming')
    return rows

def parse_index(body,key):
    lines=body.splitlines()
    required='SEAS' in lines[0] and 'ANOM' in lines[0]
    if not required or (key=='oni' and 'TOTAL' not in lines[0]):raise ValueError('Indexschema gewijzigd')
    rows=[]
    for line in lines[1:]:
        if not line.strip():continue
        cells=line.split()
        if len(cells)!=(4 if key=='oni' else 3) or cells[0] not in SEASONS:raise ValueError('Onverwachte indexrij')
        y=int(cells[1]);m=SEASONS.index(cells[0])+1;d=date(y,m,1);v=float(cells[-1])
        if not -6<=v<=6:raise ValueError('Ongeldige indexwaarde')
        start=month_shift(d,-1);end=month_shift(d,1)
        rows.append({'date':d.isoformat(),'value':v,'official_value':official_round(v),'period':f'{cells[0]} {y}',
                     'period_start':start.isoformat(),'period_end':date(end.year,end.month,calendar.monthrange(end.year,end.month)[1]).isoformat(),
                     'quality':'voorlopig' if len(lines)-len(rows)<=3 else 'gepubliceerd'})
    rows=unique(rows)
    for r in rows:r['quality']='voorlopig' if r in rows[-2:] else 'gepubliceerd; revisies mogelijk'
    return rows

class Table(HTMLParser):
    def __init__(self):super().__init__();self.rows=[];self.row=None;self.cell=None
    def handle_starttag(self,tag,attrs):
        if tag=='tr':self.row=[]
        if tag in ['td','th']:self.cell=''
    def handle_data(self,data):
        if self.cell is not None:self.cell+=data
    def handle_endtag(self,tag):
        if tag in ['td','th'] and self.cell is not None:
            if self.row is not None:self.row.append(self.cell.strip())
            self.cell=None
        if tag=='tr' and self.row is not None:self.rows.append(self.row);self.row=None

def validate_table(body,rows):
    if 'ERSSTv6' not in body and 'ERSST.v6' not in body:raise ValueError('Officiële tabel geen ERSSTv6')
    p=Table();p.feed(body)
    values={}
    for cells in p.rows:
        if 2<=len(cells)<=13 and re.fullmatch(r'\d{4}',cells[0]):
            for m,v in enumerate(cells[1:],1):
                if re.fullmatch(r'-?\d+\.\d+',v.strip()):values[f'{cells[0]}-{m:02d}-01']=float(v)
    if len(values)<300:raise ValueError('Officiële controletabel niet leesbaar')
    for r in rows:
        if r['date']>='2000-01-01' and (r['date'] not in values or abs(values[r['date']]-r['value'])>.051):
            raise ValueError(f'ASCII en officiële afgeronde tabel verschillen: {r["date"]}')
        if r['date'] in values:r['official_value']=values[r['date']]
    return {'method':'Iedere indexwaarde sinds 2000 gecontroleerd tegen CPC ERSSTv6-tabel','checked':sum(r['date']>='2000-01-01' for r in rows)}

def parse_mei(body):
    rows=[]
    for line in body.splitlines()[1:]:
        cells=line.split()
        if len(cells)!=13 or not re.fullmatch(r'\d{4}',cells[0]):continue
        y=int(cells[0])
        for m,text in enumerate(cells[1:],1):
            v=float(text)
            if v<-900:continue
            if not -6<=v<=6:raise ValueError('Ongeldige MEI')
            d=date(y,m,1);start=month_shift(d,-1)
            rows.append({'date':d.isoformat(),'value':v,'period':f'{start:%m/%Y}–{d:%m/%Y}',
                         'period_start':start.isoformat(),'period_end':date(y,m,calendar.monthrange(y,m)[1]).isoformat(),
                         'quality':'gepubliceerd; revisies mogelijk'})
    return unique(rows)

def parse_sst(body):
    lines=body.splitlines();header=lines[0].split()
    if header!=['YR','MON','NINO1+2','ANOM','NINO3','ANOM','NINO4','ANOM','NINO3.4','ANOM']:
        raise ValueError('SST-schema gewijzigd')
    rows=[]
    for line in lines[1:]:
        c=line.split()
        if not c:continue
        if len(c)!=10:raise ValueError('SST-rij gewijzigd')
        y,m=int(c[0]),int(c[1]);v=float(c[8]);anomaly=float(c[9])
        if not 15<=v<=40 or not -6<=anomaly<=6:raise ValueError('Ongeldige SST')
        rows.append({'date':date(y,m,1).isoformat(),'value':v,'anomaly':anomaly,'period':f'{m:02d}/{y}',
                     'period_end':date(y,m,calendar.monthrange(y,m)[1]).isoformat(),'quality':'gepubliceerd; revisies mogelijk'})
    return unique(rows)

def parse_advisory(body):
    text=html.unescape(re.sub('<[^>]+>',' ',body));text=re.sub(r'\s+',' ',text)
    dm=re.search(r'(\d{1,2} [A-Z][a-z]+ \d{4})',text)
    status=re.search(r'ENSO Alert System Status:\s*(.*?)\s*Synopsis:',text)
    if not dm or not status:raise ValueError('Officiële status niet herkenbaar')
    d=datetime.strptime(dm[1],'%d %B %Y').date()
    alert=status[1].strip()
    if 'El Niño Advisory' in alert:phase='El Niño'
    elif 'La Niña Advisory' in alert:phase='La Niña'
    elif 'Not Active' in alert or 'Watch' in alert:phase='ENSO-neutraal'
    else:raise ValueError('Onbekende ENSO-status; handmatige broncontrole nodig')
    return {'date':d.isoformat(),'phase':phase,'alert':alert}

def parse_daily(body,hemisphere):
    reader=csv.reader(io.StringIO(body));header=[c.strip() for c in next(reader)]
    if header!=['Year','Month','Day','Extent','Missing','Source Data']:raise ValueError('NSIDC-dagschema gewijzigd')
    next(reader);rows=[]
    for c in reader:
        if not c:continue
        if len(c)<6:raise ValueError('NSIDC-dagrij onvolledig')
        y,m,d=map(int,c[:3]);v=float(c[3]);missing=float(c[4]);source=','.join(c[5:])
        if v in [-9999,-999,-99]:v=None
        if v is not None and not 0<=v<=30:raise ValueError('Ongeldige zeeijsuitbreiding')
        if missing<0:raise ValueError('Ongeldig ontbrekend oppervlak')
        if not any(t in source for t in ['NSIDC-0051','nsidc0051','NSIDC-0803','nsidc0803','NSIDC-0081','NSIDC0081']):raise ValueError('Onbekend NSIDC-bronproduct')
        quality='herzienbaar AMSR2' if '0803' in source else 'historisch NRT' if '0081' in source else 'historisch GSFC'
        rows.append({'date':date(y,m,d).isoformat(),'value':v,'missing':missing,'quality':quality})
    rows=unique(rows)
    if len(rows)<12000:raise ValueError('Dagbestand onverwacht ingekort')
    return rows

def parse_monthly(body,hemisphere,month):
    reader=csv.reader(io.StringIO(body));header=[c.strip() for c in next(reader)]
    if header!=['year','mo','source_dataset','region','extent','area']:raise ValueError('NSIDC-maandschema gewijzigd')
    rows=[]
    for c in reader:
        if not c:continue
        if len(c)!=6:raise ValueError('NSIDC-maandrij onvolledig')
        y,m=int(c[0]),int(c[1]);v=float(c[4])
        if m!=month or c[3].strip()!=hemisphere:raise ValueError('Verkeerd halfrond/maand')
        if v<0:continue
        if not 0<=v<=30:raise ValueError('Ongeldige maanduitbreiding')
        if any(p.strip() not in ['NSIDC-0051','NSIDC-0803','NSIDC-0081'] for p in c[2].split(',')):raise ValueError('Onbekend maandbronproduct')
        rows.append({'date':date(y,m,1).isoformat(),'value':v,'source_product':c[2].strip(),
                     'quality':'herzienbaar AMSR2' if '0803' in c[2] else 'historisch GSFC'})
    if len(rows)<30:raise ValueError('Maandbestand ingekort')
    return rows

class Fetcher:
    def __init__(self,cache,force=False):self.cache=cache;self.force=force
    def get(self,key,url,ttl,parser):
        path=self.cache/(key+'.json');old=json.loads(path.read_text()) if path.exists() else None
        if old and old['url']!=url:old=None
        if old and not self.force and time.time()-old['time']<ttl*3600:
            return parser(old['body']),old['meta']
        headers={'User-Agent':'WeerlabClimate/1.0 (official climate monitoring; cached)'}
        if old:
            if old.get('etag'):headers['If-None-Match']=old['etag']
            if old.get('modified'):headers['If-Modified-Since']=old['modified']
        response=None
        for attempt in range(3):
            try:
                response=urllib.request.urlopen(urllib.request.Request(url,headers=headers),timeout=40)
                raw=response.read(12_000_001)
                if len(raw)>12_000_000:raise ValueError('Bronbestand te groot')
                body=raw.decode('utf-8-sig');break
            except urllib.error.HTTPError as e:
                if e.code==304 and old:body=old['body'];break
                if e.code not in [429,500,502,503,504] or attempt==2:raise
                time.sleep(1+attempt)
            except urllib.error.URLError:
                if attempt==2:raise
                time.sleep(1+attempt)
        parsed=parser(body) # No cache mutation before validation.
        meta={'url':url,'last_success':utc(),'sha256':hashlib.sha256(body.encode()).hexdigest()}
        save(path,{'url':url,'body':body,'time':time.time(),'meta':meta,
                   'etag':response.headers.get('ETag') if response else old.get('etag'),
                   'modified':response.headers.get('Last-Modified') if response else old.get('modified')})
        return parsed,meta

def metadata(config,fetch,rows):
    return {**{k:v for k,v in config.items() if k not in ['ttl_hours','root','table']},**fetch,
            'first':rows[0]['date'],'latest':rows[-1].get('period_end',rows[-1]['date']),
            'latest_period':rows[-1].get('period',rows[-1]['date'])}

def guard(old,new):
    if not old:return
    if 'rows' in new and old.get('rows') and new['rows'][-1]['date']<old['rows'][-1]['date']:
        raise ValueError('Nieuw bestand loopt achter op laatst gevalideerde gegevens')
    if old.get('meta',{}).get('monthly_latest') and new['meta'].get('monthly_latest','')<old['meta']['monthly_latest']:
        raise ValueError('Maandbestand loopt achter op laatst gevalideerde gegevens')

def run(output,cache,force=False):
    fetcher=Fetcher(cache,force);today=date.today();status={'attempt':utc(),'sources':{}}
    def publish(name,builder):
        target=output/(name+'.json');old=json.loads(target.read_text()) if target.exists() else None
        try:
            new=builder();guard(old,new);save(target,new)
            status['sources'][name]={'state':'ok','last_success':new['meta']['last_success']}
            print(name,'gevalideerd',new['meta'].get('latest',''))
        except Exception as e:
            status['sources'][name]={'state':'delayed' if old else 'unavailable','last_success':old['meta']['last_success'] if old else None,
                                    'error':f'{type(e).__name__}: {e}'}
            print(name,'reserve behouden' if old else 'niet beschikbaar',type(e).__name__,str(e),file=sys.stderr)
    def index(key):
        c=CONFIG[key];rows,meta=fetcher.get(key,c['url'],c['ttl_hours'],lambda b:parse_index(b,key))
        check,table_meta=fetcher.get(key+'_table',c['table'],c['ttl_hours'],lambda b:validate_table(b,rows))
        return {'meta':{**metadata(c,meta,rows),'validation':check,'validation_success':table_meta['last_success']},
                'rows':[r for r in rows if r['date']>='2000-01-01'],'episodes':episodes(rows)}
    def simple(key,parser):
        c=CONFIG[key];rows,meta=fetcher.get(key,c['url'],c['ttl_hours'],parser)
        return {'meta':metadata(c,meta,rows),'rows':[r for r in rows if r['date']>='2000-01-01']}
    def advisory():
        c=CONFIG['advisory'];value,meta=fetcher.get('advisory',c['url'],c['ttl_hours'],parse_advisory)
        return {'meta':{**c,**meta,'latest':value['date']},'value':value}
    def ice(h):
        c=CONFIG['ice'];region='north' if h=='N' else 'south';root=c['root']+region+'/'
        if c['version']!='4.0':raise ValueError('Alleen gecontroleerde Sea Ice Index versie 4.0 wordt ondersteund')
        daily_url=root+f'daily/data/{h}_seaice_extent_daily_v4.0.csv'
        daily,dm=fetcher.get(h+'_daily',daily_url,1,lambda b:parse_daily(b,h))
        def month(m):
            url=root+f'monthly/data/{h}_{m:02d}_extent_v4.0.csv'
            return fetcher.get(f'{h}_{m:02d}',url,12,lambda b:parse_monthly(b,h,m))
        with ThreadPoolExecutor(max_workers=4) as pool:parts=list(pool.map(month,range(1,13)))
        monthly=unique(sorted([r for part,_ in parts for r in part],key=lambda r:r['date']))
        analysis=ice_analysis(daily,monthly,today)
        return {'meta':{**metadata(c,dm,daily),'monthly_latest':monthly[-1]['date'],
                        'monthly_success':min(m['last_success'] for _,m in parts),
                        'monthly_urls':[m['url'] for _,m in parts],
                        'reference_note':'Mediaan/percentielen berekend per kalenderdatum uit officiële NSIDC-dagwaarden; geen 5-daagse afvlakking'},
                'rows':[r for r in daily if r['date']>='2000-01-01'],'analysis':analysis}
    jobs=[('roni',lambda:index('roni')),('oni',lambda:index('oni')),('mei',lambda:simple('mei',parse_mei)),
          ('sst',lambda:simple('sst',parse_sst)),('advisory',advisory),('north',lambda:ice('N')),('south',lambda:ice('S'))]
    with ThreadPoolExecutor(max_workers=3) as pool:list(pool.map(lambda item:publish(*item),jobs))
    save(output/'status.json',status)
    return 1 if any(s['state']!='ok' for s in status['sources'].values()) else 0

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--output',type=Path,default=ROOT/'beta-klimaat/data')
    ap.add_argument('--cache',type=Path,default=ROOT/'cache');ap.add_argument('--force',action='store_true')
    args=ap.parse_args()
    import fcntl
    args.cache.mkdir(parents=True,exist_ok=True)
    with (args.cache/'update.lock').open('w') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:sys.exit('Een klimaatactualisatie is al bezig.')
        sys.exit(run(args.output,args.cache,args.force))
