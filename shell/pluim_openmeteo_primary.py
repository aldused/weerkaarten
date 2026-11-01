#!/usr/bin/env python3
"""Private-use free ECMWF ENS cache; exact runs, all 39 stations, bounded credits."""
import argparse,json,math,os,subprocess,time
from datetime import datetime,timedelta,timezone
from pathlib import Path
from urllib.parse import urlencode,urlsplit,parse_qs
import ecmwf_pluim_early as early
import pluim_trend_cache as trend


def store(path,data):
    tmp=path.with_suffix('.tmp');tmp.write_text(json.dumps(data,separators=(',',':'),allow_nan=False));tmp.replace(path)

class FreeFetch:
    def __init__(self,path): self.path=path;self.state=json.loads(path.read_text()) if path.exists() else {}
    def __call__(self,url):
        u=urlsplit(url);q=parse_qs(u.query)
        if u.hostname!='ensemble-api.open-meteo.com' or 'apikey' in q:raise RuntimeError('Only free ensemble endpoint permitted')
        cost=1.
        if u.path=='/v1/ensemble':
            locations=len(q['latitude'][0].split(','));variables=len(q['hourly'][0].split(','))
            cost=max(1,locations*variables*51/10*max(1,int(q['forecast_days'][0])/14))
        now=time.time();day=datetime.now(timezone.utc).strftime('%Y-%m-%d')
        if self.state.get('day')!=day:self.state={'day':day,'credits':0,'recent':[]}
        recent=[r for r in self.state.get('recent',[]) if now-r[0]<61]
        if self.state['credits']+cost>8500:raise RuntimeError('Daily free API budget exhausted; direct backup remains active')
        while sum(r[1] for r in recent)+cost>400:
            time.sleep(max(1,61-(time.time()-recent[0][0])))
            recent=[r for r in recent if time.time()-r[0]<61]
        recent.append([time.time(),cost]);self.state['credits']+=cost;self.state['recent']=recent;store(self.path,self.state)
        r=subprocess.run(['/usr/bin/curl','--fail','--silent','--show-error','--connect-timeout','10','--max-time','60',url],capture_output=True,text=True,check=True)
        return json.loads(r.stdout)


def choose(fetch):
    candidates=[]
    try:
        url=early.EARLY_LATEST_META_URL;m=fetch(url);cycle,created,times=early.validate_early_meta(m)
        candidates.append((cycle,True,created,times,url,m,early.EARLY_MODEL))
    except Exception as error:print('EARLY_WAIT:',error,flush=True)
    try:
        url=trend.META_URL;m=fetch(url);cycle=trend.utc_from_epoch(m['last_run_initialisation_time'],'run');created=trend.utc_from_epoch(m['last_run_availability_time'],'availability')
        end=trend.utc_from_epoch(m['data_end_time'],'end');hours=360 if cycle.hour in (0,12) else 144
        if cycle.hour not in (0,6,12,18) or cycle.minute or created<cycle or created>datetime.now(timezone.utc) or end<cycle+timedelta(hours=hours):raise RuntimeError('Incomplete standard cycle')
        times=[cycle+timedelta(hours=h) for h in list(range(0,145,3))+(list(range(150,361,6)) if hours==360 else [])]
        candidates.append((cycle,False,created,times,url,m,'ecmwf_ifs025'))
    except Exception as error:print('STANDARD_WAIT:',error,flush=True)
    if not candidates:raise RuntimeError('No complete free ECMWF run available')
    return max(candidates,key=lambda c:(c[0],c[1]))


