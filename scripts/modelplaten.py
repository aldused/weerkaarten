"""Independent HARMONIE 43, ECMWF IFS and ICON-D2 wind/rain grids; never blend models."""
import argparse,datetime as dt,json,struct,subprocess,hashlib
from pathlib import Path
from zoneinfo import ZoneInfo
import numpy as np
import eccodes as ec
from windplaat_grid import ifs_fields,regrid
U=dt.timezone.utc;Z=ZoneInfo('Europe/Amsterdam')
LABELS={'harmonie':'HARMONIE 43','ecmwf':'ECMWF IFS','icond2':'ICON-D2'}
def iso(s):return dt.datetime.fromisoformat(s.replace('Z','+00:00'))
def native_times(m):
 first=iso(m['tijden'][0]).replace(tzinfo=Z).astimezone(U);times=[first+dt.timedelta(hours=i) for i in range(len(m['tijden']))]
 if any(t.astimezone(Z).strftime('%Y-%m-%dT%H:%M')!=s for t,s in zip(times,m['tijden'])):raise ValueError('Discontinuous native timeline')
 return times

def native_field(root,m,key,lat,lon):
 p=m['parameters'][key];g=p.get('grid',m['grid']);blob=(root/'weerlab'/p['file']).read_bytes();ny,nx,nt,nc=struct.unpack('<HHHH',blob[:8]);assert (ny,nx,nt)==(g['n_lat'],g['n_lon'],len(m['tijden']))
 if p.get('dtype')=='u8sqrt':a=(np.frombuffer(blob[16:],dtype='u1').reshape(nt,nc,ny,nx).astype(float)/p['scale'])**p.get('power',2)
 else:a=np.frombuffer(blob[16:],dtype='<f4').reshape(nt,nc,ny,nx)
 la=np.linspace(g['lat_max'],g['lat_min'],ny);lo=np.linspace(g['lon_min'],g['lon_max'],nx)
 if min(lat)<min(la) or max(lat)>max(la) or min(lon)<min(lo) or max(lon)>max(lo):raise ValueError('Outside source grid')
 return np.stack([[regrid(field[::-1],(la,lo),lat,lon) for field in frame] for frame in a])

def rain_ifs(root,lat,lon,start,hours):
 steps={};errors={};run=None
 with (root/'grib_cache/wx_precip24.grib2').open('rb') as f:
  while (h:=ec.codes_grib_new_from_file(f)) is not None:
   try:
    if ec.codes_get(h,'shortName')!='tp':continue
    r=dt.datetime.strptime(f"{ec.codes_get(h,'dataDate')}{ec.codes_get(h,'dataTime'):04d}",'%Y%m%d%H%M').replace(tzinfo=U)
    if run and run!=r:raise ValueError('Mixed IFS rain runs')
    run=r;assert ec.codes_get(h,'startStep')==0 and ec.codes_get(h,'stepType')=='accum' and ec.codes_get(h,'units')=='m'
    end=int(ec.codes_get(h,'endStep'));ni,nj=ec.codes_get(h,'Ni'),ec.codes_get(h,'Nj');la0=ec.codes_get(h,'latitudeOfFirstGridPointInDegrees');lo0=ec.codes_get(h,'longitudeOfFirstGridPointInDegrees');dx=ec.codes_get(h,'iDirectionIncrementInDegrees');dy=ec.codes_get(h,'jDirectionIncrementInDegrees');assert ec.codes_get(h,'jScansPositively')==0
    la=la0-np.arange(nj)*dy;lo=(lo0+np.arange(ni)*dx+180)%360-180
    ky=np.where((la>=min(lat)-1)&(la<=max(lat)+1))[0];kx=np.where((lo>=min(lon)-1)&(lo<=max(lon)+1))[0]
    a=ec.codes_get_values(h).reshape(nj,ni)[np.ix_(ky,kx)]*1000
    steps[end]=regrid(a,(la[ky],lo[kx]),lat,lon);errors[end]=float(ec.codes_get(h,'packingError'))*1000
   finally:ec.codes_release(h)
 if not run or dt.datetime.now(U)-run>dt.timedelta(hours=24):raise ValueError('Old/missing IFS rain')
 keys=sorted(steps);v=np.stack([steps[k] for k in keys]);e=np.array([errors[k] for k in keys])[:,None,None]
 lower=np.maximum.accumulate(np.maximum(v-e,0),axis=0);upper=np.minimum.accumulate((v+e)[::-1],axis=0)[::-1]
 if np.any(lower>upper+1e-7):raise ValueError('IFS accumulation reset beyond packing precision')
 v=(lower+upper)/2;out=[];blocks=[]
 for t in range(hours):
  a=start+dt.timedelta(hours=t);b=a+dt.timedelta(hours=1);rain=np.zeros((len(lat),len(lon)));coverage=0;block=0
  for k in range(len(keys)-1):
   c=run+dt.timedelta(hours=keys[k]);d=run+dt.timedelta(hours=keys[k+1]);overlap=max(0,(min(b,d)-max(a,c)).total_seconds())
   if overlap:rain+=(v[k+1]-v[k])*overlap/(d-c).total_seconds();coverage+=overlap;block=max(block,keys[k+1]-keys[k])
  if abs(coverage-3600)>.01:raise ValueError('Missing IFS rain interval')
  out.append(rain);blocks.append(block)
 return run,np.stack(out),blocks

