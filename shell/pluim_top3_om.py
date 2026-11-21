"""Bounded range reads of native O1280 ENS data from Open-Meteo's AWS Open Data.

Storage layout/library: https://github.com/open-meteo/open-data
Grid indexing follows GaussianGridArea's documented north-to-south row order.
Only Dutch row segments are read, never whole model files.
"""
from collections import OrderedDict, defaultdict
import concurrent.futures
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time

import numpy as np
import requests

from pluim_top3_landelijk import NAME, RANKING_METHOD, catalog, canonical, scores, publish_run

MODEL='ecmwf_ifs_europe_ensemble'
ROOT='https://openmeteo.s3.amazonaws.com/data_run/'+MODEL
META=ROOT
RAW=('temperature_2m','precipitation','wind_u_component_10m','wind_v_component_10m','wind_gusts_10m')


class GaussianArea:
    def __init__(self):
        f=np.float32
        self.dy=f(180)/f(2560.5)
        self.start=int(np.rint(f(1279)-(f(70.967)-self.dy/f(2))/self.dy))
        end=int(np.rint(f(1279)-(f(33.005)-self.dy/f(2))/self.dy))+1
        self.rows=[];self.prefix=[0]
        for y in range(self.start,end):
            nx=20+4*y;dx=f(360)/f(nx)
            x1=int(f(-11)/dx)%nx;x2=int(f(37)/dx)%nx
            self.rows.append((y,nx,dx,x1))
            self.prefix.append(self.prefix[-1]+(x2-x1)%nx+1)

    def point(self,lat,lon):
        f=np.float32;lat,lon=f(lat),f(lon)
        y0=int(f(1279)-(lat-self.dy/f(2))/self.dy)
        choices=[]
        for y in (y0,y0+1):
            _,nx,dx,x1=self.rows[y-self.start]
            x=int(np.floor(lon/dx+f(.5)))%nx
            yy=f(1279-y)*self.dy+self.dy/f(2);xx=f(x)*dx
            index=self.prefix[y-self.start]+(x-x1)%nx
            choices.append((float((yy-lat)**2+(xx-lon)**2),index,y,float(yy),float(xx)))
        return min(choices)

    def groups(self,cities):
        points={}
        for city in cities:
            _,index,y,lat,lon=self.point(city['lat'],city['lon'])
            group=points.setdefault(index,dict(id=f'o1280_{index}',index=index,row=y,lat=lat,lon=lon,places=[]))
            group['places'].append(city)
        return [points[i] for i in sorted(points)]


class Remote:
    """The documented omfiles filesystem interface, with a bounded block cache."""
    block=65536
    def __init__(self):
        self.session=requests.Session();self.info={};self.cache=OrderedDict();self.bytes=0;self.calls=0

    def size(self,path):
        if path not in self.info:
            response=self.session.head(path,timeout=(10,30));response.raise_for_status()
            size=int(response.headers['Content-Length'])
            if size<32 or not response.headers.get('ETag'):
                raise ValueError('Ongeldige OM-bronmetadata')
            self.info[path]=(size,response.headers['ETag'])
        return self.info[path][0]

    def _range(self,path,start,end):
        if not 0<=start<end<=self.size(path) or end-start>16*1024**2:
            raise ValueError('OM-bereik valt buiten de afgesproken begrenzing')
        for attempt in range(3):
            try:
                response=self.session.get(path,headers={'Range':f'bytes={start}-{end-1}',
                    'If-Match':self.info[path][1],'Accept-Encoding':'identity'},timeout=(10,45))
                response.raise_for_status()
                if response.status_code!=206 or len(response.content)!=end-start:
                    raise ValueError('OM-bron negeert het gevraagde bytebereik')
                self.bytes+=len(response.content);self.calls+=1
                return response.content
            except (requests.Timeout,requests.ConnectionError):
                if attempt==2:raise
                time.sleep(attempt+1)

    def cat_file(self,path,start=None,end=None,**kwargs):
        if start is None or end is None:
            raise ValueError('Een volledige OM-download is niet toegestaan')
        first=start//self.block;last=(end-1)//self.block
        if last-first>128:
            return self._range(path,start,end)
        result=[]
        # Consecutive cache misses share one HTTP request.
        i=first
        while i<=last:
            key=(path,i)
            if key not in self.cache:
                j=i
                while j<last and (path,j+1) not in self.cache:j+=1
                data=self._range(path,i*self.block,min((j+1)*self.block,self.size(path)))
                for k in range(i,j+1):
                    self.cache[(path,k)]=data[(k-i)*self.block:(k-i+1)*self.block]
            self.cache.move_to_end(key)
            result.append(self.cache[key])
            while len(self.cache)>256:self.cache.popitem(last=False)
            i+=1
        return b''.join(result)[start-first*self.block:end-first*self.block]