def build_documents(fetch,out,chosen):
    cycle,native,created,times,meta_url,meta,model=chosen;stamp=trend.iso_z(cycle)
    existing={slug:early._load_archive(out/f'pluim_trend_{slug}.json',slug) for _,slug,_,_ in trend.STATIONS}
    if any(any(r.get('run','')>stamp for r in d.get('runs',[])) for d in existing.values()):return {}
    if all(any(r.get('run')==stamp and set(early.EARLY_FIELDS).issubset(trend.complete_run_fields(r)) for r in d.get('runs',[])) for d in existing.values()):return {}
    # Pin ECPDS metadata to the exact cycle before requesting station data.
    if native:
        meta_url=early.early_run_meta_url(cycle);meta=fetch(meta_url)
        if early.validate_early_meta(meta)!=(cycle,created,times):raise RuntimeError('Early metadata changed before fetch')
    documents={}
    for start in range(0,len(trend.STATIONS),3):
        stations=trend.STATIONS[start:start+3]
        params=dict(latitude=','.join(str(s[2]) for s in stations),longitude=','.join(str(s[3]) for s in stations),hourly=','.join(early.EARLY_FIELDS),models=model,run=cycle.strftime('%Y-%m-%dT%H:%M'),forecast_days='16' if cycle.hour in (0,12) else '7',timezone='GMT',wind_speed_unit='kmh',precipitation_unit='mm',cell_selection='nearest',elevation=','.join('nan' for s in stations))
        raw=fetch(early.EARLY_API_URL+'?'+urlencode(params));responses=raw if isinstance(raw,list) else [raw]
        if len(responses)!=len(stations):raise RuntimeError('Missing station response')
        for (name,slug,lat,lon),response in zip(stations,responses):
            hourly=early.native_hourly(response,times);run=early._build_early_run(hourly,cycle,created,times,response)
            run['source'].update(provider='ECMWF Open Data',delivery='Open-Meteo free Ensemble API',model=model,product='IFS ENS Europe native O1280 9 km' if native else 'IFS ENS 0.25 degrees',access='open_meteo_free_point_api',resolution_degrees=None if native else .25,attribution='ECMWF / Open-Meteo (CC BY 4.0)')
            if not native:trend.degrade_hres(run,'Geen afzonderlijke HRES opgehaald; ensemblecontrole blijft lid 0')
            trend.update_digest(run)
            runs=[r for r in existing[slug].get('runs',[]) if r.get('data_sha256') and r.get('run')!=stamp]+[run]
            documents[slug]=dict(schema=3,station=name,slug=slug,lat=lat,lon=lon,updated=trend.iso_z(datetime.now(timezone.utc)),runs=sorted(runs,key=lambda r:r['run'],reverse=True)[:8])
        print(f'FREE_VALIDATED: {min(start+3,len(trend.STATIONS))}/39 stations, {stamp}',flush=True)
    after=fetch(meta_url)
    if after!=meta:raise RuntimeError('Run metadata changed; no station files published')
    return documents


def main():
    p=argparse.ArgumentParser();p.add_argument('--repo',type=Path,required=True);p.add_argument('--state-dir',type=Path,required=True);p.add_argument('--out-dir',type=Path);p.add_argument('--no-publish',action='store_true');a=p.parse_args()
    out=a.out_dir or a.repo;out.mkdir(parents=True,exist_ok=True);a.state_dir.mkdir(parents=True,exist_ok=True)
    fetch=FreeFetch(a.state_dir/'free-credits.json');chosen=choose(fetch)
    docs=build_documents(fetch,out,chosen)
    for slug,doc in docs.items():store(out/f'pluim_trend_{slug}.json',doc)
    if not docs and not (out/trend.CAPABILITY_MANIFEST_NAME).exists():print('FREE_NO_CHANGE');return
    trend.write_capability_manifest(out)
    manifest=json.loads((out/trend.CAPABILITY_MANIFEST_NAME).read_text());stamp=a.state_dir/'published-revision'
    if a.no_publish:print('FREE_VALIDATED_ONLY:',len(docs));return
    if stamp.exists() and stamp.read_text().strip()==manifest['revision']:print('FREE_NO_CHANGE');return
    paths=[str(out/f'pluim_trend_{s[1]}.json') for s in trend.STATIONS]
    env=dict(os.environ,R2_CACHE_CONTROL='public, max-age=600')
    subprocess.run([str(a.repo/'shell/r2_publish.sh'),*paths],check=True,env=env)
    subprocess.run([str(a.repo/'shell/r2_publish.sh'),str(out/trend.CAPABILITY_MANIFEST_NAME)],check=True,env=dict(env,R2_CACHE_CONTROL='public, max-age=60'))
    stamp.write_text(manifest['revision']+'\n');print('FREE_PUBLISHED:',trend.iso_z(chosen[0]),flush=True)

if __name__=='__main__':main()