def main():
 p=argparse.ArgumentParser();p.add_argument('--root',type=Path,default=Path('/Users/aldus/KNMI_Project'));p.add_argument('--out',type=Path,required=True);p.add_argument('--publish',action='store_true');a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
 paths=[a.root/'weerlab'/f for f in ['harmonie_canvas_meta.json','icond2_canvas_meta.json']]+[a.root/'grib_cache'/f for f in ['wx_wind.grib2','wx_gust.grib2','wx_precip24.grib2']]
 key=[int(dt.datetime.now(U).timestamp()//3600)]+[p.stat().st_mtime_ns for p in paths];marker=a.out/'published.json'
 if a.publish and marker.exists() and json.loads(marker.read_text())==key:print('Modelplaten actueel');return
 grid=json.loads((a.root/'windplaat_cache/current.json').read_text())['grid'];lat=grid['lat0']+np.arange(grid['ny'])*grid['dlat'];lon=grid['lon0']+np.arange(grid['nx'])*grid['dlon'];now=dt.datetime.now(U);start=now.replace(minute=0,second=0,microsecond=0)+dt.timedelta(hours=1);manifest={'schema':2,'generated':now.isoformat(),'models':{}};files=[]
 def save(model,kind,run,t0,cube,blocks=None):
  cube=np.asarray(cube,dtype='<f4' if kind=='rain' else 'u1')
  if not np.isfinite(cube).all() or (cube<0).any():raise ValueError('Invalid model values')
  digest=hashlib.sha256(cube.tobytes()).hexdigest()[:12];name=f'{model}_{kind}_{run:%Y%m%d%H}_{digest}.bin';(a.out/name).write_bytes(cube.tobytes());files.append(name);hours=cube.shape[0] if kind=='rain' else cube.shape[1]
  m=dict(schema=2,model=model,label=LABELS[model],run_utc=run.isoformat(),generated=now.isoformat(),file=name,grid=grid,hours=hours,start=t0.isoformat(),t0=t0.isoformat(),tag=name,dtype='float32-le' if kind=='rain' else 'uint8',h43_run=run.isoformat(),ifs_run=run.isoformat(),n_h43=hours if model=='harmonie' else 0)
  if kind=='rain':m.update(sources=[{'harmonie':'H43','ecmwf':'IFS','icond2':'ICON'}[model]]*hours,source_intervals=blocks or [1]*hours,interval_label='hour-start')
  else:m.update(fields=['ws','wg','wd2'])
  manifest['models'].setdefault(model,{})[kind]=m
 for model,filename in [('harmonie','harmonie_canvas_meta.json'),('icond2','icond2_canvas_meta.json')]:
  path=a.root/'weerlab'/filename;raw=path.read_bytes();m=json.loads(raw);run=iso(m['run_utc']);times=native_times(m)
  if now-run>dt.timedelta(hours=12):raise ValueError('Old '+model+' run')
  keyw='wind_hr' if model=='harmonie' else 'wind';keyg='windstoten_hr' if model=='harmonie' else 'windstoten'
  w=native_field(a.root,m,keyw,lat,lon);gust=native_field(a.root,m,keyg,lat,lon);u,v=w[:,0],w[:,1];ws=np.hypot(u,v)*3.6;wg=np.maximum(np.hypot(gust[:,0],gust[:,1])*3.6,ws);wd=np.degrees(np.arctan2(-u,-v))%360
  save(model,'wind',run,times[0],np.stack([np.clip(np.rint(ws),0,255),np.clip(np.rint(wg),0,255),np.rint(wd/2)%180]))
  rain=native_field(a.root,m,'neerslag',lat,lon)[:,0];idx=[i for i,t in enumerate(times) if t-dt.timedelta(hours=1)>=start]
  if not idx:raise ValueError('No future rain')
  save(model,'rain',run,times[idx[0]]-dt.timedelta(hours=1),rain[idx])
  if path.read_bytes()!=raw:raise ValueError('Native metadata changed while building')
 e=ifs_fields(a.root)
 if not e:raise ValueError('No IFS wind')
 run,axes,fields=e;steps=sorted(fields['10u']);guststeps=sorted(fields['gust']);mid=np.array(guststeps)-1.5;stacks={f:np.stack([fields[f][s] for s in (guststeps if f=='gust' else steps)]) for f in ['10u','10v','gust']}
 def interp(st,values,x):
  if x<st[0] or x>st[-1]:raise ValueError('IFS wind does not cover five days')
  i=int(np.clip(np.searchsorted(st,x)-1,0,len(st)-2));weight=(x-st[i])/(st[i+1]-st[i]);return regrid(values[i]*(1-weight)+values[i+1]*weight,axes,lat,lon)
 rows=[]
 for t in range(120):
  x=(start+dt.timedelta(hours=t)-run).total_seconds()/3600;u=interp(steps,stacks['10u'],x);v=interp(steps,stacks['10v'],x);gust=interp(mid,stacks['gust'],x);speed=np.hypot(u,v)*3.6;rows.append((speed,np.maximum(gust*3.6,speed),np.degrees(np.arctan2(-u,-v))%360))
 cube=np.stack(rows);save('ecmwf','wind',run,start,np.stack([np.clip(np.rint(cube[:,0]),0,255),np.clip(np.rint(cube[:,1]),0,255),np.rint(cube[:,2]/2)%180]))
 run,rain,blocks=rain_ifs(a.root,lat,lon,start,120);save('ecmwf','rain',run,start,rain,blocks)
 if key[1:]!=[p.stat().st_mtime_ns for p in paths]:raise ValueError('Source changed during build')
 tmp=a.out/'current.tmp';tmp.write_text(json.dumps(manifest,separators=(',',':')))
 if a.publish:
  for name in files:subprocess.run(['/opt/homebrew/bin/rclone','copyto',str(a.out/name),'r2:weerlab-data/modelplaten/'+name,'--header-upload','Cache-Control: public, max-age=31536000, immutable'],check=True)
 tmp.replace(a.out/'current.json')
 if a.publish:
  subprocess.run(['/opt/homebrew/bin/rclone','copyto',str(a.out/'current.json'),'r2:weerlab-data/modelplaten/current.json','--header-upload','Cache-Control: no-cache'],check=True);marker.write_text(json.dumps(key))
 print({k:{t:m['hours'] for t,m in v.items()} for k,v in manifest['models'].items()})
if __name__=='__main__':main()
