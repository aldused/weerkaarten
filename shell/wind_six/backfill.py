"""Seed missing 12/18Z comparisons from exact public ECMWF GRIB members."""
import argparse,base64,datetime as dt,hashlib,json,subprocess,sys,tempfile
from pathlib import Path
import numpy as np,eccodes as ec
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from wxbeta_network import configure
configure()
from ecmwf.opendata import Client
from build import BOUNDS,iso,parse,UTC,publish_entry
ALIASES={'10fg':'gust','10fg3':'gust','10fg6':'gust','10u':'u','10v':'v'}
def decode(path,run,target,perturbed,storage,coordinates):
 lead=int((target-run).total_seconds()/3600)
 with open(path,'rb') as file:
  while (gid:=ec.codes_grib_new_from_file(file)) is not None:
   try:
    name=ec.codes_get(gid,'shortName');field=ALIASES.get(name)
    if not field:continue
    if ec.codes_get(gid,'units') not in ['m s**-1','m s-1','m/s']:raise ValueError('Onverwachte GRIB-windeenheden')
    if ec.codes_get(gid,'dataDate')!=int(run.strftime('%Y%m%d')) or ec.codes_get(gid,'dataTime')!=run.hour*100 or int(ec.codes_get(gid,'endStep'))!=lead:raise ValueError('Gemengde GRIB-run of geldigheid')
    member=int(ec.codes_get(gid,'perturbationNumber')) if perturbed else 0
    if (perturbed and member not in range(1,51)) or (member,field) in storage:raise ValueError('Dubbel of ongeldig ensemblelid')
    lat=ec.codes_get_array(gid,'latitudes');lon=ec.codes_get_array(gid,'longitudes');lon=(lon+180)%360-180
    ids=np.where((lon>=BOUNDS[0])&(lon<=BOUNDS[1])&(lat>=BOUNDS[2])&(lat<=BOUNDS[3]))[0]
    coords=np.column_stack([lat[ids],lon[ids]])
    if coordinates is not None and not np.array_equal(coords,coordinates):raise ValueError('Verschillende GRIB-roosters')
    coordinates=coords
    if field=='gust':
     if int(ec.codes_get(gid,'startStep'))!=lead-3:raise ValueError('Windstoot beslaat niet de voorgaande drie uur')
    values=ec.codes_get_values(gid)[ids]
    if not np.isfinite(values).all() or np.any(np.abs(values)>150):raise ValueError('Ontbrekende of onmogelijke windwaarden')
    storage[member,field]=values
   finally:ec.codes_release(gid)
 return coordinates
def main():
 ap=argparse.ArgumentParser();ap.add_argument('--cycle',type=int,choices=[12,18],required=True);ap.add_argument('--run',required=True);ap.add_argument('--valid',required=True);ap.add_argument('--out',type=Path,required=True);ap.add_argument('--publish',action='store_true');args=ap.parse_args()
 run=parse(args.run);target=parse(args.valid);lead=int((target-run).total_seconds()/3600)
 if run.hour!=args.cycle or lead<3 or lead>144 or lead%3:raise ValueError('Ongeldige cyclus of geldigheid')
 storage={};coordinates=None;client=Client('google')
 with tempfile.TemporaryDirectory(prefix='weerlab-wind-grib-') as directory:
  for perturbed in [False,True]:
   path=Path(directory)/('pf.grib2' if perturbed else 'fc.grib2')
   request=dict(date=run.strftime('%Y%m%d'),time=run.hour,step=lead,param=['10u','10v','10fg','10fg3','10fg6'],stream='enfo' if perturbed else 'oper',type='pf' if perturbed else 'fc',target=str(path))
   if perturbed:request['number']=list(range(1,51))
   print('Download',run,'ENS' if perturbed else 'operationeel',target,flush=True);client.retrieve(**request)
   coordinates=decode(path,run,target,perturbed,storage,coordinates);path.unlink()
 if set(storage)!={(member,field)for member in range(51)for field in ['u','v','gust']}:raise ValueError('Geen complete set van 51 leden')
 wind=np.stack([np.hypot(storage[m,'u'],storage[m,'v']) for m in range(51)]);gust=np.stack([storage[m,'gust'] for m in range(51)])
 data=np.stack([wind[0],gust[0],wind.mean(axis=0),gust.mean(axis=0),wind.max(axis=0),gust.max(axis=0)],axis=-1)[None,...]
 encoded=data.astype('<f4');document=dict(run=iso(run),sourceModel='ECMWF IFS direct Open Data',resolution='0,25° · circa 25 km',members=51,coordinates=coordinates.tolist(),times=[iso(target)],fields=['oper_wind','oper_gust','mean_wind','mean_gust','max_wind','max_gust'],encoding='float32le-base64',scale=1,units='m/s',gustIntervalHours=3,shape=list(encoded.shape),data=base64.b64encode(encoded.tobytes()).decode())
 raw=json.dumps(document,separators=(',',':')).encode();name=f'{run:%Y%m%d%H}-{hashlib.sha256(raw).hexdigest()[:10]}.json';args.out.mkdir(parents=True,exist_ok=True);(args.out/name).write_bytes(raw)
 if args.publish:subprocess.run(['/opt/homebrew/bin/rclone','copyto',str(args.out/name),f'r2:weerlab-data/wind-six/{name}','--header-upload','Cache-Control: public, max-age=31536000, immutable'],check=True)
 publish_entry(args.out,f'{args.cycle:02d}',dict(run=iso(run),file=name,resolution=document['resolution'],members=51,frames=1),args.publish)
 print(args.cycle,'complete zesluik gepubliceerd',flush=True)
if __name__=='__main__':main()