def read_field(field,run,groups,times,grid):
    from omfiles import OmFileReader
    url=ROOT+run.strftime('/%Y/%m/%d/%H00Z/')+field+'.om'
    backend=Remote()
    result=np.full((51,len(groups),len(times)),np.nan,dtype=np.float32)
    by_row=defaultdict(list)
    for i,group in enumerate(groups):by_row[group['row']].append((i,group['index']))
    with OmFileReader.from_fsspec(backend,url) as reader:
        if len(reader.shape)!=4 or reader.shape[:3]!=(1,grid.prefix[-1],51):
            raise ValueError('Onverwacht native ENS-rooster of ledenaantal')
        offset=len(times)-reader.shape[-1]
        if offset not in (0,1) or offset and field not in ('precipitation','wind_gusts_10m'):
            raise ValueError('OM-tijdas past niet op deze complete modelrun')
        for pairs in by_row.values():
            lo=min(p for _,p in pairs);hi=max(p for _,p in pairs)+1
            block=reader[0:1,lo:hi,:,:].reshape(hi-lo,51,-1)
            for i,p in pairs:result[:,i,offset:]=block[p-lo]
        if offset:result[:,:,0]=0
    if field in ('precipitation','wind_gusts_10m'):
        # At initialization there is no preceding forecast interval.
        result[:,:,0]=0
    if not np.isfinite(result).all():raise ValueError('OM-bron bevat ontbrekende leden/tijdstappen')
    print(f'NL_TOP3_READ: {field}, {backend.bytes/1024**2:.1f} MiB, {backend.calls} bytebereiken',flush=True)
    return field,result,backend.info[url][1]


def metadata(run):
    url=META+run.strftime('/%Y/%m/%d/%H00Z/meta.json')
    response=requests.get(url,timeout=(10,30));response.raise_for_status()
    meta=response.json()
    parse=lambda s:datetime.fromisoformat(s.replace('Z','+00:00'))
    if parse(meta['reference_time'])!=run:raise ValueError('Verkeerde modelrun in native bron')
    times=[parse(t) for t in meta['valid_times']]
    hours=list(range(91))+list(range(93,145,3))+(list(range(150,361,6)) if run.hour in (0,12) else [])
    if [(t-run).total_seconds()/3600 for t in times]!=hours:
        raise ValueError('Native modelrun is nog onvolledig')
    return meta,[int(t.timestamp()*1000) for t in times]


def update_native_runs(repo,state,publish=True):
    repo,state=Path(repo),Path(state)
    cities=catalog(repo);city_sha=hashlib.sha256(canonical(cities)).hexdigest()
    grid=GaussianArea();groups=grid.groups(cities)
    archive=json.loads((repo/'pluim_archive_meta.json').read_text())
    for entry in archive.get('runs',[])[:8]:
        if entry.get('complete') is not True:continue
        run=datetime.fromisoformat(entry['run'].replace('Z','+00:00'))
        try:
            meta,times=metadata(run)
            version=hashlib.sha256(canonical(meta)).hexdigest()
            existing=json.loads((repo/NAME).read_text()) if (repo/NAME).exists() else {}
            previous=next((r for r in existing.get('runs',[]) if r['run']==entry['run']),{})
            source=previous.get('top3_nl',{}).get('source',{})
            if (previous.get('top3_nl',{}).get('ranking_method')==RANKING_METHOD
                    and source.get('native_revision')==version and source.get('catalog_revision')==city_sha):
                continue
            print(f'NL_TOP3_BUILD: {entry["run"]}, {len(cities)} plaatsen, {len(groups)} modelpunten',flush=True)
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                values=list(pool.map(lambda field:read_field(field,run,groups,times,grid),RAW))
            raw={key:a for key,a,_ in values}
            # Stored precipitation is the amount in the preceding native interval.
            # The native ENS feed diagnoses snowfall from precipitation and T<0;
            # use the same per-member diagnostic as its public plume API.
            fields=dict(temperature_2m=raw['temperature_2m'],precipitation=raw['precipitation'],
                wind_speed_10m=np.hypot(raw['wind_u_component_10m'],raw['wind_v_component_10m'])*3.6,
                wind_gusts_10m=raw['wind_gusts_10m']*3.6,
                snowfall=np.where(raw['temperature_2m']<0,raw['precipitation']*.7,0))
            after,_=metadata(run)
            if after!=meta:raise ValueError('Native bron wijzigde tijdens het lezen')
            source=dict(provider='ECMWF / Open-Meteo AWS Open Data',model=MODEL,grid='O1280',
                resolution='circa 9 km',run_initialisation=entry['run'],native_revision=version,
                availability=meta['created_at'],
                catalog_revision=city_sha,field_etags={key:etag for key,_,etag in values},
                snowfall_method='Neerslag bij T2m < 0 °C × 0,7 cm/mm, per ensemblelid')
            summary,documents=scores(groups,run,times,fields,source)
            publish_run(repo,state,run,summary,documents,publish)
        except requests.HTTPError as error:
            if error.response.status_code in (403,404):
                print(f'NL_TOP3_WAIT: native bestanden nog niet beschikbaar voor {entry["run"]}',flush=True)
                continue
            raise
